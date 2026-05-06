-- Migration 001: Initial schema
-- Applied: 2026-05-06
-- Run with: psql $DATABASE_URL -f db/migrations/001_init.sql

\echo 'Running migration 001: Initial schema...'

\ir ../schema.sql

INSERT INTO schema_migrations (version, applied_at)
VALUES ('001_init', NOW())
ON CONFLICT (version) DO NOTHING;

\echo 'Migration 001 complete.'
