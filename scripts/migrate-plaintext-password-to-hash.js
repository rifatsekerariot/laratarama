/**
 * Migration: Convert plaintext admin_pass in app_config to bcrypt hash.
 * Run once if you had an existing deployment with plaintext passwords.
 *
 * Usage: node scripts/migrate-plaintext-password-to-hash.js
 * Requires: .env with DB_* and optional BCRYPT_ROUNDS (default 12)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'ariot',
    password: process.env.DB_PASSWORD || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432', 10)
});

async function run() {
    const client = await pool.connect();
    try {
        const r = await client.query("SELECT value FROM app_config WHERE key = 'admin_pass'");
        if (r.rows.length === 0) {
            console.log('No admin_pass in app_config. Nothing to migrate.');
            return;
        }
        const value = r.rows[0].value;
        if (!value || value.length < 10) {
            console.log('admin_pass empty or too short. Skipping.');
            return;
        }
        if (value.startsWith('$2') && value.length >= 59) {
            console.log('admin_pass already looks like a bcrypt hash. Skipping.');
            return;
        }
        const hash = await bcrypt.hash(value, BCRYPT_ROUNDS);
        await client.query("UPDATE app_config SET value = $1 WHERE key = 'admin_pass'", [hash]);
        console.log('Migrated plaintext admin_pass to bcrypt hash.');
    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
