-- ══════════════════════════════════════════════════════════════════════════════
-- PROJECT: SimpleStock — Schema Database MySQL 8+
-- STACK: Node.js + Express + Prisma + MySQL
-- DESCRIZIONE: Gestione magazzino intelligente per microimprese.
-- ══════════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────────
-- 0. DATABASE SETUP
-- Utilizziamo utf8mb4 per la massima compatibilità con caratteri speciali.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE DATABASE IF NOT EXISTS simplestock
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE simplestock;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. TABELLA UTENTI
-- Nota: Il valore UUID viene generato dal backend (Node.js/Prisma) per garantire
-- compatibilità anche con versioni di MySQL precedenti alla 8.0.13.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE utenti (
    id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    uuid            CHAR(36)        NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    nome            VARCHAR(100)    NOT NULL,
    email           VARCHAR(255)    NOT NULL,
    password_hash   TEXT            NOT NULL,
    ruolo           ENUM('admin','operatore') NOT NULL DEFAULT 'operatore',
    piano           ENUM('base','premium')    NOT NULL DEFAULT 'base',
    piano_scadenza  DATE            NULL,
    nome_negozio    VARCHAR(200)    NULL,
    attivo          TINYINT(1)      NOT NULL DEFAULT 1,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_utenti_email (email)
) ENGINE=InnoDB;

