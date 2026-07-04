import { updateControl, getControl, ControlState } from './control.js';
import { log } from './log.js';

/**
 * Dead-simple live control: `npm run set <field> <value> [<field> <value> ...]`
 * Changes apply to a running engine/panel within ~1s (control is file-backed).
 *
 * Fields (aliases in []):
 *   amount   [pairs, burst]      pairs launched per burst
 *   speed    [interval, freq, frequency, every]  seconds between bursts (lower = faster)
 *   claim    [claimspeed, claimevery]            autoclaim every N seconds
 *   maxslow  [maxinterval]       slowest interval when the budget is thin
 *   runway   [fullspeed]         launch full-speed while budget >= this many pairs
 *   on|start / off|stop|pause    turn the engine on/off
 *
 * Examples:
 *   npm run set speed 3 amount 5      # 5 pairs every 3s
 *   npm run set claim 5              # claim every 5s
 *   npm run set off                 # pause
 */
const ALIASES: Record<string, keyof ControlState | 'running'> = {
  amount: 'burst', pairs: 'burst', burst: 'burst',
  speed: 'intervalSec', interval: 'intervalSec', freq: 'intervalSec', frequency: 'intervalSec', every: 'intervalSec',
  claim: 'claimEverySec', claimspeed: 'claimEverySec', claimevery: 'claimEverySec',
  maxslow: 'maxIntervalSec', maxinterval: 'maxIntervalSec',
  runway: 'fullSpeedRunway', fullspeed: 'fullSpeedRunway',
};

function main(): void {
  const args = process.argv.slice(2).filter((a) => a !== '--set');
  if (args.length === 0) {
    const c = getControl();
    log(`current: ${c.running ? 'RUNNING' : 'PAUSED'} | amount ${c.burst}/burst | speed ${c.intervalSec}s | claim ${c.claimEverySec}s | maxslow ${c.maxIntervalSec}s | runway ${c.fullSpeedRunway}`);
    log('usage: npm run set speed 3 amount 5   (also: claim N, on, off)');
    return;
  }

  const patch: Partial<ControlState> = {};
  for (let i = 0; i < args.length; i++) {
    const tok = args[i].toLowerCase().replace(/[=:]/g, ' ').trim();
    // allow "speed=3" style
    const [k, inlineV] = tok.split(/\s+/);
    if (k === 'on' || k === 'start') { patch.running = true; continue; }
    if (k === 'off' || k === 'stop' || k === 'pause') { patch.running = false; continue; }
    const field = ALIASES[k];
    if (!field) { log(`unknown field "${k}" — use amount|speed|claim|maxslow|runway|on|off`); continue; }
    const raw = inlineV ?? args[++i];
    const val = Number(raw);
    if (!Number.isFinite(val)) { log(`bad value for ${k}: "${raw}"`); continue; }
    (patch as Record<string, number>)[field] = val;
  }

  const c = updateControl(patch);
  log(`✓ applied (live within ~1s): ${c.running ? 'RUNNING' : 'PAUSED'} | amount ${c.burst}/burst | speed ${c.intervalSec}s | claim ${c.claimEverySec}s | maxslow ${c.maxIntervalSec}s | runway ${c.fullSpeedRunway}`);
}

main();
