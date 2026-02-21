// add-people-cols.js
require('dotenv').config();
const { Client } = require('pg');

async function run() {
    const dbUrl = (process.env.DATABASE_URL || '').replace(/[&?]channel_binding=[^&]*/g, '');
    const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    try {
        await client.connect();
        await client.query(`
            ALTER TABLE flood_reports 
            ADD COLUMN IF NOT EXISTS people_count INTEGER NOT NULL DEFAULT 1,
            ADD COLUMN IF NOT EXISTS medical_needed BOOLEAN NOT NULL DEFAULT false;
        `);
        console.log('✅ Columns people_count and medical_needed added to flood_reports');
    } catch (e) {
        console.error('❌', e.message);
    } finally {
        await client.end();
    }
}
run();
