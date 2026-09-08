/* =========================================================
   sync-test.js — js/data.js remote katmanının uçtan uca testi
   =========================================================
   GERÇEK js/data.js dosyasını (tarayıcı kodunu) Node içinde, sahte
   window/localStorage/navigator ile çalıştırıp gerçek backend'e karşı
   test eder. Test ettikleri:

     - senkron sözleşme korunuyor mu (fonksiyonlar hâlâ anında değer
       döndürüyor mu, Promise DÖNMÜYOR mu)
     - yazmalar arka planda sunucuya gidiyor mu
     - bağlantı yokken outbox'ta birikip, bağlantı gelince
       otomatik gönderiliyor mu
     - sunucudan gelen veri state'e uygulanıp onRemoteSync tetikleniyor mu
     - bekleyen yazma varken sunucu verisi yerel veriyi EZMİYOR mu
     - sunucu erişilemezken panel yerel önbellekle açılıyor mu

   Çalıştırma:  cd server && npm run sync-test
   ========================================================= */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');

var TMP_DB = path.join(os.tmpdir(), 'tss-synctest-' + Date.now() + '.db');
process.env.TSS_DB_PATH = TMP_DB;
process.env.APP_TOKEN = '';          // bu test erişim kontrolünü ayrıca test etmiyor
// bkz. smoke-test.js'teki aynı satır: gerçek server/.env'deki bir TomTom
// anahtarının require('../index') ile (dotenv) sızmasını önlüyor.
process.env.TOMTOM_API_KEY = '';

var app = require('../index');
var store = require('../store');

var passed = 0, failed = 0;

function check(name, condition, detail) {
  if (condition) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ---------- tarayıcı ortamı taklidi ---------- */

function makeLocalStorage() {
  var map = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem: function (k, v) { map[k] = String(v); },
    removeItem: function (k) { delete map[k]; },
    _dump: function () { return map; }
  };
}

// Ağı kesip açabilmek için fetch'i sarmalıyoruz
var online = true;
var realFetch = global.fetch;
var baseUrl = '';

function installBrowserGlobals() {
  global.window = global;
  global.localStorage = makeLocalStorage();
  // Node 22'de `navigator` yerleşik ve yalnızca getter — üzerine yazmak için
  // defineProperty gerekiyor.
  Object.defineProperty(global, 'navigator', {
    value: { onLine: true }, writable: true, configurable: true
  });
  global.location = { protocol: 'http:' };
  global.addEventListener = function () { /* 'online' dinleyicisi testte elle tetikleniyor */ };
  global.setTimeout = setTimeout;
  global.fetch = function (url, options) {
    if (!online) return Promise.reject(new Error('offline (test)'));
    var full = /^https?:/.test(url) ? url : baseUrl + url;
    return realFetch(full, options);
  };
}

function loadDataJs() {
  var src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'data.js'), 'utf8');
  // data.js bir IIFE: (function (global) { ... })(window)
  (0, eval)(src);
  return global.TSSData;
}

/* ---------- testler ---------- */

