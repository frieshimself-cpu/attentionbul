import { Keypair } from '@solana/web3.js';
import { connection, drainAccount } from './rpc.js';
import { claimRewards, getClaimable } from './claim.js';
import { loadDevWallets, upsertDevWallet, keypairFromRecord } from './keystore.js';
import { config, lamportsToSol } from './config.js';
import { log, ledger } from './log.js';

// Below this the leftover isn't worth a sweep tx (fee ~0.000005 SOL); mark done.
const SWEEP_MIN_LAMPORTS = 20_000n;

// Only bother claiming a dev wallet's own fees if they exceed what claiming
// costs (the claim needs ~0.002 SOL rent for a WSOL account + tx fees). Below
// this, the fees stay in the vault (still recoverable) and we just sweep SOL.
const MIN_WORTH_CLAIMING_LAMPORTS = 5_000_000n;

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
    // One bad wallet must never abort the whole sweep.
    try {
      const dev = keypairFromRecord(rec);

      // 1. Claim the pair's own fees only if they're worth more than the claim
      //    costs (rent for a WSOL account + fees). Best-effort — a failed claim
      //    doesn't stop us from reclaiming the leftover SOL.
      const claimable = await getClaimable(dev);
      if (claimable >= MIN_WORTH_CLAIMING_LAMPORTS) {
        log(`sweep: ${rec.pubkey} has ${lamportsToSol(claimable).toFixed(6)} SOL in creator fees — claiming`);
        if (!config.dryRun) {
          try {
            feesClaimed += await claimRewards(dev);
          } catch (err) {
            log(`sweep: claim on ${rec.pubkey} failed (leaving fees in vault): ${(err as Error).message}`);
          }
        }
      } else if (claimable > 0n) {
        log(`sweep: ${rec.pubkey} has ${lamportsToSol(claimable).toFixed(6)} SOL in fees — too small to claim, leaving in vault`);
      }

      // 2. Drain the dev wallet's remaining SOL back to the treasury (closes it).
      const balance = BigInt(await connection.getBalance(dev.publicKey, 'confirmed'));
      if (balance < SWEEP_MIN_LAMPORTS) {
        log(`sweep: ${rec.pubkey} holds ${lamportsToSol(balance).toFixed(6)} SOL — dust, marking done`);
        if (!config.dryRun) upsertDevWallet({ ...rec, status: 'swept' });
        continue;
      }
      log(`sweep: draining ${lamportsToSol(balance).toFixed(6)} SOL from ${rec.pubkey}`);

      if (!config.dryRun) {
        const sig = await drainAccount(dev, treasury.publicKey, 'sweep');
        if (sig) {
          const after = BigInt(await connection.getBalance(dev.publicKey, 'confirmed'));
          reclaimed += balance - after;
          upsertDevWallet({ ...rec, status: 'swept' });
          ledger({ action: 'sweep', devWallet: rec.pubkey, reclaimed: (balance - after).toString(), sig });
        }
      } else {
        reclaimed += balance;
      }
    } catch (err) {
      log(`sweep: error on ${rec.pubkey}, skipping: ${(err as Error).message}`);
    }
  }

  log(`sweep: ${config.dryRun ? 'would reclaim' : 'reclaimed'} ${lamportsToSol(reclaimed).toFixed(6)} SOL` +
    (feesClaimed > 0n ? ` + ${lamportsToSol(feesClaimed).toFixed(6)} SOL in fees` : '') +
    ` to treasury ${treasury.publicKey.toBase58()}`);
}
