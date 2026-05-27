# SimpleStock

SimpleStock è un gestionale magazzino full-stack per microimprese. Il monorepo include un frontend demo HTML/JS e un backend Node.js/Express professionale con MySQL 8 e Prisma.

## Architettura (ACID-compliant)
- MySQL InnoDB + transazioni Prisma garantiscono aggiornamenti stock atomici e letture consistenti.
- Trigger `tg_after_movimento_insert` per aggiornare automaticamente `qty_attuale` e `consumo_medio`.
- REST API versionata sotto `/api/v1`, con CORS configurabile.

## Motore riordino (5 step)
1. `consumo_medio`: media mobile ponderata 30 gg, aggiornata ad ogni `scarico`.
2. `autonomia_gg = qty_attuale / consumo_medio`.
3. `lead_time_gg` da fornitore/prodotto.
4. Trigger quando `autonomia_gg <= lead_time_gg + buffer` (buffer = 2 gg).
5. `qty_suggerita = consumo_medio * (lead_time_gg + copertura_target)`.

## Sicurezza
- JWT access token (15m) + refresh token (7d) con rotation e revoca lato server.
- Password hashing con bcrypt.

## Setup locale
### 1) Database
1. Avvia MySQL (XAMPP o server locale).
2. Importa [backend/MySQL_Schema.sql](backend/MySQL_Schema.sql) per creare database, tabelle, view e trigger.

### 2) Backend
```bash
cd backend
npm install
copy .env.example .env
# macOS/Linux: cp .env.example .env
npx prisma generate
node prisma/seed.js
npm run dev
```

### 3) Frontend demo
```bash
# dalla root del repository
npx serve .
```
Apri http://localhost:3000/simplestock_demo.html (non usare file:// per evitare problemi CORS).

## Credenziali demo
- Marco Rossi
  - Email: marco@negozio.it
  - Password: admin123

## Variabili ambiente
Vedi [backend/.env.example](backend/.env.example) per la lista completa. Chiavi richieste:
- `DATABASE_URL` (formato mysql)
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `PORT=3001`
- `CORS_ORIGIN`
