/* =========================================================
   smoke-test.js — backend endpoint'lerinin uçtan uca doğrulaması
   =========================================================
   Frontend'e HİÇ dokunmadan, geçici bir veritabanı üzerinde tüm
   REST yüzeyini sırayla test eder (bkz. plan Faz 1).

   Çalıştırma:  cd server && npm run smoke
   Çıkış kodu:  0 = hepsi geçti, 1 = en az bir test başarısız.
   ========================================================= */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');

// Gerçek veritabanına dokunmamak için geçici bir dosya + token zorunlu
var TMP_DB = path.join(os.tmpdir(), 'tss-smoke-' + Date.now() + '.db');
process.env.TSS_DB_PATH = TMP_DB;
process.env.APP_TOKEN = 'smoke-test-token';

var app = require('../index');
var store = require('../store');

var passed = 0;
var failed = 0;
var baseUrl = '';

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log('  ✓ ' + name);
  } else {
    failed++;
    console.log('  ✗ ' + name + (detail ? '  → ' + detail : ''));
  }
}

function api(method, url, body, token) {
  var headers = { 'Content-Type': 'application/json' };
  var key = token === undefined ? process.env.APP_TOKEN : token;
  if (key) headers['X-TSS-Token'] = key;
  return fetch(baseUrl + url, {
    method: method,
    headers: headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }).then(function (res) {
    return res.text().then(function (text) {
      var json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { /* JSON değil */ }
      return { status: res.status, body: json, raw: text };
    });
  });
}

