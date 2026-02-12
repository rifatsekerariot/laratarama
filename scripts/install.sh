#!/usr/bin/env bash
# Panel Envanter - Zero-Touch Kurulum
# Kullanım: curl -sSL https://raw.githubusercontent.com/rifatsekerariot/laratarama/main/scripts/install.sh | sudo bash
# Veya: curl -sSL ... | sudo bash -s -- /opt/panel-envanter

set -e
INSTALL_DIR="${1:-/opt/panel-envanter}"
COMPOSE_FILE="docker-compose.prod.yml"

echo "[*] Panel Envanter - Zero-Touch Kurulum"
echo "[*] Kurulum dizini: $INSTALL_DIR"

# --- Linux kontrolü ---
if [ "$(uname -s)" != "Linux" ]; then
  echo "[!] Bu script sadece Linux üzerinde çalışır."
  exit 1
fi

# --- Root/sudo kontrolü ---
if [ "$(id -u)" -ne 0 ]; then
  echo "[!] Docker kurulumu ve sistem dizinine yazma için root gerekir."
  echo "    Çalıştırın: curl -sSL ... | sudo bash"
  exit 1
fi

# --- Docker kurulumu (yoksa) ---
if ! command -v docker &>/dev/null; then
  echo "[*] Docker bulunamadı, kuruluyor (get.docker.com)..."
  export DEBIAN_FRONTEND=noninteractive
  curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
  sh /tmp/get-docker.sh
  rm -f /tmp/get-docker.sh
  systemctl enable --now docker 2>/dev/null || true
  echo "[+] Docker kuruldu."
else
  echo "[*] Docker zaten yüklü."
fi

# --- Docker Compose (plugin veya standalone) ---
if ! docker compose version &>/dev/null; then
  if command -v docker-compose &>/dev/null; then
    echo "[*] docker-compose (standalone) kullanılacak."
    COMPOSE_CMD="docker-compose"
  else
    echo "[!] Docker Compose bulunamadı. Docker Compose plugin veya docker-compose kurun."
    exit 1
  fi
else
  COMPOSE_CMD="docker compose"
  echo "[*] Docker Compose (plugin) kullanılıyor."
fi

# --- Kurulum dizini ---
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# --- docker-compose.prod.yml ---
echo "[*] $COMPOSE_FILE yazılıyor..."
cat > "$COMPOSE_FILE" << 'COMPOSE_EOF'
# Production: image Docker Hub'dan.
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
COMPOSE_EOF

# --- Caddyfile ---
echo "[*] Caddyfile yazılıyor..."
cat > Caddyfile << 'CADDY_EOF'
:80 {
    reverse_proxy app:3000
}
CADDY_EOF

# --- schema.sql ---
echo "[*] schema.sql yazılıyor..."
cat > schema.sql << 'SCHEMA_EOF'
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
SCHEMA_EOF

# --- .env (SESSION_SECRET) ---
if [ ! -f .env ]; then
  SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p -c 64)
  echo "SESSION_SECRET=$SECRET" > .env
  chmod 600 .env
  echo "[*] .env oluşturuldu (SESSION_SECRET)."
fi

# --- Docker Compose: export .env ve çalıştır ---
set -a
[ -f .env ] && . ./.env
set +a

echo "[*] Docker imajları indiriliyor..."
$COMPOSE_CMD -f "$COMPOSE_FILE" pull

echo "[*] Konteynerler başlatılıyor..."
$COMPOSE_CMD -f "$COMPOSE_FILE" up -d

echo ""
echo "[+] Kurulum tamamlandı."
echo "    Dizin: $INSTALL_DIR"
echo "    Erişim: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost')"
echo "    Port 80 (HTTP) ve 443 (HTTPS, domain girildikten sonra) açıktır."
echo ""
echo "    Durdurmak: cd $INSTALL_DIR && $COMPOSE_CMD -f $COMPOSE_FILE down"
echo "    Güncellemek: cd $INSTALL_DIR && $COMPOSE_CMD -f $COMPOSE_FILE pull && $COMPOSE_CMD -f $COMPOSE_FILE up -d"
