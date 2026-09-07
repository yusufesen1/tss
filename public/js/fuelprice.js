/* =========================================================
   fuelprice.js — ulusal ortalama akaryakıt fiyatı
   =========================================================
   Fiyat backend'den gelir: GET /api/fuel-price
   (sunucu kaynağı doğrudan çeker ve 6 saat önbelleğe alır — bkz.
   server/fuelprice.js ve TEKNIK-DOKUMAN §10.4).

   Neden tarayıcıdan doğrudan çekmiyoruz: ücretsiz/anahtarsız akaryakıt
   fiyat servisleri (ör. UcuzYakıtBul) yanıtlarında Access-Control-Allow-Origin
   göndermiyor; Same-Origin Policy isteği sessizce engelliyor. CORS bir
   TARAYICI kısıtı olduğundan sunucuda böyle bir engel yok.
   ========================================================= */
(function (global) {
  'use strict';

  var URL = '/api/fuel-price';
  var TIMEOUT_MS = 6000;

  // Erişim anahtarını (X-TSS-Token) her istekte taze okumak için;
  // js/app.js init() sırasında bir kez bağlar.
  var getToken = null;

  function configure(options) {
    getToken = (options && typeof options.getToken === 'function') ? options.getToken : null;
  }

  function fetchWithTimeout(url, ms, init) {
    var options = init || {};
    if (typeof AbortController === 'undefined' || typeof fetch === 'undefined') {
      return typeof fetch === 'undefined'
        ? Promise.reject(new Error('fetch desteklenmiyor'))
        : fetch(url, options);
    }
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, ms);
    options.signal = controller.signal;
    return fetch(url, options).then(
      function (res) { clearTimeout(timer); return res; },
      function (err) { clearTimeout(timer); throw err; }
    );
  }

  // Best-effort: her hata durumunda (ağ yok, kaynak servis erişilemez, bozuk
  // JSON) sessizce null döner — çağıran taraf (js/app.js) elle girilen fiyata
  // ya da "bilinmiyor" durumuna düşer, uygulamayı hiçbir zaman bloke etmez
  // (js/weather.js ile aynı felsefe).
  function fetchNational() {
    var init = {};
    var token = getToken ? getToken() : '';
    if (token) init.headers = { 'X-TSS-Token': token };

    return fetchWithTimeout(URL, TIMEOUT_MS, init)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var dizel = Number(data && data.dizel);
        var benzin = Number(data && data.benzin);
        if (!isFinite(dizel) && !isFinite(benzin)) return null;
        return {
          dizel: isFinite(dizel) && dizel > 0 ? dizel : null,
          benzin: isFinite(benzin) && benzin > 0 ? benzin : null,
          updatedAt: data.updatedAt || null,
          source: data.source || 'Ulusal ortalama'
        };
      })
      ['catch'](function (err) {
        console.warn('[TSS] Otomatik yakıt fiyatı alınamadı, elle girilen/varsayılan değere düşülüyor:', err.message || err);
        return null;
      });
  }

  global.TSSFuelPrice = { fetchNational: fetchNational, configure: configure };
})(window);