function run() {
  return Promise.resolve()
    .then(function () {
      console.log('\n— erişim kontrolü —');
      return api('GET', '/api/bootstrap', undefined, null).then(function (r) {
        check('token olmadan /api/bootstrap 401 döner', r.status === 401, 'status=' + r.status);
      });
    })
    .then(function () {
      return api('GET', '/api/bootstrap', undefined, 'yanlis-token').then(function (r) {
        check('yanlış token 401 döner', r.status === 401, 'status=' + r.status);
      });
    })
    .then(function () {
      return api('GET', '/api/ping').then(function (r) {
        check('/api/ping doğru token ile 200', r.status === 200 && r.body && r.body.ok === true);
        check('ping tokenRequired: true bildiriyor', r.body && r.body.tokenRequired === true);
      });
    })

    .then(function () {
      console.log('\n— bootstrap ve tohumlama —');
      return api('GET', '/api/bootstrap').then(function (r) {
        var b = r.body || {};
        check('bootstrap 200 döner', r.status === 200);
        check('6 varsayılan lokasyon tohumlandı', (b.locations || []).length === 6, 'n=' + (b.locations || []).length);
        check('4 varsayılan araç tohumlandı', (b.vehicles || []).length === 4, 'n=' + (b.vehicles || []).length);
        check('lokasyon şekli frontend ile aynı (from/until)',
          b.locations && b.locations[0] && b.locations[0].from === '00:00' && 'until' in b.locations[0]);
        check('araç şekli frontend ile aynı (fuelConsumption/fuelType)',
          b.vehicles && b.vehicles[0] && b.vehicles[0].fuelType === 'dizel' && b.vehicles[0].fuelConsumption === 7);
        check('traffic varsayılanı data.js ile aynı',
          b.traffic && b.traffic.enabled === true && b.traffic.morning.factor === 1.8 && b.traffic.night.factor === 1.0);
        check('fuel varsayılanı null/null', b.fuel && b.fuel.dizelPrice === null && b.fuel.benzinPrice === null);
        check('geçmiş boş başlar', (b.history || []).length === 0);
      });
    })

    .then(function () {
      console.log('\n— lokasyonlar —');
      return api('POST', '/api/locations', { name: 'Test Depo', lat: 41.0, lng: 29.0, from: '08:00', until: '18:00' })
        .then(function (r) {
          check('lokasyon eklenir', r.status === 200 && r.body && r.body.id, JSON.stringify(r.body));
          return r.body && r.body.id;
        });
    })
    .then(function (locId) {
      return api('PUT', '/api/locations/' + locId, { name: 'Test Depo 2', from: '09:00', until: '17:00' })
        .then(function (r) {
          check('lokasyon güncellenir', r.status === 200 && r.body && r.body.name === 'Test Depo 2');
          check('erişim saati güncellenir', r.body && r.body.from === '09:00' && r.body.until === '17:00');
          check('koordinat değişmez (data.js ile aynı kural)', r.body && r.body.lat === 41.0 && r.body.lng === 29.0);
          return locId;
        });
    })
    .then(function (locId) {
      return api('POST', '/api/locations', { name: '', lat: 41, lng: 29 }).then(function (r) {
        check('boş isim 400 ile reddedilir', r.status === 400, 'status=' + r.status);
        return locId;
      });
    })
    .then(function (locId) {
      return api('POST', '/api/locations', { name: 'Bozuk', lat: 999, lng: 29 }).then(function (r) {
        check('geçersiz enlem 400 ile reddedilir', r.status === 400, 'status=' + r.status);
        return locId;
      });
    })
    .then(function (locId) {
      return api('DELETE', '/api/locations/' + locId).then(function (r) {
        check('lokasyon silinir', r.status === 200);
        return api('GET', '/api/bootstrap').then(function (b) {
          check('silinen lokasyon bootstrap\'ta yok',
            !(b.body.locations || []).some(function (l) { return l.id === locId; }));
        });
      });
    })

    .then(function () {
      console.log('\n— araçlar —');
      return api('POST', '/api/vehicles', { plate: '34 TST 001', model: 'Test Van', capacity: 8, fuelConsumption: 9.5, fuelType: 'benzin' })
        .then(function (r) {
          check('araç eklenir', r.status === 200 && r.body && r.body.id);
          check('usable, kapasiteye eşit başlar', r.body && r.body.usable === 8, 'usable=' + (r.body && r.body.usable));
          check('yakıt tipi korunur', r.body && r.body.fuelType === 'benzin');
          return r.body && r.body.id;
        });
    })
    .then(function (vehId) {
      return api('PATCH', '/api/vehicles/' + vehId + '/usable', { usable: 3 }).then(function (r) {
        check('kullanılabilir kapasite değiştirilir', r.status === 200 && r.body && r.body.usable === 3);
        return vehId;
      });
    })
    .then(function (vehId) {
      return api('PATCH', '/api/vehicles/' + vehId + '/usable', { usable: 99 }).then(function (r) {
        check('usable kapasiteyi aşamaz (clamp)', r.body && r.body.usable === 8, 'usable=' + (r.body && r.body.usable));
        return vehId;
      });
    })
    .then(function (vehId) {
      return api('PUT', '/api/vehicles/' + vehId, { plate: '34 TST 002', model: 'Test Van', capacity: 4, fuelConsumption: 9.5, fuelType: 'benzin' })
        .then(function (r) {
          check('araç güncellenir', r.status === 200 && r.body && r.body.plate === '34 TST 002');
          check('kapasite düşünce usable de düşer', r.body && r.body.usable <= 4, 'usable=' + (r.body && r.body.usable));
          return vehId;
        });
    })
    .then(function (vehId) {
      return api('POST', '/api/vehicles', { plate: 'X', capacity: 0 }).then(function (r) {
        check('kapasite < 1 reddedilir', r.status === 400, 'status=' + r.status);
        return vehId;
      });
    })
    .then(function (vehId) {
      return api('DELETE', '/api/vehicles/' + vehId).then(function (r) {
        check('araç silinir', r.status === 200);
      });
    })

    .then(function () {
      console.log('\n— sefer geçmişi —');
      var trip = {
        id: 'trip-smoke-1',
        approvedAt: Date.now(),
        note: 'Smoke test seferi',
        vehicles: [{ id: 'veh-1', plate: '34 HER 841', model: 'Fiat Ducato' }],
        vehicleSummary: '34 HER 841',
        start: 'AHL Kargo Binası',
        departure: '08:00',
        distance: '93.6 km',
        duration: '3 sa 22 dk',
        fuelCost: 571.2,
        stopCount: 4,
        groups: [{ vehiclePlate: '34 HER 841', rows: [{ no: 1, location: 'AHL', action: 'Yükleme' }] }]
      };
      return api('POST', '/api/trips', trip).then(function (r) {
        check('sefer kaydedilir', r.status === 200 && r.body && r.body.id === 'trip-smoke-1');
        check('iç içe groups/rows JSON round-trip korunur',
          r.body && r.body.groups && r.body.groups[0].rows[0].location === 'AHL',
          JSON.stringify(r.body && r.body.groups));
        check('fuelCost sayı olarak korunur', r.body && r.body.fuelCost === 571.2);
        check('vehicles dizisi korunur', r.body && r.body.vehicles[0].plate === '34 HER 841');
      });
    })
    .then(function () {
      return api('GET', '/api/bootstrap').then(function (r) {
        check('sefer bootstrap geçmişinde görünür', (r.body.history || []).length === 1);
      });
    })
    .then(function () {
      return api('DELETE', '/api/trips/trip-smoke-1').then(function (r) {
        check('sefer silinir', r.status === 200);
      });
    })

    .then(function () {
      console.log('\n— ayarlar —');
      return api('PATCH', '/api/settings/traffic', { enabled: false, morning: { factor: 2.5 } }).then(function (r) {
        check('trafik ayarı güncellenir', r.status === 200 && r.body && r.body.enabled === false);
        check('kısmi patch diğer alanları korur (merge)',
          r.body && r.body.morning.factor === 2.5 && r.body.morning.start === '07:00' && r.body.evening.factor === 2.2,
          JSON.stringify(r.body && r.body.morning));
      });
    })
    .then(function () {
      return api('PATCH', '/api/settings/fuel', { dizelPrice: 87.14 }).then(function (r) {
        check('yakıt fiyatı override kaydedilir', r.status === 200 && r.body && r.body.dizelPrice === 87.14);
        check('girilmeyen fiyat null kalır', r.body && r.body.benzinPrice === null);
      });
    })
    .then(function () {
      return api('PATCH', '/api/settings/fuel', { dizelPrice: null }).then(function (r) {
        check('"otomatiği kullan" (null) çalışır', r.body && r.body.dizelPrice === null);
      });
    })
    .then(function () {
      return api('PATCH', '/api/settings/tomtom-key', { tomtomApiKey: '  abc123  ' }).then(function (r) {
        check('TomTom key trim\'lenerek kaydedilir', r.status === 200 && r.body && r.body.tomtomApiKey === 'abc123');
      });
    })
    .then(function () {
      return api('GET', '/api/bootstrap').then(function (r) {
        check('ayarlar bootstrap ile geri gelir',
          r.body.traffic.enabled === false && r.body.tomtomApiKey === 'abc123');
      });
    })

    .then(function () {
      console.log('\n— kalıcılık (yeniden okuma) —');
      var direct = store.bootstrap();
      check('store.bootstrap() ile HTTP sonucu tutarlı',
        direct.locations.length === 6 && direct.tomtomApiKey === 'abc123');
    })

    .then(function () {
      console.log('\n— statik dosya sunumu —');
      return fetch(baseUrl + '/index.html').then(function (res) {
        check('index.html aynı origin\'den servis edilir (CORS gereksiz)', res.status === 200, 'status=' + res.status);
        return res.text();
      }).then(function (html) {
        check('servis edilen HTML gerçek panel', html.indexOf('Rota Planlama Paneli') !== -1);
      });
    })
    .then(function () {
      return fetch(baseUrl + '/js/data.js').then(function (res) {
        check('js/data.js servis edilir', res.status === 200);
      });
    });
}

var server = app.listen(0, '127.0.0.1', function () {
  baseUrl = 'http://127.0.0.1:' + server.address().port;
  console.log('Smoke test — geçici DB: ' + TMP_DB);
  require('../store').seedIfEmpty();

  run()
    .catch(function (err) {
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
        ['-wal', '-shm'].forEach(function (suffix) {
          if (fs.existsSync(TMP_DB + suffix)) fs.unlinkSync(TMP_DB + suffix);
        });
      } catch (e) { /* temizlik başarısız olursa sorun değil */ }
      process.exit(failed ? 1 : 0);
    });
});
