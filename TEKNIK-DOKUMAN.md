# TSS — Rota ve Araç Atama Paneli — Teknik Doküman

Bu doküman, `README.md`'nin kısa kullanım kılavuzunun ötesine geçip projenin **çalışma
prensibini, mimarisini, algoritmalarını ve teknik iç detaylarını** ayrıntılı biçimde
anlatır. Hedef kitle: projeye sonradan dahil olacak / bakım yapacak geliştiriciler.

---

## İçindekiler

1. [Amaç ve kapsam](#1-amaç-ve-kapsam)
2. [Genel mimari](#2-genel-mimari)
3. [Tech stack](#3-tech-stack)
4. [Dosya/modül yapısı](#4-dosyamodül-yapısı)
5. [Veri modeli ve kalıcılık](#5-veri-modeli-ve-kalıcılık)
6. [Uçtan uca kullanıcı akışı](#6-uçtan-uca-kullanıcı-akışı)
7. [Rota hesaplama algoritması (`optimizer.js`)](#7-rota-hesaplama-algoritması-optimizerjs)
8. [Çoklu araç ataması (`fleet.js`)](#8-çoklu-araç-ataması-fleetjs)
9. [Harita katmanı](#9-harita-katmanı)
10. [Dış servisler](#10-dış-servisler)
11. [Excel / PDF dışa aktarım](#11-excel--pdf-dışa-aktarım)
12. [Güvenlik notları](#12-güvenlik-notları)
13. [Bilinen sınırlar ve production riskleri](#13-bilinen-sınırlar-ve-production-riskleri)
14. [Devam edecek geliştiriciler için yol haritası](#14-devam-edecek-geliştiriciler-için-yol-haritası)

---

## 1. Amaç ve kapsam

Uygulama, bir lojistik/sefer planlama ekibinin **günlük araç turlarını** planlamasını
sağlayan, backend'siz, tarayıcıda çalışan bir araçtır:

- Bir hareket noktasından çıkıp birden fazla lokasyonda yükleme/boşaltma yapacak
  seferler tanımlanır (kapasiteli pickup-and-delivery problemi).
- Sistem, hangi aracın/araçların kullanılacağına ve duraklerin hangi sırayla
  ziyaret edileceğine **otomatik karar verir** — gerçek yol mesafesi, araç
  kapasitesi, lokasyon erişim saatleri ve kaba bir trafik modeli göz önünde
  bulundurularak.
- Sonuç harita üzerinde çizilir, tablo halinde gösterilir, gerekirse elle
  düzenlenir, onaylanır (sefer geçmişine düşer) ve Excel/PDF olarak dışa
  aktarılır.

Kasıtlı olarak **backend'siz**: kurulum/deploy karmaşıklığı olmadan `index.html`
çift tıklanarak veya basit bir statik dosya sunucusundan açılabilsin diye.

---

## 2. Genel mimari

```
┌─────────────────────────────────────────────────────────────┐
│                        index.html                            │
│  (DOM iskeleti, modal'lar, <script> yükleme sırası)           │
└─────────────────────────────────────────────────────────────┘
        │
        ▼  script sırası: data → osrm → tomtom → weather → optimizer → fleet → exporter → app
┌───────────────┐   ┌──────────┐   ┌───────────┐   ┌───────────┐
│   data.js      │   │ osrm.js  │   │ tomtom.js │   │ weather.js│   (dış servis istemcileri /
│  (state +      │   │ (mesafe/ │   │ (canlı    │   │ (hava     │    veri katmanı — birbirinden
│  localStorage) │   │  rota)   │   │  trafik)  │   │  durumu)  │    bağımsız)
└───────┬────────┘   └────┬─────┘   └─────┬─────┘   └─────┬─────┘
        │                 │                │               │
        │        ┌────────▼────────┐       │               │
        │        │  optimizer.js    │       │               │
        │        │  (tek araç sıra- │       │               │
        │        │  lama algoritması)│      │               │
        │        └────────┬─────────┘       │               │
        │                 │                 │               │
        │        ┌────────▼─────────┐       │               │
        │        │    fleet.js       │◀─────┘               │
        │        │ (çoklu araç       │  (replayGroupWithLiveLegs) │
        │        │  kümeleme/atama)  │      │                │
        │        └────────┬──────────┘      │                │
        │                 │                 │                │
        └─────────────────┼─────────────────┴────────────────┘
                           ▼
                  ┌─────────────────┐        ┌──────────────┐
                  │     app.js       │──────▶│ exporter.js   │
                  │ (DOM binding,    │        │ (Excel/PDF)   │
                  │  harita, tablo,  │        └──────────────┘
                  │  modal yönetimi) │
                  └─────────────────┘
```

**Modül deseni:** Her `js/*.js` dosyası bir IIFE içinde tanımlanır ve `window`
üzerine **tek bir obje** export eder (`window.TSSData`, `window.TSSOsrm`,
`window.TSSTomTom`, `window.TSSWeather`, `window.TSSOptimizer`, `window.TSSFleet`,
`window.TSSExporter`). Modül sistemi (ESM/CommonJS/bundler) yok — sıralı
`<script>` etiketleriyle global namespace'e yükleniyor (bkz. `index.html`,
`<script>` blokları dosyanın sonunda, `</body>`'den hemen önce). Dairesel
bağımlılık yok; bağımlılık grafiği tek yönlü:

```
data.js  (bağımsız — sadece kendi state'i)
osrm.js  (bağımsız)
tomtom.js (bağımsız — sadece js/app.js tarafından, opsiyonel/best-effort çağrılır)
weather.js (bağımsız)
optimizer.js (bağımsız — saf hesaplama, DOM'a hiç dokunmaz)
fleet.js  → optimizer.js  (+ replayGroupWithLiveLegs: TomTom'un ürettiği bacak
                            verisini işler, ama TomTom'u kendisi hiç çağırmaz)
exporter.js (bağımsız — sadece plan/history nesnesi alır)
app.js    → data.js + osrm.js + tomtom.js + weather.js + optimizer.js + fleet.js + exporter.js
```

Bu ayrım bilinçli: **algoritma katmanı (`optimizer.js`, `fleet.js`) hiçbir
DOM/tarayıcı API'sine bağımlı değil** — saf JS fonksiyonları olarak yazılmış,
teorik olarak Node.js'te de (tarayıcı olmadan) test edilebilir/çalıştırılabilir
(bu dokümandaki doğrulama komutları da zaten `node -e` ile böyle çalıştırıldı).

---

## 3. Tech stack

| Katman | Teknoloji | Not |
|---|---|---|
| Dil | Vanilla JavaScript (ES5 üslubu: `'use strict'`, `function` ifadeleri, IIFE) | Framework yok (React/Vue/Angular yok), build adımı yok, TypeScript yok |
| Harita | [Leaflet](vendor/leaflet/leaflet.js) | `vendor/` altında yerel, CDN değil |
| Harita karoları | OpenStreetMap tile sunucusu (`{s}.tile.openstreetmap.org`) | `js/app.js` içindeki `L.tileLayer` — internet bağımlılığı |
| Rota/mesafe | [OSRM](https://project-osrm.org/) demo sunucusu (`router.project-osrm.org`) | `js/osrm.js` — internet bağımlılığı, bkz. §13. Sıralama kararının tek girdisi; her zaman çağrılır. |
| Canlı trafik (opsiyonel) | [TomTom Routing API](https://developer.tomtom.com/routing-api) | `js/tomtom.js` — sadece "En Az Süre" modunda ve kullanıcı kendi API key'ini girdiyse çağrılır; ücretli/kotalı, anahtar gerektirir, bkz. §10.3 |
| Hava durumu | [Open-Meteo](https://open-meteo.com/) API | Anahtar gerektirmez, ücretsiz — `js/weather.js` |
| Excel içe/dışa aktarma | [SheetJS (xlsx.full.min.js)](vendor/xlsx.full.min.js) | `vendor/` altında yerel |
| PDF üretimi | [jsPDF](vendor/jspdf.umd.min.js) + [jspdf-autotable](vendor/jspdf.plugin.autotable.min.js) | Tablo + serbest metin/şekil çizimi |
| Harita → görüntü | [html2canvas](vendor/html2canvas.min.js) | PDF'e harita gömmek için ekran görüntüsü alır |
| PDF Türkçe font | `vendor/fonts/pdf-font-arial.js` | jsPDF'in gömülü Helvetica'sı `ı,ş,ğ,ç,ö,ü` içermediği için Arial TTF base64 olarak gömülü |
| Yazı tipi (UI) | [Outfit](vendor/fonts/outfit.css) (woff2, yerel) | Google Fonts CDN değil |
| Kalıcılık | `localStorage` (tek anahtar: `tss-rota-panel-v1`) | Backend/veritabanı yok |
| Test altyapısı | **Yok** | Bkz. §14 |
| Build/bundler | **Yok** | Dosyalar doğrudan `<script>` ile sırayla yükleniyor |

---

## 4. Dosya/modül yapısı

```
index.html          DOM iskeleti + script yükleme sırası
styles.css           Tüm görsel tasarım (tasarım sistemi: bkz. "Turkish Support
                      Services — Design System.md")
js/
  data.js    (487 satır)  Veri modeli, localStorage, Excel satır normalizasyonu, TomTom key
  osrm.js    ( 75 satır)  OSRM HTTP istemcisi (matrix + route)
  tomtom.js  ( 65 satır)  TomTom Routing API istemcisi (canlı trafikli tekil bacak sorgusu)
  weather.js (131 satır)  Open-Meteo istemcisi + WMO kod → uyarı çevirisi
  optimizer.js (336 satır) TEK ARAÇ rota sıralama algoritması (+ costMetric: mesafe/süre)
  fleet.js   (412 satır)  ÇOKLU ARAÇ kümeleme + atama (optimizer'ı sarmalar) + canlı trafik replay
  exporter.js (458 satır) Excel/PDF üretimi
  app.js    (~1892 satır) UI orkestrasyonu — en büyük dosya, diğer 7 modülü bağlar
vendor/               Üçüncü parti kütüphaneler (hepsi yerel, CDN yok)
```

### Dosya sorumlulukları (tek satır özet)

| Dosya | Export | Sorumluluk |
|---|---|---|
| `data.js` | `TSSData` | Tek gerçek veri kaynağı: lokasyon/araç/durak state'i, localStorage save/load, sefer geçmişi, favoriler, trafik ayarları, TomTom API key, Excel içe aktarma normalizasyonu |
| `osrm.js` | `TSSOsrm` | `matrix(points)` → mesafe/süre matrisi, `route(points)` → çizim geometrisi |
| `tomtom.js` | `TSSTomTom` | `routeLeg(origin, destination, apiKey)` → canlı trafik dahil tekil bacak süresi/mesafesi/güzergahı (bkz. §10.3) |
| `weather.js` | `TSSWeather` | `checkPoints(points)` → uyarı listesi, `describePoint(...)` → tekil özet |
| `optimizer.js` | `TSSOptimizer` | `optimize(options)` → tek araç için en iyi durak sırası + zaman çizelgesi; `costMetric` ile mesafe ya da süre minimize edilir |
| `fleet.js` | `TSSFleet` | `assignFleet(opts)` → hangi durağın hangi araca gideceği; `replayGroup(...)` → elle düzenleme sonrası yeniden simülasyon; `replayGroupWithLiveLegs(...)` → TomTom'dan gelen canlı bacak verisiyle yeniden simülasyon |
| `exporter.js` | `TSSExporter` | `toExcel`, `toPdf`, `toExcelHistory`, `toPdfHistory` |
| `app.js` | (yok, global fonksiyonlar `init()` ile başlar) | DOM event binding, Leaflet haritası, tablo/modal render, tüm kullanıcı etkileşimi |

---

## 5. Veri modeli ve kalıcılık

### 5.1 In-memory state (`data.js` → `state`)

```js
state = {
  locations: [ { id, name, lat, lng, from, until } ],
  vehicles:  [ { id, plate, model, capacity, usable } ],
  stops:     [ { id, locationId, type: 'pickup'|'delivery', pallets } ],
  plan:      null | { startLocation, isWeekend, groups:[...], warning, note },
  history:   [ { id, approvedAt, note, vehicles, vehicleSummary, start,
                 departure, distance, duration, stopCount, groups } ],
  favorites: [ { id, createdAt, name, startLocationId, startLocationName,
                 departure, serviceMinutes, initialLoad, stops:[...] } ],
  traffic:   { enabled, applyRushHourOnWeekends,
               morning:{start,end,factor}, evening:{...}, night:{...} },
  tomtomApiKey: ''  // "En Az Süre" modunda canlı trafik için, bkz. §10.3
}
```

Alan detayları:

- **`vehicles[].capacity` vs `usable`** — `capacity` aracın fiziksel/nominal
  palet kapasitesi; `usable` o an için **kullanılabilir** kapasite (örn. bir
  araç kısmen doluysa veya bakımda bir kısmı ayrılmışsa elle düşürülebilir,
  `setUsableCapacity()`). Tüm planlama/atama algoritmaları `usable`'ı esas alır,
  `capacity`'yi değil.
- **`stops[].type`** — `'pickup'` (yükleme, aracın yükünü artırır) veya
  `'delivery'` (boşaltma, azaltır). Sıralama algoritması hem mesafeyi hem bu
  yük değişimini simüle eder (bkz. §7).
- **`locations[].from` / `until`** — o lokasyona **varılabilecek** zaman
  penceresi (erişim saati), "HH:MM" string. Rota bu pencerenin dışında bir
  varışı ihlal olarak işaretler.
- **`history[].vehicles[].id`** — araç rotasyon mantığı (bkz. §8.3) için
  eklenmiş alan; bir aracın hangi geçmiş seferde kullanıldığını **kimlik**
  üzerinden (plaka değişse bile) izlemeyi sağlar. Bu alan sonradan eklendi —
  eski kayıtlarda olmayabilir, `fleet.js` bu durumda plaka eşleşmesine düşer.
- **`favorites`** bir **sonuç** değil, planlama formunun **girdilerini**
  saklar — yeniden yüklendiğinde rota (araç ataması dahil) o anki güncel
  veriyle tazeden hesaplanır.
- **`tomtomApiKey`** — kullanıcının Trafik Ayarları modalından girdiği TomTom
  Developer Portal anahtarı; `setTomTomApiKey()` ile trim'lenerek saklanır.
  Diğer alanlarla aynı `localStorage` anahtarına yazılır (bkz. §5.2), koda
  hiçbir zaman gömülmez. Sadece "En Az Süre" optimizasyon modu seçiliyken
  kullanılır — bkz. §10.3.
- **Optimizasyon metriği** (`selCostMetric` — "En Kısa Mesafe" / "En Az
  Süre") **kalıcı değildir**, `state`'in bir parçası değil: `planRoute()`
  çağrısı sırasında DOM'dan okunup doğrudan `Fleet.assignFleet(...)`'e
  `costMetric` olarak geçirilir, sayfa yenilenince varsayılan olan
  "En Kısa Mesafe"ye döner.

### 5.2 Kalıcılık

- Tek `localStorage` anahtarı: `tss-rota-panel-v1`.
- `save()` şu alt kümeyi JSON'a çevirip yazar: `locations, vehicles, history,
  favorites, traffic, tomtomApiKey` (`stops` ve `plan` KALICI DEĞİL — sayfa
  yenilenince sıfırlanır, bilinçli bir tasarım: "o anki taslak sefer" kalıcı
  olmamalı).
- `load()` her alanı ayrı ayrı, eksikse `DEFAULT_*` sabitlerine düşerek okur —
  kısmen bozuk/eksik bir kayıt bile uygulamayı kilitlemez.
- `localStorage` erişimi başarısız olursa (`try/catch`) sessizce yutulur —
  uygulama yine çalışır, sadece kalıcılık olmaz.

### 5.3 Excel içe aktarma normalizasyonu

`normalizeKey()` başlıkları küçük harfe çevirip Türkçe karakterleri sadeleştirir
(`ı→i, ş→s, ğ→g, ü→u, ö→o, ç→c`) ve alfanümerik olmayanı siler — böylece
"Enlem", "enlem ", "Lat", "latitude", "Y" gibi farklı başlık varyasyonları aynı
alana eşlenir (`pick()` fonksiyonu, bkz. `data.js:379-387`).

---

## 6. Uçtan uca kullanıcı akışı

1. **Hareket noktası / saat / durak süresi / başlangıç yükü** ve
   **Optimizasyon metriği** ("En Kısa Mesafe" veya "En Az Süre") girilir (sol
   panel, `selCostMetric`) — bkz. §5.1 ve §7.1.
2. **Durak eklenir**: lokasyon + işlem tipi (yükleme/boşaltma) + palet sayısı.
   Filonun toplam kullanılabilir kapasitesini (`totalFleetCapacity()`) aşan
   girişler `validateStopAddition()` tarafından engellenir.
3. **"Rotayı Planla"** tıklanır (`app.js:planRoute()`):
   1. `Osrm.matrix(points)` — tüm nokta çiftleri için gerçek mesafe/süre matrisi.
   2. `Fleet.assignFleet(...)` — hangi durağın hangi araca gideceğine karar
      verir, her araç grubu için `TSSOptimizer.optimize()`'ı çağırır
      (`costMetric` seçili metriğe göre mesafe ya da OSRM'in süre tahminini
      minimize eder).
   3. Her grup için `Osrm.route(...)` — haritada çizilecek gerçek güzergah
      geometrisi (GeoJSON) ayrı ayrı alınır.
   4. **Sadece "En Az Süre" seçiliyse ve bir TomTom API key kayıtlıysa**:
      `refineGroupWithLiveTraffic(...)` her grubun zaten belirlenmiş durak
      sırasındaki ardışık bacaklar için TomTom'dan canlı trafikli süre/mesafe
      ister ve sonucu `Fleet.replayGroupWithLiveLegs(...)` ile plana işler
      (sıralama kararı değişmez, sadece süre/mesafe rakamları ve harita
      geometrisi güncellenir) — bkz. §10.3. Key yoksa veya istek başarısız
      olursa sessizce OSRM tahminiyle devam edilir.
   5. `finalizePlan()` — tabloyu, haritayı, hava durumu uyarılarını, filo
      uyarı bandını render eder.
4. **Elle düzenleme** (onaydan önce, hepsi mevcut sırayı bozmadan
   `TSSFleet.replayGroup()` ile zaman çizelgesini yeniden hesaplar):
   - Durak sırasını sürükle-bırak (`attachRowDragHandlers` → `reorderGroupRows`)
   - Palet miktarı / durak süresi satırdan elle değiştirme
   - Bir gruba atanan aracı üstteki seçimden değiştirme (`swapGroupVehicle`)
5. **Onaylama**: not eklenip (köprü/tonaj kısıtı gibi OSRM'in bilmediği ama
   sürücünün görmesi gereken uyarılar için) `TSSData.approveTrip(plan)`
   çağrılır → sefer geçmişine kalıcı olarak düşer, kullanılan araçlar bir
   sonraki planlamada rotasyon için işaretlenmiş olur (bkz. §8.3).
6. **Dışa aktarma**: Excel (araç başına sayfa) veya PDF (harita görüntüsü +
   araç başına KPI/tablo bölümü).

Paralel olarak, plan her yenilendiğinde `checkWeather(plan)` her durak için
Open-Meteo'dan tahmin çeker ve olumsuz koşulları (yağmur/kar/fırtına/sis)
üst bantta uyarı olarak gösterir — **rotayı hiç değiştirmez**, sadece
bilgilendirir.

---

## 7. Rota hesaplama algoritması (`optimizer.js`)

Tek bir aracın, verilen bir durak kümesini **hangi sırayla** ziyaret etmesi
gerektiğine karar veren asıl algoritma. Problem sınıfı: **kapasiteli
pickup-and-delivery problemi zaman pencereleriyle** (Capacitated PDPTW'nin
basitleştirilmiş bir varyantı — tüm pickup/delivery çiftleri bağımsız,
"bu delivery şu pickup'a bağlı" gibi bir eşleştirme kısıtı yok, sadece toplam
yük kapasiteyi aşmasın diye izleniyor).

### 7.1 Adımlar

```
1. nearestNeighbor()   → başlangıç sırası (açgözlü sezgisel)
2. twoOpt()            → iyileştirme geçişi #1
3. orOpt()             → iyileştirme geçişi #2
4. twoOpt()            → iyileştirme geçişi #3 (or-opt'un açtığı yeni fırsatları yakalamak için)
5. (≤7 durak ise) bruteForce() → tüm permütasyonları dener, daha iyiyse değiştirir
```

#### `nearestNeighbor(ctx)` — başlangıç çözümü

Klasik **tek başlangıçlı, açgözlü** (greedy) en-yakın-komşu sezgiseli:
her adımda, o anki konumdan **gerçek yol mesafesine göre** en yakın ziyaret
edilmemiş durağı seçer. Her zaman hareket noktasından (`index 0`) başlar —
çoklu başlangıç denemesi (multi-start) yok, geri alma (backtracking) yok.
Süre/trafik/zaman penceresi bu aşamada rol oynamaz, sadece mesafe.

> Koddaki `// Yükleme öncelikli...` yorumu **artık (vestigial)** — pickup/
> delivery ayrımı skor hesabında fiilen kullanılmıyor, sadece mesafeye bakılıyor.
> Kapasite kısıtı bu aşamada değil, sonraki adımların ceza mekanizmasıyla
> dolaylı olarak zorlanıyor.

#### `simulate(order, ctx)` — maliyet/zaman çizelgesi motoru

Verilen bir durak sırasını **baştan sona simüle eden** ve her iki iyileştirme
algoritmasının da "bu sıra ne kadar iyi?" sorusuna cevap vermek için tekrar
tekrar çağırdığı çekirdek fonksiyon:

- Her bacak için: `legDistance = distances[prev][idx]`,
  `legTime = durations[prev][idx] * trafficFactorAt(clock, ...)`.
- Varış saati lokasyonun `from`'undan önceyse **açılışı bekler** (uyarı, ama
  ihlal değil); `until`'den sonraysa **zaman penceresi ihlali** sayılır.
- `pickup` → yük artar, kapasiteyi aşarsa **kapasite ihlali**;
  `delivery` → yük azalır, negatife düşerse yine ihlal.
- Servis süresi (`serviceSec`) her durakta varışa eklenir.
- `returnToStart: true` ise son duraktan başlangıca dönüş bacağı da eklenir
  (tek araçlı planlamada varsayılan; `fleet.js` çoklu araç kümesi için bunu
  `false` geçer — dönüş, grupların birleşik tablosunda ayrı ele alınmaz).

**Maliyet fonksiyonu** (yerel arama bunu minimize etmeye çalışır):

```
baseCost = costMetric === 'duration' ? totalSeconds : totalDistance   // bkz. aşağı
cost = baseCost
     + capacityViolations × 1e7   // PENALTY_CAPACITY — pratikte asla tercih edilmez
     + timeViolations     × 5e5   // PENALTY_TIME     — mümkünse kaçınılır
```

**`costMetric` — hangi büyüklük minimize ediliyor:** `'distance'`
(varsayılan, önceki davranışla birebir aynı — en kısa km) veya `'duration'`
(en az süre; sıralama kararı yine OSRM'in matrix'inden çıkan **tahmini**
süreye göre verilir, canlı trafik değil). Sıralama/2-opt/Or-opt/tam-arama
mantığının kendisine dokunulmadı — sadece bu adımların minimize etmeye
çalıştığı sayı (`baseCost`) değişiyor. "En Az Süre" seçildiğinde, `fleet.js`
üzerinden sıralama belirlendikten **sonra** `app.js` isteğe bağlı olarak
TomTom'dan gerçek canlı trafik verisi ister (bkz. §10.3) — bu, optimizer'ın
kendi karar sürecinin bir parçası değildir, sadece sonuç rakamlarını
günceller.

Bu **soft-penalty** (yumuşak kısıt) yaklaşımı sayesinde kısıt tam
sağlanamasa bile algoritma her zaman *bir* çözüm üretir; kısıt ihlal edilmiş
olsa da en düşük ihlalli/en kısa seçenek döner. Kesin sağlanabilirlik garantisi
yoktur — "en iyi çaba" (best-effort) modeli.

#### `twoOpt(order, ctx, bestResult)` — 2-opt iyileştirme

Sıradaki iki noktayı seçip aralarındaki **segmenti ters çevirir**
(`order.slice(0,i) + reverse(order.slice(i,k+1)) + order.slice(k+1)`), maliyeti
azaltıyorsa kabul eder. Klasik TSP 2-opt — çaprazlanan (kesişen) bacakları
düzeltmede etkilidir. `guard < 200` ile sonsuz döngüye karşı korunmuş,
`improved` bayrağıyla yerel optimuma ulaşana kadar tekrarlanır.
Karmaşıklık: her geçiş O(n²) aday × O(n) simülasyon = O(n³); küçük durak
sayılarında (~onlarca) sorun değil.

#### `orOpt(order, ctx, bestResult)` — Or-opt iyileştirme

2-opt'un yakalayamadığı bir hareket türü: **tek bir durağı bambaşka bir
konuma taşımak** (segment ters çevirmeden). İki durak arasındaki sırayı
korurken üçüncü bir durağı en uygun yere "sıkıştırmak" için gerekli —
özellikle pickup/delivery sırasının kapasite ihlaline yol açtığı durumlarda
düzeltici.

#### `bruteForce(ctx)` — tam arama (≤7 durak)

7 veya daha az durak varsa (`7! = 5040` permütasyon — hesaplanabilir), **tüm
olası sıralamalar** denenir ve gerçek global optimum bulunur. Yerel aramanın
(2-opt/Or-opt) bulduğu sonuçtan daha iyiyse onun yerine geçer. Bu, küçük
problemlerde **kesin optimum garantisi** sağlar; büyük problemlerde (8+ durak)
garanti yoktur, sadece iyi bir yaklaşık çözüm.

### 7.2 Trafik modeli

Gerçek trafik verisi/API'si **yok** (maliyet/backend gerektirir). Bunun yerine
gün içi sabit zaman dilimlerine göre bir **süre çarpanı** uygulanır
(`trafficFactorAt(clockSec, traffic, isWeekend)`):

```
sabah yoğunluğu  07:00–09:30  × 1.8   (varsayılan, DEFAULT_TRAFFIC — ayarlardan değiştirilebilir)
akşam yoğunluğu  17:00–19:30  × 2.2
gece (az trafik) 23:00–06:00  × 1.0
hafta sonu       varsayılan olarak sabah/akşam çarpanları UYGULANMAZ
                 (Trafik Ayarları'ndan "hafta sonu da uygula" açılabilir)
```

> Not: "Gece (az trafik)" bandının varsayılan çarpanı **1.0**'dır — yani
> fabrika ayarında geceleri süreyi hızlandırmaz ya da yavaşlatmaz, sadece
> etiket olarak ayrılmış bir zaman dilimidir. Gerçekten daha düşük bir gece
> çarpanı isteniyorsa Trafik Ayarları'ndan elle 1'in altına düşürülmelidir.

Bu çarpanlar yalnızca **süreyi** etkiler, mesafeyi (km) **değiştirmez** —
ve sadece OSRM tabanlı tahmine uygulanır: "En Az Süre" modunda TomTom'dan
canlı trafik verisi alınabilirse (bkz. §10.3), o bacaklar için bu sabit
çarpanlar **hiç uygulanmaz** (`replayGroupWithLiveLegs`, TomTom'un süresi
zaten canlı trafik dahil olduğundan tekrar çarpmak trafiği iki kez saymak
olurdu). `isWeekendToday()` tarayıcının o anki gününe bakar — uygulamada
ileri tarihli planlama yok, "bugün" sefer planlanıyor varsayılır.

### 7.3 Girdi/çıktı sözleşmesi

```js
TSSOptimizer.optimize({
  startLocation, stops: [{location, type, pallets}],
  distances, durations,           // OSRM'den, [n+1][n+1] matris (0=start)
  serviceMinutes, departureTime,  // "HH:MM"
  initialLoad, capacity,
  returnToStart,                  // true = tek araç modu, false = fleet.js kümesi
  traffic, isWeekend,
  costMetric                      // 'distance' (varsayılan) | 'duration', bkz. §7.1
})
// → { rows, distance, totalSeconds, finishSec, maxLoad,
//     capacityViolations, timeViolations, cost, order,
//     orderedNodes, feasible }
```

---

## 8. Çoklu araç ataması (`fleet.js`)

`optimizer.js`'in sıralama algoritmasına **hiç dokunmadan**, hangi durağın
hangi araca gideceğine karar veren ayrı bir katman.

### 8.1 Karar akışı

```
                     ┌─────────────────────────┐
                     │ Tüm duraklar TEK araca   │
                     │ sığıyor mu?              │──── Evet ──▶ o aracı kullan, bitir
                     │ (artan kapasite sırayla   │
                     │  dener, ilk 0-ihlalli     │
                     │  aracı seçer)             │
                     └───────────┬──────────────┘
                                 │ Hayır
                                 ▼
                     ┌─────────────────────────┐
                     │ k=2'den başlayarak       │
                     │ coğrafi kümeleme dene,   │
                     │ her k için best-fit-     │
                     │ decreasing atama dene    │──── Başarılı ──▶ o atamayı kullan
                     │ (k++ gerektikçe artar)   │
                     └───────────┬──────────────┘
                                 │ Hiçbir k için filoya sığmadı
                                 ▼
                     En büyük araca TÜM duraklar verilir,
                     en iyi (ihlalli) rota yine üretilir,
                     ihlaller tabloda/haritada işaretlenir.
```

### 8.2 Coğrafi kümeleme — `clusterStopIndices(stops, fullDistances, k)`

**En-uzak-nokta (farthest-point) tohumlamalı k-means benzeri** bir kümeleme:

1. İlk tohum: hareket noktasına en **uzak** durak.
2. Sonraki her tohum: mevcut tüm tohumlara olan **minimum mesafesi en büyük**
   olan durak (yani "şimdiye kadarki tohumlardan en izole" nokta) — klasik
   farthest-point seeding, k-means++'ın basitleştirilmiş bir hali.
3. Geri kalan tüm duraklar, **en yakın tohuma** atanır (tam k-means gibi
   iterasyonla merkezleri güncellemez — tek geçişlik, sezgisel).

Mesafe kaynağı: **kuş uçuşu değil, OSRM'den gelen gerçek yol mesafesi
matrisi** (`fullDistances`) — bu önemli, çünkü coğrafi olarak yakın görünen
iki nokta bir boğaz/nehir/otoyol nedeniyle yol mesafesinde çok uzak olabilir.

> README'de belirtildiği gibi bu **sezgiseldir, kesin optimum bölüştürme
> garanti etmez** — küçük durak sayılarında iyi çalışır.

### 8.3 Araç eşleme — best-fit-decreasing + rotasyon

Her küme için önce `runOptimizeForSubset(..., capacity: Infinity, ...)` ile
**gerçekte ihtiyaç duyulan maksimum yük** (`maxLoad`) hesaplanır (kapasite
sınırı olmadan sırala, sonra gerçek ihtiyacı öğren). Sonra:

```js
reqs.sort(required azalan)  // en çok ihtiyacı olan küme önce (best-fit-DEcreasing)
her req için:
  candidates = pool.filter(usable >= required)
  candidates.sort(compareVehicles)   // §8.3.1
  picked = candidates[0]             // en uygun (en küçük yeten, rotasyonlu) araç
  pool'dan çıkar (bir araç bir planda yalnız bir kümeye gider)
```

Bir küme **asla ikiye bölünmez** — bütün olarak en küçük uygun araca atanır.

#### 8.3.1 `compareVehicles` — kapasite + rotasyon karşılaştırıcısı

```js
function makeVehicleComparator(lastUsedMap) {
  return function (a, b) {
    if (a.usable !== b.usable) return a.usable - b.usable;      // 1. öncelik: kapasite
    return lastUsedOf(lastUsedMap, a) - lastUsedOf(lastUsedMap, b); // 2. öncelik: rotasyon
  };
}
```

**Birincil kural değişmedi:** en küçük yeten kapasiteli araç önce dener —
gereksiz büyük araç asla "adalet" için zorlanmaz. **İkincil kural (rotasyon):**
kapasitesi eşit birden fazla aday varsa, **sefer geçmişinde en son ne zaman
kullanıldığına** bakılır ve en uzun süredir (veya hiç) kullanılmamış olan
öne alınır.

`lastUsedMap`, **ayrı bir alan/state olarak tutulmaz** — her planlamada
`TSSData.getHistory()`'den (`opts.history` üzerinden `app.js` tarafından
geçirilir) **anlık olarak türetilir**:

```js
function buildLastUsedMap(history) {
  // history en yeniden en eskiye sıralı (approveTrip → unshift)
  // → bir araç id'sine ilk rastlanan kayıt, o aracın en son kullanıldığı seferdir.
  var byId = {}, byPlate = {};
  history.forEach(entry => entry.vehicles.forEach(v => {
    if (v.id && byId[v.id] === undefined) byId[v.id] = entry.approvedAt;
    if (v.plate && byPlate[v.plate] === undefined) byPlate[v.plate] = entry.approvedAt;
  }));
  return { byId, byPlate };
}
```

`id` ile eşleşme öncelikli (kimlik bazlı, plaka değişse bile doğru); `id`
taşımayan eski geçmiş kayıtları için **plaka** eşleşmesine düşülür (geriye
dönük uyumluluk — `id` alanı sefer geçmişine sonradan eklendi).

**Sonuç:** Aynı yük büyüklüğü tekrar tekrar planlandığında, kapasitesi
yeten araçlar arasında **otomatik rotasyon** oluşur — hep aynı araç değil,
sırayla farklı araçlar önerilir; hiçbir zaman kapasiteye uygunsuz bir araç
sadece rotasyon için seçilmez.

### 8.4 Başlangıç yükü ve grup sıralaması

- **Başlangıç Yükü** tek bir fiziksel araca aittir — çoklu araç gerektiğinde,
  hareket noktasına **en yakın kümeye** atanan araca eklenir
  (`closestClusterToStart`).
- Görüntüleme sırası: `groups.sort(...)` başlangıca en yakın grup (genelde
  ilk hareket eden) önce listelenir.

### 8.5 `replayGroup(group, opts)` — sırayı bozmadan yeniden oynatma

Kullanıcı bir durağı sürükleyip sıra değiştirdiğinde, palet/servis süresini
elle düzenlediğinde ya da bir gruba atanan aracı manuel değiştirdiğinde,
**sıralama kararı yeniden hesaplanmaz** — sadece `optimizer.js`'teki
`simulate()` ile birebir aynı ileri-yönlü mantık (varış/ayrılış/yük/ihlal
hesabı), verilen sabit sırayı kullanarak tekrar oynatılır. Bu bilinçli bir
kod tekrarı: `simulate()` hem "en iyi sırayı bul" hem "zaman çizelgesi üret"
işini birlikte yapan bir fonksiyon; burada sadece ikincisi gerekiyor.

### 8.6 `replayGroupWithLiveLegs(group, legs, opts)` — TomTom canlı trafik replay'i

`replayGroup`'un bir varyantı: aynı şekilde **sırayı (`group.order`)
değiştirmez**, ama bacak mesafe/süresini OSRM matrisinden değil,
**dışarıdan** (`js/app.js` → `refineGroupWithLiveTraffic` → TomTom'dan)
verilen gerçek değerlerden okur (`legs: [{distanceMeters, durationSeconds}, ...]`,
`group.order` ile aynı uzunlukta ve sırada). Önemli fark: `legTime`'a
`optimizer.js`'teki sabit trafik çarpanı **uygulanmaz** — TomTom'un süresi
zaten canlı trafiği içerdiğinden, üstüne bir de sabit çarpan uygulamak
trafiği iki kez saymak olurdu. Kapasite/zaman penceresi ihlal mantığı
(`simulate`/`replayGroup` ile aynı) değişmeden korunur. `js/app.js` bu
sonucu doğrudan `group.result`'ın yerine koyar ve harita geometrisini de
TomTom'un döndürdüğü bacak geometrilerinin birleşimiyle günceller — bkz.
§10.3.

---

## 9. Harita katmanı

`app.js` içinde Leaflet ile:

- `initMap()` — `preferCanvas: true` ile başlatılır (SVG değil canvas
  render); sebep: PDF export'taki `html2canvas` yakalaması SVG katmanını
  güvenilir okuyamıyor.
- Sağ tık → `modalLocations` açılır, tıklanan koordinatlar forma otomatik
  dolar (hızlı lokasyon ekleme).
- Her araç grubu farklı bir renkle çizilir (`GROUP_COLORS`, 6 renklik döngüsel
  palet, `groupColor(index)`).
- **Marker çakışma önleme** (`computeMarkerOffsets`): aynı binada/çok yakın
  duraklar ekranda üst üste binmesin diye, birbirine 26px'den yakın düşen
  marker'lar için **sabit piksel cinsinden** (coğrafi değil) dairesel bir
  kaydırma hesaplanır — zoom değiştikçe bu kayma büyümez, çünkü coğrafi
  konum hiç değişmiyor, sadece görsel ofset piksel olarak sabit kalıyor.
- Hareket noktası tüm araçlar için **tek bir marker** olarak gösterilir
  (aksi halde aynı koordinatta grup sayısı kadar üst üste marker olurdu);
  tooltip'te oradan kalkan tüm plakalar listelenir.
- `buildGoogleMapsUrl(group, startLocation)` — optimize edilmiş durak
  sırasını Google Maps'in `dir/?api=1` yol tarifi linkine çevirir
  (origin + waypoints + destination), kullanıcı tek tıkla telefonunda
  navigasyonu açabilir.

---

## 10. Dış servisler

### 10.1 OSRM (`osrm.js`)

| Fonksiyon | Endpoint | Kullanım |
|---|---|---|
| `matrix(points)` | `GET /table/v1/driving/{coords}?annotations=duration,distance` | Tüm nokta çiftleri arası mesafe(m)/süre(sn) — optimizer'ın girdisi |
| `route(points)` | `GET /route/v1/driving/{coords}?overview=full&geometries=geojson` | Sıralı noktalar için haritada çizilecek gerçek yol geometrisi |

`BASE = 'https://router.project-osrm.org'` — **halka açık demo sunucu**,
`setBase()` ile değiştirilebilir (bkz. §13). Koordinatlar `lng,lat` sırasıyla
(OSRM'in beklediği format), 6 ondalık hane hassasiyetle gönderilir.

### 10.2 Open-Meteo (`weather.js`)

`GET /v1/forecast?latitude=..&longitude=..&hourly=weathercode,precipitation,
snowfall,temperature_2m&timezone=auto&forecast_days=2`

- Anahtar gerektirmez.
- **30 dakikalık bellek-içi cache** (`CACHE_TTL_MS`), koordinat 2 ondalık
  haneye yuvarlanarak anahtarlanır (`lat.toFixed(2)+','+lng.toFixed(2)`) —
  aynı bölgedeki tekrarlanan istekleri azaltır.
- WMO hava kodu → kategori eşlemesi (`CODE_INFO`): `ok` (uyarı listesine
  girmez), `sis`, `yagmur`, `kar`, `firtina`. Her durağın **planlanan varış
  saatine en yakın saatlik tahmin** (`nearestHourIndex`) kullanılır.
- Bir konum için istek başarısız olursa o nokta **sessizce atlanır** — hava
  durumu servisi hiçbir zaman rota planlamayı bloke etmez/bozmaz.

### 10.3 TomTom Routing API (`tomtom.js`) — opsiyonel canlı trafik

| Fonksiyon | Endpoint | Kullanım |
|---|---|---|
| `routeLeg(origin, destination, apiKey)` | `GET /routing/1/calculateRoute/{lat,lng}:{lat,lng}/json?traffic=true&travelMode=car` | Tek bir bacak için canlı trafik dahil mesafe/süre/güzergah geometrisi |

`BASE = 'https://api.tomtom.com/routing/1/calculateRoute'`. OSRM'in aksine
**varsayılan olarak kapalıdır**: sadece iki koşul birden sağlanınca devreye
girer — (1) Optimizasyon metriği **"En Az Süre"** seçili, (2) Trafik
Ayarları'ndan geçerli bir **TomTom API key** girilmiş. Her iki koşul da
sağlanmazsa `tomtom.js` hiç çağrılmaz, uygulama tamamen OSRM'in tahmini
üzerinden çalışmaya devam eder — bu yüzden özelliği hiç kullanmayan bir
kurulum için davranış **birebir eskisiyle aynıdır**.

**Neden n istek, n² değil:** Sıralama kararının kendisi hâlâ OSRM'in
ücretsiz/sınırsız `matrix()`'inden çıkıyor (tüm nokta çiftleri). TomTom'a
sadece optimizer'ın **zaten belirlemiş olduğu** son sıradaki **ardışık**
bacaklar için istek atılır (`refineGroupWithLiveTraffic`, `js/app.js`) —
bir grupta *n* durak varsa *n* istek, tüm nokta çiftleri için değil. Bu,
TomTom'un ücretli/kotalı olması nedeniyle bilinçli bir maliyet kısıtlaması.

**Best-effort davranış:** Herhangi bir bacak isteği başarısız olursa
(geçersiz key, kota aşımı, ağ hatası) **tüm grup için** sessizce vazgeçilir
ve OSRM'in zaten hesaplamış olduğu sonuç/geometri aynen kalır — kullanıcıya
sadece bir toast uyarısı (`'TomTom canlı trafik verisine ulaşılamadı…'`)
gösterilir, planlama asla başarısız olmaz. Bu, projenin genel "kısıt
sağlanamasa da her zaman bir rota üret" felsefesiyle tutarlı.

**Güvenlik notu:** Proje backend'siz olduğu için API key kaçınılmaz olarak
tarayıcıdan (Network sekmesinde, istek URL'sinde) görünür durumdadır. Bu,
key'i kaynak koduna sabit yazmaktan **farklıdır**: key kullanıcı tarafından
arayüzden (Trafik Ayarları → TomTom API Key, `type="password"` input) girilir,
sadece o tarayıcının `localStorage`'ında tutulur (bkz. §5), hiçbir dosyaya/
repoya gömülmez. Yine de TomTom panelinden key'e **domain kısıtlaması**
eklenmesi önerilir (bkz. §12).

---

## 11. Excel / PDF dışa aktarım

### 11.1 Excel (`toExcel`, `toExcelHistory`)

- SheetJS (`XLSX.utils.aoa_to_sheet`) ile satır-dizisi → sayfa.
- Rota exportunda **her araç grubu ayrı bir sayfa** (`safeSheetName` —
  Excel'in 31 karakter / yasak karakter kısıtına göre plaka isimlerini
  güvenli sayfa adına çevirir, çakışmaları numaralandırır).

### 11.2 PDF (`toPdf`, `toPdfHistory`)

- jsPDF + autotable, A4 yatay.
- **Türkçe font sorunu:** jsPDF'in varsayılan gömülü fontu (Helvetica)
  `ı,ş,ğ,ç,ö,ü,İ` karakterlerini içermiyor. `registerPdfFont()` varsa
  `vendor/fonts/pdf-font-arial.js`'teki base64 TTF'i VFS'e yükleyip
  `Arial` adıyla kaydeder; yoksa sessizce varsayılan fonta düşer (export
  yine çalışır, sadece Türkçe karakterler bozuk görünebilir).
- **oklch() renk sorunu:** Tasarım sistemi CSS değişkenleri `oklch()` renk
  fonksiyonuyla tanımlı, ama vendörlenmiş `html2canvas` sürümü bunu
  ayrıştıramıyor. `withOklchFallback()` harita yakalaması sırasında bu
  değişkenleri **geçici olarak** hex/rgba karşılıklarına çevirir, işlem
  bitince geri yükler — uygulamanın gerçek stilleri hiç değişmez.
- Harita yakalanamazsa (tarayıcı güvenlik kısıtı, CORS vb.) PDF **tablo
  ile üretilmeye devam eder**, durum PDF üzerinde belirtilir — export hiçbir
  zaman tamamen başarısız olmaz.
- Sefer geçmişi PDF'i ayrıca 4 KPI kartı içerir: bu ay/bu hafta sefer sayısı,
  en çok kullanılan araç, en çok uğranılan lokasyon (`computeHistoryStats`).

---

## 12. Güvenlik notları

- **XSS koruması:** Lokasyon adı, plaka, model gibi kullanıcı/Excel
  kaynaklı veriler `innerHTML`'e yazılmadan önce **her yerde**
  `escapeHtml()` ile kaçışlanıyor (`app.js:29-36`) — kötü niyetli bir isim
  (`<img onerror=...>` gibi) sayfada script çalıştıramaz.
- **Veri güvenilirliği:** Tüm veri tarayıcı tarafında, tek kullanıcı
  bağlamında tutulduğu için sunucu tarafı yetkilendirme/doğrulama yok —
  bu, uygulamanın **tek kullanıcılı/dahili araç** olarak tasarlandığının
  bir yansıması (bkz. §13).
- **TomTom API key:** `localStorage`'da düz metin olarak saklanır (diğer
  hiçbir alan gibi şifrelenmez) ve her istekte URL query string'i olarak
  (Network sekmesinde görünür şekilde) gönderilir — sunucu tarafı bir proxy
  olmadığı için kaçınılmaz bir mimari sınır. Aynı tarayıcıyı/cihazı paylaşan
  başka biri bu key'i DevTools'tan okuyabilir. Azaltıcı önlem: key sahibi
  TomTom Developer Portal'dan key'e **domain/referrer kısıtlaması**
  eklemeli, böylece key başka bir yerden çalınsa bile sadece bu uygulamanın
  çalıştığı origin'den kullanılabilir kalır (bkz. §10.3).

---

## 13. Bilinen sınırlar ve production riskleri

*(README.md'deki "Bilinen sınırlar" ve "Devam edecek geliştiriciler için"
bölümleriyle birebir tutarlı; burada teknik gerekçeleriyle özetleniyor.)*

| Sınır | Teknik sebep | Etkisi |
|---|---|---|
| OSRM halka açık demo sunucusu | `osrm.js`'teki sabit `BASE` | Canlıda rate-limit/SLA yokluğu — bkz. README §"Devam edecek geliştiriciler için" |
| Sadece `localStorage` kalıcılık | Backend/DB yok | Tek tarayıcıya bağlı, ekip içi paylaşım yok, veri kaybı riski |
| Yasak güzergah kısıtı yok | OSRM demo sunucusu özel `exclude` profili desteklemiyor | Köprü/tonaj kısıtları rotaya yansımaz — sadece onay notuna elle yazılabilir |
| Kümeleme kesin optimum değil | Sezgisel farthest-point seeding, tek geçiş | Çok sayıda dağınık durakta teorik en iyi bölüştürme garanti edilmez |
| Trafik verisi kısmen gerçek | "En Az Süre" modunda TomTom opsiyonel olarak canlı trafik verir (§10.3), ama **varsayılan mod "En Kısa Mesafe"** ve TomTom key girilmediği sürece hâlâ sabit zaman dilimi çarpanları kullanılıyor | Kullanıcı key girip "En Az Süre"yi seçmezse hâlâ kaba tahmin; TomTom ücretli/kotalı olduğundan kesintisiz canlı trafik garanti değil |
| TomTom entegrasyonu opsiyonel/best-effort | Key yoksa veya istek başarısız olursa sessizce OSRM'e düşülür | Kullanıcı "En Az Süre"yi seçse de key girmemişse fiilen hâlâ OSRM'in statik tahminiyle çalışılır — arayüzde bu durum sadece toast ile bildirilir, tabloda ayrıca işaretlenmez |
| Otomatik test yok | — | `optimizer.js`/`fleet.js` değişikliklerinde regresyon elle test edilmeli |

---

## 14. Devam edecek geliştiriciler için yol haritası

Bu proje şu an **canlıya alınması planlanmıyor** — mevcut haliyle bir
dahili/demo araç olarak kalabilir. İleride biri canlıya almaya karar verirse
öncelik sırası:

1. **Kendi OSRM örneğini kur**, `TSSOsrm.setBase()` ile veya `osrm.js`
   içindeki `BASE`'i değiştirerek yönlendir — demo sunucu ile sürekli/ticari
   trafiğe çıkmak güvenli değil.
2. **Kalıcılığı backend'e taşı** — `TSSData` arayüzünün (fonksiyon
   imzaları: `addLocation`, `addVehicle`, `approveTrip`, `getHistory` vb.)
   korunması, üstteki `app.js`/`fleet.js`/`exporter.js` kodunun
   değişmeden kalmasını sağlar (implementasyon detayı `data.js` içine
   hapsedilmiş — bu ayrım bilinçli).
3. **`optimizer.js` ve `fleet.js` için senaryo testleri** ekle — bilinen
   girdi (durak listesi + mesafe matrisi) → beklenen sıralama/ihlal
   çıktısı; bu iki dosya saf fonksiyonlar olduğu için (DOM'a bağımlı değil)
   test edilmesi kolay, sadece hiç yapılmamış.
4. Yasak güzergah kısıtı gibi README'de "sonraki faz" olarak işaretlenmiş
   genişletmeler. Gerçek trafik verisi için TomTom entegrasyonu (§10.3)
   kısmen bu ihtiyacı karşılıyor — bir sonraki adım bunu "En Az Süre"
   modunun ötesine, sıralama kararının kendisine de (şu an sadece OSRM
   matrix'i kullanılıyor) taşımak olabilir, ancak bu TomTom'un ücretli
   matrix endpoint'ini gerektirir.

---

*Bu doküman, kod tabanının mevcut hali (2026-09-01 itibarıyla, TomTom canlı
trafik entegrasyonu ve "En Az Süre" optimizasyon modu dahil) üzerinden elle
incelenerek hazırlanmıştır/revize edilmiştir. Kaynak dosyalar değiştikçe
güncel tutulmalıdır — özellikle §7/§8/§10.3'teki algoritma ve entegrasyon
açıklamaları `optimizer.js`/`fleet.js`/`tomtom.js`'in birebir güncel
haliyle senkron kalmalı.*
