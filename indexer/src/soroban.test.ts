import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEvents } from './soroban';

// Real XDR fixtures: ScSymbol("swap") and ScMap({ amount: "1000" }), generated via
// @stellar/stellar-sdk's nativeToScVal so decoding is exercised against real wire format.
const SWAP_TOPIC_XDR = 'AAAADwAAAARzd2Fw';
const AMOUNT_VALUE_XDR = 'AAAAEQAAAAEAAAABAAAADgAAAAZhbW91bnQAAAAAAA4AAAAEMTAwMA==';

function mockFetchOnce(body: unknown, ok = true) {
  (global as unknown as { fetch: typeof fetch }).fetch = (async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  })) as unknown as typeof fetch;
}

test('getEvents returns [] without making a request when no contract IDs are given', async () => {
  let called = false;
  (global as unknown as { fetch: typeof fetch }).fetch = (async () => {
    called = true;
    throw new Error('should not be called');
  }) as unknown as typeof fetch;
  const events = await getEvents('https://rpc.example.com', [], 100);
  assert.deepEqual(events, []);
  assert.equal(called, false);
});

test('getEvents decodes ScVal topics and values from a real RPC response shape', async () => {
  mockFetchOnce({
    jsonrpc: '2.0',
    id: 1,
    result: {
      latestLedger: 105,
      events: [
        {
          type: 'contract',
          ledger: 100,
          ledgerClosedAt: '2026-01-01T00:00:00Z',
          contractId: 'CABC',
          id: 'evt1',
          pagingToken: 'token1',
          topic: [SWAP_TOPIC_XDR],
          value: AMOUNT_VALUE_XDR,
        },
      ],
    },
  });

  const events = await getEvents('https://rpc.example.com', ['CABC'], 100);
  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'evt1');
  assert.equal(events[0].contractId, 'CABC');
  assert.equal(events[0].ledger, 100);
  assert.deepEqual(events[0].topics, ['"swap"']);
  assert.deepEqual(events[0].value, { amount: '1000' });
});

test('getEvents returns [] when the RPC result has no events', async () => {
  mockFetchOnce({ jsonrpc: '2.0', id: 1, result: { latestLedger: 105 } });
  const events = await getEvents('https://rpc.example.com', ['CABC'], 100);
  assert.deepEqual(events, []);
});

test('getEvents throws on a JSON-RPC error response', async () => {
  mockFetchOnce({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'start ledger too old' } });
  await assert.rejects(() => getEvents('https://rpc.example.com', ['CABC'], 100), /start ledger too old/);
});

test('getEvents throws on a non-OK HTTP response', async () => {
  mockFetchOnce({}, false);
  await assert.rejects(() => getEvents('https://rpc.example.com', ['CABC'], 100));
});
