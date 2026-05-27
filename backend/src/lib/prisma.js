// backend/src/lib/prisma.js
// ─────────────────────────────────────────────────────────────────────
//  Singleton Prisma Client
//  Pattern necessario con nodemon: evita di creare N istanze in hot-reload.
//  In produzione (Railway) globalThis.prisma non viene riassegnato.
// ─────────────────────────────────────────────────────────────────────

'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma =
  globalThis.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'info', 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}

module.exports = prisma;
