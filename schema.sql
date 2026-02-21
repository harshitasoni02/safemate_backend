-- ============================================================
--  SafeMate — Disaster Management PostgreSQL Schema
--  Normalized, indexed, and scalable for AI/RAG integration
-- ============================================================

-- Enable pgvector extension (for future AI embedding search)
-- CREATE EXTENSION IF NOT EXISTS vector;

-- ── Enums ────────────────────────────────────────────────────
CREATE TYPE user_role         AS ENUM ('citizen', 'admin');
CREATE TYPE flood_severity    AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE water_level       AS ENUM ('ankle', 'knee', 'waist', 'above_head');
CREATE TYPE urgency_level     AS ENUM ('normal', 'urgent', 'life_threatening');
CREATE TYPE report_status     AS ENUM ('pending', 'verified', 'resolved');
CREATE TYPE damage_type       AS ENUM (
    'road_blocked', 'power_outage', 'house_damage',
    'bridge_collapse', 'other'
);

-- ── Table: users ─────────────────────────────────────────────
CREATE TABLE users (
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

CREATE INDEX idx_users_email  ON users (email);
CREATE INDEX idx_users_role   ON users (role);

-- ── Table: flood_reports ─────────────────────────────────────
CREATE TABLE flood_reports (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Location
    latitude            DECIMAL(10, 7)  NOT NULL,
    longitude           DECIMAL(10, 7)  NOT NULL,
    address             TEXT,

    -- Selectable fields
    severity            flood_severity  NOT NULL,
    water_level         water_level     NOT NULL,
    urgency             urgency_level   NOT NULL DEFAULT 'normal',

    -- Description & media
    description         TEXT,
    photo_url           TEXT,                     -- primary photo; use report_media for multiple

    -- Status & tracking
    status              report_status   NOT NULL DEFAULT 'pending',
    verified_by         UUID            REFERENCES users(id) ON DELETE SET NULL,
    verified_at         TIMESTAMPTZ,

    -- Timestamps
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- AI/RAG ready fields
    ai_risk_score       DECIMAL(4, 3),            -- 0.000–1.000, filled by ML pipeline
    embedding_generated BOOLEAN         NOT NULL DEFAULT FALSE
    -- description_vector vector(1536)            -- uncomment when pgvector is enabled
);

CREATE INDEX idx_reports_user_id    ON flood_reports (user_id);
CREATE INDEX idx_reports_status     ON flood_reports (status);
CREATE INDEX idx_reports_severity   ON flood_reports (severity);
CREATE INDEX idx_reports_urgency    ON flood_reports (urgency);
CREATE INDEX idx_reports_location   ON flood_reports USING GIST (
    point(longitude, latitude)          -- spatial index for proximity queries
);
CREATE INDEX idx_reports_created_at ON flood_reports (created_at DESC);

-- ── Table: report_damage_types (M2M junction) ────────────────
-- Supports multi-select infrastructure damage options
CREATE TABLE report_damage_types (
    report_id   UUID        NOT NULL REFERENCES flood_reports(id) ON DELETE CASCADE,
    damage      damage_type NOT NULL,
    PRIMARY KEY (report_id, damage)
);

CREATE INDEX idx_damage_report ON report_damage_types (report_id);

-- ── Table: report_media (multiple photos per report) ─────────
CREATE TABLE report_media (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id   UUID        NOT NULL REFERENCES flood_reports(id) ON DELETE CASCADE,
    url         TEXT        NOT NULL,
    mime_type   VARCHAR(50),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_media_report ON report_media (report_id);

-- ── Table: report_status_history (audit log) ─────────────────
CREATE TABLE report_status_history (
    id          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id   UUID            NOT NULL REFERENCES flood_reports(id) ON DELETE CASCADE,
    old_status  report_status,
    new_status  report_status   NOT NULL,
    changed_by  UUID            REFERENCES users(id) ON DELETE SET NULL,
    note        TEXT,
    changed_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_history_report ON report_status_history (report_id);

-- ── Table: ai_predictions (future ML/RAG integration) ────────
CREATE TABLE ai_predictions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id       UUID        NOT NULL REFERENCES flood_reports(id) ON DELETE CASCADE,
    model_name      VARCHAR(80) NOT NULL,
    predicted_risk  DECIMAL(4,3),               -- 0.000–1.000
    confidence      DECIMAL(4,3),
    summary         TEXT,                       -- RAG-generated response
    raw_output      JSONB,                      -- full model JSON response
    predicted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Trigger: auto-update updated_at ──────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_reports_updated_at
    BEFORE UPDATE ON flood_reports
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
