/* =========================================================
   index.js — TSS Rota Planlama Paneli backend'i (Express + SQLite)
   =========================================================
   Çalıştırma:  node server/index.js   (ya da: cd server && npm start)
   Sonra:       http://localhost:3000
   LAN'daki diğer cihazlar: http://<bu-makinenin-ip'si>:3000

   public/ altındaki statik dosyalar (index.html, styles.css, js/, vendor/,
   assets/) da buradan servis edilir — frontend ile API aynı origin'de
   olduğu için CORS yapılandırması gerekmez.

   Erişim kontrolü: /api/* istekleri X-TSS-Token header'ı ile korunur
   (bkz. auth middleware). Bu tam bir authentication sistemi DEĞİL,
   küçük bir LAN ekibi için v1 kapısıdır.
   ========================================================= */
'use strict';

var path = require('path');
var express = require('express');

try { require('dotenv').config({ path: path.join(__dirname, '.env') }); } catch (e) { /* .env opsiyonel */ }

var store = require('./store');
var d = require('./db');
var tomtom = require('./tomtom');
var fuelprice = require('./fuelprice');

var PORT = Number(process.env.PORT) || 3000;
var HOST = process.env.HOST || '0.0.0.0';   // LAN'dan erişim için
var APP_TOKEN = String(process.env.APP_TOKEN || '').trim();

var app = express();
app.use(express.json({ limit: '5mb' }));   // sefer geçmişi kayıtları büyük olabilir

/* ---------------- erişim kontrolü ----------------
   Token yalnızca X-TSS-Token header'ında taşınır; URL query string'inde
   ASLA kabul edilmez (tarayıcı geçmişi/sunucu logları/referrer sızıntısı). */
app.use('/api', function (req, res, next) {
  if (!APP_TOKEN) return next();   // token tanımlanmamışsa (tek makinede geliştirme) kapı açık
  var provided = String(req.get('X-TSS-Token') || '').trim();
  if (provided && provided === APP_TOKEN) return next();
  res.status(401).json({ error: 'Geçersiz veya eksik erişim anahtarı (X-TSS-Token).' });
});

/* ---------------- yardımcılar ---------------- */

function handle(res, fn) {
  try {
    var result = fn();
    if (result === null) return res.status(404).json({ error: 'Kayıt bulunamadı.' });
    res.json(result);
  } catch (err) {
    var status = err && err.status ? err.status : 500;
    if (status === 500) console.error('[TSS]', err);
    res.status(status).json({ error: (err && err.message) || 'Sunucu hatası.' });
  }
}

/* ---------------- durum / bootstrap ---------------- */

// Token doğru mu diye ucuz bir kontrol noktası (frontend ilk açılışta kullanır)
app.get('/api/ping', function (req, res) {
  res.json({ ok: true, tokenRequired: !!APP_TOKEN });
});

app.get('/api/bootstrap', function (req, res) {
  handle(res, function () {
    var data = store.bootstrap();
    // Anahtar sunucuda (.env) tanımlıysa tarayıcıya GÖNDERİLMEZ — panel
    // yalnızca "yapılandırılmış mı" bilgisini alır ve istekleri proxy
    // üzerinden yapar (bkz. server/tomtom.js, js/tomtom.js).
    data.tomtomKeySource = tomtom.keySource();
    if (data.tomtomKeySource === 'server') data.tomtomApiKey = '';
    return data;
  });
});

/* ---------------- TomTom proxy (anahtar tarayıcıya inmez) ---------------- */

app.post('/api/tomtom/route-leg', function (req, res) {
  var body = req.body || {};
  tomtom.routeLeg(body.origin, body.destination).then(function (leg) {
    res.json(leg);
  }, function (err) {
    var status = err && err.status ? err.status : 502;
    res.status(status).json({ error: (err && err.message) || 'TomTom isteği başarısız.' });
  });
});

