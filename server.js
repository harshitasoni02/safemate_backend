// server.js — SafeMate Backend Entry Point
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const reportRoutes = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 4000;

// ── Middleware ───────────────────────────────────────────────
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Root & Health check ──────────────────────────────────────
app.get('/', (_req, res) => {
    res.json({ message: 'Welcome to the SafeMate API', status: 'online' });
});

app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'safemate-api', time: new Date().toISOString() });
});

// ── API Routes ────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/reports', reportRoutes);

// ── 404 handler ───────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler ──────────────────────────────────────
app.use((err, _req, res, _next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// ── Start server ──────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`\n🛡️  SafeMate API running on http://localhost:${PORT}`);
        console.log(`    Environment: ${process.env.NODE_ENV || 'development'}\n`);
    });
}

// Export for Vercel serverless
module.exports = app;
