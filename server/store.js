/* =========================================================
   store.js — CRUD işlemleri + doğrulama
   =========================================================
   Doğrulama kuralları js/data.js'teki addLocation/addVehicle/
   updateLocation/updateVehicle ile BİREBİR aynı olmalı: frontend
   iyimser (optimistic) güncelleme yaptığı için, client'ın kabul
   ettiği bir kaydı sunucunun reddetmesi kullanıcıya "kaydedilmedi"
   uyarısı olarak döner. İki taraf aynı kuralı uygularsa bu durum
   yalnızca gerçekten bozuk veride oluşur.
   ========================================================= */
'use strict';

var d = require('./db');
var defaults = require('./defaults');

var db = d.db;

function ValidationError(message) {
  var err = new Error(message);
  err.status = 400;
  return err;
}

function uid(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 9);
}

/* ---------------- lokasyonlar ---------------- */

function normalizeLocationInput(data) {
  var name = String((data && data.name) || '').trim();
  var lat = Number(data && data.lat);
  var lng = Number(data && data.lng);
  if (!name) throw ValidationError('Lokasyon adı gerekli.');
  if (!isFinite(lat) || lat < -90 || lat > 90) throw ValidationError('Geçersiz enlem.');
  if (!isFinite(lng) || lng < -180 || lng > 180) throw ValidationError('Geçersiz boylam.');
  return {
    name: name,
    lat: lat,
    lng: lng,
    from: String((data && data.from) || '00:00'),
    until: String((data && data.until) || '23:59')
  };
}

function addLocation(data) {
  var v = normalizeLocationInput(data);
  var id = (data && data.id) || uid('loc');
  var now = d.nowIso();
  db.prepare(
    'INSERT INTO locations (id, name, lat, lng, from_time, until_time, created_at, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, v.name, v.lat, v.lng, v.from, v.until, now, now);
  return getLocation(id);
}

function getLocation(id) {
  var row = db.prepare('SELECT * FROM locations WHERE id = ?').get(id);
  return row ? d.locationFromRow(row) : null;
}

// js/data.js:updateLocation ile aynı: sadece ad/erişim saatleri güncellenir,
// koordinatlar bilinçli olarak değiştirilemez.
function updateLocation(id, data) {
  var existing = getLocation(id);
  if (!existing) return null;
  var name = String((data && data.name) || '').trim();
  if (!name) throw ValidationError('Lokasyon adı gerekli.');
  db.prepare(
    'UPDATE locations SET name = ?, from_time = ?, until_time = ?, updated_at = ? WHERE id = ?'
  ).run(
    name,
    String((data && data.from) || existing.from),
    String((data && data.until) || existing.until),
    d.nowIso(),
    id
  );
  return getLocation(id);
}

function removeLocation(id) {
  db.prepare('DELETE FROM locations WHERE id = ?').run(id);
}

/* ---------------- araçlar ---------------- */

/* ---------- araç belge/işlem geçerlilikleri ----------
   Türkiye'de kullanımdaki bir araç için takip edilen tarihler. Hepsi
   OPSİYONEL: girilmemişse null kalır ve arayüzde "girilmemiş" görünür.
   Bunlar otomatik sorgulanamıyor — e-Devlet/TÜVTÜRK sorguları kişisel
   kimlik doğrulaması istiyor, halka açık bir API yok — bu yüzden elle
   girilip son kullanma tarihi takip ediliyor.
   Kural js/data.js ile BİREBİR aynı olmalı (bkz. CLAUDE.md). */
var VEHICLE_DATE_FIELDS = [
  'inspectionUntil',   // Muayene (TÜVTÜRK)
  'insuranceUntil',    // Zorunlu trafik sigortası (ZMSS)
  'kaskoUntil',        // Kasko
  'emissionUntil',     // Egzoz emisyon ölçümü
  'permitUntil',       // Yetki belgesi (K belgesi)
  'tachographUntil'    // Takograf kalibrasyonu
];

// "YYYY-MM-DD" bekler; boş/geçersiz olan null döner (girilmemiş sayılır)
function normalizeVehicleDate(value) {
  var text = String(value == null ? '' : value).trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw ValidationError('Tarih GG.AA.YYYY biçiminde olmalı.');
  }
  var parts = text.split('-');
  var y = Number(parts[0]), m = Number(parts[1]), day = Number(parts[2]);
  var dt = new Date(Date.UTC(y, m - 1, day));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== day) {
    throw ValidationError('Geçersiz tarih.');
  }
  return text;
}

