/* =========================================================
   fuelprice.js — Türkiye ulusal ortalama akaryakıt fiyatı
   =========================================================
   Ücretsiz/anahtarsız akaryakıt fiyat servisleri (ör. UcuzYakıtBul'un
   /api/prices/national uç noktası) yanıtlarında Access-Control-Allow-Origin
   göndermiyor — yani bu dosya onları DOĞRUDAN çağıramaz, tarayıcı Same-Origin
   Policy gereği isteği sessizce engeller (bkz. TEKNIK-DOKUMAN §10.4; OSRM,
   Open-Meteo ve TomTom'un aksine, bu servis tarayıcıdan client-side kullanım
   için tasarlanmamış).

   Bunun yerine bu projenin GitHub reposunda zamanlanmış bir GitHub Actions
   iş akışı (.github/workflows/fuel-price.yml) günde birkaç kez o servisi
   SUNUCU TARAFINDAN (CORS derdi olmadan) çekip data/fuel-price.json'a yazıyor.
   raw.githubusercontent.com statik dosyaları CORS'a açık sunduğundan, bu
   modül sadece o dosyayı okuyor — kendi "API noktamız" bu.
   ========================================================= */
(function (global) {
  'use strict';

  var URL = 'https://raw.githubusercontent.com/yusufesen1/tss/main/data/fuel-price.json';
  var TIMEOUT_MS = 6000;

  function fetchWithTimeout(url, ms) {
    if (typeof AbortController === 'undefined' || typeof fetch === 'undefined') {
      return typeof fetch === 'undefined' ? Promise.reject(new Error('fetch desteklenmiyor')) : fetch(url);
    }
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, ms);
    return fetch(url, { signal: controller.signal }).then(
      function (res) { clearTimeout(timer); return res; },
      function (err) { clearTimeout(timer); throw err; }
    );
  }

  // Best-effort: her hata durumunda (ağ yok, dosya henüz oluşturulmadı, JSON
  // bozuk) sessizce null döner — çağıran taraf (js/app.js) elle girilen
  // fiyata ya da "bilinmiyor" durumuna düşer, uygulamayı hiçbir zaman
  // bloke etmez (js/weather.js ile aynı felsefe).
  function fetchNational() {
    return fetchWithTimeout(URL, TIMEOUT_MS)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var dizel = Number(data && data.motorin);
        var benzin = Number(data && data.benzin);
        if (!isFinite(dizel) && !isFinite(benzin)) return null;
        return {
          dizel: isFinite(dizel) && dizel > 0 ? dizel : null,
          benzin: isFinite(benzin) && benzin > 0 ? benzin : null,
          updatedAt: data.updatedAt || null,
          source: data.source || 'UcuzYakıtBul (ulusal ortalama)'
        };
      })
      .catch(function (err) {
        console.warn('[TSS] Otomatik yakıt fiyatı alınamadı, elle girilen/varsayılan değere düşülüyor:', err.message || err);
        return null;
      });
  }

  global.TSSFuelPrice = { fetchNational: fetchNational };
})(window);
