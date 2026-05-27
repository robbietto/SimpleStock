// backend/src/routes/prodotti.routes.js
// ─────────────────────────────────────────────────────────────────────
//  CRUD Prodotti + rotta "scorta bassa" (MUST §2.4 Business Plan)
//
//  GET    /api/v1/prodotti           → lista prodotti ordinata per scorta bassa
//  GET    /api/v1/prodotti/:id       → dettaglio singolo prodotto
//  POST   /api/v1/prodotti           → crea prodotto (solo admin)
//  PATCH  /api/v1/prodotti/:id       → aggiorna prodotto (solo admin)
//  DELETE /api/v1/prodotti/:id       → soft-delete prodotto (solo admin)
//
//  PIANO BASE vs PREMIUM:
//    Piano Base  → max 50 prodotti (MUST §2.4, tabella piani)
//    Piano Premium → prodotti illimitati
// ─────────────────────────────────────────────────────────────────────

'use strict';

const express              = require('express');
const { z }                = require('zod');
const prisma               = require('../lib/prisma');
const auth                 = require('../middleware/auth');
const { requireRole }      = require('../middleware/roles');
const { calcolaRiordine }  = require('../services/riordino.service');
const { resolveInventoryOwner } = require('../services/inventory-owner.service');

const router = express.Router();

// Tutte le rotte richiedono autenticazione
router.use(auth);

// ── Zod schema prodotto ────────────────────────────────────────────

const ProdottoSchema = z.object({
  nome:           z.string().min(1, 'Nome obbligatorio').max(200),
  sku:            z.string().min(1).max(50),
  descrizione:    z.string().optional(),
  unitaMisura:    z.enum(['pz','kg','lt','conf','g','ml','m','altro']).default('pz'),
  qtyAttuale:     z.number().min(0).default(0),
  sogliaMinima:   z.number().min(0).default(0),
  leadTimeGg:     z.number().int().min(1).max(60).default(3),
  consumoMedio:   z.number().min(0).default(1),
  prezzoAcquisto: z.number().positive().optional().nullable(),
  note:           z.string().optional().nullable(),
  categoriaId:    z.number().int().positive().optional().nullable(),
  fornitoreId:    z.number().int().positive().optional().nullable(),
});

const ProdottoPatchSchema = ProdottoSchema.partial();

// ── Funzioni helper ────────────────────────────────────────────────

/**
 * Calcola lo "stato scorta" di un prodotto (mirror della VIEW v_stock_status).
 * Usato per l'ordinamento e per arricchire la risposta JSON.
 */
function getStatoScorta(p) {
  const qty     = Number(p.qtyAttuale);
  const soglia  = Number(p.sogliaMinima);

  if (qty <= 0)              return 'esaurito';   // priorità 0 — peggiore
  if (qty < soglia)          return 'critico';    // priorità 1
  if (qty < soglia * 1.5)    return 'attenzione'; // priorità 2
  return 'ok';                                    // priorità 3
}

const STATO_RANK = { esaurito: 0, critico: 1, attenzione: 2, ok: 3 };

/**
 * Arricchisce un prodotto Prisma con i campi calcolati dall'algoritmo riordino.
 * Rispecchia esattamente la VIEW v_stock_status di MySQL_Schema.sql.
 */
function enrichProdotto(p, coperturaDays = 14) {
  const stato    = getStatoScorta(p);
  const riordino = calcolaRiordine(p, coperturaDays);

  return {
    ...p,
    // Campi calcolati (come nella VIEW MySQL)
    _stato_scorta:   stato,
    _autonomia_gg:   riordino.step2_autonomiaGg,
    _trigger_gg:     riordino.step4_triggerGg,
    _da_riordinare:  riordino.step4_needsOrder,
    _qty_suggerita:  riordino.step5_qtySuggerita,
  };
}

/** Include comuni per tutti i findMany/findUnique */
const INCLUDE_FULL = {
  categoria:  { select: { id: true, nome: true, colore: true } },
  fornitore:  { select: { id: true, nome: true, leadTimeGg: true, email: true } },
  creatoDa:   { select: { id: true, nome: true } },
};

