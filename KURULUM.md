# Panel Envanter – Farklı Bilgisayarda Kurulum

Bu rehber, uygulamayı **kaynak kod olmadan**, sadece Docker ile farklı bir bilgisayara kurmanızı anlatır.

---

## 1. Gereksinimler

- **Docker** ve **Docker Compose** yüklü olmalı.
  - Windows/Mac: [Docker Desktop](https://www.docker.com/products/docker-desktop/) indirip kurun.
  - Linux: Docker Engine + Docker Compose plugin ([kurulum](https://docs.docker.com/engine/install/)).

Kurulumu doğrulamak için:
```bash
docker --version
docker compose version
```

---

## 2. Kurulum Klasörünü Hazırlama

Yeni bilgisayarda bir klasör oluşturun (örn. `panel-envanter`) ve **aşağıdaki 3 dosyayı** bu klasöre koyun.

### 2.1 `docker-compose.prod.yml`

Bu dosyayı projeden kopyalayın veya aşağıdaki içeriği `docker-compose.prod.yml` adıyla kaydedin:

```yaml
# Production: image Docker Hub'dan çekilir.
services:
  app:
    image: ariotiot/panel-envanter:latest
    container_name: ariot_app
    restart: always
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - NODE_ENV=production
      - SESSION_SECRET=${SESSION_SECRET:-local-dev-session-secret-change-in-prod}
      - DB_HOST=db
      - DB_USER=ariot
      - DB_PASSWORD=ariot_secret
      - DB_NAME=ariot_db
      - CADDY_ADMIN_URL=http://caddy:2019
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:15-alpine
    container_name: ariot_db
    restart: always
    environment:
      - POSTGRES_USER=ariot
      - POSTGRES_PASSWORD=ariot_secret
      - POSTGRES_DB=ariot_db
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./schema.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ariot -d ariot_db"]
      interval: 3s
      timeout: 5s
      retries: 5
      start_period: 10s

  caddy:
    image: caddy:alpine
    container_name: ariot_caddy
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - caddy_data:/data
      - caddy_config:/config
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
    environment:
      - CADDY_AGREE=true
      - CADDY_ADMIN=0.0.0.0:2019
    depends_on:
      - app

volumes:
  pgdata:
  caddy_data:
  caddy_config:
```

### 2.2 `Caddyfile`

Aynı klasöre `Caddyfile` adıyla oluşturun:

```
:80 {
    reverse_proxy app:3000
}
```

### 2.3 `schema.sql`

Aynı klasörde `schema.sql` adıyla oluşturun ve aşağıdaki içeriği yapıştırın:

```sql
-- LED Panel Envanter - Veritabanı Şeması
CREATE TABLE IF NOT EXISTS app_config (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL,
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  PRIMARY KEY ("sid")
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
CREATE TABLE IF NOT EXISTS panel_locations (
    id SERIAL PRIMARY KEY,
    location_name VARCHAR(200) NOT NULL,
    panel_count INTEGER NOT NULL DEFAULT 1,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 3. İsteğe Bağlı: `.env` (Şifre / Gizlilik)

Üretim ortamında güçlü bir oturum secret kullanmak için, aynı klasörde `.env` dosyası oluşturun:

```env
SESSION_SECRET=buraya-uzun-ve-rastgele-bir-sifre-yazin
```

Bu dosya yoksa uygulama varsayılan bir değerle çalışır (sadece test için uygundur).

---

## 4. Çalıştırma

Klasörde terminal/powershell açın ve:

```bash
# İmajları indir
docker compose -f docker-compose.prod.yml pull

# Servisleri başlat
docker compose -f docker-compose.prod.yml up -d
```

İlk çalıştırmada Docker Hub’dan `ariotiot/panel-envanter:latest`, `postgres:15-alpine` ve `caddy:alpine` indirilir.

---

## 5. Erişim

- **IP ile (domain yok):** Tarayıcıda `http://BILGISAYAR_IP` veya `http://localhost` (port 80).
- **Doğrudan uygulama:** `http://localhost:3000`

Açılan sayfada kurulum sihirbazı gelir: uygulama adı, isteğe bağlı **alan adı**, admin kullanıcı ve şifre. Alan adı girerseniz Caddy otomatik HTTPS açar.

---

## 6. Durdurma / Güncelleme

**Durdurmak:**
```bash
docker compose -f docker-compose.prod.yml down
```

**Güncel imajı çekip yeniden başlatmak:**
```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

---

## Özet: Yeni Bilgisayarda İhtiyaç Duyulan Dosyalar

| Dosya | Açıklama |
|-------|-----------|
| `docker-compose.prod.yml` | Servis tanımları (app, db, caddy) |
| `Caddyfile` | Başlangıç reverse proxy (:80 → app) |
| `schema.sql` | Veritabanı tabloları (ilk kurulum) |
| `.env` | (İsteğe bağlı) SESSION_SECRET |

Kaynak kod veya Node.js kurulumu **gerekmez**; uygulama Docker Hub’daki hazır imajdan çalışır.
