// apply-triggers.js — Apply PL/pgSQL trigger separately (safe to re-run)
require('dotenv').config();
const { Client } = require('pg');

const TRIGGER_SQL = `
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at   ON users;
DROP TRIGGER IF EXISTS trg_reports_updated_at ON flood_reports;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_reports_updated_at
    BEFORE UPDATE ON flood_reports
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
`;

async function run() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    });
    try {
        await client.connect();
        await client.query(TRIGGER_SQL);
        console.log('✅ Triggers applied to Neon');
    } catch (err) {
        console.error('❌', err.message);
    } finally {
        await client.end();
    }
}

run();
