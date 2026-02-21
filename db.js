// db.js — PostgreSQL connection pool (pg) with Neon SSL support
const { Pool } = require('pg');
require('dotenv').config();

// Strip unsupported channel_binding param (not understood by node-postgres)
const rawUrl = (process.env.DATABASE_URL || '')
    .replace(/[&?]channel_binding=[^&]*/g, '');

const pool = rawUrl
    ? new Pool({
        connectionString: rawUrl,
        ssl: { rejectUnauthorized: false },   // Neon requires SSL
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    })
    : new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'safemate_db',
        user: process.env.DB_USER || 'safemate_user',
        password: process.env.DB_PASSWORD,
        ssl: process.env.DB_HOST?.includes('neon.tech') ? { rejectUnauthorized: false } : false,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
    });

pool.on('connect', () => console.log('✅ PostgreSQL pool connected'));
pool.on('error', (err) => console.error('PostgreSQL pool error:', err));

const query = (text, params) => pool.query(text, params);

const withTransaction = async (callback) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

module.exports = { query, withTransaction, pool };
