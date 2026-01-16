const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'ariot',
    password: 'postgres',
    port: 5432,
});

console.log('Pool created');

pool.connect().then(client => {
    console.log('Connected');
    client.release();
    process.exit(0);
}).catch(err => {
    console.error('Connection failed', err.message);
    process.exit(0); // Exit gracefully
});

pool.on('error', (err) => {
    console.error('Pool error', err);
});
