const fs = require('fs');
const assert = require('assert');
const path = require('path');

// 1. Setup global window for data.js
global.window = global;
global.localStorage = {
  getItem: () => null,
  setItem: () => {}
};

// Load data.js
const dataJsPath = path.resolve(__dirname, '../public/js/data.js');
const dataJsCode = fs.readFileSync(dataJsPath, 'utf8');
eval(dataJsCode);

const TSSData = global.window.TSSData;

// Setup store.js
process.env.TSS_DB_PATH = ':memory:';
const store = require('../server/store.js');

let report = [];
function log(msg) {
  console.log(msg);
  report.push(msg);
}

function runTest(name, testFn) {
  try {
    testFn();
    log(`✅ [PASS] ${name}`);
  } catch (err) {
    log(`❌ [FAIL] ${name}\n   Hata: ${err.message}`);
  }
}

// ----------------------------------------------------
// 1. data.js + store.js Validation Parallel Tests
// ----------------------------------------------------

function expectThrow(fn, errMsgMatcher) {
  let thrown = false;
  try {
    fn();
  } catch (err) {
    thrown = true;
  }
  if (!thrown) throw new Error("Expected to throw but it succeeded.");
}

runTest("1. Paralel Doğrulama: Boş isim reddedilmeli (Location)", () => {
  expectThrow(() => TSSData.addLocation({ lat: 40, lng: 29 }), "data.js didn't throw");
  expectThrow(() => store.addLocation({ lat: 40, lng: 29 }), "store.js didn't throw");
});

runTest("1. Paralel Doğrulama: Geçersiz enlem reddedilmeli (Location)", () => {
  expectThrow(() => TSSData.addLocation({ name: 'A', lat: 999, lng: 29 }), "data.js didn't throw on 999 lat");
  expectThrow(() => store.addLocation({ name: 'A', lat: 999, lng: 29 }), "store.js didn't throw on 999 lat");
});

runTest("1. Paralel Doğrulama: Geçersiz kapasite reddedilmeli (Vehicle)", () => {
  expectThrow(() => TSSData.addVehicle({ plate: '34ABC', capacity: 0 }), "data.js didn't throw on 0 cap");
  expectThrow(() => store.addVehicle({ plate: '34ABC', capacity: 0 }), "store.js didn't throw on 0 cap");
  
  expectThrow(() => TSSData.addVehicle({ plate: '34ABC', capacity: -1 }), "data.js didn't throw on -1 cap");
  expectThrow(() => store.addVehicle({ plate: '34ABC', capacity: -1 }), "store.js didn't throw on -1 cap");
  
  expectThrow(() => TSSData.addVehicle({ plate: '34ABC', capacity: 'abc' }), "data.js didn't throw on 'abc' cap");
  expectThrow(() => store.addVehicle({ plate: '34ABC', capacity: 'abc' }), "store.js didn't throw on 'abc' cap");
});

runTest("1. Paralel Doğrulama: fuelConsumption boşsa 7'ye düşmeli", () => {
  let vData = TSSData.addVehicle({ plate: '34ABC', capacity: 5 });
  assert.strictEqual(vData.fuelConsumption, 7, "data.js didn't default fuelConsumption to 7");
  
  let vStore = store.addVehicle({ plate: '35ABC', capacity: 5 });
  assert.strictEqual(vStore.fuelConsumption, 7, "store.js didn't default fuelConsumption to 7");
});

runTest("1. Paralel Doğrulama: Geçerli veri kabul edilmeli", () => {
  let vData = TSSData.addLocation({ name: 'Valid Data', lat: 41, lng: 29 });
  assert.ok(vData.id, "data.js didn't return id for valid location");
  
  let vStore = store.addLocation({ name: 'Valid Store', lat: 41, lng: 29 });
  assert.ok(vStore.id, "store.js didn't return id for valid location");
});

// ----------------------------------------------------
// 2. parseExcelTime Tests (data.js internal fn exported implicitly if possible or tested via importLocationRows)
// We can't access parseExcelTime directly since it's inside closure, but we can test it via importLocationRows.
// ----------------------------------------------------

