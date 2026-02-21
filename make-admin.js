// make-admin.js — upgrades all current users to 'admin' role
require('dotenv').config();
const { Client } = require('pg');

async function run() {
    const dbUrl = (process.env.DATABASE_URL || '').replace(/[&?]channel_binding=[^&]*/g, '');
    const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

    try {
        await client.connect();

        const result = await client.query(`UPDATE users SET role = 'admin' RETURNING email, role`);

        console.log(`✅ Upgraded ${result.rowCount} users to admin role:`);
        console.table(result.rows);
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await client.end();
    }
}

run();
