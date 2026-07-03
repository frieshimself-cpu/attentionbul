import { Keypair } from '@solana/web3.js';
import { config, lamportsToSol, solToLamports, validateLiveConfig } from './config.js';
import { loadKeypair } from './wallet.js';
import { splitLamports } from './split.js';
import { loadState, saveState, getBucket, creditBuckets, debitBucket, BotState } from './state.js';
import { connection } from './rpc.js';
import { claimRewards } from './claim.js';
import { payBagworkers } from './payroll.js';
import { launchSpamPair, launchCostLamports } from './spam.js';
import { log, ledger } from './log.js';

const MIN_PAYROLL_LAMPORTS = solToLamports(0.01);

/** SOL available for spending right now, keeping the fee/rent reserve intact. */
async function spendable(creator: Keypair): Promise<bigint> {
  const balance = BigInt(await connection.getBalance(creator.publicKey, 'confirmed'));
  return balance > config.reserveLamports ? balance - config.reserveLamports : 0n;
}

async function runCycle(creator: Keypair, state: BotState): Promise<void> {
  log(`===== cycle start${config.dryRun ? ' (DRY RUN — nothing will be sent)' : ''} =====`);
  log(`wallet: ${creator.publicKey.toBase58()}`);

  // 1. Claim creator rewards and credit the buckets 50/25/25.
  const claimed = await claimRewards(creator);
  if (claimed >= config.minCycleLamports) {
    const split = splitLamports(claimed);
    log(
      `split: +${lamportsToSol(split.pairSpam).toFixed(4)} pairSpam, ` +
        `+${lamportsToSol(split.bagworkers).toFixed(4)} bagworkers`
    );
    if (!config.dryRun) {
      creditBuckets(state, split);
      state.totalClaimedLamports = (BigInt(state.totalClaimedLamports) + claimed).toString();
      saveState(state);
    } else {
      ledger({ action: 'split', dryRun: true, claimed: claimed.toString(), split: { pairSpam: split.pairSpam.toString(), bagworkers: split.bagworkers.toString() } });
    }
  } else if (claimed > 0n) {
    log(`claim below MIN_CYCLE_SOL threshold — leaving it in the vault for next cycle`);
  }

  // 2. Bagworker payroll (25%): forward the bucket as SOL.
  const payrollBucket = getBucket(state, 'bagworkers');
  if (!config.bagworkerWallet) {
    if (payrollBucket > 0n) log('payroll: BAGWORKER_WALLET not set — skipping');
  } else if (payrollBucket >= MIN_PAYROLL_LAMPORTS) {
    const amount = payrollBucket <= (await spendable(creator)) ? payrollBucket : 0n;
    if (amount === 0n) {
      log('payroll: wallet balance below bucket + reserve — deferring');
    } else {
      if (!config.dryRun) {
        debitBucket(state, 'bagworkers', amount);
        saveState(state);
      }
      try {
        await payBagworkers(creator, amount);
      } catch (err) {
        log(`payroll failed: ${(err as Error).message} — re-crediting bucket`);
        if (!config.dryRun) {
          creditBuckets(state, { pairSpam: 0n, bagworkers: amount });
          saveState(state);
        }
      }
    }
  }

  // 3. Pair spam engine (50%): launch billboards while the bucket affords them.
  const costPerLaunch = launchCostLamports();
  let launches = 0;
  while (
    launches < config.spamMaxLaunchesPerCycle &&
    getBucket(state, 'pairSpam') >= costPerLaunch &&
    (await spendable(creator)) >= costPerLaunch
  ) {
    if (!config.dryRun) {
      debitBucket(state, 'pairSpam', costPerLaunch);
      saveState(state);
    }
    try {
      await launchSpamPair(creator, state);
      launches++;
    } catch (err) {
      log(`spam launch failed: ${(err as Error).message} — re-crediting bucket`);
      if (!config.dryRun) {
        creditBuckets(state, { pairSpam: costPerLaunch, bagworkers: 0n });
        saveState(state);
      }
      break; // don't hammer a failing endpoint
    }
    if (config.dryRun) launches++; // dry-run would loop forever otherwise
  }
  if (launches > 0) log(`spam: ${launches} billboard launch(es) this cycle`);

  state.lastCycleAt = new Date().toISOString();
  if (!config.dryRun) saveState(state);
  printStatus(state);
  log('===== cycle end =====');
}

function printStatus(state: BotState): void {
  log(
    `buckets: pairSpam ${lamportsToSol(getBucket(state, 'pairSpam')).toFixed(4)} SOL | ` +
      `bagworkers ${lamportsToSol(getBucket(state, 'bagworkers')).toFixed(4)} SOL`
  );
  log(
    `lifetime: claimed ${lamportsToSol(BigInt(state.totalClaimedLamports)).toFixed(4)} SOL, ` +
      `${state.spamLaunchCount} billboard launches, last cycle ${state.lastCycleAt ?? 'never'}`
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const state = loadState();

  if (args.includes('--status')) {
    printStatus(state);
    log('allocation: 50% pair spam / 50% bagworker army');
    return;
  }

  validateLiveConfig();
  const creator = loadKeypair(config.creatorWalletSecret);

  if (args.includes('--loop')) {
    log(`looping every ${config.cycleMinutes} minutes (Ctrl-C to stop)`);
    for (;;) {
      try {
        await runCycle(creator, state);
      } catch (err) {
        log(`cycle crashed: ${(err as Error).message}`);
        ledger({ action: 'cycleError', error: (err as Error).message });
      }
      await new Promise((r) => setTimeout(r, config.cycleMinutes * 60_000));
    }
  }

  await runCycle(creator, state);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