runTest("2. parseExcelTime Testleri (importLocationRows üzerinden)", () => {
  const result1 = TSSData.importLocationRows([
    { name: 'T1', lat: 40, lng: 29, from: 0.3333, until: 0.75 },
    { name: 'T2', lat: 40, lng: 29, from: 0, until: 1.0 },
    { name: 'T3', lat: 40, lng: 29, from: '8:00 AM', until: '3:30 PM' },
    { name: 'T4', lat: 40, lng: 29, from: '12:00 AM', until: '12:00 PM' },
    { name: 'T5', lat: 40, lng: 29, from: '08:00', until: '23:59' },
    { name: 'T6', lat: 40, lng: 29, from: '8:00:30', until: 'null' },
    { name: 'T7', lat: 40, lng: 29, from: 'abc', until: 25 }
  ]);
  
  assert.strictEqual(result1.added, 7);
  
  const locs = window.TSSData.bootstrap().locations;
  const t1 = locs.find(l => l.name === 'T1');
  assert.strictEqual(t1.from, '08:00');
  assert.strictEqual(t1.until, '18:00');
  
  const t2 = locs.find(l => l.name === 'T2');
  assert.strictEqual(t2.from, '00:00');
  assert.strictEqual(t2.until, '00:00');

  const t3 = locs.find(l => l.name === 'T3');
  assert.strictEqual(t3.from, '08:00');
  assert.strictEqual(t3.until, '15:30');

  const t4 = locs.find(l => l.name === 'T4');
  assert.strictEqual(t4.from, '00:00');
  assert.strictEqual(t4.until, '12:00');

  const t5 = locs.find(l => l.name === 'T5');
  assert.strictEqual(t5.from, '08:00');
  assert.strictEqual(t5.until, '23:59');

  const t6 = locs.find(l => l.name === 'T6');
  assert.strictEqual(t6.from, '08:00'); // '8:00:30' fallback is parsed to 08:00 if plain regex hits
  assert.strictEqual(t6.until, '23:59'); // null fallback to 23:59

  const t7 = locs.find(l => l.name === 'T7');
  assert.strictEqual(t7.from, '00:00'); // 'abc' fallback to '00:00'
  assert.strictEqual(t7.until, '23:59'); // 25 fallback to '23:59'
});

// ----------------------------------------------------
// 3. normalizeKey Testleri & 4. importLocationRows / importVehicleRows
// ----------------------------------------------------

runTest("3 & 4. normalizeKey ve importRows (Türkçe karakter ve virgüllü veri)", () => {
  const locRows = [
    { LOKASYONADI: 'İSTANBUL', ENLEM: '41,25', BOYLAM: '28,5' },
    { Şişli: 'skip', eksik: 'row' } // should be skipped
  ];
  const locRes = TSSData.importLocationRows(locRows);
  assert.strictEqual(locRes.added, 1);
  assert.strictEqual(locRes.skipped, 1);
  
  const locs = window.TSSData.bootstrap().locations;
  const ist = locs.find(l => l.name === 'İSTANBUL');
  assert.strictEqual(ist.lat, 41.25);
  assert.strictEqual(ist.lng, 28.5);

  const vehRows = [
    { ARAÇPLAKASI: '34ÇŞĞİÜÖ', KAPASİTE: '10' }
  ];
  const vehRes = TSSData.importVehicleRows(vehRows);
  assert.strictEqual(vehRes.added, 1);
  
  const vehs = window.TSSData.bootstrap().vehicles;
  const veh = vehs.find(v => v.plate === '34ÇŞĞİÜÖ');
  assert.ok(veh, "Türkçe başlıklı araç import edilemedi");
});

// ----------------------------------------------------
// 5. Durak (Stop) İşlemleri
// ----------------------------------------------------

runTest("5. Durak İşlemleri: addStop, updateStopPallets (clamp to 1) ve removeStop", () => {
  TSSData.clearStops();
  const s1 = TSSData.addStop('loc-1', 'pickup', 0);
  assert.strictEqual(s1.pallets, 1, "0 pallet should be clamped to 1");
  
  const s2 = TSSData.addStop('loc-2', 'pickup', -5);
  assert.strictEqual(s2.pallets, 1, "-5 pallet should be clamped to 1");

  const s3 = TSSData.addStop('loc-3', 'delivery', 3);
  
  const updated = TSSData.updateStopPallets(s3.id, 0);
  assert.strictEqual(updated.pallets, 1, "update to 0 should clamp to 1");
  
  assert.strictEqual(TSSData.totalPickups(), 2, "totalPickups should be 2");
  assert.strictEqual(TSSData.totalDeliveries(), 1, "totalDeliveries should be 1");
  
  TSSData.removeStop(s1.id);
  assert.strictEqual(TSSData.totalPickups(), 1, "after remove, totalPickups should be 1");
  
  TSSData.clearStops();
  assert.strictEqual(TSSData.totalPickups(), 0);
  assert.strictEqual(TSSData.totalDeliveries(), 0);
});

// ----------------------------------------------------
// 6. totalFleetCapacity
// ----------------------------------------------------

runTest("6. totalFleetCapacity Testi", () => {
  // Clear vehicles and add specific ones
  window.TSSData.bootstrap().vehicles.forEach(v => TSSData.removeVehicle(v.id));
  
  const v1 = TSSData.addVehicle({ plate: 'P1', capacity: 10 });
  const v2 = TSSData.addVehicle({ plate: 'P2', capacity: 5 });
  
  assert.strictEqual(TSSData.totalFleetCapacity(), 15, "total should be 15 initially");
  
  TSSData.setUsableCapacity(v1.id, 0); // Should clamp to 1
  assert.strictEqual(TSSData.totalFleetCapacity(), 6, "total should be 6 after setting v1 to 0 (clamped to 1)");
});

fs.writeFileSync(path.resolve(__dirname, 'test-report.txt'), report.join('\n'));
console.log("TESTS COMPLETED.");
