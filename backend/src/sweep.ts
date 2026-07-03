import { Keypair, SystemProgram } from '@solana/web3.js';
import { connection, sendInstructions } from './rpc.js';
import { claimRewards, getClaimable } from './claim.js';
import { loadDevWallets, upsertDevWallet, keypairFromRecord } from './keystore.js';
import { config, lamportsToSol } from './config.js';
import { log, ledger } from './log.js';

// Leave a little behind to cover the sweep tx's own fee + priority.
const SWEEP_DUST_LAMPORTS = 15_000n;

/**
 * Walk every dev wallet in the keystore, claim any creator fees it earned
 * (spam pairs rarely get volume, so usually zero), then send its remaining
 * SOL back to the treasury. Idempotent: swept wallets are skipped next run.
 */
export async function sweepDevWallets(treasury: Keypair): Promise<void> {
  const wallets = loadDevWallets().filter((w) => w.status !== 'swept');
  if (wallets.length === 0) {
    log('sweep: no dev wallets to reclaim.');
    return;
  }
  log(`sweep: checking ${wallets.length} dev wallet(s)${config.dryRun ? ' (DRY RUN)' : ''}`);

  let reclaimed = 0n;
  let feesClaimed = 0n;

  for (const rec of wallets) {
    const dev = keypairFromRecord(rec);

    // 1. Claim any creator fees this pair earned (lands in the dev wallet).
    const claimable = await getClaimable(dev);
    if (claimable > 0n) {
      log(`sweep: ${rec.pubkey} has ${lamportsToSol(claimable).toFixed(6)} SOL in creator fees`);
      if (!config.dryRun) feesClaimed += await claimRewards(dev);
    }

    // 2. Sweep remaining SOL back to the treasury.
    const balance = BigInt(await connection.getBalance(dev.publicKey, 'confirmed'));
    if (balance <= SWEEP_DUST_LAMPORTS) {
      log(`sweep: ${rec.pubkey} holds ${lamportsToSol(balance).toFixed(6)} SOL — dust, skipping`);
      continue;
    }
    const amount = balance - SWEEP_DUST_LAMPORTS;
    log(`sweep: reclaiming ${lamportsToSol(amount).toFixed(6)} SOL from ${rec.pubkey}`);
    reclaimed += amount;

    if (!config.dryRun) {
      const sig = await sendInstructions(
        [SystemProgram.transfer({ fromPubkey: dev.publicKey, toPubkey: treasury.publicKey, lamports: amount })],
        dev,
        [],
        'sweep'
      );
      upsertDevWallet({ ...rec, status: 'swept' });
      ledger({ action: 'sweep', devWallet: rec.pubkey, amount: amount.toString(), sig });
    }
  }

  log(`sweep: ${config.dryRun ? 'would reclaim' : 'reclaimed'} ${lamportsToSol(reclaimed).toFixed(6)} SOL` +
    (feesClaimed > 0n ? ` + ${lamportsToSol(feesClaimed).toFixed(6)} SOL in fees` : '') +
    ` to treasury ${treasury.publicKey.toBase58()}`);
}
