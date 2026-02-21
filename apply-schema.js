// apply-schema.js — Run once to initialize the Neon database
require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function applySchema() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    });

    try {
        await client.connect();
        console.log('✅ Connected to Neon PostgreSQL');

        const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

        // Split on semicolons, filter empties, run each statement
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));

        for (const statement of statements) {
            try {
                await client.query(statement + ';');
                const firstLine = statement.split('\n')[0].trim().slice(0, 60);
                console.log(`  ✓ ${firstLine}`);
            } catch (err) {
                // Ignore "already exists" errors (safe to re-run)
                if (err.code === '42710' || err.code === '42P07' || err.message.includes('already exists')) {
                    console.log(`  ⏭  already exists — skipped`);
                } else {
                    console.warn(`  ⚠  ${err.message.split('\n')[0]}`);
                }
            }
        }

        console.log('\n🎉 Schema applied to Neon successfully!\n');
    } catch (err) {
        console.error('❌ Connection failed:', err.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

applySchema();
