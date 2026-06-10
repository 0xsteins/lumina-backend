import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLatestLedgerSequence, getLedger, getLedgerTransactions, PAGE_LIMIT } from './horizon';

function mockFetchSequence(responses: Array<{ ok: boolean; status?: number; body: unknown }>) {
  let call = 0;
  (global as unknown as { fetch: typeof fetch }).fetch = (async () => {
    const res = responses[call++];
    return {
      ok: res.ok,
      status: res.status ?? 200,
      json: async () => res.body,
    };
  }) as unknown as typeof fetch;
}

test('getLatestLedgerSequence returns the sequence of the first record', async () => {
  mockFetchSequence([{ ok: true, body: { _embedded: { records: [{ sequence: 12345 }] } } }]);
  const seq = await getLatestLedgerSequence('https://horizon.example.com');
  assert.equal(seq, 12345);
});

test('getLatestLedgerSequence returns 0 when there are no records', async () => {
  mockFetchSequence([{ ok: true, body: { _embedded: { records: [] } } }]);
  const seq = await getLatestLedgerSequence('https://horizon.example.com');
  assert.equal(seq, 0);
});

test('getLedger throws on a non-OK response', async () => {
  mockFetchSequence([{ ok: false, status: 404, body: {} }]);
  await assert.rejects(() => getLedger('https://horizon.example.com', 999));
});

test('getLedgerTransactions follows pagination until a short page is returned', async () => {
  const fullPage = Array.from({ length: PAGE_LIMIT }, (_, i) => ({ hash: `full-${i}` }));
  const shortPage = [{ hash: 'last' }];
  mockFetchSequence([
    { ok: true, body: { _embedded: { records: fullPage }, _links: { next: { href: 'page2' } } } },
    { ok: true, body: { _embedded: { records: shortPage }, _links: {} } },
  ]);
  const txs = await getLedgerTransactions('https://horizon.example.com', 100);
  assert.equal(txs.length, PAGE_LIMIT + 1);
  assert.equal(txs.at(-1)?.hash, 'last');
});

test('getLedgerTransactions stops after a single short page with no next link', async () => {
  mockFetchSequence([
    { ok: true, body: { _embedded: { records: [{ hash: 'only' }] }, _links: {} } },
  ]);
  const txs = await getLedgerTransactions('https://horizon.example.com', 100);
  assert.equal(txs.length, 1);
});
