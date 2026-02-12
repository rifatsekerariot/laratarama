require('dotenv').config();
const logger = require('./logger');

const express = require('express');
const session = require('express-session');
const connectPGSimple = require('connect-pg-simple');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { z } = require('zod');

// --- Production: require critical env (crash if missing) ---
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && !process.env.SESSION_SECRET) {
    logger.error('FATAL: SESSION_SECRET is required in production. Set it in .env');
    process.exit(1);
}

process.on('uncaughtException', (err) => {
    logger.error('Critical Error: ' + err.message);
    process.exit(1);
});

const app = express();
const port = process.env.PORT || 3000;

// --- Trust proxy (required behind Nginx/reverse proxy for secure cookies) ---
app.set('trust proxy', 1);

// --- Security headers ---
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://unpkg.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://unpkg.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://unpkg.com"],
            imgSrc: ["'self'", "data:", "https://*.tile.openstreetmap.org", "http://*.tile.openstreetmap.org", "https://unpkg.com"],
            connectSrc: ["'self'", "https://*.tile.openstreetmap.org", "http://*.tile.openstreetmap.org"]
        }
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}));

// --- CORS: strict (no * in production) ---
const corsOptions = {
    origin: isProduction
        ? (process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : false)
        : true,
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

app.use(bodyParser.json({ limit: '100kb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '100kb' }));

// --- Health check (for Docker / load balancers; no auth) ---
app.get('/health', (req, res) => res.status(200).send('OK'));

// --- Database (must exist before session store) ---
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'ariot',
    password: process.env.DB_PASSWORD || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432', 10)
});

// --- Session (PostgreSQL store via connect-pg-simple) ---
const sessionSecret = process.env.SESSION_SECRET || (isProduction ? null : 'dev-secret-do-not-use-in-prod');
if (isProduction && !sessionSecret) {
    logger.error('FATAL: SESSION_SECRET required');
    process.exit(1);
}
const PGStore = connectPGSimple(session);
const sessionStore = new PGStore({
    pool,
    tableName: 'session'
});
app.use(session({
    store: sessionStore,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    name: 'sid',
    cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

const BCRYPT_ROUNDS = 12;

async function ensureSchema() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS app_config (
                key VARCHAR(50) PRIMARY KEY,
                value TEXT
            );
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS panel_locations (
                id SERIAL PRIMARY KEY,
                location_name VARCHAR(200) NOT NULL,
                panel_count INTEGER NOT NULL DEFAULT 1,
                latitude DOUBLE PRECISION NOT NULL,
                longitude DOUBLE PRECISION NOT NULL,
                note TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await pool.query(`INSERT INTO app_config (key, value) VALUES ('is_configured', 'false') ON CONFLICT (key) DO NOTHING`);
        logger.info('Schema OK.');
    } catch (e) {
        logger.error('Schema Failed: ' + e.message);
    }
}

// --- Caddy Admin API: push config for zero-touch SSL ---
const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL || 'http://caddy:2019';

function buildCaddyConfig(domainName) {
    const servers = {
        default: {
            listen: [':80'],
            routes: [{
                handle: [{
                    handler: 'reverse_proxy',
                    upstreams: [{ dial: 'app:3000' }]
                }]
            }]
        }
    };
    if (domainName) {
        servers.domain = {
            listen: [`https://${domainName}`],
            routes: [{
                handle: [{
                    handler: 'reverse_proxy',
                    upstreams: [{ dial: 'app:3000' }]
                }]
            }]
        };
    }
    return { apps: { http: { servers } } };
}

async function updateCaddyConfig(domainName) {
    const url = `${CADDY_ADMIN_URL.replace(/\/$/, '')}/load`;
    try {
        const config = buildCaddyConfig(domainName);
        await axios.post(url, config, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000,
            validateStatus: () => true
        });
        logger.info('Caddy config updated' + (domainName ? ` for ${domainName}` : ' (default :80 only)'));
    } catch (e) {
        logger.warn('Caddy config update failed: ' + (e.message || e.response?.data));
    }
}

const connectWithRetry = () => {
    pool.connect().then(async (client) => {
        client.release();
        await ensureSchema();
        logger.info('Connected to PostgreSQL');
    }).catch(err => {
        logger.error('DB Connection Failed: ' + err.message);
        setTimeout(connectWithRetry, 5000);
    });
};
connectWithRetry();

pool.on('error', (err) => {
    logger.error('Pool error: ' + err.message);
    process.exit(-1);
});

let appConfig = {
    configured: false,
    appName: 'Panel Envanter',
    adminUser: null,
    adminPassHash: null
};

async function loadAppConfig() {
    try {
        const result = await pool.query('SELECT key, value FROM app_config');
        const map = {};
        result.rows.forEach(r => { map[r.key] = r.value; });
        if (map['is_configured'] === 'true') {
            appConfig.configured = true;
            appConfig.appName = map['app_name'] || appConfig.appName;
            appConfig.adminUser = map['admin_user'] || null;
            appConfig.adminPassHash = map['admin_pass'] || null;
        }
    } catch (e) {
        logger.warn('Config load failed: ' + e.message);
    }
}
setTimeout(loadAppConfig, 1000);

// --- Zod schemas (strict: reject unknown keys with 400) ---
const LoginSchema = z.object({
    user: z.string().min(1, 'Username required').max(50).trim(),
    pass: z.string().min(1, 'Password required').max(500)
}).strict();

const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/;
const SetupSchema = z.object({
    appName: z.string().min(1).max(100).trim(),
    adminUser: z.string().min(1).max(50).trim(),
    adminPass: z.string().min(8, 'Password must be at least 8 characters').max(500),
    domainName: z.string().max(253).trim().optional()
        .refine(v => v === undefined || v === '' || hostnameRegex.test(v), 'Invalid hostname format')
        .transform(v => (v === '' ? undefined : v))
}).strict();

const PanelSchema = z.object({
    location_name: z.string().min(1).max(200).trim(),
    panel_count: z.coerce.number().int().min(1).max(100000).default(1),
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    note: z.string().max(2000).trim().nullable().optional().transform(v => v === '' ? null : v)
}).strict();

const IdParamSchema = z.object({
    id: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive())
});

function validate(schema) {
    return (req, res, next) => {
        try {
            req.validated = schema.parse(req.body);
            next();
        } catch (err) {
            if (err instanceof z.ZodError) {
                const msg = err.errors.map(e => e.message).join('; ');
                return res.status(400).json({ error: msg });
            }
            next(err);
        }
    };
}

function validateParams(schema) {
    return (req, res, next) => {
        try {
            req.validatedParams = schema.parse(req.params);
            next();
        } catch (err) {
            if (err instanceof z.ZodError) {
                return res.status(400).json({ error: 'Invalid id' });
            }
            next(err);
        }
    };
}

// --- Rate limiters ---
const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Too many attempts. Try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: 'Too many requests.' },
    standardHeaders: true,
    legacyHeaders: false
});

