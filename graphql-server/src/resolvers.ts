// Horizon helpers live in graphql-server/src/horizon.ts (own copy, independent of frontend)
// TODO: replace these Horizon calls with PostgreSQL queries once the indexer is running
import { getRecentTransactions, getAccount, getAccountTransactions, getLatestLedger } from './horizon';

/**
 * GraphQL resolvers for the Lumina schema.
 *
 * NOTE: These currently delegate to the Horizon REST API in lib/horizon.ts.
 * The intended architecture is:
 *   1. indexer/ polls Horizon and writes to PostgreSQL
 *   2. resolvers query PostgreSQL for fast, historical data
 *   3. Horizon is only hit as a fallback for non-indexed data
 *
 * Contributors: replace the Horizon calls with db/ queries once the indexer
 * and PostgreSQL schema are implemented.
 */
export const resolvers = {
  Query: {
    async transactions(_: unknown, args: { limit?: number; cursor?: string }) {
      const limit = args.limit ?? 20;
      // TODO: query PostgreSQL with cursor pagination instead of Horizon
      const items = await getRecentTransactions(limit);
      return {
        items,
        pageInfo: {
          hasNextPage: items.length === limit,
          cursor: items.at(-1)?.id ?? null,
        },
      };
    },

    async transaction(_: unknown, args: { hash: string }) {
      // TODO: SELECT * FROM transactions WHERE hash = $1
      throw new Error('Not implemented — needs PostgreSQL indexer');
    },

    async account(_: unknown, args: { address: string }) {
      return getAccount(args.address);
    },

    async operations(_: unknown, args: { account?: string; type?: string; limit?: number }) {
      // TODO: query PostgreSQL operations table with account + type filter
      throw new Error('Not implemented — needs PostgreSQL indexer');
    },

    async events(_: unknown, args: { contractId: string; topic?: string; limit?: number }) {
      // TODO: query Soroban RPC event stream or PostgreSQL events table
      throw new Error('Not implemented — needs Soroban event indexer');
    },

    async latestLedger() {
      return getLatestLedger();
    },

    async ledger(_: unknown, args: { sequence: number }) {
      // TODO: SELECT * FROM ledgers WHERE sequence = $1
      throw new Error('Not implemented — needs PostgreSQL indexer');
    },
  },

  Account: {
    async transactions(parent: { address: string }, args: { limit?: number }) {
      return getAccountTransactions(parent.address, args.limit ?? 10);
    },
    async operations(parent: { address: string }, args: { limit?: number }) {
      // TODO: query operations table
      return [];
    },
  },

  Transaction: {
    async account(parent: { source_account: string }) {
      return getAccount(parent.source_account);
    },
    async operations(parent: { hash: string }) {
      // TODO: query operations WHERE transaction_hash = parent.hash
      return [];
    },
  },
};
