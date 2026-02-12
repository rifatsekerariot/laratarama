# SQL Migration: Session Table

Create the `session` table required by **connect-pg-simple** for persistent session storage. Run this **once** in your PostgreSQL database (psql, pgAdmin, DBeaver, or any SQL client).

---

## Exact command to run manually

Copy and paste the following block into your database tool and execute:

```sql
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL,
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  PRIMARY KEY ("sid")
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
```

---

## Single-line version (for CLI)

```sql
CREATE TABLE IF NOT EXISTS "session" ("sid" varchar NOT NULL, "sess" json NOT NULL, "expire" timestamp(6) NOT NULL, PRIMARY KEY ("sid")); CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
```

---

## Notes

- Table name must be `"session"` (with double quotes); column names `sid`, `sess`, `expire` are required by connect-pg-simple.
- `IF NOT EXISTS` makes the migration idempotent (safe to run multiple times).
- After running, restart the app so it uses the PostgreSQL session store instead of MemoryStore.
