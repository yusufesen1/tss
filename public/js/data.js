/* =========================================================
   data.js — veri modeli, varsayılan kayıtlar, kalıcılık
   ========================================================= */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'tss-rota-panel-v1';

  // --- Varsayılan lokasyonlar (toplantıda verilen koordinatlar) ---
  var DEFAULT_LOCATIONS = [
    { id: 'loc-1', name: 'AHL Kargo Binası',        lat: 40.980433, lng: 28.830220, from: '00:00', until: '23:59' },
    { id: 'loc-2', name: 'AHL Ulaştırma B Kapısı',  lat: 40.985336, lng: 28.818313, from: '00:00', until: '12:00' },
    { id: 'loc-3', name: 'İHL ASG Binası',          lat: 41.253611, lng: 28.714696, from: '00:00', until: '23:59' },
    { id: 'loc-4', name: 'İHL Smartist Kargo',      lat: 41.277568, lng: 28.718970, from: '00:00', until: '23:59' },
    { id: 'loc-5', name: 'ISL-2 Teknik A.Ş.',       lat: 40.987452, lng: 28.818704, from: '00:00', until: '23:59' },
    { id: 'loc-6', name: 'THY Genel Müdürlük',      lat: 40.982539, lng: 28.825014, from: '00:00', until: '23:59' }
  ];

  // fuelConsumption (L/100km): üreticinin karma çevrim (combined cycle)
  // ortalaması — gerçek filo verisi (yakıt fişi/depo kaydı) girilene kadar
  // kaba bir başlangıç noktası, araç bazında elle düzenlenebilir (bkz.
  // updateVehicle). Yüklü/şehir içi kullanımda bu rakamların üzerine
  // çıkılması normaldir, bkz. TEKNIK-DOKUMAN §10.4.
  var DEFAULT_FUEL_CONSUMPTION = 7; // hiç girilmemiş/bozuk bir kayıt için son çare varsayılan

  // --- Varsayılan araçlar (paylaşılan araç listesi) ---
  var DEFAULT_VEHICLES = [
    { id: 'veh-1', plate: '34 HER 841', model: 'Fiat Ducato',     capacity: 5, usable: 5, fuelConsumption: 7,   fuelType: 'dizel' },
    { id: 'veh-2', plate: '34 KVS 889', model: 'Fiat Ducato',     capacity: 5, usable: 5, fuelConsumption: 7,   fuelType: 'dizel' },
    { id: 'veh-3', plate: '34 GTS 710', model: 'Peugeot Partner', capacity: 1, usable: 1, fuelConsumption: 5.8, fuelType: 'dizel' },
    { id: 'veh-4', plate: '34 GTS 744', model: 'Peugeot Partner', capacity: 1, usable: 1, fuelConsumption: 5.8, fuelType: 'dizel' }
  ];

  // Gerçek trafik verisi yok (backend/API maliyeti nedeniyle) — gün içi zaman
  // dilimlerine göre sabit çarpanlarla kaba ama işe yarar bir tahmin.
  var DEFAULT_TRAFFIC = {
    enabled: true,
    applyRushHourOnWeekends: false,
    morning: { start: '07:00', end: '09:30', factor: 1.8 },
    evening: { start: '17:00', end: '19:30', factor: 2.2 },
    night:   { start: '23:00', end: '06:00', factor: 1.0 }
  };

  // Kullanıcının Trafik Ayarları > Yakıt bölümünden ELLE girdiği TL/L
  // fiyatı — boşsa (null) js/fuelprice.js'in otomatik çektiği (ya da hiçbir
  // şey çekemediyse) değer kullanılır, karar app.js'te verilir (bkz.
  // effectiveFuelPrice). data.js kasıtlı olarak dış servisten habersiz
  // kalıyor, sadece kullanıcının override'ını saklar.
  var DEFAULT_FUEL_PRICE = { dizelPrice: null, benzinPrice: null };

  var state = {
    locations: [],
    vehicles: [],
    stops: [],          // { id, locationId, type: 'pickup'|'delivery', pallets }
    plan: null,         // hesaplanan rota sonucu
    history: [],        // onaylanan seferlerin kalıcı kaydı
    traffic: null,       // trafik katsayısı ayarları (kalıcı)
    tomtomApiKey: '',    // "En Az Süre" modunda canlı trafik için. Anahtar sunucuda
                          // (server/.env) tanımlıysa burası BOŞ kalır ve özellik yine
                          // çalışır — doğru kontrol hasTomTomKey(), bkz. §10.3
    fuel: null            // { dizelPrice, benzinPrice } — elle girilmiş yakıt fiyatı override'ı
  };

  function uid(prefix) {
    return prefix + '-' + Math.random().toString(36).slice(2, 9);
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        locations: state.locations,
        vehicles: state.vehicles,
        history: state.history,
        traffic: state.traffic,
        tomtomApiKey: state.tomtomApiKey,
        fuel: state.fuel
      }));
    } catch (e) {
      /* localStorage kapalıysa sessizce geç: uygulama yine çalışır */
    }
  }

  function load() {
    var stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (e) { stored = null; }

    if (stored && Array.isArray(stored.locations) && stored.locations.length) {
      state.locations = stored.locations;
    } else {
      state.locations = DEFAULT_LOCATIONS.slice();
    }

    if (stored && Array.isArray(stored.vehicles) && stored.vehicles.length) {
      state.vehicles = stored.vehicles;
    } else {
      state.vehicles = DEFAULT_VEHICLES.slice();
    }
    // Geriye dönük uyumluluk: fuelConsumption/fuelType alanı sonradan
    // eklendi (id alanının §5.1'de anlatılan hikâyesiyle aynı durum) —
    // eski localStorage kayıtlarında bulunmayabilir, burada tamamlanır.
    state.vehicles.forEach(function (v) {
      var c = Number(v.fuelConsumption);
      if (!isFinite(c) || c <= 0) v.fuelConsumption = DEFAULT_FUEL_CONSUMPTION;
      if (v.fuelType !== 'benzin') v.fuelType = 'dizel';
    });

    state.history = (stored && Array.isArray(stored.history)) ? stored.history : [];

    state.traffic = (stored && stored.traffic) ? stored.traffic : JSON.parse(JSON.stringify(DEFAULT_TRAFFIC));

    state.tomtomApiKey = (stored && typeof stored.tomtomApiKey === 'string') ? stored.tomtomApiKey : '';

    state.fuel = (stored && stored.fuel) ? stored.fuel : JSON.parse(JSON.stringify(DEFAULT_FUEL_PRICE));
  }

  function resetToDefaults() {
    state.locations = DEFAULT_LOCATIONS.slice();
    state.vehicles = DEFAULT_VEHICLES.slice();
    save();
  }

  // --- Trafik katsayısı ayarları ---
  function getTrafficSettings() {
    return state.traffic;
  }

  function updateTrafficSettings(patch) {
    var t = state.traffic;
    if (patch.enabled !== undefined) t.enabled = !!patch.enabled;
    if (patch.applyRushHourOnWeekends !== undefined) t.applyRushHourOnWeekends = !!patch.applyRushHourOnWeekends;
    ['morning', 'evening', 'night'].forEach(function (key) {
      if (!patch[key]) return;
      if (patch[key].start) t[key].start = patch[key].start;
      if (patch[key].end) t[key].end = patch[key].end;
      if (patch[key].factor !== undefined) {
        var f = Number(patch[key].factor);
        t[key].factor = isFinite(f) && f > 0 ? f : t[key].factor;
      }
    });
    save();
    return t;
  }

  // --- TomTom API key ("En Az Süre" modu, canlı trafik) ---
  // Sadece bu tarayıcının localStorage'ında tutulur — koda hiçbir zaman
  // sabit yazılmaz, dışa aktarma (Excel/PDF/geçmiş) çıktılarına dahil edilmez.
  function getTomTomApiKey() {
    return state.tomtomApiKey || '';
  }

  // Anahtar sunucuda (server/.env) tanımlıysa tarayıcıya HİÇ inmez —
  // bu durumda getTomTomApiKey() boş döner ama özellik yine kullanılabilir
  // (istek backend proxy'si üzerinden gider). "Anahtar var mı?" sorusunun
  // doğru cevabı bu yüzden bu fonksiyondur, boş string kontrolü değil.
  function hasTomTomKey() {
    return !!(state.tomtomApiKey || tomtomKeySource === 'server');
  }

  function getTomTomKeySource() { return tomtomKeySource; }

  function setTomTomApiKey(key) {
    state.tomtomApiKey = String(key || '').trim();
    save();
  }

  // --- Yakıt fiyatı ayarları (elle override) ---
  // Otomatik çekilen (js/fuelprice.js) değerin ÜZERİNE yazmak isteyen
  // kullanıcı için: boş bırakılırsa (null) app.js otomatik/varsayılana
  // düşer, bkz. app.js → effectiveFuelPrice().
  function getFuelPriceSettings() {
    return state.fuel;
  }

  function updateFuelPriceSettings(patch) {
    function parsePrice(raw, current) {
      if (raw === undefined) return current;
      if (raw === '' || raw === null) return null; // elle temizlenmiş: otomatik değere dön
      var n = Number(raw);
      return (isFinite(n) && n > 0) ? n : current;
    }
    state.fuel.dizelPrice = parsePrice(patch.dizelPrice, state.fuel.dizelPrice);
    state.fuel.benzinPrice = parsePrice(patch.benzinPrice, state.fuel.benzinPrice);
    save();
    return state.fuel;
  }

  // --- Lokasyon işlemleri ---
  function addLocation(data) {
    var loc = {
      id: uid('loc'),
      name: String(data.name || '').trim(),
      lat: Number(data.lat),
      lng: Number(data.lng),
      from: data.from || '00:00',
      until: data.until || '23:59'
    };
    if (!loc.name) throw new Error('Lokasyon adı boş olamaz.');
    if (!isFinite(loc.lat) || !isFinite(loc.lng)) throw new Error('Enlem ve boylam sayısal olmalı.');
    if (loc.lat < -90 || loc.lat > 90 || loc.lng < -180 || loc.lng > 180) {
      throw new Error('Koordinat aralık dışında.');
    }
    state.locations.push(loc);
    save();
    return loc;
  }

  function removeLocation(id) {
    state.locations = state.locations.filter(function (l) { return l.id !== id; });
    state.stops = state.stops.filter(function (s) { return s.locationId !== id; });
    save();
  }

  // Sadece ad ve erişim saatlerini (from/until) günceller — koordinatlar
  // buradan değişmez (bkz. app.js renderLocationTable, "Düzenle" satırı).
  function updateLocation(id, data) {
    var loc = getLocation(id);
    if (!loc) return null;
    var name = String(data.name || '').trim();
    if (!name) throw new Error('Lokasyon adı boş olamaz.');
    loc.name = name;
    loc.from = data.from || '00:00';
    loc.until = data.until || '23:59';
    save();
    return loc;
  }

  function getLocation(id) {
    for (var i = 0; i < state.locations.length; i++) {
      if (state.locations[i].id === id) return state.locations[i];
    }
    return null;
  }

  // --- Araç işlemleri ---
  // fuelConsumption/fuelType boş ya da geçersiz gelirse sessizce varsayılana
  // düşer (kapasite gibi sert bir zorunluluk değil — kullanıcı istediğinde
  // Araçlar tablosundan "Düzenle" ile daha isabetli bir değere günceller).
  /* ---------- araç belge/işlem geçerlilikleri ----------
     Türkiye'de kullanımdaki bir araç için takip edilen tarihler; hepsi
     opsiyonel. Otomatik sorgulanamıyorlar (e-Devlet/TÜVTÜRK kişisel kimlik
     doğrulaması istiyor, halka açık API yok) — elle girilip son kullanma
     tarihi izleniyor.
     DİKKAT: buradaki kurallar server/store.js'tekilerle BİREBİR aynı olmak
     zorunda; ayrışırlarsa kullanıcı kaydı ekranda görür ama sunucu reddeder
     (bkz. CLAUDE.md, TEKNIK-DOKUMAN §15). */
  var VEHICLE_DATE_FIELDS = [
    'inspectionUntil',   // Muayene (TÜVTÜRK)
    'insuranceUntil',    // Zorunlu trafik sigortası (ZMSS)
    'kaskoUntil',        // Kasko
    'emissionUntil',     // Egzoz emisyon ölçümü
    'permitUntil',       // Yetki belgesi (K belgesi)
    'tachographUntil'    // Takograf kalibrasyonu
  ];

  function normalizeVehicleDate(value) {
    var text = String(value == null ? '' : value).trim();
    if (!text) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Tarih GG.AA.YYYY biçiminde olmalı.');
    var parts = text.split('-');
    var y = Number(parts[0]), m = Number(parts[1]), day = Number(parts[2]);
    var dt = new Date(Date.UTC(y, m - 1, day));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== day) {
      throw new Error('Geçersiz tarih.');
    }
    return text;
  }

  function normalizeModelYear(value) {
    var text = String(value == null ? '' : value).trim();
    if (!text) return null;
    var year = Number(text);
    var current = new Date().getFullYear();
    if (!isFinite(year) || year < 1950 || year > current + 1) {
      throw new Error('Model yılı 1950 ile ' + (current + 1) + ' arasında olmalı.');
    }
    return Math.floor(year);
  }

  function normalizeChassisNo(value) {
    var text = String(value == null ? '' : value).trim().toUpperCase();
    if (!text) return null;
    if (text.length > 20) throw new Error('Şasi no en fazla 20 karakter olabilir.');
    return text;
  }

  // Araç nesnesine belge alanlarını uygular (ekleme ve güncelleme ortak yolu).
  // patch'te bulunmayan alan DOKUNULMAZ — kısmi güncelleme desteklenir.
  function applyVehicleDocuments(veh, patch, isNew) {
    if (isNew || patch.chassisNo !== undefined) veh.chassisNo = normalizeChassisNo(patch.chassisNo);
    if (isNew || patch.modelYear !== undefined) veh.modelYear = normalizeModelYear(patch.modelYear);
    VEHICLE_DATE_FIELDS.forEach(function (f) {
      if (isNew || patch[f] !== undefined) veh[f] = normalizeVehicleDate(patch[f]);
    });
    return veh;
  }

  function normalizeFuelConsumption(raw) {
    var n = Number(raw);
    return (isFinite(n) && n > 0) ? n : DEFAULT_FUEL_CONSUMPTION;
  }

  function normalizeFuelType(raw) {
    return String(raw || '').trim().toLowerCase() === 'benzin' ? 'benzin' : 'dizel';
  }

  function addVehicle(data) {
    var cap = Number(data.capacity);
    if (!String(data.plate || '').trim()) throw new Error('Plaka boş olamaz.');
    if (!isFinite(cap) || cap < 1) throw new Error('Kapasite en az 1 palet olmalı.');
    var veh = {
      id: uid('veh'),
      plate: String(data.plate).trim().toUpperCase(),
      model: String(data.model || '').trim(),
      capacity: Math.floor(cap),
      usable: Math.floor(cap),
      fuelConsumption: normalizeFuelConsumption(data.fuelConsumption),
      fuelType: normalizeFuelType(data.fuelType)
    };
    applyVehicleDocuments(veh, data, true);
    state.vehicles.push(veh);
    save();
    return veh;
  }

  function removeVehicle(id) {
    state.vehicles = state.vehicles.filter(function (v) { return v.id !== id; });
    save();
  }

  function getVehicle(id) {
    for (var i = 0; i < state.vehicles.length; i++) {
      if (state.vehicles[i].id === id) return state.vehicles[i];
    }
    return null;
  }

  function setUsableCapacity(id, value) {
    var veh = getVehicle(id);
    if (!veh) return;
    var v = Math.max(1, Math.min(veh.capacity, Math.floor(Number(value) || 1)));
    veh.usable = v;
    save();
  }

  // KISMİ güncelleme destekler: gönderilmeyen alan mevcut değerini korur.
  // server/store.js'teki updateVehicle de böyle davranıyor — ikisi ayrışırsa
  // kullanıcı değişikliği ekranda görür ama sunucu reddeder (bkz. CLAUDE.md).
  // Bu, Araç Bilgileri modalının yalnızca belge alanlarını göndermesini
  // mümkün kılıyor.
  function updateVehicle(id, data) {
    var veh = getVehicle(id);
    if (!veh) return null;

    if (data.plate !== undefined) {
      if (!String(data.plate || '').trim()) throw new Error('Plaka boş olamaz.');
      veh.plate = String(data.plate).trim().toUpperCase();
    }
    if (data.capacity !== undefined) {
      var cap = Number(data.capacity);
      if (!isFinite(cap) || cap < 1) throw new Error('Kapasite en az 1 palet olmalı.');
      veh.capacity = Math.floor(cap);
    }
    if (data.model !== undefined) veh.model = String(data.model || '').trim();
    veh.usable = Math.max(1, Math.min(veh.capacity, veh.usable));
    if (data.fuelConsumption !== undefined) veh.fuelConsumption = normalizeFuelConsumption(data.fuelConsumption);
    if (data.fuelType !== undefined) veh.fuelType = normalizeFuelType(data.fuelType);
    applyVehicleDocuments(veh, data, false);
    save();
    return veh;
  }

  // --- Durak işlemleri ---
  function addStop(locationId, type, pallets) {
    var stop = {
      id: uid('stop'),
      locationId: locationId,
      type: type,
      pallets: Math.max(1, Math.floor(Number(pallets) || 1))
    };
    state.stops.push(stop);
    return stop;
  }

  function removeStop(id) {
    state.stops = state.stops.filter(function (s) { return s.id !== id; });
  }

  function updateStopPallets(id, pallets) {
    var stop = null;
    for (var i = 0; i < state.stops.length; i++) {
      if (state.stops[i].id === id) { stop = state.stops[i]; break; }
    }
    if (!stop) return null;
    stop.pallets = Math.max(1, Math.floor(Number(pallets) || 1));
    return stop;
  }

  function clearStops() {
    state.stops = [];
  }

  // Filonun toplam kullanılabilir kapasitesi — artık tek bir araç seçilip onun
  // kapasitesiyle sınırlanmıyoruz; sol paneldeki kapasite çubuğu ve otomatik
  // araç atama (js/fleet.js) bu toplamı baz alır.
  function totalFleetCapacity() {
    return state.vehicles.reduce(function (sum, v) { return sum + (v.usable || 0); }, 0);
  }

  // Planlanan yükleme toplamı (kapasite kontrolü için)
  function totalPickups() {
    return state.stops.reduce(function (sum, s) {
      return sum + (s.type === 'pickup' ? s.pallets : 0);
    }, 0);
  }

  function totalDeliveries() {
    return state.stops.reduce(function (sum, s) {
      return sum + (s.type === 'delivery' ? s.pallets : 0);
    }, 0);
  }

  // --- Sefer geçmişi ---
  // Onaylanan bir rotanın o anki halini kalıcı olarak (localStorage'a) kaydeder.
  // Canlı düzenlenebilir plan nesnesinin (matrix/nodes) tamamını değil, sadece
  // görüntüleme için gereken hafif bir özetini saklar.
  // plan.groups: birden fazla araç kullanıldıysa her biri kendi durak alt
  // kümesiyle ayrı bir kayıt; tek araç yeterliyse zaten tek elemanlı dizi.
  function approveTrip(plan) {
    var groups = plan.groups.map(function (g) {
      return {
        vehiclePlate: g.vehicle.plate,
        vehicleModel: g.vehicle.model || '',
        distance: g.meta.distance,
        duration: g.meta.duration,
        // g.meta.fuelCostValue app.js → buildGroupMeta()'da hesaplanır (bu
        // dosya dış fiyat/tüketim mantığından habersiz kalır, sadece onay
        // anındaki hazır rakamı geçmişe anlık görüntü olarak kaydeder —
        // fiyat sonradan değişse bile geçmişteki sefer o günkü tahminiyle kalır).
        fuelCost: (g.meta && typeof g.meta.fuelCostValue === 'number') ? g.meta.fuelCostValue : null,
        stopCount: g.tableRows.filter(function (r) {
          return r.kind === 'pickup' || r.kind === 'delivery';
        }).length,
        rows: g.tableRows.map(function (r) {
          return {
            no: r.no, location: r.location, action: r.action,
            pallets: r.pallets, arrival: r.arrival, departure: r.departure, warn: r.warn
          };
        })
      };
    });

    var totalDistanceMeters = plan.groups.reduce(function (sum, g) { return sum + g.result.distance; }, 0);
    var latestFinishSec = Math.max.apply(null, plan.groups.map(function (g) { return g.result.finishSec; }));
    var departureSec = Opt().timeToSeconds(plan.groups[0].meta.departure);

    // En az bir grup için fiyat bilinmiyorsa (kullanıcı hiç TL/L girmemiş ve
    // otomatik değer de gelmemişse) toplam eksik/yanıltıcı olur — bu yüzden
    // "bilinmiyor" durumunu ayrıca işaretliyoruz (bkz. formatDuration üstü).
    var anyFuelCostMissing = plan.groups.some(function (g) { return !g.meta || typeof g.meta.fuelCostValue !== 'number'; });
    var totalFuelCost = plan.groups.reduce(function (sum, g) {
      return sum + ((g.meta && typeof g.meta.fuelCostValue === 'number') ? g.meta.fuelCostValue : 0);
    }, 0);

    var entry = {
      id: uid('trip'),
      approvedAt: Date.now(),
      note: plan.note || '',
      // id burada tutuluyor ki js/fleet.js sonraki bir planlamada "en son bu araç
      // kullanılmıştı" bilgisini sefer geçmişinden (plaka değil, kimlikten) güvenilir
      // şekilde okuyup rotasyon kararında kullanabilsin.
      vehicles: plan.groups.map(function (g) { return { id: g.vehicle.id, plate: g.vehicle.plate, model: g.vehicle.model || '' }; }),
      vehicleSummary: plan.groups.map(function (g) { return g.vehicle.plate; }).join(', '),
      start: plan.startLocation.name,
      departure: plan.groups[0].meta.departure,
      distance: (totalDistanceMeters / 1000).toFixed(1) + ' km',
      duration: formatDuration(latestFinishSec - departureSec),
      fuelCost: anyFuelCostMissing && totalFuelCost === 0 ? null : totalFuelCost,
      stopCount: groups.reduce(function (sum, g) { return sum + g.stopCount; }, 0),
      groups: groups
    };
    state.history.unshift(entry);
    save();
    return entry;
  }

  // approveTrip yalnızca dakika cinsinden bir süre etiketi üretmek için
  // TSSOptimizer.secondsToTime yerine kendi kısa yardımcısını kullanıyor
  // (js/optimizer.js'e bağımlılığı artırmamak için burada minik bir kopya).
  function formatDuration(seconds) {
    var m = Math.max(0, Math.round(seconds / 60));
    var h = Math.floor(m / 60);
    return h > 0 ? h + ' sa ' + (m % 60) + ' dk' : m + ' dk';
  }

  // timeToSeconds'a ihtiyacımız var ama optimizer.js'e sert bağımlılık
  // eklememek için varsa kullanır, yoksa "08:00" gibi bir saat metnini
  // kendi başına çözer.
  function Opt() {
    if (global.TSSOptimizer) return global.TSSOptimizer;
    return {
      timeToSeconds: function (hhmm) {
        var parts = String(hhmm || '00:00').split(':');
        return (Number(parts[0]) || 0) * 3600 + (Number(parts[1]) || 0) * 60;
      }
    };
  }

  function getHistory() {
    return state.history;
  }

  function removeHistoryEntry(id) {
    state.history = state.history.filter(function (h) { return h.id !== id; });
    save();
  }

  // --- Excel içe aktarma yardımcıları ---
  function normalizeKey(key) {
    return String(key)
      .toLocaleLowerCase('tr')
      .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
      .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
      .replace(/[^a-z0-9]/g, '');
  }

  function pick(row, keys) {
    var normalized = {};
    Object.keys(row).forEach(function (k) { normalized[normalizeKey(k)] = row[k]; });
    for (var i = 0; i < keys.length; i++) {
      var v = normalized[keys[i]];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return null;
  }

  /* Excel'den gelen saat değerini "HH:MM"e çevirir. sheet_to_json() saat
     olarak biçimlendirilmiş hücreleri Date değil HAM SAYI (günün kesri,
     ör. 08:00 -> 0.3333...) olarak döndürür (cellDates açık değil) — önceki
     kod bunu doğrudan String()'leyip slice(0,5) yapıyordu ("0.333" gibi
     anlamsız bir sonuç, sessizce yanlış saatle içe aktarılıyordu). "8:00 AM"
     gibi 12 saatlik metinleri de burada normalize ediyoruz. Tanınamayan
     değerlerde null döner (çağıran taraf varsayılana düşer). */
  function parseExcelTime(v) {
    if (v === null || v === undefined || v === '') return null;

    if (typeof v === 'number' && isFinite(v)) {
      var frac = v - Math.floor(v);           // gün içi kesir (tam sayı kısmı = tarih seri no'su)
      var totalMin = Math.round(frac * 24 * 60);
      totalMin = ((totalMin % 1440) + 1440) % 1440;
      var h = Math.floor(totalMin / 60), m = totalMin % 60;
      return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    }

    var s = String(v).trim();

    var ampm = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])$/);
    if (ampm) {
      var hh = Number(ampm[1]) % 12;
      if (/p/i.test(ampm[3])) hh += 12;
      return (hh < 10 ? '0' : '') + hh + ':' + ampm[2];
    }

    var plain = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (plain) {
      var h2 = Number(plain[1]);
      if (h2 >= 0 && h2 <= 23) return (h2 < 10 ? '0' : '') + h2 + ':' + plain[2];
    }

    return null;
  }

  function importLocationRows(rows) {
    var added = 0, skipped = 0;
    rows.forEach(function (row) {
      var name = pick(row, ['ad', 'adi', 'isim', 'lokasyon', 'lokasyonadi', 'name', 'konum']);
      var lat = pick(row, ['enlem', 'lat', 'latitude', 'y']);
      var lng = pick(row, ['boylam', 'lng', 'lon', 'longitude', 'x']);
      var from = pick(row, ['acilis', 'baslangic', 'erisimbaslangici', 'from', 'open']);
      var until = pick(row, ['kapanis', 'bitis', 'erisimbitisi', 'until', 'close']);

      if (!name || lat === null || lng === null) { skipped++; return; }
      try {
        addLocation({
          name: name,
          lat: String(lat).replace(',', '.'),
          lng: String(lng).replace(',', '.'),
          from: parseExcelTime(from) || '00:00',
          until: parseExcelTime(until) || '23:59'
        });
        added++;
      } catch (e) { skipped++; }
    });
    return { added: added, skipped: skipped };
  }

  function importVehicleRows(rows) {
    var added = 0, skipped = 0;
    rows.forEach(function (row) {
      var plate = pick(row, ['plaka', 'plate', 'arac', 'aracplakasi']);
      var model = pick(row, ['model', 'marka', 'aracmodeli', 'tip']);
      var capacity = pick(row, ['kapasite', 'paletkapasitesi', 'palet', 'capacity']);
      var fuelConsumption = pick(row, ['yakittuketimi', 'tuketim', 'l100km', 'fuelconsumption', 'litre100km']);
      var fuelType = pick(row, ['yakittipi', 'yakit', 'fueltype', 'fuel']);

      if (!plate || capacity === null) { skipped++; return; }
      try {
        addVehicle({
          plate: plate,
          model: model || '',
          capacity: String(capacity).replace(/[^0-9.]/g, ''),
          fuelConsumption: fuelConsumption !== null ? String(fuelConsumption).replace(',', '.').replace(/[^0-9.]/g, '') : undefined,
          fuelType: fuelType !== null ? fuelType : undefined
        });
        added++;
      } catch (e) { skipped++; }
    });
    return { added: added, skipped: skipped };
  }

  /* =========================================================
     Backend senkronizasyonu (opsiyonel, geriye dönük uyumlu)
     =========================================================
     TEMEL KURAL: Aşağıdaki hiçbir şey TSSData'nın dışa açık
     fonksiyonlarını asenkron yapmaz. Her fonksiyon bugünkü gibi
     senkron çalışır, aynı tick'te aynı değeri döndürür — js/app.js'teki
     60+ çağrı noktası hiç değişmeden çalışmaya devam eder.

     Mimari (bkz. plan dosyası):
       - Backend + SQLite = tek gerçek veri kaynağı (source of truth)
       - localStorage    = hızlı açılış önbelleği + outbox tamponu
       - Yazmalar: önce yerel (anında, senkron), sonra arka planda
         outbox üzerinden sunucuya; başarısız olursa kuyrukta kalır ve
         bağlantı gelince otomatik tekrar denenir.

     Backend hiç yapılandırılmazsa (ör. index.html çift tıklanarak
     file:// ile açıldıysa) bu bölüm tamamen devre dışı kalır ve
     uygulama birebir eski haliyle, saf localStorage ile çalışır.
     ========================================================= */

  var OUTBOX_KEY = 'tss-outbox-v1';
  var TOKEN_KEY = 'tss-remote-token-v1';
  var RETRY_MS = 30000;
  var MAX_ATTEMPTS = 50;    // kalıcı olarak başarısız bir işlem kuyruğu sonsuza dek şişirmesin

  var remote = null;         // { baseUrl: string, token: string }
  // 'none' | 'client' (kullanıcı arayüzden girdi) | 'server' (server/.env'de,
  // tarayıcıya hiç inmiyor). Sunucudan bootstrap ile gelir.
  var tomtomKeySource = 'none';
  var outbox = [];
  var flushing = false;
  var retryTimer = null;
  var onlineBound = false;
  var syncListeners = [];
  var errorListeners = [];

  function loadOutbox() {
    try {
      var raw = JSON.parse(localStorage.getItem(OUTBOX_KEY));
      outbox = Array.isArray(raw) ? raw : [];
    } catch (e) { outbox = []; }
  }

  function saveOutbox() {
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox)); } catch (e) { /* sessiz */ }
  }

  function notifySync() {
    syncListeners.forEach(function (fn) { try { fn(); } catch (e) { /* dinleyici hatası yayılmasın */ } });
  }

  function notifyError(message, kind) {
    errorListeners.forEach(function (fn) { try { fn(message, kind); } catch (e) { /* sessiz */ } });
  }

  function apiFetch(method, path, body) {
    var options = { method: method, headers: { 'Content-Type': 'application/json' } };
    // Token YALNIZCA header'da taşınır; URL query string'ine asla konmaz.
    if (remote.token) options.headers['X-TSS-Token'] = remote.token;
    if (body !== undefined) options.body = JSON.stringify(body);
    return fetch(remote.baseUrl + path, options);
  }

  function enqueue(op) {
    op.id = uid('op');
    op.createdAt = Date.now();
    op.attempts = 0;
    outbox.push(op);
    saveOutbox();
    flushOutbox();
  }

  function scheduleRetry() {
    if (retryTimer || !outbox.length) return;
    retryTimer = setTimeout(function () {
      retryTimer = null;
      flushOutbox();
    }, RETRY_MS);
  }

  // Kuyruğu SIRAYLA boşaltır (sıra önemli: "ekle" sonra "sil" gibi bağımlı
  // işlemler var). Tamamen boşaldıysa true döner.
  function flushOutbox() {
    if (!remote || flushing) return Promise.resolve(!outbox.length);
    if (!outbox.length) return Promise.resolve(true);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      scheduleRetry();
      return Promise.resolve(false);
    }
    flushing = true;

    function step() {
      if (!outbox.length) return Promise.resolve(true);
      var op = outbox[0];
      op.attempts++;
      if (op.attempts > MAX_ATTEMPTS) {
        outbox.shift();
        saveOutbox();
        notifyError('Bir değişiklik defalarca denendi ama sunucuya kaydedilemedi, kuyruktan çıkarıldı.', 'dropped');
        return step();
      }
      return apiFetch(op.method, op.path, op.body).then(function (res) {
        if (res.ok) {
          outbox.shift();
          saveOutbox();
          return step();
        }
        if (res.status === 401) {
          // Token sorunu: kuyruk KORUNUR, anahtar düzelince kaldığı yerden devam eder.
          notifyError('Sunucu erişim anahtarını kabul etmedi — değişiklikler henüz kaydedilmedi.', 'auth');
          return false;
        }
        if (res.status >= 400 && res.status < 500) {
          // Kalıcı hata (doğrulama/bulunamadı): tekrar denemek işe yaramaz,
          // kuyruğu tıkamasın diye düşürülür.
          outbox.shift();
          saveOutbox();
          notifyError('Bir değişiklik sunucu tarafından reddedildi (HTTP ' + res.status + ').', 'rejected');
          return step();
        }
        return false;   // 5xx: sunucu geçici olarak sorunlu, sonra tekrar dene
      }, function () {
        return false;   // ağ hatası: sonra tekrar dene
      });
    }

    return step().then(function (drained) {
      flushing = false;
      if (!drained) scheduleRetry();
      return drained;
    }, function () {
      flushing = false;
      scheduleRetry();
      return false;
    });
  }

  // Sunucudan gelen veriyi state'e uygular. `stops` ve `plan`'a DOKUNMAZ —
  // onlar bugünkü gibi tarayıcıda kalan geçici taslak veriler.
  function applyRemoteState(data) {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.locations)) state.locations = data.locations;
    if (Array.isArray(data.vehicles)) {
      state.vehicles = data.vehicles;
      // load()'daki geriye dönük uyumluluk düzeltmesinin aynısı
      state.vehicles.forEach(function (v) {
        var c = Number(v.fuelConsumption);
        if (!isFinite(c) || c <= 0) v.fuelConsumption = DEFAULT_FUEL_CONSUMPTION;
        if (v.fuelType !== 'benzin') v.fuelType = 'dizel';
      });
    }
    if (Array.isArray(data.history)) state.history = data.history;
    if (data.traffic) state.traffic = data.traffic;
    if (data.fuel) state.fuel = data.fuel;
    if (typeof data.tomtomApiKey === 'string') state.tomtomApiKey = data.tomtomApiKey;
    if (typeof data.tomtomKeySource === 'string') tomtomKeySource = data.tomtomKeySource;

    // Silinen bir lokasyona bağlı taslak duraklar ortada kalmasın
    var validIds = {};
    state.locations.forEach(function (l) { validIds[l.id] = true; });
    state.stops = state.stops.filter(function (s) { return validIds[s.locationId]; });
  }

  // Açılışta (ve istendiğinde) sunucudaki güncel veriyi çeker.
  // ÖNEMLİ: önce outbox boşaltılır — bekleyen yerel yazmalar sunucuya
  // gitmeden sunucu verisi üzerine yazılırsa o değişiklikler kaybolurdu.
  function syncFromRemote() {
    if (!remote) return Promise.resolve(false);
    return flushOutbox().then(function (drained) {
      if (!drained) return false;
      return apiFetch('GET', '/api/bootstrap').then(function (res) {
        if (!res.ok) {
          if (res.status === 401) {
            notifyError('Sunucu erişim anahtarı geçersiz — veriler yerel kopyadan gösteriliyor.', 'auth');
          }
          return false;
        }
        return res.json().then(function (data) {
          applyRemoteState(data);
          save();            // yerel önbelleği tazele
          notifySync();      // app.js ekranı yeniden çizer
          return true;
        });
      });
    })['catch'](function () { return false; });
  }

  /**
   * Backend'i devreye alır. Çağrılmazsa data.js birebir eski haliyle
   * (saf localStorage) çalışır — anında geri dönüş yolu budur.
   * opts: { baseUrl: '' (aynı origin), token: '...' }
   */
  function configureRemote(opts) {
    remote = {
      baseUrl: (opts && opts.baseUrl) || '',
      token: (opts && opts.token !== undefined) ? String(opts.token || '') : getRemoteToken()
    };
    loadOutbox();

    if (!onlineBound && typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', function () { flushOutbox(); });
      onlineBound = true;
    }
    return syncFromRemote();
  }

  // Panelin servis edildiği sunucuya (aynı origin) bağlanır — js/app.js
  // init() sırasında bir kez çağırır. Backend bu projenin asıl veri
  // kaynağıdır; localStorage yalnızca açılış önbelleği ve outbox tamponudur.
  function connectRemote() {
    return configureRemote({ baseUrl: '' });
  }

  function getRemoteToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function setRemoteToken(token) {
    var value = String(token || '').trim();
    try { localStorage.setItem(TOKEN_KEY, value); } catch (e) { /* sessiz */ }
    if (remote) remote.token = value;
    return value;
  }

  function isRemoteEnabled() { return !!remote; }

  function pendingSyncCount() { return outbox.length; }

  function onRemoteSync(fn) { if (typeof fn === 'function') syncListeners.push(fn); }
  function onSyncError(fn) { if (typeof fn === 'function') errorListeners.push(fn); }

  /* ---- yazma fonksiyonlarını saran ince katman ----
     Orijinal fonksiyon önce AYNEN (senkron) çalışır ve sonucunu döndürür;
     çağıran kod hiçbir fark görmez. Ardından karşılık gelen REST isteği
     outbox'a yazılır. Fonksiyon gövdelerinin hiçbiri değiştirilmedi. */
  function syncing(fn, buildOp) {
    return function () {
      var args = Array.prototype.slice.call(arguments);
      var result = fn.apply(null, args);
      if (remote) {
        try {
          var op = buildOp(result, args);
          if (op) enqueue(op);
        } catch (e) { /* senkronizasyon hiçbir zaman UI akışını bozmaz */ }
      }
      return result;
    };
  }

  // Excel içe aktarma, içeride addLocation/addVehicle'ın SARILMAMIŞ halini
  // çağırdığı için ayrı ele alınır: işlem sonrası yeni eklenen kayıtlar
  // tespit edilip tek tek kuyruğa yazılır.
  function syncingImport(fn, listName, path) {
    return function (rows) {
      var before = {};
      state[listName].forEach(function (item) { before[item.id] = true; });
      var result = fn(rows);
      if (remote) {
        state[listName].forEach(function (item) {
          if (!before[item.id]) enqueue({ method: 'POST', path: path, body: item });
        });
      }
      return result;
    };
  }

  global.TSSData = {
    state: state,
    uid: uid,
    load: load,
    save: save,
    resetToDefaults: resetToDefaults,

    // --- okuma (backend'den etkilenmez, hepsi bellekten anında döner) ---
    getTrafficSettings: getTrafficSettings,
    getTomTomApiKey: getTomTomApiKey,
    hasTomTomKey: hasTomTomKey,
    getTomTomKeySource: getTomTomKeySource,
    getFuelPriceSettings: getFuelPriceSettings,
    getLocation: getLocation,
    getVehicle: getVehicle,
    getHistory: getHistory,
    totalPickups: totalPickups,
    totalDeliveries: totalDeliveries,
    totalFleetCapacity: totalFleetCapacity,

    // --- taslak duraklar (kalıcı değil, backend'e hiç gitmez) ---
    addStop: addStop,
    removeStop: removeStop,
    updateStopPallets: updateStopPallets,
    clearStops: clearStops,

    // --- yazma (senkron davranış aynı + arka planda backend'e iletilir) ---
    updateTrafficSettings: syncing(updateTrafficSettings, function (traffic) {
      return { method: 'PATCH', path: '/api/settings/traffic', body: traffic };
    }),
    setTomTomApiKey: syncing(setTomTomApiKey, function () {
      return { method: 'PATCH', path: '/api/settings/tomtom-key', body: { tomtomApiKey: state.tomtomApiKey } };
    }),
    updateFuelPriceSettings: syncing(updateFuelPriceSettings, function (fuel) {
      return { method: 'PATCH', path: '/api/settings/fuel', body: fuel };
    }),
    addLocation: syncing(addLocation, function (loc) {
      return { method: 'POST', path: '/api/locations', body: loc };
    }),
    removeLocation: syncing(removeLocation, function (result, args) {
      return { method: 'DELETE', path: '/api/locations/' + encodeURIComponent(args[0]) };
    }),
    updateLocation: syncing(updateLocation, function (loc) {
      return loc ? { method: 'PUT', path: '/api/locations/' + encodeURIComponent(loc.id), body: loc } : null;
    }),
    addVehicle: syncing(addVehicle, function (veh) {
      return { method: 'POST', path: '/api/vehicles', body: veh };
    }),
    removeVehicle: syncing(removeVehicle, function (result, args) {
      return { method: 'DELETE', path: '/api/vehicles/' + encodeURIComponent(args[0]) };
    }),
    setUsableCapacity: syncing(setUsableCapacity, function (result, args) {
      var veh = getVehicle(args[0]);
      return veh ? { method: 'PATCH', path: '/api/vehicles/' + encodeURIComponent(veh.id) + '/usable', body: { usable: veh.usable } } : null;
    }),
    updateVehicle: syncing(updateVehicle, function (veh) {
      return veh ? { method: 'PUT', path: '/api/vehicles/' + encodeURIComponent(veh.id), body: veh } : null;
    }),
    approveTrip: syncing(approveTrip, function (entry) {
      return { method: 'POST', path: '/api/trips', body: entry };
    }),
    removeHistoryEntry: syncing(removeHistoryEntry, function (result, args) {
      return { method: 'DELETE', path: '/api/trips/' + encodeURIComponent(args[0]) };
    }),
    importLocationRows: syncingImport(importLocationRows, 'locations', '/api/locations'),
    importVehicleRows: syncingImport(importVehicleRows, 'vehicles', '/api/vehicles'),

    // --- backend katmanı (çağrılmazsa data.js eski haliyle çalışır) ---
    configureRemote: configureRemote,
    connectRemote: connectRemote,
    syncFromRemote: syncFromRemote,
    onRemoteSync: onRemoteSync,
    onSyncError: onSyncError,
    getRemoteToken: getRemoteToken,
    setRemoteToken: setRemoteToken,
    isRemoteEnabled: isRemoteEnabled,
    pendingSyncCount: pendingSyncCount
  };
})(window);
