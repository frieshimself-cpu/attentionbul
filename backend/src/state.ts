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
  lastCycleAt: string | null;
}

const stateDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'state');
const statePath = path.join(stateDir, 'state.json');

const EMPTY: BotState = {
  buckets: { pairSpam: '0', bagworkers: '0' },
  totalClaimedLamports: '0',
  spamLaunchCount: 0,
  lastCycleAt: null,
};

export function loadState(): BotState {
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(statePath, 'utf8')) };
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
  return BigInt(state.buckets[bucket]);
}

export function creditBuckets(state: BotState, amounts: Record<Bucket, bigint>): void {
  for (const [bucket, amount] of Object.entries(amounts) as [Bucket, bigint][]) {
    state.buckets[bucket] = (BigInt(state.buckets[bucket]) + amount).toString();
  }
}

export function debitBucket(state: BotState, bucket: Bucket, amount: bigint): void {
  const current = BigInt(state.buckets[bucket]);
  if (amount > current) {
    throw new Error(`Bucket ${bucket} has ${current} lamports, tried to debit ${amount}`);
  }
  state.buckets[bucket] = (current - amount).toString();
}
