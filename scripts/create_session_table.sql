-- =============================================================================
-- Session table for connect-pg-simple (express-session PostgreSQL store)
-- Run this ONCE manually in your database before using the app with PG session.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL,
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  PRIMARY KEY ("sid")
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
