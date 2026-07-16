import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair } from '@solana/web3.js';
import { config, lamportsToSol } from './config.js';
import { connection } from './rpc.js';
import { claimRewards } from './claim.js';
import { launchSpamPair, launchCostLamports } from './spam.js';
import { getControl } from './control.js';
import {
  BotState,
  saveState,
  getBucket,
  creditBuckets,
  debitBucket,
  recordClaim,
} from './state.js';
import { log, ledger } from './log.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const stateDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'state');
/**
 * Manual / external member-count feed. Since X has no join webhook and blocks
 * scrapers, the most RELIABLE source is to have something write the current
 * member count here (one integer). An external script, a Zapier/IFTTT hook, or
 * you by hand — anything that can see the real count — can drive the watcher.
 */
const overridePath = path.join(stateDir, 'member-count.txt');

/** Pull the numeric community id out of a full URL or a bare id string. */
export function extractCommunityId(urlOrId: string): string {
  const s = (urlOrId || '').trim();
  const m = s.match(/communities\/(\d+)/);
  if (m) return m[1];
  if (/^\d+$/.test(s)) return s;
  return '';
}

/** Locally-fed count (state/member-count.txt) — the reliable, source-agnostic path. */
function fromOverrideFile(): number | null {
  try {
    const n = Number(fs.readFileSync(overridePath, 'utf8').trim());
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

/** X API v2 community lookup (needs a bearer token with community access). */
async function fromXApi(id: string): Promise<number | null> {
  if (!config.xBearerToken) return null;
  try {
    const res = await fetch(
      `https://api.twitter.com/2/communities/${id}?community.fields=member_count`,
      { headers: { Authorization: `Bearer ${config.xBearerToken}` } }
    );
    if (!res.ok) {
      log(`community: X API ${res.status} — ${(await res.text().catch(() => '')).slice(0, 160)}`);
      return null;
    }
    const j = (await res.json()) as { data?: { member_count?: number } };
    return typeof j?.data?.member_count === 'number' ? j.data.member_count : null;
  } catch (e) {
    log(`community: X API error ${(e as Error).message}`);
    return null;
  }
}

/** Best-effort public-page scrape. X usually blocks this; used only as last resort. */
async function fromScrape(id: string): Promise<number | null> {
  try {
    const res = await fetch(`https://x.com/i/communities/${id}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
        Accept: 'text/html',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m =
      html.match(/"member_count":\s*(\d+)/) ||
      html.match(/([\d,]+)\s+Members/i);
    return m ? Number(m[1].replace(/,/g, '')) : null;
  } catch {
    return null;
  }
}

/**
 * Current member count, trying the reliable sources first:
 *   1. state/member-count.txt  (manual / external feed)
 *   2. X API v2                (if X_BEARER_TOKEN is set)
 *   3. public-page scrape       (best effort — often blocked)
 */
export async function getCommunityMemberCount(
  id: string
): Promise<{ count: number; source: string } | null> {
  const ov = fromOverrideFile();
  if (ov !== null) return { count: ov, source: 'override-file' };
  const api = await fromXApi(id);
  if (api !== null) return { count: api, source: 'x-api' };
  const sc = await fromScrape(id);
  if (sc !== null) return { count: sc, source: 'scrape' };
  return null;
}

/** SOL the treasury can spend right now, keeping the fee/rent reserve intact. */
async function spendableLamports(treasury: Keypair): Promise<bigint> {
  const b = BigInt(await connection.getBalance(treasury.publicKey, 'confirmed'));
  return b > config.reserveLamports ? b - config.reserveLamports : 0n;
}

/**
 * Fire up to `want` pair launches, funded exactly like the main engine:
 * claim fresh fees into the budget, optionally top up from principal, then burst
 * as many as the budget AND the reserve-protected spendable balance allow.
 * Returns how many actually launched.
 */
async function fireLaunches(treasury: Keypair, state: BotState, want: number): Promise<number> {
  const cost = launchCostLamports();

  // Claim first so a join can be funded by the fees the coin just earned.
  try {
    const claimed = await claimRewards(treasury);
    if (claimed > 0n) {
      creditBuckets(state, { spam: claimed });
      state.totalClaimedLamports = (BigInt(state.totalClaimedLamports) + claimed).toString();
      recordClaim(state, claimed, Date.now());
      if (!config.dryRun) saveState(state);
      log(`community: claimed ${lamportsToSol(claimed).toFixed(4)} SOL -> spam budget`);
    }
  } catch (e) {
    log(`community: claim skipped (${(e as Error).message}) — funding from existing budget`);
  }

  // Spend-principal mode: raise the budget up to the spendable balance.
  if (config.spamSpendPrincipal && !config.dryRun) {
    const sp = await spendableLamports(treasury);
    const bud = getBucket(state, 'spam');
    if (sp > bud) {
      creditBuckets(state, { spam: sp - bud });
      saveState(state);
    }
  }

  const budgetRunway = Number(getBucket(state, 'spam') / cost);
  const spendable = await spendableLamports(treasury);
  const affordable = Number(spendable / cost);
  const burst = Math.min(want, budgetRunway, affordable);
  if (burst < 1) {
    log(
      `community: wanted ${want} pair(s) but budget/balance too low ` +
        `(need ~${lamportsToSol(cost).toFixed(4)} SOL/pair) — skipped this join.`
    );
    return 0;
  }

  // Debit the whole burst up-front, then fire concurrently (same model as engine).
  if (!config.dryRun) {
    for (let i = 0; i < burst; i++) debitBucket(state, 'spam', cost);
    saveState(state);
  }
  const results = await Promise.allSettled(
    Array.from({ length: burst }, () => launchSpamPair(treasury, state))
  );
  let ok = 0;
  let refund = 0n;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      ok++;
      continue;
    }
    const funded = (r.reason as { funded?: boolean })?.funded;
    if (!config.dryRun && !funded) refund += cost; // no SOL left the wallet → refund budget
    log(`community: launch failed${funded ? ' after funding (recover via sweep)' : ''}: ${(r.reason as Error)?.message}`);
  }
  if (!config.dryRun && refund > 0n) {
    creditBuckets(state, { spam: refund });
    saveState(state);
  }
  return ok;
}

/**
 * Watch an X community's member count and spam `communityPairsPerJoin` new
 * $COPYCAT pairs for every new member that joins.
 *
 * X exposes no join event/webhook, so this POLLS the member count every
 * `communityPollSec`. On the first read it just records a baseline (no launches);
 * after that, any increase of N members fires N × pairsPerJoin launches (capped
 * by communityMaxPairsPerTick). Honors the global control.running pause switch.
 */
export async function runCommunityWatcher(treasury: Keypair, state: BotState): Promise<void> {
  const id = extractCommunityId(config.communityUrl);
  if (!id) {
    log(
      'community: no X community set. Put the community URL in X_COMMUNITY_URL ' +
        '(or OFFICIAL_TWITTER) in .env — e.g. https://x.com/i/communities/2016604775677047117 — then restart.'
    );
    return;
  }
  const per = Math.max(1, Math.round(config.communityPairsPerJoin));
  const pollMs = Math.max(10, config.communityPollSec) * 1000;
  const cap = Math.max(per, Math.round(config.communityMaxPairsPerTick));

  log(
    `community watcher live — X community ${id}, ${per} pair(s) per new member, ` +
      `polling every ${config.communityPollSec}s (cap ${cap}/tick)${config.dryRun ? ' (DRY RUN)' : ''}.`
  );
  log(
    'community: reliable counts need X_BEARER_TOKEN, or feed the number into ' +
      'state/member-count.txt (the public-page scrape is best-effort and X often blocks it).'
  );

  // Baseline on first run so we never fire for members who joined before we started.
  if (typeof state.communityLastCount !== 'number') {
    const first = await getCommunityMemberCount(id);
    if (first) {
      state.communityLastCount = first.count;
      saveState(state);
      log(`community: baseline ${first.count} members (via ${first.source}). Watching for joins…`);
    } else {
      log('community: no member-count source readable yet — will keep trying each tick.');
    }
  }

  for (;;) {
    try {
      const c = getControl();
      if (!c.running) {
        await sleep(2000);
        continue;
      }
      const read = await getCommunityMemberCount(id);
      if (!read) {
        log('community: member count unreadable this tick — retrying next poll.');
        await sleep(pollMs);
        continue;
      }
      if (typeof state.communityLastCount !== 'number') {
        state.communityLastCount = read.count;
        saveState(state);
        log(`community: baseline ${read.count} members (via ${read.source}). Watching for joins…`);
        await sleep(pollMs);
        continue;
      }

      const delta = read.count - state.communityLastCount;
      if (delta > 0) {
        const requested = delta * per;
        const want = Math.min(requested, cap);
        log(
          `community: +${delta} member(s) (now ${read.count}, via ${read.source}) -> ` +
            `spamming ${want} pair(s)${requested > want ? ` (capped from ${requested})` : ''}.`
        );
        const launched = await fireLaunches(treasury, state, want);
        ledger({
          action: 'communityJoinSpam',
          delta,
          memberCount: read.count,
          source: read.source,
          requested,
          launched,
        });
        state.communityLastCount = read.count;
        saveState(state);
      } else if (delta < 0) {
        // Count dropped (someone left, or a noisier source) — rebaseline quietly.
        state.communityLastCount = read.count;
        saveState(state);
      }
    } catch (err) {
      log(`community: transient error, retrying in 5s: ${(err as Error).message}`);
      ledger({ action: 'communityError', error: (err as Error).message });
      await sleep(5000);
    }
    await sleep(pollMs);
  }
}
