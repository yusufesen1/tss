/* =========================================================
   weather.js — rota üzerindeki lokasyonlar için hava durumu uyarısı
   Kaynak: Open-Meteo (anahtar gerektirmez, ücretsiz, backend'e ihtiyaç yok —
   OSRM'de olduğu gibi doğrudan tarayıcıdan çağrılır).
   Rotayı hiç değiştirmez, yalnızca planlayıcıyı bilgilendirir.
   ========================================================= */
(function (global) {
  'use strict';

  var BASE = 'https://api.open-meteo.com/v1/forecast';
  var CACHE_TTL_MS = 30 * 60 * 1000; // 30 dk — aynı konum için gereksiz istek atmamak için
  var cache = {};

  function cacheKey(lat, lng) {
    return lat.toFixed(2) + ',' + lng.toFixed(2);
  }

  function fetchForecast(lat, lng) {
    var key = cacheKey(lat, lng);
    var hit = cache[key];
    if (hit && (Date.now() - hit.fetchedAt) < CACHE_TTL_MS) {
      return Promise.resolve(hit.data);
    }
    var url = BASE + '?latitude=' + lat + '&longitude=' + lng +
      '&hourly=weathercode,precipitation,snowfall,temperature_2m&timezone=auto&forecast_days=2';
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('Hava durumu servisi yanıt vermedi.');
      return res.json();
    }).then(function (data) {
      cache[key] = { fetchedAt: Date.now(), data: data };
      return data;
    });
  }

  /* WMO hava kodu -> kategori + Türkçe etiket.
     https://open-meteo.com/en/docs (weathercode tablosu)
     kind:'ok' olanlar uyarı listesine girmez, sadece özet kartında gösterilir. */
  var CODE_INFO = {
    0:  { kind: 'ok', label: 'Açık' },
    1:  { kind: 'ok', label: 'Genellikle açık' },
    2:  { kind: 'ok', label: 'Parçalı bulutlu' },
    3:  { kind: 'ok', label: 'Kapalı' },
    51: { kind: 'ok', label: 'Hafif çisenti' },
    53: { kind: 'ok', label: 'Çisenti' },
    45: { kind: 'sis',     label: 'sis' },
    48: { kind: 'sis',     label: 'kırağı sisi' },
    55: { kind: 'yagmur',  label: 'yoğun çisenti' },
    56: { kind: 'yagmur',  label: 'donan çisenti' },
    57: { kind: 'yagmur',  label: 'yoğun donan çisenti' },
    61: { kind: 'yagmur',  label: 'hafif yağmur' },
    63: { kind: 'yagmur',  label: 'yağmur' },
    65: { kind: 'yagmur',  label: 'sağanak yağış' },
    66: { kind: 'yagmur',  label: 'donan yağmur' },
    67: { kind: 'yagmur',  label: 'yoğun donan yağmur' },
    71: { kind: 'kar',     label: 'hafif kar' },
    73: { kind: 'kar',     label: 'kar' },
    75: { kind: 'kar',     label: 'yoğun kar' },
    77: { kind: 'kar',     label: 'kar taneleri' },
    80: { kind: 'yagmur',  label: 'sağanak yağış' },
    81: { kind: 'yagmur',  label: 'kuvvetli sağanak yağış' },
    82: { kind: 'yagmur',  label: 'şiddetli sağanak yağış' },
    85: { kind: 'kar',     label: 'kar sağanağı' },
    86: { kind: 'kar',     label: 'yoğun kar sağanağı' },
    95: { kind: 'firtina', label: 'gök gürültülü fırtına' },
    96: { kind: 'firtina', label: 'dolu ile gök gürültülü fırtına' },
    99: { kind: 'firtina', label: 'kuvvetli dolu ile fırtına' }
  };

  function messageFor(name, info) {
    if (info.kind === 'kar') {
      return name + ' için ' + info.label + ' bekleniyor.';
    }
    if (info.kind === 'yagmur') {
      return name + ' için ' + info.label + ' bekleniyor, trafik yoğunluğu artabilir.';
    }
    if (info.kind === 'firtina') {
      return name + ' için ' + info.label + ' bekleniyor.';
    }
    return name + ' için ' + info.label + ' bekleniyor, görüş mesafesi düşebilir.';
  }

  function nearestHourIndex(times, targetDate) {
    var targetMs = targetDate.getTime();
    var bestIdx = 0, bestDiff = Infinity;
    for (var i = 0; i < times.length; i++) {
      var diff = Math.abs(new Date(times[i]).getTime() - targetMs);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    return bestIdx;
  }

  /**
   * Rota üzerindeki duraklar için hava durumu kontrolü.
   * @param {Array} points - [{ name, lat, lng, atDate }]
   * @returns {Promise<Array>} uyarı gerektiren noktalar: { name, kind, message }
   */
  function checkPoints(points) {
    return Promise.all(points.map(function (p) {
      return fetchForecast(p.lat, p.lng).then(function (data) {
        if (!data.hourly || !data.hourly.time || !data.hourly.weathercode) return null;
        var idx = nearestHourIndex(data.hourly.time, p.atDate);
        var code = data.hourly.weathercode[idx];
        var info = CODE_INFO[code];
        if (!info || info.kind === 'ok') return null; // açık/parçalı bulutlu gibi önemsiz durumlar listede yok
        return { name: p.name, kind: info.kind, message: messageFor(p.name, info) };
      }).catch(function () {
        return null; // bir konum başarısız olursa sessizce atla, plan yine kullanılabilir kalsın
      });
    })).then(function (results) {
      return results.filter(Boolean);
    });
  }

  /**
   * Tek bir nokta için, ekstrem olsun olmasın, o anki tahmini sıcaklık+durumu
   * döndürür (özet kartı için — uyarı listesinden farklı olarak filtrelemez).
   * @returns {Promise<{temperature:number, label:string, kind:string}|null>}
   */
  function describePoint(lat, lng, atDate) {
    return fetchForecast(lat, lng).then(function (data) {
      if (!data.hourly || !data.hourly.time || !data.hourly.weathercode) return null;
      var idx = nearestHourIndex(data.hourly.time, atDate);
      var code = data.hourly.weathercode[idx];
      var temp = data.hourly.temperature_2m ? data.hourly.temperature_2m[idx] : null;
      var info = CODE_INFO[code] || { kind: 'ok', label: 'Bilinmiyor' };
      return { temperature: temp, label: info.label, kind: info.kind };
    }).catch(function () { return null; });
  }

  global.TSSWeather = { checkPoints: checkPoints, describePoint: describePoint };
})(window);
