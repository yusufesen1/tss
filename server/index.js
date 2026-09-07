/* =========================================================
   index.js — TSS Rota Planlama Paneli backend'i (Express + SQLite)
   =========================================================
   Çalıştırma:  node server/index.js   (ya da: cd server && npm start)
   Sonra:       http://localhost:3000
   LAN'daki diğer cihazlar: http://<bu-makinenin-ip'si>:3000

   Statik dosyalar (index.html, js/, styles.css, vendor/) da buradan
   servis edilir — böylece frontend ile API aynı origin'de olur, CORS
   gerekmez.

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
  handle(res, function () { return store.bootstrap(); });
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
   Proje kökü (server/ klasörünün bir üstü) doğrudan servis edilir. */
var ROOT = path.join(__dirname, '..');
app.use(express.static(ROOT, { extensions: ['html'] }));

/* ---------------- başlat ---------------- */

if (require.main === module) {
  var seeded = store.seedIfEmpty();
  if (seeded.locations || seeded.vehicles) {
    console.log('[TSS] Boş veritabanı tohumlandı: ' +
      seeded.locations + ' lokasyon, ' + seeded.vehicles + ' araç (js/data.js varsayılanları).');
  }
  app.listen(PORT, HOST, function () {
    console.log('[TSS] Backend hazır: http://localhost:' + PORT + '  (bind: ' + HOST + ':' + PORT + ')');
    console.log('[TSS] Veritabanı: ' + d.DB_PATH);
    console.log('[TSS] Erişim anahtarı: ' + (APP_TOKEN ? 'AÇIK (X-TSS-Token gerekli)' : 'KAPALI (APP_TOKEN tanımlı değil)'));
  });
}

module.exports = app;
