/* =========================================================
   tomtom.js — CANLI TRAFİK dahil tekil bacak (leg) sorgusu
   ---------------------------------------------------------
   Sadece "En Az Süre" optimizasyon modunda ve SADECE js/optimizer.js'in
   zaten belirlediği son durak sırasındaki ardışık bacaklar için
   çağrılır (n istek) — sıralama kararının kendisi hâlâ OSRM'in
   ücretsiz/sınırsız matrix'inden çıkıyor (n² değil). Bkz. js/app.js
   → refineGroupWithLiveTraffic.

   API anahtarı tarayıcıya HİÇ inmez: istek kendi backend'imize gider
   (POST /api/tomtom/route-leg), TomTom'a asıl çağrıyı sunucu yapar.
   Anahtar server/.env → TOMTOM_API_KEY'de ya da (kullanıcı arayüzden
   girdiyse) sunucunun veritabanında durur. Bkz. server/tomtom.js,
   TEKNIK-DOKUMAN §10.3 ve §12.
   ========================================================= */
(function (global) {
  'use strict';

  var URL = '/api/tomtom/route-leg';

  // Erişim anahtarını (X-TSS-Token) her istekte taze okumak için;
  // js/app.js init() sırasında bir kez bağlar.
  var getToken = null;

  function configure(options) {
    getToken = (options && typeof options.getToken === 'function') ? options.getToken : null;
  }

  /**
   * İki nokta arası, o anki canlı trafik dahil süre/mesafe/güzergah.
   * @param {{lat:number,lng:number}} origin
   * @param {{lat:number,lng:number}} destination
   * @returns {Promise<{distanceMeters:number, durationSeconds:number,
   *                     trafficDelaySeconds:number, geometry:Array<[number,number]>}>}
   */
  function routeLeg(origin, destination) {
    var headers = { 'Content-Type': 'application/json' };
    var token = getToken ? getToken() : '';
    if (token) headers['X-TSS-Token'] = token;

    return fetch(URL, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        origin: { lat: origin.lat, lng: origin.lng },
        destination: { lat: destination.lat, lng: destination.lng }
      })
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (text) {
          throw new Error('TomTom isteği başarısız (HTTP ' + res.status + '): ' + text.slice(0, 200));
        });
      }
      return res.json();
    });
  }

  global.TSSTomTom = { routeLeg: routeLeg, configure: configure };
})(window);
