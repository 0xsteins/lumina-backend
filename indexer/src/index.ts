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
 *   SOROBAN_RPC_URL           — Soroban RPC endpoint; unset disables contract event indexing
 *   INDEXED_CONTRACT_IDS      — Comma-separated contract IDs to index events for (requires SOROBAN_RPC_URL)
 *   REGISTRY_CONTRACT_ID      — Lumina Registry contract to poll for additional contract IDs (requires SOROBAN_RPC_URL + REGISTRY_READ_ACCOUNT)
 *   REGISTRY_READ_ACCOUNT     — Any funded account address used to simulate the registry's read calls (no secret key needed)
 *   REGISTRY_NETWORK_PASSPHRASE — Network passphrase for registry simulation (default: Test SDF Network passphrase)
 */

import { Networks } from '@stellar/stellar-sdk';
import { createPool, getLatestIndexedEventLedger, getLatestIndexedLedger, indexLedger, insertContractEvents } from './db';
import { getAccount, getLatestLedgerSequence, getLedger, getLedgerOperations, getLedgerTransactions, HorizonAccount } from './horizon';
import { getActiveContracts } from './registry';
import { getEvents, getLatestLedgerSequence as getLatestRpcLedgerSequence } from './soroban';

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

// Registry-based discovery is opt-in on top of the opt-in event indexing above —
// unset, the indexer relies solely on the static INDEXED_CONTRACT_IDS list.
const REGISTRY_CONTRACT_ID = process.env.REGISTRY_CONTRACT_ID;
const REGISTRY_READ_ACCOUNT = process.env.REGISTRY_READ_ACCOUNT;
const REGISTRY_NETWORK_PASSPHRASE = process.env.REGISTRY_NETWORK_PASSPHRASE ?? Networks.TESTNET;
const REGISTRY_POLL_EVERY_N_TICKS = 12; // ~once/minute at the default 5s poll interval

const LEDGER_RETRY_ATTEMPTS = 3;
const LEDGER_RETRY_BASE_MS = 500;

// How long an account's Horizon data is considered fresh enough to skip
// re-fetching. Busy accounts (exchanges, bots) show up in most ledgers —
// without this, the indexer re-fetches the same accounts every ~5s and
// floods Horizon's per-IP rate limit, which then also breaks the GraphQL
// server's own account lookups sharing that limit.
const ACCOUNT_CACHE_TTL_MS = 5 * 60 * 1000;
const ACCOUNT_CACHE_MAX_SIZE = 50_000;

const pool = createPool(DATABASE_URL);
let discoveredContractIds: string[] = [];
let loopTick = 0;
let eventsCursor = 0;
const accountCache = new Map<string, number>(); // address -> last-fetched-at

function pruneAccountCache(now: number): void {
  if (accountCache.size < ACCOUNT_CACHE_MAX_SIZE) return;
  for (const [address, fetchedAt] of accountCache) {
    if (now - fetchedAt > ACCOUNT_CACHE_TTL_MS) accountCache.delete(address);
  }
}

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

  const now = Date.now();
  pruneAccountCache(now);
  const addressesToFetch = [...addresses].filter(address => {
    const fetchedAt = accountCache.get(address);
    return fetchedAt === undefined || now - fetchedAt > ACCOUNT_CACHE_TTL_MS;
  });

  const accounts = (
    await Promise.all(addressesToFetch.map(address => getAccount(HORIZON_URL, address)))
  ).filter((a): a is HorizonAccount => a !== null);
  for (const address of addressesToFetch) accountCache.set(address, now);

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

/** Refreshes the set of contract IDs discovered from the Lumina Registry, if configured. */
async function pollRegistry(): Promise<void> {
  if (!SOROBAN_RPC_URL || !REGISTRY_CONTRACT_ID || !REGISTRY_READ_ACCOUNT) return;
  try {
    discoveredContractIds = await getActiveContracts(
      SOROBAN_RPC_URL,
      REGISTRY_CONTRACT_ID,
      REGISTRY_READ_ACCOUNT,
      REGISTRY_NETWORK_PASSPHRASE
    );
    console.log(`Registry discovery: ${discoveredContractIds.length} active contract(s)`);
  } catch (err) {
    console.error('Registry polling error:', err);
  }
}

/**
 * Fetches and stores contract events, tracking its own ledger cursor on
 * whatever network SOROBAN_RPC_URL points to — independent of the Horizon
 * loop's cursor, which may be a different network entirely (e.g. mainnet
 * transactions/ledgers alongside a testnet-deployed registry contract).
 */
async function pollContractEvents(): Promise<void> {
  const contractIds = [...new Set([...INDEXED_CONTRACT_IDS, ...discoveredContractIds])];
  if (!SOROBAN_RPC_URL || contractIds.length === 0) return;
  try {
    if (eventsCursor === 0) {
      const dbCursor = await getLatestIndexedEventLedger(pool);
      if (dbCursor > 0) {
        eventsCursor = dbCursor + 1;
      } else {
        // Match the Horizon indexer's own "fresh DB starts from latest" convention,
        // rather than guessing a backfill window — RPC getEvents silently returns
        // empty (no error) for startLedger values too far behind current, and how
        // far is "too far" is provider-specific and not worth hardcoding a guess at.
        eventsCursor = await getLatestRpcLedgerSequence(SOROBAN_RPC_URL);
        console.log(`Contract event indexing: starting from latest RPC ledger ${eventsCursor}`);
      }
    }

    const { events, latestLedger } = await getEvents(SOROBAN_RPC_URL, contractIds, eventsCursor);
    if (events.length > 0) {
      console.log(`Indexing ${events.length} contract event(s) from ledger ${eventsCursor}...`);
      await insertContractEvents(pool, events);
    }
    eventsCursor = latestLedger + 1;
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
      if (loopTick % REGISTRY_POLL_EVERY_N_TICKS === 0) {
        await pollRegistry();
      }
      loopTick++;

      const latest = await getLatestLedgerSequence(HORIZON_URL);
      for (let seq = cursor + 1; seq <= latest; seq++) {
        await fetchAndIndexLedgerWithRetry(seq);
        cursor = seq;
      }

      await pollContractEvents();
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
