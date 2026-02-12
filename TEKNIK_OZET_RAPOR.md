# Panel Envanter Uygulaması – Teknik Özet Rapor

**Son güncelleme:** Güvenlik sertleştirmesi, production hazırlığı ve altyapı iyileştirmeleri (session store, Winston, Docker) ile güncel sürüm.

---

## 1. Projenin Amacı ve Son Hali

### Amaç
Sahadaki **LED panellerin envanterini** konum bilgisiyle kaydetmek, veritabanında saklamak ve **Excel (CSV)** olarak dışa aktarmak. Kullanıcı telefondan veya masaüstünden siteyi açar; konum GPS’ten otomatik alınır, bir form ile konum adı ve panel sayısı girilir; kayıtlar haritada gösterilir ve CSV indirilebilir.

### Yapılan Başlıca Değişiklikler (Özet)
- **ChirpStack / LoRa** kaldırıldı; sadece **panel konumları** (konum adı, panel sayısı, enlem/boylam, not) tutuluyor.
- **Mobil uyumlu** arayüz: GPS otomatik, açılışta popup, responsive CSS.
- **Güvenlik:** bcrypt, Zod (.strict()), rate limiting, Helmet, CORS, güvenli session cookie.
- **Production:** SESSION_SECRET zorunlu, jenerik hata mesajları, migration script’leri, env.example.
- **Altyapı (Day-2):**
  - **Oturum:** MemoryStore yerine **PostgreSQL** (connect-pg-simple); sunucu yeniden başlasa da oturumlar korunuyor.
  - **Loglama:** **Winston** ile error.log, app.log ve console; Docker log’ları ile uyumlu.
  - **Docker:** Multi-stage build, **root olmadan** çalışma (node kullanıcısı).

---

## 2. Mimari ve Teknoloji Yığını

| Katman | Teknoloji |
|--------|-----------|
| **Backend** | Node.js, Express 4.x |
| **Veritabanı** | PostgreSQL (pg pool); oturumlar da DB’de (connect-pg-simple) |
| **Frontend** | Statik HTML/CSS/JS, Leaflet, Geolocation API |
| **Kimlik doğrulama** | express-session + **PostgreSQL store**, httpOnly + sameSite cookie |
| **Şifre** | bcryptjs (12 round) |
| **Doğrulama** | Zod (şema + .strict()) |
| **Güvenlik** | Helmet, CORS, express-rate-limit |
| **Loglama** | Winston (dosya + console) |

### Proje Yapısı (Özet)

```
loratarama/
├── server.js              # Ana uygulama (Express, API, auth, PG session, limitler)
├── logger.js              # Winston: error.log, app.log, console
├── package.json
├── schema.sql             # Tablolar (app_config, users, session, panel_locations)
├── env.example
├── Dockerfile             # Multi-stage, non-root (node user)
├── public/
│   ├── index.html         # Ana sayfa (harita + modal)
│   ├── login.html, setup.html
│   ├── css/style.css, js/main.js
├── scripts/
│   ├── create_session_table.sql   # session tablosu (connect-pg-simple)
│   ├── SQL_MIGRATION_SESSION_TABLE.md
│   ├── migrate_passwords.sql      # admin_pass → bcrypt hash
│   ├── migrate-plaintext-password-to-hash.js
│   └── security-poc-tests.sh
├── docker-compose.yml
└── Dokümantasyon (PLAN.md, SECURITY_*, MIGRATION.md, TEKNIK_OZET_RAPOR.md)
```

---

## 3. Uygulamanın Çalışma Akışı

### 3.1 Sunucu Ayağa Kalkışı
1. `dotenv` → `.env` yüklenir; **logger** devreye alınır (console + error.log, app.log).
2. Production’da **SESSION_SECRET** yoksa uygulama çıkar.
3. Express: Helmet → CORS → body-parser.
4. **PostgreSQL pool** oluşturulur.
5. **Session store:** connect-pg-simple ile oturumlar **PostgreSQL**’deki `session` tablosunda tutulur (pool paylaşılır).
6. express-session (store, cookie: httpOnly, secure, sameSite: strict).
7. `ensureSchema()`: app_config, users, panel_locations tabloları (session tablosu ayrı migration ile oluşturulur).
8. DB bağlantısı retry ile; ardından `loadAppConfig()` (admin kullanıcı ve şifre hash’i bellekte).
9. checkAuth, express.static, rate limitler, route’lar.
10. Global hata yakalayıcı → istemciye sadece “Internal Server Error”; detaylar **logger** ile dosyaya ve console’a.

