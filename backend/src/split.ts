import { ALLOCATION_BPS, Bucket } from './config.js';

export type Allocation = Record<Bucket, bigint>;

/**
 * Split an amount of lamports across the allocation buckets using integer
 * basis-point math. Any rounding remainder (at most a few lamports) goes to
 * the largest bucket (pairSpam) so the total always adds up exactly.
 */
export function splitLamports(total: bigint): Allocation {
  if (total < 0n) throw new Error(`Cannot split negative amount: ${total}`);
  const out = {} as Allocation;
  let assigned = 0n;
  for (const [bucket, bps] of Object.entries(ALLOCATION_BPS) as [Bucket, number][]) {
    const share = (total * BigInt(bps)) / 10_000n;
    out[bucket] = share;
    assigned += share;
  }
  out.pairSpam += total - assigned;
  return out;
}

/**
 * Split a token amount equally between n recipients; the remainder
 * (at most n-1 base units) goes to the last recipient.
 */
export function splitEqually(total: bigint, n: number): bigint[] {
  if (n <= 0) throw new Error('n must be positive');
  if (total < 0n) throw new Error(`Cannot split negative amount: ${total}`);
  const base = total / BigInt(n);
  const shares = Array.from({ length: n }, () => base);
  shares[n - 1] += total - base * BigInt(n);
  return shares;
}
