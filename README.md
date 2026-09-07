# TSS — Rota Planlama Paneli

Tarayıcıda çalışan sefer planlama arayüzü. **İki şekilde kullanılabilir:**

- **Tek kişilik / kurulumsuz:** `index.html` dosyasını çift tıkla — veri
  yalnızca o tarayıcının `localStorage`'ında tutulur (eski davranış, birebir
  korundu).
- **Ekip / çoklu cihaz:** `server/` altındaki backend'i çalıştır (bkz. aşağı) —
  lokasyon, araç, sefer geçmişi ve ayarlar SQLite'ta ortak tutulur, aynı ağdaki
  herkes aynı veriyi görür.

## Klasör

```
tss-rota-panel/
├── index.html
├── styles.css
├── logo-white.png      ← buraya bırakılırsa başlıkta görünür (yoksa yazı ile düşer)
├── vendor/             Leaflet, SheetJS, jsPDF, html2canvas, Outfit — hepsi yerel
├── js/
│   ├── data.js         lokasyon/araç/durak verisi, Excel içe aktarma, backend senkronu
│   ├── osrm.js         gerçek yol mesafesi ve güzergah geometrisi
│   ├── tomtom.js       opsiyonel canlı trafik (anahtar sunucuda ya da kullanıcıda)
│   ├── weather.js      durak bazlı hava durumu uyarıları (Open-Meteo)
│   ├── fuelprice.js    ulusal ortalama akaryakıt fiyatı
│   ├── optimizer.js    kapasiteli sıralama optimizasyonu (tek araç, tek grup)
│   ├── fleet.js        çoklu araç ataması: kümeleme + optimizer.js'i grup başına çağırma
│   ├── exporter.js     Excel ve PDF çıktısı
│   └── app.js          arayüz akışı
└── server/             (opsiyonel) Express + SQLite backend — bkz. server/README.md
    ├── index.js        REST endpoint'leri + statik dosya sunumu + token kontrolü
    ├── db.js           SQLite şeması
    ├── store.js        CRUD + doğrulama (js/data.js ile aynı kurallar)
    ├── tomtom.js       TomTom proxy'si — API anahtarı tarayıcıya inmez
    ├── fuelprice.js    yakıt fiyatını kaynaktan doğrudan çeker (CORS engeli yok)
    └── scripts/        localStorage içe aktarma + otomatik testler
```

## Backend ile çalıştırma (ekip kullanımı)

```bash
cd server
npm install
cp .env.example .env     # APP_TOKEN'ı doldur (LAN paylaşımında şart)
npm start
```

Sonra `http://localhost:3000`. Aynı ağdaki diğer cihazlar
`http://<sunucu-makinenin-ip'si>:3000` ile bağlanır; ilk açılışta erişim
anahtarı bir kez sorulur ve o tarayıcıda saklanır.

Panel, bir sunucudan servis edildiğini kendisi anlar: `file://` ile açılırsa
backend'e hiç bağlanmaz, eskisi gibi yalnızca `localStorage` ile çalışır.
Mevcut tarayıcı verisini SQLite'a aktarmak için bkz. `server/README.md`.

Yazma işlemleri arayüzü hiç bekletmez: değişiklik anında ekranda görünür,
arka planda sunucuya iletilir. Bağlantı yoksa değişiklikler kuyrukta
(outbox) bekler ve bağlantı gelince otomatik gönderilir.

## Kullanım

1. Hareket noktası, kalkış saati, durak süresi ve başlangıç yükünü gir. Sol paneldeki
   kapasite çubuğu artık tek bir aracın değil, **sistemdeki tüm araçların toplam
   kullanılabilir kapasitesinin** ne kadarının planlandığını gösterir.
2. Durak ekle: lokasyon + yükleme/boşaltma + palet. Filonun toplam kapasitesini aşan
   giriş sistem tarafından engellenir.
