---
paths:
  - "public/**/*.html"
  - "public/js/**/*.js"
  - "public/**/*.css"
---

# Frontend kuralları

- **`window.TSSData` senkron sözleşmesi kırılmaz.** `public/js/app.js` içindeki
  60+ `D.*` çağrı noktası sonucu aynı satırda, senkron kullanıyor — hiçbiri
  `.then()`/`await` beklemiyor. `data.js`'e backend entegrasyonu eklerken
  bile dışa açılan fonksiyonlar (`addLocation`, `updateVehicle`,
  `approveTrip`, `getHistory`, ...) senkron kalıp anında değer döndürmeye
  devam etmeli; ağ işi (varsa) yalnızca arka planda, mevcut senkron
  davranışa ek olarak yapılmalı.
- **ES5 üslubu.** `'use strict'`, `function` ifadesi, IIFE + tek
  `window.TSSxxx` export. `class`, ok fonksiyonu, `let`/`const`'a zorunlu
  geçiş yok — dosyanın mevcut stiline uy.
- **Build adımı yok.** Bundler/transpiler ekleme; `<script src="js/...">`
  doğrudan tarayıcıda çalışır durumda kalmalı.
- **Script sırası** (`public/index.html` alt kısmı) bağımlılık sırasını yansıtır:
  `data → osrm → tomtom → weather → fuelprice → optimizer → fleet →
  exporter → app`. Yeni bir modül eklerken bağımlı olduğu modülden sonraya
  koy.
- **`optimizer.js` ve `fleet.js` saf kalmalı** — DOM/`localStorage`'a hiç
  dokunmazlar (parametre olarak veri alıp sonuç döndürürler). Bu ayrım
  bilinçli, koruyun.
- **Türkçe/İngilizce ayrımı:** yorumlar ve kullanıcıya görünen metin
  Türkçe, fonksiyon/değişken adları İngilizce.
- Görsel değişiklikte `Turkish Support Services — Design System.md`
  dosyasındaki renk/tipografi/bileşen kurallarına uy.
