/* =========================================================
   tomtom.js — TomTom Routing API üzerinden CANLI TRAFİK dahil
   tekil bacak (leg) sorgusu.
   ---------------------------------------------------------
   Sadece "En Az Süre" optimizasyon modunda ve SADECE js/optimizer.js'in
   zaten belirlediği son durak sırasındaki ardışık bacaklar için
   çağrılır (n istek) — sıralama kararının kendisi hâlâ OSRM'in
   ücretsiz/sınırsız matrix'inden çıkıyor (n² değil). Bkz. js/app.js
   → refineGroupWithLiveTraffic.

   Güvenlik notu — iki mod:
   1) BACKEND VARSA (setProxy çağrılmışsa): istek kendi sunucumuza gider,
      TomTom'a asıl çağrıyı sunucu yapar. Anahtar `server/.env` içinde
      tanımlıysa tarayıcıya hiç inmez, Network sekmesinde görünmez.
   2) BACKEND YOKSA (index.html çift tıklanarak açıldıysa): eski davranış —
      anahtar kullanıcı tarafından arayüzden girilir, sadece o tarayıcının
      localStorage'ında tutulur (js/data.js) ve istek URL'sinde görünür.
      Bu durumda TomTom panelinden key'e domain kısıtlaması eklenmesi
      önerilir.
   ========================================================= */
(function (global) {
  'use strict';

  var BASE = 'https://api.tomtom.com/routing/1/calculateRoute';

  // { url: '/api/tomtom/route-leg', getToken: function () { return '...'; } }
  var proxy = null;

  /** Backend proxy'sini devreye alır (js/app.js → init). */
  function setProxy(config) {
    proxy = (config && config.url) ? config : null;
  }

  function coord(loc) { return loc.lat.toFixed(6) + ',' + loc.lng.toFixed(6); }

  function routeLegViaProxy(origin, destination) {
    var headers = { 'Content-Type': 'application/json' };
    var token = proxy.getToken ? proxy.getToken() : '';
    if (token) headers['X-TSS-Token'] = token;

    return fetch(proxy.url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        origin: { lat: origin.lat, lng: origin.lng },
        destination: { lat: destination.lat, lng: destination.lng }
      })
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (text) {
          throw new Error('TomTom proxy isteği başarısız (HTTP ' + res.status + '): ' + text.slice(0, 200));
        });
      }
      return res.json();
    });
  }

  /**
   * İki nokta arası, o anki canlı trafik dahil süre/mesafe/güzergah.
   * @param {{lat:number,lng:number}} origin
   * @param {{lat:number,lng:number}} destination
   * @param {string} apiKey
   * @returns {Promise<{distanceMeters:number, durationSeconds:number,
   *                     trafficDelaySeconds:number, geometry:Array<[number,number]>}>}
   */
  function routeLeg(origin, destination, apiKey) {
    // Backend varsa anahtar hiç kullanılmaz — sunucu kendi anahtarıyla sorar.
    if (proxy) return routeLegViaProxy(origin, destination);

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

  global.TSSTomTom = { routeLeg: routeLeg, setProxy: setProxy };
})(window);
