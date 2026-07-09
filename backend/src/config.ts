import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicKey } from '@solana/web3.js';

const LAMPORTS_PER_SOL = 1_000_000_000;
const ENV_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');

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
 * Cadence presets — the main dial for how aggressively the engine spams.
 * Each sets the PEAK rate (burst / minInterval); the rewards-paced throttle
 * only reaches that peak while the budget is deep, and slows toward maxInterval
 * as fees thin. `sustainSolPerHr` is roughly the fee income needed to hold the
 * peak indefinitely (peak pairs/hr × ~0.0107 SOL/pair).
 */
export const SPAM_PRESETS = {
  high: { burst: 2, minInterval: 5, maxInterval: 120, fullSpeedRunway: 25 }, // 2/5s = 1,440/hr, ~15.4 SOL/hr
  medium: { burst: 1, minInterval: 15, maxInterval: 300, fullSpeedRunway: 15 }, // 1/15s = 240/hr, ~2.6 SOL/hr
  low: { burst: 1, minInterval: 60, maxInterval: 600, fullSpeedRunway: 8 }, // 1/60s = 60/hr, ~0.6 SOL/hr
} as const;

export type SpamPreset = keyof typeof SPAM_PRESETS;

export function resolvePreset(name: string | undefined): SpamPreset {
  const n = (name ?? 'medium').toLowerCase();
  return n in SPAM_PRESETS ? (n as SpamPreset) : 'medium';
}

const activePreset = resolvePreset(process.env.SPAM_PRESET);
const preset = SPAM_PRESETS[activePreset];

export type LivePreset = { name: SpamPreset } & (typeof SPAM_PRESETS)[SpamPreset];

/**
 * Re-read the preset from .env at RUNTIME so the engine can change speed
 * without a restart: `npm run preset high|medium|low` rewrites .env and the
 * running engine picks it up within one loop tick. Falls back to the startup
 * preset if the file can't be read.
 */
export function livePreset(): LivePreset {
  let name = activePreset;
  try {
    const line = fs
      .readFileSync(ENV_PATH, 'utf8')
      .split('\n')
      .find((l) => l.startsWith('SPAM_PRESET='));
    if (line) name = resolvePreset(line.slice('SPAM_PRESET='.length).trim());
  } catch {
    /* keep startup preset */
  }
  return { name, ...SPAM_PRESETS[name] };
}

/**
 * Creator-rewards allocation in basis points. Must sum to 10_000.
 * $COPYCAT splits fees 50/50: half auto-spams new pairs, half is reserved to
 * buy DEX ads (Dexscreener / DexView paid banners + trending boosts). The
 * `adFund` half is tracked and held in the treasury (or forwarded to
 * DEX_ADS_WALLET) — the engine never spends it on spam.
 */
export const ALLOCATION_BPS = {
  spam: 5_000,
  adFund: 5_000,
} as const;

export type Bucket = keyof typeof ALLOCATION_BPS;

