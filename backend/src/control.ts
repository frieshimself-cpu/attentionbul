import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { livePreset } from './config.js';

/**
 * Live, mutable engine controls shared between the HTTP admin panel and the
 * running engine loop. The engine reads these every tick, so changes from the
 * panel take effect within ~1 loop iteration — no restart. Persisted to
 * state/control.json so settings survive a restart.
 */
export interface ControlState {
  running: boolean; // engine actively launching, or paused
  burst: number; // pairs per burst (the "amount" dial)
  intervalSec: number; // seconds between bursts at full budget (the "speed" dial)
  maxIntervalSec: number; // slowest cadence when the budget is thin
  fullSpeedRunway: number; // launch at full speed while budget >= this many pairs
  claimEverySec: number; // autoclaim cadence
}

const stateDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'state');
const controlPath = path.join(stateDir, 'control.json');

function defaults(): ControlState {
  const p = livePreset();
  return {
    running: false, // start paused; the panel arms it
    burst: p.burst,
    intervalSec: p.minInterval,
    maxIntervalSec: p.maxInterval,
    fullSpeedRunway: p.fullSpeedRunway,
    claimEverySec: 5,
  };
}

/**
 * Read the live control fresh from disk each call, so a change made in one
 * process (the panel, or `npm run preset` from a terminal) is seen by the
 * engine loop in another process within one tick.
 */
export function getControl(): ControlState {
  try {
    return { ...defaults(), ...JSON.parse(fs.readFileSync(controlPath, 'utf8')) };
  } catch {
    return defaults();
  }
}

/** Merge a partial update, clamp to sane ranges, persist, and return the new state. */
export function updateControl(patch: Partial<ControlState>): ControlState {
  const c = getControl();
  if (patch.running !== undefined) c.running = !!patch.running;
  if (patch.burst !== undefined) c.burst = clamp(Math.round(patch.burst), 1, 50);
  if (patch.intervalSec !== undefined) c.intervalSec = clamp(patch.intervalSec, 1, 3600);
  if (patch.maxIntervalSec !== undefined) c.maxIntervalSec = clamp(patch.maxIntervalSec, c.intervalSec, 7200);
  if (patch.fullSpeedRunway !== undefined) c.fullSpeedRunway = clamp(Math.round(patch.fullSpeedRunway), 1, 1000);
  if (patch.claimEverySec !== undefined) c.claimEverySec = clamp(patch.claimEverySec, 3, 3600);
  persist(c);
  return c;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
}

function persist(c: ControlState): void {
  fs.mkdirSync(stateDir, { recursive: true });
  const tmp = controlPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(c, null, 2));
  fs.renameSync(tmp, controlPath);
}
