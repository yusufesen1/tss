/* =========================================================
   app.js — arayüz akışı, harita, planlama ve yönetim ekranları
   ========================================================= */
(function () {
  'use strict';

  var D = window.TSSData;
  var Opt = window.TSSOptimizer;
  var Osrm = window.TSSOsrm;
  var Fleet = window.TSSFleet;
  var Exp = window.TSSExporter;
  var Weather = window.TSSWeather;
  var TomTom = window.TSSTomTom; // yoksa (tomtom.js yüklenmediyse) undefined kalır, aşağıda kontrol edilir

  var map, routeLayer, markerLayer;
  var toastTimer = null;
  var editingVehicleId = null;
  var draggedRowInfo = null; // { group, index } — sürükle-bırakta hangi araç grubunun hangi satırı taşınıyor

  var el = {};

  /* ---------------------------------------------------------
     Yardımcılar
     --------------------------------------------------------- */
  function $(id) { return document.getElementById(id); }

  // Lokasyon adı, plaka, model, erişim saati gibi alanlar kullanıcıdan veya
  // Excel'den geliyor — güvenilmez. innerHTML'e yazılmadan önce kaçışlanmalı,
  // aksi halde kötü niyetli bir isim/hücre sayfada script çalıştırabilir (XSS).
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(message, kind) {
    el.toast.textContent = message;
    el.toast.className = 'toast' + (kind ? ' is-' + kind : '');
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 4000);
  }

  function setLoading(on, text) {
    el.loading.hidden = !on;
    if (text) el.loadingText.textContent = text;
  }

  function km(meters) { return (meters / 1000).toFixed(1); }

  // Trafik katsayısı için hafta içi/hafta sonu ayrımı — uygulamada tarih
  // seçimi yok, "bugün" planlanıyor varsayılıyor (aynı gün sefer planlama aracı).
  function isWeekendToday() {
    var day = new Date().getDay(); // 0=Pazar, 6=Cumartesi
    return day === 0 || day === 6;
  }

  function durationLabel(seconds) {
    var m = Math.round(seconds / 60);
    var h = Math.floor(m / 60);
    return h > 0 ? h + ' sa ' + (m % 60) + ' dk' : m + ' dk';
  }

  function actionLabel(kind) {
    if (kind === 'pickup') return 'Yükleme';
    if (kind === 'delivery') return 'Boşaltma';
    if (kind === 'start') return 'Hareket';
    return 'Dönüş';
  }

  // Bir aracın (grubun) rotasını Google Maps'in yol tarifi linkine çevirir:
  // başlangıç, aradaki duraklar (waypoints) ve son durak — optimize edilmiş sırayla.
  function buildGoogleMapsUrl(group, startLocation) {
    var nodes = (group.result.orderedNodes || []).filter(function (n) { return n.type !== 'start'; });
    if (!nodes.length) return null;

    function coord(loc) { return loc.lat + ',' + loc.lng; }

    var origin = startLocation;
    var destination = nodes[nodes.length - 1].location;
    var waypoints = nodes.slice(0, -1).map(function (n) { return n.location; });

    var url = 'https://www.google.com/maps/dir/?api=1' +
      '&origin=' + encodeURIComponent(coord(origin)) +
      '&destination=' + encodeURIComponent(coord(destination)) +
      '&travelmode=driving';
    if (waypoints.length) {
      url += '&waypoints=' + encodeURIComponent(waypoints.map(coord).join('|'));
    }
    return url;
  }

  /* ---------------------------------------------------------
     Harita
     --------------------------------------------------------- */
  function initMap() {
    if (typeof L === 'undefined') {
      document.getElementById('map').innerHTML =
        '<div class="map-fallback">Harita bileşeni yüklenemedi.<br>' +
        'vendor/leaflet/leaflet.js dosyasının klasörde olduğundan emin olun.</div>';
      return false;
    }
    // preferCanvas: rota çizgisi (polyline) canvas'a çizilir; PDF export'taki
    // html2canvas yakalaması SVG katmanını güvenilir okuyamıyor, canvas'ı okuyor.
    map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([41.05, 28.79], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true,
      attribution: '© OpenStreetMap katkıcıları'
    }).addTo(map);

    markerLayer = L.layerGroup().addTo(map);
    routeLayer = L.layerGroup().addTo(map);

    map.on('contextmenu', function (e) {
      openModal('modalLocations');
      $('locLat').value = e.latlng.lat.toFixed(6);
      $('locLng').value = e.latlng.lng.toFixed(6);
      $('locName').focus();
      toast('Koordinatlar dolduruldu. Lokasyona bir ad verin.');
    });

    return true;
  }

  // Birden fazla araç kullanıldığında her aracın güzergahı/duraklarını
  // ayırt etmek için döngüsel bir renk paleti.
  var GROUP_COLORS = ['#C90C0F', '#0F6FC9', '#1E8F5F', '#B8860B', '#7B3FA0', '#C9600F'];
  function groupColor(index) { return GROUP_COLORS[index % GROUP_COLORS.length]; }

  function markerIcon(label, variant, offset, color) {
    // offset: [dx, dy] piksel — sadece görseli kaydırır, işaretin coğrafi
    // konumu (Leaflet'in kendi hesapladığı) değişmez. Bu yüzden zoom
    // değiştikçe kayma büyümez, hep aynı sabit piksel kadar kalır.
    // color: yalnızca "normal" duraklarda (variant boşken) araca göre
    // işaret rengini değiştirmek için — hareket/ihlal renkleri sabit kalır.
    var styleParts = [];
    if (offset) styleParts.push('transform: translate(' + offset[0] + 'px,' + offset[1] + 'px)');
    if (color && !variant) styleParts.push('background:' + color);
    var style = styleParts.length ? ' style="' + styleParts.join(';') + '"' : '';
    return L.divIcon({
      className: '',
      html: '<div class="map-marker ' + variant + '"' + style + '>' + label + '</div>',
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });
  }

  function drawIdleMarkers() {
    if (!map) return;
    markerLayer.clearLayers();
    routeLayer.clearLayers();
    D.state.locations.forEach(function (loc) {
      L.marker([loc.lat, loc.lng], { icon: markerIcon('•', 'is-idle') })
        .bindTooltip(escapeHtml(loc.name), { direction: 'top' })
        .addTo(markerLayer);
    });
    fitToLocations();
  }

  function fitToLocations() {
    if (!map || !D.state.locations.length) return;
    var bounds = L.latLngBounds(D.state.locations.map(function (l) { return [l.lat, l.lng]; }));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  }

  function drawPlan(plan) {
    if (!map) return;
    markerLayer.clearLayers();
    routeLayer.clearLayers();

    var allGeometry = [];
    plan.groups.forEach(function (group, gi) {
      if (group.geometry && group.geometry.length) {
        L.polyline(group.geometry, { color: groupColor(gi), weight: 4, opacity: 0.85 }).addTo(routeLayer);
        allGeometry = allGeometry.concat(group.geometry);
      }
    });

    // Görünümü önce sabitle: yakın işaretleri ekranda ayrıştırmak için önce
    // o anki yakınlaştırma seviyesi belli olmalı (piksel mesafesi zoom'a bağlı).
    if (allGeometry.length) {
      map.fitBounds(L.latLngBounds(allGeometry), { padding: [40, 40], animate: false });
    } else {
      fitToLocations();
    }

    // Hareket noktası tüm araçlar için ortak — tek bir işaret olarak, hangi
    // araçların oradan kalktığını tooltip'te listeleyerek gösteriyoruz
    // (aksi halde aynı koordinatta grup sayısı kadar üst üste işaret olurdu).
    var startLoc = plan.startLocation;
    var startTip = '<strong>' + escapeHtml(startLoc.name) + '</strong><br>Hareket noktası<br>' +
      plan.groups.map(function (g) { return escapeHtml(g.vehicle.plate); }).join(', ');
    L.marker([startLoc.lat, startLoc.lng], { icon: markerIcon('H', 'is-start') })
      .bindTooltip(startTip, { direction: 'top' })
      .addTo(markerLayer);

    plan.groups.forEach(function (group, gi) {
      var color = groupColor(gi);
      var stopRows = group.result.rows.filter(function (row) { return row.kind !== 'start' && row.kind !== 'return'; });
      var offsets = computeMarkerOffsets(map, stopRows);

      stopRows.forEach(function (row, i) {
        var variant = row.issues.length ? 'is-warn' : '';
        var label = String(i + 1);
        var tip = '<strong>' + escapeHtml(row.location.name) + '</strong><br>' +
                  actionLabel(row.kind) +
                  (row.pallets ? ' · ' + row.pallets + ' palet' : '') +
                  '<br>' + escapeHtml(group.vehicle.plate) +
                  '<br>Varış: ' + Opt.secondsToTime(row.arrivalSec) +
                  (row.issues.length ? '<br><em>' + escapeHtml(row.issues.join(', ')) + '</em>' : '');
        L.marker([row.location.lat, row.location.lng], { icon: markerIcon(label, variant, offsets[i], color) })
          .bindTooltip(tip, { direction: 'top' })
          .addTo(markerLayer);
      });
    });
  }

  /* Aynı bina / çok yakın duraklar ekranda tek noktaya düşüp işaretler üst
     üste binebiliyor (numara okunmaz oluyor, biri diğerinin altında
     kayboluyor). Birbirine marker çapından yakın düşenler için küçük, SABİT
     piksel cinsinden bir kaydırma hesaplar (coğrafi konumu değil, sadece
     görseli kaydırır) — böylece zoom değiştikçe kayma coğrafi mesafeye
     dönüşüp büyümez, hep aynı küçük piksel miktarında kalır. */
  function computeMarkerOffsets(map, rows) {
    var MIN_PX = 26;
    var points = rows.map(function (row) {
      return map.latLngToContainerPoint([row.location.lat, row.location.lng]);
    });

    var used = [];
    for (var u = 0; u < points.length; u++) used.push(false);

    var groups = [];
    points.forEach(function (p, i) {
      if (used[i]) return;
      var group = [i];
      used[i] = true;
      for (var j = i + 1; j < points.length; j++) {
        if (!used[j] && p.distanceTo(points[j]) < MIN_PX) { group.push(j); used[j] = true; }
      }
      groups.push(group);
    });

    var offsets = rows.map(function () { return null; });
    groups.forEach(function (group) {
      if (group.length < 2) return;
      var radius = 16;
      group.forEach(function (idx, k) {
        var angle = (2 * Math.PI * k) / group.length;
        offsets[idx] = [radius * Math.cos(angle), radius * Math.sin(angle)];
      });
    });

    return offsets;
  }

  /* ---------------------------------------------------------
     Seçim listeleri
     --------------------------------------------------------- */
  function fillLocationSelect(select, keepValue) {
    var previous = keepValue ? select.value : null;
    select.innerHTML = '';
    D.state.locations.forEach(function (loc) {
      var opt = document.createElement('option');
      opt.value = loc.id;
      opt.textContent = loc.name;
      select.appendChild(opt);
    });
    if (previous && D.getLocation(previous)) select.value = previous;
  }

  function refreshSelects() {
    fillLocationSelect(el.selStart, true);
    fillLocationSelect(el.selStopLocation, true);
    updateCapacity();
  }

  /* ---------------------------------------------------------
     Özel açılır menü (native <select> yerine)
     Native <select>'in açık haldeki opsiyon listesi CSS ile
     stillendirilemiyor — tarayıcı/işletim sistemi kendi (mavi vurgulu,
     sistem fontlu) menüsünü çiziyor. Bunun yerine <select>'i veri/`value`
     kaynağı olarak DOM'da saklı tutup görünmez bırakıyoruz; kullanıcı
     tasarım sistemine uygun stillenmiş bir buton + liste (role="listbox")
     ile etkileşime giriyor. Var olan .value / change-event tabanlı kod
     hiç değişmeden çalışmaya devam ediyor.
     --------------------------------------------------------- */
  var openDropdownCloser = null;
  var tssSelectSeq = 0;

  function enhanceSelect(select) {
    if (!select || select._tssEnhanced) return select ? select._tssWrap : null;
    select._tssEnhanced = true;

    var isSm = select.classList.contains('input-sm');
    var nativeClass = select.className; // trigger'a kopyalanacak — .input/.input-sm görünümünü korur

    var wrap = document.createElement('div');
    wrap.className = 'tss-select';
    if (select.parentNode) select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);

    select.classList.add('tss-select-native');
    select.tabIndex = -1;
    // Label'a ("for=id") tıklanınca native select odak alır — bu odağı
    // hemen görünür tetikleyici butona devrediyoruz, böylece label
    // tıklaması hâlâ işe yarıyor.
    select.addEventListener('focus', function () { trigger.focus(); });

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = nativeClass + ' tss-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    var valueSpan = document.createElement('span');
    valueSpan.className = 'tss-select-value';
    var caret = document.createElement('span');
    caret.className = 'tss-select-caret';
    caret.setAttribute('aria-hidden', 'true');
    trigger.appendChild(valueSpan);
    trigger.appendChild(caret);
    wrap.appendChild(trigger);

    var menu = document.createElement('ul');
    menu.className = 'tss-select-menu' + (isSm ? ' tss-select-menu-sm' : '');
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    menu.id = 'tssSelectMenu' + (++tssSelectSeq);
    document.body.appendChild(menu);
    trigger.setAttribute('aria-controls', menu.id);

    var activeIndex = -1;

    function syncFromSelect() {
      var selected = select.options[select.selectedIndex];
      valueSpan.textContent = selected ? selected.textContent : '';
      Array.prototype.forEach.call(menu.children, function (li, i) {
        var isSel = i === select.selectedIndex;
        li.classList.toggle('is-selected', isSel);
        li.setAttribute('aria-selected', isSel ? 'true' : 'false');
      });
      trigger.disabled = select.disabled;
    }

    function rebuildOptions() {
      menu.innerHTML = '';
      Array.prototype.forEach.call(select.options, function (opt, i) {
        var li = document.createElement('li');
        li.className = 'tss-select-option';
        li.setAttribute('role', 'option');
        li.id = menu.id + '-opt-' + i;
        li.textContent = opt.textContent;
        if (opt.disabled) li.setAttribute('aria-disabled', 'true');
        menu.appendChild(li);
      });
      syncFromSelect();
    }

    function setActive(i) {
      var items = menu.children;
      if (!items.length) return;
      i = Math.max(0, Math.min(items.length - 1, i));
      activeIndex = i;
      Array.prototype.forEach.call(items, function (li, idx) {
        li.classList.toggle('is-active', idx === i);
      });
      trigger.setAttribute('aria-activedescendant', items[i].id);
      items[i].scrollIntoView({ block: 'nearest' });
    }

    function selectIndex(i) {
      var opt = select.options[i];
      if (!opt || opt.disabled) return;
      select.selectedIndex = i;
      syncFromSelect();
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function positionMenu() {
      menu.style.maxHeight = '240px';
      var r = trigger.getBoundingClientRect();
      menu.style.left = r.left + 'px';
      menu.style.minWidth = r.width + 'px';
      var spaceBelow = window.innerHeight - r.bottom - 8;
      var spaceAbove = r.top - 8;
      var needed = Math.min(240, menu.scrollHeight);
      if (needed > spaceBelow && spaceAbove > spaceBelow) {
        menu.style.top = 'auto';
        menu.style.bottom = (window.innerHeight - r.top + 4) + 'px';
        menu.style.maxHeight = Math.max(120, spaceAbove) + 'px';
      } else {
        menu.style.bottom = 'auto';
        menu.style.top = (r.bottom + 4) + 'px';
        menu.style.maxHeight = Math.max(120, spaceBelow) + 'px';
      }
    }

    function onDocMouseDown(e) {
      if (!wrap.contains(e.target) && !menu.contains(e.target)) closeMenu(false);
    }
    function onReflow() { closeMenu(false); }
    function onMenuKeydown(e) {
      switch (e.key) {
        case 'Escape': e.preventDefault(); closeMenu(true); break;
        case 'ArrowDown': e.preventDefault(); setActive(activeIndex + 1); break;
        case 'ArrowUp': e.preventDefault(); setActive(activeIndex - 1); break;
        case 'Home': e.preventDefault(); setActive(0); break;
        case 'End': e.preventDefault(); setActive(menu.children.length - 1); break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (activeIndex >= 0) { selectIndex(activeIndex); closeMenu(true); }
          break;
        case 'Tab':
          closeMenu(false);
          break;
      }
    }

    function openMenu() {
      if (trigger.disabled || !menu.hidden) return;
      if (openDropdownCloser) openDropdownCloser();
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      setActive(select.selectedIndex >= 0 ? select.selectedIndex : 0);
      positionMenu();
      document.addEventListener('mousedown', onDocMouseDown, true);
      document.addEventListener('keydown', onMenuKeydown, true);
      window.addEventListener('resize', onReflow);
      document.addEventListener('scroll', onReflow, true);
      openDropdownCloser = function () { closeMenu(false); };
    }

    function closeMenu(focusTrigger) {
      if (menu.hidden) return;
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-activedescendant');
      document.removeEventListener('mousedown', onDocMouseDown, true);
      document.removeEventListener('keydown', onMenuKeydown, true);
      window.removeEventListener('resize', onReflow);
      document.removeEventListener('scroll', onReflow, true);
      if (openDropdownCloser) openDropdownCloser = null;
      if (focusTrigger) trigger.focus();
    }

    trigger.addEventListener('click', function () {
      if (menu.hidden) openMenu(); else closeMenu(true);
    });
    trigger.addEventListener('keydown', function (e) {
      if (menu.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        openMenu();
      }
    });
    menu.addEventListener('click', function (e) {
      var li = e.target.closest ? e.target.closest('.tss-select-option') : null;
      if (!li) return;
      selectIndex(Array.prototype.indexOf.call(menu.children, li));
      closeMenu(true);
    });
    menu.addEventListener('mousemove', function (e) {
      var li = e.target.closest ? e.target.closest('.tss-select-option') : null;
      if (!li) return;
      var idx = Array.prototype.indexOf.call(menu.children, li);
      if (idx !== activeIndex) setActive(idx);
    });

    new MutationObserver(rebuildOptions).observe(select, { childList: true });
    rebuildOptions();

    select._tssWrap = wrap;
    // Kod (favori rota yükleme gibi) select.value'yu doğrudan atadığında
    // (bir option ekleme/çıkarma olmadan) MutationObserver tetiklenmez —
    // bu durumlarda tetikleyicinin görünen metnini elle senkronlamak için.
    select._tssSync = syncFromSelect;
    return wrap;
  }

  /* ---------------------------------------------------------
     Kapasite
     --------------------------------------------------------- */
  // Artık tek bir araç önceden seçilmiyor — hangi aracın/araçların
  // kullanılacağına "Rotayı Planla" sırasında js/fleet.js karar veriyor.
  // Bu yüzden sol paneldeki çubuk, seçilen aracın değil FİLONUN toplam
  // kullanılabilir kapasitesini gösterir.
  function initialLoad() { return Math.max(0, Math.floor(Number(el.inpInitialLoad.value) || 0)); }

  function updateCapacity() {
    var cap = D.totalFleetCapacity();
    var planned = initialLoad() + D.totalPickups();

    el.capacityText.textContent = planned + ' / ' + cap + ' palet';
    var pct = cap > 0 ? Math.min(100, (planned / cap) * 100) : 0;
    el.capacityFill.style.width = pct + '%';
    el.capacityFill.classList.toggle('is-full', planned >= cap && cap > 0);
    el.capacityFill.classList.toggle('has-fill', pct > 0);
  }

  function validateStopAddition(type, pallets) {
    var fleetCap = D.totalFleetCapacity();
    if (fleetCap <= 0) return 'Sistemde kullanılabilir kapasitesi olan araç yok.';

    // NOT: Tek bir durağın palet miktarı filodaki en büyük aracın kapasitesini
    // aşabilir — bu ARTIK burada engellenmiyor. js/fleet.js (assignFleet →
    // distributeBigStop) böyle bir durağı otomatik olarak birden fazla araca
    // PAYLAŞTIRIYOR (aynı lokasyona birden fazla araç uğrayıp kendi payını
    // taşıyor), tıpkı yüklemelerin coğrafi kümelemeyle farklı araçlara
    // dağıtılması gibi. Sadece filo TOPLAMI gerçekten yetersizse (bkz. aşağı)
    // ya da yüklenen/boşaltılan toplamlar tutmuyorsa engelleniyor.

    if (type === 'pickup') {
      var plannedLoad = initialLoad() + D.totalPickups() + pallets;
      if (plannedLoad > fleetCap) {
        return 'Filo kapasitesi yetersiz. Toplam kullanılabilir kapasite ' +
               fleetCap + ' palet, bu durakla birlikte ' + plannedLoad + ' palete çıkıyor.';
      }
    } else {
      var available = initialLoad() + D.totalPickups();
      if (D.totalDeliveries() + pallets > available) {
        return 'Boşaltma miktarı yüklenen palet sayısını aşıyor. Toplamda ' +
               available + ' palet yüklenmiş olacak.';
      }
    }
    return null;
  }

  /* ---------------------------------------------------------
     Durak listesi
     --------------------------------------------------------- */
  function renderStops() {
    el.stopList.innerHTML = '';
    el.stopEmpty.hidden = D.state.stops.length > 0;
    el.stopCountHint.textContent = D.state.stops.length + ' durak';

    D.state.stops.forEach(function (stop) {
      var loc = D.getLocation(stop.locationId);
      if (!loc) return;

      var li = document.createElement('li');
      li.className = 'stop-item';

      var main = document.createElement('div');
      main.className = 'stop-item-main';
      main.innerHTML = '<div class="stop-item-name">' + escapeHtml(loc.name) + '</div>' +
                       '<div class="stop-item-meta">' + stop.pallets + ' palet</div>';

      var badge = document.createElement('span');
      badge.className = 'badge ' + (stop.type === 'pickup' ? 'badge-pickup' : 'badge-delivery');
      badge.textContent = actionLabel(stop.type);

      var remove = document.createElement('button');
      remove.className = 'btn-icon btn-icon-danger';
      remove.type = 'button';
      remove.textContent = 'Sil';
      remove.addEventListener('click', function () {
        D.removeStop(stop.id);
        renderStops();
        updateCapacity();
      });

      li.appendChild(main);
      li.appendChild(badge);
      li.appendChild(remove);
      el.stopList.appendChild(li);
    });
  }

  /* ---------------------------------------------------------
     Planlama
     --------------------------------------------------------- */
  // Tanı amaçlı: OSRM'den gelen gerçek sürüş mesafelerini (km) konsola
  // tablo olarak yazar. "Neden bu sıra seçildi?" sorusunu, kuş uçuşu
  // yakınlıkla değil gerçek yol ağı mesafesiyle kıyaslayarak yanıtlamak için.
  function logDistanceMatrix(points, distances) {
    var labels = points.map(function (p) { return p.name; });
    var table = {};
    labels.forEach(function (rowLabel, i) {
      var row = {};
      labels.forEach(function (colLabel, j) {
        row[colLabel] = i === j ? '—' : km(distances[i][j]) + ' km';
      });
      table[rowLabel] = row;
    });
    console.log('[TSS] OSRM mesafe matrisi (gerçek sürüş mesafesi, km):');
    console.table(table);
  }

  // Rota planlama artık TEK bir seçili araçla sınırlı değil: js/fleet.js
  // önce duraklar tek araca sığar mı diye bakar, sığmıyorsa gerektiği kadar
  // araca (coğrafi kümeleyerek, hiçbir araç iki kez kullanılmadan) böler.
  // Her araç grubu için sıralama kararı yine dokunulmamış js/optimizer.js'ten çıkar.
  function planRoute() {
    if (!D.state.stops.length) { toast('En az bir durak ekleyin.', 'error'); return; }
    if (!D.state.vehicles.length) { toast('Sistemde tanımlı araç yok.', 'error'); return; }

    var startLocation = D.getLocation(el.selStart.value);
    if (!startLocation) { toast('Hareket noktası seçin.', 'error'); return; }

    var stops = D.state.stops.map(function (s) {
      return { location: D.getLocation(s.locationId), type: s.type, pallets: s.pallets, stopId: s.id };
    }).filter(function (s) { return s.location; });

    var points = [startLocation].concat(stops.map(function (s) { return s.location; }));
    var isWeekend = isWeekendToday();
    // 'distance' (varsayılan) = mevcut davranış birebir aynı, hiçbir yeni istek
    // atılmaz. 'duration' seçiliyse sıralama kararı hâlâ OSRM'in ücretsiz
    // matrix'inden çıkar, ama son rotanın bacakları için ayrıca TomTom'dan
    // canlı trafik verisi istenir (bkz. refineGroupWithLiveTraffic).
    var costMetric = (el.selCostMetric && el.selCostMetric.value === 'duration') ? 'duration' : 'distance';

    setLoading(true, 'Mesafe matrisi alınıyor…');

    Osrm.matrix(points)
      .then(function (m) {
        logDistanceMatrix(points, m.distances);
        setLoading(true, 'Araç ataması ve en uygun sıralama hesaplanıyor…');

        var assignment = Fleet.assignFleet({
          startLocation: startLocation,
          stops: stops,
          vehicles: D.state.vehicles,
          matrix: m,
          serviceMinutes: Number(el.inpService.value) || 0,
          departureTime: el.inpDeparture.value || '08:00',
          initialLoad: initialLoad(),
          traffic: D.getTrafficSettings(),
          isWeekend: isWeekend,
          history: D.getHistory(),
          costMetric: costMetric
        });

        var plan = {
          startLocation: startLocation,
          isWeekend: isWeekend,
          groups: assignment.groups,
          warning: assignment.warning,
          note: ''
        };

        setLoading(true, 'Güzergah çiziliyor…');
        return Promise.all(plan.groups.map(function (group) { return fetchGroupGeometry(plan, group); }))
          .then(function () { return plan; });
      })
      .then(function (plan) {
        if (costMetric !== 'duration') return plan;
        var apiKey = D.getTomTomApiKey();
        if (!apiKey) return plan; // "En Az Süre" seçili ama key girilmemiş: sessizce OSRM ile devam

        setLoading(true, 'Canlı trafik verisi alınıyor (TomTom)…');
        return Promise.all(plan.groups.map(function (group) { return refineGroupWithLiveTraffic(plan, group, apiKey); }))
          .then(function (outcomes) {
            if (outcomes.some(function (ok) { return !ok; })) {
              toast('TomTom canlı trafik verisine ulaşılamadı (kota/bağlantı) — OSRM tahminleriyle devam edildi.', 'error');
            }
            return plan;
          });
      })
      .then(function (plan) {
        finalizePlan(plan);
        setLoading(false);

        var anyCapacity = plan.groups.some(function (g) { return g.result.capacityViolations > 0; });
        var anyTime = plan.groups.some(function (g) { return g.result.timeViolations > 0; });

        if (plan.warning) {
          toast(plan.warning, 'error');
        } else if (anyCapacity) {
          toast('Rota oluşturuldu ancak kapasite ihlali var. Tabloyu kontrol edin.', 'error');
        } else if (anyTime) {
          toast('Erişim saati kısıtı sağlanamadı. İhlaller tabloda işaretlendi.', 'error');
        } else if (plan.groups.length > 1) {
          toast(plan.groups.length + ' araçla rota planlandı. Tüm kısıtlar sağlanıyor.', 'success');
        } else {
          toast('Rota planlandı. Tüm kısıtlar sağlanıyor.', 'success');
        }
      })
      .catch(function (err) {
        setLoading(false);
        toast(err.message || 'Rota hesaplanamadı. İnternet bağlantısını kontrol edin.', 'error');
      });
  }

  // Bir grubun harita için gerçek güzergah geometrisini (yol ağını takip eden
  // çizgi) getirir. Alınamazsa düz çizgiye düşer — plan yine de kullanılabilir kalır.
  function fetchGroupGeometry(plan, group) {
    var ordered = [plan.startLocation]
      .concat(group.result.orderedNodes.map(function (n) { return n.location; }));
    return Osrm.route(ordered).then(function (r) {
      group.geometry = r.coordinates;
    }).catch(function () {
      group.geometry = ordered.map(function (l) { return [l.lat, l.lng]; });
    });
  }

  // "En Az Süre" modunda, optimizer.js'in ZATEN belirlediği durak sırasını
  // hiç değiştirmeden — sadece o sıradaki ardışık n bacak için (n² değil)
  // TomTom'dan canlı trafik dahil süre/mesafe/güzergah ister. Herhangi bir
  // bacak başarısız olursa (kota, ağ, geçersiz key) TÜM grup için sessizce
  // vazgeçilir ve OSRM'in zaten hesaplamış olduğu sonuç/geometri aynen kalır
  // — projenin "kısıt sağlanamasa da her zaman bir rota üret" felsefesiyle
  // tutarlı. Dönüş değeri: true = TomTom verisiyle güncellendi, false = OSRM'de kaldı.
  function refineGroupWithLiveTraffic(plan, group, apiKey) {
    if (!TomTom) return Promise.resolve(false);

    var ordered = [plan.startLocation]
      .concat(group.result.orderedNodes.map(function (n) { return n.location; }));
    var legPromises = [];
    for (var i = 1; i < ordered.length; i++) {
      legPromises.push(TomTom.routeLeg(ordered[i - 1], ordered[i], apiKey));
    }

    return Promise.all(legPromises).then(function (legs) {
      group.result = Fleet.replayGroupWithLiveLegs(group, legs, {
        departureTime: el.inpDeparture.value || '08:00',
        capacity: group.vehicle.usable,
        defaultServiceMinutes: Number(el.inpService.value) || 0
      });
      var geometry = [];
      legs.forEach(function (leg) { geometry = geometry.concat(leg.geometry); });
      group.geometry = geometry;
      return true;
    }).catch(function (err) {
      console.error('[TSS] TomTom canlı trafik alınamadı, bu grup OSRM tahminiyle kaldı:', err.message || err);
      return false;
    });
  }

  function netDriveSeconds(result) {
    var serviceTotal = result.rows.reduce(function (sum, row) {
      if (row.kind !== 'pickup' && row.kind !== 'delivery') return sum;
      return sum + (row.departureSec - row.arrivalSec);
    }, 0);
    return Math.max(0, result.totalSeconds - serviceTotal);
  }

  function buildGroupMeta(group) {
    return {
      distance: km(group.result.distance) + ' km',
      duration: durationLabel(group.result.totalSeconds),
      driveDuration: durationLabel(netDriveSeconds(group.result)),
      finish: Opt.secondsToTime(group.result.finishSec),
      departure: el.inpDeparture.value
    };
  }

  // Plan nesnesini tabloya/haritaya/özet kartlarına yansıtacak ortak son adım.
  // Hem ilk planlamada hem elle sıralama/palet/süre düzenlemesinden sonra kullanılır.
  function finalizePlan(plan) {
    plan.groups.forEach(function (group) {
      group.tableRows = buildTableRows(group.result);
      group.meta = buildGroupMeta(group);
    });
    D.state.plan = plan;
    drawPlan(plan);
    renderPlanGroups(plan);
    checkWeather(plan);
    renderFleetWarning(plan);
  }

  function renderFleetWarning(plan) {
    if (plan.warning) {
      el.fleetWarning.textContent = plan.warning;
      el.fleetWarning.hidden = false;
    } else {
      el.fleetWarning.hidden = true;
    }
  }

  // Rota planlandıktan/güncellendikten sonra, duraklara tahmini varış saatinde
  // hava durumu kontrolü yapar. Arka planda çalışır, planı hiç etkilemez —
  // servis yanıt vermezse veya yavaşsa uyarı kutusu boş kalır, hata göstermez.
  // Tüm araç gruplarının durakları birlikte kontrol edilir (hava durumu bir
  // aracın değil, lokasyonun/saatin özelliğidir).
  function checkWeather(plan) {
    var box = $('weatherWarnings');
    box.hidden = true;
    if (!Weather) return;

    var today = new Date();
    function arrivalDate(sec) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      d.setSeconds(d.getSeconds() + sec);
      return d;
    }

    var points = [];
    plan.groups.forEach(function (group) {
      group.result.rows
        .filter(function (row) { return row.kind !== 'start' && row.kind !== 'return'; })
        .forEach(function (row) {
          points.push({
            name: row.location.name,
            lat: row.location.lat,
            lng: row.location.lng,
            atDate: arrivalDate(row.arrivalSec)
          });
        });
    });
    if (!points.length) return;

    Weather.checkPoints(points).then(function (warnings) {
      if (D.state.plan !== plan) return; // bu arada başka bir plan yapılmış olabilir
      renderWeatherWarnings(warnings);
    }).catch(function () { /* sessiz geç */ });
  }

  function renderWeatherWarnings(warnings) {
    var box = $('weatherWarnings');
    var items = box.querySelectorAll('.weather-warning-item');
    items.forEach(function (node) { node.remove(); });

    if (!warnings.length) { box.hidden = true; return; }

    warnings.forEach(function (w) {
      var p = document.createElement('p');
      p.className = 'weather-warning-item';
      p.textContent = w.message;
      box.appendChild(p);
    });
    box.hidden = false;
  }

  // Bir grubun sırasını DEĞİŞTİRMEDEN zaman çizelgesini yeniden oynatır
  // (js/fleet.js → replayGroup, optimizer'ın sıralama mantığına dokunmaz).
  function replayGroupResult(plan, group) {
    return Fleet.replayGroup(group, {
      departureTime: el.inpDeparture.value || '08:00',
      capacity: group.vehicle.usable,
      traffic: D.getTrafficSettings(),
      isWeekend: plan.isWeekend,
      defaultServiceMinutes: Number(el.inpService.value) || 0
    });
  }

  // Palet/durak süresi/araç değişikliği: güzergah şekli etkilenmez (aynı
  // duraklar aynı sırada), o yüzden OSRM'e tekrar gidilmez — anında yeniden çizilir.
  function replayGroupOnly(plan, group) {
    group.result = replayGroupResult(plan, group);
    group.tableRows = buildTableRows(group.result);
    group.meta = buildGroupMeta(group);
    D.state.plan = plan;
    renderPlanGroups(plan);
    checkWeather(plan);
    renderStops();
    updateCapacity();
  }

  // Sürükle-bırak ile sıra değişikliği: duraklar arası mesafe/güzergah şekli
  // değiştiği için OSRM'den güzergah çizgisi tekrar alınır.
  function replayGroupAndRefreshGeometry(plan, group) {
    group.result = replayGroupResult(plan, group);
    group.tableRows = buildTableRows(group.result);
    group.meta = buildGroupMeta(group);

    setLoading(true, 'Güzergah çiziliyor…');
    fetchGroupGeometry(plan, group).then(function () {
      D.state.plan = plan;
      drawPlan(plan);
      renderPlanGroups(plan);
      checkWeather(plan);
      renderStops();
      updateCapacity();
      setLoading(false);
    });
  }

  function buildTableRows(result) {
    var rows = [];
    var counter = 0;
    result.rows.forEach(function (row) {
      var isStop = row.kind === 'pickup' || row.kind === 'delivery';
      if (isStop) counter++;
      // Trafik katsayısı uygulandıysa (rush hour/gece) saatin tahmini olduğunu
      // belirtmek için önüne "~" koyuyoruz — gerçek trafik verisi değil, kaba tahmin.
      var trafficApplied = !!row.trafficFactor && row.trafficFactor !== 1;
      var timePrefix = trafficApplied ? '~' : '';
      rows.push({
        no: row.kind === 'start' ? 'H' : (row.kind === 'return' ? 'D' : counter),
        location: row.location.name,
        action: actionLabel(row.kind),
        pallets: row.pallets || '—',
        load: row.load,
        distance: row.legDistance ? km(row.legDistance) : '—',
        arrival: row.kind === 'start' ? '—' : timePrefix + Opt.secondsToTime(row.arrivalSec),
        departure: row.kind === 'return' ? '—' : timePrefix + Opt.secondsToTime(row.departureSec),
        serviceMinutes: isStop ? Math.round((row.departureSec - row.arrivalSec) / 60) : null,
        status: row.issues.length ? row.issues.join(' · ') : 'Uygun',
        warn: row.issues.length > 0,
        kind: row.kind
      });
    });
    return rows;
  }

  /* ---------------------------------------------------------
     Araç gruplarının render'ı (tablo + KPI kartları + araç değişimi)
     --------------------------------------------------------- */
  function renderPlanGroups(plan) {
    el.planGroups.innerHTML = '';
    var hasGroups = plan.groups.length > 0;
    el.tableEmpty.hidden = hasGroups;

    plan.groups.forEach(function (group, gi) {
      el.planGroups.appendChild(buildGroupBlock(plan, group, gi));
    });

    el.btnApproveRoute.disabled = !hasGroups;
    el.btnFavoriteRoute.disabled = !hasGroups;
    el.btnGoogleMaps.disabled = !hasGroups;
    el.btnExportExcel.disabled = !hasGroups;
    el.btnExportPdf.disabled = !hasGroups;
  }

  function buildSummaryCard(label, value) {
    var card = document.createElement('div');
    card.className = 'summary-card';
    var lab = document.createElement('span');
    lab.className = 'summary-label';
    lab.textContent = label;
    var val = document.createElement('strong');
    val.className = 'summary-value';
    val.textContent = value;
    card.appendChild(lab);
    card.appendChild(val);
    return card;
  }

  function buildGroupBlock(plan, group, gi) {
    var wrap = document.createElement('section');
    wrap.className = 'plan-group';

    var header = document.createElement('div');
    header.className = 'plan-group-header';

    var titleWrap = document.createElement('div');
    titleWrap.className = 'plan-group-title';
    var swatch = document.createElement('span');
    swatch.className = 'plan-group-swatch';
    swatch.style.background = groupColor(gi);
    titleWrap.appendChild(swatch);

    var stopCount = group.tableRows.filter(function (r) { return r.kind === 'pickup' || r.kind === 'delivery'; }).length;
    var palletTotal = group.stops.reduce(function (s, st) { return s + st.pallets; }, 0);
    var titleText = document.createElement('div');
    titleText.innerHTML = '<strong>' + escapeHtml(group.vehicle.plate) +
      (group.vehicle.model ? ' · ' + escapeHtml(group.vehicle.model) : '') + '</strong>' +
      '<span class="plan-group-meta">' + stopCount + ' durak · ' + palletTotal + ' palet' +
      (group.edited ? ' · elle düzenlendi' : '') + '</span>';
    titleWrap.appendChild(titleText);
    header.appendChild(titleWrap);

    var swapWrap = document.createElement('div');
    swapWrap.className = 'plan-group-swap';
    var swapLabel = document.createElement('label');
    swapLabel.className = 'label label-sm';
    swapLabel.textContent = 'Araç';
    var swapSelect = document.createElement('select');
    swapSelect.className = 'input input-sm';
    // Aynı plan içinde başka bir gruba zaten atanmış araç seçilemez (bir araç
    // bir seferde en fazla bir kez kullanılır).
    var usedElsewhere = plan.groups
      .filter(function (g) { return g !== group; })
      .map(function (g) { return g.vehicleId; });
    D.state.vehicles.forEach(function (v) {
      if (usedElsewhere.indexOf(v.id) !== -1) return;
      var opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.plate + ' · ' + (v.model || 'Araç') + ' · ' + v.usable + ' palet';
      swapSelect.appendChild(opt);
    });
    if (usedElsewhere.indexOf(group.vehicleId) === -1) swapSelect.value = group.vehicleId;
    swapSelect.addEventListener('change', function () {
      swapGroupVehicle(plan, group, swapSelect.value);
    });
    swapWrap.appendChild(swapLabel);
    swapWrap.appendChild(enhanceSelect(swapSelect));
    header.appendChild(swapWrap);

    wrap.appendChild(header);

    var summary = document.createElement('div');
    summary.className = 'summary';
    summary.appendChild(buildSummaryCard('Toplam Mesafe', group.meta.distance));
    summary.appendChild(buildSummaryCard('Toplam Süre', group.meta.duration));
    summary.appendChild(buildSummaryCard('Yol Süresi', group.meta.driveDuration));
    summary.appendChild(buildSummaryCard('Bitiş Saati', group.meta.finish));
    wrap.appendChild(summary);

    var tableWrap = document.createElement('div');
    tableWrap.className = 'table-wrap';
    var table = document.createElement('table');
    // route-table: sabit sütun genişlikleri (table-layout:fixed + colgroup) —
    // aksi halde 9 sütun + palet/durak süresi input'ları toplam genişliği
    // taşırıp panelin altında yatay kaydırma çubuğu çıkarıyordu.
    table.className = 'data-table route-table';
    table.innerHTML = '<colgroup>' +
      '<col style="width:5%"><col style="width:21%"><col style="width:11%">' +
      '<col style="width:10%"><col style="width:8%"><col style="width:9%">' +
      '<col style="width:10%"><col style="width:14%"><col style="width:12%">' +
      '</colgroup>' +
      '<thead><tr>' +
      '<th>#</th><th>Lokasyon</th><th>İşlem</th><th class="center">Palet</th>' +
      '<th class="num">Yük</th><th class="num">Mesafe</th><th>Varış</th>' +
      '<th class="center">Durak Süresi (dk)</th><th>Ayrılış</th></tr></thead>';
    var tbody = document.createElement('tbody');
    group.tableRows.forEach(function (r, idx) {
      tbody.appendChild(buildGroupRow(plan, group, r, idx));
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    wrap.appendChild(tableWrap);

    if (!group.result.feasible) {
      var warn = document.createElement('p');
      warn.className = 'inline-error';
      warn.hidden = false;
      warn.textContent = group.result.capacityViolations > 0
        ? 'Bu araçta kapasite ihlali var — palet dağılımını veya aracı kontrol edin.'
        : 'Erişim saati kısıtı sağlanamıyor — ilgili duraklar tabloda işaretli.';
      wrap.appendChild(warn);
    }

    return wrap;
  }

  function buildGroupRow(plan, group, r, idx) {
    var tr = document.createElement('tr');
    if (r.kind === 'start') tr.className = 'row-start';
    if (r.warn) tr.className = 'row-warn';
    // Durum sütunu kaldırıldı (yatay kaydırmayı azaltmak için) — kısıt
    // ihlali bilgisi hâlâ satırın kırmızımsı rengiyle ve title ipucuyla var.
    if (r.warn) tr.title = r.status;

    var isStopRow = r.kind === 'pickup' || r.kind === 'delivery';

    appendTextCell(tr, r.no);
    appendTextCell(tr, r.location, 'cell-name');
    appendTextCell(tr, r.action);

    var tdPallets = document.createElement('td');
    tdPallets.className = 'center';
    if (isStopRow) {
      tdPallets.appendChild(buildPalletInput(tr, plan, group, idx, r.pallets));
    } else {
      tdPallets.textContent = r.pallets;
    }
    tr.appendChild(tdPallets);

    appendTextCell(tr, r.load, 'num');
    appendTextCell(tr, r.distance, 'num');
    appendTextCell(tr, r.arrival);

    var tdService = document.createElement('td');
    tdService.className = 'center';
    if (isStopRow) {
      tdService.appendChild(buildServiceInput(tr, plan, group, idx, r.serviceMinutes));
    } else {
      tdService.textContent = '—';
    }
    tr.appendChild(tdService);

    appendTextCell(tr, r.departure);

    if (isStopRow) {
      tr.classList.add('row-draggable');
      attachRowDragHandlers(tr, plan, group, idx);
    }

    return tr;
  }

  function appendTextCell(tr, value, className) {
    var td = document.createElement('td');
    if (className) td.className = className;
    td.textContent = value;
    tr.appendChild(td);
    return td;
  }

  function buildPalletInput(tr, plan, group, tableIdx, rawValue) {
    var input = document.createElement('input');
    input.type = 'number';
    input.className = 'input input-sm';
    input.min = 1;
    input.step = 1;
    // Rota tablosunun sütun genişlikleri sabit değil (otomatik hesaplanıyor).
    // Input %100 genişlikte olunca bu hesaba "yer talebi" olarak katkı sağlamıyor
    // ve Palet sütunu neredeyse sıfıra kadar daralabiliyor — rakam görünmüyordu.
    // Sabit bir piksel genişlik vererek sütunun gerçek ihtiyacını garanti ediyoruz.
    input.style.width = '52px';
    // Sayısal olmayan bir değer (ör. "—") number input'a atanırsa tarayıcı
    // kutuyu sessizce boşaltır — o yüzden önce geçerli bir tam sayıya çeviriyoruz.
    var n = Math.floor(Number(rawValue));
    input.value = isFinite(n) && n > 0 ? n : 1;
    // Sürüklenebilir satırın içinde input'a tıklarken sürükleme başlamasın.
    input.addEventListener('mousedown', function (e) { e.stopPropagation(); tr.draggable = false; });
    input.addEventListener('focus', function () { tr.draggable = false; });
    input.addEventListener('blur', function () { tr.draggable = true; });
    input.addEventListener('change', function () {
      updateGroupStopPallets(plan, group, tableIdx, input.value);
    });
    return input;
  }

  // Elle durak süresi (dk) düzenlemesi: js/optimizer.js'e hiç dokunmadan,
  // group.serviceOverrides üstünden replayGroup ile ileri yönlü yeniden hesaplanır.
  function buildServiceInput(tr, plan, group, tableIdx, minutes) {
    var input = document.createElement('input');
    input.type = 'number';
    input.className = 'input input-sm';
    input.min = 0;
    input.step = 5;
    input.style.width = '64px';
    input.value = minutes != null ? minutes : Number(el.inpService.value) || 0;
    input.addEventListener('mousedown', function (e) { e.stopPropagation(); tr.draggable = false; });
    input.addEventListener('focus', function () { tr.draggable = false; });
    input.addEventListener('blur', function () { tr.draggable = true; });
    input.addEventListener('change', function () {
      updateGroupStopService(plan, group, tableIdx, input.value);
    });
    return input;
  }

  /* Rota tablosu satırlarını sürükle-bırak ile yeniden sıralama. tableIdx,
     grubun tableRows içindeki satır sırasıdır (0 = Hareket satırı, hiç
     sürüklenebilir değildir; 1..n = duraklar, group.order ile 1 kaydırmalı eşleşir).
     Sürükleme yalnızca AYNI araç grubunun kendi satırları arasında geçerli —
     duraklar araç grupları arasında elle taşınamaz (araç değişimi ayrı, üstteki
     "Araç" seçiminden yapılır). */
  function attachRowDragHandlers(tr, plan, group, tableIdx) {
    tr.draggable = true;
    tr.addEventListener('dragstart', function (e) {
      draggedRowInfo = { group: group, index: tableIdx };
      tr.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(tableIdx)); } catch (err) { /* yoksay */ }
      }
    });
    tr.addEventListener('dragend', function () {
      tr.classList.remove('is-dragging');
      draggedRowInfo = null;
    });
    tr.addEventListener('dragover', function (e) {
      if (!draggedRowInfo || draggedRowInfo.group !== group) return;
      e.preventDefault();
      tr.classList.add('is-drop-target');
    });
    tr.addEventListener('dragleave', function () {
      tr.classList.remove('is-drop-target');
    });
    tr.addEventListener('drop', function (e) {
      e.preventDefault();
      tr.classList.remove('is-drop-target');
      if (!draggedRowInfo || draggedRowInfo.group !== group || draggedRowInfo.index === tableIdx) return;
      reorderGroupRows(plan, group, draggedRowInfo.index, tableIdx);
    });
  }

  function reorderGroupRows(plan, group, fromTableIdx, toTableIdx) {
    var order = group.order.slice();
    var fromPos = fromTableIdx - 1;
    var toPos = toTableIdx - 1;
    if (fromPos < 0 || toPos < 0 || fromPos >= order.length || toPos >= order.length) return;
    var moved = order.splice(fromPos, 1)[0];
    order.splice(toPos, 0, moved);
    group.order = order;
    group.edited = true;
    replayGroupAndRefreshGeometry(plan, group);
  }

  function updateGroupStopPallets(plan, group, tableIdx, value) {
    var pos = tableIdx - 1;
    var nodeIdx = group.order[pos];
    if (nodeIdx === undefined) return;
    var pallets = Math.max(1, Math.floor(Number(value) || 1));
    group.localNodes[nodeIdx].pallets = pallets;
    if (group.localNodes[nodeIdx].stopId) {
      D.updateStopPallets(group.localNodes[nodeIdx].stopId, pallets);
    }
    group.edited = true;
    replayGroupOnly(plan, group);
  }

  function updateGroupStopService(plan, group, tableIdx, value) {
    var pos = tableIdx - 1;
    var nodeIdx = group.order[pos];
    if (nodeIdx === undefined) return;
    var minutes = Math.max(0, Math.floor(Number(value) || 0));
    group.serviceOverrides[nodeIdx] = minutes;
    group.edited = true;
    replayGroupOnly(plan, group);
  }

  // Rota onaylanmadan önce, o gruba atanmış aracı elle değiştirme. Durak
  // sırası/kümesi AYNI kalır — sadece plakayı değiştirir. Kapasite yetmezse
  // engellemez, kısıt ihlalini tabloda işaretleyip uyarı gösterir.
  function swapGroupVehicle(plan, group, newVehicleId) {
    var veh = D.getVehicle(newVehicleId);
    if (!veh || veh.id === group.vehicleId) return;
    group.vehicle = veh;
    group.vehicleId = veh.id;
    group.edited = true;
    replayGroupOnly(plan, group);
    if (group.result.capacityViolations > 0) {
      toast(veh.plate + ' için kapasite yetersiz — kısıt ihlali tabloda işaretlendi.', 'error');
    } else {
      toast('Araç değiştirildi: ' + veh.plate, 'success');
    }
  }

  function clearPlan() {
    D.clearStops();
    D.state.plan = null;
    renderStops();
    updateCapacity();
    el.planGroups.innerHTML = '';
    el.tableEmpty.hidden = false;
    $('weatherWarnings').hidden = true;
    el.fleetWarning.hidden = true;
    el.btnApproveRoute.disabled = true;
    el.btnFavoriteRoute.disabled = true;
    el.btnGoogleMaps.disabled = true;
    el.btnExportExcel.disabled = true;
    el.btnExportPdf.disabled = true;
    drawIdleMarkers();
  }

  /* ---------------------------------------------------------
     Yönetim ekranları
     --------------------------------------------------------- */
  function openModal(id) { $(id).hidden = false; }
  function closeModal(id) { $(id).hidden = true; }

  function renderLocationTable() {
    var body = $('locationTableBody');
    body.innerHTML = '';
    D.state.locations.forEach(function (loc) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="cell-name">' + escapeHtml(loc.name) + '</td>' +
        '<td>' + loc.lat.toFixed(6) + '</td>' +
        '<td>' + loc.lng.toFixed(6) + '</td>' +
        '<td>' + escapeHtml(loc.from) + ' – ' + escapeHtml(loc.until) + '</td>';

      var td = document.createElement('td');
      var btn = document.createElement('button');
      btn.className = 'btn-icon btn-icon-danger';
      btn.textContent = 'Sil';
      btn.addEventListener('click', function () {
        D.removeLocation(loc.id);
        renderLocationTable();
        refreshSelects();
        renderStops();
        drawIdleMarkers();
      });
      td.appendChild(btn);
      tr.appendChild(td);
      body.appendChild(tr);
    });
  }

  function renderVehicleTable() {
    var body = $('vehicleTableBody');
    body.innerHTML = '';
    D.state.vehicles.forEach(function (veh) {
      var tr = document.createElement('tr');
      var isEditing = veh.id === editingVehicleId;

      if (isEditing) {
        var tdPlate = document.createElement('td');
        var inpPlate = document.createElement('input');
        inpPlate.type = 'text';
        inpPlate.className = 'input input-sm';
        inpPlate.value = veh.plate;
        tdPlate.appendChild(inpPlate);
        tr.appendChild(tdPlate);

        var tdModel = document.createElement('td');
        var inpModel = document.createElement('input');
        inpModel.type = 'text';
        inpModel.className = 'input input-sm';
        inpModel.value = veh.model || '';
        tdModel.appendChild(inpModel);
        tr.appendChild(tdModel);

        var tdCapacity = document.createElement('td');
        tdCapacity.className = 'center';
        var inpCapacity = document.createElement('input');
        inpCapacity.type = 'number';
        inpCapacity.className = 'input input-sm';
        inpCapacity.min = 1;
        inpCapacity.step = 1;
        inpCapacity.value = veh.capacity;
        tdCapacity.appendChild(inpCapacity);
        tr.appendChild(tdCapacity);

        var tdUsable = document.createElement('td');
        tdUsable.className = 'center';
        tdUsable.textContent = veh.usable;
        tr.appendChild(tdUsable);

        var tdAction = document.createElement('td');
        tdAction.className = 'center';
        var btnSave = document.createElement('button');
        btnSave.className = 'btn-icon';
        btnSave.textContent = 'Kaydet';
        btnSave.addEventListener('click', function () {
          try {
            D.updateVehicle(veh.id, {
              plate: inpPlate.value,
              model: inpModel.value,
              capacity: inpCapacity.value
            });
            editingVehicleId = null;
            renderVehicleTable();
            refreshSelects();
            updateCapacity();
          } catch (e) {
            toast(e.message, 'error');
          }
        });
        var btnCancel = document.createElement('button');
        btnCancel.className = 'btn-icon';
        btnCancel.textContent = 'İptal';
        btnCancel.addEventListener('click', function () {
          editingVehicleId = null;
          renderVehicleTable();
        });
        tdAction.appendChild(btnSave);
        tdAction.appendChild(btnCancel);
        tr.appendChild(tdAction);

        [inpPlate, inpModel, inpCapacity].forEach(function (inp) {
          inp.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); btnSave.click(); }
            else if (e.key === 'Escape') { e.preventDefault(); btnCancel.click(); }
          });
        });

        body.appendChild(tr);
        inpPlate.focus();
        inpPlate.select();
        return;
      }

      tr.innerHTML =
        '<td class="cell-name">' + escapeHtml(veh.plate) + '</td>' +
        '<td>' + escapeHtml(veh.model || '—') + '</td>' +
        '<td class="center">' + veh.capacity + '</td>';

      var tdUsable = document.createElement('td');
      tdUsable.className = 'center';
      var input = document.createElement('input');
      input.type = 'number';
      input.className = 'input input-sm';
      input.value = veh.usable;
      input.min = 1;
      input.max = veh.capacity;
      input.addEventListener('change', function () {
        D.setUsableCapacity(veh.id, input.value);
        input.value = D.getVehicle(veh.id).usable;
        updateCapacity();
      });
      tdUsable.appendChild(input);
      tr.appendChild(tdUsable);

      var tdAction = document.createElement('td');
      tdAction.className = 'center';
      var btnEdit = document.createElement('button');
      btnEdit.className = 'btn-icon';
      btnEdit.textContent = 'Düzenle';
      btnEdit.addEventListener('click', function () {
        editingVehicleId = veh.id;
        renderVehicleTable();
      });
      var btn = document.createElement('button');
      btn.className = 'btn-icon btn-icon-danger';
      btn.textContent = 'Sil';
      btn.addEventListener('click', function () {
        D.removeVehicle(veh.id);
        if (editingVehicleId === veh.id) editingVehicleId = null;
        renderVehicleTable();
        refreshSelects();
      });
      tdAction.appendChild(btnEdit);
      tdAction.appendChild(btn);
      tr.appendChild(tdAction);

      body.appendChild(tr);
    });
  }

  function formatDateTime(ts) {
    var d = new Date(ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' +
           p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function renderHistoryTable() {
    var body = $('historyTableBody');
    body.innerHTML = '';
    var history = D.getHistory();
    $('historyEmpty').hidden = history.length > 0;
    $('btnExportHistoryExcel').disabled = history.length === 0;
    $('btnExportHistoryPdf').disabled = history.length === 0;

    history.forEach(function (h) {
      var tr = document.createElement('tr');

      appendTextCell(tr, formatDateTime(h.approvedAt));
      appendTextCell(tr, h.vehicleSummary || (h.vehicles || []).map(function (v) { return v.plate; }).join(', '));
      appendTextCell(tr, h.start, 'cell-name');
      appendTextCell(tr, h.stopCount, 'center');
      appendTextCell(tr, h.distance, 'num');
      appendTextCell(tr, h.duration, 'num');

      var tdAction = document.createElement('td');
      tdAction.className = 'center';
      var btn = document.createElement('button');
      btn.className = 'btn-icon btn-icon-danger';
      btn.textContent = 'Sil';
      btn.addEventListener('click', function () {
        D.removeHistoryEntry(h.id);
        renderHistoryTable();
      });
      tdAction.appendChild(btn);
      tr.appendChild(tdAction);

      body.appendChild(tr);
    });
  }

  function renderFavoritesTable() {
    var body = $('favoriteTableBody');
    body.innerHTML = '';
    var favorites = D.getFavorites();
    $('favoriteEmpty').hidden = favorites.length > 0;

    favorites.forEach(function (fav) {
      var tr = document.createElement('tr');
      var palletTotal = fav.stops.reduce(function (sum, s) { return sum + s.pallets; }, 0);

      var tdName = document.createElement('td');
      tdName.className = 'cell-name';
      var nameLine = document.createElement('div');
      nameLine.textContent = fav.name || fav.startLocationName || 'İsimsiz rota';
      var metaLine = document.createElement('div');
      metaLine.className = 'plan-group-meta';
      metaLine.textContent = (fav.startLocationName || '—') + ' · ' + fav.stops.length + ' durak · ' + palletTotal + ' palet';
      tdName.appendChild(nameLine);
      tdName.appendChild(metaLine);
      tr.appendChild(tdName);

      appendTextCell(tr, formatDateTime(fav.createdAt));

      var tdAction = document.createElement('td');
      tdAction.className = 'center';
      var btnLoad = document.createElement('button');
      btnLoad.className = 'btn-icon';
      btnLoad.textContent = 'Yükle';
      btnLoad.addEventListener('click', function () { loadFavorite(fav); });
      var btnDelete = document.createElement('button');
      btnDelete.className = 'btn-icon btn-icon-danger';
      btnDelete.textContent = 'Sil';
      btnDelete.addEventListener('click', function () {
        D.removeFavorite(fav.id);
        renderFavoritesTable();
      });
      tdAction.appendChild(btnLoad);
      tdAction.appendChild(btnDelete);
      tr.appendChild(tdAction);

      body.appendChild(tr);
    });
  }

  // Favori bir rotayı forma uygulayıp rotayı otomatik olarak yeniden
  // hesaplar — kayıtlı lokasyonlar silinmiş olabileceğinden önce doğrular.
  function loadFavorite(fav) {
    var startLocation = D.getLocation(fav.startLocationId);
    if (!startLocation) {
      toast('Bu favorideki başlangıç lokasyonu artık mevcut değil.', 'error');
      return;
    }
    var validStops = fav.stops.filter(function (s) { return D.getLocation(s.locationId); });
    if (!validStops.length) {
      toast('Bu favorideki duraklar artık mevcut değil.', 'error');
      return;
    }
    if (validStops.length < fav.stops.length) {
      toast('Bazı duraklar artık mevcut değil — kalanlarla yükleniyor.', 'error');
    }

    setSelectValue(el.selStart, fav.startLocationId);
    el.inpDeparture.value = fav.departure;
    el.inpService.value = fav.serviceMinutes;
    el.inpInitialLoad.value = fav.initialLoad;

    D.clearStops();
    validStops.forEach(function (s) { D.addStop(s.locationId, s.type, s.pallets); });
    renderStops();
    updateCapacity();

    closeModal('modalFavorites');
    planRoute();
  }

  // enhanceSelect() ile özelleştirilmiş bir <select>'e programatik değer
  // atarken (option listesi değişmediği için MutationObserver tetiklenmez)
  // tetikleyici butonun görünen metnini de elle senkronlamak gerekir.
  function setSelectValue(select, value) {
    select.value = value;
    if (select._tssSync) select._tssSync();
  }

  function renderTrafficSettings() {
    var t = D.getTrafficSettings();
    $('trafficEnabled').checked = !!t.enabled;
    $('trafficWeekend').checked = !!t.applyRushHourOnWeekends;
    $('trafficMorningStart').value = t.morning.start;
    $('trafficMorningEnd').value = t.morning.end;
    $('trafficMorningFactor').value = t.morning.factor;
    $('trafficEveningStart').value = t.evening.start;
    $('trafficEveningEnd').value = t.evening.end;
    $('trafficEveningFactor').value = t.evening.factor;
    $('trafficNightStart').value = t.night.start;
    $('trafficNightEnd').value = t.night.end;
    $('trafficNightFactor').value = t.night.factor;
    $('inpTomTomKey').value = D.getTomTomApiKey();
  }

  function bindTrafficField(id, band, key) {
    $(id).addEventListener('change', function () {
      var patch = {};
      if (band) {
        patch[band] = {};
        patch[band][key] = $(id).value;
      } else {
        patch[key] = $(id).checked;
      }
      D.updateTrafficSettings(patch);
      renderTrafficSettings();
    });
  }

  function readExcel(file, handler) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        var sheet = workbook.Sheets[workbook.SheetNames[0]];
        var rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        handler(rows);
      } catch (err) {
        toast('Dosya okunamadı. Beklenen sütun başlıklarını kontrol edin.', 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  /* ---------------------------------------------------------
     Olay bağlantıları
     --------------------------------------------------------- */
  function bindEvents() {
    el.inpInitialLoad.addEventListener('input', updateCapacity);

    el.btnAddStop.addEventListener('click', function () {
      var locationId = el.selStopLocation.value;
      var type = $('selStopType').value;
      var pallets = Math.max(1, Math.floor(Number(el.inpStopPallets.value) || 1));

      var error = validateStopAddition(type, pallets);
      if (error) {
        el.stopError.textContent = error;
        el.stopError.hidden = false;
        return;
      }
      el.stopError.hidden = true;

      D.addStop(locationId, type, pallets);
      renderStops();
      updateCapacity();
    });

    el.btnPlan.addEventListener('click', planRoute);
    el.btnClear.addEventListener('click', clearPlan);

    $('btnManageLocations').addEventListener('click', function () {
      renderLocationTable();
      openModal('modalLocations');
    });
    $('btnManageVehicles').addEventListener('click', function () {
      renderVehicleTable();
      openModal('modalVehicles');
    });
    $('btnFavoriteRoutes').addEventListener('click', function () {
      renderFavoritesTable();
      openModal('modalFavorites');
    });
    $('btnTripHistory').addEventListener('click', function () {
      renderHistoryTable();
      openModal('modalHistory');
    });
    $('btnExportHistoryExcel').addEventListener('click', function () {
      try {
        Exp.toExcelHistory(D.getHistory());
        toast('Sefer geçmişi Excel olarak indirildi.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    $('btnExportHistoryPdf').addEventListener('click', function () {
      try {
        Exp.toPdfHistory(D.getHistory());
        toast('Sefer geçmişi PDF olarak indirildi.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $('btnTrafficSettings').addEventListener('click', function () {
      renderTrafficSettings();
      openModal('modalTraffic');
    });
    bindTrafficField('trafficEnabled', null, 'enabled');
    bindTrafficField('trafficWeekend', null, 'applyRushHourOnWeekends');
    bindTrafficField('trafficMorningStart', 'morning', 'start');
    bindTrafficField('trafficMorningEnd', 'morning', 'end');
    bindTrafficField('trafficMorningFactor', 'morning', 'factor');
    bindTrafficField('trafficEveningStart', 'evening', 'start');
    bindTrafficField('trafficEveningEnd', 'evening', 'end');
    bindTrafficField('trafficEveningFactor', 'evening', 'factor');
    bindTrafficField('trafficNightStart', 'night', 'start');
    bindTrafficField('trafficNightEnd', 'night', 'end');
    bindTrafficField('trafficNightFactor', 'night', 'factor');
    // TomTom key, trafik katsayısı ayarlarından ayrı bir alan (js/data.js →
    // tomtomApiKey) — bindTrafficField ile karışmasın diye ayrı bağlanıyor.
    $('inpTomTomKey').addEventListener('change', function () {
      D.setTomTomApiKey($('inpTomTomKey').value);
    });

    document.querySelectorAll('[data-close-modal]').forEach(function (btn) {
      btn.addEventListener('click', function () { closeModal(btn.dataset.closeModal); });
    });

    document.querySelectorAll('.modal-backdrop').forEach(function (backdrop) {
      // mousedown ve click'in ikisi de backdrop'un kendisinde başlamalı;
      // aksi halde modal içeriğinde metin seçip fare backdrop üzerinde
      // bırakıldığında (drag-select) modal istenmeden kapanıyor — bu da
      // modaller arasında "bazen kapanıyor bazen kapanmıyor" hissi veren
      // tutarsızlığın kaynağıydı.
      var downOnBackdrop = false;
      backdrop.addEventListener('mousedown', function (e) {
        downOnBackdrop = (e.target === backdrop);
      });
      backdrop.addEventListener('click', function (e) {
        if (downOnBackdrop && e.target === backdrop) backdrop.hidden = true;
        downOnBackdrop = false;
      });
    });

    $('btnAddLocation').addEventListener('click', function () {
      try {
        D.addLocation({
          name: $('locName').value,
          lat: $('locLat').value.replace(',', '.'),
          lng: $('locLng').value.replace(',', '.'),
          from: $('locFrom').value,
          until: $('locUntil').value
        });
        $('locName').value = ''; $('locLat').value = ''; $('locLng').value = '';
        renderLocationTable();
        refreshSelects();
        drawIdleMarkers();
        toast('Lokasyon eklendi.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $('btnAddVehicle').addEventListener('click', function () {
      try {
        D.addVehicle({
          plate: $('vehPlate').value,
          model: $('vehModel').value,
          capacity: $('vehCapacity').value
        });
        $('vehPlate').value = ''; $('vehModel').value = ''; $('vehCapacity').value = '';
        renderVehicleTable();
        refreshSelects();
        toast('Araç eklendi.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $('fileLocations').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      readExcel(file, function (rows) {
        var res = D.importLocationRows(rows);
        renderLocationTable();
        refreshSelects();
        drawIdleMarkers();
        toast(res.added + ' lokasyon eklendi' + (res.skipped ? ', ' + res.skipped + ' satır atlandı.' : '.'),
              res.added ? 'success' : 'error');
      });
      e.target.value = '';
    });

    $('fileVehicles').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      readExcel(file, function (rows) {
        var res = D.importVehicleRows(rows);
        renderVehicleTable();
        refreshSelects();
        toast(res.added + ' araç eklendi' + (res.skipped ? ', ' + res.skipped + ' satır atlandı.' : '.'),
              res.added ? 'success' : 'error');
      });
      e.target.value = '';
    });

    el.btnApproveRoute.addEventListener('click', function () {
      if (!D.state.plan) return;
      $('inpApproveNote').value = D.state.plan.note || '';
      openModal('modalApprove');
    });

    $('btnConfirmApprove').addEventListener('click', function () {
      if (!D.state.plan) { closeModal('modalApprove'); return; }
      D.state.plan.note = $('inpApproveNote').value.trim();
      D.approveTrip(D.state.plan);
      closeModal('modalApprove');
      toast('Rota onaylandı ve sefer geçmişine kaydedildi.', 'success');
    });

    // Rotayı Favorilere Ekle: Onayla'dan bağımsız bir eylem — hesaplanmış
    // sonucu değil, formun GİRDİLERİNİ (başlangıç, saat, duraklar) kaydeder.
    // Önce isim sorulur (modalSaveFavorite), ardından kaydedilir.
    el.btnFavoriteRoute.addEventListener('click', function () {
      if (!D.state.plan) return;
      $('inpFavoriteName').value = '';
      openModal('modalSaveFavorite');
    });

    $('btnConfirmSaveFavorite').addEventListener('click', function () {
      var name = $('inpFavoriteName').value.trim();
      if (!name) { toast('Rota adı girin.', 'error'); return; }

      var startLocation = D.getLocation(el.selStart.value);
      if (!startLocation || !D.state.stops.length) {
        toast('Kaydedilecek bir rota yok.', 'error');
        closeModal('modalSaveFavorite');
        return;
      }
      D.addFavorite({
        name: name,
        startLocationId: startLocation.id,
        startLocationName: startLocation.name,
        departure: el.inpDeparture.value || '08:00',
        serviceMinutes: Number(el.inpService.value) || 0,
        initialLoad: initialLoad(),
        stops: D.state.stops.map(function (s) {
          var loc = D.getLocation(s.locationId);
          return { locationId: s.locationId, locationName: loc ? loc.name : '', type: s.type, pallets: s.pallets };
        })
      });
      closeModal('modalSaveFavorite');
      toast('Rota favorilere eklendi.', 'success');
    });

    el.btnGoogleMaps.addEventListener('click', function () {
      var plan = D.state.plan;
      if (!plan || !plan.groups.length) return;
      // Birden fazla araç varsa her biri kendi güzergahıyla ayrı bir sekmede
      // açılır (Google Maps tek linkte birden fazla aracı gösteremiyor).
      var opened = 0;
      plan.groups.forEach(function (group) {
        var url = buildGoogleMapsUrl(group, plan.startLocation);
        if (url) { window.open(url, '_blank', 'noopener'); opened++; }
      });
      if (!opened) toast('Rotada gösterilecek durak yok.', 'error');
      else if (opened > 1) toast(opened + ' araç için ayrı sekmeler açıldı.', 'success');
    });

    el.btnExportExcel.addEventListener('click', function () {
      if (!D.state.plan) return;
      try {
        Exp.toExcel(D.state.plan);
        toast('Excel indirildi.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    el.btnExportPdf.addEventListener('click', function () {
      if (!D.state.plan) return;
      setLoading(true, 'PDF hazırlanıyor…');
      Exp.toPdf(D.state.plan, $('map'))
        .then(function () { setLoading(false); toast('PDF indirildi.', 'success'); })
        .catch(function (err) { setLoading(false); toast(err.message, 'error'); });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop').forEach(function (m) { m.hidden = true; });
      }
    });
  }

  /* ---------------------------------------------------------
     Başlangıç
     --------------------------------------------------------- */
  function init() {
    el = {
      selStart: $('selStart'),
      selStopLocation: $('selStopLocation'),
      inpStopPallets: $('inpStopPallets'),
      inpDeparture: $('inpDeparture'),
      inpService: $('inpService'),
      inpInitialLoad: $('inpInitialLoad'),
      selCostMetric: $('selCostMetric'),
      btnAddStop: $('btnAddStop'),
      btnPlan: $('btnPlan'),
      btnClear: $('btnClear'),
      btnApproveRoute: $('btnApproveRoute'),
      btnFavoriteRoute: $('btnFavoriteRoute'),
      btnGoogleMaps: $('btnGoogleMaps'),
      btnExportExcel: $('btnExportExcel'),
      btnExportPdf: $('btnExportPdf'),
      stopList: $('stopList'),
      stopEmpty: $('stopEmpty'),
      stopError: $('stopError'),
      stopCountHint: $('stopCountHint'),
      capacityText: $('capacityText'),
      capacityFill: $('capacityFill'),
      planGroups: $('planGroups'),
      fleetWarning: $('fleetWarning'),
      tableEmpty: $('tableEmpty'),
      toast: $('toast'),
      loading: $('loading'),
      loadingText: $('loadingText')
    };

    // Native <select> yerine tasarım sistemine uygun özel açılır menü —
    // bkz. enhanceSelect(). Sonrasında el.selStart / el.selStopLocation
    // referansları ve mevcut .value / change-event tabanlı kod aynen çalışır.
    enhanceSelect(el.selStart);
    enhanceSelect(el.selStopLocation);
    enhanceSelect($('selStopType'));
    enhanceSelect(el.selCostMetric);

    // Panel her koşulda kullanılabilir kalmalı: veri ve arayüz önce kurulur,
    // harita ayrı denenir, hata olursa üstte bant ile bildirilir.
    setLoading(false);

    try {
      D.load();
      refreshSelects();
      renderStops();
      bindEvents();
    } catch (err) {
      showStartupError('Arayüz başlatılamadı: ' + err.message);
      return;
    }

    try {
      if (initMap()) drawIdleMarkers();
    } catch (err) {
      showStartupError('Harita başlatılamadı: ' + err.message);
    }

    var missing = [];
    if (typeof XLSX === 'undefined') missing.push('Excel');
    if (!window.jspdf) missing.push('PDF');
    if (missing.length) {
      showStartupError(missing.join(' ve ') + ' dışa aktarma bileşeni yüklenemedi. ' +
                       'vendor/ klasörünün index.html ile aynı yerde olduğunu kontrol edin.');
    }
  }

  function showStartupError(message) {
    var banner = $('startupError');
    if (!banner) return;
    banner.textContent = message;
    banner.hidden = false;
    setLoading(false);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
