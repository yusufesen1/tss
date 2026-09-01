# TSS — Rota ve Araç Atama Paneli

Backend'siz, tarayıcıda çalışan sefer planlama arayüzü. `index.html` dosyasını çift tıklayarak açmak yeterli.

## Klasör

```
tss-rota-panel/
├── index.html
├── styles.css
├── logo-white.png      ← buraya bırakılırsa başlıkta görünür (yoksa yazı ile düşer)
├── vendor/             Leaflet, SheetJS, jsPDF, html2canvas, Outfit — hepsi yerel
└── js/
    ├── data.js         lokasyon/araç/durak verisi, Excel içe aktarma
    ├── osrm.js         gerçek yol mesafesi ve güzergah geometrisi
    ├── optimizer.js    kapasiteli sıralama optimizasyonu (tek araç, tek grup)
    ├── fleet.js        çoklu araç ataması: kümeleme + optimizer.js'i grup başına çağırma
    ├── exporter.js     Excel ve PDF çıktısı
    └── app.js          arayüz akışı
```

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
5. **Excel** (araç başına ayrı sayfa) veya **PDF** (harita + araç başına ayrı
   KPI/tablo bölümü) olarak dışa aktar.

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
- **Araç:** `plaka`, `model`, `kapasite`

Türkçe/İngilizce ve büyük-küçük harf farkları tolere edilir.

## Algoritma

Kapasiteli tek araç sıralama problemi (TSP + pickup/delivery + zaman penceresi):

1. OSRM'den gerçek yol mesafe/süre matrisi çekilir.
2. En yakın komşu ile başlangıç sıralaması kurulur.
3. 2-opt ve Or-opt ile iyileştirilir; kapasite ihlalleri yüksek, erişim saati ihlalleri düşük ceza katsayısıyla bastırılır.
4. 7 durağa kadar tam arama ile doğrulanır.

Kısıt sağlanamıyorsa en iyi rota yine üretilir; ihlal tabloda ve harita işaretçisinde belirtilir.

## Bilinen sınırlar

- **Çevrimiçi bağımlılık:** kütüphaneler ve yazı tipi `vendor/` altında yerel; internet yalnızca iki şey için gerekli — mesafe hesabı (OSRM) ve harita karoları (OpenStreetMap). Tam çevrimdışı kullanım için kendi OSRM örneğinizi kurup `js/osrm.js` içindeki `BASE` değerini, karo sunucusu için de `js/app.js` içindeki `L.tileLayer` adresini değiştirin.
- **Yasak güzergah kısıtı** (köprü vb.) henüz uygulanmıyor — açık OSRM sunucusu özel `exclude` profillerini desteklemiyor. Sonraki fazda kendi OSRM örneğiyle eklenebilir.
- **Kümeleme sezgiseldir, kesin optimum garanti etmez:** çoklu araç gerektiğinde duraklar en yakın nokta tohumlamasıyla kümelenir (bkz. Araç Ataması) — küçük durak sayılarında iyi sonuç verir, çok sayıda dağınık durakta teorik en iyi bölüştürme olmayabilir.
- **Başlangıç Yükü tek bir araca aittir:** birden fazla araç gerektiğinde bu yük, başlangıç noktasına en yakın kümeye atanan araca eklenir.
- **Trafik verisi yok:** süreler sabit hız varsayımıyla hesaplanır.
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

- **Veri kalıcılığı sadece `localStorage`'da** (`js/data.js`). Backend/veritabanı yok.
  Canlıya alınırsa:
  - Veri tek tarayıcıya/cihaza bağlı kalır — ekip içinde paylaşılmaz, farklı
    bilgisayardan girildiğinde lokasyon/araç/geçmiş görünmez.
  - Kullanıcı tarayıcı verisini temizlerse (ya da farklı bir profil/gizli sekme
    kullanırsa) tüm lokasyonlar, araçlar ve sefer geçmişi geri dönüşü olmayan
    şekilde silinir. Yedekleme mekanizması yok.
  - Çözüm: canlıya alınacaksa bu katmanın gerçek bir backend + veritabanına
    taşınması gerekir; `js/data.js`'teki `TSSData` arayüzü (aynı fonksiyon
    imzaları) korunursa üstteki kod (`app.js`, `fleet.js` vb.) değişmeden kalabilir.

- **Otomatik test yok.** Hiçbir dosyada unit/integration test bulunmuyor. Özellikle
  `js/optimizer.js` ve `js/fleet.js` (rota/kümeleme algoritması) üzerinde değişiklik
  yapmadan önce en azından bu iki dosya için birkaç senaryo testi (bilinen
  giriş/mesafe matrisi → beklenen sıralama/kısıt ihlali) eklemek regresyonları
  yakalamak açısından faydalı olur.