function normalizeModelYear(value) {
  var text = String(value == null ? '' : value).trim();
  if (!text) return null;
  var year = Number(text);
  var current = new Date().getFullYear();
  if (!isFinite(year) || year < 1950 || year > current + 1) {
    throw ValidationError('Model yılı 1950 ile ' + (current + 1) + ' arasında olmalı.');
  }
  return Math.floor(year);
}

function normalizeChassisNo(value) {
  var text = String(value == null ? '' : value).trim().toUpperCase();
  if (!text) return null;
  if (text.length > 20) throw ValidationError('Şasi no en fazla 20 karakter olabilir.');
  return text;
}

function normalizeVehicleInput(data) {
  var plate = String((data && data.plate) || '').trim();
  var capacity = Math.floor(Number(data && data.capacity));
  if (!plate) throw ValidationError('Plaka gerekli.');
  if (!isFinite(capacity) || capacity < 1) throw ValidationError('Kapasite en az 1 olmalı.');
  var consumption = Number(data && data.fuelConsumption);
  if (!isFinite(consumption) || consumption <= 0) consumption = defaults.DEFAULT_FUEL_CONSUMPTION;
  var fuelType = (data && data.fuelType) === 'benzin' ? 'benzin' : 'dizel';
  var out = {
    plate: plate,
    model: String((data && data.model) || '').trim(),
    capacity: capacity,
    fuelConsumption: consumption,
    fuelType: fuelType,
    chassisNo: normalizeChassisNo(data && data.chassisNo),
    modelYear: normalizeModelYear(data && data.modelYear)
  };
  VEHICLE_DATE_FIELDS.forEach(function (f) {
    out[f] = normalizeVehicleDate(data && data[f]);
  });
  return out;
}

function addVehicle(data) {
  var v = normalizeVehicleInput(data);
  var id = (data && data.id) || uid('veh');
  var usable = Number(data && data.usable);
  if (!isFinite(usable) || usable < 1 || usable > v.capacity) usable = v.capacity;
  var now = d.nowIso();
  db.prepare(
    'INSERT INTO vehicles (id, plate, model, capacity, usable, fuel_consumption, fuel_type, ' +
    'inspection_until, insurance_until, kasko_until, emission_until, permit_until, ' +
    'tachograph_until, chassis_no, model_year, created_at, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, v.plate, v.model, v.capacity, usable, v.fuelConsumption, v.fuelType,
    v.inspectionUntil, v.insuranceUntil, v.kaskoUntil, v.emissionUntil, v.permitUntil,
    v.tachographUntil, v.chassisNo, v.modelYear, now, now);
  return getVehicle(id);
}

function getVehicle(id) {
  var row = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
  return row ? d.vehicleFromRow(row) : null;
}

function updateVehicle(id, data) {
  var existing = getVehicle(id);
  if (!existing) return null;
  var merged = {
    plate: data && data.plate !== undefined ? data.plate : existing.plate,
    model: data && data.model !== undefined ? data.model : existing.model,
    capacity: data && data.capacity !== undefined ? data.capacity : existing.capacity,
    fuelConsumption: data && data.fuelConsumption !== undefined ? data.fuelConsumption : existing.fuelConsumption,
    fuelType: data && data.fuelType !== undefined ? data.fuelType : existing.fuelType,
    chassisNo: data && data.chassisNo !== undefined ? data.chassisNo : existing.chassisNo,
    modelYear: data && data.modelYear !== undefined ? data.modelYear : existing.modelYear
  };
  // Gönderilmeyen belge alanı mevcut değerini korur (kısmi güncelleme)
  VEHICLE_DATE_FIELDS.forEach(function (f) {
    merged[f] = (data && data[f] !== undefined) ? data[f] : existing[f];
  });
  var v = normalizeVehicleInput(merged);
  // js/data.js ile aynı: kullanılabilir kapasite yeni kapasiteyi aşamaz
  var usable = Math.min(existing.usable, v.capacity);
  db.prepare(
    'UPDATE vehicles SET plate = ?, model = ?, capacity = ?, usable = ?, ' +
    'fuel_consumption = ?, fuel_type = ?, inspection_until = ?, insurance_until = ?, ' +
    'kasko_until = ?, emission_until = ?, permit_until = ?, tachograph_until = ?, ' +
    'chassis_no = ?, model_year = ?, updated_at = ? WHERE id = ?'
  ).run(v.plate, v.model, v.capacity, usable, v.fuelConsumption, v.fuelType,
    v.inspectionUntil, v.insuranceUntil, v.kaskoUntil, v.emissionUntil, v.permitUntil,
    v.tachographUntil, v.chassisNo, v.modelYear, d.nowIso(), id);
  return getVehicle(id);
}