// Rota üzerindeki olaylar (kaza/kapalı yol/çalışma). Gövde rota geometrisini
// taşır; filtreleme sunucuda yapılır, böylece kutudan dönen yüzlerce olay
// tarayıcıya hiç inmez (bkz. server/tomtom.js).
app.post('/api/tomtom/incidents', function (req, res) {
  var body = req.body || {};
  tomtom.incidentsOnRoute(body.route, body.thresholdMeters).then(function (result) {
    res.json(result);
  }, function (err) {
    var status = err && err.status ? err.status : 502;
    res.status(status).json({ error: (err && err.message) || 'Olay sorgusu başarısız.' });
  });
});

/* ---------------- Yakıt fiyatı (CORS'suz, sunucu tarafından) ---------------- */

app.get('/api/fuel-price', function (req, res) {
  fuelprice.getNational().then(function (data) {
    if (!data) return res.status(503).json({ error: 'Yakıt fiyatı şu an alınamıyor.' });
    res.json(data);
  });
});

/* ---------------- lokasyonlar ---------------- */

app.post('/api/locations', function (req, res) {
  handle(res, function () { return store.addLocation(req.body); });
});

app.put('/api/locations/:id', function (req, res) {
  handle(res, function () { return store.updateLocation(req.params.id, req.body); });
});

app.delete('/api/locations/:id', function (req, res) {
  handle(res, function () { store.removeLocation(req.params.id); return { ok: true }; });
});

/* ---------------- araçlar ---------------- */

app.post('/api/vehicles', function (req, res) {
  handle(res, function () { return store.addVehicle(req.body); });
});

app.put('/api/vehicles/:id', function (req, res) {
  handle(res, function () { return store.updateVehicle(req.params.id, req.body); });
});

app.patch('/api/vehicles/:id/usable', function (req, res) {
  handle(res, function () { return store.setUsableCapacity(req.params.id, req.body && req.body.usable); });
});

app.delete('/api/vehicles/:id', function (req, res) {
  handle(res, function () { store.removeVehicle(req.params.id); return { ok: true }; });
});

/* ---------------- sefer geçmişi ---------------- */

app.post('/api/trips', function (req, res) {
  handle(res, function () { return store.addTrip(req.body); });
});

app.delete('/api/trips/:id', function (req, res) {
  handle(res, function () { store.removeTrip(req.params.id); return { ok: true }; });
});

/* ---------------- ayarlar ---------------- */

app.patch('/api/settings/traffic', function (req, res) {
  handle(res, function () { return store.updateTraffic(req.body); });
});

app.patch('/api/settings/fuel', function (req, res) {
  handle(res, function () { return store.updateFuel(req.body); });
});

app.patch('/api/settings/tomtom-key', function (req, res) {
  handle(res, function () { return { tomtomApiKey: store.setTomTomApiKey(req.body && req.body.tomtomApiKey) }; });
});

/* ---------------- statik frontend ----------------
   Tarayıcıya giden her şey public/ altında toplanmıştır
   (index.html, styles.css, js/, vendor/, assets/). */
var PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

/* ---------------- başlat ---------------- */

if (require.main === module) {
  var seeded = store.seedIfEmpty();
  if (seeded.locations || seeded.vehicles) {
    console.log('[TSS] Boş veritabanı tohumlandı: ' +
      seeded.locations + ' lokasyon, ' + seeded.vehicles + ' araç (public/js/data.js varsayılanları).');
  }
  app.listen(PORT, HOST, function () {
    console.log('[TSS] Backend hazır: http://localhost:' + PORT + '  (bind: ' + HOST + ':' + PORT + ')');
    console.log('[TSS] Veritabanı: ' + d.DB_PATH);
    console.log('[TSS] Erişim anahtarı: ' + (APP_TOKEN ? 'AÇIK (X-TSS-Token gerekli)' : 'KAPALI (APP_TOKEN tanımlı değil)'));
  });
}

module.exports = app;
