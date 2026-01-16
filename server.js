require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const path = require('path');

// 1. Error Handling (Global)
process.on('uncaughtException', (err) => {
    console.error('🔥 Critical Error (Uncaught):', err.message);
    process.exit(1);
});

const app = express();
const port = process.env.PORT || 3001;

// 2. Middleware Configuration
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'ariot-secret-key-change-in-prod',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// 3. Database Connection
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'ariot',
    password: process.env.DB_PASSWORD || 'postgres',
    port: process.env.DB_PORT || 5432,
});

async function ensureSchema() {
    try {
        console.log('🔧 Verifying Database Schema...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS measurements (
                id SERIAL PRIMARY KEY,
                gateway_id VARCHAR(50),
                rssi NUMERIC,
                snr NUMERIC,
                frequency NUMERIC,
                spreading_factor NUMERIC,
                latitude DOUBLE PRECISION,
                longitude DOUBLE PRECISION,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS saved_points (
                id SERIAL PRIMARY KEY,
                note TEXT,
                avg_rssi NUMERIC,
                avg_snr NUMERIC,
                spreading_factor NUMERIC,
                latitude DOUBLE PRECISION,
                longitude DOUBLE PRECISION,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS planned_gateways (
                id SERIAL PRIMARY KEY,
                latitude DOUBLE PRECISION,
                longitude DOUBLE PRECISION,
                radius NUMERIC,
                frequency NUMERIC,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS app_config (
                key VARCHAR(50) PRIMARY KEY,
                value TEXT
            );
            CREATE TABLE IF NOT EXISTS integrations (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100),
                endpoint_slug VARCHAR(50) UNIQUE,
                decoder_script TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS system_logs (
                id SERIAL PRIMARY KEY,
                source VARCHAR(50),
                level VARCHAR(20),
                message TEXT,
                details JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Migrations for existing tables (safe to run always)
        await pool.query(`
            ALTER TABLE saved_points ADD COLUMN IF NOT EXISTS spreading_factor NUMERIC;
            ALTER TABLE measurements ADD COLUMN IF NOT EXISTS spreading_factor NUMERIC;
        `);

        console.log('✅ Schema Verified. Tables are ready.');
    } catch (e) {
        console.error('❌ Schema Sync Failed:', e.message);
    }
}

const connectWithRetry = () => {
    console.log('⏳ Attempting to connect to PostgreSQL...');
    pool.connect().then(async (client) => {
        console.log('✅ Connected to PostgreSQL Database');
        client.release();
        await ensureSchema();
    }).catch(err => {
        console.error('❌ Connection Failed:', err.message);
        console.log('🔄 Retrying in 5 seconds...');
        setTimeout(connectWithRetry, 5000);
    });
};

connectWithRetry();

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

// State
let activeSessions = {};
let appConfig = {
    configured: false,
    appName: 'ARIOT Platform',
    adminUser: process.env.ADMIN_USER || 'admin',
    adminPass: process.env.ADMIN_PASS || '12345'
};

async function loadAppConfig() {
    try {
        const result = await pool.query('SELECT key, value FROM app_config');
        if (result.rows.length > 0) {
            const configMap = {};
            result.rows.forEach(r => configMap[r.key] = r.value);
            if (configMap['is_configured'] === 'true') {
                appConfig.configured = true;
                appConfig.appName = configMap['app_name'];
                appConfig.adminUser = configMap['admin_user'];
                appConfig.adminPass = configMap['admin_pass'];
            }
        }
    } catch (e) {
        console.warn('Config load failed:', e.message);
    }
}
setTimeout(loadAppConfig, 1000);

// 5. Auth & Protection Middleware
const checkAuth = (req, res, next) => {
    // Check Setup
    if (!appConfig.configured) {
        if (req.path === '/setup.html' || req.path === '/api/complete-setup' || req.path.startsWith('/css/') || req.path.startsWith('/js/')) {
            return next();
        }
        return res.redirect('/setup.html');
    }

    // Public Allowlist
    const publicPaths = [
        '/login.html',
        '/setup.html',
        '/api/login',
        '/api/app-info'
    ];

    // Check allowlist or prefixes
    if (publicPaths.includes(req.path) || req.path === '/webhook' || req.path.startsWith('/webhook/') || req.path.startsWith('/css/') || req.path.startsWith('/js/')) {
        return next();
    }

    // Auth Check
    if (!req.session.userId) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        return res.redirect('/login.html');
    }
    next();
};
app.use(checkAuth);

// 6. Static Files
app.use(express.static(path.join(__dirname, 'public')));


// --- API ROUTES ---

// Auth
app.post('/api/login', (req, res) => {
    const { user, pass } = req.body;
    if (user === appConfig.adminUser && pass === appConfig.adminPass) {
        req.session.userId = user;
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

// Setup
app.get('/api/app-info', (req, res) => {
    res.json({ name: appConfig.appName, configured: appConfig.configured });
});
app.post('/api/complete-setup', async (req, res) => {
    const { appName, adminUser, adminPass } = req.body;
    try {
        await pool.query('INSERT INTO app_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['app_name', appName]);
        await pool.query('INSERT INTO app_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['admin_user', adminUser]);
        await pool.query('INSERT INTO app_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['admin_pass', adminPass]);
        await pool.query('INSERT INTO app_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['is_configured', 'true']);
        await loadAppConfig();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Setup failed' });
    }
});

// CSV Export
app.get('/api/export-csv', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Unauthorized');
    try {
        const query = `
            SELECT 'live' as type, gateway_id, rssi, snr, spreading_factor, latitude, longitude, created_at FROM measurements
            UNION ALL
            SELECT 'saved' as type, 'manual', avg_rssi, avg_snr, spreading_factor, latitude, longitude, created_at FROM saved_points
        `;
        const result = await pool.query(query);
        const rows = result.rows.map(r => `${r.type},${r.gateway_id || 'manual'},${r.rssi},${r.snr},${r.spreading_factor || ''},${r.latitude},${r.longitude},${r.created_at}`);

        const csvContent = "type,gateway,rssi,snr,sf,latitude,longitude,timestamp\n" + rows.join("\n");
        res.header('Content-Type', 'text/csv');
        res.attachment('ariot_data.csv');
        res.send(csvContent);
    } catch (err) {
        res.status(500).send('DB Error');
    }
});

// Get All Data
app.get('/api/get-all-data', async (req, res) => {
    try {
        const query = `
            SELECT id, 'live' as type, rssi, snr, spreading_factor, latitude, longitude, created_at 
            FROM measurements WHERE latitude IS NOT NULL
            UNION ALL
            SELECT id, 'saved' as type, avg_rssi as rssi, avg_snr as snr, spreading_factor, latitude, longitude, created_at 
            FROM saved_points WHERE latitude IS NOT NULL
            ORDER BY created_at DESC
        `;
        const result = await pool.query(query);
        res.json(result.rows.map(r => ({
            ...r, rssi: parseFloat(r.rssi), snr: parseFloat(r.snr)
        })));
    } catch (err) {
        res.status(500).json({ error: 'DB Error' });
    }
});

// Session Actions
app.get('/api/start-session', (req, res) => {
    const sessionId = req.session.userId;
    activeSessions[sessionId] = { startTime: new Date(), count: 0, samples: [] };
    res.json({ status: 'started' });
});

app.get('/api/poll-session', async (req, res) => {
    const sessionId = req.session.userId;
    if (!activeSessions[sessionId]) return res.status(400).json({ error: 'No active session' });

    try {
        // Find NEW measurements (regardless of location)
        const startTime = activeSessions[sessionId].startTime;
        const result = await pool.query('SELECT rssi, snr, spreading_factor as sf FROM measurements WHERE created_at > $1 ORDER BY created_at ASC', [startTime]);

        const readings = result.rows.filter(r => r.rssi !== null && !isNaN(parseFloat(r.rssi)));

        if (readings.length >= 3) { // Require 3 data points
            const avgRssi = readings.slice(0, 3).reduce((a, b) => a + parseFloat(b.rssi), 0) / 3;
            const avgSnr = readings.slice(0, 3).reduce((a, b) => a + parseFloat(b.snr), 0) / 3;
            const avgSf = readings[0].sf || 7;

            delete activeSessions[sessionId];
            res.json({ status: 'complete', avg_rssi: avgRssi.toFixed(2), avg_snr: avgSnr.toFixed(2), sf: avgSf });
        } else {
            res.json({ status: 'pending', count: readings.length, required: 3 });
        }
    } catch (e) {
        res.status(500).json({ error: 'Polling error' });
    }
});

app.post('/api/save-point', async (req, res) => {
    const { avg_rssi, avg_snr, sf, lat, lng, note } = req.body;
    try {
        await pool.query('INSERT INTO saved_points (avg_rssi, avg_snr, spreading_factor, latitude, longitude, note) VALUES ($1,$2,$3,$4,$5,$6)',
            [avg_rssi, avg_snr, sf || 7, lat, lng, note || 'Manual']);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Save failed' });
    }
});

// Planner Save
app.post('/api/save-scenario', async (req, res) => {
    const { gateways } = req.body;
    if (!gateways || !Array.isArray(gateways)) return res.status(400).send('Invalid data');
    try {
        for (const g of gateways) {
            await pool.query('INSERT INTO planned_gateways (latitude, longitude, radius, frequency) VALUES ($1, $2, $3, $4)', [g.lat, g.lng, g.radius, g.freq]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Save error' });
    }
});

// Integrations - Management
app.get('/api/integrations', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Unauthorized');
    try {
        const result = await pool.query('SELECT id, name, endpoint_slug, created_at FROM integrations ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: 'Fetch error' });
    }
});

app.post('/api/integrations', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Unauthorized');
    const { name, slug, script } = req.body;
    try {
        await pool.query('INSERT INTO integrations (name, endpoint_slug, decoder_script) VALUES ($1, $2, $3)', [name, slug, script]);
        await pool.query("INSERT INTO system_logs (source, level, message, details) VALUES ('system', 'info', 'Integration Created', $1)", [JSON.stringify({ name, slug })]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/integrations/:id', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Unauthorized');
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM integrations WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Delete failed' });
    }
});

app.get('/api/system-logs', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Unauthorized');
    try {
        const result = await pool.query('SELECT * FROM system_logs ORDER BY created_at DESC LIMIT 50');
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: 'Fetch logs error' });
    }
});

// Dynamic Webhook Handler Logic
const processWebhook = async (slug, req, res) => {
    const loggingContext = { slug, payload: req.body };

    try {
        const result = await pool.query('SELECT decoder_script FROM integrations WHERE endpoint_slug = $1', [slug]);
        if (result.rows.length === 0) {
            await pool.query("INSERT INTO system_logs (source, level, message, details) VALUES ('webhook', 'warn', 'Endpoint Not Found', $1)", [JSON.stringify(loggingContext)]);
            return res.status(404).send('Not Found');
        }

        const parserFunc = new Function('payload', result.rows[0].decoder_script);
        let parsed;
        try {
            parsed = parserFunc(req.body);
        } catch (e) {
            await pool.query("INSERT INTO system_logs (source, level, message, details) VALUES ('webhook', 'error', 'Decoder Script Failed', $1)",
                [JSON.stringify({ ...loggingContext, error: e.message })]);
            return res.status(400).send('Decoder Error');
        }

        // Logic: Accept NULL location so we can save RSSI/SNR/SF for "Drive Test Mode"
        const lat = parsed.latitude || parsed.lat || null;
        const lng = parsed.longitude || parsed.lng || parsed.lon || null;
        const sf = parsed.spreadingFactor || parsed.sf || parsed.spreading_factor || null;
        const rssi = parsed.rssi || -120;
        const snr = parsed.snr || 0;

        await pool.query('INSERT INTO measurements (gateway_id, rssi, snr, frequency, spreading_factor, latitude, longitude) VALUES ($1,$2,$3,$4,$5,$6, $7)',
            [parsed.gateway_id || 'gw', rssi, snr, parsed.frequency || 868, sf, lat, lng]);

        const logMsg = (lat && lng) ? 'Data Processed Successfully' : 'Data Received (Waiting for Location Fix)';
        await pool.query("INSERT INTO system_logs (source, level, message, details) VALUES ('webhook', 'info', $1, $2)",
            [logMsg, JSON.stringify({ ...loggingContext, parsed })]);

        res.send('OK');
    } catch (e) {
        console.error(e);
        await pool.query("INSERT INTO system_logs (source, level, message, details) VALUES ('webhook', 'error', 'System Error', $1)",
            [JSON.stringify({ ...loggingContext, error: e.message })]);
        res.status(500).send('Error');
    }
};

// Default /webhook
app.post('/webhook', async (req, res) => {
    try {
        const result = await pool.query("SELECT endpoint_slug FROM integrations WHERE endpoint_slug IN ('webhook', 'chirpstack', 'default') ORDER BY CASE endpoint_slug WHEN 'webhook' THEN 1 WHEN 'chirpstack' THEN 2 ELSE 3 END LIMIT 1");
        if (result.rows.length > 0) {
            return processWebhook(result.rows[0].endpoint_slug, req, res);
        } else {
            await pool.query("INSERT INTO system_logs (source, level, message, details) VALUES ('webhook', 'warn', 'Root Webhook Hit but No Default Integration Found', $1)", [JSON.stringify(req.body)]);
            res.status(404).send('No integration configured for /webhook');
        }
    } catch (e) {
        res.status(500).send('System Error');
    }
});

// Specific /webhook/:slug
app.post('/webhook/:slug', async (req, res) => {
    processWebhook(req.params.slug, req, res);
});

// Start
app.listen(port, () => {
    console.log(`ARIOT Server running on port ${port}`);
});
