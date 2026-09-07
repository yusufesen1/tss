/* =========================================================
   fuelprice.js (server) — ulusal ortalama akaryakıt fiyatı
   =========================================================
   js/fuelprice.js'in başındaki not: kaynak servis (UcuzYakıtBul)
   CORS başlığı göndermediği için tarayıcıdan DOĞRUDAN çağrılamıyordu;
   bu yüzden GitHub Actions ile 6 saatte bir çekilip repoya yazılıyor,
   panel de raw.githubusercontent.com'dan okuyordu.

   Backend varken bu dolambaç gereksiz: sunucu tarafında CORS diye bir
   kısıt yok, servisi doğrudan çağırabiliyoruz. Böylece:
     - repo bir GitHub uzak sunucusuna bağlı olmak zorunda değil
     - Actions'ın çalışıp çalışmadığına bağımlılık kalkıyor
     - fiyat 6 saatte bir değil, önbellek süresi dolduğunda tazeleniyor

   GitHub Actions akışı DEVRE DIŞI BIRAKILMADI: backend çalıştırılmayan
   (file:// ile açılan) kurulumlar için hâlâ tek yol o.
   ========================================================= */
'use strict';

var SOURCE_URL = 'https://ucuzyakitbul.com.tr/api/prices/national';
var CACHE_TTL_MS = 6 * 60 * 60 * 1000;   // 6 saat (kaynak günde bir güncelleniyor)
var TIMEOUT_MS = 8000;

var cache = null;        // { data, fetchedAt }
var inFlight = null;     // aynı anda gelen isteklerin tek çağrıyı paylaşması için

function parsePrices(raw) {
  var prices = (raw && raw.prices) || [];
  function find(type) {
    var row = prices.filter(function (p) {
      return String(p.fuelType || '').toLowerCase() === type;
    })[0];
    return row && typeof row.price === 'number' && row.price > 0 ? row.price : null;
  }
  var dizel = find('motorin');
  var benzin = find('benzin');
  if (dizel === null && benzin === null) return null;
  return {
    dizel: dizel,
    benzin: benzin,
    updatedAt: new Date().toISOString(),
    source: 'UcuzYakıtBul (ulusal ortalama, https://ucuzyakitbul.com.tr) — backend tarafından çekildi'
  };
}

function fetchFresh() {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  return fetch(SOURCE_URL, { signal: controller.signal })
    .then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (raw) {
      var data = parsePrices(raw);
      if (data) cache = { data: data, fetchedAt: Date.now() };
      return data;
    })
    ['catch'](function (err) {
      clearTimeout(timer);
      console.warn('[TSS] Yakıt fiyatı çekilemedi:', err.message || err);
      // Best-effort: eski önbellek varsa onu döndür (bayat ama hiç yoktan iyi)
      return cache ? cache.data : null;
    });
}

/** Önbellekli fiyat. Hiçbir zaman reject etmez — başarısızlıkta null döner. */
function getNational() {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return Promise.resolve(cache.data);
  }
  if (inFlight) return inFlight;
  inFlight = fetchFresh().then(function (data) {
    inFlight = null;
    return data;
  }, function () {
    inFlight = null;
    return null;
  });
  return inFlight;
}

module.exports = { getNational: getNational };
