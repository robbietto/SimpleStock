// backend/src/routes/auth.routes.js
// ─────────────────────────────────────────────────────────────────────
//  Rotte di autenticazione JWT
//
//  POST /api/v1/auth/login    → restituisce access_token + refresh_token
//  POST /api/v1/auth/refresh  → rotation: nuovo access + refresh, revoca vecchio
//  POST /api/v1/auth/logout   → revoca il refresh token corrente
//  GET  /api/v1/auth/me       → dati utente autenticato (richiede Bearer)
//
//  Strategia token (da ArchitetturaTecnica §2 e Appendice A):
//    access_token  → JWT HS256, scade in 15 min, stateless
//    refresh_token → opaque token casuale, hash SHA-256 salvato in DB,
//                    scade in 7 giorni, rotation ad ogni refresh
// ─────────────────────────────────────────────────────────────────────

'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { z }    = require('zod');
const prisma   = require('../lib/prisma');
const auth     = require('../middleware/auth');

const router = express.Router();

// ── Helpers ────────────────────────────────────────────────────────

/** Genera un JWT access token (15 min) */
function signAccessToken(utente) {
  return jwt.sign(
    {
      id:    utente.id,
      uuid:  utente.uuid,
      ruolo: utente.ruolo,
      piano: utente.piano,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
}

/** Genera un refresh token opaco (random 64 byte) e ne salva l'hash SHA-256 */
async function createRefreshToken(utenteId, ipAddress, userAgent) {
  const rawToken  = crypto.randomBytes(64).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const scadeIl = new Date();
  scadeIl.setDate(scadeIl.getDate() + 7); // +7 giorni

  await prisma.refreshToken.create({
    data: {
      utenteId,
      tokenHash,
      scadeIl,
      ipAddress: ipAddress || null,
      userAgent: userAgent ? userAgent.slice(0, 500) : null,
    },
  });

  return rawToken; // restituito al client in chiaro
}

/** Ritorna i dati pubblici dell'utente (senza password) */
function publicUser(u) {
  return {
    id:          u.id,
    uuid:        u.uuid,
    nome:        u.nome,
    email:       u.email,
    ruolo:       u.ruolo,
    piano:       u.piano,
    nomeNegozio: u.nomeNegozio,
  };
}

// ── Zod schemas ────────────────────────────────────────────────────

const LoginSchema = z.object({
  email:    z.string().email('Email non valida'),
  password: z.string().min(6, 'Password minimo 6 caratteri'),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// ── POST /login ────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: parsed.error.flatten().fieldErrors });
  }

  const { email, password } = parsed.data;

  try {
    const utente = await prisma.utente.findUnique({ where: { email } });

    if (!utente || !utente.attivo) {
      // Risposta generica: non rivelare se l'email esiste
      return res.status(401).json({ error: 'Credenziali non valide', code: 'INVALID_CREDENTIALS' });
    }

    const passwordOk = await bcrypt.compare(password, utente.passwordHash);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Credenziali non valide', code: 'INVALID_CREDENTIALS' });
    }

    const accessToken  = signAccessToken(utente);
    const refreshToken = await createRefreshToken(
      utente.id,
      req.ip,
      req.headers['user-agent']
    );

    return res.status(200).json({
      accessToken,
      refreshToken,
      user: publicUser(utente),
    });
  } catch (err) {
    console.error('[auth/login]', err);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
});

// ── POST /refresh ──────────────────────────────────────────────────

router.post('/refresh', async (req, res) => {
  const parsed = RefreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: 'refreshToken mancante' });
  }

  const { refreshToken: rawToken } = parsed.data;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  try {
    const stored = await prisma.refreshToken.findUnique({
      where:   { tokenHash },
      include: { utente: true },
    });

    if (!stored || stored.revocato || stored.scadeIl < new Date()) {
      return res.status(401).json({ error: 'Refresh token non valido o scaduto', code: 'INVALID_REFRESH' });
    }

    if (!stored.utente.attivo) {
      return res.status(401).json({ error: 'Account disabilitato', code: 'ACCOUNT_DISABLED' });
    }

    // ROTATION: revoca il vecchio, emetti nuovi token
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data:  { revocato: true },
    });

    const newAccess  = signAccessToken(stored.utente);
    const newRefresh = await createRefreshToken(
      stored.utente.id,
      req.ip,
      req.headers['user-agent']
    );

    return res.status(200).json({
      accessToken:  newAccess,
      refreshToken: newRefresh,
      user:         publicUser(stored.utente),
    });
  } catch (err) {
    console.error('[auth/refresh]', err);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
});

// ── POST /logout ───────────────────────────────────────────────────

router.post('/logout', async (req, res) => {
  const parsed = RefreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(200).json({ message: 'Logout effettuato' }); // silenzioso
  }

  const tokenHash = crypto
    .createHash('sha256')
    .update(parsed.data.refreshToken)
    .digest('hex');

  try {
    await prisma.refreshToken.updateMany({
      where: { tokenHash, revocato: false },
      data:  { revocato: true },
    });
  } catch {
    // silenzioso — il token era già invalido
  }

  return res.status(200).json({ message: 'Logout effettuato con successo' });
});

// ── GET /me ────────────────────────────────────────────────────────

router.get('/me', auth, async (req, res) => {
  try {
    const utente = await prisma.utente.findUnique({
      where:  { id: req.user.id },
      select: {
        id: true, uuid: true, nome: true, email: true,
        ruolo: true, piano: true, nomeNegozio: true,
        pianoScadenza: true, attivo: true, createdAt: true,
      },
    });

    if (!utente || !utente.attivo) {
      return res.status(404).json({ error: 'Utente non trovato' });
    }

    return res.status(200).json({ user: utente });
  } catch (err) {
    console.error('[auth/me]', err);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
});

module.exports = router;
