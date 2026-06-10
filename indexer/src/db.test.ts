import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { getLatestIndexedLedger, indexLedger } from './db';
import type { HorizonLedger, HorizonOperation, HorizonTransaction } from './horizon';

function makeFakeClient(opts: { failOn?: string } = {}) {
  const calls: string[] = [];
  const client = {
    query: async (sql: string) => {
      const trimmed = sql.trim();
      if (trimmed.startsWith('BEGIN') || trimmed.startsWith('COMMIT') || trimmed.startsWith('ROLLBACK')) {
        calls.push(trimmed);
      } else {
        calls.push(trimmed.match(/INSERT INTO (\w+)/)?.[1] ?? trimmed);
      }
      if (opts.failOn && trimmed.includes(opts.failOn)) {
        throw new Error(`simulated failure: ${opts.failOn}`);
      }
      return { rows: [] };
    },
    release: () => {
      calls.push('RELEASE');
    },
  };
  return { client, calls };
}

function fakePool(client: unknown): Pool {
  return { connect: async () => client } as unknown as Pool;
}

const ledger: HorizonLedger = {
  sequence: 100,
  closed_at: '2026-01-01T00:00:00Z',
  successful_transaction_count: 1,
  failed_transaction_count: 0,
  operation_count: 1,
  base_fee_in_stroops: 100,
  base_reserve_in_stroops: 5000000,
};

const tx: HorizonTransaction = {
  hash: 'tx1',
  ledger: 100,
  created_at: '2026-01-01T00:00:00Z',
  source_account: 'GABC',
  fee_charged: '100',
  operation_count: 1,
  successful: true,
  memo_type: 'none',
};

const op: HorizonOperation = {
  id: 'op1',
  type: 'payment',
  transaction_hash: 'tx1',
  created_at: '2026-01-01T00:00:00Z',
  source_account: 'GABC',
};

test('indexLedger writes ledger, transactions, and operations inside one commit', async () => {
  const { client, calls } = makeFakeClient();
  await indexLedger(fakePool(client), ledger, [tx], [op]);
  assert.deepEqual(calls, ['BEGIN', 'ledgers', 'transactions', 'operations', 'COMMIT', 'RELEASE']);
});

test('indexLedger rolls back and releases the client on failure', async () => {
  const { client, calls } = makeFakeClient({ failOn: 'INSERT INTO operations' });
  await assert.rejects(() => indexLedger(fakePool(client), ledger, [tx], [op]));
  assert.deepEqual(calls, ['BEGIN', 'ledgers', 'transactions', 'operations', 'ROLLBACK', 'RELEASE']);
});

test('getLatestIndexedLedger returns 0 when the table is empty', async () => {
  const pool = { query: async () => ({ rows: [{ max: null }] }) } as unknown as Pool;
  assert.equal(await getLatestIndexedLedger(pool), 0);
});

test('getLatestIndexedLedger returns the numeric max sequence', async () => {
  const pool = { query: async () => ({ rows: [{ max: '4242' }] }) } as unknown as Pool;
  assert.equal(await getLatestIndexedLedger(pool), 4242);
});
