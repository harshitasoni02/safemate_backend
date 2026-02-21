// routes/reports.js — Flood incident reports CRUD + admin actions
const router = require('express').Router();
const { body, query: qv, param, validationResult } = require('express-validator');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// ── Allowed enum values (mirror schema enums) ─────────────────
const VALID_SEVERITY = ['low', 'medium', 'high', 'critical'];
const VALID_WATER = ['ankle', 'knee', 'waist', 'above_head'];
const VALID_URGENCY = ['normal', 'urgent', 'life_threatening'];
const VALID_STATUS = ['pending', 'verified', 'resolved'];
const VALID_DAMAGE = ['road_blocked', 'power_outage', 'house_damage', 'bridge_collapse', 'other'];

// ── POST /api/reports — Submit a new flood report ─────────────
router.post(
    '/',
    authenticate,
    [
        body('latitude').isFloat({ min: -90, max: 90 }),
        body('longitude').isFloat({ min: -180, max: 180 }),
        body('address').optional({ checkFalsy: true, nullable: true }).isString().trim(),
        body('severity').isIn(VALID_SEVERITY),
        body('water_level').isIn(VALID_WATER),
        body('urgency').optional({ checkFalsy: true, nullable: true }).isIn(VALID_URGENCY),
        body('description').optional({ checkFalsy: true, nullable: true }).isString().trim().isLength({ max: 2000 }),
        body('photo_url').optional({ checkFalsy: true, nullable: true }).isURL(),
        body('damage_types').optional({ nullable: true }).isArray(),
        body('damage_types.*').optional({ nullable: true }).isIn(VALID_DAMAGE),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const {
            latitude, longitude, address,
            severity, water_level, urgency = 'normal',
            description, photo_url,
            damage_types = []
        } = req.body;

        try {
            const result = await db.withTransaction(async (client) => {
                // Insert main report
                const rep = await client.query(
                    `INSERT INTO flood_reports
                        (user_id, latitude, longitude, address,
                         severity, water_level, urgency, description, photo_url)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                     RETURNING *`,
                    [req.user.id, latitude, longitude, address,
                        severity, water_level, urgency, description, photo_url]
                );
                const report = rep.rows[0];

                // Insert damage types (junction)
                if (damage_types.length > 0) {
                    const vals = damage_types.map((d, i) => `($1,$${i + 2})`).join(',');
                    await client.query(
                        `INSERT INTO report_damage_types (report_id, damage) VALUES ${vals}`,
                        [report.id, ...damage_types]
                    );
                    report.damage_types = damage_types;
                }

                return report;
            });

            res.status(201).json(result);
        } catch (err) {
            console.error('Create report error:', err);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// ── GET /api/reports — List reports (citizen sees own; admin sees all) ──
router.get(
    '/',
    authenticate,
    [
        qv('status').optional().isIn(VALID_STATUS),
        qv('severity').optional().isIn(VALID_SEVERITY),
        qv('urgency').optional().isIn(VALID_URGENCY),
        qv('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
        qv('offset').optional().isInt({ min: 0 }).toInt(),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { status, severity, urgency, limit = 20, offset = 0 } = req.query;
        const isAdmin = req.user.role === 'admin';

        let conditions = [];
        let params = [];
        let i = 1;

        if (!isAdmin) {
            conditions.push(`r.user_id = $${i++}`);
            params.push(req.user.id);
        }
        if (status) { conditions.push(`r.status = $${i++}`); params.push(status); }
        if (severity) { conditions.push(`r.severity = $${i++}`); params.push(severity); }
        if (urgency) { conditions.push(`r.urgency = $${i++}`); params.push(urgency); }

        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

        try {
            const result = await db.query(
                `SELECT r.*,
                        u.name AS reporter_name,
                        COALESCE(
                            json_agg(DISTINCT dt.damage) FILTER (WHERE dt.damage IS NOT NULL),
                            '[]'
                        ) AS damage_types
                 FROM flood_reports r
                 JOIN users u ON u.id = r.user_id
                 LEFT JOIN report_damage_types dt ON dt.report_id = r.id
                 ${where}
                 GROUP BY r.id, u.name
                 ORDER BY r.created_at DESC
                 LIMIT $${i++} OFFSET $${i++}`,
                [...params, limit, offset]
            );

            const countResult = await db.query(
                `SELECT COUNT(*) FROM flood_reports r ${where}`,
                params
            );

            res.json({
                total: parseInt(countResult.rows[0].count),
                limit, offset,
                data: result.rows
            });
        } catch (err) {
            console.error('List reports error:', err);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// ── GET /api/reports/:id — Get single report ─────────────────
router.get(
    '/:id',
    authenticate,
    param('id').isUUID(),
    async (req, res) => {
        try {
            const result = await db.query(
                `SELECT r.*,
                        u.name AS reporter_name,
                        u.phone AS reporter_phone,
                        COALESCE(json_agg(DISTINCT dt.damage) FILTER (WHERE dt.damage IS NOT NULL), '[]') AS damage_types,
                        COALESCE(json_agg(DISTINCT m.*) FILTER (WHERE m.id IS NOT NULL), '[]') AS media
                 FROM flood_reports r
                 JOIN users u ON u.id = r.user_id
                 LEFT JOIN report_damage_types dt ON dt.report_id = r.id
                 LEFT JOIN report_media m ON m.report_id = r.id
                 WHERE r.id = $1
                 GROUP BY r.id, u.name, u.phone`,
                [req.params.id]
            );

            if (!result.rows[0]) return res.status(404).json({ error: 'Report not found' });

            // Citizens can only view their own reports
            const report = result.rows[0];
            if (req.user.role !== 'admin' && report.user_id !== req.user.id) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            res.json(report);
        } catch (err) {
            console.error('Get report error:', err);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// ── PATCH /api/reports/:id/status — Admin: update report status ──
router.patch(
    '/:id/status',
    authenticate,
    requireRole('admin'),
    [
        param('id').isUUID(),
        body('status').isIn(VALID_STATUS).withMessage(`Status must be one of: ${VALID_STATUS.join(', ')}`),
        body('note').optional().isString().trim().isLength({ max: 500 }),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { status, note } = req.body;

        try {
            await db.withTransaction(async (client) => {
                // Fetch current status for history
                const current = await client.query(
                    'SELECT status FROM flood_reports WHERE id = $1',
                    [req.params.id]
                );
                if (!current.rows[0]) throw Object.assign(new Error('Not found'), { statusCode: 404 });

                // Update the report
                await client.query(
                    `UPDATE flood_reports
                     SET status = $1, verified_by = $2, verified_at = NOW()
                     WHERE id = $3`,
                    [status, req.user.id, req.params.id]
                );

                // Append to audit history
                await client.query(
                    `INSERT INTO report_status_history (report_id, old_status, new_status, changed_by, note)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [req.params.id, current.rows[0].status, status, req.user.id, note || null]
                );
            });

            res.json({ message: `Report status updated to '${status}'` });
        } catch (err) {
            if (err.statusCode === 404) return res.status(404).json({ error: 'Report not found' });
            console.error('Update status error:', err);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// ── GET /api/reports/:id/history — Status audit trail ─────────
router.get(
    '/:id/history',
    authenticate,
    requireRole('admin'),
    param('id').isUUID(),
    async (req, res) => {
        try {
            const result = await db.query(
                `SELECT h.*, u.name AS changed_by_name
                 FROM report_status_history h
                 LEFT JOIN users u ON u.id = h.changed_by
                 WHERE h.report_id = $1
                 ORDER BY h.changed_at DESC`,
                [req.params.id]
            );
            res.json(result.rows);
        } catch (err) {
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// ── GET /api/reports/stats/summary — Admin dashboard stats ───
router.get(
    '/stats/summary',
    authenticate,
    requireRole('admin'),
    async (_req, res) => {
        try {
            const result = await db.query(`
                SELECT
                    COUNT(*)                                            AS total,
                    COUNT(*) FILTER (WHERE status = 'pending')         AS pending,
                    COUNT(*) FILTER (WHERE status = 'verified')        AS verified,
                    COUNT(*) FILTER (WHERE status = 'resolved')        AS resolved,
                    COUNT(*) FILTER (WHERE urgency = 'life_threatening') AS life_threatening,
                    COUNT(*) FILTER (WHERE severity = 'critical')      AS critical,
                    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS last_24h
                FROM flood_reports
            `);
            res.json(result.rows[0]);
        } catch (err) {
            res.status(500).json({ error: 'Server error' });
        }
    }
);

module.exports = router;