// ── GET /prodotti ─────────────────────────────────────────────────
//
//  Query params:
//    ?categoria=<nome>          filtro categoria
//    ?search=<testo>            ricerca per nome/sku (ILIKE)
//    ?stato=critico|attenzione|ok|esaurito  filtro stato scorta
//    ?daRiordinare=true         mostra solo prodotti da riordinare
//    ?copertura=<gg>            giorni copertura per l'algoritmo (default 14)
//    ?limit=<n>                 paginazione (default 100)
//    ?offset=<n>
//
//  ORDINAMENTO PRINCIPALE: per gravità scorta (esaurito → ok),
//  poi per ratio qty/soglia ASC dentro ogni gruppo.

router.get('/', async (req, res) => {
  try {
    const { ownerId } = await resolveInventoryOwner(req.user);
    const {
      categoria,
      search,
      stato,
      daRiordinare,
      copertura,
      limit  = '100',
      offset = '0',
    } = req.query;

    const coperturaDays = parseInt(copertura) || 14;

    // ── Build filtro WHERE Prisma ──────────────────────────────────
    const where = {
      attivo:    true,
      creatoDaId: ownerId,
    };

    if (categoria) {
      where.categoria = { nome: { equals: categoria } };
    }

    if (search) {
      where.OR = [
        { nome: { contains: search } },
        { sku:  { contains: search } },
      ];
    }

    // ── Query DB ───────────────────────────────────────────────────
    const prodotti = await prisma.prodotto.findMany({
      where,
      include: INCLUDE_FULL,
      take:    parseInt(limit),
      skip:    parseInt(offset),
    });

    // ── Arricchimento con campi calcolati ──────────────────────────
    let enriched = prodotti.map(p => enrichProdotto(p, coperturaDays));

    // ── Filtri post-query (su campi calcolati) ─────────────────────
    if (stato) {
      enriched = enriched.filter(p => p._stato_scorta === stato);
    }

    if (daRiordinare === 'true') {
      enriched = enriched.filter(p => p._da_riordinare);
    }

    // ── ORDINAMENTO: scorta bassa prima (MUST) ─────────────────────
    //  Criterio primario:   STATO_RANK (esaurito=0, critico=1, ...)
    //  Criterio secondario: ratio qty/soglia ASC (peggiore = valore più basso)
    //  Criterio terziario:  nome ASC (stabilizza l'ordinamento)
    enriched.sort((a, b) => {
      const rankA = STATO_RANK[a._stato_scorta];
      const rankB = STATO_RANK[b._stato_scorta];

      if (rankA !== rankB) return rankA - rankB;

      // Stesso stato: ordina per autonomia residua (giorni) ASC
      const autoA = a._autonomia_gg === Infinity ? 9999 : a._autonomia_gg;
      const autoB = b._autonomia_gg === Infinity ? 9999 : b._autonomia_gg;
      if (autoA !== autoB) return autoA - autoB;

      return a.nome.localeCompare(b.nome, 'it');
    });

    // ── KPI aggregati per la Dashboard ────────────────────────────
    const kpi = {
      totale:      enriched.length,
      esauriti:    enriched.filter(p => p._stato_scorta === 'esaurito').length,
      critici:     enriched.filter(p => p._stato_scorta === 'critico').length,
      attenzione:  enriched.filter(p => p._stato_scorta === 'attenzione').length,
      ok:          enriched.filter(p => p._stato_scorta === 'ok').length,
      daRiordinare: enriched.filter(p => p._da_riordinare).length,
    };

    return res.status(200).json({
      prodotti: enriched,
      kpi,
      meta: {
        limit:    parseInt(limit),
        offset:   parseInt(offset),
        coperturaDays,
      },
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('[GET /prodotti]', err);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
});

// ── GET /prodotti/:id ─────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID non valido' });

  try {
    const { ownerId } = await resolveInventoryOwner(req.user);
    const prodotto = await prisma.prodotto.findFirst({
      where:   { id, attivo: true, creatoDaId: ownerId },
      include: {
        ...INCLUDE_FULL,
        movimenti: {
          orderBy: { createdAt: 'desc' },
          take:    20,
          include: { utente: { select: { id: true, nome: true } } },
        },
        riordini: {
          orderBy: { createdAt: 'desc' },
          take:    5,
        },
      },
    });

    if (!prodotto) {
      return res.status(404).json({ error: 'Prodotto non trovato', code: 'NOT_FOUND' });
    }

    return res.status(200).json({ prodotto: enrichProdotto(prodotto) });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error('[GET /prodotti/:id]', err);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
});

// ── POST /prodotti ────────────────────────────────────────────────
// Solo admin. Piano Base: max 50 SKU.

router.post('/', requireRole('admin'), async (req, res) => {
  const parsed = ProdottoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: parsed.error.flatten().fieldErrors });
  }

  try {
    // Piano Base: controlla limite 50 prodotti
    if (req.user.piano === 'base') {
      const count = await prisma.prodotto.count({
        where: { creatoDaId: req.user.id, attivo: true },
      });
      if (count >= 50) {
        return res.status(403).json({
          error: 'Piano Base: limite di 50 prodotti raggiunto. Aggiorna al piano Premium.',
          code:  'PLAN_LIMIT_REACHED',
        });
      }
    }

    const {
      nome, sku, descrizione, unitaMisura, qtyAttuale,
      sogliaMinima, leadTimeGg, consumoMedio, prezzoAcquisto,
      note, categoriaId, fornitoreId,
    } = parsed.data;

    const prodotto = await prisma.prodotto.create({
      data: {
        nome, sku, descrizione, unitaMisura,
        qtyAttuale:     qtyAttuale     ?? 0,
        sogliaMinima:   sogliaMinima   ?? 0,
        leadTimeGg:     leadTimeGg     ?? 3,
        consumoMedio:   consumoMedio   ?? 1,
        prezzoAcquisto: prezzoAcquisto ?? null,
        note:           note           ?? null,
        creatoDaId:     req.user.id,
        categoriaId:    categoriaId    ?? null,
        fornitoreId:    fornitoreId    ?? null,
      },
      include: INCLUDE_FULL,
    });

    return res.status(201).json({ prodotto: enrichProdotto(prodotto) });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: `SKU "${req.body.sku}" già esistente. Usa un codice diverso.`,
        code:  'DUPLICATE_SKU',
      });
    }
    console.error('[POST /prodotti]', err);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
});

