// backend/src/routes/movimenti.routes.js
// ─────────────────────────────────────────────────────────────────────
//  Rotte Movimenti (carico / scarico)
//
//  POST /api/v1/movimenti          → registra nuovo movimento (MUST)
//  GET  /api/v1/movimenti          → storico movimenti (con filtri)
//  GET  /api/v1/movimenti/:id      → singolo movimento
//
//  TRANSAZIONE ATOMICA (Prisma $transaction):
//    1. Leggi prodotto + lock (findFirstOrThrow)
//    2. Valida scarico: qty > disponibile → 400
//    3. Calcola qtyPrima / qtyDopo
//    4. Crea movimento con snapshot qty_prima / qty_dopo
//       (il trigger DB aggiorna qtyAttuale + consumoMedio)
//    → Tutto in un'unica transaction: o tutto OK o tutto rollback
//
//  Piano Base: storico limitato agli ultimi 30 giorni (§4.1 BP, tabella piani)
//  Piano Premium: storico illimitato + export CSV
// ─────────────────────────────────────────────────────────────────────

'use strict';

const express = require('express');
const { z }   = require('zod');
const prisma  = require('../lib/prisma');
const auth    = require('../middleware/auth');
const { aggiornaConsumoMedio } = require('../services/riordino.service');
const { resolveInventoryOwner } = require('../services/inventory-owner.service');

const router = express.Router();

router.use(auth);

// ── Zod schema ─────────────────────────────────────────────────────

const MovimentoSchema = z.object({
  prodottoId: z.number().int().positive(),
  tipo:       z.enum(['carico', 'scarico']),
  quantita:   z.number().positive('La quantità deve essere > 0'),
  note:       z.string().max(500).optional().nullable(),
  fonte:      z.enum(['manuale', 'riordino_confermato', 'import_csv']).default('manuale'),
});

// ── POST /movimenti ────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const parsed = MovimentoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: parsed.error.flatten().fieldErrors });
  }

  const { prodottoId, tipo, quantita, note, fonte } = parsed.data;

  try {
    const { ownerId } = await resolveInventoryOwner(req.user);
    const result = await prisma.$transaction(async (tx) => {

      // 1. Leggi prodotto — lancia eccezione se non esiste
      const prodotto = await tx.prodotto.findFirstOrThrow({
        where: { id: prodottoId, attivo: true, creatoDaId: ownerId },
      });

      const qtyAttuale = Number(prodotto.qtyAttuale);

      // 2. Validazione scarico
      if (tipo === 'scarico' && quantita > qtyAttuale) {
        throw Object.assign(
          new Error(`Quantità scarico (${quantita}) superiore alla disponibilità (${qtyAttuale} ${prodotto.unitaMisura})`),
          { statusCode: 400, code: 'INSUFFICIENT_STOCK' }
        );
      }

      const qtyPrima = qtyAttuale;
      const qtyDopo  =
        tipo === 'carico'
          ? qtyAttuale + quantita
          : Math.max(0, qtyAttuale - quantita);

      // 3. Aggiornamento consumo medio (solo su scarico)
      //    Formula: ROUND(vecchio * 0.8 + qty_scaricata * 0.2, 3)
      const nuovoConsumo =
        tipo === 'scarico'
          ? aggiornaConsumoMedio(prodotto.consumoMedio, quantita)
          : Number(prodotto.consumoMedio);

      // 4. Crea movimento con snapshot
      const movimento = await tx.movimento.create({
        data: {
          prodottoId,
          utenteId: req.user.id,
          tipo,
          quantita,
          qtyPrima,
          qtyDopo,
          note:  note || null,
          fonte,
        },
        include: {
          prodotto: { select: { id: true, nome: true, sku: true, unitaMisura: true } },
          utente:   { select: { id: true, nome: true } },
        },
      });

      return { movimento, qtyDopo, nuovoConsumo };
    });

    return res.status(201).json({
      movimento:    result.movimento,
      qtyDopoAggiornata: result.qtyDopo,
      consumoMedioAggiornato: result.nuovoConsumo,
    });

  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Prodotto non trovato', code: 'NOT_FOUND' });
    }
    console.error('[POST /movimenti]', err);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
});

// ── GET /movimenti ─────────────────────────────────────────────────
//  Query params:
//    ?prodottoId=<id>
//    ?tipo=carico|scarico
//    ?da=<ISO date>    (Piano Premium — storico illimitato)
//    ?a=<ISO date>
//    ?limit=50 &offset=0

router.get('/', async (req, res) => {
  try {
    const { ownerId } = await resolveInventoryOwner(req.user);
    const { prodottoId, tipo, da, a, limit = '50', offset = '0' } = req.query;

    const where = {};

    // Filtro per ownership (solo prodotti dell'utente corrente)
    where.prodotto = { creatoDaId: ownerId };

    if (prodottoId) where.prodottoId = parseInt(prodottoId);
    if (tipo)       where.tipo = tipo;

    // Piano Base: storico limitato agli ultimi 30 giorni
    const isBase = req.user.piano === 'base';
    if (isBase) {
      const trentaGgFa = new Date();
      trentaGgFa.setDate(trentaGgFa.getDate() - 30);
      where.createdAt = { gte: trentaGgFa };
    } else {
      // Piano Premium: filtri data opzionali
      if (da || a) {
        where.createdAt = {};
        if (da) where.createdAt.gte = new Date(da);
        if (a)  where.createdAt.lte = new Date(a);
      }
    }

    const [movimenti, totale] = await Promise.all([
      prisma.movimento.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take:    parseInt(limit),
        skip:    parseInt(offset),
        include: {
          prodotto: { select: { id: true, nome: true, sku: true, unitaMisura: true } },
          utente:   { select: { id: true, nome: true } },
        },
      }),
      prisma.movimento.count({ where }),
    ]);

    return res.status(200).json({
      movimenti,
      meta: {
        totale,
        limit:       parseInt(limit),
        offset:      parseInt(offset),
        pianoBase:   isBase,
        limitatoA30gg: isBase,
      },
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('[GET /movimenti]', err);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
});

// ── GET /movimenti/:id ─────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID non valido' });

  try {
    const { ownerId } = await resolveInventoryOwner(req.user);
    const movimento = await prisma.movimento.findFirst({
      where: {
        id,
        prodotto: { creatoDaId: ownerId },
      },
      include: {
        prodotto: { select: { id: true, nome: true, sku: true, unitaMisura: true } },
        utente:   { select: { id: true, nome: true } },
      },
    });

    if (!movimento) {
      return res.status(404).json({ error: 'Movimento non trovato', code: 'NOT_FOUND' });
    }

    return res.status(200).json({ movimento });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('[GET /movimenti/:id]', err);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
});

module.exports = router;
