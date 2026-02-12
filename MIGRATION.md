# Migration Guide (Security Hardening)

## New installations

No migration needed. Run the app; complete setup once. Passwords are stored as bcrypt hashes.

## Existing installations (plaintext admin password)

If you deployed before the security refactor, `app_config.admin_pass` may be stored in **plaintext**. The app now expects a **bcrypt hash**. You must run the migration once:

1. Stop the app (or run migration during a maintenance window).
2. From the project root, with `.env` configured:
   ```bash
   node scripts/migrate-plaintext-password-to-hash.js
   ```
3. Restart the app. Log in with the **same** password as before (it is now compared via bcrypt after being hashed and stored).

The script skips if `admin_pass` is already a bcrypt hash (e.g. after a fresh setup).

## Database reset (optional)

If you prefer to start over instead of migrating:

1. Drop and recreate the database (or delete the `app_config` and optionally `panel_locations` data).
2. Run the app; the schema is created automatically. Open `/setup.html` and complete setup again.
3. Use a new admin password (min 8 characters).

## Environment

Copy `env.example` to `.env` and set at least:

- **Production:** `NODE_ENV=production`, `SESSION_SECRET` (long random string, e.g. 32+ chars).
- **Database:** `DB_*` as needed.
- **CORS (if needed):** `CORS_ORIGIN=https://yourdomain.com` (comma-separated for multiple).

Without `SESSION_SECRET` in production, the app will exit on startup.
