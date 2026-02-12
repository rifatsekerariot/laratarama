# Security Verification Report & PoC Test Plan

**Role:** Lead QA Security Engineer  
**Purpose:** Verify security controls before deploy; provide runnable PoC tests.

---

# PART 1: STATIC CODE ANALYSIS (Line-by-Line Check)

## 1. Password Hashing

### 1.1 Hash before saving (Setup)

**Location:** `server.js` — setup handler uses the validated body, hashes the password, then writes only the hash to the DB.

- **Hash is created here (exact line):**
  ```js
  const hash = await bcrypt.hash(adminPass, BCRYPT_ROUNDS);
  ```
  **File:** `server.js`, **Line 268.**

- **Hash is stored (plaintext never written):**
  ```js
  await client.query('...', ['admin_pass', hash]);
  ```
  **File:** `server.js`, **Line 282.**  
  The variable `hash` is the bcrypt hash; `adminPass` (plaintext) is never passed to any query.

**Logic:** `adminPass` comes from `req.validated` (Zod `SetupSchema`). It is only used as input to `bcrypt.hash()`. The result `hash` is the only value written to `app_config` for key `admin_pass`.

### 1.2 bcrypt.compare during Login

**Exact line:**
```js
const match = user === appConfig.adminUser && await bcrypt.compare(pass, appConfig.adminPassHash);
```
**File:** `server.js`, **Line 245.**

**Logic:**  
- `pass` is from `req.validated` (LoginSchema).  
- `appConfig.adminPassHash` is loaded from DB in `loadAppConfig()` (line 139: `appConfig.adminPassHash = map['admin_pass']`).  
- Login succeeds only if username matches and `bcrypt.compare(pass, appConfig.adminPassHash)` is true. Plaintext is never compared; only the hash is stored and used.

---

## 2. Rate Limiting

### 2.1 Limiter applied to `/api/login`

**Relevant code:**

- **Strict limiter definition:**  
  **Lines 202–208:** `strictLimiter` is created with `max: 5`, `windowMs: 15 * 60 * 1000`.

- **Applied to route (route-specific, not global):**  
  **Line 239:**
  ```js
  app.post('/api/login', strictLimiter, validate(LoginSchema), async (req, res, next) => { ... });
  ```
  `strictLimiter` is the **first** middleware for this route, so it runs before validation and the handler.

**Conclusion:** Rate limiting is **route-specific**. Only `POST /api/login` and `POST /api/complete-setup` use `strictLimiter`. The 6th request within the same 15-minute window from the same client (IP) must return **429 Too Many Requests**.

### 2.2 General limiter

**Line 235:** `app.use('/api', generalLimiter);`  
All paths under `/api` go through `generalLimiter` (200 per 15 min) first. Then `/api/login` and `/api/complete-setup` also run `strictLimiter` (5 per 15 min). So for login/setup, the effective cap is the strict one (5).

---

## 3. Input Validation (Zod)

### 3.1 Unknown fields (`.strict()` or equivalent)

**Current behavior:**  
Schemas are defined with `z.object({ ... })` **without** `.strict()`.

- **Zod 3:** By default, `schema.parse(body)` **only returns keys defined in the schema**. So `req.validated` (and later the DB) never receives unknown keys. Unknown keys are effectively ignored, not rejected.
- **Strict mode:** Adding `.strict()` would make Zod **throw** if any extra key is present (entire request rejected with 400). That is stricter but not currently used.

**Evidence:**  
- **Line 175:** `req.validated = schema.parse(req.body);` — only the parsed (schema) keys are stored.  
- **Lines 282, 307:** Only `req.validated` (and for DELETE `req.validatedParams`) are used; no `req.body` or `req.params` are passed to queries.

**Conclusion:** Unknown fields are **not** sent to the DB (they are stripped by using only the parsed result). They are **not** rejected with 400 unless you add `.strict()`.

