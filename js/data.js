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

  // --- Varsayılan araçlar (paylaşılan araç listesi) ---
  var DEFAULT_VEHICLES = [
    { id: 'veh-1', plate: '34 HER 841', model: 'Fiat Ducato',     capacity: 5, usable: 5 },
    { id: 'veh-2', plate: '34 KVS 889', model: 'Fiat Ducato',     capacity: 5, usable: 5 },
    { id: 'veh-3', plate: '34 GTS 710', model: 'Peugeot Partner', capacity: 1, usable: 1 },
    { id: 'veh-4', plate: '34 GTS 744', model: 'Peugeot Partner', capacity: 1, usable: 1 }
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

  var state = {
    locations: [],
    vehicles: [],
    stops: [],          // { id, locationId, type: 'pickup'|'delivery', pallets }
    plan: null,         // hesaplanan rota sonucu
    history: [],        // onaylanan seferlerin kalıcı kaydı
    traffic: null,       // trafik katsayısı ayarları (kalıcı)
    tomtomApiKey: ''     // "En Az Süre" modunda canlı trafik için — kullanıcı girer,
                          // sadece bu tarayıcıda saklanır, koda hiç gömülmez
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
        tomtomApiKey: state.tomtomApiKey
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

    state.history = (stored && Array.isArray(stored.history)) ? stored.history : [];

    state.traffic = (stored && stored.traffic) ? stored.traffic : JSON.parse(JSON.stringify(DEFAULT_TRAFFIC));

    state.tomtomApiKey = (stored && typeof stored.tomtomApiKey === 'string') ? stored.tomtomApiKey : '';
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

  function setTomTomApiKey(key) {
    state.tomtomApiKey = String(key || '').trim();
    save();
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
  function addVehicle(data) {
    var cap = Number(data.capacity);
    if (!String(data.plate || '').trim()) throw new Error('Plaka boş olamaz.');
    if (!isFinite(cap) || cap < 1) throw new Error('Kapasite en az 1 palet olmalı.');
    var veh = {
      id: uid('veh'),
      plate: String(data.plate).trim().toUpperCase(),
      model: String(data.model || '').trim(),
      capacity: Math.floor(cap),
      usable: Math.floor(cap)
    };
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

  function updateVehicle(id, data) {
    var veh = getVehicle(id);
    if (!veh) return null;
    var cap = Number(data.capacity);
    if (!String(data.plate || '').trim()) throw new Error('Plaka boş olamaz.');
    if (!isFinite(cap) || cap < 1) throw new Error('Kapasite en az 1 palet olmalı.');
    veh.plate = String(data.plate).trim().toUpperCase();
    veh.model = String(data.model || '').trim();
    veh.capacity = Math.floor(cap);
    veh.usable = Math.max(1, Math.min(veh.capacity, veh.usable));
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

      if (!plate || capacity === null) { skipped++; return; }
      try {
        addVehicle({
          plate: plate,
          model: model || '',
          capacity: String(capacity).replace(/[^0-9.]/g, '')
        });
        added++;
      } catch (e) { skipped++; }
    });
    return { added: added, skipped: skipped };
  }

  global.TSSData = {
    state: state,
    uid: uid,
    load: load,
    save: save,
    resetToDefaults: resetToDefaults,
    getTrafficSettings: getTrafficSettings,
    updateTrafficSettings: updateTrafficSettings,
    getTomTomApiKey: getTomTomApiKey,
    setTomTomApiKey: setTomTomApiKey,
    addLocation: addLocation,
    removeLocation: removeLocation,
    updateLocation: updateLocation,
    getLocation: getLocation,
    addVehicle: addVehicle,
    removeVehicle: removeVehicle,
    getVehicle: getVehicle,
    setUsableCapacity: setUsableCapacity,
    updateVehicle: updateVehicle,
    addStop: addStop,
    removeStop: removeStop,
    updateStopPallets: updateStopPallets,
    clearStops: clearStops,
    approveTrip: approveTrip,
    getHistory: getHistory,
    removeHistoryEntry: removeHistoryEntry,
    totalPickups: totalPickups,
    totalDeliveries: totalDeliveries,
    totalFleetCapacity: totalFleetCapacity,
    importLocationRows: importLocationRows,
    importVehicleRows: importVehicleRows
  };
})(window);
