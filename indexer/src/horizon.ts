/**
 * Typed Horizon client for the indexer. Kept independent of the frontend's and
 * graphql-server's Horizon clients so this service has no cross-package imports.
 */

const PAGE_LIMIT = 200;

export interface HorizonLedger {
  sequence: number;
  closed_at: string;
  successful_transaction_count: number;
  failed_transaction_count: number;
  operation_count: number;
  base_fee_in_stroops: number;
  base_reserve_in_stroops: number;
}

export interface HorizonTransaction {
  hash: string;
  ledger: number;
  created_at: string;
  source_account: string;
  fee_charged: string;
  operation_count: number;
  successful: boolean;
  memo_type: string;
  memo?: string;
}

export interface HorizonOperation {
  id: string;
  type: string;
  transaction_hash: string;
  created_at: string;
  source_account: string;
  [key: string]: unknown;
}

interface HorizonPage<T> {
  _embedded: { records: T[] };
  _links: { next?: { href: string } };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Horizon request failed (${res.status}): ${url}`);
  }
  return (await res.json()) as T;
}

async function fetchAllPages<T>(url: string): Promise<T[]> {
  const records: T[] = [];
  let next: string | undefined = url;
  while (next) {
    const page = await fetchJson<HorizonPage<T>>(next);
    records.push(...page._embedded.records);
    next = page._embedded.records.length === PAGE_LIMIT ? page._links.next?.href : undefined;
  }
  return records;
}

export async function getLatestLedgerSequence(horizonUrl: string): Promise<number> {
  const page = await fetchJson<HorizonPage<HorizonLedger>>(`${horizonUrl}/ledgers?order=desc&limit=1`);
  return page._embedded.records[0]?.sequence ?? 0;
}

export function getLedger(horizonUrl: string, sequence: number): Promise<HorizonLedger> {
  return fetchJson<HorizonLedger>(`${horizonUrl}/ledgers/${sequence}`);
}

export function getLedgerTransactions(horizonUrl: string, sequence: number): Promise<HorizonTransaction[]> {
  return fetchAllPages<HorizonTransaction>(
    `${horizonUrl}/ledgers/${sequence}/transactions?order=asc&limit=${PAGE_LIMIT}`
  );
}

export function getLedgerOperations(horizonUrl: string, sequence: number): Promise<HorizonOperation[]> {
  return fetchAllPages<HorizonOperation>(
    `${horizonUrl}/ledgers/${sequence}/operations?order=asc&limit=${PAGE_LIMIT}`
  );
}
