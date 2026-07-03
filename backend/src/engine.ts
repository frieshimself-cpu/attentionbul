import { Keypair } from '@solana/web3.js';
import { config, lamportsToSol } from './config.js';
import { connection } from './rpc.js';
import { claimRewards } from './claim.js';
import { launchSpamPair, launchCostLamports } from './spam.js';
import { BotState } from './state.js';
import { log, ledger } from './log.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** SOL the treasury can spend right now, keeping the fee/rent reserve intact. */
async function spendableLamports(treasury: Keypair): Promise<bigint> {
  const balance = BigInt(await connection.getBalance(treasury.publicKey, 'confirmed'));
  return balance > config.reserveLamports ? balance - config.reserveLamports : 0n;
}

/** How many more pairs the current balance can afford. */
function runwayFor(spendable: bigint): number {
  return Number(spendable / launchCostLamports());
}

/**
 * Seconds to wait after a burst. Full speed while there's plenty of runway,
 * then the interval stretches as funds drain — so the engine automatically
 * slows down the emptier the wallet gets.
 */
export function throttleIntervalSec(runway: number): number {
  if (runway >= config.spamFullSpeedRunway) return config.spamMinIntervalSec;
  const scaled = config.spamMinIntervalSec * (config.spamFullSpeedRunway / Math.max(runway, 1));
  return Math.min(Math.round(scaled), config.spamMaxIntervalSec);
}

/**
 * Continuous spam engine: claim fees, then launch bursts of fresh-wallet
 * billboards, throttling the cadence down as the treasury drains. Re-claims
 * fees periodically so the runway refills as pairs (and the main coin) earn.
 *
 * @param maxLaunches optional hard cap (used for bounded test runs).
 */
export async function runSpamEngine(
  treasury: Keypair,
  state: BotState,
  maxLaunches?: number
): Promise<void> {
  log(`spam engine starting${config.dryRun ? ' (DRY RUN)' : ''} — burst ${config.spamBurstSize}, ` +
    `min ${config.spamMinIntervalSec}s / max ${config.spamMaxIntervalSec}s cadence, ` +
    `${lamportsToSol(launchCostLamports()).toFixed(4)} SOL/pair` +
    (maxLaunches ? `, capped at ${maxLaunches} launches` : ''));

  // Pull in whatever's already claimable before we start spending.
  const gained = await claimRewards(treasury);
  if (gained > 0n) log(`engine: claimed ${lamportsToSol(gained).toFixed(4)} SOL to seed the run`);
  let lastClaim = Date.now();

  let launched = 0;
  for (;;) {
    // Top up the runway on a timer.
    if (!config.dryRun && Date.now() - lastClaim > config.spamClaimEverySec * 1000) {
      const g = await claimRewards(treasury);
      if (g > 0n) log(`engine: re-claimed ${lamportsToSol(g).toFixed(4)} SOL`);
      lastClaim = Date.now();
    }

    let spendable = await spendableLamports(treasury);
    let runway = runwayFor(spendable);

    if (runway < 1) {
      // Out of runway — try one claim to refill before giving up.
      const g = await claimRewards(treasury);
      lastClaim = Date.now();
      spendable = await spendableLamports(treasury);
      runway = runwayFor(spendable);
      if (runway < 1) {
        log(`engine: out of funds (${lamportsToSol(spendable).toFixed(4)} SOL spendable, ` +
          `need ${lamportsToSol(launchCostLamports()).toFixed(4)}/pair) — stopping.`);
        break;
      }
      if (g > 0n) log(`engine: re-claimed ${lamportsToSol(g).toFixed(4)} SOL, runway refilled`);
    }

    let burst = Math.min(config.spamBurstSize, runway);
    if (maxLaunches) burst = Math.min(burst, maxLaunches - launched);
    const intervalSec = throttleIntervalSec(runway);

    log(`engine: bursting ${burst} (runway ${runway} pairs, ${lamportsToSol(spendable).toFixed(4)} SOL, next in ${intervalSec}s)`);

    for (let i = 0; i < burst; i++) {
      try {
        await launchSpamPair(treasury, state);
        launched++;
      } catch (err) {
        log(`engine: launch failed: ${(err as Error).message}`);
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
