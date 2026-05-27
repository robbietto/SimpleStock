// backend/src/middleware/auth.js
// ─────────────────────────────────────────────────────────────────────
//  Middleware: verifica JWT access token
//  Inietta req.user = { id, uuid, ruolo, piano } per le route successive.
//  Token format: Authorization: Bearer <access_token>
// ─────────────────────────────────────────────────────────────────────

'use strict';

const jwt = require('jsonwebtoken');

/**
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
module.exports = function authMiddleware(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Token mancante',
      code:  'MISSING_TOKEN',
    });
  }

  const token = header.slice(7); // rimuove "Bearer "

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    const isExpired = err.name === 'TokenExpiredError';
    return res.status(401).json({
      error: isExpired ? 'Token scaduto — rinnovare con /auth/refresh' : 'Token non valido',
      code:  isExpired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
    });
  }
};
