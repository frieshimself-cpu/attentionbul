import assert from 'node:assert/strict';
import { splitLamports, splitEqually } from '../src/split.js';
import { ALLOCATION_BPS } from '../src/config.js';

// allocation sanity
assert.equal(
  Object.values(ALLOCATION_BPS).reduce((a, b) => a + b, 0),
  10_000,
  'allocation must sum to 100%'
);

// exact split, no lamports lost
for (const total of [0n, 1n, 3n, 999n, 1_000_000_000n, 123_456_789_123n]) {
  const a = splitLamports(total);
  assert.equal(a.pairSpam + a.bagworkers + a.legends, total, `sum preserved for ${total}`);
}

// 50/25/25 on a clean number
{
  const a = splitLamports(1_000_000_000n);
  assert.equal(a.pairSpam, 500_000_000n);
  assert.equal(a.bagworkers, 250_000_000n);
  assert.equal(a.legends, 250_000_000n);
}

// remainder goes to pairSpam, never lost
{
  const a = splitLamports(3n);
  assert.equal(a.pairSpam + a.bagworkers + a.legends, 3n);
  assert.ok(a.pairSpam >= a.bagworkers && a.pairSpam >= a.legends);
}

// equal split between 4 legends preserves total
for (const total of [0n, 1n, 7n, 1_000_003n]) {
  const shares = splitEqually(total, 4);
  assert.equal(shares.length, 4);
  assert.equal(shares.reduce((a, b) => a + b, 0n), total, `equal split preserved for ${total}`);
}

console.log('split.test.ts: all assertions passed');
