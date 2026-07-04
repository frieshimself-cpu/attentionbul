import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair } from '@solana/web3.js';
import { config, lamportsToSol, solToLamports, validateLiveConfig, SPAM_PRESETS, resolvePreset, livePreset } from './config.js';
import { getControl, updateControl } from './control.js';
import { loadKeypair } from './wallet.js';
import { splitLamports } from './split.js';
import { loadState, saveState, getBucket, creditBuckets, debitBucket, rewardRatePerHour, BotState } from './state.js';
import { connection } from './rpc.js';
import { claimRewards, getClaimable } from './claim.js';
import { payBagworkers } from './payroll.js';
import { launchSpamPair, launchCostLamports } from './spam.js';
import { runSpamEngine, throttleIntervalSec } from './engine.js';
import { sweepDevWallets } from './sweep.js';
import { loadDevWallets } from './keystore.js';
import { log, ledger } from './log.js';

const MIN_PAYROLL_LAMPORTS = solToLamports(0.01);

/** SOL available for spending right now, keeping the fee/rent reserve intact. */
async function spendable(creator: Keypair): Promise<bigint> {
  const balance = BigInt(await connection.getBalance(creator.publicKey, 'confirmed'));
  return balance > config.reserveLamports ? balance - config.reserveLamports : 0n;
}

