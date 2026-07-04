import { createRequire } from 'node:module';
import type { OnlinePumpSdk as OnlinePumpSdkType } from '@pump-fun/pump-sdk';
import { Keypair } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createCloseAccountInstruction,
  NATIVE_MINT,
} from '@solana/spl-token';
import { connection, sendInstructions } from './rpc.js';
import { config, lamportsToSol } from './config.js';
import { log, ledger } from './log.js';

// @pump-fun/pump-sdk ships an ESM bundle whose transitive dep does a named
// `import { BN }` from anchor (CJS) — that fails under Node's ESM loader.
// The CJS build is fine, so force it via createRequire.
const require = createRequire(import.meta.url);
const { OnlinePumpSdk } = require('@pump-fun/pump-sdk') as typeof import('@pump-fun/pump-sdk');

const sdk: OnlinePumpSdkType = new OnlinePumpSdk(connection);

/**
 * The PumpSwap SDK console.warns "Error fetching token account ..." whenever a
 * creator-vault ATA doesn't exist yet — which is the normal "no AMM fees to
 * claim" case. Swallow just that message so operator logs stay readable.
 */
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('Error fetching token account')) return;
    realWarn(...args);
  };
  try {
    return await fn();
  } finally {
    console.warn = realWarn;
  }
}

/**
 * Total claimable creator rewards (lamports) across BOTH the pump.fun
 * bonding-curve vault and the PumpSwap post-graduation vault.
 */
export async function getClaimable(creator: Keypair): Promise<bigint> {
  const bn = await quiet(() => sdk.getCreatorVaultBalanceBothPrograms(creator.publicKey));
  return BigInt(bn.toString());
}

/**
 * Claim creator rewards. PumpSwap-side fees arrive as wrapped SOL, so after
 * claiming we close the WSOL token account to unwrap everything to native SOL.
 * Returns the actual SOL gained (measured by wallet balance delta, net of fees).
 *
 * @param minLamports skip the claim (return 0) unless at least this much is
 *   claimable — so autoclaiming every 5s never spends more in fees than it
 *   collects. Defaults to the configured floor; pass 0n to force a claim.
 */
export async function claimRewards(creator: Keypair, minLamports = config.minClaimLamports): Promise<bigint> {
  const claimable = await getClaimable(creator);
  if (claimable < minLamports) return 0n; // below the worth-claiming floor — don't send a dust tx
  log(`claim: ${lamportsToSol(claimable).toFixed(6)} SOL claimable across both vaults`);
  if (claimable <= 0n) return 0n;

  if (config.dryRun) {
    ledger({ action: 'claim', dryRun: true, claimable: claimable.toString() });
    return claimable; // pretend-claim so the dry-run shows the downstream split
  }

  const before = BigInt(await connection.getBalance(creator.publicKey, 'confirmed'));

  const ixs = await quiet(() => sdk.collectCoinCreatorFeeInstructions(creator.publicKey));
  const sig = await sendInstructions(ixs, creator, [], 'claim-creator-fees');

  // Unwrap any WSOL the PumpSwap claim deposited.
  const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, creator.publicKey);
  const wsolInfo = await connection.getAccountInfo(wsolAta);
  if (wsolInfo) {
    await sendInstructions(
      [createCloseAccountInstruction(wsolAta, creator.publicKey, creator.publicKey)],
      creator,
      [],
      'unwrap-wsol'
    );
  }

  const after = BigInt(await connection.getBalance(creator.publicKey, 'confirmed'));
  const gained = after > before ? after - before : 0n;
  log(`claim: wallet gained ${lamportsToSol(gained).toFixed(6)} SOL (tx ${sig})`);
  ledger({ action: 'claim', claimable: claimable.toString(), gained: gained.toString(), sig });
  return gained;
}