function setUsableCapacity(id, value) {
  var existing = getVehicle(id);
  if (!existing) return null;
  var usable = Math.max(1, Math.min(Math.floor(Number(value)) || 1, existing.capacity));
  db.prepare('UPDATE vehicles SET usable = ?, updated_at = ? WHERE id = ?').run(usable, d.nowIso(), id);
  return getVehicle(id);
}

function removeVehicle(id) {
  db.prepare('DELETE FROM vehicles WHERE id = ?').run(id);
}

/* ---------------- sefer geçmişi ---------------- */

function addTrip(entry) {
  if (!entry || typeof entry !== 'object') throw ValidationError('Geçersiz sefer kaydı.');
  var id = entry.id || uid('trip');
  var now = d.nowIso();
  db.prepare(
    'INSERT INTO trips (id, approved_at, note, vehicles_json, vehicle_summary, start, departure, ' +
    'distance, duration, fuel_cost, stop_count, groups_json, created_at, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    Number(entry.approvedAt) || Date.now(),
    String(entry.note || ''),
    JSON.stringify(entry.vehicles || []),
    String(entry.vehicleSummary || ''),
    String(entry.start || ''),
    String(entry.departure || ''),
    String(entry.distance || ''),
    String(entry.duration || ''),
    entry.fuelCost === null || entry.fuelCost === undefined ? null : Number(entry.fuelCost),
    Number(entry.stopCount) || 0,
    JSON.stringify(entry.groups || []),
    now,
    now
  );
  var row = db.prepare('SELECT * FROM trips WHERE id = ?').get(id);
  return d.tripFromRow(row);
}

function removeTrip(id) {
  db.prepare('DELETE FROM trips WHERE id = ?').run(id);
}

/* ---------------- ayarlar ---------------- */

function getTraffic() { return d.getSetting('traffic', defaults.DEFAULT_TRAFFIC); }
function getFuel() { return d.getSetting('fuel', defaults.DEFAULT_FUEL_PRICE); }
function getTomTomApiKey() { return d.getSetting('tomtomApiKey', ''); }

function updateTraffic(patch) {
  var current = getTraffic();
  var next = Object.assign({}, current, patch || {});
  ['morning', 'evening', 'night'].forEach(function (band) {
    next[band] = Object.assign({}, current[band], (patch && patch[band]) || {});
  });
  return d.setSetting('traffic', next);
}

function updateFuel(patch) {
  var current = getFuel();
  var next = Object.assign({}, current, patch || {});
  ['dizelPrice', 'benzinPrice'].forEach(function (key) {
    var value = Number(next[key]);
    next[key] = isFinite(value) && value > 0 ? value : null;
  });
  return d.setSetting('fuel', next);
}

function setTomTomApiKey(key) {
  return d.setSetting('tomtomApiKey', String(key || '').trim());
}

/* ---------------- bootstrap + ilk tohumlama ---------------- */

function bootstrap() {
  return {
    locations: d.getLocations(),
    vehicles: d.getVehicles(),
    history: d.getTrips(),
    traffic: getTraffic(),
    fuel: getFuel(),
    tomtomApiKey: getTomTomApiKey()
  };
}

// Veritabanı ilk kez oluşturulduğunda, kullanıcı bugünkü davranışla aynı
// başlangıç listesini görsün diye js/data.js'teki varsayılanları tohumlar.
function seedIfEmpty() {
  var locCount = db.prepare('SELECT COUNT(*) AS n FROM locations').get().n;
  var vehCount = db.prepare('SELECT COUNT(*) AS n FROM vehicles').get().n;
  var seeded = { locations: 0, vehicles: 0 };

  if (locCount === 0) {
    defaults.DEFAULT_LOCATIONS.forEach(function (loc) { addLocation(loc); seeded.locations++; });
  }
  if (vehCount === 0) {
    defaults.DEFAULT_VEHICLES.forEach(function (veh) { addVehicle(veh); seeded.vehicles++; });
  }
  return seeded;
}

module.exports = {
  addLocation: addLocation,
  getLocation: getLocation,
  updateLocation: updateLocation,
  removeLocation: removeLocation,
  addVehicle: addVehicle,
  getVehicle: getVehicle,
  updateVehicle: updateVehicle,
  setUsableCapacity: setUsableCapacity,
  removeVehicle: removeVehicle,
  addTrip: addTrip,
  removeTrip: removeTrip,
  getTraffic: getTraffic,
  getFuel: getFuel,
  getTomTomApiKey: getTomTomApiKey,
  updateTraffic: updateTraffic,
  updateFuel: updateFuel,
  setTomTomApiKey: setTomTomApiKey,
  bootstrap: bootstrap,
  seedIfEmpty: seedIfEmpty
};