// --- Auth middleware ---
const checkAuth = (req, res, next) => {
    if (!appConfig.configured) {
        const allowed = ['/setup.html', '/api/complete-setup', '/css/', '/js/'];
        if (allowed.some(p => req.path === p || req.path.startsWith(p))) return next();
        return res.redirect('/setup.html');
    }
    const publicPaths = ['/login.html', '/setup.html', '/api/login', '/api/app-info', '/api/logout'];
    if (publicPaths.includes(req.path) || req.path.startsWith('/css/') || req.path.startsWith('/js/')) return next();
    if (!req.session.userId) {
        if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
        return res.redirect('/login.html');
    }
    next();
};

app.use(checkAuth);
app.use(express.static(path.join(__dirname, 'public')));

// --- API (apply general limiter to /api) ---
app.use('/api', generalLimiter);

// --- Login (strict limit + validation + bcrypt) ---
app.post('/api/login', strictLimiter, validate(LoginSchema), async (req, res, next) => {
    try {
        const { user, pass } = req.validated;
        if (!appConfig.adminUser || !appConfig.adminPassHash) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const match = user === appConfig.adminUser && await bcrypt.compare(pass, appConfig.adminPassHash);
        if (match) {
            req.session.userId = user;
            return res.json({ success: true });
        }
        res.status(401).json({ error: 'Invalid credentials' });
    } catch (e) {
        next(e);
    }
});

app.get('/api/app-info', (req, res) => {
    res.json({ name: appConfig.appName, configured: appConfig.configured });
});

