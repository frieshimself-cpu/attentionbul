import { Keypair } from '@solana/web3.js';
import { config, lamportsToSol } from './config.js';
import { connection } from './rpc.js';
import { claimRewards } from './claim.js';
import { launchSpamPair, launchCostLamports } from './spam.js';
import {
  BotState,
  saveState,
  getBucket,
  creditBuckets,
  debitBucket,
  recordClaim,
} from './state.js';
import { log, ledger } from './log.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** SOL the treasury can spend right now, keeping the fee/rent reserve intact. */
async function spendableLamports(treasury: Keypair): Promise<bigint> {
  const balance = BigInt(await connection.getBalance(treasury.publicKey, 'confirmed'));
  return balance > config.reserveLamports ? balance - config.reserveLamports : 0n;
}

/** How many pairs the reward budget (pairSpam bucket) can currently fund. */
function budgetRunway(state: BotState): number {
  return Number(getBucket(state, 'pairSpam') / launchCostLamports());
}

/**
 * Seconds to wait after a burst. Full speed while the reward budget is deep,
 * stretching toward the max as it drains — so the cadence tracks how fast fees
 * are coming in: rich rewards keep the budget deep (fast), thin rewards let it
 * drain (slow).
 */
export function throttleIntervalSec(runway: number): number {
  if (runway >= config.spamFullSpeedRunway) return config.spamMinIntervalSec;
  const scaled = config.spamMinIntervalSec * (config.spamFullSpeedRunway / Math.max(runway, 1));
  return Math.min(Math.round(scaled), config.spamMaxIntervalSec);
}

/** Claim fees and route the configured fraction into the spam budget. */
async function claimIntoBudget(treasury: Keypair, state: BotState): Promise<bigint> {
  const claimed = await claimRewards(treasury);
  if (claimed > 0n) {
    const toSpam = BigInt(Math.floor(Number(claimed) * config.spamRewardFraction));
    creditBuckets(state, { pairSpam: toSpam, bagworkers: claimed - toSpam });
    state.totalClaimedLamports = (BigInt(state.totalClaimedLamports) + claimed).toString();
    recordClaim(state, claimed, Date.now());
    if (!config.dryRun) saveState(state);
    log(`engine: claimed ${lamportsToSol(claimed).toFixed(4)} SOL -> ${lamportsToSol(toSpam).toFixed(4)} to spam budget`);
  }
  return claimed;
}

/**
 * Rewards-paced spam engine. The spam is funded ONLY by claimed creator fees
 * (an optional one-time SPAM_SEED_SOL can bootstrap it from principal), so the
 * launch rate automatically tracks the earning rate: claim -> fill budget ->
 * burst while the budget is deep -> slow as it drains -> pause for the next
 * claim when it's empty. Principal below RESERVE_SOL is never touched.
 *
 * @param maxLaunches optional hard cap (used for bounded test runs).
 */
export async function runSpamEngine(
  treasury: Keypair,
  state: BotState,
  maxLaunches?: number
): Promise<void> {
  log(`spam engine starting${config.dryRun ? ' (DRY RUN)' : ''} — burst ${config.spamBurstSize}, ` +
    `${lamportsToSol(launchCostLamports()).toFixed(4)} SOL/pair, funded by ` +
    `${Math.round(config.spamRewardFraction * 100)}% of creator rewards` +
    (maxLaunches ? `, capped at ${maxLaunches} launches` : ''));

  // Optional one-time bootstrap from principal.
  if (config.spamSeedLamports > 0n && !state.spamSeeded) {
    creditBuckets(state, { pairSpam: config.spamSeedLamports, bagworkers: 0n });
    state.spamSeeded = true;
    if (!config.dryRun) saveState(state);
    log(`engine: seeded spam budget with ${lamportsToSol(config.spamSeedLamports).toFixed(4)} SOL from principal`);
  }

  await claimIntoBudget(treasury, state);
  let lastClaim = Date.now();
  let launched = 0;

  for (;;) {
    // Refill the budget on a timer.
    if (Date.now() - lastClaim > config.spamClaimEverySec * 1000) {
      await claimIntoBudget(treasury, state);
      lastClaim = Date.now();
    }

    let runway = budgetRunway(state);
    const walletOk = (await spendableLamports(treasury)) >= launchCostLamports();

    // Out of reward budget (or wallet reserve) — claim once, else idle-wait.
    if (runway < 1 || !walletOk) {
      await claimIntoBudget(treasury, state);
      lastClaim = Date.now();
      runway = budgetRunway(state);
      if (runway < 1 || (await spendableLamports(treasury)) < launchCostLamports()) {
        if (maxLaunches) { log('engine: reward budget empty — stopping (capped run).'); break; }
        log(`engine: reward budget empty (${lamportsToSol(getBucket(state, 'pairSpam')).toFixed(4)} SOL) — ` +
          `waiting ${config.spamMaxIntervalSec}s for more creator fees...`);
        await sleep(config.spamMaxIntervalSec * 1000);
        continue;
      }
    }

    let burst = Math.min(config.spamBurstSize, runway);
    if (maxLaunches) burst = Math.min(burst, maxLaunches - launched);
    const intervalSec = throttleIntervalSec(runway);

    log(`engine: bursting ${burst} (budget ${lamportsToSol(getBucket(state, 'pairSpam')).toFixed(4)} SOL = ` +
      `${runway} pairs, next in ${intervalSec}s)`);

    for (let i = 0; i < burst; i++) {
      // Debit the budget before spending so a crash can't double-spend it.
      if (!config.dryRun) { debitBucket(state, 'pairSpam', launchCostLamports()); saveState(state); }
      try {
        await launchSpamPair(treasury, state);
        launched++;
      } catch (err) {
        log(`engine: launch failed: ${(err as Error).message} — refunding budget`);
        if (!config.dryRun) { creditBuckets(state, { pairSpam: launchCostLamports(), bagworkers: 0n }); saveState(state); }
        ledger({ action: 'engineLaunchError', error: (err as Error).message });
      }
      if (maxLaunches && launched >= maxLaunches) break;
    }

    if (maxLaunches && launched >= maxLaunches) {
      log(`engine: reached launch cap (${launched}) — stopping.`);
      break;
    }

    await sleep(intervalSec * 1000);
  }

  log(`spam engine stopped after ${launched} launch(es) this run.`);
}
