/* =========================================================
   tomtom.js (server) — TomTom Routing API proxy'si
   =========================================================
   Amaç: API anahtarının tarayıcıya HİÇ inmemesi. Tarayıcı yalnızca
   kendi backend'ine "şu iki nokta arasını sor" der; TomTom'a giden
   istek (ve içindeki anahtar) sunucuda kalır.

   Anahtar iki yerden gelebilir, öncelik sırasıyla:
     1. server/.env → TOMTOM_API_KEY   (önerilen: tarayıcı hiç görmez)
     2. Veritabanındaki ayar            (kullanıcı arayüzden girmişse —
        eski davranışla uyumluluk için; bu durumda anahtar bootstrap ile
        tarayıcıya da gider, çünkü kullanıcı zaten oraya yazmıştır)

   İstemci sözleşmesi js/tomtom.js'in beklediğiyle birebir aynı:
   { distanceMeters, durationSeconds, trafficDelaySeconds, geometry }
   ========================================================= */
'use strict';

var store = require('./store');

var BASE = 'https://api.tomtom.com/routing/1/calculateRoute';
var TIMEOUT_MS = 12000;

// Anahtarın kaynağı: 'server' (.env), 'client' (DB/arayüz) ya da 'none'
function keySource() {
  if (String(process.env.TOMTOM_API_KEY || '').trim()) return 'server';
  if (store.getTomTomApiKey()) return 'client';
  return 'none';
}

function resolveKey() {
  var envKey = String(process.env.TOMTOM_API_KEY || '').trim();
  return envKey || store.getTomTomApiKey() || '';
}

function coord(point) {
  return Number(point.lat).toFixed(6) + ',' + Number(point.lng).toFixed(6);
}

function isValidPoint(p) {
  return p && isFinite(Number(p.lat)) && isFinite(Number(p.lng));
}

function routeLeg(origin, destination) {
  if (!isValidPoint(origin) || !isValidPoint(destination)) {
    var badInput = new Error('Geçersiz koordinat.');
    badInput.status = 400;
    return Promise.reject(badInput);
  }

  var apiKey = resolveKey();
  if (!apiKey) {
    var noKey = new Error('TomTom API anahtarı tanımlı değil (server/.env → TOMTOM_API_KEY ya da Trafik Ayarları).');
    noKey.status = 400;
    return Promise.reject(noKey);
  }

  // sectionType=traffic: rota ÜZERİNDEKİ tıkanık bölümleri aynı yanıtta
  // döndürür (ayrı bir istek/coğrafi filtreleme gerekmez). Her bölüm rota
  // geometrisindeki nokta aralığını (startPointIndex→endPointIndex) taşır.
  var url = BASE + '/' + coord(origin) + ':' + coord(destination) +
    '/json?key=' + encodeURIComponent(apiKey) +
    '&traffic=true&travelMode=car&sectionType=traffic';

  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  return fetch(url, { signal: controller.signal })
    .then(function (res) {
      clearTimeout(timer);
      if (!res.ok) {
        return res.text().then(function (text) {
          // Anahtar hata metninde geçebilir — istemciye sızdırmamak için ayıklıyoruz
          var safe = String(text).split(apiKey).join('***').slice(0, 200);
          var err = new Error('TomTom isteği başarısız (HTTP ' + res.status + '): ' + safe);
          err.status = res.status === 403 || res.status === 401 ? 502 : 502;
          throw err;
        });
      }
      return res.json();
    })
    .then(function (json) {
      var route = json.routes && json.routes[0];
      if (!route || !route.summary) {
        var err = new Error('TomTom yanıtı beklenmedik formatta.');
        err.status = 502;
        throw err;
      }
      var geometry = [];
      (route.legs || []).forEach(function (leg) {
        (leg.points || []).forEach(function (p) { geometry.push([p.latitude, p.longitude]); });
      });
      // Yalnızca gerçekten tıkanık bölümler (TRAFFIC tipi); TomTom başka
      // section tipleri de döndürebilir.
      var jams = (route.sections || [])
        .filter(function (s) { return s.sectionType === 'TRAFFIC'; })
        .map(function (s) {
          return {
            category: s.simpleCategory || null,          // JAM | ROAD_WORK | ROAD_CLOSURE
            delaySeconds: s.delayInSeconds || 0,
            effectiveSpeedKmh: s.effectiveSpeedInKmh != null ? s.effectiveSpeedInKmh : null,
            magnitudeOfDelay: s.magnitudeOfDelay != null ? s.magnitudeOfDelay : null,
            startPointIndex: s.startPointIndex,
            endPointIndex: s.endPointIndex
          };
        });
      return {
        distanceMeters: route.summary.lengthInMeters,
        durationSeconds: route.summary.travelTimeInSeconds,
        trafficDelaySeconds: route.summary.trafficDelayInSeconds || 0,
        geometry: geometry,
        jams: jams
      };
    })
    ['catch'](function (err) {
      clearTimeout(timer);
      if (!err.status) err.status = 502;
      throw err;
    });
}