### 3.2 `panel_count` cannot be negative or a string

**Schema (exact lines):**
```js
panel_count: z.coerce.number().int().min(1).max(100000).default(1),
```
**File:** `server.js`, **Line 164.**

**Logic:**
- `z.coerce.number()` turns string `"5"` into number `5`; then `.int()` rejects decimals.
- `.min(1)` rejects zero and negatives (e.g. `-100` fails).
- `.max(100000)` caps the value.
- So `panel_count: -100` or `panel_count: "invalid"` (non-numeric) causes Zod to throw; the `validate()` middleware catches it and returns **400** with the error message (lines 177–180). The handler is never run with invalid data.

**Conclusion:** `panel_count` cannot be negative; non-numeric strings fail coercion; only 1–100000 is accepted.

---

## 4. Security Headers (Helmet)

**Placement:**  
**Lines 28–33:** `app.use(helmet({ ... }));` is registered **before** any route or `checkAuth`/static.

Order in file:
1. `app.use(helmet(...))`   (27–32)
2. `app.use(cors(...))`    (42)
3. `app.use(bodyParser...)` (44–45)
4. `app.use(session(...))` (53–65)
5. … DB, schemas, limiters …
6. `app.use(checkAuth)`    (233)
7. `app.use(express.static(...))` (234)
8. `app.use('/api', generalLimiter)` (235)
9. Route definitions (239+)

**Conclusion:** Helmet runs first; all responses (including static and API) get the configured security headers (CSP, HSTS, X-Content-Type-Options, X-Frame-Options, etc.).

---

# PART 2: DYNAMIC TEST SCRIPT (curl / Bash)

Assumptions: app runs at `http://localhost:3000`; replace with your base URL if different.

---

## Test 1: Security Headers

Check that `X-Content-Type-Options` and `Content-Security-Policy` (or other Helmet headers) are present.

```bash
curl -sI http://localhost:3000/
```

**Expected:** Response includes headers such as:
- `X-Content-Type-Options: nosniff`
- `Content-Security-Policy: ...`
- `X-Frame-Options: ...`

**Optional (only headers):**
```bash
curl -sI http://localhost:3000/ | grep -iE 'x-content-type|content-security|x-frame'
```

---

## Test 2: Rate Limiting (6th request = 429)

Send 6 login requests in a row; the 6th should return **429 Too Many Requests**.

**Bash (run in terminal):**
```bash
BASE="http://localhost:3000"
for i in $(seq 1 20); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/login" \
    -H "Content-Type: application/json" \
    -d '{"user":"admin","pass":"wrongpassword"}')
  echo "Request $i: HTTP $CODE"
  if [ "$CODE" = "429" ]; then
    echo ">>> Rate limit hit (429) as expected."
    break
  fi
done
```

**Expected:** First 5 requests return **401** (invalid credentials). The **6th** (and subsequent) return **429** with body like `{"error":"Too many attempts. Try again later."}`.

**Single 6th request (after you have already sent 5):**
```bash
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"user":"admin","pass":"x"}' 
```

---

## Test 3: Input Validation (400 for invalid payload)

Zod should reject bad payloads with **400 Bad Request**, not crash or accept.

**3a) Invalid login body (wrong shape / missing required):**
```bash
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"panel_count": -100}'
```
**Expected:** **400** and a Zod error message (e.g. username/password required). No 500.

**3b) Invalid panel payload (negative panel_count):**
Requires an active session (login first, then use cookie).

```bash
# Step 1: Login and save cookie (use real credentials after setup)
curl -s -c /tmp/cookies.txt -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"user":"admin","pass":"YourActualPassword"}'

# Step 2: Send invalid panel data (negative panel_count)
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST http://localhost:3000/api/panel-locations \
  -H "Content-Type: application/json" \
  -b /tmp/cookies.txt \
  -d '{"location_name":"Test","panel_count":-100,"latitude":41,"longitude":29}'
```
**Expected:** **400** with a Zod error (e.g. Number must be greater than or equal to 1). No 500, no row inserted.

