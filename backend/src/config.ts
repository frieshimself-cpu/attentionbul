import 'dotenv/config';
import { PublicKey } from '@solana/web3.js';

const LAMPORTS_PER_SOL = 1_000_000_000;

function envStr(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var ${name}`);
  return v;
}

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env var ${name} is not a number: ${v}`);
  return n;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v.toLowerCase() === 'true' || v === '1';
}

export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * LAMPORTS_PER_SOL));
}

export function lamportsToSol(lamports: bigint): number {
  return Number(lamports) / LAMPORTS_PER_SOL;
}

/**
 * Creator-rewards allocation in basis points. Must sum to 10_000.
 * 50% pair spam / 50% bagworker army.
 */
export const ALLOCATION_BPS = {
  pairSpam: 5_000,
  bagworkers: 5_000,
} as const;

export type Bucket = keyof typeof ALLOCATION_BPS;

export const config = {
  rpcUrl: envStr('RPC_URL', 'https://api.mainnet-beta.solana.com'),
  creatorWalletSecret: envStr('CREATOR_WALLET_SECRET', ''),
  bullpostMint: process.env.BULLPOST_MINT ?? '',
  bagworkerWallet: process.env.BAGWORKER_WALLET ?? '',

  dryRun: envBool('DRY_RUN', true),
  cycleMinutes: envNum('CYCLE_MINUTES', 30),
  minCycleLamports: solToLamports(envNum('MIN_CYCLE_SOL', 0.05)),
  reserveLamports: solToLamports(envNum('RESERVE_SOL', 0.05)),

  spamDevBuySol: envNum('SPAM_DEV_BUY_SOL', 0),
  spamMaxLaunchesPerCycle: envNum('SPAM_MAX_LAUNCHES_PER_CYCLE', 3),
  spamImagePath: envStr('SPAM_IMAGE_PATH', '../assets/logo.png'),
  spamTokenName: envStr('SPAM_TOKEN_NAME', '$BULLPOST'),
  spamTokenSymbol: envStr('SPAM_TOKEN_SYMBOL', 'BULLPOST'),
  pinataJwt: process.env.PINATA_JWT ?? '',
  // If set, reuse this already-pinned metadata URI for every launch instead of
  // pinning fresh via Pinata. Lets the engine run with no Pinata key at all.
  spamMetadataUri: process.env.SPAM_METADATA_URI ?? '',
  officialWebsite: envStr('OFFICIAL_WEBSITE', 'https://bullpost.fun'),
  officialTwitter: process.env.OFFICIAL_TWITTER ?? '',
  officialTelegram: process.env.OFFICIAL_TELEGRAM ?? '',

  slippageBps: envNum('SLIPPAGE_BPS', 300),

  // ---- throttled spam engine ----
  spamBurstSize: envNum('SPAM_BURST_SIZE', 3),
  spamMinIntervalSec: envNum('SPAM_MIN_INTERVAL_SEC', 5),
  spamMaxIntervalSec: envNum('SPAM_MAX_INTERVAL_SEC', 120),
  spamFullSpeedRunway: envNum('SPAM_FULL_SPEED_RUNWAY', 25),
  spamClaimEverySec: envNum('SPAM_CLAIM_EVERY_SEC', 300),
  // Fraction of each claim that funds spam (1.0 = all of it; 0.5 keeps half for
  // bagworkers). The spam engine only ever spends this reward budget — never
  // principal — so the launch rate tracks the fee-earning rate.
  spamRewardFraction: envNum('SPAM_REWARD_FRACTION', 1.0),
  // Optional one-time bootstrap: seed the spam budget from principal so the
  // engine can start launching before fees have accrued. 0 = pure rewards-funded.
  spamSeedLamports: solToLamports(envNum('SPAM_SEED_SOL', 0)),
} as const;

/**
 * BULLPOST_MINT (used only to stamp the official CA into spam metadata) and
 * BAGWORKER_WALLET may be unset pre-launch — the cycle skips/omits those with
 * a warning. Anything that IS set must be well-formed.
 */
export function validateLiveConfig(): void {
  const total = Object.values(ALLOCATION_BPS).reduce((a, b) => a + b, 0);
  if (total !== 10_000) throw new Error(`ALLOCATION_BPS must sum to 10000, got ${total}`);
  if (!config.creatorWalletSecret) throw new Error('CREATOR_WALLET_SECRET is required');
  if (config.bullpostMint) new PublicKey(config.bullpostMint); // throws if malformed
  if (config.bagworkerWallet) new PublicKey(config.bagworkerWallet);
}
