-- =============================================================================
-- Migration: Set admin_pass to bcrypt hash (fix login after security refactor)
-- =============================================================================
-- Your app now expects admin_pass in app_config to be a bcrypt hash, not plaintext.
-- Run this ONCE if you have an existing plaintext password and cannot log in.
--
-- OPTION A: Reset to default password '12345' (bcrypt, 12 rounds)
--
-- >>> EXACT COMMAND TO RUN NOW IN YOUR DATABASE TOOL (copy-paste):
--
-- UPDATE app_config SET value = '$2a$12$olO5lM1HfTffwvz6nqNkbuUYJeGkIg/1tmtk2VXZKlSZiOsmoERLy' WHERE key = 'admin_pass';
--
-- After running: log in with your existing admin username and password: 12345
-- =============================================================================

UPDATE app_config
SET value = '$2a$12$olO5lM1HfTffwvz6nqNkbuUYJeGkIg/1tmtk2VXZKlSZiOsmoERLy'
WHERE key = 'admin_pass';

-- After running: log in with username (your existing admin_user) and password: 12345
-- Then change the password via Setup or a separate admin flow if available.

-- =============================================================================
-- OPTION B: Use a different password
-- Generate a new hash in your project directory, then run UPDATE with that hash:
--
--   node -e "console.log(require('bcryptjs').hashSync('YOUR_NEW_PASSWORD', 12))"
--
-- Then:
--   UPDATE app_config SET value = '<paste_hash_here>' WHERE key = 'admin_pass';
-- =============================================================================
