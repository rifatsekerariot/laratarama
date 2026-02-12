# Deployment Guide – Panel Envanter

This document describes how to deploy the application using Docker.

---

## Prerequisites

- Docker and Docker Compose on the target machine
- (Option B) Docker Hub account; replace `YOUR_DOCKER_USERNAME` in scripts and compose files with your username
- For HTTPS: Nginx config and certificates (e.g. Let’s Encrypt); set `DOMAIN_NAME` as needed

---

## Option A: Build on the server

Build the image on the same machine where you run Compose:

```bash
git clone <your-repo> && cd loratarama
docker-compose up -d db app
# Optional: add nginx and certbot for SSL
# docker-compose up -d
```

Access: `http://localhost:3000` (or via Nginx on 80/443).

---

## Option B: Deploy via Docker Hub

Use this when you want to **build the image on your machine**, push it to **Docker Hub**, and on the server only **pull and run** (no source code or build step on the server).

### 1. Replace the placeholder

In all of the following, replace **`YOUR_DOCKER_USERNAME`** with your actual Docker Hub username:

- `scripts/docker-publish.sh` (or set env `DOCKER_USERNAME`)
- `scripts/docker-publish.bat` (or set env `DOCKER_USERNAME`)
- `docker-compose.prod.yml` (in the `app` service `image:` line)

### 2. Build and push the image (your machine)

**Using the shell script (Linux/macOS/Git Bash):**

```bash
# Push as :latest (default)
./scripts/docker-publish.sh

# Push with a specific tag (e.g. v1.0.0)
./scripts/docker-publish.sh v1.0.0
```

Or via npm:

```bash
npm run docker:publish
# For a specific tag, run the script directly: ./scripts/docker-publish.sh v1.0.0
```

**Using the Windows batch file:**

```cmd
scripts\docker-publish.bat
REM Or: scripts\docker-publish.bat v1.0.0
```

**Docker login:** Ensure you are logged in to Docker Hub (`docker login`) so `docker push` succeeds.

### 3. On the production server

- Do **not** clone the full repo only to build. You need:
  - `docker-compose.prod.yml` (with `YOUR_DOCKER_USERNAME` replaced)
  - Optional but recommended: `nginx/conf.d/`, `schema.sql`, and certbot dirs if you use Nginx + SSL

**Start the stack (app + DB, optional Nginx):**

```bash
docker-compose -f docker-compose.prod.yml up -d
```

To run only app and database (e.g. no Nginx):

```bash
docker-compose -f docker-compose.prod.yml up -d db app
```

- The app service uses **only** the image from Docker Hub (`image: YOUR_DOCKER_USERNAME/panel-envanter:latest`). No `build: .` or source-code volume.
- Database data is stored in the `pgdata` volume; Nginx and certbot use the same volume mounts as in the original compose file.

### 4. Updating the app on the server

After you push a new image to Docker Hub:

```bash
docker-compose -f docker-compose.prod.yml pull app
docker-compose -f docker-compose.prod.yml up -d app
```

---

## GitHub Actions (CI/CD) – automatic push to Docker Hub

The workflow in **`.github/workflows/docker-publish.yml`** builds and pushes the image to Docker Hub on every push to the **`main`** branch.

**Required GitHub Secrets:**

| Secret             | Description                    |
|--------------------|--------------------------------|
| `DOCKER_USERNAME`  | Your Docker Hub username      |
| `DOCKER_PASSWORD`  | Your Docker Hub password/token |

**Setup:**

1. GitHub repo → **Settings** → **Secrets and variables** → **Actions**.
2. Add `DOCKER_USERNAME` and `DOCKER_PASSWORD`.
3. Push to `main`; the workflow will build and push `YOUR_DOCKER_USERNAME/panel-envanter:latest` (using the username from the secret).

On the server, run `docker-compose -f docker-compose.prod.yml pull app && docker-compose -f docker-compose.prod.yml up -d app` after each deploy, or use a cron/scheduler.

---

## Summary

| Method              | Build location   | Server action                          |
|---------------------|------------------|----------------------------------------|
| Option A            | On server        | `docker-compose up -d`                 |
| Option B (manual)   | Your machine     | `docker-compose -f docker-compose.prod.yml up -d` |
| Option B (CI/CD)    | GitHub Actions   | Pull and `up -d` after push to main    |

Replace **`YOUR_DOCKER_USERNAME`** everywhere before using Option B or the workflow.
