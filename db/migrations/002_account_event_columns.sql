-- Migration 002: Sponsorship columns on accounts, type column on contract_events
-- Applied: 2026-08-10
-- Run with: psql $DATABASE_URL -f db/migrations/002_account_event_columns.sql

\echo 'Running migration 002: account/event columns...'

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS num_sponsored INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS num_sponsoring INTEGER NOT NULL DEFAULT 0;

ALTER TABLE contract_events ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'contract';

INSERT INTO schema_migrations (version, applied_at)
VALUES ('002_account_event_columns', NOW())
ON CONFLICT (version) DO NOTHING;

\echo 'Migration 002 complete.'
