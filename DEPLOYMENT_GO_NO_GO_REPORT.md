# White-Box Penetration Test Audit – Go / No-Go Report

**Scope:** server.js, Dockerfile, database interactions, runtime behaviour behind Nginx (SSL).  
**Purpose:** Verify production readiness for Docker + Nginx deployment.

---

## 1. Status Table

| # | Check | Verdict | Notes |
|---|--------|---------|--------|
| 1 | Reverse proxy (trust proxy) | **[PASS]** | `app.set('trust proxy', 1)` present before session (line 32). |
| 2 | CSP vs. Leaflet / map tiles | **[PASS]** | imgSrc: 'self', data:, *.tile.openstreetmap.org (http/https). connectSrc: 'self' + openstreetmap. scriptSrc includes https://unpkg.com for Leaflet.js. |
| 3 | Graceful shutdown (SIGTERM/SIGINT) | **[PASS]** | Handlers close HTTP server then pool; process exits. |
| 4 | Docker non-root | **[PASS]** | `adduser` node (uid 1001), `USER node`; app does not run as root. |
| 5a | Health endpoint | **[PASS]** | `GET /health` returns 200 OK (no auth). |
| 5b | Logs structured / no PII | **[PASS]** | Winston used; only generic messages (e.g. err.message, "Shutting down"); no credentials or session IDs logged. |

---

## 2. Reverse Proxy (Check 1)

**Finding:** Implemented.

**Code (server.js, before session):**
```javascript
app.set('trust proxy', 1);
```
Express trusts `X-Forwarded-Proto` from Nginx; `req.secure` is true over HTTPS and `cookie: { secure: true }` works. No fix required.

---

## 3. Content Security Policy (Check 2)

**Finding:** Implemented. Map tiles (img/connect) and Leaflet script (unpkg) are allowed.

**Relevant snippet (server.js):**
```javascript
contentSecurityPolicy: {
    directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://unpkg.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://unpkg.com"],
        imgSrc: ["'self'", "data:", "https://*.tile.openstreetmap.org", "http://*.tile.openstreetmap.org", "https://unpkg.com"],
        connectSrc: ["'self'", "https://*.tile.openstreetmap.org", "http://*.tile.openstreetmap.org"]
    }
}
```
- Tiles: imgSrc and connectSrc allow OpenStreetMap and data:.
- Leaflet: scriptSrc includes `https://unpkg.com` so `leaflet.js` from CDN loads. No fix required.

---

## 4. Graceful Shutdown (Check 3)

**Finding:** Implemented.

**Code (server.js, end of file):**
```javascript
const server = app.listen(port, () => { ... });

function shutdown() {
    logger.info('Shutting down...');
    server.close(() => {
        pool.end().then(() => {
            logger.info('Closed.');
            process.exit(0);
        }).catch((err) => {
            logger.error('Pool close error: ' + err.message);
            process.exit(1);
        });
    });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```
Server stops accepting connections, then pool is closed. No fix required.

---

## 5. Docker Non-Root (Check 4)

**Finding:** Implemented.

**Code (Dockerfile):**
```dockerfile
RUN addgroup -g 1001 -S node && \
    adduser -S node -u 1001 -G node
...
RUN mkdir -p /app/logs && chown -R node:node /app
...
USER node
CMD ["node", "server.js"]
```
Container runs as `node` (non-root). No fix required.

---

## 6. Health & Observability (Check 5)

**Health:** `GET /health` returns 200 (no auth), suitable for Docker healthcheck and load balancers.

**Logging:** Winston; log content is level + message (+ stack for errors); no user names, passwords, or session IDs in log calls. No fix required.

---

## 7. Curl Verification Plan

**Health and security headers (run against running app, e.g. localhost:3000):**

```bash
curl -sI http://localhost:3000/health
```

**Expected:**
- Status: `200 OK`
- Headers should include (among others): `X-Content-Type-Options`, `Content-Security-Policy`, and optionally `Strict-Transport-Security` if HSTS is enabled.

**Optional – show response body and status code only:**
```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/health
```
Expected: `HTTP 200`

---

## 8. Verdict

All listed checks are **[PASS]**. No configuration mismatches or missing code identified for the audited scope.

**READY FOR DEPLOYMENT** for the current codebase with Docker and Nginx (SSL), assuming:

- Session table exists in PostgreSQL (`scripts/SQL_MIGRATION_SESSION_TABLE.md`).
- Production `.env` has `NODE_ENV=production`, `SESSION_SECRET`, and correct DB and (if used) `CORS_ORIGIN` settings.
- Nginx is configured to set `X-Forwarded-Proto` (and optionally `X-Forwarded-For`) when proxying to the Node app.
