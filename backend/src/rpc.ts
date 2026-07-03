import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { config } from './config.js';
import { log } from './log.js';

export const connection = new Connection(config.rpcUrl, 'confirmed');

const PRIORITY_FLOOR_MICROLAMPORTS = 10_000;

/**
 * getRecentPrioritizationFees returns per-slot MINIMUM landed fees and is
 * mostly zeros on quiet slots — take a high percentile of the nonzero values.
 */
async function priorityFeeMicroLamports(writable: PublicKey[]): Promise<number> {
  try {
    const recent = await connection.getRecentPrioritizationFees({
      lockedWritableAccounts: writable.slice(0, 128),
    });
    const nonzero = recent
      .map((f) => f.prioritizationFee)
      .filter((f) => f > 0)
      .sort((a, b) => a - b);
    return Math.max(nonzero[Math.floor(nonzero.length * 0.8)] ?? 0, PRIORITY_FLOOR_MICROLAMPORTS);
  } catch {
    return PRIORITY_FLOOR_MICROLAMPORTS;
  }
}

async function broadcastAndConfirm(
  raw: Uint8Array,
  sig: string,
  lastValidBlockHeight: number,
  label: string
): Promise<boolean> {
  await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
  while ((await connection.getBlockHeight('confirmed')) <= lastValidBlockHeight) {
    const st = (await connection.getSignatureStatuses([sig])).value[0];
    if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') {
      if (st.err) throw new Error(`${label} failed on-chain: ${JSON.stringify(st.err)}`);
      log(`${label} confirmed: ${sig}`);
      return true;
    }
    await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false; // blockhash window expired without landing
}

/**
 * Build, simulate, sign and land a v0 transaction: compute-unit limit from
 * simulation (+15%), priority fee from recent-fee percentile, rebroadcast
 * every 2s until confirmed or the blockhash window expires, then rebuild
 * with a fresh blockhash (up to 4 windows).
 */
export async function sendInstructions(
  instructions: TransactionInstruction[],
  payer: Keypair,
  extraSigners: Keypair[] = [],
  label = 'tx'
): Promise<string> {
  const writable = instructions.flatMap((ix) =>
    ix.keys.filter((k) => k.isWritable).map((k) => k.pubkey)
  );
  const microLamports = await priorityFeeMicroLamports(writable);

  for (let attempt = 1; attempt <= 4; attempt++) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const build = (units: number) => {
      const msg = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
          ...instructions,
        ],
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);
      tx.sign([payer, ...extraSigners]);
      return tx;
    };

    const sim = await connection.simulateTransaction(build(1_400_000), { sigVerify: false });
    if (sim.value.err) {
      throw new Error(`${label} simulation failed: ${JSON.stringify(sim.value.err)} logs=${sim.value.logs?.slice(-5).join(' | ')}`);
    }
    const tx = build(Math.ceil((sim.value.unitsConsumed ?? 200_000) * 1.15));
    const raw = tx.serialize();
    const sig = await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });

    if (await broadcastAndConfirm(raw, sig, lastValidBlockHeight, label)) return sig;
    log(`${label} blockhash window expired (attempt ${attempt}/4), rebuilding`);
  }
  throw new Error(`${label}: transaction not landed after 4 blockhash windows`);
}

/**
 * Sign and land an externally-built serialized v0 transaction (PumpPortal,
 * Jupiter). These come with compute budget + a fresh blockhash baked in, so
 * we only sign, broadcast, and babysit it for one window.
 */
export async function sendSerializedTx(
  serialized: Uint8Array,
  signers: Keypair[],
  label = 'tx'
): Promise<string> {
  const tx = VersionedTransaction.deserialize(serialized);
  tx.sign(signers);
  const raw = tx.serialize();
  const sig = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
  // Their blockhash is fresher than one we fetch now, so our window is a
  // safe lower bound for the babysit loop.
  const { lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  if (await broadcastAndConfirm(raw, sig, lastValidBlockHeight, label)) return sig;
  throw new Error(`${label}: externally-built transaction expired without confirming (sig ${sig})`);
}
