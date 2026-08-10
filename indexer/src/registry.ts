/**
 * Discovers contract IDs from a deployed Lumina Registry contract, so the
 * indexer's Soroban event indexing (soroban.ts) doesn't have to rely solely
 * on a static INDEXED_CONTRACT_IDS list.
 *
 * Uses simulateTransaction against get_active_contracts — a read-only call,
 * so REGISTRY_READ_ACCOUNT only needs to be a funded account that exists on
 * the network; no secret key or signature is required.
 *
 * Opt-in: the indexer runs exactly as it does without any registry
 * configuration. Set REGISTRY_CONTRACT_ID + REGISTRY_READ_ACCOUNT (in
 * addition to SOROBAN_RPC_URL) to enable it (see indexer/src/index.ts).
 */
import { Contract, nativeToScVal, rpc, scValToNative, TransactionBuilder } from '@stellar/stellar-sdk';

interface ContractEntry {
  active: boolean;
  contract_id: string;
  description: string;
  name: string;
  owner: string;
  registered_at: number;
}

const PAGE_LIMIT = 50;
const MAX_PAGES = 20; // safety cap: 1000 contracts

/** Paginates through get_active_contracts and returns the contract IDs of every active entry. */
export async function getActiveContracts(
  rpcUrl: string,
  registryContractId: string,
  readAccount: string,
  networkPassphrase: string
): Promise<string[]> {
  const server = new rpc.Server(rpcUrl);
  const account = await server.getAccount(readAccount);
  const contract = new Contract(registryContractId);
  const contractIds: string[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_LIMIT;
    const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase })
      .addOperation(
        contract.call(
          'get_active_contracts',
          nativeToScVal(offset, { type: 'u32' }),
          nativeToScVal(PAGE_LIMIT, { type: 'u32' })
        )
      )
      .setTimeout(30)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      throw new Error(`Registry simulation failed: ${sim.error}`);
    }

    const entries = scValToNative(sim.result!.retval) as ContractEntry[];
    contractIds.push(...entries.map(e => e.contract_id));

    if (entries.length < PAGE_LIMIT) break;
  }

  return contractIds;
}
