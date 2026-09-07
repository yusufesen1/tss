/* =========================================================
   import-localstorage.js — mevcut tarayıcı verisini SQLite'a aktarır
   =========================================================
   Backend'e geçerken, bugüne kadar tarayıcıda biriken lokasyon/araç/
   sefer geçmişi/ayarlar kaybolmasın diye tek seferlik içe aktarma aracı.

   Kullanım:
     1) Paneli bugünkü haliyle aç, tarayıcı konsolunda çalıştır:
          copy(localStorage.getItem('tss-rota-panel-v1'))
        (ya da çıktıyı kopyala) ve bir dosyaya kaydet, ör. yedek.json
     2) node server/scripts/import-localstorage.js yedek.json

   Varsayılan davranış: veritabanında AYNI id'den varsa o kayıt atlanır
   (yeniden çalıştırmak güvenlidir, kopya oluşturmaz). --replace ile
   mevcut kayıtların üzerine yazılır.
   ========================================================= */
'use strict';

var fs = require('fs');
var path = require('path');

var d = require('../db');
var store = require('../store');

var args = process.argv.slice(2);
var replace = args.indexOf('--replace') !== -1;
var file = args.filter(function (a) { return a.indexOf('--') !== 0; })[0];

if (!file) {
  console.error('Kullanım: node server/scripts/import-localstorage.js <yedek.json> [--replace]');
  process.exit(1);
}

var raw;
try {
  raw = fs.readFileSync(path.resolve(file), 'utf8');
} catch (e) {
  console.error('Dosya okunamadı: ' + file + ' — ' + e.message);
  process.exit(1);
}

var data;
try {
  data = JSON.parse(raw);
  // localStorage değeri bazen tırnak içinde bir string olarak kopyalanır
  if (typeof data === 'string') data = JSON.parse(data);
} catch (e) {
  console.error('JSON parse edilemedi: ' + e.message);
  process.exit(1);
}

var db = d.db;
var stats = { locations: 0, vehicles: 0, trips: 0, settings: 0, skipped: 0 };

function exists(table, id) {
  return !!db.prepare('SELECT 1 FROM ' + table + ' WHERE id = ?').get(id);
}

(data.locations || []).forEach(function (loc) {
  if (loc && loc.id && exists('locations', loc.id)) {
    if (!replace) { stats.skipped++; return; }
    store.removeLocation(loc.id);
  }
  try { store.addLocation(loc); stats.locations++; }
  catch (e) { console.warn('Lokasyon atlandı (' + (loc && loc.name) + '): ' + e.message); stats.skipped++; }
});

(data.vehicles || []).forEach(function (veh) {
  if (veh && veh.id && exists('vehicles', veh.id)) {
    if (!replace) { stats.skipped++; return; }
    store.removeVehicle(veh.id);
  }
  try { store.addVehicle(veh); stats.vehicles++; }
  catch (e) { console.warn('Araç atlandı (' + (veh && veh.plate) + '): ' + e.message); stats.skipped++; }
});

(data.history || []).forEach(function (trip) {
  if (trip && trip.id && exists('trips', trip.id)) {
    if (!replace) { stats.skipped++; return; }
    store.removeTrip(trip.id);
  }
  try { store.addTrip(trip); stats.trips++; }
  catch (e) { console.warn('Sefer kaydı atlandı: ' + e.message); stats.skipped++; }
});

if (data.traffic) { store.updateTraffic(data.traffic); stats.settings++; }
if (data.fuel) { store.updateFuel(data.fuel); stats.settings++; }
if (data.tomtomApiKey) { store.setTomTomApiKey(data.tomtomApiKey); stats.settings++; }

console.log('İçe aktarma tamamlandı:');
console.log('  lokasyon : ' + stats.locations);
console.log('  araç     : ' + stats.vehicles);
console.log('  sefer    : ' + stats.trips);
console.log('  ayar     : ' + stats.settings);
console.log('  atlanan  : ' + stats.skipped + (replace ? '' : '  (--replace ile üzerine yazılabilir)'));
console.log('Veritabanı: ' + d.DB_PATH);