export const config = {
  rpcUrl: envStr('RPC_URL', 'https://api.mainnet-beta.solana.com'),
  creatorWalletSecret: envStr('CREATOR_WALLET_SECRET', ''),
  // The runner's mint (CA). COIN_MINT preferred; BULLPOST_MINT kept for back-compat.
  coinMint: process.env.COIN_MINT ?? process.env.BULLPOST_MINT ?? '',

  dryRun: envBool('DRY_RUN', true),
  cycleMinutes: envNum('CYCLE_MINUTES', 30),
  minCycleLamports: solToLamports(envNum('MIN_CYCLE_SOL', 0.05)),
  reserveLamports: solToLamports(envNum('RESERVE_SOL', 0.05)),

  spamDevBuySol: envNum('SPAM_DEV_BUY_SOL', 0),
  spamMaxLaunchesPerCycle: envNum('SPAM_MAX_LAUNCHES_PER_CYCLE', 3),
  spamImagePath: envStr('SPAM_IMAGE_PATH', '../assets/logo.webp'),
  spamTokenName: envStr('SPAM_TOKEN_NAME', '$COPYCAT'),
  spamTokenSymbol: envStr('SPAM_TOKEN_SYMBOL', 'COPYCAT'),
  // Optional: forward the 50% ad-fund half of each claim to this wallet (the one
  // you buy DEX ads from). Unset = the ad half just accrues in the treasury and
  // you withdraw it manually to buy ads.
  dexAdsWallet: process.env.DEX_ADS_WALLET ?? '',
  // Vary the pair name slightly per launch? Off = every trench pair is an
  // identical clone of the runner (the point: flood with THIS coin).
  spamVaryName: envBool('SPAM_VARY_NAME', false),
  pinataJwt: process.env.PINATA_JWT ?? '',
  // If set, reuse this already-pinned metadata URI for every launch instead of
  // pinning fresh via Pinata. Lets the engine run with no Pinata key at all.
  spamMetadataUri: process.env.SPAM_METADATA_URI ?? '',
  officialWebsite: envStr('OFFICIAL_WEBSITE', 'https://copycat.fun'),
  officialTwitter: process.env.OFFICIAL_TWITTER ?? '',
  officialTelegram: process.env.OFFICIAL_TELEGRAM ?? '',

  slippageBps: envNum('SLIPPAGE_BPS', 300),

  // ---- throttled spam engine ----
  // SPAM_PRESET (high|medium|low) is the main dial; individual SPAM_* vars below
  // override the preset if you set them explicitly.
  spamPreset: activePreset,
  spamBurstSize: envNum('SPAM_BURST_SIZE', preset.burst),
  spamMinIntervalSec: envNum('SPAM_MIN_INTERVAL_SEC', preset.minInterval),
  spamMaxIntervalSec: envNum('SPAM_MAX_INTERVAL_SEC', preset.maxInterval),
  spamFullSpeedRunway: envNum('SPAM_FULL_SPEED_RUNWAY', preset.fullSpeedRunway),
  spamClaimEverySec: envNum('SPAM_CLAIM_EVERY_SEC', 300),
  // Autoclaim polls this often but only SENDS a claim tx when the claimable
  // amount clears this floor — so claiming every 5s never burns fees on dust
  // (a claim can create a ~0.002 SOL WSOL account, so sub-floor claims lose money).
  minClaimLamports: solToLamports(envNum('MIN_CLAIM_SOL', 0.005)),
  // Fraction of each claim that funds spam — derived from the allocation so it
  // can never drift from ALLOCATION_BPS (0.5 = half funds spam, half → ad fund).
  // The engine only ever spends this reward budget, never principal, so the
  // launch rate tracks the fee-earning rate.
  spamRewardFraction: ALLOCATION_BPS.spam / 10_000,
  // Optional one-time bootstrap: seed the spam budget from principal so the
  // engine can start launching before fees have accrued. 0 = pure rewards-funded.
  spamSeedLamports: solToLamports(envNum('SPAM_SEED_SOL', 0)),
  // Spend the wallet's whole spendable balance on spam (principal + rewards),
  // not just recycled rewards. The RESERVE_SOL gas floor is always kept, and the
  // per-burst spendable guard still caps actual spending. Lets you fund fast
  // spamming by simply topping up the dev wallet.
  spamSpendPrincipal: envBool('SPAM_SPEND_PRINCIPAL', false),
} as const;

/**
 * COIN_MINT may be unset pre-launch. Anything that IS set must be well-formed.
 */
export function validateLiveConfig(): void {
  const total = Object.values(ALLOCATION_BPS).reduce((a, b) => a + b, 0);
  if (total !== 10_000) throw new Error(`ALLOCATION_BPS must sum to 10000, got ${total}`);
  if (!config.creatorWalletSecret) throw new Error('CREATOR_WALLET_SECRET is required');
  if (config.coinMint) new PublicKey(config.coinMint); // throws if malformed
  if (config.dexAdsWallet) new PublicKey(config.dexAdsWallet); // throws if malformed
}