### 3.2 İlk Kurulum (Setup)
- Yapılandırma yoksa istekler setup’a yönlendirilir.
- Setup: Zod (strict), transaction ile race önleme, bcrypt hash; app_config güncellenir.

### 3.3 Giriş (Login)
- POST /api/login: Zod, bcrypt.compare; oturum **PostgreSQL session** tablosuna yazılır; strictLimiter.

### 3.4 Ana Sayfa (Panel Envanter)
- GPS → modal → panel kayıt/sil; GET/POST/DELETE panel-locations; export-csv (strictLimiter).

### 3.5 Çıkış (Logout)
- POST /api/logout: Session DB’den silinir, cookie temizlenir; strictLimiter.

---

## 4. API Özeti

| Metot | Yol | Auth | Rate limit | Açıklama |
|-------|-----|------|------------|----------|
| POST | /api/login | Hayır | strict (5/15 dk) | user, pass (Zod); bcrypt.compare |
| GET | /api/app-info | Hayır | general | Uygulama adı, configured |
| POST | /api/complete-setup | Hayır* | strict | İlk kurulum; bcrypt.hash; transaction |
| GET | /api/panel-locations | Evet | general | Tüm panel kayıtları |
| POST | /api/panel-locations | Evet | general | Yeni kayıt (Zod strict) |
| DELETE | /api/panel-locations/:id | Evet | general | Kayıt sil (id pozitif integer) |
| GET | /api/export-csv | Evet | strict | CSV indir |
| POST | /api/logout | Hayır | strict | Oturumu sonlandır |

---

## 5. Veritabanı

- **app_config:** app_name, admin_user, admin_pass (bcrypt hash), is_configured.
- **session:** connect-pg-simple için (sid PK, sess json, expire); **ayrı migration ile oluşturulur** – `scripts/create_session_table.sql` veya `SQL_MIGRATION_SESSION_TABLE.md`.
- **users:** Şema var; tek admin app_config üzerinden.
- **panel_locations:** id, location_name, panel_count, latitude, longitude, note, created_at.

Tüm uygulama sorguları **parametreli**; SQL injection önlemi uygulanıyor.

---

## 6. Güvenlik ve Altyapı

- **Şifre:** Sadece bcrypt hash; girişte bcrypt.compare.
- **Session:** PostgreSQL store (MemoryStore yok); httpOnly, secure (prod), sameSite: strict.
- **Girdi:** Zod .strict(); bilinmeyen alanlar 400.
- **Rate limit:** Login, setup, export-csv, logout → strict (5/15 dk); diğer /api → general (200/15 dk).
- **Başlıklar:** Helmet (CSP, HSTS, X-Content-Type-Options, X-Frame-Options).
- **CORS:** Production’da wildcard yok.
- **Hata:** İstemciye jenerik mesaj; detaylar Winston ile error.log / app.log ve console’da.
- **Docker:** Multi-stage build; container **root değil**, `node` kullanıcısı (uid 1001) ile çalışır.

---

## 7. Konfigürasyon ve Çalıştırma

- **Geliştirme:** `.env` olmadan çalışır. `npm start` / `npm run dev`. Loglar console + app.log, error.log (LOG_DIR varsayılan: proje kökü).
- **Production:** `NODE_ENV=production`, **SESSION_SECRET** zorunlu.
- **SESSION_SECRET:** `openssl rand -base64 32` veya `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- **Session tablosu:** İlk kurulumda veritabanında **bir kez** çalıştırın:
  ```sql
  CREATE TABLE IF NOT EXISTS "session" (
    "sid" varchar NOT NULL,
    "sess" json NOT NULL,
    "expire" timestamp(6) NOT NULL,
    PRIMARY KEY ("sid")
  );
  CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
  ```
  Detay: `scripts/SQL_MIGRATION_SESSION_TABLE.md`.
- **Şifre migration:** Mevcut plaintext için `scripts/migrate_passwords.sql` (SQL) veya `scripts/migrate-plaintext-password-to-hash.js` (Node).
- **Docker:** `docker-compose up -d db app`; uygulama `http://localhost:3000`. Görüntüler `node` kullanıcısı ile çalışır; loglar stdout (Docker logs) ve isteğe bağlı LOG_DIR (örn. /app/logs).

Bu doküman, son değişiklikler dahil programın güncel teknik özetidir.
