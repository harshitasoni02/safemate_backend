// apply-tables.js — Apply only the TABLE / INDEX / TRIGGER portion
// (enums already exist on Neon from the earlier partial run)
require('dotenv').config();
const { Client } = require('pg');

const SQL = `
-- ── users ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(120)    NOT NULL,
    email           VARCHAR(255)    NOT NULL UNIQUE,
    phone           VARCHAR(20),
    password_hash   TEXT            NOT NULL,
    role            user_role       NOT NULL DEFAULT 'citizen',
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users (role);

-- ── flood_reports ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flood_reports (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    latitude            DECIMAL(10,7)   NOT NULL,
    longitude           DECIMAL(10,7)   NOT NULL,
    address             TEXT,
    severity            flood_severity  NOT NULL,
    water_level         water_level     NOT NULL,
    urgency             urgency_level   NOT NULL DEFAULT 'normal',
    description         TEXT,
    photo_url           TEXT,
    status              report_status   NOT NULL DEFAULT 'pending',
    verified_by         UUID            REFERENCES users(id) ON DELETE SET NULL,
    verified_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    ai_risk_score       DECIMAL(4,3),
    embedding_generated BOOLEAN         NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_reports_user_id    ON flood_reports (user_id);
CREATE INDEX IF NOT EXISTS idx_reports_status     ON flood_reports (status);
CREATE INDEX IF NOT EXISTS idx_reports_severity   ON flood_reports (severity);
CREATE INDEX IF NOT EXISTS idx_reports_urgency    ON flood_reports (urgency);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON flood_reports (created_at DESC);

-- ── report_damage_types ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_damage_types (
    report_id   UUID        NOT NULL REFERENCES flood_reports(id) ON DELETE CASCADE,
    damage      damage_type NOT NULL,
    PRIMARY KEY (report_id, damage)
);
CREATE INDEX IF NOT EXISTS idx_damage_report ON report_damage_types (report_id);

-- ── report_media ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_media (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id   UUID        NOT NULL REFERENCES flood_reports(id) ON DELETE CASCADE,
    url         TEXT        NOT NULL,
    mime_type   VARCHAR(50),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_media_report ON report_media (report_id);

-- ── report_status_history ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_status_history (
    id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id   UUID            NOT NULL REFERENCES flood_reports(id) ON DELETE CASCADE,
    old_status  report_status,
    new_status  report_status   NOT NULL,
    changed_by  UUID            REFERENCES users(id) ON DELETE SET NULL,
    note        TEXT,
    changed_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_history_report ON report_status_history (report_id);

-- ── ai_predictions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_predictions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id       UUID        NOT NULL REFERENCES flood_reports(id) ON DELETE CASCADE,
    model_name      VARCHAR(80) NOT NULL,
    predicted_risk  DECIMAL(4,3),
    confidence      DECIMAL(4,3),
    summary         TEXT,
    raw_output      JSONB,
    predicted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Triggers ──────────────────────────────────────────────────
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
`;

async function run() {
    const dbUrl = (process.env.DATABASE_URL || '').replace(/[&?]channel_binding=[^&]*/g, '');
    const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    try {
        await client.connect();
        console.log('✅ Connected to Neon');
        await client.query(SQL);
        console.log('🎉 All tables, indexes and triggers created on Neon!');
    } catch (err) {
        console.error('❌', err.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}
run();
