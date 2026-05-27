'use strict';

const prisma = require('../lib/prisma');

async function resolveInventoryOwner(user) {
  if (!user || !user.id) {
    const err = new Error('Utente non valido');
    err.statusCode = 401;
    throw err;
  }

  const current = await prisma.utente.findUnique({
    where: { id: user.id },
    select: { id: true, ruolo: true, piano: true, nomeNegozio: true, attivo: true },
  });

  if (!current || !current.attivo) {
    const err = new Error('Utente non valido');
    err.statusCode = 401;
    throw err;
  }

  if (current.ruolo === 'admin') {
    return { ownerId: current.id, ownerPlan: current.piano };
  }

  let admin = null;
  if (current.nomeNegozio) {
    admin = await prisma.utente.findFirst({
      where: { ruolo: 'admin', attivo: true, nomeNegozio: current.nomeNegozio },
      select: { id: true, piano: true },
    });
  }

  if (!admin) {
    admin = await prisma.utente.findFirst({
      where: { ruolo: 'admin', attivo: true },
      orderBy: { id: 'asc' },
      select: { id: true, piano: true },
    });
  }

  if (!admin) {
    const err = new Error('Admin non trovato');
    err.statusCode = 404;
    throw err;
  }

  return { ownerId: admin.id, ownerPlan: admin.piano };
}

module.exports = { resolveInventoryOwner };
