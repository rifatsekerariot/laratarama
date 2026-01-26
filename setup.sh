#!/bin/bash

# Zero-touch setup script for AROIT
# Usage: ./setup.sh

set -e

echo "Starting AROIT Setup..."

# 1. Check & Install Docker
if ! [ -x "$(command -v docker)" ]; then
  echo "Docker is not installed. Installing..."
  curl -fsSL https://get.docker.com -o get-docker.sh
  sh get-docker.sh
  # Add current user to docker group
  sudo usermod -aG docker $USER
  echo "Docker installed. Please log out and back in to use Docker without sudo."
  echo "Or run 'newgrp docker' to continue in this session."
else
  echo "Docker is already installed."
fi

if ! [ -x "$(command -v docker-compose)" ]; then
    echo "Installing Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

# 2. Configuration
echo "Configuring deployment..."
read -p "Enter Domain Name (e.g., example.com): " DOMAIN
read -p "Enter Email for SSL (e.g., admin@example.com): " EMAIL

echo "Pulling latest images from GHCR..."
if ! docker-compose pull; then
    echo "Warning: Failed to pull images. If the repository is private, please run 'docker login ghcr.io' first."
    echo "Attempting to build locally as fallback..."
    docker-compose build
fi

# Create directories
mkdir -p nginx/conf.d
mkdir -p certbot/conf
mkdir -p certbot/www

# Write Nginx Config with placeholders replaced
cat > nginx/conf.d/default.conf <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    location / {
        proxy_pass http://app:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# 3. SSL Certificate Acquisition
# Check if certs exist
if [ ! -d "./certbot/conf/live/$DOMAIN" ]; then
    echo "SSL Certificates not found. requesting new certificate..."
    
    # Start temporary nginx for validation
    # modify default.conf to ONLY listen on 80 for now to avoid crash
    mv nginx/conf.d/default.conf nginx/conf.d/default.conf.bak
    cat > nginx/conf.d/default.conf <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
}
EOF
    
    echo "Starting Nginx for ACME challenge..."
    docker-compose up -d nginx
    
    echo "Running Certbot..."
    docker-compose run --rm --entrypoint "\
      certbot certonly --webroot -w /var/www/certbot \
      --email $EMAIL \
      -d $DOMAIN \
      --rsa-key-size 4096 \
      --agree-tos \
      --force-renewal" certbot
      
    echo "Restoring Nginx configuration..."
    mv nginx/conf.d/default.conf.bak nginx/conf.d/default.conf
    
    echo "Reloading Nginx with new certs..."
    docker-compose down
fi

# 4. Final Deployment
echo "Starting Application..."
docker-compose up -d

echo "Deployment Complete! Access configuration at https://$DOMAIN"
