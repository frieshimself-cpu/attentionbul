import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bucket } from './config.js';

/**
 * Persistent bucket balances (in lamports) that survive restarts.
 *
 * Flow: every claim credits the buckets per ALLOCATION_BPS; every executed
 * action debits its bucket BEFORE the transaction is sent. If the process
 * dies mid-send, the worst case is an under-spend (SOL stays in the wallet,
 * bucket already debited) — never a double-spend. Reconcile manually via
 * state/ledger.jsonl if that ever happens.
 */
export interface BotState {
  buckets: Record<Bucket, string>; // bigint as string for JSON
  totalClaimedLamports: string;
  spamLaunchCount: number;
  spamMetadataUri?: string; // pinned once, reused for every billboard launch
  spamImageCid?: string; // image pinned once, reused across per-pair metadata
  spamSeeded?: boolean; // one-time principal seed applied
  recentClaims?: { ts: number; lamports: string }[]; // rolling window for reward-rate
  communityLastCount?: number; // last-seen X community member count (join-watcher baseline)
  lastCycleAt: string | null;
}

/** Record a claim for reward-rate estimation; keeps the last 50. */
export function recordClaim(state: BotState, lamports: bigint, ts: number): void {
  if (lamports <= 0n) return;
  state.recentClaims = [...(state.recentClaims ?? []), { ts, lamports: lamports.toString() }].slice(-50);
}

/** Estimated reward inflow in lamports/hour from the recent-claims window. */
export function rewardRatePerHour(state: BotState): bigint {
  const claims = state.recentClaims ?? [];
  if (claims.length < 2) return 0n;
  const spanMs = claims[claims.length - 1].ts - claims[0].ts;
  if (spanMs <= 0) return 0n;
  // Sum everything after the first sample (the first just marks the window start).
  const total = claims.slice(1).reduce((a, c) => a + BigInt(c.lamports), 0n);
  return (total * 3_600_000n) / BigInt(spanMs);
}

const stateDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'state');
const statePath = path.join(stateDir, 'state.json');

const EMPTY: BotState = {
  buckets: { spam: '0' },
  totalClaimedLamports: '0',
  spamLaunchCount: 0,
  lastCycleAt: null,
};

export function loadState(): BotState {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    // Merge buckets so a state file written before a new bucket existed (e.g. an
    // old spam-only file) still gets every current bucket seeded to '0'.
    return { ...EMPTY, ...parsed, buckets: { ...EMPTY.buckets, ...(parsed.buckets ?? {}) } };
  } catch {
    return structuredClone(EMPTY);
  }
}

export function saveState(state: BotState): void {
  fs.mkdirSync(stateDir, { recursive: true });
  const tmp = statePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, statePath);
}

export function getBucket(state: BotState, bucket: Bucket): bigint {
  return BigInt(state.buckets[bucket] ?? '0');
}

export function creditBuckets(state: BotState, amounts: Partial<Record<Bucket, bigint>>): void {
  for (const [bucket, amount] of Object.entries(amounts) as [Bucket, bigint][]) {
    state.buckets[bucket] = (BigInt(state.buckets[bucket] ?? '0') + amount).toString();
  }
}

export function debitBucket(state: BotState, bucket: Bucket, amount: bigint): void {
  const current = BigInt(state.buckets[bucket]);
  if (amount > current) {
    throw new Error(`Bucket ${bucket} has ${current} lamports, tried to debit ${amount}`);
  }
  state.buckets[bucket] = (current - amount).toString();
}
