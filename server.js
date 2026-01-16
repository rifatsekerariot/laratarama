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

const connectWithRetry = () => {
    console.log('⏳ Attempting to connect to PostgreSQL...');
    pool.connect().then(client => {
        console.log('✅ Connected to PostgreSQL Database');
        client.release();
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
    if (publicPaths.includes(req.path) || req.path.startsWith('/webhook/') || req.path.startsWith('/css/') || req.path.startsWith('/js/')) {
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

// Integrations (Webhooks)
app.post('/api/integrations', async (req, res) => {
    const { name, slug, script } = req.body;
    try {
        await pool.query('INSERT INTO integrations (name, endpoint_slug, decoder_script) VALUES ($1, $2, $3)', [name, slug, script]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Dynamic Webhook Handler (Public-ish, but managed)
app.post('/webhook/:slug', async (req, res) => {
    const { slug } = req.params;
    try {
        const result = await pool.query('SELECT decoder_script FROM integrations WHERE endpoint_slug = $1', [slug]);
        if (result.rows.length === 0) return res.status(404).send('Not Found');

        const parserFunc = new Function('payload', result.rows[0].decoder_script);
        let parsed;
        try { parsed = parserFunc(req.body); } catch (e) { return res.status(400).send('Decoder Error'); }

        if (parsed && parsed.latitude) {
            await pool.query('INSERT INTO measurements (gateway_id, rssi, snr, frequency, latitude, longitude) VALUES ($1,$2,$3,$4,$5,$6)',
                [parsed.gateway_id || 'gw', parsed.rssi || -120, parsed.snr || 0, parsed.frequency || 868, parsed.latitude, parsed.longitude]);
            res.send('OK');
        } else {
            res.status(200).send('No Location Data');
        }
    } catch (e) {
        console.error(e);
        res.status(500).send('Error');
    }
});

// Start
app.listen(port, () => {
    console.log(`ARIOT Server running on port ${port}`);
});
