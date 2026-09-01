/* =========================================================
   optimizer.js — kapasiteli tek araç rota optimizasyonu
   Yaklaşım: en yakın komşu (başlangıç çözümü)
             → 2-opt ve Or-opt iyileştirme
             → kapasite ve erişim saati ihlalleri ceza ile bastırılır
   Not: Çok araçlı bölüştürme ve yasak güzergah kısıtı
        bilinçli olarak dışarıda bırakıldı (sonraki faz).
   ========================================================= */
(function (global) {
  'use strict';

  var PENALTY_CAPACITY = 1e7;   // kapasite ihlali: kesinlikle kaçınılır
  var PENALTY_TIME     = 5e5;   // erişim saati ihlali: mümkünse kaçınılır

  function timeToSeconds(hhmm) {
    var parts = String(hhmm || '00:00').split(':');
    return (Number(parts[0]) || 0) * 3600 + (Number(parts[1]) || 0) * 60;
  }

  function secondsToTime(sec) {
    var s = Math.round(sec);
    var day = Math.floor(s / 86400);
    s = ((s % 86400) + 86400) % 86400;
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var label = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    return day > 0 ? label + ' (+' + day + 'g)' : label;
  }

  /* =========================================================
     Trafik katsayısı — gerçek trafik verisi yok (backend/API maliyeti
     yok), ama gün içi zaman dilimlerine göre sabit bir çarpan bile
     "sabah 8'de çık, 9'da Kadıköy'de ol" gibi imkansız planları önler.
     Sadece süreyi etkiler, mesafeyi (km) değiştirmez.
     ========================================================= */
  function inTrafficBand(todSec, band) {
    if (!band) return false;
    var start = timeToSeconds(band.start);
    var end = timeToSeconds(band.end);
    if (start === end) return false;
    if (start < end) return todSec >= start && todSec < end;
    return todSec >= start || todSec < end; // gece yarısını saran aralık (örn. 23:00-06:00)
  }

  function trafficFactorAt(clockSec, traffic, isWeekend) {
    if (!traffic || !traffic.enabled) return 1;
    var tod = ((clockSec % 86400) + 86400) % 86400;
    var skipRushHour = isWeekend && !traffic.applyRushHourOnWeekends;

    if (!skipRushHour && inTrafficBand(tod, traffic.morning)) return Number(traffic.morning.factor) || 1;
    if (!skipRushHour && inTrafficBand(tod, traffic.evening)) return Number(traffic.evening.factor) || 1;
    if (inTrafficBand(tod, traffic.night)) return Number(traffic.night.factor) || 1;
    return 1;
  }

  /**
   * Bir sıralamayı baştan sona simüle eder.
   * ctx: { distances, durations, nodes, serviceSec, departureSec, initialLoad, capacity, returnToStart }
   * nodes[0] = hareket noktası, nodes[1..n] = duraklar
   */
  function simulate(order, ctx) {
    var rows = [];
    var load = ctx.initialLoad;
    var maxLoad = load;
    var clock = ctx.departureSec;
    var totalDistance = 0;
    var capacityViolations = 0;
    var timeViolations = 0;
    var prev = 0;

    rows.push({
      nodeIndex: 0,
      kind: 'start',
      location: ctx.nodes[0].location,
      pallets: 0,
      load: load,
      legDistance: 0,
      arrivalSec: clock,
      departureSec: clock,
      issues: []
    });

    for (var i = 0; i < order.length; i++) {
      var idx = order[i];
      var node = ctx.nodes[idx];
      var legDist = ctx.distances[prev][idx];
      var trafficFactor = trafficFactorAt(clock, ctx.traffic, ctx.isWeekend);
      var legTime = ctx.durations[prev][idx] * trafficFactor;

      totalDistance += legDist;
      var arrival = clock + legTime;
      var issues = [];

      // Erişim saati kontrolü
      var openSec = timeToSeconds(node.location.from);
      var closeSec = timeToSeconds(node.location.until);
      if (arrival < openSec) {
        arrival = openSec;                       // açılışı bekle
        issues.push('Açılış bekleniyor');
      }
      if (arrival > closeSec) {
        timeViolations++;
        issues.push('Erişim saati aşıldı (' + node.location.until + ')');
      }

      // Yük kontrolü
      if (node.type === 'pickup') {
        load += node.pallets;
        if (load > ctx.capacity) {
          capacityViolations++;
          issues.push('Kapasite aşımı');
        }
      } else {
        load -= node.pallets;
        if (load < 0) {
          capacityViolations++;
          issues.push('Araçta yeterli palet yok');
        }
      }
      if (load > maxLoad) maxLoad = load;

      var departure = arrival + ctx.serviceSec;
      rows.push({
        nodeIndex: idx,
        kind: node.type,
        location: node.location,
        pallets: node.pallets,
        load: load,
        legDistance: legDist,
        arrivalSec: arrival,
        departureSec: departure,
        trafficFactor: trafficFactor,
        issues: issues
      });

      clock = departure;
      prev = idx;
    }

    var finishSec = clock;
    if (ctx.returnToStart) {
      var backDist = ctx.distances[prev][0];
      var backFactor = trafficFactorAt(clock, ctx.traffic, ctx.isWeekend);
      totalDistance += backDist;
      finishSec = clock + ctx.durations[prev][0] * backFactor;
      rows.push({
        nodeIndex: 0,
        kind: 'return',
        location: ctx.nodes[0].location,
        pallets: 0,
        load: load,
        legDistance: backDist,
        arrivalSec: finishSec,
        departureSec: finishSec,
        trafficFactor: backFactor,
        issues: []
      });
    }

    var totalSeconds = finishSec - ctx.departureSec;
    // costMetric: hangi büyüklüğün minimize edileceği. 'distance' (varsayılan,
    // önceki davranışla birebir aynı) = en kısa km; 'duration' = en az süre
    // (OSRM'in kendi tahmini üzerinden — gerçek canlı trafik değil, ama
    // sıralama kararını "kaç km" yerine "kaç dakika" baz alarak veriyor).
    // Sıralama/2-opt/Or-opt/tam-arama mantığına dokunulmadı, sadece bu
    // fonksiyonların minimize etmeye çalıştığı sayı değişiyor.
    var baseCost = ctx.costMetric === 'duration' ? totalSeconds : totalDistance;

    return {
      rows: rows,
      distance: totalDistance,
      totalSeconds: totalSeconds,
      finishSec: finishSec,
      maxLoad: maxLoad,
      capacityViolations: capacityViolations,
      timeViolations: timeViolations,
      cost: baseCost
           + capacityViolations * PENALTY_CAPACITY
           + timeViolations * PENALTY_TIME
    };
  }

  /** En yakın komşu ile başlangıç sıralaması. */
  function nearestNeighbor(ctx) {
    var n = ctx.nodes.length - 1;
    var visited = {};
    var order = [];
    var current = 0;

    for (var step = 0; step < n; step++) {
      var best = -1, bestScore = Infinity;
      for (var i = 1; i <= n; i++) {
        if (visited[i]) continue;
        // Yükleme öncelikli: boşaltma için araçta palet olmalı
        var score = ctx.distances[current][i];
        if (best === -1 || score < bestScore) { best = i; bestScore = score; }
      }
      visited[best] = true;
      order.push(best);
      current = best;
    }
    return order;
  }

  /** 2-opt: segment ters çevirme. */
  function twoOpt(order, ctx, bestResult) {
    var improved = true;
    var guard = 0;
    while (improved && guard < 200) {
      improved = false;
      guard++;
      for (var i = 0; i < order.length - 1; i++) {
        for (var k = i + 1; k < order.length; k++) {
          var candidate = order.slice(0, i)
            .concat(order.slice(i, k + 1).reverse())
            .concat(order.slice(k + 1));
          var result = simulate(candidate, ctx);
          if (result.cost < bestResult.cost - 0.5) {
            order = candidate;
            bestResult = result;
            improved = true;
          }
        }
      }
    }
    return { order: order, result: bestResult };
  }

  /** Or-opt: tek durağı başka konuma taşıma (2-opt'un yakalayamadığı sıra düzeltmeleri). */
  function orOpt(order, ctx, bestResult) {
    var improved = true;
    var guard = 0;
    while (improved && guard < 200) {
      improved = false;
      guard++;
      for (var i = 0; i < order.length; i++) {
        for (var j = 0; j < order.length; j++) {
          if (i === j) continue;
          var candidate = order.slice();
          var moved = candidate.splice(i, 1)[0];
          candidate.splice(j, 0, moved);
          var result = simulate(candidate, ctx);
          if (result.cost < bestResult.cost - 0.5) {
            order = candidate;
            bestResult = result;
            improved = true;
          }
        }
      }
    }
    return { order: order, result: bestResult };
  }

  /**
   * Ana giriş noktası.
   * options: { startLocation, stops:[{location,type,pallets}], distances, durations,
   *            serviceMinutes, departureTime, initialLoad, capacity, returnToStart,
   *            traffic, isWeekend, costMetric:'distance'|'duration' (opsiyonel,
   *            varsayılan 'distance' — önceki davranışla birebir aynı) }
   */
  function optimize(options) {
    var nodes = [{ location: options.startLocation, type: 'start', pallets: 0 }];
    options.stops.forEach(function (s) { nodes.push(s); });

    var ctx = {
      nodes: nodes,
      distances: options.distances,
      durations: options.durations,
      serviceSec: (Number(options.serviceMinutes) || 0) * 60,
      departureSec: timeToSeconds(options.departureTime),
      initialLoad: Number(options.initialLoad) || 0,
      capacity: Number(options.capacity),
      returnToStart: options.returnToStart !== false,
      traffic: options.traffic || null,
      isWeekend: !!options.isWeekend,
      costMetric: options.costMetric === 'duration' ? 'duration' : 'distance'
    };

    var order = nearestNeighbor(ctx);
    var best = simulate(order, ctx);

    var passOne = twoOpt(order, ctx, best);
    var passTwo = orOpt(passOne.order, ctx, passOne.result);
    var passThree = twoOpt(passTwo.order, ctx, passTwo.result);

    // Küçük problemlerde tam arama ile doğrula (≤ 7 durak)
    if (nodes.length - 1 <= 7) {
      var exhaustive = bruteForce(ctx);
      if (exhaustive && exhaustive.result.cost < passThree.result.cost - 0.5) {
        passThree = exhaustive;
      }
    }

    var result = passThree.result;
    result.order = passThree.order;
    result.orderedNodes = passThree.order.map(function (i) { return nodes[i]; });
    result.feasible = result.capacityViolations === 0 && result.timeViolations === 0;
    return result;
  }

  /** Küçük durak sayılarında tüm permütasyonları dener. */
  function bruteForce(ctx) {
    var items = [];
    for (var i = 1; i < ctx.nodes.length; i++) items.push(i);

    var best = null, bestOrder = null;

    function permute(current, remaining) {
      if (!remaining.length) {
        var r = simulate(current, ctx);
        if (!best || r.cost < best.cost) { best = r; bestOrder = current.slice(); }
        return;
      }
      for (var i = 0; i < remaining.length; i++) {
        var next = remaining.slice();
        var picked = next.splice(i, 1)[0];
        permute(current.concat([picked]), next);
      }
    }

    permute([], items);
    return best ? { order: bestOrder, result: best } : null;
  }

  global.TSSOptimizer = {
    optimize: optimize,
    simulate: simulate,
    timeToSeconds: timeToSeconds,
    secondsToTime: secondsToTime,
    // Not: sıralama/algoritma mantığına dokunulmadı — trafficFactorAt zaten
    // var olan bir iç fonksiyon, sadece dışa açıldı. js/fleet.js elle durak
    // süresi düzenlemesinden sonraki zaman çizelgesini bununla yeniden
    // hesaplıyor (aynı trafik katsayısı mantığını tekrar yazmamak için).
    trafficFactorAt: trafficFactorAt
  };
})(window);
