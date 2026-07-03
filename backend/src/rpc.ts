import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
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

const CONFIRM_TIMEOUT_MS = 75_000; // ~ a blockhash's lifetime; RPC-agnostic

/**
 * Poll signature status on a wall-clock timer, rebroadcasting periodically.
 * Deliberately does NOT compare getBlockHeight to lastValidBlockHeight — some
 * RPCs (e.g. publicnode) report those on inconsistent scales, which made the
 * old check expire instantly. A blockhash lives ~60-90s, so timing out here is
 * equivalent to expiry without depending on block-height accuracy.
 */
async function confirmBySignature(raw: Uint8Array, sig: string, label: string): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < CONFIRM_TIMEOUT_MS) {
    const st = (await connection.getSignatureStatuses([sig])).value[0];
    if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') {
      if (st.err) throw new Error(`${label} failed on-chain: ${JSON.stringify(st.err)}`);
      log(`${label} confirmed: ${sig}`);
      return true;
    }
    await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
  }
  return false; // not landed within a blockhash lifetime
}

/**
 * Build, simulate, sign and land a v0 transaction: compute-unit limit from
 * simulation (+15%), priority fee from recent-fee percentile, then poll to
 * confirmation. On timeout, rebuild once with a fresh blockhash (2 attempts).
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

  for (let attempt = 1; attempt <= 2; attempt++) {
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
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

    if (await confirmBySignature(raw, sig, label)) return sig;
    log(`${label} not confirmed in ${CONFIRM_TIMEOUT_MS / 1000}s (attempt ${attempt}/2), rebuilding`);
  }
  throw new Error(`${label}: transaction not landed after 2 attempts`);
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
  const sig = await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
  if (await confirmBySignature(raw, sig, label)) return sig;
  throw new Error(`${label}: externally-built transaction expired without confirming (sig ${sig})`);
}

/**
 * Transfer an account's ENTIRE balance minus the exact network fee, leaving it
 * at 0 (closed). Used to drain throwaway dev wallets — Solana forbids leaving a
 * system account with a nonzero balance below the rent-exempt minimum, so we
 * compute the precise fee with getFeeForMessage and send balance - fee.
 * Returns the signature, or null if there's nothing worth draining.
 */
export async function drainAccount(from: Keypair, to: PublicKey, label = 'drain'): Promise<string | null> {
  const balance = BigInt(await connection.getBalance(from.publicKey, 'confirmed'));
  if (balance === 0n) return null;

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const buildMsg = (lamports: bigint) =>
    new TransactionMessage({
      payerKey: from.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        // Fixed, tiny priority so the fee is deterministic and getFeeForMessage matches.
        ComputeBudgetProgram.setComputeUnitLimit({ units: 450 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
        SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports }),
      ],
    }).compileToV0Message();

  const feeResp = await connection.getFeeForMessage(buildMsg(1n), 'confirmed');
  const fee = BigInt(feeResp.value ?? 5000);
  if (balance <= fee) return null; // not enough to cover its own fee

  const amount = balance - fee;
  const tx = new VersionedTransaction(buildMsg(amount));
  tx.sign([from]);
  const raw = tx.serialize();
  const sig = await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
  if (await confirmBySignature(raw, sig, label)) return sig;
  throw new Error(`${label}: drain transaction expired without confirming (sig ${sig})`);
}
