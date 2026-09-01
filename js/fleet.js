/* =========================================================
   fleet.js — çoklu araç atama / kümeleme katmanı
   ---------------------------------------------------------
   js/optimizer.js'teki sıralama algoritmasına (en yakın komşu,
   2-opt, Or-opt, tam arama) HİÇ dokunulmadı. Bu dosya sadece:
     1) Duraklar tek araca sığmıyorsa onları coğrafi olarak
        kümeler ve her kümeyi (bölünmeden) TEK bir araca atar,
     2) Her küme için mevcut TSSOptimizer.optimize() aynen
        çağrılır — sıralama kararı yine oradan çıkar,
     3) Elle durak süresi / palet düzenlemesi sonrası, sırayı
        DEĞİŞTİRMEDEN zaman çizelgesini yeniden oynatan (replay)
        bir yardımcı sağlar (bu da optimizer'ın karar mantığını
        değil, sadece optimizer.simulate() ile aynı şekilde
        ileri yönlü hesaplamayı tekrarlar).

   Kural özeti (kullanıcıdan):
   - Önce TÜM duraklar tek bir araca sığıyor mu diye bakılır
     (uygun en küçük araç seçilir). Sığıyorsa hep tek araç kullanılır.
   - Sığmıyorsa duraklar coğrafi kümelere ayrılır (kümeleme adımı
     2 kümeden başlar, gerektikçe artar). Bir küme ASLA ikiye
     bölünmez — bütün olarak en küçük uygun araca atanır. Bu da
     "aynı kümede iki boşaltma varsa 5 paletlik araç seç, iki küçük
     araç çalıştırma" kuralını otomatik sağlar.
   - Bir araç, aynı plan içinde en fazla bir kümeye atanır.
   ========================================================= */
