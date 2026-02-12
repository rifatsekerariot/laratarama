-- LED Panel Envanter - Veritabanı Şeması

-- Uygulama yapılandırması (ilk kurulum)
-- admin_pass key stores bcrypt hash only (never plaintext)
CREATE TABLE IF NOT EXISTS app_config (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT
);

-- Kullanıcılar (session auth için - opsiyonel, app_config ile admin kullanılıyor)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Session store (connect-pg-simple)
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL,
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  PRIMARY KEY ("sid")
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- Panel konumları (saha envanteri)
CREATE TABLE IF NOT EXISTS panel_locations (
    id SERIAL PRIMARY KEY,
    location_name VARCHAR(200) NOT NULL,
    panel_count INTEGER NOT NULL DEFAULT 1,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
