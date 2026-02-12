# Security Audit Report – Panel Envanter Web Application

**Benchmarks:** OWASP Top 10, SANS 25  
**Scope:** Full codebase (Node.js/Express backend, PostgreSQL, static frontend)

---

## PHASE 1: Reconnaissance & Architecture Analysis

### Project structure
- **Entry:** `server.js` (Express app, port 3000)
- **Static:** `public/` (index.html, login.html, setup.html, js/main.js, css/style.css)
- **Data:** PostgreSQL via `pg` (Pool); schema in `schema.sql` and `ensureSchema()` in server
- **Config:** `.env` (gitignored), `process.env` with fallbacks; nginx reverse proxy (SSL optional)

### Critical assets
| Asset | Location | Risk |
|-------|----------|------|
| **Authentication** | `server.js` (checkAuth, /api/login, session) | High – single admin, plaintext password in DB |
| **Setup / bootstrap** | `/api/complete-setup`, `app_config` table | High – first-run sets admin; no lock |
| **Panel CRUD** | `/api/panel-locations` GET/POST/DELETE | Medium – auth required but no rate limit |
| **Export** | `/api/export-csv` | Medium – full data export, no rate limit |
| **Session store** | express-session (default in-memory) | Medium – no httpOnly/secure/sameSite tuning |

### High-risk areas
1. **Auth module** – `server.js` (login, session, appConfig)
2. **Setup flow** – `server.js` (`/api/complete-setup`), `public/setup.html`
3. **Config storage** – `app_config` holds admin user/pass in **plaintext**
4. **Static routes** – checkAuth allows `/css/`, `/js/` without auth (needed for login page)

---

## PHASE 2: Authentication & Authorization

### Findings

| Issue | Severity | Description |
|-------|----------|-------------|
| **Plaintext password storage** | Critical | `admin_pass` stored in `app_config` as plaintext; compared with `===` on login. No hashing (e.g. bcrypt/argon2). |
| **Hardcoded / weak default secrets** | High | `SESSION_SECRET` default: `'panel-envanter-secret-change-in-prod'`. Default admin `admin`/`12345` if env not set. |
| **No password policy** | Medium | Setup accepts any password (length/complexity not enforced). |
| **Session cookie not hardened** | Medium | `cookie: { secure: false }` – cookie sent over HTTP; no explicit `sameSite` (CSRF risk). `httpOnly` left to express-session default (true). |
| **Single global admin** | Low | No RBAC; single admin can do everything. Acceptable for this app but no audit trail. |
| **Setup overwrite by authenticated admin** | Low | Logged-in admin can call `/api/complete-setup` and change admin credentials (no re-auth). |

### IDOR / BOLA
- **Panel locations:** Single tenant; any authenticated user can GET/POST/DELETE any record. No per-user isolation by design – **no IDOR** in multi-user sense.
- **Export:** Returns all panel_locations – consistent with single-admin model.

### Required actions
- Store password hash only (bcrypt or argon2); never store or log plaintext.
- Require strong `SESSION_SECRET` in production (no default secret).
- Enforce password policy on setup (min length, optional complexity).
- Set `cookie: { secure: true }` behind HTTPS, `sameSite: 'lax'` or `'strict'`.
- Optional: re-authentication or confirmation step before changing admin via setup.

---

## PHASE 3: Input Validation & Injection

### Findings

| Issue | Severity | Description |
|-------|----------|-------------|
| **No schema validation** | Medium | Request bodies not validated with Zod/Joi/etc. Reliance on ad-hoc checks and DB types. |
| **Input length / type bounds** | Medium | `location_name` and `note` length not enforced in app (DB has VARCHAR(200) for location_name). Very long `note` could cause large payloads/memory. `panel_count` capped via `Math.max(1, parseInt(..., 10) \|\| 1)` but no upper bound. |
| **DELETE id not validated** | Low | `req.params.id` passed to `pool.query('... WHERE id = $1', [id])`. Parameterized query prevents SQLi, but non-integer `id` can cause DB error and 500. Should validate integer and 404 on invalid. |
| **SQL injection** | None | All queries use parameterized placeholders (`$1`, `$2`, …). No concatenation of user input into SQL. |
| **XSS** | Mitigated | `main.js` uses `escapeHtml()` for `location_name` and `note` in popup content. `app-brand` and title set via `textContent` from API. No `innerHTML` with raw user data. |
| **NoSQL / command injection** | N/A | No NoSQL or shell commands with user input. |

