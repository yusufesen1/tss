# TSS — Rota Planlama Paneli

Araç filosu için sefer/rota planlama aracı. Derinlemesine mimari/algoritma
anlatımı için **README.md** (kullanım) ve **TEKNIK-DOKUMAN.md** (mimari,
algoritmalar, dış servisler) dosyalarına bak — burada onları tekrar etmiyorum,
sadece Claude'un bu projede çalışırken bilmesi gereken kısayolları yazıyorum.

## En kritik kural

`js/data.js`'in dışa açtığı `window.TSSData` fonksiyonları (`addLocation`,
`updateVehicle`, `approveTrip`, `getHistory` vb.) **senkron kalmalı** —
`js/app.js` içinde bunlara 60'tan fazla çağrı noktası var ve hiçbiri async
bekleyecek şekilde yazılmadı (sonucu aynı satırda kullanıyorlar). Backend
entegrasyonu bile bu sözleşmeyi bozmadan, bir "yerel-öncelikli cephe"
üzerinden yapılıyor (bkz. `C:\Users\yusuf\.claude\plans\greedy-mapping-blum.md`
ve/veya `server/README.md` varsa). **`TSSData` fonksiyon imzalarını asenkron
yapma, dönüş şeklini değiştirme, ya da app.js'teki çağrı noktalarını
"düzeltmek" için es geçme** — bu, en çok kırılma riski taşıyan yer.

## Çalıştırma

- **Frontend-only (bugünkü hal):** `index.html` çift tıkla, backend gerekmez.
- **Backend ile (varsa `server/` klasörü):** `cd server && npm install && node index.js`,
  sonra `http://localhost:PORT` aç. Deploy gerekmez, LAN'daki diğer cihazlar
  `http://<makine-ip>:PORT` ile bağlanabilir (backend `0.0.0.0`'a bind eder).

## Script yükleme sırası (`index.html`)

`js/*.js` dosyaları global `window.TSSxxx` nesneleri export eden IIFE'ler,
modül sistemi yok — sıra önemli:
`data → osrm → tomtom → weather → fuelprice → optimizer → fleet → exporter → app`.
Yeni bir `js/*.js` dosyası eklerken bu sıraya (bağımlı olduğu modülden sonra)
uy, `index.html`'in script bloğuna ekle.

## Kod stili

- Vanilla ES5 üslubu: `'use strict'`, `function` ifadeleri, IIFE + tek bir
  `window.TSSxxx` export. `class`/ok fonksiyonu/`let`-`const` zorunluluğu yok
  — mevcut dosyanın stiline uy, karıştırma.
- Build adımı / bundler yok. TypeScript yok.
- Yorumlar ve kullanıcıya görünen metin **Türkçe**, kod tanımlayıcıları
  (fonksiyon/değişken adı) **İngilizce**.
- `optimizer.js` ve `fleet.js` **saf fonksiyonlar** — DOM'a hiç dokunmazlar,
  test edilmeleri kolay ama **otomatik test yok**. Bu iki dosyada değişiklik
  yaptıktan sonra en azından bilinen bir girdi/mesafe matrisiyle elle
  doğrula (regresyon checklist için plan dosyasına bak).

## Doküman senkronu

README.md ve TEKNIK-DOKUMAN.md, davranışı **elle, satır numarası/sabit
değer referanslarıyla** anlatıyor. Algoritma, veri şeması, dış servis
entegrasyonu ya da satır sayısı değiştiren her değişiklikten sonra bu iki
dosyanın ilgili bölümünü de güncelle — ayrıntı için
`.claude/rules/docs-sync.md`.

## Tasarım

Görsel değişiklik yapıyorsan `Turkish Support Services — Design System.md`
dosyasındaki renk/tipografi/bileşen kurallarına uy — yeni marka rengi,
gradyan, glassmorphism icat etme.
