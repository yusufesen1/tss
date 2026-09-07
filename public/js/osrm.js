/* =========================================================
   osrm.js — gerçek yol mesafesi ve güzergah geometrisi
   Kaynak: açık OSRM demo sunucusu (backend gerektirmez).
   Kurumsal kullanımda kendi OSRM örneğinize BASE'i çevirin.
   ========================================================= */
(function (global) {
  'use strict';

  var BASE = 'https://router.project-osrm.org';
  var PROFILE = 'driving';

  function coordString(points) {
    return points.map(function (p) {
      return p.lng.toFixed(6) + ',' + p.lat.toFixed(6);
    }).join(';');
  }

  function request(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('Rota servisi yanıt vermedi (HTTP ' + res.status + ').');
      return res.json();
    }).then(function (json) {
      if (json.code && json.code !== 'Ok') {
        throw new Error('Rota servisi hatası: ' + json.code);
      }
      return json;
    });
  }

  /**
   * Noktalar arası mesafe (m) ve süre (sn) matrisi.
   * @returns {Promise<{distances:number[][], durations:number[][]}>}
   */
  function matrix(points) {
    if (points.length < 2) {
      return Promise.resolve({ distances: [[0]], durations: [[0]] });
    }
    var url = BASE + '/table/v1/' + PROFILE + '/' + coordString(points) +
              '?annotations=duration,distance';
    return request(url).then(function (json) {
      if (!json.distances || !json.durations) {
        throw new Error('Mesafe matrisi alınamadı.');
      }
      return { distances: json.distances, durations: json.durations };
    });
  }

  /**
   * Sıralı noktalar için sürüş güzergahı (çizim için GeoJSON çizgi).
   * @returns {Promise<{coordinates:Array, distance:number, duration:number, legs:Array}>}
   */
  function route(points) {
    if (points.length < 2) {
      return Promise.resolve({ coordinates: [], distance: 0, duration: 0, legs: [] });
    }
    var url = BASE + '/route/v1/' + PROFILE + '/' + coordString(points) +
              '?overview=full&geometries=geojson&steps=false';
    return request(url).then(function (json) {
      var r = json.routes && json.routes[0];
      if (!r) throw new Error('Güzergah bulunamadı.');
      return {
        coordinates: r.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }),
        distance: r.distance,
        duration: r.duration,
        legs: r.legs || []
      };
    });
  }

  global.TSSOsrm = {
    matrix: matrix,
    route: route,
    setBase: function (url) { BASE = url.replace(/\/$/, ''); }
  };
})(window);