3. **Rotayı planla** → hangi aracın/araçların kullanılacağına sistem otomatik karar
   verir (bkz. Araç Ataması), harita her aracın güzergahını farklı renkte çizer,
   tablo her araç için ayrı bir bölüm halinde sıralı durakları listeler.
4. Gerekirse: durak sırasını sürükle-bırakla değiştir, palet/durak süresini satırdan
   elle düzenle, ya da bir gruba atanan aracı üstteki "Araç" seçiminden değiştir —
   hepsi rota onaylanmadan önce yapılabilir.
5. Her araç kartında **tahmini yakıt maliyeti** gösterilir (dönüş yolu dahil); "Rotayı
   Onayla" butonuna basıldığında notu yazmadan önce filo genelinde toplam tahmini
   maliyet de görünür. TL/L fiyatı ulusal ortalamadan otomatik çekilir (bkz. aşağı),
   Trafik Ayarları > Yakıt bölümünden elle de girilebilir/güncellenebilir.
6. **Excel** (araç başına ayrı sayfa) veya **PDF** (harita + araç başına ayrı
   KPI/tablo bölümü) olarak dışa aktar — ikisi de yakıt maliyetini içerir.

Lokasyon ve araç listeleri üst menüden yönetilir; ayrı Excel dosyalarından içe aktarılabilir.
Haritaya sağ tıklamak yeni lokasyon formunu koordinatlarla doldurur.
Lokasyon ve araç kayıtları tarayıcıda saklanır, sekme kapansa da kalır.

## Araç ataması (çoklu araç)

Artık sefer planlamadan önce tek bir araç seçilmiyor — `js/fleet.js` şu kuralla karar verir:

1. Önce **tüm duraklar tek bir araca sığıyor mu** diye bakılır (kullanılabilir kapasitesi
   yeten en küçük araç denenir). Sığıyorsa her zaman tek araç kullanılır — gereksiz yere
   birden fazla araca bölünmez.
2. Sığmıyorsa duraklar gerçek yol mesafesine göre coğrafi kümelere ayrılır (2 kümeden
   başlanır, gerektikçe artırılır). Bir küme **asla ikiye bölünmez** — bütün olarak,
   ihtiyacını karşılayan en küçük uygun araca atanır. Bu yüzden aynı bölgedeki iki durak,
   uygun büyüklükte tek araç varken iki küçük araca dağıtılmaz.
3. Bir araç, aynı plan içinde en fazla bir kümeye/gruba atanır (aynı seferde iki kez
   kullanılmaz).
4. Filonun toplam kapasitesi planı hiçbir şekilde karşılayamıyorsa, en iyi rota yine
   üretilir; kısıt ihlalleri tabloda ve üstteki uyarı bandında işaretlenir.

Rota tablosunda bir gruba atanan araç, onaylanmadan önce elle değiştirilebilir
(kapasite yetersiz kalırsa engellenmez, sadece ihlal olarak işaretlenir).

Not: sıralama kararının kendisi (hangi durağın hangi sırada ziyaret edileceği) hâlâ
tamamen `js/optimizer.js`'teki değişmemiş algoritmadan çıkıyor — `fleet.js` sadece
duraklar birden fazla araca bölünmesi gerektiğinde hangi durağın hangi araca gideceğine
karar veriyor, sonra her grup için optimizer'ı ayrı ayrı çağırıyor.

## Excel sütun başlıkları

- **Lokasyon:** `ad`, `enlem`, `boylam`, `acilis`, `kapanis`
- **Araç:** `plaka`, `model`, `kapasite`, `yakit tuketimi` (ops., L/100km), `yakit tipi` (ops., dizel/benzin)

Türkçe/İngilizce ve büyük-küçük harf farkları tolere edilir.

## Yakıt maliyeti

Her araç kartında ve dışa aktarımlarda gösterilen tahmini yakıt maliyeti, araç
başına L/100km cinsinden tüketim × rota mesafesi (dönüş dahil) × TL/L fiyatı
olarak hesaplanır:

- **Tüketim:** Araçlar modalından her araç için elle girilir/düzenlenir; yeni
  eklenen Fiat Ducato/Peugeot Partner gibi araçlar üreticinin karma çevrim
  ortalamasına yakın bir varsayılanla gelir — gerçek filo verisi (yakıt fişi)
  girildikçe güncellenmesi önerilir.
- **Fiyat:** Türkiye'deki ücretsiz akaryakıt fiyat servisleri tarayıcıdan CORS
  nedeniyle doğrudan çağrılamıyor. Bu yüzden:
  - **Backend çalışıyorsa** fiyatı sunucu kaynaktan doğrudan çeker
    (`GET /api/fuel-price`, 6 saatlik önbellek) — CORS bir tarayıcı kısıtı
    olduğu için sunucuda böyle bir engel yok.
  - **Backend yoksa** (`file://`) devreye GitHub Actions iş akışı
    (`.github/workflows/fuel-price.yml`) girer: fiyatı 6 saatte bir çekip
    `data/fuel-price.json`'a yazar, panel de o dosyayı okur.

  Trafik Ayarları > Yakıt bölümünden elle bir TL/L fiyatı girilirse o her
  zaman önceliklidir. Detaylar: TEKNIK-DOKUMAN.md §10.4.

## Algoritma

Kapasiteli tek araç sıralama problemi (TSP + pickup/delivery + zaman penceresi):

1. OSRM'den gerçek yol mesafe/süre matrisi çekilir.
2. En yakın komşu ile başlangıç sıralaması kurulur.
3. 2-opt ve Or-opt ile iyileştirilir; kapasite ve erişim saati ihlalleri ikisi de eşit derecede yüksek ceza katsayısıyla bastırılır (uzun/ülke ölçeğindeki rotalarda erişim saati ihlalinin mesafeyle "satın alınabilmesini" önlemek için).
4. 7 durağa kadar tam arama ile doğrulanır.

Kısıt sağlanamıyorsa en iyi rota yine üretilir; ihlal tabloda ve harita işaretçisinde belirtilir.

## Bilinen sınırlar

- **Çevrimiçi bağımlılık:** kütüphaneler ve yazı tipi `vendor/` altında yerel; internet yalnızca iki şey için gerekli — mesafe hesabı (OSRM) ve harita karoları (OpenStreetMap). Tam çevrimdışı kullanım için kendi OSRM örneğinizi kurup `js/osrm.js` içindeki `BASE` değerini, karo sunucusu için de `js/app.js` içindeki `L.tileLayer` adresini değiştirin.
- **Yasak güzergah kısıtı** (köprü vb.) henüz uygulanmıyor — açık OSRM sunucusu özel `exclude` profillerini desteklemiyor. Sonraki fazda kendi OSRM örneğiyle eklenebilir.
- **Kümeleme sezgiseldir, kesin optimum garanti etmez:** çoklu araç gerektiğinde duraklar en yakın nokta tohumlamasıyla kümelenir (bkz. Araç Ataması) — küçük durak sayılarında iyi sonuç verir, çok sayıda dağınık durakta teorik en iyi bölüştürme olmayabilir.
- **Başlangıç Yükü tek bir araca aittir:** birden fazla araç gerektiğinde bu yük, başlangıç noktasına en yakın kümeye atanan araca eklenir.
- **Trafik verisi yok:** süreler sabit hız varsayımıyla hesaplanır.
- **Yakıt fiyatı otomatik güncellemesi GitHub Actions'a bağlı:** repo bir
  GitHub uzak sunucusuna bağlı değilse ya da Actions çalışmıyorsa otomatik
  fiyat gelmez, kullanıcı Trafik Ayarları > Yakıt'tan elle girer (bkz. yukarı).
