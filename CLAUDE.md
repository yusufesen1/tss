# TSS — Rota Planlama Paneli

Araç filosu için sefer/rota planlama aracı. Derinlemesine mimari/algoritma
anlatımı için **README.md** (kullanım) ve **docs/TEKNIK-DOKUMAN.md** (mimari,
algoritmalar, dış servisler) dosyalarına bak — burada onları tekrar etmiyorum,
sadece Claude'un bu projede çalışırken bilmesi gereken kısayolları yazıyorum.

## En kritik kural

`public/js/data.js`'in dışa açtığı `window.TSSData` fonksiyonları (`addLocation`,
`updateVehicle`, `approveTrip`, `getHistory` vb.) **senkron kalmalı** —
`public/js/app.js` içinde bunlara 60'tan fazla çağrı noktası var ve hiçbiri async
bekleyecek şekilde yazılmadı (sonucu aynı satırda kullanıyorlar). Backend
entegrasyonu bile bu sözleşmeyi bozmadan, bir "yerel-öncelikli cephe"
üzerinden yapılıyor (ayrıntı: `docs/TEKNIK-DOKUMAN.md` §5.4).
**`TSSData` fonksiyon imzalarını asenkron
yapma, dönüş şeklini değiştirme, ya da app.js'teki çağrı noktalarını
"düzeltmek" için es geçme** — bu, en çok kırılma riski taşıyan yer.

## Çalıştırma

`cd server && npm install && npm start`, sonra `http://localhost:3000`.
Backend hem API'yi hem `public/` altındaki frontend'i servis eder — panel
**yalnızca** bu şekilde çalışır (`file://` ile açılırsa hata bandı gösterir).
Deploy gerekmez; LAN'daki diğer cihazlar `http://<makine-ip>:3000` ile
bağlanır (sunucu `0.0.0.0`'a bind eder).

Testler: `cd server && npm test` (smoke + sync).

## Script yükleme sırası (`public/index.html`)

`public/js/*.js` dosyaları global `window.TSSxxx` nesneleri export eden IIFE'ler,
modül sistemi yok — sıra önemli:
`data → osrm → tomtom → weather → fuelprice → optimizer → fleet → exporter → app`.
Yeni bir `public/js/*.js` dosyası eklerken bu sıraya (bağımlı olduğu modülden sonra)
uy, `public/index.html`'in script bloğuna ekle.

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

README.md ve docs/TEKNIK-DOKUMAN.md, davranışı **elle, satır numarası/sabit
değer referanslarıyla** anlatıyor. Algoritma, veri şeması, dış servis
entegrasyonu ya da satır sayısı değiştiren her değişiklikten sonra bu iki
dosyanın ilgili bölümünü de güncelle — ayrıntı için
`.claude/rules/docs-sync.md`.

## Tasarım

Görsel değişiklik yapıyorsan `docs/Turkish Support Services — Design System.md`
dosyasındaki renk/tipografi/bileşen kurallarına uy — yeni marka rengi,
gradyan, glassmorphism icat etme.