function run(D) {
  return Promise.resolve()
    .then(function () {
      console.log('\n— senkron sözleşme (en kritik) —');
      var loc = D.addLocation({ name: 'Senkron Test', lat: 41.1, lng: 29.1 });
      check('addLocation ANINDA nesne döndürüyor (Promise değil)',
        loc && loc.id && typeof loc.then !== 'function', typeof loc);
      check('yeni lokasyon aynı tick\'te state\'te görünüyor',
        D.state.locations.some(function (l) { return l.id === loc.id; }));
      check('getLocation senkron çalışıyor', D.getLocation(loc.id) === loc);

      var veh = D.addVehicle({ plate: '34 SYNC 01', capacity: 6 });
      check('addVehicle ANINDA nesne döndürüyor', veh && veh.id && typeof veh.then !== 'function');
      check('totalFleetCapacity senkron ve güncel', D.totalFleetCapacity() >= 6);
      return { loc: loc, veh: veh };
    })

    .then(function (ctx) {
      console.log('\n— arka planda sunucuya yazma —');
      return wait(400).then(function () {
        var onServer = store.bootstrap();
        check('lokasyon sunucuya ulaştı',
          onServer.locations.some(function (l) { return l.id === ctx.loc.id; }),
          'sunucudaki n=' + onServer.locations.length);
        check('araç sunucuya ulaştı',
          onServer.vehicles.some(function (v) { return v.id === ctx.veh.id; }));
        check('outbox boşaldı', D.pendingSyncCount() === 0, 'kalan=' + D.pendingSyncCount());
        return ctx;
      });
    })

    .then(function (ctx) {
      console.log('\n— bağlantı yokken kuyruğa alma —');
      online = false;
      var loc2 = D.addLocation({ name: 'Offline Lokasyon', lat: 41.2, lng: 29.2 });
      D.setUsableCapacity(ctx.veh.id, 3);
      check('offline\'da da UI anında güncelleniyor (senkron)',
        D.state.locations.some(function (l) { return l.id === loc2.id; }) &&
        D.getVehicle(ctx.veh.id).usable === 3);
      return wait(300).then(function () {
        check('bekleyen yazmalar outbox\'ta tutuluyor', D.pendingSyncCount() === 2,
          'kuyruk=' + D.pendingSyncCount());
        var onServer = store.bootstrap();
        check('offline yazma sunucuya GİTMEDİ',
          !onServer.locations.some(function (l) { return l.id === loc2.id; }));
        return { ctx: ctx, loc2: loc2 };
      });
    })

    .then(function (s) {
      console.log('\n— bekleyen yazma varken sunucu verisi yereli EZMEMELİ —');
      return D.syncFromRemote().then(function (ok) {
        check('outbox doluyken syncFromRemote veri çekmiyor', ok === false, 'ok=' + ok);
        check('offline eklenen lokasyon hâlâ ekranda',
          D.state.locations.some(function (l) { return l.id === s.loc2.id; }));
        return s;
      });
    })

    .then(function (s) {
      console.log('\n— bağlantı gelince otomatik gönderme —');
      online = true;
      return D.syncFromRemote().then(function () {
        return wait(400);
      }).then(function () {
        check('outbox boşaldı', D.pendingSyncCount() === 0, 'kalan=' + D.pendingSyncCount());
        var onServer = store.bootstrap();
        check('offline eklenen lokasyon sunucuya ulaştı',
          onServer.locations.some(function (l) { return l.id === s.loc2.id; }));
        var serverVeh = onServer.vehicles.filter(function (v) { return v.id === s.ctx.veh.id; })[0];
        check('offline yapılan kapasite değişikliği sunucuya ulaştı',
          serverVeh && serverVeh.usable === 3, 'usable=' + (serverVeh && serverVeh.usable));
        return s;
      });
    })

    .then(function (s) {
      console.log('\n— sunucudan tazeleme + onRemoteSync —');
      // Sunucuda, bu tarayıcının bilmediği bir kayıt oluştur (başka bir cihaz gibi)
      store.addLocation({ id: 'loc-other-device', name: 'Diğer Cihazdan', lat: 40.5, lng: 29.5 });
      var syncFired = 0;
      D.onRemoteSync(function () { syncFired++; });
      return D.syncFromRemote().then(function (ok) {
        check('syncFromRemote başarılı', ok === true);
        check('onRemoteSync callback tetiklendi', syncFired === 1, 'n=' + syncFired);
        check('başka cihazın eklediği lokasyon geldi',
          D.state.locations.some(function (l) { return l.id === 'loc-other-device'; }));
        check('localStorage önbelleği de tazelendi',
          (localStorage.getItem('tss-rota-panel-v1') || '').indexOf('loc-other-device') !== -1);
        return s;
      });
    })

    .then(function (s) {
      console.log('\n— silme ve sefer geçmişi —');
      D.removeLocation(s.loc2.id);
      check('silme anında yerelde etkili',
        !D.state.locations.some(function (l) { return l.id === s.loc2.id; }));
      return wait(400).then(function () {
        check('silme sunucuya ulaştı',
          !store.bootstrap().locations.some(function (l) { return l.id === s.loc2.id; }));
      });
    })

    .then(function () {
      console.log('\n— taslak duraklar backend\'e GİTMEMELİ —');
      var before = D.pendingSyncCount();
      var loc = D.state.locations[0];
      D.addStop(loc.id, 'pickup', 3);
      check('addStop kuyruğa hiçbir şey eklemiyor', D.pendingSyncCount() === before,
        'önce=' + before + ' sonra=' + D.pendingSyncCount());
      check('durak yalnızca bellekte', D.state.stops.length === 1);
      D.clearStops();
    })

    .then(function () {
      console.log('\n— TomTom anahtar kaynağı (hasTomTomKey) —');
      // Anahtar yokken
      return D.syncFromRemote().then(function () {
        check('anahtar yokken hasTomTomKey false', D.hasTomTomKey() === false);
        // Kullanıcının girdiği anahtar
        D.setTomTomApiKey('kullanici-anahtari');
        check('kullanıcı anahtarı girince true', D.hasTomTomKey() === true);
        check('getTomTomApiKey anahtarı döndürüyor', D.getTomTomApiKey() === 'kullanici-anahtari');
        return wait(300);
      }).then(function () {
        // Sunucu tarafı anahtar: tarayıcı anahtarı GÖREMEZ ama özellik açık olmalı
        process.env.TOMTOM_API_KEY = 'SUNUCU-ANAHTARI';
        return D.syncFromRemote();
      }).then(function () {
        check('sunucu anahtarı tarayıcıya inmiyor', D.getTomTomApiKey() === '',
          'gelen=' + JSON.stringify(D.getTomTomApiKey()));
        check('kaynak server olarak biliniyor', D.getTomTomKeySource() === 'server');
        check('hasTomTomKey yine de TRUE (özellik proxy ile çalışır)', D.hasTomTomKey() === true);
        delete process.env.TOMTOM_API_KEY;
        return D.syncFromRemote();
      });
    })

    .then(function () {
      console.log('\n— ayarlar —');
      D.updateTrafficSettings({ enabled: false, morning: { factor: 3.1 } });
      D.updateFuelPriceSettings({ dizelPrice: 91.5 });
      check('trafik ayarı anında yerelde', D.getTrafficSettings().enabled === false);
      check('yakıt fiyatı anında yerelde', D.getFuelPriceSettings().dizelPrice === 91.5);
      return wait(400).then(function () {
        var s = store.bootstrap();
        check('trafik ayarı sunucuda', s.traffic.enabled === false && s.traffic.morning.factor === 3.1);
        check('yakıt fiyatı sunucuda', s.fuel.dizelPrice === 91.5);
      });
    });
}

