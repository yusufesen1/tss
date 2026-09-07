/* =========================================================
   db.js — SQLite bağlantısı ve şema
   =========================================================
   Şema, tarayıcıdaki js/data.js `state` şeklini birebir yansıtır
   (bkz. TEKNIK-DOKUMAN.md §5.1) — böylece frontend'in senkron
   TSSData sözleşmesi hiç değişmeden kalabiliyor.

   Not: sefer geçmişi (trips) kayıtları data.js'te zaten "hafif bir
   özet" olarak üretiliyor (tam plan/matris değil). Bu yüzden gruplar
   ve satırlar ilişkisel tablolara parçalanmıyor, JSON blob olarak
   saklanıyor — round-trip sadakati (aynı nesnenin aynen geri gelmesi)
   burada ilişkisel saflıktan daha değerli.

   Veritabanı dosyasına YALNIZCA bu backend süreci erişir; istemciler
   asla doğrudan .db dosyasına dokunmaz (bkz. plan: SQLite erişim kuralı).
   ========================================================= */
'use strict';

var path = require('path');
var fs = require('fs');
var Database = require('better-sqlite3');

var DB_PATH = process.env.TSS_DB_PATH || path.join(__dirname, 'data', 'tss.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

var db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');   // eşzamanlı okuma/yazma için
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS locations (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    lat         REAL NOT NULL,
    lng         REAL NOT NULL,
    from_time   TEXT NOT NULL DEFAULT '00:00',
    until_time  TEXT NOT NULL DEFAULT '23:59',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vehicles (
    id                TEXT PRIMARY KEY,
    plate             TEXT NOT NULL,
    model             TEXT NOT NULL DEFAULT '',
    capacity          INTEGER NOT NULL,
    usable            INTEGER NOT NULL,
    fuel_consumption  REAL,
    fuel_type         TEXT NOT NULL DEFAULT 'dizel',
    -- Türkiye'de kullanımdaki bir araç için takip edilen belge/işlem
    -- geçerlilikleri. Hepsi opsiyonel ("YYYY-MM-DD" ya da NULL) —
    -- bkz. server/store.js normalizeVehicleInput.
    inspection_until  TEXT,
    insurance_until   TEXT,
    kasko_until       TEXT,
    emission_until    TEXT,
    permit_until      TEXT,
    tachograph_until  TEXT,
    chassis_no        TEXT,
    model_year        INTEGER,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trips (
    id              TEXT PRIMARY KEY,
    approved_at     INTEGER NOT NULL,
    note            TEXT NOT NULL DEFAULT '',
    vehicles_json   TEXT NOT NULL DEFAULT '[]',
    vehicle_summary TEXT NOT NULL DEFAULT '',
    start           TEXT NOT NULL DEFAULT '',
    departure       TEXT NOT NULL DEFAULT '',
    distance        TEXT NOT NULL DEFAULT '',
    duration        TEXT NOT NULL DEFAULT '',
    fuel_cost       REAL,
    stop_count      INTEGER NOT NULL DEFAULT 0,
    groups_json     TEXT NOT NULL DEFAULT '[]',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_trips_approved_at ON trips (approved_at DESC);
`);

/* ---------- şema göçü ----------
   CREATE TABLE IF NOT EXISTS var olan bir tabloya yeni kolon eklemez.
   Bu yüzden sonradan eklenen kolonlar burada, veri kaybı olmadan
   tamamlanıyor. Yeni kolon eklerken listeye bir satır eklemek yeterli. */
function ensureColumns(table, columns) {
  var existing = db.prepare('PRAGMA table_info(' + table + ')').all()
    .map(function (c) { return c.name; });
  columns.forEach(function (col) {
    if (existing.indexOf(col.name) !== -1) return;
    db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + col.name + ' ' + col.type);
  });
}

ensureColumns('vehicles', [
  { name: 'inspection_until', type: 'TEXT' },
  { name: 'insurance_until',  type: 'TEXT' },
  { name: 'kasko_until',      type: 'TEXT' },
  { name: 'emission_until',   type: 'TEXT' },
  { name: 'permit_until',     type: 'TEXT' },
  { name: 'tachograph_until', type: 'TEXT' },
  { name: 'chassis_no',       type: 'TEXT' },
  { name: 'model_year',       type: 'INTEGER' }
]);

function nowIso() {
  return new Date().toISOString();
}

/* ---------- satır <-> frontend nesnesi dönüşümleri ----------
   Frontend'in beklediği alan adları (js/data.js state şekli) ile
   SQL kolon adları arasındaki tek çeviri noktası burası. */

function locationFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    from: row.from_time,
    until: row.until_time
  };
}

function vehicleFromRow(row) {
  return {
    id: row.id,
    plate: row.plate,
    model: row.model,
    capacity: row.capacity,
    usable: row.usable,
    fuelConsumption: row.fuel_consumption,
    fuelType: row.fuel_type,
    // Belge/işlem geçerlilikleri — girilmemişse null
    inspectionUntil: row.inspection_until || null,
    insuranceUntil: row.insurance_until || null,
    kaskoUntil: row.kasko_until || null,
    emissionUntil: row.emission_until || null,
    permitUntil: row.permit_until || null,
    tachographUntil: row.tachograph_until || null,
    chassisNo: row.chassis_no || null,
    modelYear: row.model_year != null ? row.model_year : null
  };
}

function tripFromRow(row) {
  return {
    id: row.id,
    approvedAt: row.approved_at,
    note: row.note,
    vehicles: JSON.parse(row.vehicles_json),
    vehicleSummary: row.vehicle_summary,
    start: row.start,
    departure: row.departure,
    distance: row.distance,
    duration: row.duration,
    fuelCost: row.fuel_cost,
    stopCount: row.stop_count,
    groups: JSON.parse(row.groups_json)
  };
}

/* ---------- okuma ---------- */

function getLocations() {
  return db.prepare('SELECT * FROM locations ORDER BY created_at ASC').all().map(locationFromRow);
}

function getVehicles() {
  return db.prepare('SELECT * FROM vehicles ORDER BY created_at ASC').all().map(vehicleFromRow);
}

// Geçmiş, frontend'te "en yeni en üstte" bekleniyor (data.js approveTrip → unshift)
function getTrips() {
  return db.prepare('SELECT * FROM trips ORDER BY approved_at DESC').all().map(tripFromRow);
}

function getSetting(key, fallback) {
  var row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch (e) {
    return fallback;
  }
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  ).run(key, JSON.stringify(value), nowIso());
  return value;
}

module.exports = {
  db: db,
  DB_PATH: DB_PATH,
  nowIso: nowIso,
  locationFromRow: locationFromRow,
  vehicleFromRow: vehicleFromRow,
  tripFromRow: tripFromRow,
  getLocations: getLocations,
  getVehicles: getVehicles,
  getTrips: getTrips,
  getSetting: getSetting,
  setSetting: setSetting
};
