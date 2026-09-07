---
paths:
  - "README.md"
  - "TEKNIK-DOKUMAN.md"
---

# Doküman senkron kuralları

Bu iki dosya kod tabanını **elle, satır numarası ve sabit değer
referanslarıyla** anlatıyor (ör. "`data.js:369-377`", "`PENALTY_TIME = 1e7`",
"`app.js (~2260 satır)`"). Kod değiştiğinde bu referanslar sessizce
eskiyebilir — 2026-09-07 oturumunda tam olarak bu tür bir drift bulunup
düzeltildi (bkz. git geçmişi). Aşağıdakilerden biri değiştiğinde ilgili
bölümü de güncelle:

- **Algoritma davranışı** (`optimizer.js`/`fleet.js`): ceza katsayıları,
  sıralama sezgiselinin hangi metriği kullandığı, kapasite/zaman penceresi
  kuralları → TEKNIK-DOKUMAN.md §7/§8 ve README.md "Algoritma" bölümü.
- **Satır numarası/adet referansları** (`data.js:NNN-NNN` gibi alıntılar,
  dosya satır sayıları) → doğrudan grep'le doğrula, tahmin etme.
  `wc -l js/*.js` ile mevcut satır sayılarını karşılaştır.
  ES5-stil dosyalarda `js/app.js` gibi büyük dosyalar sık büyür — "~N satır"
  yazan yerler yaklaşık olsa da %10+ sapma varsa güncelle.
- **Dış servis/entegrasyon değişikliği** (yeni bir `js/*.js` istemcisi,
  yeni bir endpoint, CORS/otomasyon deseni) → TEKNIK-DOKUMAN.md §10 ve
  "Bilinen sınırlar"/§13 tablosu.
- **Veri şeması** (`state` alanları, `localStorage` anahtarı, backend
  eklenirse API sözleşmesi) → TEKNIK-DOKUMAN.md §5 ve §14 yol haritası.
- Her doküman dosyasının sonunda bir "bu doküman ... itibarıyla ... revize
  edilmiştir" notu var — büyük bir güncelleme yaptıysan bu tarihi ve
  parantez içindeki özet listeyi de tazele.

Küçük bir davranış değişikliği için dokümanın tamamını yeniden yazma —
sadece etkilenen paragrafı/satırı düzelt, aynı üslup ve ayrıntı seviyesini
koru.