/* ---------- sunucuya ulaşılamıyorken açılış (dayanıklılık) ----------
   Backend artık asıl veri kaynağı, ama sunucu geçici olarak erişilemezse
   (kapalı, ağ kopuk) panel kilitlenmemeli: yerel önbellekten çizilmeli ve
   yapılan değişiklikler outbox'ta birikip bağlantı gelince gitmeli. */

function runWithServerDown() {
  console.log('\n— sunucu ERİŞİLEMEZKEN açılış (dayanıklılık) —');
  delete global.TSSData;

  // Önceki oturumdan kalmış bir önbellek taklidi (kullanıcı daha önce
  // paneli açmış, veriler localStorage'a yazılmış)
  var cached = makeLocalStorage();
  cached.setItem('tss-rota-panel-v1', JSON.stringify({
    locations: [{ id: 'loc-cache', name: 'Önbellekten Gelen', lat: 41, lng: 29, from: '00:00', until: '23:59' }],
    vehicles: [{ id: 'veh-cache', plate: '34 CACHE 01', model: '', capacity: 3, usable: 3, fuelConsumption: 7, fuelType: 'dizel' }],
    history: [], traffic: null, tomtomApiKey: '', fuel: null
  }));
  global.localStorage = cached;

  var attempted = 0;
  global.fetch = function () { attempted++; return Promise.reject(new Error('sunucu kapalı (test)')); };

  var src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'data.js'), 'utf8');
  (0, eval)(src);
  var D2 = global.TSSData;
  D2.load();

  check('önbellekteki lokasyon anında görünüyor',
    D2.state.locations.some(function (l) { return l.id === 'loc-cache'; }));
  check('önbellekteki araç anında görünüyor', D2.totalFleetCapacity() === 3);

  return D2.connectRemote().then(function (ok) {
    check('sunucu kapalıyken connectRemote false döner (panel yine açılır)', ok === false, 'ok=' + ok);
    check('bağlanma denendi', attempted > 0, 'deneme=' + attempted);
    check('önbellek verisi silinmedi',
      D2.state.locations.some(function (l) { return l.id === 'loc-cache'; }));

    var loc = D2.addLocation({ name: 'Sunucu Kapalıyken Eklendi', lat: 40, lng: 29 });
    check('sunucu kapalıyken de yazma senkron çalışıyor', !!(loc && loc.id));
    check('değişiklik outbox\'ta bekliyor', D2.pendingSyncCount() > 0,
      'kuyruk=' + D2.pendingSyncCount());
    check('yerel önbelleğe yazıldı',
      (cached.getItem('tss-rota-panel-v1') || '').indexOf('Sunucu Kapalıyken Eklendi') !== -1);
  });
}

/* ---------- çalıştır ---------- */

installBrowserGlobals();

var server = app.listen(0, '127.0.0.1', function () {
  baseUrl = 'http://127.0.0.1:' + server.address().port;
  store.seedIfEmpty();
  console.log('Sync test — geçici DB: ' + TMP_DB);

  var D = loadDataJs();
  D.load();

  D.configureRemote({ baseUrl: baseUrl, token: '' })
    .then(function () { return run(D); })
    .then(function () { return runWithServerDown(); })
    ['catch'](function (err) {
      failed++;
      console.error('\nBEKLENMEYEN HATA:', err);
    })
    .then(function () {
      console.log('\n────────────────────────────');
      console.log('Geçen: ' + passed + '   Kalan: ' + failed);
      server.close();
      try {
        require('../db').db.close();
        fs.unlinkSync(TMP_DB);
        ['-wal', '-shm'].forEach(function (sfx) {
          if (fs.existsSync(TMP_DB + sfx)) fs.unlinkSync(TMP_DB + sfx);
        });
      } catch (e) { /* temizlik önemsiz */ }
      process.exit(failed ? 1 : 0);
    });
});
