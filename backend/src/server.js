// backend/src/server.js  (oppure app.js se preferisci — aggiorna package.json)
// ═══════════════════════════════════════════════════════════════════════
//  SimpleStock — Entry point Express
//  Stack: Node.js + Express + Prisma + MySQL (§5.1 Business Plan)
//  Team 2 · 9 · 10  ·  Consegna 31 maggio 2026
//
//  STRUTTURA:
//    1. Setup Express + middleware globali (CORS, JSON, logging)
//    2. Health check (Railway lo usa per verificare il deployment)
//    3. Rotte API v1
//    4. Error handler globale
//    5. Graceful shutdown (Prisma disconnect)
//
//  CORS:
//    Origine consentita configurabile via env CORS_ORIGIN.
//    In locale: http://localhost:3000 (npx serve) oppure http://localhost:5500 (Live Server)
//    In produzione: URL Vercel del frontend
// ═══════════════════════════════════════════════════════════════════════

'use strict';

require('dotenv').config();                        // carica .env prima di tutto

const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];
const missingEnv = REQUIRED_ENV.filter((key) => {
  const value = process.env[key];
  return !value || value.trim() === '' || value.startsWith('REPLACE_WITH');
});

if (missingEnv.length > 0) {
  console.error(`✗ Variabili ambiente obbligatorie mancanti o non valide: ${missingEnv.join(', ')}`);
  console.error('  → Copia backend/.env.example in backend/.env e compila valori reali.');
  process.exit(1);
}

const express  = require('express');
const cors     = require('cors');
const prisma   = require('./lib/prisma');

// ── Route handlers ─────────────────────────────────────────────────
const authRoutes     = require('./routes/auth.routes');
const prodottiRoutes = require('./routes/prodotti.routes');
const movimentiRoutes= require('./routes/movimenti.routes');
const riordiniRoutes  = require('./routes/riordini.routes');
const fornitoriRoutes = require('./routes/fornitori.routes');

const app  = express();
const PORT = process.env.PORT || 3001;
const API  = '/api/v1';

// ── 1. MIDDLEWARE GLOBALI ──────────────────────────────────────────

/**
 * CORS
 * Origini consentite: lista separata da virgola in CORS_ORIGIN env.
 * Esempio .env:  CORS_ORIGIN=http://localhost:3000,http://localhost:5500
 */
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:5500')
  .split(',')
  .map(o => o.trim());

app.use(
  cors({
    origin(origin, callback) {
      // Postman, curl, server-to-server → nessun Origin header → OK
      if (!origin) return callback(null, true);

      // In development accetta qualsiasi localhost/* per semplicità
      const isDev = process.env.NODE_ENV !== 'production';
      const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      if (isDev && isLocalhost) return callback(null, true);

      // In production controlla la whitelist
      if (allowedOrigins.includes(origin)) return callback(null, true);

      console.warn(`[CORS] Origine non consentita: ${origin}`);
      return callback(new Error(`Origin ${origin} non consentita da CORS`));
    },
    credentials:    true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods:        ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);

// JSON body parser (max 2mb — sufficiente per import CSV)
app.use(express.json({ limit: '2mb' }));

// Logging minimale in sviluppo
if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    console.log(`${new Date().toISOString()}  ${req.method}  ${req.url}`);
    next();
  });
}

// ── 2. HEALTH CHECK ───────────────────────────────────────────────
//  Railway verifica /health per il liveness probe.
//  Restituisce anche lo stato della connessione Prisma/MySQL.

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;   // ping MySQL
    return res.status(200).json({
      status:    'ok',
      timestamp: new Date().toISOString(),
      db:        'connected',
      version:   process.env.npm_package_version || '1.0.0',
    });
  } catch (err) {
    console.error('[health] DB ping failed:', err.message);
    return res.status(503).json({
      status:    'degraded',
      timestamp: new Date().toISOString(),
      db:        'disconnected',
      error:     err.message,
    });
  }
});

// ── 3. ROTTE API v1 ───────────────────────────────────────────────
//
//  /api/v1/auth        → login, refresh, logout, me
//  /api/v1/prodotti    → CRUD prodotti + ordinamento scorta bassa
//  /api/v1/movimenti   → carico/scarico con transazione atomica
//  /api/v1/riordini    → suggerimenti algoritmo §3.3 + conferma ordine

app.use(`${API}/auth`,      authRoutes);
app.use(`${API}/prodotti`,  prodottiRoutes);
app.use(`${API}/movimenti`, movimentiRoutes);
app.use(`${API}/riordini`,   riordiniRoutes);
app.use(`${API}/fornitori`, fornitoriRoutes);

// ── 404 per rotte sconosciute ──────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    error: 'Rotta non trovata',
    code:  'ROUTE_NOT_FOUND',
    tip:   `Usa ${API}/<auth|prodotti|movimenti|riordini|fornitori>`,
  });
});

// ── 4. ERROR HANDLER GLOBALE ──────────────────────────────────────
//  Cattura tutti gli errori non gestiti nelle route.
//  Evita di esporre stack trace in produzione.

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[unhandled error]', err);

  // Errore CORS
  if (err.message?.startsWith('Origin')) {
    return res.status(403).json({ error: err.message, code: 'CORS_REJECTED' });
  }

  const status  = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'Errore interno del server'
    : err.message;

  return res.status(status).json({ error: message });
});

// ── 5. AVVIO SERVER + GRACEFUL SHUTDOWN ──────────────────────────

async function start() {
  try {
    // Verifica connessione DB prima di accettare traffico
    await prisma.$connect();
    console.log('✓ Prisma connesso al database MySQL');
  } catch (err) {
    console.error('✗ Impossibile connettersi al database:', err.message);
    console.error('  → Verifica DATABASE_URL nel file .env');
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════╗
║  SimpleStock Backend — avviato            ║
║  Ambiente  : ${(process.env.NODE_ENV || 'development').padEnd(28)}║
║  Porta     : ${String(PORT).padEnd(28)}║
║  API base  : http://localhost:${PORT}${API.padEnd(4)} ║
║  Origini   : ${allowedOrigins[0].slice(0, 28).padEnd(28)}║
╚═══════════════════════════════════════════╝
    `);
  });

  // Graceful shutdown: chiudi le connessioni prima di uscire
  async function shutdown(signal) {
    console.log(`\n[${signal}] Avvio graceful shutdown...`);
    server.close(async () => {
      await prisma.$disconnect();
      console.log('✓ Connessione DB chiusa. Uscita.');
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM')); // Railway stoppa con SIGTERM
  process.on('SIGINT',  () => shutdown('SIGINT'));  // Ctrl+C in sviluppo
}

start();

module.exports = app; // esposto per eventuali test con supertest
