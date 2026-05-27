// backend/src/routes/riordini.routes.js
// ─────────────────────────────────────────────────────────────────────
//  Rotte Suggerimenti Riordino (SHOULD §2.4 BP → Premium)
//
//  GET  /api/v1/riordini/suggerimenti  → prodotti da riordinare (algoritmo §3.3)
//  POST /api/v1/riordini/:id/conferma  → conferma ordine, registra carico
//
//  Piano Premium: questa rotta è disponibile solo per utenti premium.
//  Piano Base: suggerimento visibile ma bloccato al click (paywall).
//  → In questa implementazione, GET è aperto a tutti (visibilità), POST è premium.
// ─────────────────────────────────────────────────────────────────────

'use strict';

const express               = require('express');
const { z }                 = require('zod');
const prisma                = require('../lib/prisma');
const auth                  = require('../middleware/auth');
const { requirePlan, requireRole } = require('../middleware/roles');
const { resolveInventoryOwner } = require('../services/inventory-owner.service');
const {
  calcolaRiordiniPerLista,
  calcolaRiordine,
}                           = require('../services/riordino.service');

const router = express.Router();
router.use(auth);

// ── GET /suggerimenti ──────────────────────────────────────────────
//  Query params: ?copertura=14 (giorni di copertura target)

router.get('/suggerimenti', async (req, res) => {
  const coperturaDays = parseInt(req.query.copertura) || 14;

  try {
    const { ownerId } = await resolveInventoryOwner(req.user);
    const prodotti = await prisma.prodotto.findMany({
      where: { attivo: true, creatoDaId: ownerId },
      include: {
        categoria:  { select: { id: true, nome: true, colore: true } },
        fornitore:  { select: { id: true, nome: true, leadTimeGg: true, email: true } },
      },
    });

    const { daRiordinare, scorteOk } = calcolaRiordiniPerLista(prodotti, coperturaDays);

    // Per ogni prodotto da riordinare, struttura la risposta step-by-step
    const suggerimenti = daRiordinare.map(({ prodotto, riordino }) => ({
      prodotto: {
        id:          prodotto.id,
        sku:         prodotto.sku,
        nome:        prodotto.nome,
        unitaMisura: prodotto.unitaMisura,
        qtyAttuale:  Number(prodotto.qtyAttuale),
        sogliaMinima: Number(prodotto.sogliaMinima),
        categoria:   prodotto.categoria,
        fornitore:   prodotto.fornitore,
      },
      calcolo: {
        step1_consumoMedio:  riordino.step1_consumoMedio,
        step2_autonomiaGg:   riordino.step2_autonomiaGg,
        step3_leadTimeGg:    riordino.step3_leadTimeGg,
        step4_triggerGg:     riordino.step4_triggerGg,
        step4_needsOrder:    riordino.step4_needsOrder,
        step5_qtySuggerita:  riordino.step5_qtySuggerita,
        bufferGg:            riordino.bufferGg,
        coperturaDays:       riordino.coperturaDays,
      },
    }));

    return res.status(200).json({
      suggerimenti,
      scorteOk: scorteOk.map(({ prodotto, riordino }) => ({
        id:            prodotto.id,
        nome:          prodotto.nome,
        sku:           prodotto.sku,
        qtyAttuale:    Number(prodotto.qtyAttuale),
        autonomiaGg:   riordino.step2_autonomiaGg,
        triggerGg:     riordino.step4_triggerGg,
      })),
      meta: { coperturaDays, totaleDaRiordinare: suggerimenti.length },
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('[GET /riordini/suggerimenti]', err);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
});

// ── POST /:prodottoId/conferma (Premium only) ──────────────────────
//  Conferma il riordine: crea un RiordineLog + registra un movimento di carico.
//  Body: { qtyOrdinata: number, coperturaDays?: number }

const ConfermaSchema = z.object({
  qtyOrdinata:   z.number().positive(),
  coperturaDays: z.number().int().min(1).max(90).default(14),
  note:          z.string().optional(),
});

router.post('/:prodottoId/conferma', requireRole('admin'), requirePlan('premium'), async (req, res) => {
  const prodottoId = parseInt(req.params.prodottoId);
  if (!prodottoId) return res.status(400).json({ error: 'ID prodotto non valido' });

  const parsed = ConfermaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: parsed.error.flatten().fieldErrors });
  }

  const { qtyOrdinata, coperturaDays, note } = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const prodotto = await tx.prodotto.findFirstOrThrow({
        where: { id: prodottoId, attivo: true, creatoDaId: req.user.id },
      });

      const riordino      = calcolaRiordine(prodotto, coperturaDays);
      const qtyPrima      = Number(prodotto.qtyAttuale);
      const qtyDopo       = qtyPrima + qtyOrdinata;

      // Registra movimento carico: il trigger MySQL aggiorna qty_attuale.
      await tx.movimento.create({
        data: {
          prodottoId,
          utenteId: req.user.id,
          tipo:     'carico',
          quantita: qtyOrdinata,
          qtyPrima,
          qtyDopo,
          note:     note || 'Riordine confermato',
          fonte:    'riordino_confermato',
        },
      });

      // Salva log riordine
      const log = await tx.riordineLog.create({
        data: {
          prodottoId,
          utenteId:                req.user.id,
          fornitoreId:             prodotto.fornitoreId,
          qtySuggerita:            riordino.step5_qtySuggerita,
          qtyOrdinata,
          consumoMedioAlMomento:   riordino.step1_consumoMedio,
          autonomiaGg:             riordino.step2_autonomiaGg === Infinity ? null : riordino.step2_autonomiaGg,
          leadTimeGg:              riordino.step3_leadTimeGg,
          coperturTargetGg:        coperturaDays,
          stato:                   'confermato',
          note:                    note || null,
        },
      });

      return { log, qtyDopo };
    });

    return res.status(201).json({
      message:     'Riordine confermato e movimento di carico registrato.',
      riordineLog: result.log,
      nuovaQty:    result.qtyDopo,
    });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Prodotto non trovato', code: 'NOT_FOUND' });
    }
    console.error('[POST /riordini/:id/conferma]', err);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
});

module.exports = router;
