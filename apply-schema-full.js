// apply-schema-full.js — Apply entire schema.sql as one query (handles $$ triggers safely)
require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function run() {
    // Strip unsupported params from Neon URL (channel_binding not supported by pg)
    const dbUrl = (process.env.DATABASE_URL || '')
        .replace(/&channel_binding=[^&]*/g, '')
        .replace(/\?channel_binding=[^&]*&?/g, '?');

    const client = new Client({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false },
    });
    try {
        await client.connect();
        console.log('✅ Connected to Neon PostgreSQL');

        const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

        // Remove commented pgvector line to avoid parse errors
        const cleaned = sql.replace(/^-- CREATE EXTENSION.*$/gm, '');

        await client.query(cleaned);
        console.log('🎉 Full schema applied to Neon successfully!');
    } catch (err) {
        if (err.message.includes('already exists')) {
            console.log('⏭  Schema already exists on Neon — nothing to do.');
        } else {
            console.error('❌ Schema error:', err.message);
            process.exit(1);
        }
    } finally {
        await client.end();
    }
}

run();