### Required actions
- Add strict schema validation (e.g. Zod) for `/api/login`, `/api/complete-setup`, `/api/panel-locations` (body) and `/api/panel-locations/:id` (id: integer).
- Enforce max lengths (e.g. location_name ≤ 200, note ≤ 2000) and panel_count range (e.g. 1–10000).
- Validate `id` on DELETE (integer, > 0); return 400/404 for invalid id instead of 500.

---

## PHASE 4: Business Logic & Data Protection

### Findings

| Issue | Severity | Description |
|-------|----------|-------------|
| **No rate limiting** | High | `/api/login` and `/api/complete-setup` have no rate limit – brute force and setup abuse possible. |
| **Setup race** | Low | Concurrent first-time setup requests can overwrite each other; last write wins. Consider setup token or lock. |
| **Excessive data exposure** | None | API returns only needed fields (no password/hash in responses). `app_config` not exposed. |
| **CSRF** | Medium | No anti-CSRF tokens. Cookie without `sameSite` can be sent on cross-site POSTs. Fix: `sameSite: 'lax'` or `'strict'`. |
| **Export abuse** | Low | Authenticated user can repeatedly export full CSV; rate limiting recommended. |

### Required actions
- Add rate limiting (e.g. express-rate-limit) on `/api/login` (e.g. 5–10 req/15 min per IP) and on `/api/complete-setup` (stricter, e.g. 3/1 hour).
- Set session cookie `sameSite: 'lax'` (or `'strict'` if no cross-origin links).
- Optional: rate limit `/api/panel-locations` and `/api/export-csv` to prevent scraping/DoS.

---

## PHASE 5: Configuration & Headers

### Findings

| Issue | Severity | Description |
|-------|----------|-------------|
| **No security headers** | High | No Helmet (or equivalent). Missing: X-Content-Type-Options, X-Frame-Options, CSP, HSTS, etc. |
| **Error handling** | Low | API returns generic messages (`'Setup failed'`, `'DB Error'`). No stack trace to client. `console.error` used for server-side logging – acceptable. |
| **CORS** | Low | No explicit CORS middleware – browser same-origin only. If CORS added later, avoid `*` in production. |
| **Cookie secure flag** | Medium | `secure: false` – in production behind HTTPS should be `true`. |
| **Stack / env leak** | None | No `e.stack` or `process.env` sent to client. |

### Required actions
- Use Helmet (or manual headers): at least X-Content-Type-Options: nosniff, X-Frame-Options: DENY (or SAMEORIGIN), Content-Security-Policy (restrictive), Strict-Transport-Security when on HTTPS.
- In production (HTTPS): set `cookie.secure: true` and ensure HSTS is set (e.g. via nginx or Helmet).

---

## Summary: Vulnerability Count by Severity

| Severity | Count | Examples |
|----------|-------|----------|
| **Critical** | 1 | Plaintext admin password in DB |
| **High** | 4 | Default/weak session secret, no rate limiting on login/setup, no security headers |
| **Medium** | 5 | Session cookie (secure/sameSite), no password policy, no input schema/length, CSRF, cookie secure in prod |
| **Low** | 4 | DELETE id validation, setup race, export rate limit, CORS if ever added |

---

## Positive Notes
- Parameterized SQL throughout – no SQL injection.
- XSS mitigated in panel popups and app name display.
- No sensitive data in API responses; generic error messages to client.
- Auth required for all sensitive routes; public paths limited to login/setup and static assets needed for them.