- **Yakıt tüketimi varsayılanları tahminidir:** gerçek filo verisiyle
  (yakıt fişi/depo kaydı) güncellenmedikçe yakıt maliyeti kaba bir tahmindir.
- **Ekip senkronizasyonu anlık değil:** backend kullanılırken başka bir cihazın
  yaptığı değişiklik, panel yenilendiğinde (sayfa açılışında) gelir — canlı
  push/websocket yok. Aynı kaydı iki kişi aynı anda düzenlerse son yazan kazanır.
- **Taslak duraklar ve hesaplanan plan paylaşılmaz:** backend'e hiç gitmez,
  sayfa yenilenince sıfırlanır (bilinçli — "o anki taslak sefer" kalıcı olmamalı).
- PDF'e harita gömme tarayıcı güvenlik kısıtlarına takılırsa rapor tablo ile üretilir ve durum PDF üzerinde belirtilir.

## Devam edecek geliştiriciler için

Proje şu an canlıya alınmıyor, mevcut haliyle kalabilir. Ama ileride biri bunu canlıya
almaya karar verirse, önce şunları çözmesi gerekiyor:

- **OSRM: halka açık demo sunucusu kullanılıyor** (`js/osrm.js` içindeki `BASE = 'https://router.project-osrm.org'`).
  Bu sunucu proje/kurum kullanımı için değil, herkese açık bir demo — kullanım şartları
  ticari/sürekli trafiğe izin vermiyor. Canlıya alınırsa:
  - Rate-limit'e takılır, belirli bir istek sayısından sonra mesafe/rota istekleri
    hata döner ya da yavaşlar.
  - SLA/uptime garantisi yok — sunucu yavaşladığında ya da düştüğünde uygulamanın
    rota hesaplama özelliği tamamen çalışmaz hale gelir.
  - IP/kurum bazlı engellenme riski var.
  - Çözüm: kendi OSRM örneğinizi kurup `TSSOsrm.setBase()` ile ya da `BASE`
    değerini değiştirerek ona yönlendirmek gerekir (README'nin "Bilinen sınırlar"
    bölümünde de geçiyor).

- ~~**Veri kalıcılığı sadece `localStorage`'da**~~ — **çözüldü** (`server/`):
  artık opsiyonel bir Express + SQLite backend var, veri ekip içinde paylaşılıyor
  ve yedeklenebiliyor (`server/data/tss.db` dosyasını kopyalamak yeterli).
  `TSSData` arayüzü aynen korundu, `app.js`/`fleet.js`/`exporter.js` değişmedi.
  Kalan sınırlar:
  - Backend çalıştırılmazsa (`file://` ile açma) davranış eskisi gibi: veri tek
    tarayıcıya bağlı, tarayıcı verisi temizlenirse kaybolur.
  - Çakışma politikası v1'de **son yazan kazanır** — aynı kaydı iki kişi aynı
    anda düzenlerse biri sessizce diğerinin üzerine yazar (şemada `updated_at`
    var, ileride çakışma tespiti eklenebilir).
  - Erişim kontrolü tek paylaşılan anahtar (`APP_TOKEN`); kullanıcı hesabı,
    kimlik veya rol/yetki yönetimi yok — küçük bir LAN ekibi için tasarlandı.

- **Otomatik test durumu:** backend ve `js/data.js`'in senkronizasyon katmanı
  için testler var (`cd server && npm test` → 98 test: REST yüzeyi, doğrulama,
  outbox/çevrimdışı davranışı, `file://` modu). Ancak **`js/optimizer.js` ve
  `js/fleet.js` (rota/kümeleme algoritması) hâlâ testsiz** — bu iki dosyada
  değişiklik yapmadan önce birkaç senaryo testi (bilinen giriş/mesafe matrisi →
  beklenen sıralama/kısıt ihlali) eklemek regresyonları yakalamak açısından
  faydalı olur. Arayüz akışları da elle test edilmeli.