/* =========================================================
   Rota üzerindeki olaylar (kaza, kapalı yol, çalışma)
   =========================================================
   TomTom'un incidentDetails ucu bir KUTU (bbox) sorgular; İstanbul ölçeğinde
   bu yüzlerce olay döndürür ve çoğu rotayla alakasızdır. Bu yüzden dönen
   olaylar, rotanın kendisine olan uzaklığına göre eleniyor.

   Yöntem: her olayın geometrisindeki her nokta için, rota poligonundaki
   en yakın doğru parçasına olan dik uzaklık hesaplanır; en küçüğü eşiğin
   altındaysa olay rotaya "değiyor" sayılır.

   BİLİNEN SINIR: bölünmüş yolda gidiş/dönüş şeritleri ~20 m arayla geçtiği
   için uzaklık filtresi tek başına karşı şeridi ayıramaz — ters yöndeki bir
   kaza da eşiğin içine düşebilir. Olayın from/to alanları yönü metin olarak
   taşır, kullanıcı bakarak ayırt edebilir. Uyarı sürücüyü bilgilendirmek
   için; rotayı otomatik değiştirmiyoruz, bu yüzden yanlış pozitif kaçırılan
   kazadan daha ucuz.
   ========================================================= */

var INCIDENTS_BASE = 'https://api.tomtom.com/traffic/services/5/incidentDetails';
var DEFAULT_THRESHOLD_M = 50;
var MAX_ROUTE_POINTS = 6000;   // aşırı büyük gövdelere karşı emniyet

// iconCategory → Türkçe etiket (TomTom v5 kategori numaraları)
var CATEGORY = {
  0: 'Bilinmeyen', 1: 'Kaza', 2: 'Sis', 3: 'Tehlikeli durum', 4: 'Buzlanma',
  5: 'Tıkanıklık', 6: 'Şerit kapalı', 7: 'Yol kapalı', 8: 'Yol çalışması',
  9: 'Rüzgar', 10: 'Yağış', 11: 'Araç kuyruğu', 14: 'Arızalı araç'
};

/* --- düzlemsel yaklaşım: bu ölçekte (şehir içi) yeterli --- */
function projector(lat0) {
  var kx = Math.cos(lat0 * Math.PI / 180) * 111320;   // 1° boylam ≈ metre
  var ky = 110540;                                     // 1° enlem ≈ metre
  return function (lat, lng) { return [lng * kx, lat * ky]; };
}

// Nokta ile doğru parçası arasındaki en kısa uzaklığın KARESİ (metre²)
function distSqToSegment(px, py, ax, ay, bx, by) {
  var dx = bx - ax, dy = by - ay;
  var lenSq = dx * dx + dy * dy;
  var t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  var cx = ax + t * dx, cy = ay + t * dy;
  var ex = px - cx, ey = py - cy;
  return ex * ex + ey * ey;
}

function boundingBox(points) {
  var minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  points.forEach(function (p) {
    if (p[0] < minLat) minLat = p[0];
    if (p[0] > maxLat) maxLat = p[0];
    if (p[1] < minLng) minLng = p[1];
    if (p[1] > maxLng) maxLng = p[1];
  });
  return { minLat: minLat, maxLat: maxLat, minLng: minLng, maxLng: maxLng };
}

// Olay geometrisini [[lat,lng], ...] listesine indirger (Point / LineString)
function incidentPoints(geometry) {
  if (!geometry || !geometry.coordinates) return [];
  var c = geometry.coordinates;
  if (geometry.type === 'Point') return [[c[1], c[0]]];
  if (geometry.type === 'LineString') {
    return c.map(function (pair) { return [pair[1], pair[0]]; });
  }
  if (geometry.type === 'MultiLineString') {
    var out = [];
    c.forEach(function (line) {
      line.forEach(function (pair) { out.push([pair[1], pair[0]]); });
    });
    return out;
  }
  return [];
}

/**
 * @param {Array<[number,number]>} route  [[lat,lng], ...] birleşik rota geometrisi
 * @param {number} thresholdMeters        rota çizgisine kabul uzaklığı
 */
