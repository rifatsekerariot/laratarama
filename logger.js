/**
 * Structured logger (Winston) for Panel Envanter.
 * - error → error.log
 * - all levels → app.log (combined)
 * - console (stdout) for Docker / local dev
 */
const path = require('path');
const winston = require('winston');

const logDir = process.env.LOG_DIR || path.join(__dirname);
const isProduction = process.env.NODE_ENV === 'production';

const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ level, message, timestamp, stack }) => {
        const base = `${timestamp} [${level.toUpperCase()}] ${message}`;
        return stack ? `${base}\n${stack}` : base;
    })
);

const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.colorize(),
    winston.format.printf(({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`)
);

const transports = [
    new winston.transports.Console({
        format: consoleFormat,
        level: isProduction ? 'info' : 'debug'
    })
];

if (logDir) {
    transports.push(
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            format: logFormat
        }),
        new winston.transports.File({
            filename: path.join(logDir, 'app.log'),
            format: logFormat
        })
    );
}

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports,
    exitOnError: false
});

module.exports = logger;