// --- Logout (strict limit to prevent DoS on session destruction) ---
app.post('/api/logout', strictLimiter, (req, res) => {
    req.session.destroy((err) => {
        if (err) return res.status(500).json({ error: 'Internal Server Error' });
        res.clearCookie('sid', { path: '/', httpOnly: true, secure: isProduction, sameSite: 'strict' });
        res.json({ success: true });
    });
});

// --- Setup (strict limit + validation + hash + race protection) ---
app.post('/api/complete-setup', strictLimiter, validate(SetupSchema), async (req, res, next) => {
    const { appName, adminUser, adminPass, domainName } = req.validated;
    const client = await pool.connect();
    try {
        const existing = await client.query('SELECT value FROM app_config WHERE key = $1', ['is_configured']);
        if (existing.rows[0]?.value === 'true') {
            return res.status(409).json({ error: 'Already configured' });
        }
        const hash = await bcrypt.hash(adminPass, BCRYPT_ROUNDS);
        await client.query('BEGIN');
        const updated = await client.query(
            `UPDATE app_config SET value = 'true' WHERE key = 'is_configured' AND value = 'false' RETURNING key`
        );
        if (updated.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Already configured' });
        }
        await client.query('INSERT INTO app_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['app_name', appName]);
        await client.query('INSERT INTO app_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['admin_user', adminUser]);
        await client.query('INSERT INTO app_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['admin_pass', hash]);
        if (domainName) {
            await client.query('INSERT INTO app_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['domain_name', domainName]);
        }
        await client.query('COMMIT');
        await loadAppConfig();
        await updateCaddyConfig(domainName || null);
        res.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        next(e);
    } finally {
        client.release();
    }
});

// --- Panel locations ---
app.get('/api/panel-locations', async (req, res, next) => {
    try {
        const result = await pool.query('SELECT id, location_name, panel_count, latitude, longitude, note, created_at FROM panel_locations ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (e) {
        next(e);
    }
});

app.post('/api/panel-locations', validate(PanelSchema), async (req, res, next) => {
    try {
        const { location_name, panel_count, latitude, longitude, note } = req.validated;
        await pool.query(
            'INSERT INTO panel_locations (location_name, panel_count, latitude, longitude, note) VALUES ($1, $2, $3, $4, $5)',
            [location_name, panel_count, latitude, longitude, note ?? null]
        );
        res.json({ success: true });
    } catch (e) {
        next(e);
    }
});

app.delete('/api/panel-locations/:id', validateParams(IdParamSchema), async (req, res, next) => {
    try {
        const { id } = req.validatedParams;
        const result = await pool.query('DELETE FROM panel_locations WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Not found' });
        }
        res.json({ success: true });
    } catch (e) {
        next(e);
    }
});

app.get('/api/export-csv', strictLimiter, async (req, res, next) => {
    if (!req.session.userId) return res.status(401).send('Unauthorized');
    try {
        const result = await pool.query('SELECT location_name, panel_count, latitude, longitude, note, created_at FROM panel_locations ORDER BY created_at DESC');
        const header = 'Konum Adı,Panel Sayısı,Enlem,Boylam,Not,Tarih\n';
        const rows = result.rows.map(r =>
            `"${(r.location_name || '').replace(/"/g, '""')}",${r.panel_count},${r.latitude},${r.longitude},"${(r.note || '').replace(/"/g, '""')}",${r.created_at}`
        );
        res.header('Content-Type', 'text/csv; charset=utf-8');
        res.header('Content-Disposition', 'attachment; filename=panel_envanter.csv');
        res.send('\uFEFF' + header + rows.join('\n'));
    } catch (e) {
        next(e);
    }
});

// --- Global error handler (no stack to client) ---
app.use((err, req, res, next) => {
    logger.error('Request error: ' + err.message);
    res.status(500).json({ error: 'Internal Server Error' });
});

const server = app.listen(port, () => {
    logger.info('Server running on port ' + port);
});

// --- Graceful shutdown (Docker SIGTERM / Ctrl+C SIGINT) ---
function shutdown() {
    logger.info('Shutting down...');
    server.close(() => {
        pool.end().then(() => {
            logger.info('Closed.');
            process.exit(0);
        }).catch((err) => {
            logger.error('Pool close error: ' + err.message);
            process.exit(1);
        });
    });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