(function (global) {
  'use strict';

  var Opt = global.TSSOptimizer;

  // Araç rotasyonu: hangi aracın en son ne zaman onaylanmış bir seferde
  // kullanıldığını, ayrı bir alan tutmak yerine DOĞRUDAN sefer geçmişinden
  // (js/data.js → getHistory()) okuyoruz. Geçmiş en yeniden en eskiye sıralı
  // olduğundan (approveTrip → unshift), bir araç id'sine ilk rastlanan kayıt
  // o aracın en son kullanıldığı sefer olur. id alanı sonradan eklendiği için
  // ondan önce onaylanmış eski kayıtlarda id olmayabilir — bu yüzden plaka
  // üzerinden de eşleştiriyoruz (geriye dönük uyumluluk).
  function buildLastUsedMap(history) {
    var byId = {};
    var byPlate = {};
    (history || []).forEach(function (entry) {
      (entry.vehicles || []).forEach(function (v) {
        if (v.id && byId[v.id] === undefined) byId[v.id] = entry.approvedAt || 0;
        if (v.plate && byPlate[v.plate] === undefined) byPlate[v.plate] = entry.approvedAt || 0;
      });
    });
    return { byId: byId, byPlate: byPlate };
  }

  function lastUsedOf(lastUsedMap, vehicle) {
    if (lastUsedMap.byId[vehicle.id] !== undefined) return lastUsedMap.byId[vehicle.id];
    if (vehicle.plate && lastUsedMap.byPlate[vehicle.plate] !== undefined) return lastUsedMap.byPlate[vehicle.plate];
    return 0;
  }

  // Araçları önce kullanılabilir kapasiteye göre artan sırala (en küçük uygun
  // araç kuralı hiç değişmedi), eşit kapasiteliler arasında ise sefer
  // geçmişine göre en son kullanılmamış/en eski kullanılmış olanı öne al.
  // Böylece aynı büyüklükteki yükler tekrar planlandığında araçlar sırayla
  // (rotasyonlu) atanır — kapasite yeterli olduğu sürece bir önceki seferde
  // kullanılan araç, eşdeğer bir alternatif varken tekrar seçilmez.
  function makeVehicleComparator(lastUsedMap) {
    return function (a, b) {
      if (a.usable !== b.usable) return a.usable - b.usable;
      return lastUsedOf(lastUsedMap, a) - lastUsedOf(lastUsedMap, b);
    };
  }

  function buildSubMatrix(full, indices) {
    return indices.map(function (i) {
      return indices.map(function (j) { return full[i][j]; });
    });
  }

  // stops dizisindeki i. durak, tam (start dahil) mesafe matrisinde i+1. satır/sütundur.
  function toMatrixIndex(stopIndex) { return stopIndex + 1; }

  function runOptimizeForSubset(subStops, opts, fullDistances, fullDurations, capacity, initialLoadOverride, originalIndices) {
    var localIndices = [0].concat(originalIndices.map(toMatrixIndex));
    var localDistances = buildSubMatrix(fullDistances, localIndices);
    var localDurations = buildSubMatrix(fullDurations, localIndices);
    var result = Opt.optimize({
      startLocation: opts.startLocation,
      stops: subStops,
      distances: localDistances,
      durations: localDurations,
      serviceMinutes: opts.serviceMinutes,
      departureTime: opts.departureTime,
      initialLoad: initialLoadOverride || 0,
      capacity: capacity,
      returnToStart: false,
      traffic: opts.traffic,
      isWeekend: opts.isWeekend,
      costMetric: opts.costMetric
    });
    var localNodes = [{ location: opts.startLocation, type: 'start', pallets: 0 }].concat(subStops);
    return { localNodes: localNodes, localDistances: localDistances, localDurations: localDurations, result: result, initialLoad: initialLoadOverride || 0 };
  }

  /* En uzak nokta (farthest-point) tohumlamayla k kümeye ayırır. Gerçek yol
     mesafesi matrisini kullanır (kuş uçuşu değil) — zaten OSRM'den elimizde. */
  function clusterStopIndices(stops, fullDistances, k) {
    var n = stops.length;
    var all = [];
    for (var i = 0; i < n; i++) all.push(i);
    if (k >= n) return all.map(function (i) { return [i]; });

    var seeds = [all[0]];
    all.forEach(function (i) {
      if (fullDistances[0][toMatrixIndex(i)] > fullDistances[0][toMatrixIndex(seeds[0])]) seeds[0] = i;
    });

    while (seeds.length < k) {
      var best = -1, bestMinDist = -1;
      all.forEach(function (i) {
        if (seeds.indexOf(i) !== -1) return;
        var minDist = Infinity;
        seeds.forEach(function (s) {
          var d = fullDistances[toMatrixIndex(i)][toMatrixIndex(s)];
          if (d < minDist) minDist = d;
        });
        if (minDist > bestMinDist) { bestMinDist = minDist; best = i; }
      });
      if (best === -1) break;
      seeds.push(best);
    }

    var clusters = seeds.map(function () { return []; });
    all.forEach(function (i) {
      var bestSeed = 0, bestDist = Infinity;
      seeds.forEach(function (s, si) {
        var d = fullDistances[toMatrixIndex(i)][toMatrixIndex(s)];
        if (d < bestDist) { bestDist = d; bestSeed = si; }
      });
      clusters[bestSeed].push(i);
    });
    return clusters.filter(function (c) { return c.length; });
  }

  // Başlangıca en yakın kümeyi bulur — "Başlangıç Yükü" (zaten araçtaki palet)
  // her zaman tek bir fiziksel araca ait bir kavram olduğundan, çoklu araç
  // durumunda bu yükü ilk hareket edecek/en yakın kümeye ekliyoruz.
  function closestClusterToStart(clusters, fullDistances) {
    var bestCi = 0, bestDist = Infinity;
    clusters.forEach(function (idxArr, ci) {
      var minDist = Math.min.apply(null, idxArr.map(function (i) { return fullDistances[0][toMatrixIndex(i)]; }));
      if (minDist < bestDist) { bestDist = minDist; bestCi = ci; }
    });
    return bestCi;
  }

  function buildGroup(vehicle, subStops, run) {
    var order = run.result.order;
    var serviceOverrides = {};
    return {
      vehicle: vehicle,
      vehicleId: vehicle.id,
      stops: subStops,
      localNodes: run.localNodes,
      localDistances: run.localDistances,
      localDurations: run.localDurations,
      order: order,
      result: run.result,
      initialLoad: run.initialLoad,
      serviceOverrides: serviceOverrides,
      edited: false
    };
  }

  /**
   * Ana giriş noktası.
   * opts: { startLocation, stops:[{location,type,pallets,stopId}], vehicles:[...usable],
   *         matrix:{distances,durations} (points = [start].concat(stops), aynı sırayla),
   *         serviceMinutes, departureTime, initialLoad, traffic, isWeekend,
   *         history:[...TSSData.getHistory()] (araç rotasyonu için, opsiyonel),
   *         costMetric:'distance'|'duration' (opsiyonel, bkz. js/optimizer.js) }
   * döner: { groups:[...], warning: string|null }
   */
  function assignFleet(opts) {
    var stops = opts.stops;
    var vehicles = (opts.vehicles || []).filter(function (v) { return v.usable > 0; });
    var fullDistances = opts.matrix.distances;
    var fullDurations = opts.matrix.durations;
    var allIndices = stops.map(function (s, i) { return i; });

    if (!stops.length) return { groups: [], warning: null };
    if (!vehicles.length) return { groups: [], warning: 'Kullanılabilir kapasitesi olan araç yok.' };

    var compareVehicles = makeVehicleComparator(buildLastUsedMap(opts.history));

    // ---- 1) Tüm duraklar tek araca sığıyor mu? (kapasiteye göre artan, eşitlikte rotasyonlu sırayla dene) ----
    var ascending = vehicles.slice().sort(compareVehicles);
    for (var i = 0; i < ascending.length; i++) {
      var veh = ascending[i];
      var run = runOptimizeForSubset(stops, opts, fullDistances, fullDurations, veh.usable, opts.initialLoad, allIndices);
      if (run.result.capacityViolations === 0) {
        return { groups: [buildGroup(veh, stops, run)], warning: null };
      }
    }

    // ---- 2) Tek araç yetmiyor: kümeleme, 2'den başlayıp gerektikçe artır ----
    var maxK = Math.min(vehicles.length, stops.length);
    var chosen = null;

    for (var k = 2; k <= maxK; k++) {
      var clusters = clusterStopIndices(stops, fullDistances, k);
      if (clusters.length < 2) continue;
      var closestCi = closestClusterToStart(clusters, fullDistances);

      var reqs = clusters.map(function (idxArr, ci) {
        var sub = idxArr.map(function (si) { return stops[si]; });
        var il = (ci === closestCi) ? opts.initialLoad : 0;
        var probe = runOptimizeForSubset(sub, opts, fullDistances, fullDurations, Infinity, il, idxArr);
        return { idxArr: idxArr, sub: sub, required: probe.result.maxLoad, initialLoad: il };
      });

      // Best-fit-decreasing: en çok ihtiyacı olan küme önce, karşılayan EN KÜÇÜK
      // uygun araca eşleşir. Bir araç bir plan içinde yalnızca bir kümeye verilir.
      var pool = vehicles.slice();
      var assignment = [];
      var ok = true;
      reqs.slice().sort(function (a, b) { return b.required - a.required; }).forEach(function (req) {
        if (!ok) return;
        var candidates = pool.filter(function (v) { return v.usable >= req.required; });
        if (!candidates.length) { ok = false; return; }
        candidates.sort(compareVehicles);
        var picked = candidates[0];
        pool.splice(pool.indexOf(picked), 1);
        assignment.push({ req: req, vehicle: picked });
      });

      if (ok) { chosen = assignment; break; }
    }

    if (!chosen) {
      // Filo, planı hiçbir bölüştürmeyle tam karşılayamıyor: en büyük araca tüm
      // duraklar verilir, en iyi rota yine üretilir — ihlaller tabloda işaretlenir
      // (mevcut tek-araç davranışıyla aynı felsefe).
      var largest = ascending[ascending.length - 1];
      var fallback = runOptimizeForSubset(stops, opts, fullDistances, fullDurations, largest.usable, opts.initialLoad, allIndices);
      return {
        groups: [buildGroup(largest, stops, fallback)],
        warning: 'Filonun toplam kullanılabilir kapasitesi bu planı tam karşılamıyor. En iyi rota yine üretildi, kısıt ihlalleri tabloda işaretli.'
      };
    }

    var groups = chosen.map(function (a) {
      var real = runOptimizeForSubset(a.req.sub, opts, fullDistances, fullDurations, a.vehicle.usable, a.req.initialLoad, a.req.idxArr);
      return buildGroup(a.vehicle, a.req.sub, real);
    });

    // Görüntüleme sırası: başlangıca en yakın küme (genelde ilk hareket eden) önce.
    groups.sort(function (g1, g2) {
      var d1 = Math.min.apply(null, g1.stops.map(function (s, si) { return g1.localDistances[0][si + 1]; }));
      var d2 = Math.min.apply(null, g2.stops.map(function (s, si) { return g2.localDistances[0][si + 1]; }));
      return d1 - d2;
    });

    return { groups: groups, warning: null };
  }

  /* Sırayı DEĞİŞTİRMEDEN (elle durak süresi / palet düzenlemesi ya da araç
     değişikliği sonrası) zaman çizelgesini yeniden oynatır. optimizer.js'teki
     simulate() ile aynı ileri-yönlü mantığı kullanır (kopya, çünkü orası
     sıralama kararı da veren bir fonksiyon — burada sadece "sırayı aynı
     tutup yeniden oynat" gerekiyor, algoritmaya dokunmadan). */
  function replayGroup(group, opts) {
    var rows = [];
    var load = group.initialLoad || 0;
    var maxLoad = load;
    var departureSec = Opt.timeToSeconds(opts.departureTime);
    var clock = departureSec;
    var totalDistance = 0;
    var capacityViolations = 0, timeViolations = 0;
    var prev = 0;

    rows.push({
      nodeIndex: 0, kind: 'start', location: group.localNodes[0].location, pallets: 0,
      load: load, legDistance: 0, arrivalSec: clock, departureSec: clock, issues: []
    });

    group.order.forEach(function (idx) {
      var node = group.localNodes[idx];
      var legDist = group.localDistances[prev][idx];
      var trafficFactor = Opt.trafficFactorAt(clock, opts.traffic, opts.isWeekend);
      var legTime = group.localDurations[prev][idx] * trafficFactor;
      totalDistance += legDist;

      var arrival = clock + legTime;
      var issues = [];
      var openSec = Opt.timeToSeconds(node.location.from);
      var closeSec = Opt.timeToSeconds(node.location.until);
      if (arrival < openSec) { arrival = openSec; issues.push('Açılış bekleniyor'); }
      if (arrival > closeSec) { timeViolations++; issues.push('Erişim saati aşıldı (' + node.location.until + ')'); }

      if (node.type === 'pickup') {
        load += node.pallets;
        if (load > opts.capacity) { capacityViolations++; issues.push('Kapasite aşımı'); }
      } else {
        load -= node.pallets;
        if (load < 0) { capacityViolations++; issues.push('Araçta yeterli palet yok'); }
      }
      if (load > maxLoad) maxLoad = load;

      var serviceMinutes = group.serviceOverrides[idx] != null ? group.serviceOverrides[idx] : opts.defaultServiceMinutes;
      var departure = arrival + Math.max(0, serviceMinutes) * 60;

      rows.push({
        nodeIndex: idx, kind: node.type, location: node.location, pallets: node.pallets,
        load: load, legDistance: legDist, arrivalSec: arrival, departureSec: departure,
        trafficFactor: trafficFactor, issues: issues, serviceMinutes: serviceMinutes
      });

      clock = departure;
      prev = idx;
    });

    return {
      rows: rows,
      distance: totalDistance,
      totalSeconds: clock - departureSec,
      finishSec: clock,
      maxLoad: maxLoad,
      capacityViolations: capacityViolations,
      timeViolations: timeViolations,
      order: group.order.slice(),
      orderedNodes: group.order.map(function (i) { return group.localNodes[i]; }),
      feasible: capacityViolations === 0 && timeViolations === 0
    };
  }

  /* Aynı sırayı (group.order) DEĞİŞTİRMEDEN, ama bacak mesafe/süresini
     matristen değil DIŞARIDAN VERİLEN (TomTom'dan canlı trafikle alınmış)
     değerlerden okuyarak zaman çizelgesini yeniden oynatır. replayGroup'un
     bir varyantı — sıralama kararına yine dokunmuyor, sadece "süre modu"nda
     js/app.js'in TomTom'dan aldığı gerçek bacak verisini plana işlemek için.
     legs: group.order ile aynı uzunlukta, sırayla [{distanceMeters,
     durationSeconds}, ...] (start→1. durak, 1. durak→2. durak, ...).
     Not: legTime'a js/optimizer.js'teki sabit trafik çarpanı UYGULANMAZ —
     TomTom'un süresi zaten canlı trafik dahil, tekrar çarpmak trafiği iki kez
     saymak olurdu. */
  function replayGroupWithLiveLegs(group, legs, opts) {
    var rows = [];
    var load = group.initialLoad || 0;
    var maxLoad = load;
    var departureSec = Opt.timeToSeconds(opts.departureTime);
    var clock = departureSec;
    var totalDistance = 0;
    var capacityViolations = 0, timeViolations = 0;

    rows.push({
      nodeIndex: 0, kind: 'start', location: group.localNodes[0].location, pallets: 0,
      load: load, legDistance: 0, arrivalSec: clock, departureSec: clock, issues: []
    });

    group.order.forEach(function (idx, i) {
      var node = group.localNodes[idx];
      var leg = legs[i];
      var legDist = leg.distanceMeters;
      var legTime = leg.durationSeconds;
      totalDistance += legDist;

      var arrival = clock + legTime;
      var issues = [];
      var openSec = Opt.timeToSeconds(node.location.from);
      var closeSec = Opt.timeToSeconds(node.location.until);
      if (arrival < openSec) { arrival = openSec; issues.push('Açılış bekleniyor'); }
      if (arrival > closeSec) { timeViolations++; issues.push('Erişim saati aşıldı (' + node.location.until + ')'); }

      if (node.type === 'pickup') {
        load += node.pallets;
        if (load > opts.capacity) { capacityViolations++; issues.push('Kapasite aşımı'); }
      } else {
        load -= node.pallets;
        if (load < 0) { capacityViolations++; issues.push('Araçta yeterli palet yok'); }
      }
      if (load > maxLoad) maxLoad = load;

      var serviceMinutes = group.serviceOverrides[idx] != null ? group.serviceOverrides[idx] : opts.defaultServiceMinutes;
      var departure = arrival + Math.max(0, serviceMinutes) * 60;

      rows.push({
        nodeIndex: idx, kind: node.type, location: node.location, pallets: node.pallets,
        load: load, legDistance: legDist, arrivalSec: arrival, departureSec: departure,
        trafficDelaySec: leg.trafficDelaySeconds || 0, issues: issues, serviceMinutes: serviceMinutes,
        liveTraffic: true
      });

      clock = departure;
    });

    return {
      rows: rows,
      distance: totalDistance,
      totalSeconds: clock - departureSec,
      finishSec: clock,
      maxLoad: maxLoad,
      capacityViolations: capacityViolations,
      timeViolations: timeViolations,
      order: group.order.slice(),
      orderedNodes: group.order.map(function (i) { return group.localNodes[i]; }),
      feasible: capacityViolations === 0 && timeViolations === 0,
      liveTraffic: true
    };
  }

  global.TSSFleet = {
    assignFleet: assignFleet,
    replayGroup: replayGroup,
    replayGroupWithLiveLegs: replayGroupWithLiveLegs
  };
})(window);
