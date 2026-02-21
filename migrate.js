// migrate.js — Apply schema to Neon in 3 safe sequential steps
require('dotenv').config();
const { Client } = require('pg');

const dbUrl = (process.env.DATABASE_URL || '').replace(/[&?]channel_binding=[^&]*/g, '');

async function exec(client, label, sql) {
    try {
        await client.query(sql);
        console.log(`  ✅ ${label}`);
    } catch (e) {
        if (e.message.includes('already exists')) {
            console.log(`  ⏭  ${label} — already exists`);
        } else {
            console.error(`  ❌ ${label}: ${e.message}`);
            throw e;
        }
    }
}

async function run() {
    const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();
    console.log('✅ Connected to Neon\n');

    console.log('── Step 1: Enums ───────────────────────────────────');
    await exec(client, 'user_role', `CREATE TYPE user_role      AS ENUM ('citizen','admin')`);
    await exec(client, 'flood_severity', `CREATE TYPE flood_severity AS ENUM ('low','medium','high','critical')`);
    await exec(client, 'water_level', `CREATE TYPE water_level    AS ENUM ('ankle','knee','waist','above_head')`);
    await exec(client, 'urgency_level', `CREATE TYPE urgency_level  AS ENUM ('normal','urgent','life_threatening')`);
    await exec(client, 'report_status', `CREATE TYPE report_status  AS ENUM ('pending','verified','resolved')`);
    await exec(client, 'damage_type', `CREATE TYPE damage_type    AS ENUM ('road_blocked','power_outage','house_damage','bridge_collapse','other')`);

    console.log('\n── Step 2: Tables ──────────────────────────────────');
    await exec(client, 'users', `
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(120) NOT NULL,
            email VARCHAR(255) NOT NULL UNIQUE,
            phone VARCHAR(20),
            password_hash TEXT NOT NULL,
            role user_role NOT NULL DEFAULT 'citizen',
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
    await exec(client, 'idx_users_email', `CREATE INDEX IF NOT EXISTS idx_users_email ON users (email)`);
    await exec(client, 'idx_users_role', `CREATE INDEX IF NOT EXISTS idx_users_role  ON users (role)`);

    await exec(client, 'flood_reports', `
        CREATE TABLE IF NOT EXISTS flood_reports (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            latitude DECIMAL(10,7) NOT NULL,
            longitude DECIMAL(10,7) NOT NULL,
            address TEXT,
            severity flood_severity NOT NULL,
            water_level water_level NOT NULL,
            urgency urgency_level NOT NULL DEFAULT 'normal',
            description TEXT,
            photo_url TEXT,
            status report_status NOT NULL DEFAULT 'pending',
            verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
            verified_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ai_risk_score DECIMAL(4,3),
            embedding_generated BOOLEAN NOT NULL DEFAULT FALSE
        )`);
    await exec(client, 'idx_reports_user_id', `CREATE INDEX IF NOT EXISTS idx_reports_user_id    ON flood_reports (user_id)`);
    await exec(client, 'idx_reports_status', `CREATE INDEX IF NOT EXISTS idx_reports_status     ON flood_reports (status)`);
    await exec(client, 'idx_reports_severity', `CREATE INDEX IF NOT EXISTS idx_reports_severity   ON flood_reports (severity)`);
    await exec(client, 'idx_reports_urgency', `CREATE INDEX IF NOT EXISTS idx_reports_urgency    ON flood_reports (urgency)`);
    await exec(client, 'idx_reports_created_at', `CREATE INDEX IF NOT EXISTS idx_reports_created_at ON flood_reports (created_at DESC)`);

    await exec(client, 'report_damage_types', `
        CREATE TABLE IF NOT EXISTS report_damage_types (
            report_id UUID NOT NULL REFERENCES flood_reports(id) ON DELETE CASCADE,
            damage damage_type NOT NULL,
            PRIMARY KEY (report_id, damage)
        )`);
    await exec(client, 'idx_damage_report', `CREATE INDEX IF NOT EXISTS idx_damage_report ON report_damage_types (report_id)`);

    await exec(client, 'report_media', `
        CREATE TABLE IF NOT EXISTS report_media (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            report_id UUID NOT NULL REFERENCES flood_reports(id) ON DELETE CASCADE,
            url TEXT NOT NULL,
            mime_type VARCHAR(50),
            uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
    await exec(client, 'idx_media_report', `CREATE INDEX IF NOT EXISTS idx_media_report ON report_media (report_id)`);

    await exec(client, 'report_status_history', `
        CREATE TABLE IF NOT EXISTS report_status_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            report_id UUID NOT NULL REFERENCES flood_reports(id) ON DELETE CASCADE,
            old_status report_status,
            new_status report_status NOT NULL,
            changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
            note TEXT,
            changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
    await exec(client, 'idx_history_report', `CREATE INDEX IF NOT EXISTS idx_history_report ON report_status_history (report_id)`);

    await exec(client, 'ai_predictions', `
        CREATE TABLE IF NOT EXISTS ai_predictions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            report_id UUID NOT NULL REFERENCES flood_reports(id) ON DELETE CASCADE,
            model_name VARCHAR(80) NOT NULL,
            predicted_risk DECIMAL(4,3),
            confidence DECIMAL(4,3),
            summary TEXT,
            raw_output JSONB,
            predicted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);

    console.log('\n── Step 3: Triggers ────────────────────────────────');
    await exec(client, 'set_updated_at function', `
        CREATE OR REPLACE FUNCTION set_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
        $$ LANGUAGE plpgsql`);
    await client.query(`DROP TRIGGER IF EXISTS trg_users_updated_at ON users`);
    await client.query(`DROP TRIGGER IF EXISTS trg_reports_updated_at ON flood_reports`);
    await exec(client, 'trg_users_updated_at', `CREATE TRIGGER trg_users_updated_at   BEFORE UPDATE ON users         FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);
    await exec(client, 'trg_reports_updated_at', `CREATE TRIGGER trg_reports_updated_at BEFORE UPDATE ON flood_reports FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);

    await client.end();
    console.log('\n🎉 Neon database fully initialized!\n');
}

run().catch(e => { console.error('\n❌ Fatal:', e.message); process.exit(1); });
