# LED Panel Envanter – Geliştirme Planı

## 1. Çıkarılacaklar (ChirpStack / LoRa)

| Bileşen | Aksiyon |
|--------|--------|
| Webhook route'ları (`/webhook`, `/webhook/:slug`) | Kaldır |
| `processWebhook`, integrations API (GET/POST/DELETE) | Kaldır |
| `measurements` tablosu ve tüm referanslar | Kaldır |
| `saved_points` (LoRa alanları), `planned_gateways`, `integrations`, `system_logs` | Tablolar kaldırılacak veya sadece `panel_locations` kullanılacak |
| start-session, poll-session API | Kaldır |
| Planner sayfası (planner.html, planner.js) | Dosyaları kaldır |
| Integrations sayfası (integrations.html) | Dosyası kaldır |
| checkAuth içinde webhook allowlist | Kaldır |

## 2. Eklenecekler

### Backend
- **Tablo:** `panel_locations` (id, location_name, panel_count, latitude, longitude, note, created_at)
- **API:**  
  - `GET /api/panel-locations` – tüm kayıtlar  
  - `POST /api/panel-locations` – yeni kayıt (location_name, panel_count, lat, lng, note)  
  - `DELETE /api/panel-locations/:id` – kayıt sil  
  - `GET /api/export-csv` – Excel/CSV çıktı (konum adı, panel sayısı, enlem, boylam, not, tarih)

### Frontend (mobil uyumlu, responsive)
- **GPS:** Sayfa açıldığında `navigator.geolocation.getCurrentPosition` ile konum otomatik alınacak.
- **Popup/Modal:** Konum alındığında (veya “Yeni kayıt” tıklanınca) modal açılacak:
  - Konum adı (input)
  - Panel sayısı (number)
  - Not (opsiyonel)
  - Enlem/Boylam (readonly, GPS’ten)
  - Kaydet / İptal
- **Harita:** Kayıtlar marker olarak gösterilecek; popup’ta konum adı, panel sayısı, sil butonu.
- **UI:** Responsive, mobil-first (viewport, touch, büyük butonlar), tek sütun form.

### CSS
- Viewport meta, touch-friendly butonlar, modal (backdrop + orta kutu), bottom bar mobilde sabit.
- Gereksiz planner/integrations stilleri kaldırılacak veya sadeleştirilecek.

## 3. Dosya Değişiklikleri

| Dosya | İşlem |
|-------|--------|
| `schema.sql` | panel_locations tablosu; eski tablolar isteğe bırakılabilir (temiz schema) |
| `server.js` | ensureSchema güncelle, webhook/integrations/measurements/planner API kaldır, panel_locations API + export ekle |
| `public/index.html` | Nav sadeleştir (sadece Harita, Excel İndir); modal HTML ekle |
| `public/js/main.js` | GPS otomatik, modal aç/kapa, kaydet, haritada panel_locations çiz, sil |
| `public/css/style.css` | Responsive, modal, mobil bottom bar |
| `public/planner.html`, `public/js/planner.js`, `public/integrations.html` | Sil |

## 4. Docker ve Test

- `schema.sql` güncel panel_locations ile Docker init’te kullanılacak.
- **Çalıştırma:** `docker-compose up -d db app` (app, DB hazır olana kadar bekler; healthcheck kullanıldı).
- **Erişim:** Tarayıcıda `http://localhost:3000` (ilk açılışta setup gerekebilir).
- **Yeni kurulum (temiz test):** `docker-compose down -v` ile volume silinir, sonra `docker-compose up -d db app` ile yeniden başlatılır. Setup sayfasından uygulama adı ve admin kullanıcı/şifre tanımlanır.
- **Test adımları:** Setup → Login → Konum izni ver → Modal otomatik açılır → Konum adı + panel sayısı gir, Kaydet → Haritada nokta görünür → "Excel İndir" ile CSV alınır.
- **API testleri (yapıldı):** `/api/app-info` 200, `/api/panel-locations` giriş yokken 401, login sonrası panel CRUD ve `/api/export-csv` çalışır.
