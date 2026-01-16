require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const path = require('path');

// 1. Error Handling (Global)
process.on('uncaughtException', (err) => {
    console.error('🔥 Critical Error (Uncaught):', err.message);
    console.error('Exiting process to trigger restart (e.g. via PM2).');
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
                latitude DOUBLE PRECISION,
                longitude DOUBLE PRECISION,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS saved_points (
                id SERIAL PRIMARY KEY,
                note TEXT,
                avg_rssi NUMERIC,
                avg_snr NUMERIC,
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
        // Run Migration
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
    // Don't exit immediately, let the reconnection logic (if any) or Docker restart handle it
    // But for pool 'error', usually the client is dead. 
    process.exit(-1);
});

// Mock/Fallback Variables (kept for reference logic if needed, but mostly strict now)
let useMock = false;
let activeSessions = {};

// 4. App Configuration & Setup Logic
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
        '/api/app-info',
        '/api/export-csv' // Allow public export? Or keep protected.
        // Let's keep export protected, but if user uses browser, they need session.
    ];

    // Check allowlist or prefixes
    if (publicPaths.includes(req.path) || req.path === '/webhook' || req.path.startsWith('/webhook/') || req.path.startsWith('/css/') || req.path.startsWith('/js/')) {
        return next();
    }

    // Auth Check
    if (!req.session.userId) {
        // If API call, return 401
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
        console.error(e);
        res.status(500).json({ error: 'Setup failed' });
    }
});

// CSV Export
app.get('/api/export-csv', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Unauthorized');

    try {
        const query = `
            SELECT 'live' as type, gateway_id, rssi, snr, latitude, longitude, created_at FROM measurements
            UNION ALL
            SELECT 'saved' as type, 'manual', avg_rssi, avg_snr, latitude, longitude, created_at FROM saved_points
        `;
        const result = await pool.query(query);
        const rows = result.rows.map(r => `${r.type},${r.gateway_id || 'manual'},${r.rssi},${r.snr},${r.latitude},${r.longitude},${r.created_at}`);

        const csvContent = "type,gateway,rssi,snr,latitude,longitude,timestamp\n" + rows.join("\n");
        res.header('Content-Type', 'text/csv');
        res.attachment('ariot_data.csv');
        res.send(csvContent);
    } catch (err) {
        console.error(err);
        res.status(500).send('DB Error');
    }
});

// Get All Data
app.get('/api/get-all-data', async (req, res) => {
    try {
        const query = `
            SELECT id, 'live' as type, rssi, snr, latitude, longitude, created_at 
            FROM measurements WHERE latitude IS NOT NULL
            UNION ALL
            SELECT id, 'saved' as type, avg_rssi as rssi, avg_snr as snr, latitude, longitude, created_at 
            FROM saved_points WHERE latitude IS NOT NULL
            ORDER BY created_at DESC
        `;
        const result = await pool.query(query);
        res.json(result.rows.map(r => ({
            ...r, rssi: parseFloat(r.rssi), snr: parseFloat(r.snr)
        })));
    } catch (err) {
        console.error(err);
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

    // DB Polling logic
    try {
        const startTime = activeSessions[sessionId].startTime;
        const result = await pool.query('SELECT rssi, snr FROM measurements WHERE created_at > $1 ORDER BY created_at ASC', [startTime]);
        const readings = result.rows.filter(r => !isNaN(parseFloat(r.rssi)));

        if (readings.length >= 3) {
            const avgRssi = readings.slice(0, 3).reduce((a, b) => a + parseFloat(b.rssi), 0) / 3;
            const avgSnr = readings.slice(0, 3).reduce((a, b) => a + parseFloat(b.snr), 0) / 3;
            delete activeSessions[sessionId];
            res.json({ status: 'complete', avg_rssi: avgRssi.toFixed(2), avg_snr: avgSnr.toFixed(2) });
        } else {
            res.json({ status: 'pending', count: readings.length, required: 3 });
        }
    } catch (e) {
        res.status(500).json({ error: 'Polling error' });
    }
});

app.post('/api/save-point', async (req, res) => {
    const { avg_rssi, avg_snr, lat, lng, note } = req.body;
    try {
        await pool.query('INSERT INTO saved_points (avg_rssi, avg_snr, latitude, longitude, note) VALUES ($1,$2,$3,$4,$5)',
            [avg_rssi, avg_snr, lat, lng, note || 'Manual']);
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
        console.error(err);
        res.status(500).json({ error: 'Save error' });
    }
});

// Integrations (Webhooks) - Management
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
        // Audit Log
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

// System Logs (Monitoring)
app.get('/api/system-logs', async (req, res) => {
    if (!req.session.userId) return res.status(401).send('Unauthorized');
    try {
        const result = await pool.query('SELECT * FROM system_logs ORDER BY created_at DESC LIMIT 50');
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: 'Fetch logs error' });
    }
});

