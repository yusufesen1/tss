/* =========================================================
   exporter.js — Excel (yalnızca tablo) ve PDF (harita + tablo)
   ========================================================= */
(function (global) {
  'use strict';

  var HEADERS = ['#', 'Lokasyon', 'İşlem', 'Palet', 'Araçtaki yük', 'Mesafe (km)', 'Varış', 'Durak Süresi (dk)', 'Ayrılış', 'Durum'];
  var HISTORY_HEADERS = ['Onay Tarihi', 'Araç(lar)', 'Başlangıç', 'Durak', 'Mesafe', 'Süre', 'Not'];

  function km(meters) { return (meters / 1000).toFixed(1); }

  function formatVehicleList(vehicles) {
    return (vehicles || []).map(function (v) {
      return v.plate + (v.model ? ' (' + v.model + ')' : '');
    }).join(', ') || '—';
  }

  function stamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  function formatHistoryDate(ts) {
    var d = new Date(ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' +
           p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function rowsToMatrix(tableRows) {
    return tableRows.map(function (r) {
      return [r.no, r.location, r.action, r.pallets, r.load, r.distance, r.arrival,
              r.serviceMinutes != null ? r.serviceMinutes : '—', r.departure, r.status];
    });
  }

  function historyRowsToMatrix(history) {
    return history.map(function (h) {
      return [
        formatHistoryDate(h.approvedAt), h.vehicleSummary || formatVehicleList(h.vehicles),
        h.start, h.stopCount, h.distance, h.duration, h.note || '—'
      ];
    });
  }

  /* Sefer geçmişi KPI'ları: bu ay/bu hafta onaylanan sefer sayısı, en çok
     kullanılan araç, en çok uğranılan lokasyon (başlangıç/depo hariç —
     her seferde zaten oradan çıkıldığı için anlamsız bir "birinci" olurdu). */
  function startOfWeek(d) {
    var date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var day = date.getDay();
    var diff = day === 0 ? -6 : 1 - day; // Pazartesi başlangıç
    date.setDate(date.getDate() + diff);
    return date;
  }

  function topEntry(counts) {
    var bestKey = null, bestCount = 0;
    Object.keys(counts).forEach(function (k) {
      if (counts[k] > bestCount) { bestCount = counts[k]; bestKey = k; }
    });
    return bestKey ? { label: bestKey, count: bestCount } : null;
  }

  function computeHistoryStats(history) {
    var MONTH_NAMES = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
                        'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    var now = new Date();
    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    var weekStart = startOfWeek(now);

    var thisMonthCount = 0, thisWeekCount = 0;
    var vehicleCounts = {}, locationCounts = {};

    history.forEach(function (h) {
      var d = new Date(h.approvedAt);
      if (d >= monthStart) thisMonthCount++;
      if (d >= weekStart) thisWeekCount++;

      // Bir sefer birden fazla araç kullanmış olabilir — her biri kendi
      // kullanım sayısına katkı verir.
      (h.vehicles || []).forEach(function (v) {
        var vKey = v.plate || 'Bilinmiyor';
        vehicleCounts[vKey] = (vehicleCounts[vKey] || 0) + 1;
      });

      (h.groups || []).forEach(function (g) {
        (g.rows || []).forEach(function (r) {
          if (r.action === 'Hareket') return;
          var lKey = r.location || 'Bilinmiyor';
          locationCounts[lKey] = (locationCounts[lKey] || 0) + 1;
        });
      });
    });

    return {
      monthLabel: MONTH_NAMES[now.getMonth()] + ' ' + now.getFullYear(),
      thisMonthCount: thisMonthCount,
      thisWeekCount: thisWeekCount,
      topVehicle: topEntry(vehicleCounts),
      topLocation: topEntry(locationCounts)
    };
  }

  /** jsPDF'in gömülü Helvetica fontu Türkçe karakterleri (ı,ş,ğ,ç,ö,ü,İ)
   *  içermez. vendor/fonts/pdf-font-arial.js varsa Arial'i gömüp kullanır;
   *  yoksa sessizce varsayılan fonta düşer (dışa aktarma yine çalışır). */
  function registerPdfFont(doc) {
    if (!global.TSS_PDF_FONT_NORMAL) return false;
    doc.addFileToVFS('Arial-normal.ttf', global.TSS_PDF_FONT_NORMAL);
    doc.addFont('Arial-normal.ttf', 'Arial', 'normal');
    if (global.TSS_PDF_FONT_BOLD) {
      doc.addFileToVFS('Arial-bold.ttf', global.TSS_PDF_FONT_BOLD);
      doc.addFont('Arial-bold.ttf', 'Arial', 'bold');
    }
    return true;
  }

  /* html2canvas (vendörlenmiş sürüm) CSS oklch() renklerini ayrıştıramıyor —
     tasarım sistemindeki tüm --n-* tonları ve gölgeler oklch() ile tanımlı.
     Harita yakalaması sırasında bunları kısa süreliğine hex/rgba karşılığıyla
     override ediyoruz; uygulamanın gerçek stilleri hiç değişmiyor. */
  var OKLCH_FALLBACK = {
    '--n-0':   '#fffdfb',
    '--n-50':  '#f9f6f2',
    '--n-100': '#f4efeb',
    '--n-200': '#e6e0db',
    '--n-300': '#d4ccc6',
    '--n-400': '#a69c97',
    '--n-500': '#7f7570',
    '--n-600': '#615955',
    '--n-700': '#473f3c',
    '--n-800': '#2a2421',
    '--n-900': '#17110f',
    '--shadow-sm': '0 1px 2px rgba(23,17,15,0.08), 0 1px 3px rgba(23,17,15,0.06)',
    '--shadow-md': '0 4px 12px rgba(23,17,15,0.12), 0 2px 4px rgba(23,17,15,0.08)'
  };

  function withOklchFallback(captureFn) {
    var root = document.documentElement.style;
    var previous = {};
    Object.keys(OKLCH_FALLBACK).forEach(function (key) {
      previous[key] = root.getPropertyValue(key);
      root.setProperty(key, OKLCH_FALLBACK[key]);
    });
    function restore() {
      Object.keys(OKLCH_FALLBACK).forEach(function (key) {
        if (previous[key]) root.setProperty(key, previous[key]);
        else root.removeProperty(key);
      });
    }
    return Promise.resolve().then(captureFn).then(
      function (value) { restore(); return value; },
      function (err) { restore(); throw err; }
    );
  }

  /* PDF'e statik bir görüntü alınıyor; +/- yakınlaştırma kontrolü etkileşim
     olmadığı için anlamsız ve görüntüyü kirletiyor. Yakalama süresince gizlenir,
     zorunlu OSM atıf metni (attribution) ise korunur. */
  function withHiddenZoomControl(mapElement, captureFn) {
    var zoomEls = mapElement ? mapElement.querySelectorAll('.leaflet-control-zoom') : [];
    var prevDisplay = [];
    zoomEls.forEach(function (el, i) { prevDisplay[i] = el.style.display; el.style.display = 'none'; });
    function restore() {
      zoomEls.forEach(function (el, i) { el.style.display = prevDisplay[i]; });
    }
    return Promise.resolve().then(captureFn).then(
      function (value) { restore(); return value; },
      function (err) { restore(); throw err; }
    );
  }

  // Excel sayfa adları: en fazla 31 karakter, \/?*[]: yasak. Aynı isim iki
  // gruba düşerse (kısaltma çakışması gibi bir uç durumda) sıra numarası eklenir.
  function safeSheetName(name, usedNames) {
    var base = String(name || 'Arac').replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 28) || 'Arac';
    var candidate = base, n = 2;
    while (usedNames[candidate]) { candidate = (base.slice(0, 28) + ' ' + n).slice(0, 31); n++; }
    usedNames[candidate] = true;
    return candidate;
  }

  /** Excel: her araç grubu ayrı bir sayfada rota tablosu. */
  function toExcel(plan) {
    if (!global.XLSX) throw new Error('Excel kütüphanesi yüklenemedi.');

    var book = XLSX.utils.book_new();
    var usedNames = {};
    plan.groups.forEach(function (group) {
      var data = [HEADERS].concat(rowsToMatrix(group.tableRows));
      var sheet = XLSX.utils.aoa_to_sheet(data);
      sheet['!cols'] = [
        { wch: 5 }, { wch: 28 }, { wch: 12 }, { wch: 8 }, { wch: 13 },
        { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 32 }
      ];
      XLSX.utils.book_append_sheet(book, sheet, safeSheetName(group.vehicle.plate, usedNames));
    });
    XLSX.writeFile(book, 'tss-rota-' + stamp() + '.xlsx');
  }

  /** Excel: sefer geçmişi (onaylanan tüm seferlerin özeti). */
  function toExcelHistory(history) {
    if (!global.XLSX) throw new Error('Excel kütüphanesi yüklenemedi.');

    var data = [HISTORY_HEADERS].concat(historyRowsToMatrix(history));
    var sheet = XLSX.utils.aoa_to_sheet(data);

    sheet['!cols'] = [
      { wch: 16 }, { wch: 26 }, { wch: 24 },
      { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 36 }
    ];

    var book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Sefer Gecmisi');
    XLSX.writeFile(book, 'tss-sefer-gecmisi-' + stamp() + '.xlsx');
  }

  /** PDF: sefer geçmişi — 4 KPI kartı + özet tablo. */
  function toPdfHistory(history) {
    if (!global.jspdf || !global.jspdf.jsPDF) {
      throw new Error('PDF kütüphanesi yüklenemedi.');
    }

    var jsPDF = global.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    var pageWidth = doc.internal.pageSize.getWidth();
    var margin = 12;
    var pdfFont = registerPdfFont(doc) ? 'Arial' : undefined;
    function setFont(style) { if (pdfFont) doc.setFont(pdfFont, style); }

    doc.setFillColor(201, 12, 15);
    doc.rect(0, 0, pageWidth, 18, 'F');
    doc.setTextColor(255, 255, 255);
    setFont('bold');
    doc.setFontSize(12);
    doc.text('Turkish Support Services — Sefer Geçmişi', margin, 11.5);

    doc.setTextColor(60, 55, 52);
    setFont('normal');
    doc.setFontSize(9);
    doc.text(history.length + ' onaylanmış sefer', margin, 25);

    // --- 4 KPI kartı ---
    var stats = computeHistoryStats(history);
    var cards = [
      { label: 'BU AY (' + stats.monthLabel.toUpperCase() + ')', value: stats.thisMonthCount + ' sefer' },
      { label: 'BU HAFTA', value: stats.thisWeekCount + ' sefer' },
      { label: 'EN ÇOK KULLANILAN ARAÇ', value: stats.topVehicle ? (stats.topVehicle.label + ' (' + stats.topVehicle.count + ')') : '—' },
      { label: 'EN ÇOK UĞRANILAN LOKASYON', value: stats.topLocation ? (stats.topLocation.label + ' (' + stats.topLocation.count + ')') : '—' }
    ];

    var cardGap = 6;
    var cardWidth = (pageWidth - margin * 2 - cardGap * 3) / 4;
    var cardY = 30;
    var cardHeight = 22;

    cards.forEach(function (c, i) {
      var x = margin + i * (cardWidth + cardGap);
      doc.setFillColor(250, 249, 247);
      doc.setDrawColor(230, 224, 219);
      if (typeof doc.roundedRect === 'function') {
        doc.roundedRect(x, cardY, cardWidth, cardHeight, 2, 2, 'FD');
      } else {
        doc.rect(x, cardY, cardWidth, cardHeight, 'FD');
      }

      setFont('bold');
      doc.setFontSize(7);
      doc.setTextColor(127, 117, 112);
      var labelLines = doc.splitTextToSize(c.label, cardWidth - 6);
      doc.text(labelLines, x + 3, cardY + 6);

      setFont('bold');
      doc.setFontSize(10);
      doc.setTextColor(45, 41, 39);
      var valueLines = doc.splitTextToSize(String(c.value), cardWidth - 6);
      doc.text(valueLines, x + 3, cardY + 6 + labelLines.length * 3.2 + 4);
    });

    // --- Özet tablo ---
    var bodyStyles = { fontSize: 8, cellPadding: 2, textColor: [45, 41, 39] };
    var headStyles = { fillColor: [248, 239, 198], textColor: [45, 41, 39], fontStyle: 'bold' };
    if (pdfFont) { bodyStyles.font = pdfFont; headStyles.font = pdfFont; }

    doc.autoTable({
      head: [HISTORY_HEADERS],
      body: historyRowsToMatrix(history),
      startY: cardY + cardHeight + 10,
      margin: { left: margin, right: margin },
      styles: bodyStyles,
      headStyles: headStyles,
      columnStyles: {
        3: { halign: 'center' },
        4: { halign: 'right' },
        5: { halign: 'right' }
      }
    });

    doc.save('tss-sefer-gecmisi-' + stamp() + '.pdf');
  }

  /** PDF: harita görüntüsü (tüm araç güzergahları) + her araç için ayrı KPI/tablo bölümü. */
  function toPdf(plan, mapElement) {
    if (!global.jspdf || !global.jspdf.jsPDF) {
      return Promise.reject(new Error('PDF kütüphanesi yüklenemedi.'));
    }

    var jsPDF = global.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    var pageWidth = doc.internal.pageSize.getWidth();
    var pageHeight = doc.internal.pageSize.getHeight();
    var margin = 12;
    var pdfFont = registerPdfFont(doc) ? 'Arial' : undefined;
    function setFont(style) { if (pdfFont) doc.setFont(pdfFont, style); }

    var totalDistanceMeters = plan.groups.reduce(function (s, g) { return s + g.result.distance; }, 0);
    var vehicleList = plan.groups.map(function (g) { return g.vehicle.plate; }).join(', ');
    var firstDeparture = plan.groups.length ? plan.groups[0].meta.departure : '';

    // Başlık bandı
    doc.setFillColor(201, 12, 15);
    doc.rect(0, 0, pageWidth, 18, 'F');
    doc.setTextColor(255, 255, 255);
    setFont('bold');
    doc.setFontSize(12);
    doc.text('Turkish Support Services — Rota Planı', margin, 11.5);

    doc.setTextColor(60, 55, 52);
    setFont('normal');
    doc.setFontSize(9);
    var metaLine = plan.groups.length + ' araç: ' + vehicleList +
                   '  ·  Hareket: ' + plan.startLocation.name + ' ' + firstDeparture +
                   '  ·  Toplam Mesafe: ' + km(totalDistanceMeters) + ' km';
    doc.text(doc.splitTextToSize(metaLine, pageWidth - margin * 2), margin, 25);

    // Onay sırasında girilen not (varsa) — köprü/tonaj/erişim kısıtı gibi
    // OSRM'in bilmediği ama sürücünün mutlaka görmesi gereken uyarılar için.
    var noteLineHeight = 4.2;
    var noteLines = plan.note ? doc.splitTextToSize(plan.note, pageWidth - margin * 2 - 14) : [];
    if (noteLines.length) {
      setFont('bold');
      doc.setTextColor(201, 12, 15);
      doc.text('Not:', margin, 31);
      setFont('normal');
      doc.setTextColor(60, 55, 52);
      doc.text(noteLines, margin + 12, 31);
    }
    var noteBlockHeight = noteLines.length ? noteLines.length * noteLineHeight + 4 : 0;

    var capture = mapElement && global.html2canvas
      ? withHiddenZoomControl(mapElement, function () {
          return withOklchFallback(function () {
            return global.html2canvas(mapElement, { useCORS: true, allowTaint: false, backgroundColor: '#ffffff', scale: 2 });
          });
        })
      : Promise.resolve(null);

    return capture
      .catch(function (err) {
        console.error('[TSS] Harita yakalanamadı:', err);
        return null;
      })
      .then(function (canvas) {
        var y = 32 + noteBlockHeight;

        if (canvas) {
          try {
            var img = canvas.toDataURL('image/png');
            // En/boy oranını koru: önce sayfa genişliğine göre yükseklik hesapla,
            // 95mm sınırını aşarsa bu kez genişliği küçültüp ortala — ikisini
            // bağımsız sınırlamak görüntüyü (öncekinde olduğu gibi) gerdirir/sıkıştırır.
            var maxWidth = pageWidth - margin * 2;
            var maxHeight = 95;
            var ratio = canvas.height / canvas.width;
            var imgWidth = maxWidth;
            var imgHeight = ratio * imgWidth;
            if (imgHeight > maxHeight) {
              imgHeight = maxHeight;
              imgWidth = imgHeight / ratio;
            }
            var imgX = margin + (maxWidth - imgWidth) / 2;
            doc.addImage(img, 'PNG', imgX, y, imgWidth, imgHeight);
            y += imgHeight + 8;
          } catch (e) {
            console.error('[TSS] Harita görüntüsü PDF\'e eklenemedi:', e);
            setFont('normal');
            doc.setFontSize(8);
            doc.text('Harita görüntüsü bu ortamda alınamadı; tablolar aşağıdadır.', margin, y);
            y += 6;
          }
        } else {
          setFont('normal');
          doc.setFontSize(8);
          doc.text('Harita görüntüsü bu ortamda alınamadı; tablolar aşağıdadır.', margin, y);
          y += 6;
        }

        var bodyStyles = { fontSize: 8, cellPadding: 2, textColor: [45, 41, 39] };
        var headStyles = { fillColor: [248, 239, 198], textColor: [45, 41, 39], fontStyle: 'bold' };
        if (pdfFont) { bodyStyles.font = pdfFont; headStyles.font = pdfFont; }

        // Her araç grubu kendi başlığı + KPI özeti + tablosuyla art arda basılır.
        // autoTable sayfa taşarsa kendiliğinden yeni sayfaya geçer.
        plan.groups.forEach(function (group, gi) {
          if (y > pageHeight - 40) { doc.addPage(); y = margin; }

          setFont('bold');
          doc.setFontSize(9.5);
          doc.setTextColor(45, 41, 39);
          doc.text((gi + 1) + '. ' + group.vehicle.plate + (group.vehicle.model ? ' · ' + group.vehicle.model : ''), margin, y);

          setFont('normal');
          doc.setFontSize(8);
          doc.setTextColor(100, 92, 88);
          var kpiLine = 'Mesafe: ' + group.meta.distance + '   ·   Süre: ' + group.meta.duration +
                        '   ·   Yol Süresi: ' + group.meta.driveDuration + '   ·   Bitiş: ' + group.meta.finish;
          doc.text(kpiLine, margin, y + 5);

          doc.autoTable({
            head: [HEADERS],
            body: rowsToMatrix(group.tableRows),
            startY: y + 8,
            margin: { left: margin, right: margin },
            styles: bodyStyles,
            headStyles: headStyles,
            alternateRowStyles: { fillColor: [250, 249, 247] },
            columnStyles: {
              0: { cellWidth: 10 },
              3: { halign: 'right' },
              4: { halign: 'right' },
              5: { halign: 'right' },
              7: { halign: 'center' }
            },
            didParseCell: function (data) {
              if (data.section === 'body' && data.row.index < group.tableRows.length) {
                if (group.tableRows[data.row.index].warn) {
                  data.cell.styles.textColor = [201, 12, 15];
                }
              }
            }
          });

          y = doc.lastAutoTable.finalY + 10;
        });

        doc.save('tss-rota-' + stamp() + '.pdf');
      });
  }

  global.TSSExporter = {
    toExcel: toExcel,
    toPdf: toPdf,
    toExcelHistory: toExcelHistory,
    toPdfHistory: toPdfHistory
  };
})(window);
