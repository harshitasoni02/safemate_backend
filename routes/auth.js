// routes/auth.js — Register & Login
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../db');

// ── POST /api/auth/register ───────────────────────────────────
router.post(
    '/register',
    [
        body('name').trim().notEmpty().withMessage('Name is required'),
        body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
        body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 chars'),
        body('phone').optional().isMobilePhone(),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { name, email, password, phone } = req.body;
        try {
            // Check for existing user
            const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
            if (existing.rows.length > 0) {
                return res.status(409).json({ error: 'Email already registered' });
            }

            const password_hash = await bcrypt.hash(password, 12);
            const result = await db.query(
                `INSERT INTO users (name, email, phone, password_hash, role)
                 VALUES ($1, $2, $3, $4, 'citizen')
                 RETURNING id, name, email, role, created_at`,
                [name, email, phone || null, password_hash]
            );

            const user = result.rows[0];
            const token = jwt.sign(
                { id: user.id, email: user.email, role: user.role },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
            );

            res.status(201).json({ user, token });
        } catch (err) {
            console.error('Register error:', err);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// ── POST /api/auth/login ─────────────────────────────────────
router.post(
    '/login',
    [
        body('email').isEmail().normalizeEmail(),
        body('password').notEmpty(),
    ],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { email, password } = req.body;
        try {
            const result = await db.query(
                'SELECT id, name, email, role, password_hash, is_active FROM users WHERE email = $1',
                [email]
            );
            const user = result.rows[0];
            if (!user || !user.is_active) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const valid = await bcrypt.compare(password, user.password_hash);
            if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

            const token = jwt.sign(
                { id: user.id, email: user.email, role: user.role },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
            );

            const { password_hash, ...safeUser } = user;
            res.json({ user: safeUser, token });
        } catch (err) {
            console.error('Login error:', err);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// ── GET /api/auth/me ──────────────────────────────────────────
const { authenticate } = require('../middleware/auth');
router.get('/me', authenticate, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id, name, email, phone, role, created_at FROM users WHERE id = $1',
            [req.user.id]
        );
        if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
