/**
 * Lumina Indexer
 *
 * Polls Stellar Horizon for new ledgers and writes transactions, operations,
 * accounts, and contract events to the PostgreSQL database defined in db/schema.sql.
 *
 * Architecture:
 *   Horizon API → Indexer → PostgreSQL ← GraphQL Server ← Frontend / API Consumers
 *
 * Environment variables:
 *   HORIZON_URL        — Stellar Horizon base URL (default: mainnet)
 *   DATABASE_URL       — PostgreSQL connection string
 *   START_LEDGER       — Ledger to begin indexing from (default: latest)
 *   POLL_INTERVAL_MS   — How often to poll for new ledgers (default: 5000)
 */

const HORIZON_URL = process.env.HORIZON_URL ?? 'https://horizon.stellar.org';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/lumina';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS ?? '5000', 10);

async function getLatestIndexedLedger(): Promise<number> {
  // TODO: SELECT MAX(sequence) FROM ledgers WHERE indexed = true
  return 0;
}

async function fetchAndIndexLedger(sequence: number): Promise<void> {
  console.log(`Indexing ledger ${sequence}...`);

  // TODO: GET /ledgers/:sequence
  // TODO: INSERT INTO ledgers (sequence, closed_at, transaction_count, operation_count, base_fee)

  // TODO: GET /ledgers/:sequence/transactions
  // TODO: For each transaction:
  //   INSERT INTO transactions (hash, ledger, source_account, fee_charged, successful, ...)

  // TODO: GET /ledgers/:sequence/operations
  // TODO: For each operation:
  //   INSERT INTO operations (id, type, transaction_hash, source_account, ...)

  // TODO (future): GET /events for Soroban contract events via RPC
  //   INSERT INTO contract_events (id, contract_id, ledger, topics, value, ...)
}

async function getHorizonLatestLedger(): Promise<number> {
  const res = await fetch(`${HORIZON_URL}/ledgers?order=desc&limit=1`);
  const data = await res.json() as { _embedded: { records: Array<{ sequence: number }> } };
  return data._embedded.records[0]?.sequence ?? 0;
}

async function run() {
  console.log('Lumina Indexer starting...');
  console.log(`Horizon: ${HORIZON_URL}`);
  console.log(`Database: ${DATABASE_URL}`);

  // TODO: initialize PostgreSQL connection pool
  // TODO: run db/migrations if needed

  let cursor = await getLatestIndexedLedger();
  if (cursor === 0) {
    cursor = await getHorizonLatestLedger();
    console.log(`Starting from latest ledger: ${cursor}`);
  } else {
    console.log(`Resuming from ledger: ${cursor}`);
  }

  while (true) {
    try {
      const latest = await getHorizonLatestLedger();

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

run().catch(err => {
  console.error('Fatal indexer error:', err);
  process.exit(1);
});
