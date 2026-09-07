# TSS Backend (Express + SQLite)

Rota Planlama Paneli'nin veri katmanı. Frontend'in `window.TSSData`
sözleşmesi değişmeden kalsın diye tasarlandı (bkz. `../CLAUDE.md`).

## Kurulum ve çalıştırma

```bash
cd server
npm install
cp .env.example .env     # APP_TOKEN'ı doldurun (LAN paylaşımı için)
npm start
```

Sonra tarayıcıda `http://localhost:3000`. Aynı ağdaki diğer cihazlar
`http://<bu-makinenin-ip'si>:3000` ile bağlanır (sunucu `0.0.0.0`'a
bind eder; `.env`'de `HOST=127.0.0.1` yaparsanız yalnızca bu makine).

`public/` altındaki statik dosyalar (index.html, styles.css, js/, vendor/,
assets/) da bu sunucudan servis edilir — API ile aynı origin, dolayısıyla
CORS yapılandırması gerekmez.

## Mevcut tarayıcı verisini aktarma (tek seferlik)

1. Paneli bugünkü haliyle açın, tarayıcı konsolunda:
   `copy(localStorage.getItem('tss-rota-panel-v1'))`
2. Çıktıyı bir dosyaya kaydedin, ör. `yedek.json`
3. `npm run import -- yedek.json` (üzerine yazmak için `--replace`)

Aynı id'li kayıtlar varsayılan olarak atlanır, script tekrar
çalıştırılabilir.

## Doğrulama

```bash
npm run smoke
```

Geçici bir veritabanı üzerinde tüm REST yüzeyini test eder (erişim
kontrolü, CRUD, doğrulama kuralları, ayar merge'i, sefer geçmişi
JSON round-trip'i, statik dosya sunumu). Frontend'e hiç dokunmaz.

## API

Tüm `/api/*` istekleri, `.env`'de `APP_TOKEN` tanımlıysa
`X-TSS-Token` header'ı ister (URL query string'inde token **kabul
edilmez**).

| Metot | Yol | Karşılığı (public/js/data.js) |
|---|---|---|
| GET | `/api/ping` | — (token/erişim kontrolü) |
| GET | `/api/bootstrap` | `load()` — locations, vehicles, history, traffic, fuel, tomtomApiKey |
| POST | `/api/locations` | `addLocation` |
| PUT | `/api/locations/:id` | `updateLocation` (yalnızca ad/erişim saati) |
| DELETE | `/api/locations/:id` | `removeLocation` |
| POST | `/api/vehicles` | `addVehicle` |
| PUT | `/api/vehicles/:id` | `updateVehicle` |
| PATCH | `/api/vehicles/:id/usable` | `setUsableCapacity` |
| DELETE | `/api/vehicles/:id` | `removeVehicle` |
| POST | `/api/trips` | `approveTrip` |
| DELETE | `/api/trips/:id` | `removeHistoryEntry` |
| PATCH | `/api/settings/traffic` | `updateTrafficSettings` |
| PATCH | `/api/settings/fuel` | `updateFuelPriceSettings` |
| PATCH | `/api/settings/tomtom-key` | `setTomTomApiKey` |
| POST | `/api/tomtom/route-leg` | TomTom proxy'si — anahtar sunucuda kalır |
| POST | `/api/tomtom/incidents` | Rota üzerindeki olaylar (kaza/kapalı yol); eleme sunucuda |
| GET | `/api/fuel-price` | Ulusal ortalama yakıt fiyatı (6 saatlik önbellek) |

Taslak duraklar (`stops`) ve hesaplanan `plan` **backend'e taşınmaz** —
bugünkü gibi tarayıcıda, sayfa yenilenince sıfırlanan geçici veri
olarak kalır.

## TomTom anahtarı (opsiyonel)

`.env` içindeki `TOMTOM_API_KEY` doldurulursa canlı trafik anahtarı
**tarayıcıya hiç inmez**: panel isteği `/api/tomtom/route-leg` ucuna yapar,
TomTom'a asıl çağrıyı sunucu gönderir. `/api/bootstrap` yanıtı bu modda
anahtarı içermez, yalnızca `tomtomKeySource: "server"` bilgisini taşır ve
Trafik Ayarları'ndaki alan "sunucuda tanımlı" notunu gösterir.

Boş bırakılırsa eski davranış sürer: kullanıcı anahtarı arayüzden girer,
anahtar o tarayıcıda saklanır ve istek URL'sinde görünür (bu durumda TomTom
panelinden anahtara domain kısıtlaması eklenmesi önerilir).

## Veritabanı

Tek dosya: `server/data/tss.db` (git'e girmez). Yalnızca bu backend
süreci erişir — dosyayı ortak bir ağ klasörüne koyup istemcilerin
doğrudan açması **desteklenmez** (SQLite ağ üzerinden çoklu yazar
için güvenli değildir).

Yedek almak = `tss.db` dosyasını kopyalamak.
