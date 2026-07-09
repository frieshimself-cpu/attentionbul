import assert from 'node:assert/strict';
import { splitLamports, splitEqually } from '../src/split.js';
import { ALLOCATION_BPS } from '../src/config.js';

// allocation sanity
assert.equal(
  Object.values(ALLOCATION_BPS).reduce((a, b) => a + b, 0),
  10_000,
  'allocation must sum to 100%'
);

// 50/50 spam / ad-fund split, nothing lost, remainder to spam
for (const total of [0n, 1n, 3n, 999n, 1_000_000_000n, 123_456_789_123n]) {
  const a = splitLamports(total);
  assert.equal(a.spam + a.adFund, total, `no lamports lost for ${total}`);
  assert.equal(a.adFund, total / 2n, `ad fund is floor(half) for ${total}`);
  assert.equal(a.spam, total - total / 2n, `spam gets its half + remainder for ${total}`);
  assert.ok(a.spam >= a.adFund, `spam >= adFund (remainder to spam) for ${total}`);
}

// splitEqually still preserves totals (used for future N-way distributions)
for (const total of [0n, 1n, 7n, 1_000_003n]) {
  const shares = splitEqually(total, 4);
  assert.equal(shares.length, 4);
  assert.equal(shares.reduce((a, b) => a + b, 0n), total, `equal split preserved for ${total}`);
}

console.log('split.test.ts: all assertions passed');
