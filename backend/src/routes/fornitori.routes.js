// backend/src/routes/fornitori.routes.js
// ─────────────────────────────────────────────────────────────────────
//  Rotte Fornitori
//
//  GET   /api/v1/fornitori        → lista fornitori (tutti gli utenti)
//  GET   /api/v1/fornitori/:id    → dettaglio singolo fornitore
//  POST  /api/v1/fornitori        → crea fornitore (solo admin)
//  PATCH /api/v1/fornitori/:id    → aggiorna fornitore / lead time (solo admin)
//
//  Coerenza Business Plan:
//    - leadTimeGg è il parametro chiave dell'algoritmo riordino §3.3
//    - Piano Premium: fornitori visibili e modificabili (§4.1 BP)
//    - Piano Base: fornitori visibili ma non modificabili
// ─────────────────────────────────────────────────────────────────────

'use strict';

const express         = require('express');
const { z }          = require('zod');
const prisma         = require('../lib/prisma');
const auth           = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');

const router = express.Router();
router.use(auth);

// ── Zod schema ─────────────────────────────────────────────────────

const FornitoreSchema = z.object({
  nome:       z.string().min(1).max(200),
  settore:    z.string().max(100).optional().nullable(),
  email:      z.string().email().optional().nullable(),
  telefono:   z.string().max(30).optional().nullable(),
  indirizzo:  z.string().optional().nullable(),
  leadTimeGg: z.number().int().min(1).max(90).default(3),
  note:       z.string().optional().nullable(),
});

const FornitorePatchSchema = FornitoreSchema.partial();

// ── GET /fornitori ─────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const fornitori = await prisma.fornitore.findMany({
      where:   { attivo: true },
      orderBy: { nome: 'asc' },
      include: {
        _count: { select: { prodotti: true } },
      },
    });

    // Arricchisce con conteggio prodotti associati
    const data = fornitori.map(f => ({
      ...f,
      prodottiAssociati: f._count.prodotti,
      _count: undefined,
    }));

    return res.status(200).json({ fornitori: data });
  } catch (err) {
    console.error('[GET /fornitori]', err);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
});

// ── GET /fornitori/:id ─────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID non valido' });

  try {
    const fornitore = await prisma.fornitore.findFirst({
      where:   { id, attivo: true },
      include: {
        prodotti: {
          where:  { attivo: true },
          select: { id: true, sku: true, nome: true, qtyAttuale: true, unitaMisura: true },
        },
      },
    });

    if (!fornitore) {
      return res.status(404).json({ error: 'Fornitore non trovato', code: 'NOT_FOUND' });
    }

    return res.status(200).json({ fornitore });
  } catch (err) {
    console.error('[GET /fornitori/:id]', err);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
});

// ── POST /fornitori — solo admin ───────────────────────────────────

router.post('/', requireRole('admin'), async (req, res) => {
  const parsed = FornitoreSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: parsed.error.flatten().fieldErrors });
  }

  try {
    const fornitore = await prisma.fornitore.create({
      data: { ...parsed.data, creatoDaId: req.user.id },
    });
    return res.status(201).json({ fornitore });
  } catch (err) {
    console.error('[POST /fornitori]', err);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
});

// ── PATCH /fornitori/:id — solo admin ─────────────────────────────
//  Aggiornamento parziale — utile soprattutto per modificare leadTimeGg
//  che impatta direttamente il calcolo riordino di tutti i prodotti associati.

router.patch('/:id', requireRole('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID non valido' });

  const parsed = FornitorePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: parsed.error.flatten().fieldErrors });
  }

  try {
    const existing = await prisma.fornitore.findFirst({ where: { id, attivo: true } });
    if (!existing) {
      return res.status(404).json({ error: 'Fornitore non trovato', code: 'NOT_FOUND' });
    }

    const fornitore = await prisma.fornitore.update({
      where: { id },
      data:  parsed.data,
    });

    return res.status(200).json({
      fornitore,
      message: parsed.data.leadTimeGg !== undefined
        ? `Lead time aggiornato a ${fornitore.leadTimeGg} gg — i calcoli riordino verranno aggiornati al prossimo refresh.`
        : 'Fornitore aggiornato.',
    });
  } catch (err) {
    console.error('[PATCH /fornitori/:id]', err);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
});

// ── DELETE soft ────────────────────────────────────────────────────

router.delete('/:id', requireRole('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID non valido' });

  try {
    const existing = await prisma.fornitore.findFirst({ where: { id, attivo: true } });
    if (!existing) {
      return res.status(404).json({ error: 'Fornitore non trovato', code: 'NOT_FOUND' });
    }

    await prisma.fornitore.update({
      where: { id },
      data:  { attivo: false },
    });

    return res.status(200).json({ message: `Fornitore "${existing.nome}" eliminato.` });
  } catch (err) {
    console.error('[DELETE /fornitori/:id]', err);
    return res.status(500).json({ error: 'Errore interno del server' });
  }
});

module.exports = router;
