import { Keypair } from '@solana/web3.js';
import { config, lamportsToSol } from './config.js';
import { connection } from './rpc.js';
import { claimRewards } from './claim.js';
import { launchSpamPair, launchCostLamports } from './spam.js';
import { getControl, ControlState } from './control.js';
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

/** How many pairs the reward budget (spam bucket) can currently fund. */
function budgetRunway(state: BotState): number {
  return Number(getBucket(state, 'spam') / launchCostLamports());
}

/**
 * Seconds to wait after a burst. Full speed (control.intervalSec) while the
 * budget is deep; stretches toward control.maxIntervalSec as it drains — so the
 * cadence tracks earnings. Reads the LIVE control each call.
 */
export function throttleIntervalSec(runway: number, c: ControlState = getControl()): number {
  if (runway >= c.fullSpeedRunway) return c.intervalSec;
  const scaled = c.intervalSec * (c.fullSpeedRunway / Math.max(runway, 1));
  return Math.min(Math.round(scaled), c.maxIntervalSec);
}

/** Sleep, waking early (within ~1s) if the panel changed speed/burst or paused. */
async function interruptibleSleep(totalSec: number): Promise<void> {
  const snap = getControl();
  const key = `${snap.running}|${snap.burst}|${snap.intervalSec}|${snap.maxIntervalSec}|${snap.fullSpeedRunway}`;
  let remaining = totalSec * 1000;
  while (remaining > 0) {
    await sleep(Math.min(1000, remaining));
    remaining -= 1000;
    const c = getControl();
    if (`${c.running}|${c.burst}|${c.intervalSec}|${c.maxIntervalSec}|${c.fullSpeedRunway}` !== key) return;
  }
}

/** Claim fees (only past the worth-claiming floor) and add the configured fraction to the spam budget. */
async function claimIntoBudget(treasury: Keypair, state: BotState): Promise<bigint> {
  const claimed = await claimRewards(treasury); // returns 0 unless >= MIN_CLAIM_SOL
  if (claimed > 0n) {
    creditBuckets(state, { spam: claimed }); // 100% funds trench spam
    state.totalClaimedLamports = (BigInt(state.totalClaimedLamports) + claimed).toString();
    recordClaim(state, claimed, Date.now());
    if (!config.dryRun) saveState(state);
    log(`engine: claimed ${lamportsToSol(claimed).toFixed(4)} SOL -> spam budget`);
  }
  return claimed;
}

/**
 * Rewards-paced spam engine, steered live by the admin panel's control state
 * (running / burst / intervalSec / …). Funded only by claimed fees (optional
 * SPAM_SEED_SOL bootstraps a fast start), so the launch rate tracks earnings.
 * Resilient: transient RPC errors are logged and retried, never fatal.
 *
 * @param maxLaunches optional hard cap (bounded test runs).
 * @param autostart if true, force running=true at startup (CLI `npm run spam`).
 */
export async function runSpamEngine(
  treasury: Keypair,
  state: BotState,
  maxLaunches?: number,
  autostart = true
): Promise<void> {
  const capped = typeof maxLaunches === 'number' && maxLaunches >= 0;
  const c0 = getControl();
  if (autostart && !c0.running) c0.running = true;

  log(`spam engine live${config.dryRun ? ' (DRY RUN)' : ''} — ${lamportsToSol(launchCostLamports()).toFixed(4)} SOL/pair, ` +
    `funded by ${Math.round(config.spamRewardFraction * 100)}% of creator rewards` +
    (capped ? `, capped at ${maxLaunches} launches` : '') + '. Steer it from the admin panel.');

  // Optional one-time bootstrap from principal for a fast start.
  if (config.spamSeedLamports > 0n && !state.spamSeeded) {
    creditBuckets(state, { spam: config.spamSeedLamports });
    state.spamSeeded = true;
    if (!config.dryRun) saveState(state);
    log(`engine: seeded spam budget with ${lamportsToSol(config.spamSeedLamports).toFixed(4)} SOL from principal`);
  }

  let lastClaim = 0;
  let launched = 0;

  for (;;) {
    try {
      const c = getControl();
      if (!c.running) { await sleep(1000); continue; } // paused from the panel

      if (Date.now() - lastClaim > c.claimEverySec * 1000) {
        await claimIntoBudget(treasury, state);
        lastClaim = Date.now();
      }

      const runway = budgetRunway(state);
      const spendable = await spendableLamports(treasury);

      if (runway < 1 || spendable < launchCostLamports()) {
        if (capped) { log('engine: reward budget empty — stopping (capped run).'); break; }
        log(`engine: budget ${lamportsToSol(getBucket(state, 'spam')).toFixed(4)} SOL / spendable ` +
          `${lamportsToSol(spendable).toFixed(4)} SOL — waiting for creator fees...`);
        await interruptibleSleep(Math.min(c.maxIntervalSec, c.claimEverySec));
        continue;
      }

      const cost = launchCostLamports();
      let burst = Math.min(c.burst, runway);
      if (capped) burst = Math.min(burst, maxLaunches! - launched);
      // Reserve guard for the whole burst: never fund more than the wallet can spare.
      const affordable = Number(spendable / cost);
      burst = Math.min(burst, affordable);
      if (burst < 1) { await interruptibleSleep(c.intervalSec); continue; }

      const intervalSec = throttleIntervalSec(runway, c);
      log(`engine: bursting ${burst} in parallel (budget ${lamportsToSol(getBucket(state, 'spam')).toFixed(4)} SOL = ${runway} pairs, next in ${intervalSec}s)`);

      // Debit the whole burst up-front, then fire all launches CONCURRENTLY.
      // Safe because every shared-state write (saveState, keystore, count++) is
      // synchronous — no interleaving mid-write in Node's single thread.
      if (!config.dryRun) { for (let i = 0; i < burst; i++) debitBucket(state, 'spam', cost); saveState(state); }

      const results = await Promise.allSettled(
        Array.from({ length: burst }, () => launchSpamPair(treasury, state))
      );
      let refund = 0n;
      for (const r of results) {
        if (r.status === 'fulfilled') { launched++; continue; }
        const funded = (r.reason as { funded?: boolean })?.funded;
        if (!config.dryRun && !funded) refund += cost; // no SOL left → give the budget back
        log(`engine: launch failed${funded ? ' after funding (recover via sweep)' : ' (budget refunded)'}: ${(r.reason as Error)?.message}`);
        ledger({ action: 'engineLaunchError', funded: !!funded, error: (r.reason as Error)?.message });
      }
      if (!config.dryRun && refund > 0n) { creditBuckets(state, { spam: refund }); saveState(state); }

      if (capped && launched >= maxLaunches!) { log(`engine: reached launch cap (${launched}) — stopping.`); break; }

      await interruptibleSleep(intervalSec);
    } catch (err) {
      log(`engine: transient error, retrying in 5s: ${(err as Error).message}`);
      ledger({ action: 'engineError', error: (err as Error).message });
      await sleep(5000);
    }
  }

  log(`spam engine stopped after ${launched} launch(es) this run.`);
}
