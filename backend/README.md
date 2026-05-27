# SimpleStock — Avvio Demo Locale
**Team 2 · 9 · 10 · Consegna 31 maggio 2026**

Stack: `Node.js 20` + `Express` + `Prisma` + `MySQL 8` (XAMPP) + frontend HTML puro

---

## Prerequisiti (installa una volta sola)

| Tool | Link | Verifica |
|------|------|---------|
| Node.js 20 LTS | https://nodejs.org | `node --version` |
| XAMPP (MySQL + phpMyAdmin) | https://apachefriends.org | apri http://localhost/phpmyadmin |
| VS Code (consigliato) | https://code.visualstudio.com | — |

---

## 1 — Database MySQL (phpMyAdmin)

1. Apri XAMPP → **Start** su Apache e MySQL
2. Vai su http://localhost/phpmyadmin
3. Clicca **SQL** → incolla il contenuto di `MySQL_Schema.sql` → **Esegui**
   - Crea il database `simplestock` con tutte le tabelle + dati seed
   - Crea anche il trigger `tg_after_movimento_insert`

---

## 2 — Backend Node.js

```bash
# Entra nella cartella backend
cd backend

# Installa dipendenze
npm install

# Copia il file di configurazione e compilalo
cp .env.example .env
# (Windows) copy .env.example .env
```

Apri `.env` e verifica/modifica:
```
DATABASE_URL="mysql://root:root@localhost:3306/simplestock"
# Se il tuo MySQL non ha password, usa: mysql://root:@localhost:3306/simplestock
JWT_SECRET="genera-con-node-e-console-log-crypto-randomBytes-32-toString-hex"
JWT_REFRESH_SECRET="altra-stringa-diversa-32-char"
```

```bash
# Genera il Prisma Client (legge schema.prisma)
npx prisma generate

# Popola il DB con utenti e movimenti demo
node prisma/seed.js

# Avvia il server (porta 3001)
npm run dev
```

**Verifica**: apri http://localhost:3001/health — deve rispondere `{"status":"ok","db":"connected"}`

---

## 3 — Frontend HTML

```bash
# Dal terminale, nella root del progetto
npx serve .
# oppure: apri simplestock_demo.html direttamente con VS Code Live Server
```

Poi vai su **http://localhost:3000/simplestock_demo.html** (o porta che `serve` indica).

> ⚠️ **Non aprire il file con doppio clic** (file://) — i browser bloccano le
> richieste fetch verso localhost da file:// per via del CORS. Usa sempre un server locale.

---

## Credenziali demo

| Utente | Email | Password | Ruolo | Piano |
|--------|-------|----------|-------|-------|
| Marco Rossi | marco@negozio.it | admin123 | admin | premium |
| Luisa Bianchi | luisa@ceramiche.it | op1234 | operatore | base |

---

## Struttura file generati

```
simplestock/
├── simplestock_demo.html          ← frontend demo (apri nel browser)
│
└── backend/
    ├── .env.example               ← copia in .env e compila
    ├── package.json
    ├── prisma/
    │   ├── schema.prisma          ← modelli DB (Prisma ORM)
    │   └── seed.js                ← dati demo (Marco, prodotti, movimenti)
    └── src/
        ├── server.js              ← entry point Express + CORS
        ├── lib/
        │   └── prisma.js          ← singleton Prisma Client
        ├── middleware/
        │   ├── auth.js            ← verifica JWT Bearer token
        │   └── roles.js           ← guard ruolo (admin) e piano (premium)
        ├── services/
        │   └── riordino.service.js ← algoritmo §3.3 Business Plan
        └── routes/
            ├── auth.routes.js     ← POST /login /refresh /logout · GET /me
            ├── prodotti.routes.js ← CRUD + ordinamento scorta bassa (MUST)
            ├── movimenti.routes.js← POST/GET carico/scarico + transazione atomica
            ├── riordini.routes.js ← GET suggerimenti + POST conferma (Premium)
            └── fornitori.routes.js← GET/POST/PATCH fornitori + lead time
```

---

## API Reference rapida

```
Base URL: http://localhost:3001/api/v1

POST  /auth/login              { email, password }
POST  /auth/refresh            { refreshToken }
POST  /auth/logout             { refreshToken }
GET   /auth/me                 → utente corrente

GET   /prodotti                → lista ordinata per scorta bassa
GET   /prodotti/:id
POST  /prodotti                (admin) { nome, sku, unitaMisura, qtyAttuale, sogliaMinima, ... }
PATCH /prodotti/:id            (admin) { campi parziali }
DELETE/prodotti/:id            (admin) soft-delete

POST  /movimenti               { prodottoId, tipo: 'carico'|'scarico', quantita }
GET   /movimenti               ?tipo=carico|scarico &limit=50

GET   /riordini/suggerimenti   ?copertura=14
POST  /riordini/:id/conferma   (premium) { qtyOrdinata, coperturaDays }

GET   /fornitori
PATCH /fornitori/:id           (admin) { leadTimeGg, ... }
```

---

## Troubleshooting comune

| Problema | Causa | Soluzione |
|----------|-------|-----------|
| `CORS error` nel browser | frontend aperto con `file://` | usa `npx serve` o Live Server |
| `Cannot connect to DB` | MySQL non avviato | avvia MySQL da XAMPP |
| `P1001 Can't reach DB` | DATABASE_URL sbagliata | controlla host/porta/nome db in `.env` |
| `JWT_SECRET is not defined` | `.env` non caricato | verifica che il file `.env` esista nella cartella `backend/` |
| `Token non valido` dopo riavvio | JWT_SECRET cambiato | fai logout e login di nuovo |
| `Piano Base: limite 50 prodotti` | piano limitato | login con marco@negozio.it (piano premium) |
