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

  var url = BASE + '/' + coord(origin) + ':' + coord(destination) +
    '/json?key=' + encodeURIComponent(apiKey) + '&traffic=true&travelMode=car';

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
      return {
        distanceMeters: route.summary.lengthInMeters,
        durationSeconds: route.summary.travelTimeInSeconds,
        trafficDelaySeconds: route.summary.trafficDelayInSeconds || 0,
        geometry: geometry
      };
    })
    ['catch'](function (err) {
      clearTimeout(timer);
      if (!err.status) err.status = 502;
      throw err;
    });
}

module.exports = { routeLeg: routeLeg, keySource: keySource };
