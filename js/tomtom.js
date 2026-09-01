/* =========================================================
   tomtom.js — TomTom Routing API üzerinden CANLI TRAFİK dahil
   tekil bacak (leg) sorgusu.
   ---------------------------------------------------------
   Sadece "En Az Süre" optimizasyon modunda ve SADECE js/optimizer.js'in
   zaten belirlediği son durak sırasındaki ardışık bacaklar için
   çağrılır (n istek) — sıralama kararının kendisi hâlâ OSRM'in
   ücretsiz/sınırsız matrix'inden çıkıyor (n² değil). Bkz. js/app.js
   → refineGroupWithLiveTraffic.

   Güvenlik notu: Bu proje backend'siz olduğu için API key kaçınılmaz
   olarak tarayıcıdan (Network sekmesinde) görünür durumda — bu, koda
   sabit yazmaktan farklı: key kullanıcı tarafından arayüzden girilir,
   sadece bu tarayıcının localStorage'ında tutulur (js/data.js), hiçbir
   dosyaya/kaynak koduna gömülmez. Ek olarak TomTom panelinden key'e
   domain kısıtlaması eklemeniz önerilir.
   ========================================================= */
(function (global) {
  'use strict';

  var BASE = 'https://api.tomtom.com/routing/1/calculateRoute';

  function coord(loc) { return loc.lat.toFixed(6) + ',' + loc.lng.toFixed(6); }

  /**
   * İki nokta arası, o anki canlı trafik dahil süre/mesafe/güzergah.
   * @param {{lat:number,lng:number}} origin
   * @param {{lat:number,lng:number}} destination
   * @param {string} apiKey
   * @returns {Promise<{distanceMeters:number, durationSeconds:number,
   *                     trafficDelaySeconds:number, geometry:Array<[number,number]>}>}
   */
  function routeLeg(origin, destination, apiKey) {
    if (!apiKey) return Promise.reject(new Error('TomTom API key girilmemiş.'));

    var url = BASE + '/' + coord(origin) + ':' + coord(destination) +
      '/json?key=' + encodeURIComponent(apiKey) + '&traffic=true&travelMode=car';

    return fetch(url).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (text) {
          throw new Error('TomTom isteği başarısız (HTTP ' + res.status + '): ' + text.slice(0, 200));
        });
      }
      return res.json();
    }).then(function (json) {
      var route = json.routes && json.routes[0];
      if (!route || !route.summary) throw new Error('TomTom yanıtı beklenmedik formatta.');

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
    });
  }

  global.TSSTomTom = { routeLeg: routeLeg };
})(window);
