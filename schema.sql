-- Database Schema for ARIOT

-- Users table for session authentication
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Measurements table for sensor data
CREATE TABLE IF NOT EXISTS measurements (
    id SERIAL PRIMARY KEY,
    gateway_id VARCHAR(50),
    rssi NUMERIC, -- Signal strength
    snr NUMERIC,  -- Signal to noise ratio
    frequency NUMERIC,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Saved points for manual measurements
CREATE TABLE IF NOT EXISTS saved_points (
    id SERIAL PRIMARY KEY,
    note TEXT,
    avg_rssi NUMERIC,
    avg_snr NUMERIC,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Planned Gateways (New for Planner)
CREATE TABLE IF NOT EXISTS planned_gateways (
    id SERIAL PRIMARY KEY,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    radius NUMERIC,
    frequency NUMERIC,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- App Configuration (White Labeling)
CREATE TABLE IF NOT EXISTS app_config (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT
);
-- Seed default config if not exists (checked in app logic usually, but safe here)
-- We will handle seeding in server.js to allow "first run" detection

-- Webhook Integrations (Dynamic Parsing)
CREATE TABLE IF NOT EXISTS integrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    endpoint_slug VARCHAR(50) UNIQUE, -- e.g. /webhook/chirpstack
    decoder_script TEXT, -- JS function body
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Webhook/System Logs (For Debugging & Audit)
CREATE TABLE IF NOT EXISTS system_logs (
    id SERIAL PRIMARY KEY,
    source VARCHAR(50), -- e.g., 'webhook', 'system', 'error'
    level VARCHAR(20), -- 'info', 'warn', 'error'
    message TEXT,
    details JSONB, -- Store payload/parsed data here
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