// Dynamic Webhook Handler
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

        // Validation: We need at least Lat/Lng to save a point.
        // We also now check/save spreading_factor
        if (parsed && (parsed.latitude || parsed.lat) && (parsed.longitude || parsed.lng || parsed.lon)) {
            const lat = parsed.latitude || parsed.lat;
            const lng = parsed.longitude || parsed.lng || parsed.lon;
            const sf = parsed.spreadingFactor || parsed.sf || parsed.spreading_factor || null; // Support multiple naming conventions

            await pool.query('INSERT INTO measurements (gateway_id, rssi, snr, frequency, spreading_factor, latitude, longitude) VALUES ($1,$2,$3,$4,$5,$6, $7)',
                [parsed.gateway_id || 'gw', parsed.rssi || -120, parsed.snr || 0, parsed.frequency || 868, sf, lat, lng]);

            await pool.query("INSERT INTO system_logs (source, level, message, details) VALUES ('webhook', 'info', 'Data Processed Successfully', $1)",
                [JSON.stringify({ ...loggingContext, parsed })]);

            res.send('OK');
        } else {
            // Log the FAIL with full payload so user can see WHY it failed (missing lat/lon)
            await pool.query("INSERT INTO system_logs (source, level, message, details) VALUES ('webhook', 'warn', 'Skipped: No Location Data', $1)",
                [JSON.stringify({ ...loggingContext, reason: 'Latitude/Longitude missing in parsed output' })]);
            res.status(200).send('No Location Data');
        }
    } catch (e) {
        console.error(e);
        await pool.query("INSERT INTO system_logs (source, level, message, details) VALUES ('webhook', 'error', 'System Error', $1)",
            [JSON.stringify({ ...loggingContext, error: e.message })]);
        res.status(500).send('Error');
    }
};

// Root Webhook Handler (Fallback for /webhook)
// Looks for an integration named 'webhook' or 'default' or 'chirpstack'
app.post('/webhook', async (req, res) => {
    // Try to find a logical default
    try {
        // Preference order: 'webhook' -> 'chirpstack' -> 'default' -> First available
        const result = await pool.query("SELECT endpoint_slug FROM integrations WHERE endpoint_slug IN ('webhook', 'chirpstack', 'default') ORDER BY CASE endpoint_slug WHEN 'webhook' THEN 1 WHEN 'chirpstack' THEN 2 ELSE 3 END LIMIT 1");

        if (result.rows.length > 0) {
            return processWebhook(result.rows[0].endpoint_slug, req, res);
        } else {
            // No matching default, log warning
            await pool.query("INSERT INTO system_logs (source, level, message, details) VALUES ('webhook', 'warn', 'Root Webhook Hit but No Default Integration Found', $1)", [JSON.stringify(req.body)]);
            res.status(404).send('No integration configured for root /webhook. Please create an integration with slug "webhook" or "chirpstack".');
        }
    } catch (e) {
        res.status(500).send('System Error');
    }
});

app.post('/webhook/:slug', async (req, res) => {
    processWebhook(req.params.slug, req, res);
});

// Start
app.listen(port, () => {
    console.log(`ARIOT Server running on port ${port}`);
});