// ── PATCH /prodotti/:id ───────────────────────────────────────────
// Solo admin. Aggiornamento parziale.

router.patch('/:id', requireRole('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID non valido' });

  const parsed = ProdottoPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: parsed.error.flatten().fieldErrors });
  }

  try {
    // Verifica ownership
    const existing = await prisma.prodotto.findFirst({
      where: { id, attivo: true, creatoDaId: req.user.id },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Prodotto non trovato', code: 'NOT_FOUND' });
    }

    const prodotto = await prisma.prodotto.update({
      where:   { id },
      data:    parsed.data,
      include: INCLUDE_FULL,
    });

    return res.status(200).json({ prodotto: enrichProdotto(prodotto) });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'SKU già esistente', code: 'DUPLICATE_SKU' });
    }
    console.error('[PATCH /prodotti/:id]', err);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
});

// ── DELETE /prodotti/:id ──────────────────────────────────────────
// Soft-delete (attivo = false) — i movimenti storici rimangono intatti.

router.delete('/:id', requireRole('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID non valido' });

  try {
    const existing = await prisma.prodotto.findFirst({
      where: { id, attivo: true, creatoDaId: req.user.id },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Prodotto non trovato', code: 'NOT_FOUND' });
    }

    await prisma.prodotto.update({
      where: { id },
      data:  { attivo: false },
    });

    return res.status(200).json({ message: `Prodotto "${existing.nome}" eliminato.` });
  } catch (err) {
    console.error('[DELETE /prodotti/:id]', err);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
});

module.exports = router;