-- Inserimento Admin (Necessario per mantenere l'integrità referenziale dei prodotti)
INSERT INTO utenti (id, uuid, nome, email, password_hash, ruolo, piano, nome_negozio) VALUES
(1, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'Marco Rossi', 'marco@negozio.it', 'PLACEHOLDER_SOSTITUITO_DA_SEED_JS', 'admin', 'premium', 'Alimentari Rossi — Via Roma 12');

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. REFRESH TOKENS
-- Gestione della persistenza delle sessioni JWT (sicurezza).
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE refresh_tokens (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    utente_id   INT UNSIGNED NOT NULL,
    token_hash  VARCHAR(255) NOT NULL,
    scade_il    DATETIME     NOT NULL,
    revocato    TINYINT(1)   NOT NULL DEFAULT 0,
    ip_address  VARCHAR(45)  NULL,
    user_agent  TEXT         NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_rt_hash (token_hash),
    KEY idx_rt_utente (utente_id),
    CONSTRAINT fk_rt_utente FOREIGN KEY (utente_id) 
        REFERENCES utenti(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. CATEGORIE
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE categorie (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    nome        VARCHAR(100) NOT NULL,
    colore      CHAR(7)      NOT NULL DEFAULT '#64748B',
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_cat_nome (nome)
) ENGINE=InnoDB;

INSERT INTO categorie (nome, colore) VALUES
    ('Alimentari',  '#185FA5'),
    ('Bevande',     '#1D9E75'),
    ('Pulizia',     '#B45309'),
    ('Elettronica', '#7C3AED'),
    ('Altro',       '#64748B');

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. FORNITORI
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE fornitori (
    id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
    nome            VARCHAR(200) NOT NULL,
    settore         VARCHAR(100) NULL,
    email           VARCHAR(255) NULL,
    telefono        VARCHAR(30)  NULL,
    indirizzo       TEXT         NULL,
    lead_time_gg    TINYINT UNSIGNED NOT NULL DEFAULT 3,
    note            TEXT         NULL,
    attivo          TINYINT(1)   NOT NULL DEFAULT 1,
    creato_da       INT UNSIGNED NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_forn_attivo (attivo),
    CONSTRAINT fk_forn_utente FOREIGN KEY (creato_da) 
        REFERENCES utenti(id) ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT INTO fornitori (nome, settore, email, lead_time_gg) VALUES
    ('Distribuzione Rossi',   'Alimentari', 'rossi@dist.it',        3),
    ('Oleificio Meridionale', 'Alimentari', 'info@olio.it',         5),
    ('AcquaFonte Srl',        'Bevande',    'ordini@acquafonte.it', 2),
    ('CleanPro Italia',       'Pulizia',    'cleanpro@gmail.com',   3);

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. PRODOTTI
-- Core business: Precisione decimale a 3 cifre per pesi e volumi.
-- Nota: Validazione dei vincoli gestita lato backend via Zod per compatibilità DB.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE prodotti (
    id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    sku             VARCHAR(50)     NOT NULL,
    nome            VARCHAR(200)    NOT NULL,
    descrizione     TEXT            NULL,
    categoria_id    INT UNSIGNED    NULL,
    fornitore_id    INT UNSIGNED    NULL,
    unita_misura    ENUM('pz','kg','lt','conf','g','ml','m','altro') NOT NULL DEFAULT 'pz',
    qty_attuale     DECIMAL(12,3)   NOT NULL DEFAULT 0.000,
    soglia_minima   DECIMAL(12,3)   NOT NULL DEFAULT 0.000,
    lead_time_gg    TINYINT UNSIGNED NOT NULL DEFAULT 3,
    consumo_medio   DECIMAL(10,3)   NOT NULL DEFAULT 1.000,
    prezzo_acquisto DECIMAL(10,2)   NULL,
    note            TEXT            NULL,
    attivo          TINYINT(1)      NOT NULL DEFAULT 1,
    creato_da       INT UNSIGNED    NULL,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_prod_sku_utente (sku, creato_da),
    KEY idx_prod_categoria  (categoria_id),
    KEY idx_prod_fornitore  (fornitore_id),
    KEY idx_prod_attivo     (attivo),

    CONSTRAINT fk_prod_categoria FOREIGN KEY (categoria_id) REFERENCES categorie(id) ON DELETE SET NULL,
    CONSTRAINT fk_prod_fornitore FOREIGN KEY (fornitore_id) REFERENCES fornitori(id) ON DELETE SET NULL,
    CONSTRAINT fk_prod_utente    FOREIGN KEY (creato_da)    REFERENCES utenti(id)    ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT INTO prodotti 
    (sku, nome, categoria_id, unita_misura, qty_attuale, soglia_minima, lead_time_gg, consumo_medio, fornitore_id, creato_da)
VALUES
    ('ALI-001', 'Farina tipo 00',   1, 'kg',   12.000, 15.000, 3, 5.000, 1, 1),
    ('ALI-002', 'Olio extravergine', 1, 'lt',    4.000, 10.000, 5, 3.000, 2, 1),
    ('ALI-003', 'Passata pomodoro',   1, 'conf', 28.000, 12.000, 2, 4.000, 1, 1),
    ('PUL-001', 'Detersivo piatti',   3, 'pz',    7.000,  5.000, 3, 1.500, 4, 1),
    ('BEV-001', 'Acqua minerale 6pk', 2, 'conf',  3.000,  8.000, 2, 4.000, 3, 1),
    ('ALI-004', 'Zucchero semolato',  1, 'kg',   22.000,  8.000, 3, 2.000, 1, 1),
    ('ALI-005', 'Pasta spaghetti',    1, 'conf', 18.000, 10.000, 2, 3.000, 1, 1),
    ('BEV-002', 'Latte intero UHT',   2, 'lt',    9.000, 12.000, 1, 4.000, 3, 1);

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. MOVIMENTI
-- Tracciabilità storica di ogni operazione di magazzino.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE movimenti (
    id          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    prodotto_id INT UNSIGNED    NOT NULL,
    utente_id   INT UNSIGNED    NOT NULL,
    tipo        ENUM('carico','scarico') NOT NULL,
    quantita    DECIMAL(12,3)   NOT NULL,
    qty_prima   DECIMAL(12,3)   NOT NULL,
    qty_dopo    DECIMAL(12,3)   NOT NULL,
    note        VARCHAR(500)    NULL,
    fonte       ENUM('manuale','riordino_confermato','import_csv') NOT NULL DEFAULT 'manuale',
    created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_mov_prodotto  (prodotto_id),
    KEY idx_mov_utente    (utente_id),
    CONSTRAINT fk_mov_prodotto FOREIGN KEY (prodotto_id) REFERENCES prodotti(id) ON DELETE CASCADE,
    CONSTRAINT fk_mov_utente   FOREIGN KEY (utente_id)   REFERENCES utenti(id)   ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. SOGLIE ALERT (Funzionalità Piano Premium)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE soglie_alert (
    id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    prodotto_id      INT UNSIGNED    NOT NULL,
    utente_id        INT UNSIGNED    NOT NULL,
    soglia_custom    DECIMAL(12,3)   NOT NULL DEFAULT 0.000,
    notifica_email  TINYINT(1)      NOT NULL DEFAULT 1,
    notifica_push   TINYINT(1)      NOT NULL DEFAULT 0,
    attiva          TINYINT(1)      NOT NULL DEFAULT 1,
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_soglia (prodotto_id, utente_id),
    CONSTRAINT fk_soglia_prodotto FOREIGN KEY (prodotto_id) REFERENCES prodotti(id) ON DELETE CASCADE,
    CONSTRAINT fk_soglia_utente   FOREIGN KEY (utente_id)   REFERENCES utenti(id)   ON DELETE CASCADE
) ENGINE=InnoDB;

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. RIORDINI LOG
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE riordini_log (
    id                       INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    prodotto_id               INT UNSIGNED    NOT NULL,
    utente_id                 INT UNSIGNED    NOT NULL,
    fornitore_id              INT UNSIGNED    NULL,
    qty_suggerita            DECIMAL(12,3)   NOT NULL,
    qty_ordinata             DECIMAL(12,3)   NOT NULL,
    consumo_medio_al_momento DECIMAL(10,3)   NULL,
    autonomia_gg             DECIMAL(8,2)    NULL,
    lead_time_gg             TINYINT         NULL,
    copertura_target_gg      TINYINT         NOT NULL DEFAULT 14,
    stato                    ENUM('suggerito','confermato','annullato','ricevuto') NOT NULL DEFAULT 'confermato',
    note                     TEXT            NULL,
    created_at               DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    CONSTRAINT fk_riord_prodotto  FOREIGN KEY (prodotto_id)  REFERENCES prodotti(id)  ON DELETE CASCADE,
    CONSTRAINT fk_riord_utente    FOREIGN KEY (utente_id)    REFERENCES utenti(id)    ON DELETE RESTRICT,
    CONSTRAINT fk_riord_fornitore FOREIGN KEY (fornitore_id) REFERENCES fornitori(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ──────────────────────────────────────────────────────────────────────────────
-- 9. VIEWS (Analytics & Logic)
-- Calcolano lo stato dello stock e suggeriscono i riordini in tempo reale.
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_stock_status AS
SELECT
    p.id, p.sku, p.nome,
    c.nome AS categoria, f.nome AS fornitore,
    p.unita_misura, p.qty_attuale, p.soglia_minima,
    p.consumo_medio, p.lead_time_gg,
    CASE WHEN p.consumo_medio > 0 THEN ROUND(p.qty_attuale / p.consumo_medio, 1) ELSE NULL END AS autonomia_gg,
    (p.lead_time_gg + 2) AS trigger_gg,
    CASE
        WHEN p.qty_attuale <= 0                    THEN 'esaurito'
        WHEN p.qty_attuale < p.soglia_minima       THEN 'critico'
        WHEN p.qty_attuale < p.soglia_minima * 1.5 THEN 'attenzione'
        ELSE 'ok'
    END AS stato_scorta,
    CASE
        WHEN p.consumo_medio > 0 AND (p.qty_attuale / p.consumo_medio) <= (p.lead_time_gg + 2) THEN 1 
        ELSE 0
    END AS da_riordinare,
    CEIL(p.consumo_medio * (p.lead_time_gg + 14)) AS qty_suggerita
FROM prodotti p
LEFT JOIN categorie c ON c.id = p.categoria_id
LEFT JOIN fornitori f  ON f.id = p.fornitore_id
WHERE p.attivo = 1;

CREATE OR REPLACE VIEW v_consumo_30gg AS
SELECT
    prodotto_id,
    ROUND(SUM(quantita) / 30.0, 3) AS consumo_medio_giornaliero,
    SUM(quantita) AS totale_consumato,
    COUNT(*) AS num_scarichi
FROM movimenti
WHERE tipo = 'scarico' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY prodotto_id;

CREATE OR REPLACE VIEW v_kpi AS
SELECT
    (SELECT COUNT(*) FROM prodotti WHERE attivo = 1) AS totale_prodotti,
    (SELECT COUNT(*) FROM v_stock_status WHERE stato_scorta = 'critico') AS critici,
    (SELECT COUNT(*) FROM v_stock_status WHERE stato_scorta = 'attenzione') AS in_attenzione,
    (SELECT COUNT(*) FROM v_stock_status WHERE da_riordinare = 1) AS da_riordinare,
    (SELECT COUNT(*) FROM movimenti WHERE DATE(created_at) = CURDATE()) AS movimenti_oggi,
    (SELECT COUNT(*) FROM movimenti WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS movimenti_7gg;

-- ──────────────────────────────────────────────────────────────────────────────
-- 10. TRIGGER
-- Automatizza l'aggiornamento dello stock e ricalcola il consumo medio dinamico.
-- ──────────────────────────────────────────────────────────────────────────────
DELIMITER $$

CREATE TRIGGER tg_after_movimento_insert
AFTER INSERT ON movimenti
FOR EACH ROW
BEGIN
    IF NEW.tipo = 'carico' THEN
        UPDATE prodotti
        SET qty_attuale = qty_attuale + NEW.quantita, updated_at = NOW()
        WHERE id = NEW.prodotto_id;
    ELSEIF NEW.tipo = 'scarico' THEN
        UPDATE prodotti
        SET qty_attuale  = GREATEST(0, qty_attuale - NEW.quantita),
            consumo_medio = ROUND((consumo_medio * 0.8) + (NEW.quantita * 0.2), 3),
            updated_at    = NOW()
        WHERE id = NEW.prodotto_id;
    END IF;
END$$

DELIMITER ;