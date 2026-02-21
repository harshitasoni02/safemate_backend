// verify-db.js — confirm Neon tables and apply missing triggers
require('dotenv').config();
const { Client } = require('pg');

async function run() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    console.log('✅ Connected to Neon\n');

    // List all tables
    const tables = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name`);
    console.log('📋 Tables in Neon:');
    tables.rows.forEach(r => console.log('  •', r.table_name));

    // Apply triggers (idempotent)
    try {
        await client.query(`
            CREATE OR REPLACE FUNCTION set_updated_at()
            RETURNS TRIGGER AS $$
            BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
            $$ LANGUAGE plpgsql;

            DROP TRIGGER IF EXISTS trg_users_updated_at   ON users;
            DROP TRIGGER IF EXISTS trg_reports_updated_at ON flood_reports;

            CREATE TRIGGER trg_users_updated_at
                BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
            CREATE TRIGGER trg_reports_updated_at
                BEFORE UPDATE ON flood_reports FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        `);
        console.log('\n✅ Triggers applied');
    } catch (e) {
        console.log('\n⚠  Trigger note:', e.message.split('\n')[0]);
    }

    await client.end();
    console.log('\n🎉 Neon DB is ready!\n');
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
