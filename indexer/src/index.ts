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
 *   HORIZON_URL          — Stellar Horizon base URL (default: mainnet)
 *   DATABASE_URL         — PostgreSQL connection string
 *   START_LEDGER         — Ledger to begin indexing from if the DB is empty (default: latest)
 *   POLL_INTERVAL_MS     — How often to poll for new ledgers (default: 5000)
 *   SOROBAN_RPC_URL      — Soroban RPC endpoint; unset disables contract event indexing
 *   INDEXED_CONTRACT_IDS — Comma-separated contract IDs to index events for (requires SOROBAN_RPC_URL)
 */

import { createPool, getLatestIndexedLedger, indexLedger, insertContractEvents } from './db';
import { getAccount, getLatestLedgerSequence, getLedger, getLedgerOperations, getLedgerTransactions, HorizonAccount } from './horizon';
import { getEvents } from './soroban';

const HORIZON_URL = process.env.HORIZON_URL ?? 'https://horizon.stellar.org';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/lumina';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? '5000', 10);
const START_LEDGER = process.env.START_LEDGER ? parseInt(process.env.START_LEDGER, 10) : undefined;

// Soroban contract event indexing is opt-in — unset by default, the indexer
// behaves exactly as it did before these were introduced.
const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL;
const INDEXED_CONTRACT_IDS = (process.env.INDEXED_CONTRACT_IDS ?? '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

const LEDGER_RETRY_ATTEMPTS = 3;
const LEDGER_RETRY_BASE_MS = 500;

const pool = createPool(DATABASE_URL);

async function fetchAndIndexLedger(sequence: number): Promise<void> {
  console.log(`Indexing ledger ${sequence}...`);
  const [ledger, transactions, operations] = await Promise.all([
    getLedger(HORIZON_URL, sequence),
    getLedgerTransactions(HORIZON_URL, sequence),
    getLedgerOperations(HORIZON_URL, sequence),
  ]);

  const addresses = new Set<string>();
  for (const tx of transactions) addresses.add(tx.source_account);
  for (const op of operations) addresses.add(op.source_account);

  const accounts = (
    await Promise.all([...addresses].map(address => getAccount(HORIZON_URL, address)))
  ).filter((a): a is HorizonAccount => a !== null);

  await indexLedger(pool, ledger, transactions, operations, accounts);
}

async function fetchAndIndexLedgerWithRetry(sequence: number): Promise<void> {
  for (let attempt = 1; attempt <= LEDGER_RETRY_ATTEMPTS; attempt++) {
    try {
      await fetchAndIndexLedger(sequence);
      return;
    } catch (err) {
      if (attempt === LEDGER_RETRY_ATTEMPTS) {
        console.error(`Giving up on ledger ${sequence} after ${attempt} attempts:`, err);
        return;
      }
      const delay = LEDGER_RETRY_BASE_MS * 2 ** (attempt - 1);
      console.error(`Ledger ${sequence} failed (attempt ${attempt}/${LEDGER_RETRY_ATTEMPTS}), retrying in ${delay}ms:`, err);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

/** Fetches and stores contract events for the ledger range just processed by the Horizon poll loop. */
async function pollContractEvents(fromLedger: number): Promise<void> {
  if (!SOROBAN_RPC_URL || INDEXED_CONTRACT_IDS.length === 0) return;
  try {
    const events = await getEvents(SOROBAN_RPC_URL, INDEXED_CONTRACT_IDS, fromLedger);
    if (events.length > 0) {
      console.log(`Indexing ${events.length} contract event(s) from ledger ${fromLedger}...`);
      await insertContractEvents(pool, events);
    }
  } catch (err) {
    console.error('Contract event polling error:', err);
  }
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
      const rangeStart = cursor + 1;

      for (let seq = cursor + 1; seq <= latest; seq++) {
        await fetchAndIndexLedgerWithRetry(seq);
        cursor = seq;
      }

      if (cursor >= rangeStart) {
        await pollContractEvents(rangeStart);
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
