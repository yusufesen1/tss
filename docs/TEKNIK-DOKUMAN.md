# TSS — Rota Planlama Paneli — Teknik Doküman

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
15. [Backend (`server/`) — veri katmanı](#15-backend-server--veri-katmanı)

---

## 1. Amaç ve kapsam

Uygulama, bir lojistik/sefer planlama ekibinin **günlük araç turlarını** planlamasını
sağlayan, tarayıcıda çalışan bir araçtır:

- Bir hareket noktasından çıkıp birden fazla lokasyonda yükleme/boşaltma yapacak
  seferler tanımlanır (kapasiteli pickup-and-delivery problemi).
- Sistem, hangi aracın/araçların kullanılacağına ve duraklerin hangi sırayla
  ziyaret edileceğine **otomatik karar verir** — gerçek yol mesafesi, araç
  kapasitesi, lokasyon erişim saatleri ve kaba bir trafik modeli göz önünde
  bulundurularak.
- Sonuç harita üzerinde çizilir, tablo halinde gösterilir, gerekirse elle
  düzenlenir, onaylanır (sefer geçmişine düşer) ve Excel/PDF olarak dışa
  aktarılır.

**Çalıştırma modeli:** klasik istemci-sunucu. `server/` (Express + SQLite)
hem veriyi tutar hem `public/` altındaki statik dosyaları servis eder;
tarayıcı yalnızca arayüzü ve rota algoritmasını çalıştırır.

```
node server/index.js   →   http://localhost:3000
                           http://<sunucu-ip>:3000   (aynı LAN'daki diğer cihazlar)
```

| | |
|---|---|
| Gerçek veri kaynağı | SQLite — `server/data/tss.db` |
| Tarayıcıdaki `localStorage` | Yalnızca açılış önbelleği + outbox tamponu (§5.4) |
| Ekip paylaşımı | Aynı ağdaki tüm cihazlar aynı veriyi görür |
| Erişim kontrolü | Paylaşılan `APP_TOKEN` (§12) |
| Kurulum | Bir kez `npm install` (yalnızca sunucuyu çalıştıran makinede) |

> **Tarihsel not:** proje başlangıçta kasıtlı olarak backend'sizdi — dosya
> çift tıklanarak (`file://`) açılıyor ve tüm veri `localStorage`'da
> tutuluyordu. Bu model tek kullanıcı için işliyordu ama ekip içinde veri
> paylaşımını, yedeklemeyi ve API anahtarlarını güvende tutmayı imkansız
> kılıyordu; ayrıca CORS'a kapalı servislere erişmek için GitHub Actions ile
> statik dosya üretmek gibi dolambaçlı çözümler gerektiriyordu. Backend
> eklendikten sonra bu mod kaldırıldı — tek çalıştırma yolu yukarıdakidir.
> `file://` ile açılırsa panel hata bandıyla ne yapılması gerektiğini söyler.

---

## 2. Genel mimari

```
┌─────────────────────────────────────────────────────────────┐
│                        index.html                            │
│  (DOM iskeleti, modal'lar, <script> yükleme sırası)           │
└─────────────────────────────────────────────────────────────┘
        │
        ▼  script sırası: data → osrm → tomtom → weather → fuelprice → optimizer → fleet → exporter → app

TARAYICI  (public/)
├── VERİ / DIŞ SERVİS KATMANI
│   ┌──────────────┐ ┌─────────┐ ┌──────────┐ ┌───────────┐ ┌─────────────┐
│   │  data.js     │ │ osrm.js │ │tomtom.js │ │weather.js │ │fuelprice.js │
│   │ state +      │ │ mesafe/ │ │  canlı   │ │   hava    │ │  TL/L fiyat │
│   │ önbellek +   │ │  rota   │ │  trafik  │ │  durumu   │ │             │
│   │ outbox       │ └────┬────┘ └────┬─────┘ └─────┬─────┘ └──────┬──────┘
│   └──────┬───────┘      │           │             │              │
│          │              │           │             │              │
├── ALGORİTMA KATMANI (saf JS, DOM'a hiç dokunmaz)                 │
│   ┌──────▼───────────┐  │ (mesafe/süre matrisi)   │              │
│   │  optimizer.js    │◀─┘                         │              │
│   │  tek araç sıralama│                            │              │
│   └──────┬───────────┘                            │              │
│   ┌──────▼───────────┐                            │              │
│   │  fleet.js        │◀───────────────────────────┘              │
│   │  çoklu araç      │  (replayGroupWithLiveLegs)                │
│   │  kümeleme/atama  │                                           │
│   └──────┬───────────┘                                           │
│          │                                                       │
└── ARAYÜZ KATMANI                                                 │
    ┌──────▼──────────────────────────────────────────────────────────┐
    │  app.js — DOM binding, Leaflet haritası, tablo/modal yönetimi    │
    └──────┬───────────────────────────────────────────┬─────────────┘
           │                                           ▼
           │                                ┌────────────────────┐
           │                                │    exporter.js     │
           │                                │    Excel / PDF     │
           │                                └────────────────────┘
           │
           │  aynı origin, X-TSS-Token ile (CORS yok)
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  SUNUCU — server/  (Express + SQLite)                                 │
│                                                                       │
│  • GET  /api/bootstrap        açılışta tüm veri (§5.4)                │
│  • POST/PUT/PATCH/DELETE      yazmalar, data.js outbox'ı üzerinden    │
│  • POST /api/tomtom/route-leg TomTom proxy'si — anahtar burada kalır  │
│  • GET  /api/fuel-price       kaynaktan doğrudan (CORS engeli yok)    │
│  • express.static(public/)    frontend'i de bu sunucu servis eder     │
│                                                                       │
│         ┌──────────────────────┐      ┌───────────────────────┐      │
│         │ SQLite               │      │  Dış servisler        │      │
│         │ server/data/tss.db   │      │  TomTom, yakıt fiyatı │      │
│         │ (tek gerçek kaynak)  │      └───────────────────────┘      │
│         └──────────────────────┘                                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Neden bazı şeyler hâlâ tarayıcıda:** `app.js`/Leaflet/DOM zorunlu olarak
istemci tarafındadır. `optimizer.js` ve `fleet.js` teknik olarak sunucuya
taşınabilir (saf fonksiyonlar) ama taşınmadı: sürükle-bırak ile durak sırası
değiştirildiğinde rota **anında** yeniden hesaplanıyor; sunucuya taşımak her
düzenlemeye bir ağ gidiş-dönüşü eklerdi. `exporter.js`'in PDF tarafı da
canlı haritanın ekran görüntüsünü aldığı için doğası gereği tarayıcı işidir.
`osrm.js`/`weather.js` ise anahtar gerektirmediğinden proxy'lenmedi —
gizlenecek bir sır yok, araya sunucu koymak sadece gecikme eklerdi.

**Modül deseni:** Her `js/*.js` dosyası bir IIFE içinde tanımlanır ve `window`
üzerine **tek bir obje** export eder (`window.TSSData`, `window.TSSOsrm`,
`window.TSSTomTom`, `window.TSSWeather`, `window.TSSOptimizer`, `window.TSSFleet`,
`window.TSSExporter`). Modül sistemi (ESM/CommonJS/bundler) yok — sıralı
`<script>` etiketleriyle global namespace'e yükleniyor (bkz. `public/index.html`,
`<script>` blokları dosyanın sonunda, `</body>`'den hemen önce). Dairesel
bağımlılık yok; bağımlılık grafiği tek yönlü:

```
data.js  (bağımsız — sadece kendi state'i; dış fiyat/tüketim servislerinden habersiz, bkz. §10.4)
osrm.js  (bağımsız)
tomtom.js (bağımsız — sadece public/js/app.js tarafından, opsiyonel/best-effort çağrılır)
weather.js (bağımsız)
fuelprice.js (bağımsız — sadece public/js/app.js tarafından, opsiyonel/best-effort çağrılır, bkz. §10.4)
optimizer.js (bağımsız — saf hesaplama, DOM'a hiç dokunmaz)
fleet.js  → optimizer.js  (+ replayGroupWithLiveLegs: TomTom'un ürettiği bacak
                            verisini işler, ama TomTom'u kendisi hiç çağırmaz)
exporter.js (bağımsız — sadece plan/history nesnesi alır)
app.js    → data.js + osrm.js + tomtom.js + weather.js + fuelprice.js + optimizer.js + fleet.js + exporter.js
```

Bu ayrım bilinçli: **algoritma katmanı (`optimizer.js`, `fleet.js`) hiçbir
DOM/tarayıcı API'sine bağımlı değil** — saf JS fonksiyonları olarak yazılmış,
teorik olarak Node.js'te de (tarayıcı olmadan) test edilebilir/çalıştırılabilir
(bu dokümandaki doğrulama komutları da zaten `node -e` ile böyle çalıştırıldı).

---

## 3. Tech stack

| Katman | Teknoloji | Not |
|---|---|---|
| Dil (her iki taraf) | Vanilla JavaScript, ES5 üslubu (`'use strict'`, `function` ifadeleri, IIFE) | Framework yok, build adımı yok, TypeScript yok — ne tarayıcıda ne sunucuda |
| Backend | Node.js + Express 5 | `server/index.js` — REST + `public/` sunumu + `X-TSS-Token`; frontend'le aynı origin, CORS yapılandırması yok |
| Kalıcılık | SQLite (`better-sqlite3`), tek dosya: `server/data/tss.db` | Gerçek veri kaynağı. Tarayıcıdaki `localStorage` (`tss-rota-panel-v1` + `tss-outbox-v1`) yalnızca önbellek/outbox — bkz. §5.4 |
| Harita | Leaflet | `public/vendor/` altında yerel, CDN değil |
| Harita karoları | OpenStreetMap (`{s}.tile.openstreetmap.org`) | `public/js/app.js` → `L.tileLayer` — internet bağımlılığı |
| Rota/mesafe | [OSRM](https://project-osrm.org/) demo sunucusu | `public/js/osrm.js` — sıralama kararının tek girdisi, her zaman çağrılır. Demo sunucu riski: §13 |
| Canlı trafik (opsiyonel) | [TomTom Routing API](https://developer.tomtom.com/routing-api) | Yalnızca "En Az Süre" modunda ve bir anahtar tanımlıysa. İstek **backend proxy'sinden** geçer, anahtar tarayıcıya inmez — §10.3, §12 |
| Hava durumu | [Open-Meteo](https://open-meteo.com/) | Anahtarsız, ücretsiz — `public/js/weather.js`, tarayıcıdan doğrudan (CORS'a açık) |
| Yakıt fiyatı | Ulusal ortalama, `GET /api/fuel-price` (6 saatlik önbellek) | Kaynak servis CORS'a kapalı olduğu için istek sunucudan yapılır — §10.4 |
| Excel | SheetJS | İçe ve dışa aktarma; `public/vendor/` altında yerel |
| PDF | jsPDF + jspdf-autotable + html2canvas | Tablo, serbest çizim, ve haritanın ekran görüntüsü — §11 |
| PDF Türkçe font | `public/vendor/fonts/pdf-font-arial.js` | jsPDF'in gömülü Helvetica'sı `ı,ş,ğ,ç,ö,ü` içermiyor; Arial TTF base64 olarak gömülü |
| Yazı tipi (UI) | Outfit (woff2, yerel) | Google Fonts CDN değil |
| Test | `cd server && npm test` — smoke + sync | Kapsam: REST yüzeyi, doğrulama, outbox/dayanıklılık. `optimizer.js`/`fleet.js` ve arayüz akışları **testsiz** — §13/§14 |

Üçüncü parti kütüphanelerin tamamı `public/vendor/` altında yereldir (CDN
yok): panel internet olmadan da açılır, yalnızca harita karoları ve rota
hesabı için dış erişim gerekir.

---

## 4. Dosya/modül yapısı

Klasör ağacının kendisi README.md'de; burada her modülün **ne yaptığı** ve
dışa ne verdiği anlatılıyor.

### Tarayıcı — `public/js/`

| Dosya | Export | Sorumluluk |
|---|---|---|
| `data.js` | `TSSData` | Veri katmanı: bellekteki state, `localStorage` önbelleği, **backend senkronizasyonu + outbox** (§5.4), sefer geçmişi, ayarlar, Excel satır normalizasyonu. Dışa açılan tüm fonksiyonlar **senkron** — bu sözleşme kritiktir (§5.4) |
| `osrm.js` | `TSSOsrm` | `matrix(points)` → mesafe/süre matrisi, `route(points)` → çizim geometrisi |
| `tomtom.js` | `TSSTomTom` | `routeLeg(origin, destination)` → canlı trafik dahil tekil bacak; istek backend proxy'sine gider, anahtar tarayıcıya inmez (§10.3) |
| `weather.js` | `TSSWeather` | `checkPoints(points)` → uyarı listesi, `describePoint(...)` → tekil özet |
| `fuelprice.js` | `TSSFuelPrice` | `fetchNational()` → sunucudan ulusal ortalama dizel/benzin fiyatı, best-effort (§10.4) |
| `optimizer.js` | `TSSOptimizer` | `optimize(options)` → **tek araç** için en iyi durak sırası + zaman çizelgesi; `costMetric` ile mesafe ya da süre minimize edilir (§7) |
| `fleet.js` | `TSSFleet` | `assignFleet(opts)` → hangi durağın hangi araca gideceği; tek araca sığmayan durakları böler (§8.6). `replayGroup(...)` elle düzenleme sonrası, `replayGroupWithLiveLegs(...)` canlı trafik verisiyle yeniden simülasyon (§8.5, §8.7) |
| `exporter.js` | `TSSExporter` | `toExcel`, `toPdf`, `toExcelHistory`, `toPdfHistory` (§11) |
| `app.js` | (yok — `init()` ile başlar) | DOM event binding, Leaflet haritası, tablo/modal render, tüm kullanıcı etkileşimi. En büyük dosya; diğer 8 modülü bağlar |

### Sunucu — `server/`

| Dosya | Sorumluluk |
|---|---|
| `index.js` | REST endpoint'leri, `X-TSS-Token` erişim kontrolü, `public/` statik sunumu |
| `db.js` | SQLite şeması + satır ↔ frontend nesnesi dönüşümleri |
| `store.js` | CRUD + doğrulama — kurallar `public/js/data.js` ile **birebir aynı olmak zorunda** (§15) |
| `tomtom.js` | TomTom proxy'si; anahtar burada kalır, hata metinlerinde maskelenir (§10.3, §12) |
| `fuelprice.js` | Yakıt fiyatını kaynaktan doğrudan çeker + 6 saatlik önbellek (§10.4) |
| `defaults.js` | `public/js/data.js`'teki `DEFAULT_*` sabitlerinin kopyası — boş veritabanının ilk tohumlanması |
| `scripts/` | `import-localstorage.js` (tek seferlik veri aktarımı), `smoke-test.js`, `sync-test.js` |

> **Not:** Bu tablolarda bilerek satır sayısı verilmiyor — günler içinde eskiyip
> dokümanı yanlış hale getiriyorlardı. Güncel sayılar için:
> `wc -l public/js/*.js server/*.js`

---

## 5. Veri modeli ve kalıcılık

### 5.1 In-memory state (`data.js` → `state`)

```js
state = {
  locations: [ { id, name, lat, lng, from, until } ],
  vehicles:  [ { id, plate, model, capacity, usable, fuelConsumption, fuelType } ],
  stops:     [ { id, locationId, type: 'pickup'|'delivery', pallets } ],
  plan:      null | { startLocation, isWeekend, groups:[...], warning, note },
  history:   [ { id, approvedAt, note, vehicles, vehicleSummary, start,
                 departure, distance, duration, fuelCost, stopCount, groups } ],
  traffic:   { enabled, applyRushHourOnWeekends,
               morning:{start,end,factor}, evening:{...}, night:{...} },
  tomtomApiKey: '',  // "En Az Süre" modunda canlı trafik için, bkz. §10.3
  fuel: { dizelPrice, benzinPrice }  // kullanıcının ELLE girdiği TL/L override'ı, bkz. §10.4
}
```

Alan detayları:

- **`vehicles[].capacity` vs `usable`** — `capacity` aracın fiziksel/nominal
  palet kapasitesi; `usable` o an için **kullanılabilir** kapasite (örn. bir
  araç kısmen doluysa veya bakımda bir kısmı ayrılmışsa elle düşürülebilir,
  `setUsableCapacity()`). Tüm planlama/atama algoritmaları `usable`'ı esas alır,
  `capacity`'yi değil.
- **`vehicles[].fuelConsumption` / `fuelType`** — yakıt maliyeti tahmini için
  (bkz. §10.4): `fuelConsumption` L/100km cinsinden, `fuelType` `'dizel'` ya
  da `'benzin'`. Eski kayıtlarda (`id` alanının yukarıdaki hikâyesiyle aynı
  durum) bulunmayabilir — `data.js` → `load()` bunu varsayılana
  (`DEFAULT_FUEL_CONSUMPTION = 7`, `'dizel'`) tamamlar.
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

> **Gerçek veri kaynağı SQLite'tır** (bkz. §5.4 ve §15). Aşağıdaki
> `localStorage` katmanı kalıcılığın kendisi değil, **açılış önbelleği +
> outbox tamponu** rolündedir: panel ilk karede son bilinen veriyi gösterir,
> sunucuya ulaşılamadığında da yapılan değişiklikler kaybolmaz.

- Tek `localStorage` anahtarı: `tss-rota-panel-v1`.
- `save()` şu alt kümeyi JSON'a çevirip yazar: `locations, vehicles, history,
  traffic, tomtomApiKey, fuel` (`stops` ve `plan` KALICI DEĞİL — sayfa
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
alana eşlenir (`pick()` fonksiyonu, bkz. `data.js:369-377`).

### 5.4 Backend senkronizasyonu (opsiyonel)

`data.js`'in ikinci yarısı (`configureRemote` ve sonrası) backend katmanını
içerir. **Tasarımın tek kuralı:** `TSSData`'nın dışa açık fonksiyonları
senkron kalır. `public/js/app.js`'te bu fonksiyonlara 60'tan fazla çağrı noktası var
ve hiçbiri `.then()`/`await` beklemiyor (sonucu aynı satırda kullanıyorlar) —
bu yüzden hiçbiri asenkron yapılmadı, **hiçbir çağrı noktası değiştirilmedi**.

**Nasıl:** yazma fonksiyonları export sınırında ince bir sarmalayıcıyla
(`syncing()`) sarılır. Orijinal fonksiyon önce aynen çalışıp değerini döndürür
(çağıran kod hiçbir fark görmez), ardından karşılık gelen REST isteği outbox'a
yazılır. Fonksiyon gövdelerinin hiçbiri değişmedi.

```
Kullanıcı değişiklik yapar
        ↓
Local state + localStorage güncellenir → UI ANINDA güncellenir (senkron)
        ↓
İşlem outbox'a yazılır  (localStorage anahtarı: tss-outbox-v1)
        ↓
Backend'e gönderilmeye çalışılır
        ↓
Başarılı → kuyruktan sil        Başarısız → kuyrukta kalır, tekrar denenir
```

- **Outbox** sıralıdır (bağımlı işlemler için: "ekle" sonra "sil") ve
  `localStorage`'da durduğu için sayfa kapansa bile kaybolmaz. Yeniden deneme
  tetikleyicileri: her yazma, tarayıcının `online` olayı, 30 sn'lik periyodik
  zamanlayıcı ve sayfa açılışı.
- **Hata sınıflandırması:** `401` → kuyruk korunur, kullanıcıdan erişim
  anahtarı istenir (§12); `4xx` → istek asla başarılı olmayacağı için kuyruğu
  tıkamasın diye düşürülür ve kullanıcıya bildirilir; `5xx`/ağ hatası → tekrar
  denenir.
- **Okuma/tazeleme (`syncFromRemote`)**: ÖNCE outbox boşaltılır, SONRA
  `GET /api/bootstrap` çekilir. Sıra kritiktir — bekleyen yerel yazmalar
  sunucuya gitmeden sunucu verisi uygulanırsa o değişiklikler kaybolurdu.
  Başarılıysa `onRemoteSync` dinleyicileri tetiklenir ve `app.js` tabloları
  yeniden çizer (açılışta önce yerel önbellek görünür, sunucu verisi gelince
  sessizce tazelenir — `public/js/fuelprice.js`'in açılış desenının aynısı).
- **`connectRemote()`**: panelin servis edildiği origin'e bağlanır;
  `public/js/app.js` `init()` içinde bir kez çağırır. Sunucuya ulaşılamazsa
  panel kilitlenmez, yerel önbellekle açılmaya devam eder (bkz. sync testi:
  "sunucu erişilemezken açılış").
- **`stops` ve `plan` backend'e hiç gitmez** — bugünkü gibi tarayıcıda kalan
  geçici taslak veridir.
- **Çakışma politikası (v1):** son yazan kazanır. Şemada `updated_at` var ama
  şu an kullanılmıyor — ileride çakışma tespiti eklenmek istenirse zemin hazır.

---

## 6. Uçtan uca kullanıcı akışı

1. **Hareket noktası / saat / durak süresi / başlangıç yükü** ve
   **Optimizasyon metriği** ("En Kısa Mesafe" veya "En Az Süre") girilir (sol
   panel, `selCostMetric`) — bkz. §5.1 ve §7.1.
2. **Durak eklenir**: lokasyon + işlem tipi (yükleme/boşaltma) + palet sayısı.
   Filonun toplam kullanılabilir kapasitesini (`totalFleetCapacity()`) aşan
   girişler `validateStopAddition()` tarafından engellenir. Tek bir durağın
   palet miktarı filodaki en büyük tek aracı aşabilir — bu **engellenmez**:
   `public/js/fleet.js` böyle bir durağı planlama sırasında otomatik olarak birden
   fazla araca **paylaştırır** (bkz. §8.6).
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
5. **Onaylama**: "Rotayı Onayla" butonu, notu yazmadan önce filo genelinde
   **tahmini toplam yakıt maliyetini** gösterir (`renderApproveFuelSummary`,
   bkz. §10.4) — kullanıcının onaylamadan önce görmek istediği asıl bilgi
   bu. Ardından not eklenip (köprü/tonaj kısıtı gibi OSRM'in bilmediği ama
   sürücünün görmesi gereken uyarılar için) `TSSData.approveTrip(plan)`
   çağrılır → sefer geçmişine (yakıt maliyeti anlık görüntüsüyle birlikte)
   kalıcı olarak düşer, kullanılan araçlar bir sonraki planlamada rotasyon
   için işaretlenmiş olur (bkz. §8.3).
6. **Dışa aktarma**: Excel (araç başına sayfa) veya PDF (harita görüntüsü +
   araç başına KPI/tablo bölümü).

Ayrıca, plan oluştuktan sonra **"Karşılaştır"** butonu (Rota Tablosu
başlığında, export butonlarının yanında) isteğe bağlı olarak aktif
metrikle (mesafe/süre) **diğer** metriği yan yana karşılaştırır — bkz.
§6.1.

### 6.1 Rota Karşılaştırması ("Karşılaştır" butonu)

`app.js` → `openCompareModal()` / `renderCompareModal()`. Otomatik değil,
sadece kullanıcı butona bastığında hesaplanır:

- `planRoute()` başarılı olduğunda `lastPlanningContext` (`startLocation,
  stops, matrix, isWeekend, activeCostMetric`) modül değişkeninde saklanır.
- "Karşılaştır"a basılınca `computeMetricAssignment(otherMetric)` bu
  **aynı OSRM matrisini tekrar kullanarak** (yeni bir OSRM isteği
  atmadan) `Fleet.assignFleet(...)`'i diğer `costMetric` ile çağırır —
  aktif planın kendisi zaten `D.state.plan`'da hazır, sadece diğeri
  hesaplanır. Güzergah geometrisi bu adımda hiç istenmez (sadece özet
  sayılar gösterilir).
- **TomTom canlı trafik**: diğer metrik `'duration'` ise ve bir TomTom
  API key kayıtlıysa, `openCompareModal()` `planRoute()` ile **birebir
  aynı kuralla** (§10.3) o tarafın gruplarını da `refineGroupWithLiveTraffic(...)`
  ile canlı trafikle iyileştirir — aksi halde bu sütun sadece OSRM'in
  statik tahminini gösterip yanıltıcı olurdu (bazı senaryolarda mesafe
  moduyla neredeyse aynı çıkabilir). İstek sürerken genel `#loading`
  göstergesi kullanılır; başarısız olursa (key geçersiz, kota, ağ) diğer
  TomTom kullanımlarıyla aynı best-effort davranış: toast ile bildirilip
  OSRM tahminine sessizce düşülür, modal yine de açılır.
- Modal iki sütun gösterir: Toplam Mesafe (tüm grupların `result.distance`
  toplamı), En Geç Bitiş (grupların `result.finishSec` maksimumu — araçlar
  paralel çalıştığı için "işin bittiği an" budur), Araç Sayısı, ve araç
  başına mini bir tablo (durak/mesafe/süre). Hangi metriğin hangi
  KPI'da daha iyi olduğu (`Daha kısa` / `Daha erken biter`) yeşil
  etiketle işaretlenir.
- **"Bu sonucu kullan"**: diğer metriği aktif plana geçirmek için
  `computeMetricAssignment`'ın sonucunu yeniden kullanmaz — sadece
  `selCostMetric` dropdown'ını (`setSelectValue`, özel `<select>`'in
  görünen metnini de senkronlar) o metriğe çevirip **`planRoute()`'u
  yeniden çalıştırır**. Bu, geometri çekme ve gerekiyorsa TomTom
  iyileştirmesi dahil tam, test edilmiş akışı tekrar kullanmak için
  bilinçli bir tercih — karşılaştırma modalı için ayrı/kısmi bir
  "uygula" yolu yazılmadı.

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
her adımda, o anki konumdan en yakın ziyaret edilmemiş durağı seçer. Her
zaman hareket noktasından (`index 0`) başlar — çoklu başlangıç denemesi
(multi-start) yok, geri alma (backtracking) yok. Trafik/zaman penceresi bu
aşamada hiçbir zaman rol oynamaz. Hangi matrisin kullanılacağı `costMetric`'e
bağlıdır: varsayılan `'distance'` modunda **gerçek yol mesafesi**
matrisine, `'duration'` modunda ise **süre** matrisine göre en yakını seçer
— aksi halde "En Az Süre" modunda bile başlangıç çözümü mesafeye göre
kurulup 2-opt/Or-opt'un düzeltmesine kalırdı.

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
- **Gece yarısını saran erişim penceresi** (`from > until`, örn. 22:00–06:00)
  ayrıca desteklenir: varış saati önce günün-saatine (time-of-day)
  indirgenip `trafficFactorAt`'taki sarma mantığıyla pencere içinde mi diye
  bakılır. Bu olmadan (varış birden fazla günü kapsayarak birikimli
  ilerlediğinden, ör. "25:00" gibi) pencere içindeki bir varış hem "açılış
  bekleniyor" hem "erişim saati aşıldı" olarak yanlış işaretlenirdi.
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
     + timeViolations     × 1e7   // PENALTY_TIME     — pratikte asla tercih edilmez
```

> **Not:** `PENALTY_TIME` başlangıçta `5e5` (=500 km eşdeğeri) idi, ama
> `costMetric:'distance'` iken `baseCost` METRE cinsinden olduğundan,
> 500+ km'lik ülke ölçeğindeki rotalarda rakip bir sıralamanın kat ettiği
> ekstra mesafe bu cezayı aşıp erişim saati ihlalli ama "kısa" bir rotayı,
> ihlalsiz ama biraz daha uzun bir rotaya tercih ettirebiliyordu. Bu yüzden
> `PENALTY_CAPACITY` ile aynı büyüklüğe (`1e7`) çekildi ki her ölçekteki
> rotada kesinlikle kaçınılsın — artık kapasite ve erişim saati ihlalleri
> **eşit derecede** ağır cezalandırılıyor (README'deki "Algoritma" bölümü
> de bununla tutarlı).

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
                     │ "Büyük" duraklar ayrılır │  filodaki EN BÜYÜK tek aracın
                     │ (bkz. §8.6)              │  kapasitesini aşan pickup/delivery'ler
                     └───────────┬──────────────┘
                                 ▼
                     ┌─────────────────────────┐
                     │ k=2'den başlayarak,      │  SADECE normal (büyük olmayan)
                     │ coğrafi kümeleme dene,   │  duraklar üzerinde
                     │ her k için best-fit-     │
                     │ decreasing atama dene    │──── Başarılı ──▶ o atamayı kullan
                     │ (k++ gerektikçe artar)   │
                     └───────────┬──────────────┘
                                 │ Hiçbir k için filoya sığmadı
                                 ▼
                     Normal duraklar TEK küme olarak bunu karşılayabilecek
                     en küçük (yoksa en büyük) araca verilir.
                                 │
                                 ▼
                     ┌─────────────────────────┐
                     │ BFD'nin seçMEDİĞİ araçlar│  büyük durak dağıtımı TÜM
                     │ da boş küme olarak açılır│  filoyu görebilsin diye
                     └───────────┬──────────────┘
                                 ▼
                     Büyük duraklar, oluşan kümelerin boş yerine/arzına göre
                     distributeBigStop() ile paylaştırılır (bkz. §8.6).
                     Filo toplamda bile yetmezse kalan miktar en uygun araca
                     zorla eklenir, ihlal tabloda/haritada işaretlenir.
```

### 8.2 Coğrafi kümeleme — `clusterStopIndices(indices, fullDistances, k)`

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

`indices` parametresi artık **orijinal `stops` dizisindeki index'lerden
oluşan bir alt küme** (eskiden doğrudan `stops` dizisinin kendisiydi) —
`assignFleet` buraya SADECE "normal" (büyük olmayan) durakların index'lerini
geçirir; "büyük" duraklar coğrafi kümelemeye hiç girmez, bkz. §8.6.

### 8.3 Araç eşleme — best-fit-decreasing + rotasyon

Her küme için önce `requiredCapacityFor(sub, initialLoad)` ile **gerçekte
ihtiyaç duyulan minimum kapasite** hesaplanır: başlangıç yükü + kümedeki tüm
yükleme (pickup) miktarlarının toplamı — yani "önce tüm yüklemeler yapılsa"
sıralamasıyla ulaşılan tepe yük. Bu sıra her zaman fiilen uygulanabilir
olduğundan (mesafeden bağımsız, sadece sıralamayı değiştirir) güvenilir bir
ihtiyaç tahminidir. Sonra:

> **Düzeltilmiş hata (2026-09-01):** Daha önce bu değer
> `runOptimizeForSubset(..., capacity: Infinity, ...)` ile, yani `Opt.optimize()`'ı
> sınırsız kapasiteyle çalıştırıp sonucun `maxLoad`'ını okuyarak hesaplanıyordu.
> Kapasite sınırsızken hiçbir sıra "ihlalli" sayılmadığından optimizer sırayı
> **sadece mesafeye göre** seçiyordu — bir boşaltma durağı hareket noktasıyla
> aynı/çok yakın koordinattaysa (mesafe ≈ 0), optimizer onu sıranın en başına
> alıyor, yük hiç pozitife çıkmadan direkt eksiye düşüyordu. Sonuç: `maxLoad`
> yanlışlıkla ~0 çıkıyor ve o kümeye filodaki **en küçük** araç (gerçek
> ihtiyacın çok altında bir kapasiteyle) atanıyordu — örn. 9 paletlik bir
> boşaltmanın olduğu bir kümeye 1 paletlik araç verilmesi. `requiredCapacityFor`
> bu tuzağa hiç girmez çünkü hiç rota optimize etmez, doğrudan pickup
> toplamından hesaplar.

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

### 8.6 Büyük durak bölüştürme — `distributeBigStop()`

Bir durağın (tek bir pickup ya da delivery) palet miktarı filodaki **en
büyük tek aracın** kullanılabilir kapasitesini aşarsa ("büyük durak"), bu
durak hiçbir araca **tek başına** sığmaz. Ama paletler fungible olduğundan
(hangi paletin nereden geldiği hiç izlenmiyor) filo **toplamda** yeterliyse
hâlâ karşılanabilir: birden fazla araç aynı lokasyona uğrayıp kendi payını
taşır — tıpkı gerçek bir lojistik operasyonunda büyük bir sevkiyatın birden
fazla kamyona bölünmesi gibi.

**Akış (`assignFleet` içinde):**

```
1. maxSingleCapacity = filodaki en büyük tek aracın kapasitesi
2. bigIndices  = pallets > maxSingleCapacity olan duraklar
   normalIndices = geri kalan (normal boyuttaki) duraklar
3. §8.1-8.3'teki kümeleme + BFD SADECE normalIndices üzerinde çalışır
   (büyük duraklar coğrafi kümelemeye hiç girmez — aynı lokasyondaki
   birden fazla parçası aksi halde hep AYNI kümeye düşerdi, bu da
   bölmenin amacını boşa çıkarırdı)
4. BFD'nin seçMEDİĞİ araçlar da (o an ortada büyük durak yokmuş gibi karar
   verdiği için boşta kalanlar) boş birer küme olarak açılır — büyük durak
   dağıtımı TÜM filoyu görebilsin diye
5. distributeBigStop(): önce büyük YÜKLEMELER (kümenin taşıdığı toplam yükü
   artırır), sonra büyük BOŞALTMALAR (o yükten ne kadarının boşaltılabi-
   leceğini belirler) — en yakın kümeden başlayarak açgözlü (greedy) doldurma:
     - YÜKLEME payı ≤ kümenin aracındaki BOŞ YER (usable − o an taşınan yük)
     - BOŞALTMA payı ≤ kümenin o ana kadar TOPLADIĞI ama henüz boşaltmadığı
       miktar (kendi ARZI)
6. Filo toplamda bile yetmezse, karşılanamayan kalan miktar en çok yeri/
   arzı olan (eşitlikte en büyük) araca zorla eklenir — ihlal tabloda görünür
   kalır, ama artık TÜM miktar değil, sadece gerçekten karşılanamayan kısım;
   `assignFleet` bunu `warning` alanında ayrıca bildirir.
```

**Örnek:** 9 paletlik tek bir boşaltma durağı, dört ayrı lokasyondan toplam
9 palet yükleyen (1+3+2+3) bir plan — filodaki en büyük araç 5 palet.
Coğrafi kümeleme yüklemeleri iki araca ayırır (paletleri 4 ve 5 olacak
şekilde); `distributeBigStop` 9 paletlik boşaltmayı bu iki kümenin kendi
arzına göre **5 + 4** olarak böler — her iki araç da kendi topladığı kadarını
boşaltır, **sıfır ihlal**.

**Bilinç sınırları:** Bu, gerçek bir VRP çözücü değil, açgözlü bir sezgisel.
`sub`/`idxArr`'a eklenen parça-durak nesnelerinin `stopId` alanı **bilerek
`null`** bırakılır — `updateGroupStopPallets()` (`public/js/app.js`) bir satırdaki
palet sayısını `stopId` üzerinden orijinal `TSSData.state.stops`'a geri
yazar; aynı orijinal durağın İKİ farklı gruba bölünmüş parçası aynı
`stopId`'yi paylaşsaydı, bir parçanın elle düzenlenmesi orijinal durağın
toplamını yanlışlıkla ezerdi. `stopId: null` ile bu tür elle düzenlemeler
sadece o grubun kendi anlık simülasyonunu etkiler, sol paneldeki "Duraklar"
listesini (kaynak veri) hiç değiştirmez. Nadir kombinasyonlarda (bkz. §13)
hâlâ önlenemeyen bir kalıntı ihlal görülebilir.

### 8.7 `replayGroupWithLiveLegs(group, legs, opts)` — TomTom canlı trafik replay'i

`replayGroup`'un bir varyantı: aynı şekilde **sırayı (`group.order`)
değiştirmez**, ama bacak mesafe/süresini OSRM matrisinden değil,
**dışarıdan** (`public/js/app.js` → `refineGroupWithLiveTraffic` → TomTom'dan)
verilen gerçek değerlerden okur (`legs: [{distanceMeters, durationSeconds}, ...]`,
`group.order` ile aynı uzunlukta ve sırada). Önemli fark: `legTime`'a
`optimizer.js`'teki sabit trafik çarpanı **uygulanmaz** — TomTom'un süresi
zaten canlı trafiği içerdiğinden, üstüne bir de sabit çarpan uygulamak
trafiği iki kez saymak olurdu. Kapasite/zaman penceresi ihlal mantığı
(`simulate`/`replayGroup` ile aynı) değişmeden korunur. `public/js/app.js` bu
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

Çağrı zinciri iki adımlı — anahtar tarayıcıya hiç inmesin diye:

| Katman | Çağrı | Not |
|---|---|---|
| `public/js/tomtom.js` | `routeLeg(origin, destination)` → `POST /api/tomtom/route-leg` | Anahtar yok; yalnızca koordinatlar ve `X-TSS-Token` gider |
| `server/tomtom.js` | `GET https://api.tomtom.com/routing/1/calculateRoute/{lat,lng}:{lat,lng}/json?key=…&traffic=true&travelMode=car` | Anahtarı ekleyen taraf burası |

Dönen şekil her iki katmanda da aynı:
`{ distanceMeters, durationSeconds, trafficDelaySeconds, geometry }`.

OSRM'in aksine **varsayılan olarak kapalıdır**: yalnızca iki koşul birden
sağlanınca devreye girer — (1) Optimizasyon metriği **"En Az Süre"** seçili,
(2) bir TomTom anahtarı tanımlı (aşağıdaki tabloya bkz.). Aksi halde
`tomtom.js` hiç çağrılmaz ve uygulama tamamen OSRM'in tahmini üzerinden
çalışır.

**Neden n istek, n² değil:** Sıralama kararının kendisi hâlâ OSRM'in
ücretsiz/sınırsız `matrix()`'inden çıkıyor (tüm nokta çiftleri). TomTom'a
sadece optimizer'ın **zaten belirlemiş olduğu** son sıradaki **ardışık**
bacaklar için istek atılır (`refineGroupWithLiveTraffic`, `public/js/app.js`) —
bir grupta *n* durak varsa *n* istek, tüm nokta çiftleri için değil. Bu,
TomTom'un ücretli/kotalı olması nedeniyle bilinçli bir maliyet kısıtlaması.

**Best-effort davranış:** Herhangi bir bacak isteği başarısız olursa
(geçersiz key, kota aşımı, ağ hatası) **tüm grup için** sessizce vazgeçilir
ve OSRM'in zaten hesaplamış olduğu sonuç/geometri aynen kalır — kullanıcıya
sadece bir toast uyarısı (`'TomTom canlı trafik verisine ulaşılamadı…'`)
gösterilir, planlama asla başarısız olmaz. Bu, projenin genel "kısıt
sağlanamasa da her zaman bir rota üret" felsefesiyle tutarlı.

**Anahtarın yeri — iki mod (§15):**

| | `server/.env` → `TOMTOM_API_KEY` **dolu** | **Boş** (kullanıcı arayüzden girer) |
|---|---|---|
| Anahtarı kim tutar | Kullanıcı, arayüzden girer; o tarayıcının `localStorage`'ı | Sunucu; tarayıcıya **hiç inmez** |
| İsteği kim atar | Tarayıcı → TomTom (anahtar istek URL'sinde görünür) | Tarayıcı → kendi backend'i → TomTom |
| `bootstrap` yanıtı | Anahtarı içerir | `tomtomApiKey: ''` + `tomtomKeySource: 'server'` |
| Arayüzde | Alan doldurulmuş görünür | Alan boş, altında "sunucuda tanımlı" notu |

Backend varken proxy ucu: `POST /api/tomtom/route-leg` (gövde:
`{origin:{lat,lng}, destination:{lat,lng}}`) — dönen şekil `public/js/tomtom.js`'in
beklediğiyle birebir aynıdır, bu yüzden `routeLeg()`'in imzası ve
`public/js/app.js`'teki çağrı noktaları değişmedi. `public/js/tomtom.js` proxy'yi
`setProxy()` ile öğrenir (aynı desen: `TSSOsrm.setBase()`); `public/js/app.js`
`init()` içinde bir kez bağlar.

> **Dikkat — "anahtar var mı?" kontrolü:** sunucu tarafı anahtarda
> `getTomTomApiKey()` boş string döner ama özellik **kullanılabilir**
> durumdadır. Bu yüzden gate kontrolleri `D.hasTomTomKey()` ile yapılır;
> boş string kontrolü yapan yeni kod özelliği yanlışlıkla devre dışı
> bırakır.

Anahtar hangi kaynaktan gelirse gelsin TomTom panelinden **kullanım kotası**
tanımlanması önerilir; anahtar artık tarayıcıya inmediği için domain
kısıtlamasının önemi azaldı (bkz. §12).

### 10.4 Yakıt fiyatı (`fuelprice.js`) — sunucu üzerinden, CORS engelini aşarak

Onaylamadan önce görülen **tahmini yakıt maliyeti** (bkz. §6, §8), araç
başına `fuelConsumption` (L/100km) × rota mesafesi (dönüş dahil) × TL/L
fiyatı olarak hesaplanır. Bu alt bölüm sadece **fiyatın** nereden geldiğini
anlatıyor — tüketim/mesafe tarafı zaten var olan veri modeline (§5) ve
`fleet.js`'in ürettiği rotaya (§8) dayanıyor.

**Neden sunucu üzerinden:** Türkiye'de ücretsiz/anahtarsız bir akaryakıt
fiyat servisi (UcuzYakıtBul'un `/api/prices/national` uç noktası) veri
doğru döndürüyor ama yanıtında `Access-Control-Allow-Origin` **yok** —
OSRM/Open-Meteo/TomTom'un aksine bu servis tarayıcıdan doğrudan `fetch()`
ile çağrılmak üzere tasarlanmamış, Same-Origin Policy isteği sessizce
engelliyor. (EPDK'nın resmi web servisi bir alternatif ama XML/SOAP
formatında ve CORS'a açık olduğuna dair garanti yok.)

CORS bir **tarayıcı** kısıtıdır; sunucu aynı servisi hiçbir engelle
karşılaşmadan çağırabilir. `server/fuelprice.js` bunu yapar, sonucu 6
saatlik bellek-içi önbellekte tutar ve `GET /api/fuel-price` ile sunar:

```json
{ "dizel": 87.14, "benzin": 75.38, "updatedAt": "...", "source": "..." }
```

Aynı anda gelen istekler tek bir dış çağrıyı paylaşır (`inFlight`), ve
kaynak servise ulaşılamazsa **bayat da olsa** son başarılı değer döner —
hiç fiyat göstermemektense eski fiyatı göstermek yeğdir.

> **Tarihsel not:** backend eklenmeden önce bu veri, GitHub Actions ile 6
> saatte bir çekilip `data/fuel-price.json`'a yazılıyor ve panel onu
> `raw.githubusercontent.com` üzerinden okuyordu (o adres statik dosyaları
> `Access-Control-Allow-Origin: *` ile sunuyor). Çalışıyordu ama repoya
> bağımlıydı: repo GitHub'a bağlı değilse, Actions kapalıysa ya da repo
> taşınırsa (adres koda gömülüydü) fiyat gelmiyordu. Backend'e geçişte bu
> yol tamamen kaldırıldı.

**Best-effort, weather.js ile aynı felsefe:** `fetchNational()` ağ hatası,
sunucunun kaynağa ulaşamaması (503) ya da bozuk JSON durumunda sessizce
`null` döner — hiçbir zaman planlamayı
bloke etmez. `app.js` → `effectiveFuelPrice()` şu önceliği uygular:

```
kullanıcının Trafik Ayarları > Yakıt'tan ELLE girdiği fiyat (D.state.fuel)
  → public/js/fuelprice.js'in otomatik çektiği ulusal ortalama (bellekte, kalıcı değil)
  → null ("Fiyat girilmedi", rakam asla uydurulmaz)
```

**Dönüş bacağı:** `fleet.js` her zaman `returnToStart:false` ile çalıştığı
için (bkz. §8) `group.result.distance` depoya dönüşü içermez. Yakıt
maliyeti gerçek harcanan mesafeye (gidiş + dönüş) göre hesaplanmak
istendiğinden, `app.js` → `returnLegMeters()` bunu `group.localDistances`
(zaten `fleet.js` → `buildGroup()` tarafından her grup nesnesinde saklanıyor,
bkz. §8.1) üzerinden ayrıca ekler — `group.order`'daki son durağın local
matriste 0. indekse (depo) olan mesafesi. Bu yüzden rota tablosundaki
"Toplam Mesafe" ile yakıt maliyeti hesabındaki km birebir aynı değildir;
karışıklığı önlemek için özet kartında "(dönüş dahil)" notu gösterilir.

**Araç tüketimi varsayılanları:** `data.js` → `DEFAULT_VEHICLES`, Fiat
Ducato ve Peugeot Partner için üreticinin karma çevrim ortalamasına yakın
başlangıç değerleri taşır (sırasıyla 7 ve 5.8 L/100km) — gerçek filo
verisi (yakıt fişi/depo kaydı) girildikçe Araçlar modalından araç başına
elle güncellenmesi önerilir; yüklü/şehir içi kullanımda gerçek tüketim
üretici rakamlarının üzerine çıkabilir.

---

## 11. Excel / PDF dışa aktarım

### 11.0 Sefer Geçmişi filtresi

Sefer Geçmişi modalındaki **"Filtrele"** butonu bir form paneli açar/kapatır
(`app.js` → `historyFilter` modül state'i, panel gizliyken bile korunur —
modal kapatılıp tekrar açılsa filtre durur). Tarih aralığı, araç (geçmişteki
tüm plakalardan türetilen bir `<select>`), min/maks mesafe ve min/maks süre
ile filtrelenir; her alan değiştikçe (`input`/`change`) `applyHistoryFilter()`
tabloyu **canlı** yeniden çizer.

- `h.distance`/`h.duration` (`data.js` → `approveTrip()`) zaten biçimlendirilmiş
  string olarak saklanıyor ("93.6 km", "3 sa 22 dk") — `parseKmValue()` /
  `parseDurationMinutes()` bunları karşılaştırma için geri sayıya çevirir.
- **Excel/PDF dışa aktarımı filtrelenmiş listeyi indirir**: `btnExportHistoryExcel`/
  `btnExportHistoryPdf`, `D.getHistory()`'yi değil `applyHistoryFilter(D.getHistory())`
  sonucunu `Exp.toExcelHistory`/`Exp.toPdfHistory`'ye geçirir. Filtre paneli hiç
  açılmadıysa `historyFilter` tüm alanları boş olduğundan bu, tüm geçmişi
  değişmeden döndürür — davranış filtre kullanılmadığında birebir eskisiyle aynı.
  PDF'teki 4 KPI kartı (`computeHistoryStats`, bkz. §11.2) da bu yüzden
  otomatik olarak filtrelenmiş alt kümeyi yansıtır, ayrı bir değişiklik
  gerekmedi.

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
  `escapeHtml()` ile kaçışlanıyor (`app.js:42-49`) — kötü niyetli bir isim
  (`<img onerror=...>` gibi) sayfada script çalıştıramaz.
- **Sunucu tarafı doğrulama:** İstemciye güvenilmez — sunucu gelen her
  isteği kendi de doğrular (`server/store.js`; kurallar `public/js/data.js`
  ile birebir aynı, §15). Tarayıcıdaki doğrulama yalnızca kullanıcıya hızlı
  geri bildirim içindir; güvenlik sınırı sunucudadır.
- **Erişim kontrolü (`APP_TOKEN`):** LAN paylaşımında `/api/*` istekleri
  tek bir paylaşılan anahtarla korunur; anahtar **yalnızca `X-TSS-Token`
  başlığında** taşınır, URL query string'inde asla kabul edilmez (tarayıcı
  geçmişi, sunucu logları ve `Referer` başlığı üzerinden sızmasın diye).
  Anahtar kullanıcının tarayıcısında `localStorage`'da (`tss-remote-token-v1`)
  saklanır, repoya hiç girmez (`server/.env`, `.gitignore`'da). Bu bir
  **authentication sistemi değildir**: kullanıcı kimliği, rol/yetki ve
  denetim izi yoktur — küçük, güvenilen bir LAN ekibi için v1 kapısıdır.
  İnternete açılacaksa gerçek kimlik doğrulama ve HTTPS gerekir.
- **TomTom API key — artık sunucuda tutulabilir:** `server/.env` içindeki
  `TOMTOM_API_KEY` doldurulursa anahtar **tarayıcıya hiç inmez**;
  `/api/bootstrap` yanıtı onu içermez (`tomtomKeySource: 'server'`), istekler
  `POST /api/tomtom/route-leg` proxy'si üzerinden gider ve TomTom çağrısını
  sunucu yapar. Otomatik testte bu doğrulanıyor (yanıtın hiçbir yerinde
  anahtar geçmemeli).
  Doldurulmazsa eski davranış geçerlidir: anahtar kullanıcı tarafından
  arayüzden girilir, `localStorage`'da düz metin durur ve her istekte URL
  query string'inde (Network sekmesinde görünür şekilde) gider — aynı
  tarayıcıyı paylaşan biri DevTools'tan okuyabilir. Bu modda azaltıcı
  önlem: TomTom Developer Portal'dan key'e **domain/referrer kısıtlaması**
  eklemek (bkz. §10.3).
- **Sunucu tarafı sırların repoya girmemesi:** `server/.env` (hem `APP_TOKEN`
  hem `TOMTOM_API_KEY`) `.gitignore`'da; repoda yalnızca değerleri boş olan
  `server/.env.example` var. Proxy hata mesajlarında da anahtar maskeleniyor
  (`server/tomtom.js`), aksi halde TomTom'un hata metni anahtarı istemciye
  geri sızdırabilirdi.

---

## 13. Bilinen sınırlar ve production riskleri

README.md aynı sınırları kullanıcı diliyle listeler; buradaki tablo ayrıca
**teknik sebebini** veriyor.

| Sınır | Teknik sebep | Etkisi |
|---|---|---|
| OSRM halka açık demo sunucusu | `public/js/osrm.js`'teki sabit `BASE` | Rate-limit ve SLA garantisi yok; sunucu yavaşlarsa/düşerse rota hesaplanamaz — §14 |
| Sunucu tek makinede çalışır | Tek Express süreci + tek SQLite dosyası; yük dengeleme/yedeklilik yok | O makine kapalıysa panel yalnızca yerel önbellekle (son görülen veriyle) açılır, yeni veri gelmez; düzenlemeler outbox'ta bekler |
| Ekip senkronizasyonu anlık değil | Sunucudan veri yalnızca açılışta (ve `syncFromRemote()` ile) çekiliyor; push/websocket yok | Başka bir cihazın değişikliği panel yenilenince görünür |
| Çakışma politikası: son yazan kazanır | v1'de bilinçli sadelik (§5.4); şemada `updated_at` var ama kullanılmıyor | Aynı kaydı aynı anda düzenleyen iki kişiden biri diğerinin üzerine sessizce yazar |
| Erişim kontrolü tek paylaşılan anahtar | `APP_TOKEN` + `X-TSS-Token` (§12) — kullanıcı hesabı/rol yok | Anahtarı bilen herkes tüm veriye erişir; kim ne değiştirdi izlenemez |
| Yasak güzergah kısıtı yok | OSRM demo sunucusu özel `exclude` profili desteklemiyor | Köprü/tonaj kısıtları rotaya yansımaz — sadece onay notuna elle yazılabilir |
| Kümeleme kesin optimum değil | Sezgisel farthest-point seeding, tek geçiş | Çok sayıda dağınık durakta teorik en iyi bölüştürme garanti edilmez |
| Büyük durak bölüştürme sezgiseldir, kesin optimum değil | `distributeBigStop()` en-yakın-kümeden-başlayarak açgözlü (greedy) doldurma yapar (bkz. §8.6), gerçek bir VRP çözücü değil | Nadir kombinasyonlarda (örn. `initialLoad` bir kümenin ihtiyacını tek başına her aracın kapasitesinin üstüne çıkarıyorsa, ya da tüm arzı sağlayan tek bir büyük yükleme normal boşaltmalardan coğrafi olarak uzaksa) hâlâ önlenebilir olmayan bir kalıntı ihlal görülebilir — filo toplamda yeterliyken bile. Algoritma bunu her zaman **mümkün olan en az** ihlale indirger ve `warning` alanında açıkça bildirir, ama sıfıra indirme garantisi yoktur |
| Trafik verisi kısmen gerçek | Canlı trafik yalnızca "En Az Süre" modunda ve bir TomTom anahtarı tanımlıyken devreye girer (§10.3); **varsayılan mod "En Kısa Mesafe"** ve anahtar yoksa sabit zaman dilimi çarpanları kullanılır (§7.2) | Varsayılan ayarlarla süreler kaba tahmindir; TomTom ücretli/kotalı olduğundan kesintisiz canlı trafik garanti değil |
| TomTom best-effort | Anahtar yoksa ya da istek başarısız olursa (kota, ağ, proxy hatası) sessizce OSRM tahminine düşülür | "En Az Süre" seçili olsa bile sonuç OSRM'in statik tahmini olabilir; kullanıcı bunu yalnızca bir toast'tan anlar, tabloda ayrıca işaretlenmez |
| Otomatik test **kısmen** var | `server/` ve `public/js/data.js` senkron katmanı test ediliyor (`cd server && npm test`); `optimizer.js`/`fleet.js` ve arayüz akışları testsiz | Algoritma değişikliklerinde ve UI akışlarında regresyon elle test edilmeli |
| Yakıt fiyatı dış servise bağlı | Kaynak servis (UcuzYakıtBul) resmi bir API değil, sözleşmesi değişebilir (§10.4) | Servise ulaşılamazsa son bilinen fiyat (bayat da olsa) gösterilir; hiç veri yoksa kullanıcı Trafik Ayarları'ndan elle girer |
| Yakıt tüketimi varsayılanı tahmini | `DEFAULT_VEHICLES.fuelConsumption` üreticinin karma çevrim ortalaması, gerçek/yüklü sahne verisi değil | Gerçek filo verisi (yakıt fişi) girilene kadar yakıt maliyeti tahmini olduğundan sapabilir — araç bazında Araçlar modalından elle düzeltilmesi önerilir |

---

## 14. Devam edecek geliştiriciler için yol haritası

**✔ Tamamlandı — kalıcılığın backend'e taşınması (§15).** `TSSData` arayüzü
aynen korunarak Express + SQLite backend eklendi; `app.js`/`fleet.js`/
`exporter.js`'teki çağrı noktalarının hiçbiri değişmedi, `app.js`'e yalnızca
açılışta senkronizasyonu başlatan birkaç satır eklendi.

Kalan öncelik sırası:

1. **Kendi OSRM örneğini kur**, `TSSOsrm.setBase()` ile veya `osrm.js`
   içindeki `BASE`'i değiştirerek yönlendir — demo sunucu ile sürekli/ticari
   trafiğe çıkmak güvenli değil. Artık bir backend olduğu için OSRM
   isteklerini de sunucu üzerinden proxy'lemek (ve önbelleklemek) mümkün.
2. **`optimizer.js` ve `fleet.js` için senaryo testleri** ekle — bilinen
   girdi (durak listesi + mesafe matrisi) → beklenen sıralama/ihlal
   çıktısı; bu iki dosya saf fonksiyonlar olduğu için (DOM'a bağımlı değil)
   test edilmesi kolay, sadece hiç yapılmamış. `server/scripts/`'teki test
   yapısı örnek alınabilir.
3. ~~**TomTom key'i server-side'a taşı**~~ — **tamamlandı** (§10.3, §12):
   `POST /api/tomtom/route-leg` proxy'si eklendi, `routeLeg()` imzası ve
   `public/js/app.js` çağrı noktaları değişmedi. `server/.env` → `TOMTOM_API_KEY`
   doldurulduğunda anahtar tarayıcıya hiç inmiyor.
4. **Gerçek kimlik doğrulama** — mevcut tek paylaşılan `APP_TOKEN`,
   kullanıcı bazlı kimlik/rol/denetim izi gerektiğinde yetersiz kalır (§12).
5. Yasak güzergah kısıtı gibi README'de "sonraki faz" olarak işaretlenmiş
   genişletmeler. Gerçek trafik verisi için TomTom entegrasyonu (§10.3)
   kısmen bu ihtiyacı karşılıyor — bir sonraki adım bunu "En Az Süre"
   modunun ötesine, sıralama kararının kendisine de (şu an sadece OSRM
   matrix'i kullanılıyor) taşımak olabilir, ancak bu TomTom'un ücretli
   matrix endpoint'ini gerektirir.
6. **Canlı ekip senkronizasyonu** (SSE/WebSocket) — şu an sunucudan veri
   yalnızca sayfa açılışında çekiliyor.

---

## 15. Backend (`server/`) — veri katmanı

Ayrıntılı kurulum/çalıştırma ve endpoint tablosu için: **`server/README.md`**.
Buradaki özet, mimari kararların gerekçesi:

- **Neden Express + SQLite:** mevcut JS yığınıyla aynı dil (yeni bir dil/
  çalışma zamanı yok), tek dosyalık veritabanı (`server/data/tss.db`) —
  ayrı bir DB sunucusu kurmak, yönetmek, yedeklemek gerekmiyor; yedek almak
  dosyayı kopyalamak demek. WAL modu açık, eşzamanlı okuma/yazma güvenli.
- **Statik dosyalar da aynı sunucudan** servis edilir (`express.static`) —
  frontend ve API aynı origin'de olduğu için CORS yapılandırması hiç
  gerekmiyor. Kullanım: `node server/index.js` → `http://localhost:3000`.
- **LAN paylaşımı:** `0.0.0.0`'a bind edilir; aynı ağdaki cihazlar
  `http://<sunucu-ip>:3000` ile bağlanır. Erişim `APP_TOKEN` ile korunur
  (bkz. §12).
- **Şema, `state` şeklini birebir yansıtır** (§5.1): `locations`,
  `vehicles`, `trips`, `settings`. Sefer geçmişi zaten "hafif özet" olarak
  üretildiği için (bkz. `approveTrip`) gruplar/satırlar ilişkisel tablolara
  parçalanmadı, JSON blob olarak saklanıyor — burada round-trip sadakati
  (aynı nesnenin aynen geri gelmesi) ilişkisel saflıktan daha değerli.
  Her tabloda `created_at`/`updated_at` var (§5.4 çakışma notu).
- **Doğrulama iki tarafta da aynı:** `server/store.js`'teki kurallar
  `public/js/data.js`'teki `addLocation`/`addVehicle`/`updateVehicle` ile birebir
  eşleşir. Eşleşmezse iyimser (optimistic) güncelleme yüzünden kullanıcı
  kaydı ekranda görür ama sunucu reddeder — bu yüzden bu iki dosya birlikte
  değiştirilmelidir.
- **İlk tohumlama:** boş bir veritabanı ilk açılışta `server/defaults.js`
  (= `public/js/data.js`'teki `DEFAULT_*` kopyası) ile doldurulur; kullanıcı
  backend'e geçtiğinde bugünküyle aynı başlangıç listesini görür.
- **Mevcut veriyi taşıma:** `node server/scripts/import-localstorage.js
  <yedek.json>` — tarayıcı konsolundan alınan `tss-rota-panel-v1` içeriğini
  SQLite'a aktarır, tekrar çalıştırmak güvenlidir.
- **Testler** (`cd server && npm test`): `smoke-test.js` REST yüzeyini,
  erişim kontrolünü, doğrulama kurallarını, ayar merge'ini ve geçmiş JSON
  round-trip'ini kontrol eder. `sync-test.js` ise **gerçek
  `public/js/data.js`'i** Node içinde sahte `window`/`localStorage` ile
  gerçek backend'e karşı çalıştırır: senkron sözleşme, outbox, çevrimdışı
  davranış ve sunucu erişilemezken önbellekle açılış.

---

*Bu doküman kod tabanının 2026-09-07 tarihli hali üzerinden elle incelenerek
hazırlanmış/revize edilmiştir (Express + SQLite backend'e geçiş, TomTom
proxy'si, `public/` + `docs/` klasör düzeni dahil).*

**Senkron kalması gerekenler:** §7/§8 algoritma anlatımı ↔ `optimizer.js` /
`fleet.js`; §5.4 ve §15 senkronizasyon anlatımı ↔ `public/js/data.js` /
`server/`; §10 dış servisler ↔ ilgili istemci + proxy dosyaları. Ayrıca
`server/store.js`'teki doğrulama kuralları `public/js/data.js`'tekilerle
**eşleşmek zorundadır** (§15) — ikisi birlikte değiştirilmeli.

**Bilerek yazılmayanlar:** dosya satır sayıları ve test adetleri. Bunlar
günler içinde eskiyip dokümanı yanlış hale getiriyordu; güncel değerler için
`wc -l public/js/*.js server/*.js` ve `npm test` çıktısına bakın.
