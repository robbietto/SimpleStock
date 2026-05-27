// backend/src/services/riordino.service.js
// ─────────────────────────────────────────────────────────────────────
//  Algoritmo suggerimento riordino — replica esatta §3.3 Business Plan
//  e §2.5 del Business Plan (motore decisionale trasparente step-by-step).
//
//  Il calcolo è STATELESS: riceve i dati del prodotto e ritorna il risultato.
//  Questo permette di usare la stessa logica nel frontend (business.js)
//  e nel backend senza duplicare la business logic.
//
//  ALGORITMO (5 step, come da Business Plan §2.5):
//    Step 1 — consumo_medio  : media mobile ponderata degli ultimi 30 gg
//                              (aggiornata ad ogni scarico, salvata su prodotto)
//    Step 2 — autonomia_gg   : qty_attuale / consumo_medio
//    Step 3 — lead_time_gg   : parametro configurabile per fornitore/prodotto
//    Step 4 — trigger        : autonomia_gg <= lead_time_gg + BUFFER (2 gg)
//    Step 5 — qty_suggerita  : consumo_medio * (lead_time_gg + copertura_target)
// ─────────────────────────────────────────────────────────────────────

'use strict';

const BUFFER_GG = 2;            // giorni di sicurezza extra oltre il lead time
const COPERTURA_DEFAULT = 14;   // giorni di copertura target default (configurabile in Settings)

/**
 * Calcola se un prodotto deve essere riordinato e la quantità suggerita.
 *
 * @param {Object}  prodotto
 * @param {number}  prodotto.qtyAttuale     - scorta attuale
 * @param {number}  prodotto.consumoMedio   - media mobile giornaliera
 * @param {number}  prodotto.leadTimeGg     - giorni di lead time fornitore
 * @param {number}  [coperturaDays]         - giorni di copertura target (default: 14)
 *
 * @returns {{
 *   step1_consumoMedio:   number,
 *   step2_autonomiaGg:    number,
 *   step3_leadTimeGg:     number,
 *   step4_triggerGg:      number,
 *   step4_needsOrder:     boolean,
 *   step5_qtySuggerita:   number,
 *   bufferGg:             number,
 *   coperturaDays:        number,
 * }}
 */
function calcolaRiordine(prodotto, coperturaDays = COPERTURA_DEFAULT) {
  const qtyAttuale   = Number(prodotto.qtyAttuale);
  const consumoMedio = Number(prodotto.consumoMedio);
  const leadTimeGg   = Number(prodotto.leadTimeGg);

  // Step 2: autonomia residua in giorni
  // Se consumo_medio = 0, scorta infinita → non serve riordinare
  const step2_autonomiaGg =
    consumoMedio > 0
      ? parseFloat((qtyAttuale / consumoMedio).toFixed(1))
      : Infinity;

  // Step 4: trigger di riordino
  const step4_triggerGg  = leadTimeGg + BUFFER_GG;
  const step4_needsOrder = step2_autonomiaGg <= step4_triggerGg;

  // Step 5: quantità da ordinare
  // Formula: consumo_medio * (lead_time + copertura_target)
  // Math.ceil per non ordinare frazioni (almeno 1 unità intera)
  const step5_qtySuggerita = Math.ceil(consumoMedio * (leadTimeGg + coperturaDays));

  return {
    step1_consumoMedio:  consumoMedio,
    step2_autonomiaGg,
    step3_leadTimeGg:    leadTimeGg,
    step4_triggerGg,
    step4_needsOrder,
    step5_qtySuggerita,
    bufferGg:            BUFFER_GG,
    coperturaDays,
  };
}

/**
 * Calcola i suggerimenti di riordino per una lista di prodotti.
 * Usato da GET /api/v1/riordini/suggerimenti
 *
 * @param {Array}  prodotti        - lista prodotti da Prisma
 * @param {number} [coperturaDays] - giorni copertura target
 * @returns {{ daRiordinare: Array, scorteOk: Array }}
 */
function calcolaRiordiniPerLista(prodotti, coperturaDays = COPERTURA_DEFAULT) {
  const results = prodotti
    .filter(p => p.attivo)
    .map(p => ({
      prodotto:  p,
      riordino:  calcolaRiordine(p, coperturaDays),
    }));

  // Ordina per urgenza: prima i più critici (minor autonomia residua)
  results.sort((a, b) => a.riordino.step2_autonomiaGg - b.riordino.step2_autonomiaGg);

  return {
    daRiordinare: results.filter(r => r.riordino.step4_needsOrder),
    scorteOk:     results.filter(r => !r.riordino.step4_needsOrder),
  };
}

/**
 * Aggiorna il consumo medio ponderato dopo uno scarico.
 * Formula (da MySQL_Schema.sql trigger tg_after_movimento_insert):
 *   nuovo = ROUND(vecchio * 0.8 + qty_scaricata * 0.2, 3)
 *
 * @param {number} consumoMedioAttuale
 * @param {number} qtyScaricata
 * @returns {number}
 */
function aggiornaConsumoMedio(consumoMedioAttuale, qtyScaricata) {
  return parseFloat(
    (Number(consumoMedioAttuale) * 0.8 + Number(qtyScaricata) * 0.2).toFixed(3)
  );
}

module.exports = { calcolaRiordine, calcolaRiordiniPerLista, aggiornaConsumoMedio };