**3c) Invalid panel payload (location_name as number):**
```bash
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST http://localhost:3000/api/panel-locations \
  -H "Content-Type: application/json" \
  -b /tmp/cookies.txt \
  -d '{"location_name":12345,"panel_count":1,"latitude":41,"longitude":29}'
```
**Expected:** **400** (Zod expects string for `location_name`). No 500.

---

## Test 4: SQL Injection (login field)

Prove that `' OR '1'='1` in the login field does not bypass auth and does not cause 500.

```bash
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"user":"'\'' OR '\''1'\''='\''1","pass":"x"}'
```

**Expected:** **401 Unauthorized** and `{"error":"Invalid credentials"}`. No 500, no successful login.  
Reason: login uses in-memory config and `bcrypt.compare`; no raw user input is concatenated into SQL.

---

## Optional: One-shot test script (Bash)

Save as `scripts/security-poc-tests.sh` and run: `bash scripts/security-poc-tests.sh`.

```bash
#!/usr/bin/env bash
set -e
BASE="${BASE_URL:-http://localhost:3000}"

echo "=== Test 1: Security headers ==="
curl -sI "$BASE/" | grep -iE 'x-content-type|content-security|x-frame' || true

echo ""
echo "=== Test 2: Rate limiting (6th = 429) ==="
for i in $(seq 1 6); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/login" \
    -H "Content-Type: application/json" \
    -d '{"user":"admin","pass":"x"}')
  echo "  Request $i: $CODE"
  [ "$CODE" = "429" ] && echo "  >>> 429 seen as expected." && break
done

echo ""
echo "=== Test 3a: Invalid login body (400) ==="
curl -s -w "\n  HTTP: %{http_code}\n" -X POST "$BASE/api/login" \
  -H "Content-Type: application/json" \
  -d '{"panel_count":-100}'

echo ""
echo "=== Test 4: SQL injection attempt (401, no 500) ==="
curl -s -w "\n  HTTP: %{http_code}\n" -X POST "$BASE/api/login" \
  -H "Content-Type: application/json" \
  -d '{"user":"'"'"' OR '"'"'1'"'"'='"'"'1","pass":"x"}'

echo ""
echo "=== Done ==="
```

---

# PART 3: CONFIGURATION CHECK (.env)

Variables the app uses and when it **exits** if missing:

| Variable          | Required to run? | When it matters |
|-------------------|------------------|------------------|
| **SESSION_SECRET**| **Yes in production** | `NODE_ENV=production` and missing `SESSION_SECRET` → app exits (lines 15–17, 49–51). |
| NODE_ENV          | No               | Set to `production` for prod; else dev defaults (e.g. dev session secret, CORS). |
| DB_HOST           | No (default)     | Default `localhost`. |
| DB_PORT           | No               | Default `5432`. |
| DB_NAME           | No               | Default `ariot`. |
| DB_USER           | No               | Default `postgres`. |
| DB_PASSWORD       | No               | Default `postgres`. |
| PORT              | No               | Default `3000`. |
| CORS_ORIGIN       | No               | Production: comma-separated origins, or unset for same-origin only. |
| BCRYPT_ROUNDS     | No               | Optional; default 12 (used in migration script). |

**Summary:**  
- **Development:** You can run with no `.env`; the app uses defaults and will not crash (dev secret is used).  
- **Production:** You **must** set `SESSION_SECRET` (and typically `NODE_ENV=production`). Without `SESSION_SECRET`, the process exits on startup.

**Minimal production `.env` example:**
```env
NODE_ENV=production
SESSION_SECRET=your-long-random-secret-at-least-32-chars
DB_HOST=...
DB_USER=...
DB_PASSWORD=...
DB_NAME=...
```

Use `env.example` in the repo as the full template.
