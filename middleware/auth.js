// middleware/auth.js — JWT authentication + role guard
const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    const token = header.split(' ')[1];
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ error: 'Token expired or invalid' });
    }
};

// Usage: requireRole('admin') — attach after authenticate
const requireRole = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
};

module.exports = { authenticate, requireRole };