function incidentsOnRoute(route, thresholdMeters) {
  if (!Array.isArray(route) || route.length < 2) {
    var bad = new Error('Rota geometrisi gerekli (en az 2 nokta).');
    bad.status = 400;
    return Promise.reject(bad);
  }
  if (route.length > MAX_ROUTE_POINTS) {
    // Seyrelt: eşik metre mertebesinde olduğu için nokta atlamak riskli,
    // ama bu sınıra ancak olağandışı büyük planlarda ulaşılır.
    var step = Math.ceil(route.length / MAX_ROUTE_POINTS);
    route = route.filter(function (_, i) { return i % step === 0; });
  }

  var apiKey = resolveKey();
  if (!apiKey) {
    var noKey = new Error('TomTom API anahtarı tanımlı değil.');
    noKey.status = 400;
    return Promise.reject(noKey);
  }

  var threshold = Number(thresholdMeters) > 0 ? Number(thresholdMeters) : DEFAULT_THRESHOLD_M;
  var box = boundingBox(route);
  // Kutuyu eşiğin biraz üstünde bir payla genişlet (sınıra teğet olaylar kaçmasın)
  var pad = (threshold + 100) / 111320;
  var bbox = [
    (box.minLng - pad).toFixed(6), (box.minLat - pad).toFixed(6),
    (box.maxLng + pad).toFixed(6), (box.maxLat + pad).toFixed(6)
  ].join(',');

  var fields = '{incidents{geometry{type,coordinates},properties{iconCategory,' +
    'magnitudeOfDelay,delay,length,from,to,roadNumbers,events{description}}}}';
  var url = INCIDENTS_BASE +
    '?key=' + encodeURIComponent(apiKey) +
    '&bbox=' + encodeURIComponent(bbox) +
    '&fields=' + encodeURIComponent(fields) +
    '&language=tr-TR&timeValidityFilter=present';

  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  return fetch(url, { signal: controller.signal })
    .then(function (res) {
      clearTimeout(timer);
      if (!res.ok) {
        return res.text().then(function (text) {
          var safe = String(text).split(apiKey).join('***').slice(0, 200);
          var err = new Error('TomTom olay isteği başarısız (HTTP ' + res.status + '): ' + safe);
          err.status = 502;
          throw err;
        });
      }
      return res.json();
    })
    .then(function (json) {
      var all = json.incidents || [];
      var project = projector(route[Math.floor(route.length / 2)][0]);

      // Rotayı bir kez metreye çevir
      var rp = route.map(function (p) { return project(p[0], p[1]); });
      var thrSq = threshold * threshold;

      // Ucuz ön eleme için rotanın metre cinsinden kutusu
      var rminx = Infinity, rmaxx = -Infinity, rminy = Infinity, rmaxy = -Infinity;
      rp.forEach(function (p) {
        if (p[0] < rminx) rminx = p[0]; if (p[0] > rmaxx) rmaxx = p[0];
        if (p[1] < rminy) rminy = p[1]; if (p[1] > rmaxy) rmaxy = p[1];
      });

      var matched = [];
      all.forEach(function (inc) {
        var pts = incidentPoints(inc.geometry);
        if (!pts.length) return;

        var best = Infinity;
        for (var i = 0; i < pts.length && best > thrSq; i++) {
          var m = project(pts[i][0], pts[i][1]);
          // Rotanın kutusuna bile uzaksa segment döngüsüne hiç girme
          if (m[0] < rminx - threshold || m[0] > rmaxx + threshold ||
              m[1] < rminy - threshold || m[1] > rmaxy + threshold) continue;
          for (var j = 1; j < rp.length; j++) {
            var d = distSqToSegment(m[0], m[1], rp[j - 1][0], rp[j - 1][1], rp[j][0], rp[j][1]);
            if (d < best) { best = d; if (best <= thrSq) break; }
          }
        }
        if (best > thrSq) return;

        var p = inc.properties || {};
        matched.push({
          category: CATEGORY[p.iconCategory] || CATEGORY[0],
          categoryCode: p.iconCategory,
          description: (p.events || []).map(function (e) { return e.description; }).join(' / '),
          from: p.from || '',
          to: p.to || '',
          roadNumbers: p.roadNumbers || [],
          delaySeconds: p.delay || 0,
          lengthMeters: p.length || 0,
          magnitudeOfDelay: p.magnitudeOfDelay != null ? p.magnitudeOfDelay : null,
          distanceToRouteMeters: Math.round(Math.sqrt(best))
        });
      });

      // Önce en çok gecikme yaratan, sonra en şiddetli
      matched.sort(function (a, b) {
        return (b.delaySeconds - a.delaySeconds) ||
               ((b.magnitudeOfDelay || 0) - (a.magnitudeOfDelay || 0));
      });

      return { incidents: matched, scanned: all.length, thresholdMeters: threshold };
    })
    ['catch'](function (err) {
      clearTimeout(timer);
      if (!err.status) err.status = 502;
      throw err;
    });
}

module.exports = {
  routeLeg: routeLeg,
  incidentsOnRoute: incidentsOnRoute,
  keySource: keySource
};