async function runCycle(creator: Keypair, state: BotState): Promise<void> {
  log(`===== cycle start${config.dryRun ? ' (DRY RUN — nothing will be sent)' : ''} =====`);

  // 1. Claim creator rewards and credit the buckets 50/50.
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

/** Live management view: balance, claimable, reward budget + rate, runway, dev wallets. */
async function printManagementView(treasury: Keypair, state: BotState): Promise<void> {
  const [balance, claimable] = await Promise.all([
    connection.getBalance(treasury.publicKey, 'confirmed').then((b) => BigInt(b)),
    getClaimable(treasury),
  ]);
  const spendable = balance > config.reserveLamports ? balance - config.reserveLamports : 0n;
  const budget = getBucket(state, 'pairSpam');
  const runway = Number(budget / launchCostLamports());
  const lp = getControl();
  const interval = throttleIntervalSec(runway);
  const cost = launchCostLamports();
  const ratePerHour = rewardRatePerHour(state);
  const pairsPerHour = ratePerHour > 0n ? Number((ratePerHour * BigInt(Math.round(config.spamRewardFraction * 100))) / 100n / cost) : 0;
  const wallets = loadDevWallets();
  const unswept = wallets.filter((w) => w.status !== 'swept').length;

  log('================ $BULLPOST bot status ================');
  log(`treasury:      ${treasury.publicKey.toBase58()}`);
  log(`balance:       ${lamportsToSol(balance).toFixed(4)} SOL  (spendable ${lamportsToSol(spendable).toFixed(4)}, reserve ${lamportsToSol(config.reserveLamports).toFixed(4)})`);
  log(`claimable:     ${lamportsToSol(claimable).toFixed(6)} SOL in unclaimed creator fees`);
  log(`spam budget:   ${lamportsToSol(budget).toFixed(4)} SOL = ${runway} pairs queued (funded by ${Math.round(config.spamRewardFraction * 100)}% of rewards)`);
  log(`reward rate:   ${lamportsToSol(ratePerHour).toFixed(4)} SOL/hr in fees  ->  ~${pairsPerHour} pairs/hr sustainable`);
  log(`engine:        ${lp.running ? 'RUNNING' : 'PAUSED'}  (peak burst ${lp.burst} every ${lp.intervalSec}s)`);
  log(`cadence now:   burst ${lp.burst} every ${interval}s (min ${lp.intervalSec}s / max ${lp.maxIntervalSec}s)`);
  log(`launched:      ${state.spamLaunchCount} lifetime | dev wallets ${wallets.length} (${unswept} unswept — 'npm run sweep')`);
  log('======================================================');
}

/** Write SPAM_PRESET into .env so a switch survives restarts. */
function setPreset(level: string): void {
  const preset = resolvePreset(level);
  if (preset !== level.toLowerCase()) {
    log(`unknown preset "${level}" — use one of: ${Object.keys(SPAM_PRESETS).join(', ')}`);
    return;
  }
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
  let lines: string[] = [];
  try { lines = fs.readFileSync(envPath, 'utf8').split('\n'); } catch { /* new file */ }
  const idx = lines.findIndex((l) => l.startsWith('SPAM_PRESET='));
  if (idx >= 0) lines[idx] = `SPAM_PRESET=${preset}`;
  else lines.push(`SPAM_PRESET=${preset}`);
  fs.writeFileSync(envPath, lines.join('\n'), { mode: 0o600 });
  const p = SPAM_PRESETS[preset];
  // Also push it into the live control so a RUNNING engine/panel picks it up now.
  updateControl({ burst: p.burst, intervalSec: p.minInterval, maxIntervalSec: p.maxInterval, fullSpeedRunway: p.fullSpeedRunway });
  log(`preset set to ${preset.toUpperCase()} — peak ${p.burst} pair(s) every ${p.minInterval}s (applied live).`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const state = loadState();
  const maxArg = args.indexOf('--max');
  const maxLaunches = maxArg >= 0 ? Number(args[maxArg + 1]) : undefined;

  // Switch cadence preset (no wallet needed): npm run preset high|medium|low
  const presetArg = args.indexOf('--preset');
  if (presetArg >= 0) {
    setPreset(args[presetArg + 1] ?? '');
    return;
  }

  // Offline status (no wallet needed): state file only.
  if (args.includes('--status') && !config.creatorWalletSecret) {
    printStatus(state);
    log('allocation: 50% pair spam / 50% bagworker army');
    return;
  }

  validateLiveConfig();
  const creator = loadKeypair(config.creatorWalletSecret);

  // Live management view.
  if (args.includes('--status')) {
    await printManagementView(creator, state);
    return;
  }

  log(`wallet: ${creator.publicKey.toBase58()}`);

  // Fail fast rather than spin-and-fail: a live launch needs a metadata source.
  const needsMetadata = args.includes('--spam') || args.includes('--launch-one');
  if (needsMetadata && !config.dryRun && !config.spamMetadataUri && !config.pinataJwt) {
    log('CANNOT LAUNCH LIVE: no metadata source. Set PINATA_JWT (to pin link-free metadata) ' +
      'or SPAM_METADATA_URI (reuse an existing pinned URI) in .env, then retry.');
    process.exit(1);
  }

  // Continuous throttled spam engine (claim -> burst -> throttle -> repeat).
  if (args.includes('--spam')) {
    await runSpamEngine(creator, state, Number.isFinite(maxLaunches) ? maxLaunches : undefined);
    return;
  }

  // ---- test commands (each does ONE thing, so you can prove a path in isolation) ----

  // Read-only: how much creator fee is claimable right now. Never signs anything.
  if (args.includes('--claimable')) {
    const claimable = await getClaimable(creator);
    log(`claimable creator fees: ${lamportsToSol(claimable).toFixed(6)} SOL (bonding-curve + PumpSwap vaults)`);
    if (claimable === 0n) {
      log('nothing to claim yet — a coin this wallet created needs some trading volume first.');
    }
    return;
  }

  // Claim creator fees only (no split, no spam). Honors DRY_RUN.
  if (args.includes('--claim')) {
    const gained = await claimRewards(creator);
    log(gained > 0n
      ? `claim complete: ${lamportsToSol(gained).toFixed(6)} SOL landed in the wallet`
      : 'claim: nothing was claimable.');
    return;
  }

  // Launch exactly ONE billboard pair (no claim, no buckets). Honors DRY_RUN.
  // The cheapest real end-to-end test of the spam path (~0.013 SOL live).
  if (args.includes('--launch-one')) {
    const before = BigInt(await connection.getBalance(creator.publicKey, 'confirmed'));
    log(`treasury balance before: ${lamportsToSol(before).toFixed(4)} SOL`);
    if (!config.dryRun && before < launchCostLamports() + config.reserveLamports) {
      log(`insufficient balance — need ~${lamportsToSol(launchCostLamports() + config.reserveLamports).toFixed(4)} SOL (launch cost + reserve). Fund the wallet and retry.`);
      return;
    }
    const mint = await launchSpamPair(creator, state);
    if (!config.dryRun && mint) {
      const after = BigInt(await connection.getBalance(creator.publicKey, 'confirmed'));
      log(`treasury balance after: ${lamportsToSol(after).toFixed(4)} SOL (spent ${lamportsToSol(before - after).toFixed(4)} SOL)`);
      log(`view it: https://pump.fun/coin/${mint}  |  https://solscan.io/token/${mint}`);
      log('reclaim the dev wallet\'s leftover SOL any time with:  npm run sweep');
    }
    return;
  }

  // Reclaim leftover SOL (and any fees) from used dev wallets back to treasury.
  if (args.includes('--sweep')) {
    await sweepDevWallets(creator);
    return;
  }

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
