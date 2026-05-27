// backend/prisma/seed.js
// ─────────────────────────────────────────────────────────────────────
//  Seed demo SimpleStock — Business Plan §3.1 personas
//
//  STRATEGIA IDEMPOTENTE:
//    Può essere eseguito più volte senza duplicati.
//    Se l'utente esiste già (dal SQL schema), aggiorna SEMPRE la password
//    con l'hash bcrypt corretto — evita il problema dell'hash placeholder.
//
//  Esegui con: node prisma/seed.js
// ─────────────────────────────────────────────────────────────────────

'use strict';

const { PrismaClient } = require('@prisma/client');
const bcrypt           = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱  Avvio seed SimpleStock...\n');

  // ── 1. CATEGORIE ────────────────────────────────────────────────────
  // update:{} è corretto qui: se il nome esiste basta non toccare nulla
  const [catAlimentari, catBevande, catPulizia] = await Promise.all([
    prisma.categoria.upsert({ where: { nome: 'Alimentari'  }, update: {}, create: { nome: 'Alimentari',  colore: '#185FA5' } }),
    prisma.categoria.upsert({ where: { nome: 'Bevande'     }, update: {}, create: { nome: 'Bevande',     colore: '#1D9E75' } }),
    prisma.categoria.upsert({ where: { nome: 'Pulizia'     }, update: {}, create: { nome: 'Pulizia',     colore: '#B45309' } }),
    prisma.categoria.upsert({ where: { nome: 'Elettronica' }, update: {}, create: { nome: 'Elettronica', colore: '#7C3AED' } }),
    prisma.categoria.upsert({ where: { nome: 'Altro'       }, update: {}, create: { nome: 'Altro',       colore: '#64748B' } }),
  ]);
  console.log('  ✓ Categorie OK');

  // ── 2. UTENTI ────────────────────────────────────────────────────────
  // FIX CRITICO: update include SEMPRE passwordHash
  // → se l'utente esisteva già con hash placeholder dal SQL, viene sovrascritto
  const adminHash = await bcrypt.hash('admin123', 10); // rounds=10: più veloce in dev
  const opHash    = await bcrypt.hash('op1234',   10);

  const marco = await prisma.utente.upsert({
    where:  { email: 'marco@negozio.it' },
    update: {                                // ← aggiorna SEMPRE l'hash
      passwordHash: adminHash,
      ruolo:        'admin',
      piano:        'premium',
      nomeNegozio:  'Alimentari Rossi — Via Roma 12',
    },
    create: {
      nome:         'Marco Rossi',
      email:        'marco@negozio.it',
      passwordHash: adminHash,
      ruolo:        'admin',
      piano:        'premium',
      nomeNegozio:  'Alimentari Rossi — Via Roma 12',
    },
  });

  const luisa = await prisma.utente.upsert({
    where:  { email: 'luisa@ceramiche.it' },
    update: { passwordHash: opHash },        // ← aggiorna SEMPRE l'hash
    create: {
      nome:         'Luisa Bianchi',
      email:        'luisa@ceramiche.it',
      passwordHash: opHash,
      ruolo:        'operatore',
      piano:        'base',
      nomeNegozio:  'Ceramiche Bianchi',
    },
  });

  console.log('  ✓ Utenti OK (hash bcrypt aggiornati)');
  console.log(`    marco.id = ${marco.id} | luisa.id = ${luisa.id}`);

  // ── 3. FORNITORI ────────────────────────────────────────────────────
  // I fornitori possono già esistere dall'INSERT nel MySQL_Schema.sql.
  // Upsert per email (campo univoco di business) — più robusto dell'id numerico.
  // Nota: fornitore non ha @unique su email in schema, usiamo findFirst + create.

  async function upsertFornitore(data) {
    const existing = await prisma.fornitore.findFirst({
      where: { nome: data.nome, attivo: true },
    });
    if (existing) return existing;
    return prisma.fornitore.create({ data });
  }

  const fRossi = await upsertFornitore({ nome: 'Distribuzione Rossi',   settore: 'Alimentari', email: 'rossi@dist.it',        leadTimeGg: 3, creatoDaId: marco.id });
  const fOlio  = await upsertFornitore({ nome: 'Oleificio Meridionale', settore: 'Alimentari', email: 'info@olio.it',          leadTimeGg: 5, creatoDaId: marco.id });
  const fAcqua = await upsertFornitore({ nome: 'AcquaFonte Srl',        settore: 'Bevande',    email: 'ordini@acquafonte.it',  leadTimeGg: 2, creatoDaId: marco.id });
  const fClean = await upsertFornitore({ nome: 'CleanPro Italia',       settore: 'Pulizia',    email: 'cleanpro@gmail.com',    leadTimeGg: 3, creatoDaId: marco.id });

  console.log('  ✓ Fornitori OK');

  // ── 4. PRODOTTI ─────────────────────────────────────────────────────
  // upsert su (sku, creatoDaId) — chiave univoca definita nel schema Prisma.
  // Se esistono già dal SQL (con creato_da = 1 = marco.id): nessun duplicato.

  const prodottiData = [
    { sku: 'ALI-001', nome: 'Farina tipo 00',     catId: catAlimentari.id, unit: 'kg',   qty: 12, soglia: 15, lead: 3, consumo: 5,   fornId: fRossi.id },
    { sku: 'ALI-002', nome: 'Olio extravergine',  catId: catAlimentari.id, unit: 'lt',   qty: 4,  soglia: 10, lead: 5, consumo: 3,   fornId: fOlio.id  },
    { sku: 'ALI-003', nome: 'Passata pomodoro',   catId: catAlimentari.id, unit: 'conf', qty: 28, soglia: 12, lead: 2, consumo: 4,   fornId: fRossi.id },
    { sku: 'PUL-001', nome: 'Detersivo piatti',   catId: catPulizia.id,    unit: 'pz',   qty: 7,  soglia: 5,  lead: 3, consumo: 1.5, fornId: fClean.id },
    { sku: 'BEV-001', nome: 'Acqua minerale 6pk', catId: catBevande.id,    unit: 'conf', qty: 3,  soglia: 8,  lead: 2, consumo: 4,   fornId: fAcqua.id },
    { sku: 'ALI-004', nome: 'Zucchero semolato',  catId: catAlimentari.id, unit: 'kg',   qty: 22, soglia: 8,  lead: 3, consumo: 2,   fornId: fRossi.id },
    { sku: 'ALI-005', nome: 'Pasta spaghetti',    catId: catAlimentari.id, unit: 'conf', qty: 18, soglia: 10, lead: 2, consumo: 3,   fornId: fRossi.id },
    { sku: 'BEV-002', nome: 'Latte intero UHT',   catId: catBevande.id,    unit: 'lt',   qty: 9,  soglia: 12, lead: 1, consumo: 4,   fornId: fAcqua.id },
  ];

  const prodotti = [];
  for (const p of prodottiData) {
    const prod = await prisma.prodotto.upsert({
      where:  { uq_prod_sku_utente: { sku: p.sku, creatoDaId: marco.id } },
      update: {},   // OK qui: i dati prodotto non cambiano tra run
      create: {
        sku:          p.sku,
        nome:         p.nome,
        unitaMisura:  p.unit,
        qtyAttuale:   p.qty,
        sogliaMinima: p.soglia,
        leadTimeGg:   p.lead,
        consumoMedio: p.consumo,
        categoriaId:  p.catId,
        fornitoreId:  p.fornId,
        creatoDaId:   marco.id,
      },
    });
    prodotti.push(prod);
  }
  console.log(`  ✓ ${prodotti.length} prodotti OK`);

  // ── 5. MOVIMENTI ────────────────────────────────────────────────────
  // Inserisce movimenti solo se la tabella è vuota — evita duplicati a ogni run.
  const movCount = await prisma.movimento.count();
  if (movCount > 0) {
    console.log(`  ↷ Movimenti già presenti (${movCount}) — skip`);
  } else {
    const movimentiData = [
      { pIdx: 0, tipo: 'scarico', qty: 3,  note: 'Vendita mattina',         daysAgo: 0 },
      { pIdx: 2, tipo: 'carico',  qty: 12, note: 'Consegna Rossi',           daysAgo: 0 },
      { pIdx: 1, tipo: 'scarico', qty: 2,  note: 'Vendita',                  daysAgo: 1 },
      { pIdx: 4, tipo: 'scarico', qty: 2,  note: 'Vendita acqua',            daysAgo: 1 },
      { pIdx: 0, tipo: 'scarico', qty: 5,  note: 'Ordine panetteria',        daysAgo: 2 },
      { pIdx: 0, tipo: 'carico',  qty: 20, note: 'Rifornimento settimanale', daysAgo: 3 },
      { pIdx: 4, tipo: 'scarico', qty: 3,  note: 'Vendita',                  daysAgo: 4 },
      { pIdx: 1, tipo: 'scarico', qty: 1,  note: 'Uso interno',              daysAgo: 5 },
      { pIdx: 7, tipo: 'scarico', qty: 4,  note: 'Vendita latte',            daysAgo: 1 },
      { pIdx: 5, tipo: 'carico',  qty: 10, note: 'Ordine settimanale',       daysAgo: 2 },
    ];

    for (const m of movimentiData) {
      const p    = prodotti[m.pIdx];
      const data = new Date();
      data.setDate(data.getDate() - m.daysAgo);
      data.setHours(8 + Math.floor(Math.random() * 9));
      data.setMinutes(Math.floor(Math.random() * 60));

      const prodottoDb = await prisma.prodotto.findUnique({
        where: { id: p.id },
        select: { qtyAttuale: true },
      });

      const qtyPrima = Number(prodottoDb?.qtyAttuale ?? 0);
      if (m.tipo === 'scarico' && m.qty > qtyPrima) {
        throw new Error(`Seed movimenti: scarico ${m.qty} > disponibilita ${qtyPrima}`);
      }

      const qtyDopo  = m.tipo === 'carico'
        ? qtyPrima + m.qty
        : Math.max(0, qtyPrima - m.qty);

      await prisma.movimento.create({
        data: {
          prodottoId: p.id,
          utenteId:   marco.id,
          tipo:       m.tipo,
          quantita:   m.qty,
          qtyPrima,
          qtyDopo,
          note:       m.note || null,
          fonte:      'manuale',
          createdAt:  data,
        },
      });
    }
    console.log(`  ✓ ${movimentiData.length} movimenti creati`);
  }

  // ── RIEPILOGO ────────────────────────────────────────────────────────
  console.log('\n✅  Seed completato!\n');
  console.log('   ┌─────────────────────────────────────────────────┐');
  console.log('   │  Credenziali demo                               │');
  console.log('   │  Admin    : marco@negozio.it   / admin123       │');
  console.log('   │  Operatore: luisa@ceramiche.it / op1234         │');
  console.log('   └─────────────────────────────────────────────────┘');
}

main()
  .catch(err => {
    console.error('\n❌  Errore seed:', err.message);
    if (err.code === 'P1001') {
      console.error('   → MySQL non raggiungibile. Verifica DATABASE_URL in .env e che XAMPP sia avviato.');
    }
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
