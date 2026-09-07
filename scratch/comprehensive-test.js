const path = require('path');
const fs = require('fs');
const http = require('http');

// Setup environment for testing
const dbPath = path.join(__dirname, 'test-db-' + Date.now() + '.sqlite');
process.env.TSS_DB_PATH = dbPath;
process.env.PORT = '0';
process.env.APP_TOKEN = 'secret-token';

const app = require('../server/index.js');
const server = http.createServer(app);

let passCount = 0;
let failCount = 0;
const errors = [];

function assert(condition, message) {
    if (!condition) {
        failCount++;
        errors.push(message);
        console.error('FAIL:', message);
    } else {
        passCount++;
        console.log('PASS:', message);
    }
}

async function runTests() {
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const baseUrl = `http://localhost:${port}/api`;
    
    // Polyfill fetch for node versions that might need it, or use node built-in
    // Node 18+ has fetch.
    const _fetch = typeof fetch !== 'undefined' ? fetch : require('node-fetch');

    async function req(method, endpoint, body, token = 'secret-token', query = '') {
        const url = `${baseUrl}${endpoint}${query}`;
        const headers = { 'Content-Type': 'application/json' };
        if (token !== null) headers['X-TSS-Token'] = token;
        
        const options = { method, headers };
        if (body) options.body = JSON.stringify(body);
        
        const res = await _fetch(url, options);
        let resBody;
        try {
            resBody = await res.json();
        } catch(e) {
            resBody = null;
        }
        return { status: res.status, body: resBody };
    }

    console.log("=== TSS Backend Testleri Başlıyor ===");

    try {
        // 5. Bootstrap Tutarlılığı - Varsayılan tohumlama
        let bootRes = await req('GET', '/bootstrap');
        assert(bootRes.status === 200, 'Bootstrap isteği başarılı');
        assert(bootRes.body.locations.length === 6, 'Seed: Veritabanında başlangıçta 6 lokasyon var');
        assert(bootRes.body.vehicles.length === 4, 'Seed: Veritabanında başlangıçta 4 araç var');
        
        // 1. Edge Case Doğrulama
        // Lokasyon sınırları
        let locRes1 = await req('POST', '/locations', { name: 'Sınır Enlem/Boylam', lat: -90, lng: 180 });
        assert(locRes1.status === 200, 'Lokasyon: enlem -90 boylam 180 kabul edildi');
        
        let locRes2 = await req('POST', '/locations', { name: 'Geçersiz Sınır', lat: 91, lng: -181 });
        assert(locRes2.status === 400, 'Lokasyon: geçersiz sınırlar (91, -181) reddedildi');

        const longName = 'A'.repeat(1000);
        let locRes3 = await req('POST', '/locations', { name: longName, lat: 40, lng: 28 });
        assert(locRes3.status === 200, 'Lokasyon: Çok uzun isim (1000 karakter) kabul edildi');
        
        // Araç: kapasite tam sınırda
        let vehRes1 = await req('POST', '/vehicles', { plate: '11 AA 11', capacity: 1 });
        assert(vehRes1.status === 200, 'Araç: Kapasite sınırda (1) eklendi');
        
        let vehRes2 = await req('POST', '/vehicles', { plate: '22 BB 22', capacity: 99999 });
        assert(vehRes2.status === 200, 'Araç: Çok büyük kapasite (99999) eklendi');
        
        // Araç: fuelConsumption fallback
        let vehRes3 = await req('POST', '/vehicles', { plate: '33 CC 33', capacity: 5, fuelConsumption: -5, fuelType: 'elektrik' });
        assert(vehRes3.status === 200, 'Araç: Geçersiz yakıt tüketimi/tipi ile eklendi');
        assert(vehRes3.body.fuelConsumption === 7, 'Araç: Negatif fuelConsumption varsayılana (7) düştü');
        assert(vehRes3.body.fuelType === 'dizel', 'Araç: Geçersiz fuelType dizele düştü');

        // 2. Concurrent/Sequential İşlemler
        // Aynı ID ile iki lokasyon ekleme
        let loc1 = await req('POST', '/locations', { id: 'test-loc-1', name: 'Test 1', lat: 41, lng: 29 });
        assert(loc1.status === 200, 'Concurrent: Belirli ID ile lokasyon eklendi');
        
        let loc2 = await req('POST', '/locations', { id: 'test-loc-1', name: 'Test 2', lat: 41, lng: 29 });
        assert(loc2.status === 500 || loc2.status === 400, 'Concurrent: Aynı ID ile lokasyon ekleme reddedildi (UNIQUE constraint)');
        
        // Var olmayan ID güncelleme
        let loc4 = await req('PUT', '/locations/olmayan-id', { name: 'Yok' });
        assert(loc4.status === 404, 'Concurrent: Var olmayan ID ile güncelleme 404 döner');
        
        let loc5 = await req('DELETE', '/locations/olmayan-id');
        assert(loc5.status === 200, 'Concurrent: Var olmayan ID ile silme başarılı döner (SQLite ignore eder)');

        // Hızlı ardışık silme ekleme
        await Promise.all([
            req('POST', '/locations', { id: 'race-loc', name: 'Race 1', lat: 41, lng: 29 }),
            req('DELETE', '/locations/race-loc'),
            req('POST', '/locations', { id: 'race-loc2', name: 'Race 2', lat: 41, lng: 29 })
        ]);
        let bootRes2 = await req('GET', '/bootstrap');
        assert(bootRes2.status === 200, 'Concurrent: Hızlı ardışık işlemler sistemi kırmadı, bootstrap çalışıyor');
        
        // 3. Sefer Geçmişi Detayları
        let trip1 = await req('POST', '/trips', {
            id: 'trip-1',
            approvedAt: -500,
            note: 'Test',
            vehicles: [],
            vehicleSummary: '',
            start: '',
            departure: '',
            distance: '',
            duration: '',
            fuelCost: null,
            stopCount: 0,
            groups: []
        });
        assert(trip1.status === 200, 'Sefer: Boş groups dizisi ve null fuelCost ile sefer eklendi');
        assert(trip1.body.fuelCost === null, 'Sefer: fuelCost null olarak kaydedildi');
        assert(trip1.body.approvedAt === -500, 'Sefer: approvedAt negatif/sıfır kabul edildi');

        let veryLongJson = Array(50).fill({test: 'data', nested: { a: 1 }});
        let trip2 = await req('POST', '/trips', { id: 'trip-2', approvedAt: Date.now(), groups: veryLongJson });
        assert(trip2.status === 200, 'Sefer: Çok büyük groups_json (iç içe yapı) başarıyla kaydedildi');

        // 4. Ayarlar Derinliği
        let tRes1 = await req('PATCH', '/settings/traffic', { morning: { factor: -1.5 } });
        assert(tRes1.status === 200, 'Ayarlar: Negatif trafik factor patch atıldı');
        
        let fRes1 = await req('PATCH', '/settings/fuel', { dizelPrice: -10, benzinPrice: 0 });
        assert(fRes1.status === 200, 'Ayarlar: Yakıt fiyatı 0 ve negatif gönderildi');
        assert(fRes1.body.dizelPrice === null && fRes1.body.benzinPrice === null, 'Ayarlar: Geçersiz yakıt fiyatları null yapıldı');

        let tRes2 = await req('PATCH', '/settings/traffic', null);
        assert(tRes2.status === 200, 'Ayarlar: Boş/null trafik patch başarılı (çökmedi)');

        // 6. Token güvenliği
        let auth1 = await req('GET', '/bootstrap', null, null, '?token=secret-token');
        assert(auth1.status === 401, 'Güvenlik: URL query string üzerinden token kabul edilmedi');
        
        let auth2 = await req('GET', '/bootstrap', null, '');
        assert(auth2.status === 401, 'Güvenlik: Boş string token reddedildi');
        
        let auth3 = await req('GET', '/bootstrap', null, 'A'.repeat(1000));
        assert(auth3.status === 401, 'Güvenlik: Çok uzun/yanlış token reddedildi');

        console.log(`\n=== TEST SONUCU: ${passCount} GECEN, ${failCount} KALAN ===`);
        if (failCount > 0) {
            console.log('Hatalar:', errors);
        }
        
    } catch(err) {
        console.error('Test sırasında beklenmeyen hata:', err);
    } finally {
        server.close();
        try { fs.unlinkSync(dbPath); } catch(e) {}
    }
}

runTests();
