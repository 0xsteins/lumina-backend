-- Lumina PostgreSQL Schema
-- Run this to initialize the database: psql $DATABASE_URL -f db/schema.sql

-- ─── Ledgers ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ledgers (
    sequence            BIGINT PRIMARY KEY,
    closed_at           TIMESTAMPTZ NOT NULL,
    transaction_count   INTEGER NOT NULL DEFAULT 0,
    operation_count     INTEGER NOT NULL DEFAULT 0,
    base_fee            BIGINT NOT NULL DEFAULT 100,
    base_reserve        BIGINT NOT NULL DEFAULT 5000000,
    indexed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ledgers_closed_at ON ledgers (closed_at DESC);

-- ─── Transactions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS transactions (
    hash                TEXT PRIMARY KEY,
    ledger              BIGINT NOT NULL REFERENCES ledgers(sequence),
    created_at          TIMESTAMPTZ NOT NULL,
    source_account      TEXT NOT NULL,
    fee_charged         BIGINT NOT NULL,
    operation_count     SMALLINT NOT NULL,
    successful          BOOLEAN NOT NULL,
    memo_type           TEXT,
    memo                TEXT,
    indexed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_ledger     ON transactions (ledger DESC);
CREATE INDEX idx_transactions_source     ON transactions (source_account);
CREATE INDEX idx_transactions_created_at ON transactions (created_at DESC);

-- ─── Operations ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS operations (
    id                  TEXT PRIMARY KEY,
    type                TEXT NOT NULL,
    transaction_hash    TEXT NOT NULL REFERENCES transactions(hash),
    ledger              BIGINT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL,
    source_account      TEXT NOT NULL,
    -- JSONB column holds type-specific fields (from, to, amount, asset, etc.)
    details             JSONB NOT NULL DEFAULT '{}',
    indexed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_operations_transaction   ON operations (transaction_hash);
CREATE INDEX idx_operations_source        ON operations (source_account);
CREATE INDEX idx_operations_type          ON operations (type);
CREATE INDEX idx_operations_created_at    ON operations (created_at DESC);
-- GIN index for JSONB queries (e.g. filter by "to" address in payment details)
CREATE INDEX idx_operations_details       ON operations USING GIN (details);

-- ─── Accounts ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS accounts (
    address             TEXT PRIMARY KEY,
    sequence            TEXT NOT NULL,
    subentry_count      INTEGER NOT NULL DEFAULT 0,
    last_modified_ledger BIGINT NOT NULL,
    balances            JSONB NOT NULL DEFAULT '[]',
    flags               JSONB NOT NULL DEFAULT '{}',
    thresholds          JSONB NOT NULL DEFAULT '{}',
    indexed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Contract Events (Soroban) ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contract_events (
    id                  TEXT PRIMARY KEY,
    contract_id         TEXT NOT NULL,
    ledger              BIGINT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL,
    paging_token        TEXT NOT NULL,
    topics              TEXT[] NOT NULL DEFAULT '{}',
    value               JSONB,
    indexed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_contract_id  ON contract_events (contract_id);
CREATE INDEX idx_events_ledger       ON contract_events (ledger DESC);
CREATE INDEX idx_events_created_at   ON contract_events (created_at DESC);
CREATE INDEX idx_events_topics       ON contract_events USING GIN (topics);
