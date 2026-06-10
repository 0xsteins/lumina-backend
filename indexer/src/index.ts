/**
 * Lumina Indexer
 *
 * Polls Stellar Horizon for new ledgers and writes transactions and
 * operations to the PostgreSQL database defined in db/schema.sql.
 *
 * Architecture:
 *   Horizon API → Indexer → PostgreSQL ← GraphQL Server ← Frontend / API Consumers
 *
 * Environment variables:
 *   HORIZON_URL        — Stellar Horizon base URL (default: mainnet)
 *   DATABASE_URL       — PostgreSQL connection string
 *   START_LEDGER       — Ledger to begin indexing from if the DB is empty (default: latest)
 *   POLL_INTERVAL_MS   — How often to poll for new ledgers (default: 5000)
 */

import { createPool, getLatestIndexedLedger, indexLedger } from './db';
import { getLatestLedgerSequence, getLedger, getLedgerOperations, getLedgerTransactions } from './horizon';

const HORIZON_URL = process.env.HORIZON_URL ?? 'https://horizon.stellar.org';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/lumina';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? '5000', 10);
const START_LEDGER = process.env.START_LEDGER ? parseInt(process.env.START_LEDGER, 10) : undefined;

const pool = createPool(DATABASE_URL);

async function fetchAndIndexLedger(sequence: number): Promise<void> {
  console.log(`Indexing ledger ${sequence}...`);
  const [ledger, transactions, operations] = await Promise.all([
    getLedger(HORIZON_URL, sequence),
    getLedgerTransactions(HORIZON_URL, sequence),
    getLedgerOperations(HORIZON_URL, sequence),
  ]);
  await indexLedger(pool, ledger, transactions, operations);
}

async function run() {
  console.log('Lumina Indexer starting...');
  console.log(`Horizon: ${HORIZON_URL}`);
  console.log(`Database: ${DATABASE_URL}`);

  let cursor = await getLatestIndexedLedger(pool);
  if (cursor === 0 && START_LEDGER !== undefined) {
    cursor = START_LEDGER - 1;
    console.log(`Starting from configured START_LEDGER: ${START_LEDGER}`);
  } else if (cursor === 0) {
    cursor = await getLatestLedgerSequence(HORIZON_URL);
    console.log(`Starting from latest ledger: ${cursor + 1}`);
  } else {
    console.log(`Resuming from ledger: ${cursor + 1}`);
  }

  while (true) {
    try {
      const latest = await getLatestLedgerSequence(HORIZON_URL);

      for (let seq = cursor + 1; seq <= latest; seq++) {
        await fetchAndIndexLedger(seq);
        cursor = seq;
      }
    } catch (err) {
      console.error('Indexer error:', err);
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function shutdown() {
  console.log('Shutting down indexer...');
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

run().catch(err => {
  console.error('Fatal indexer error:', err);
  process.exit(1);
});
