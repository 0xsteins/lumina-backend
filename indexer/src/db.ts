import { Pool } from 'pg';
import type { HorizonLedger, HorizonOperation, HorizonTransaction } from './horizon';

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl });
}

export async function getLatestIndexedLedger(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ max: string | null }>('SELECT MAX(sequence) AS max FROM ledgers');
  return rows[0].max ? Number(rows[0].max) : 0;
}

/**
 * Writes a ledger and all of its transactions/operations in a single DB
 * transaction, so a crash mid-ledger leaves no partial rows behind — the
 * ledger sequence simply gets re-fetched and re-indexed on restart.
 */
export async function indexLedger(
  pool: Pool,
  ledger: HorizonLedger,
  transactions: HorizonTransaction[],
  operations: HorizonOperation[]
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO ledgers (sequence, closed_at, transaction_count, operation_count, base_fee, base_reserve)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (sequence) DO NOTHING`,
      [
        ledger.sequence,
        ledger.closed_at,
        ledger.successful_transaction_count + ledger.failed_transaction_count,
        ledger.operation_count,
        ledger.base_fee_in_stroops,
        ledger.base_reserve_in_stroops,
      ]
    );

    for (const tx of transactions) {
      await client.query(
        `INSERT INTO transactions (hash, ledger, created_at, source_account, fee_charged, operation_count, successful, memo_type, memo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (hash) DO NOTHING`,
        [
          tx.hash,
          tx.ledger,
          tx.created_at,
          tx.source_account,
          tx.fee_charged,
          tx.operation_count,
          tx.successful,
          tx.memo_type,
          tx.memo ?? null,
        ]
      );
    }

    for (const op of operations) {
      await client.query(
        `INSERT INTO operations (id, type, transaction_hash, ledger, created_at, source_account, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [op.id, op.type, op.transaction_hash, ledger.sequence, op.created_at, op.source_account, JSON.stringify(op)]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
