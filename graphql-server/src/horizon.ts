// Horizon client for the GraphQL server layer.
// Mirrors frontend/lib/horizon.ts but is intentionally separate —
// the GraphQL server is a standalone service and must not import from the frontend package.
// Once the indexer is writing to PostgreSQL, replace these fetch calls with db queries.

const HORIZON = process.env.HORIZON_URL ?? 'https://horizon.stellar.org';

export interface HorizonTransaction {
  id: string;
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

export interface HorizonAccount {
  id: string;
  account_id: string;
  sequence: string;
  subentry_count: number;
  last_modified_ledger: number;
  num_sponsored: number;
  num_sponsoring: number;
  balances: Balance[];
  flags: { auth_required: boolean; auth_revocable: boolean; auth_immutable: boolean };
}

export interface Balance {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  limit?: string;
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${HORIZON}${path}`);
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

export async function getRecentTransactions(limit = 20): Promise<HorizonTransaction[]> {
  type R = { _embedded: { records: HorizonTransaction[] } };
  const data = await get<R>(`/transactions?order=desc&limit=${limit}`);
  return data?._embedded?.records ?? [];
}

export async function getAccount(address: string): Promise<HorizonAccount | null> {
  return get<HorizonAccount>(`/accounts/${address}`);
}

export async function getAccountTransactions(address: string, limit = 10): Promise<HorizonTransaction[]> {
  type R = { _embedded: { records: HorizonTransaction[] } };
  const data = await get<R>(`/accounts/${address}/transactions?order=desc&limit=${limit}`);
  return data?._embedded?.records ?? [];
}

export async function getLatestLedger() {
  type R = { _embedded: { records: Array<{ sequence: number; closed_at: string; successful_transaction_count: number; failed_transaction_count: number; operation_count: number }> } };
  const data = await get<R>('/ledgers?order=desc&limit=1');
  return data?._embedded?.records?.[0] ?? null;
}
