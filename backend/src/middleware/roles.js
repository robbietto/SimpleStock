// backend/src/middleware/roles.js
// ─────────────────────────────────────────────────────────────────────
//  Middleware: controllo ruolo (admin / operatore) e piano (base / premium)
//  Da usare DOPO authMiddleware — richiede req.user iniettato.
//
//  Uso:
//    router.post('/', auth, requireRole('admin'), handler)
//    router.get('/suggerimenti', auth, requirePlan('premium'), handler)
// ─────────────────────────────────────────────────────────────────────

'use strict';

/**
 * Richiede che l'utente autenticato abbia uno dei ruoli specificati.
 * @param {...string} allowedRoles - es. requireRole('admin')
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Non autenticato', code: 'UNAUTHENTICATED' });
    }

    if (!allowedRoles.includes(req.user.ruolo)) {
      return res.status(403).json({
        error:  `Accesso riservato a: ${allowedRoles.join(', ')}`,
        code:   'FORBIDDEN_ROLE',
        ruolo:  req.user.ruolo,
      });
    }

    next();
  };
}

/**
 * Richiede che l'utente autenticato sia sul piano specificato.
 * @param {'premium'|'base'} requiredPlan
 */
function requirePlan(requiredPlan) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Non autenticato', code: 'UNAUTHENTICATED' });
    }

    if (req.user.piano !== requiredPlan) {
      return res.status(403).json({
        error: `Funzionalità disponibile solo nel piano ${requiredPlan}. Aggiorna il tuo piano.`,
        code:  'PLAN_REQUIRED',
        piano: req.user.piano,
      });
    }

    next();
  };
}

module.exports = { requireRole, requirePlan };
