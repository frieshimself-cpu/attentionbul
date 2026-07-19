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
const membersPath = path.join(stateDir, 'ant-members.json');

/** Pull the numeric community id out of a full URL or a bare id string. */
export function extractCommunityId(urlOrId: string): string {
  const s = (urlOrId || '').trim();
  const m = s.match(/communities\/(\d+)/);
  if (m) return m[1];
  if (/^\d+$/.test(s)) return s;
  return '';
}

/** Usernames we've already seen (persisted so restarts don't re-fire old members). */
function loadKnown(): Set<string> {
  try {
    return new Set(JSON.parse(fs.readFileSync(membersPath, 'utf8')));
  } catch {
    return new Set();
  }
}
function saveKnown(s: Set<string>): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(membersPath, JSON.stringify([...s]));
}

/**
 * Fetch the FULL member list of a community via twitterapi.io, paging through
 * the cursor. Returns the list of usernames (skips unavailable/suspended rows
 * that carry no userName). Throws on API error so the caller can retry.
 */
export async function fetchAllMembers(communityId: string): Promise<string[]> {
  const headers = { 'x-api-key': config.twitterApiKey };
  const out: string[] = [];
  let cursor = '';
  let pages = 0;
  for (;;) {
    const url =
      `https://api.twitterapi.io/twitter/community/members?community_id=${communityId}` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`twitterapi members ${res.status}: ${(await res.text().catch(() => '')).slice(0, 140)}`);
    }
    const j = (await res.json()) as {
      members?: { screen_name?: string; userName?: string; username?: string }[];
      has_next_page?: boolean;
      next_cursor?: string;
    };
    for (const m of j.members ?? []) {
      const handle = m?.screen_name ?? m?.userName ?? m?.username;
      if (handle) out.push(handle);
    }
    pages++;
    if (!j.has_next_page || !j.next_cursor || pages >= 500) break;
    cursor = j.next_cursor;
    await sleep(250); // be gentle on the API
  }
  return out;
}

/** SOL the treasury can spend right now, keeping the fee/rent reserve intact. */
async function spendableLamports(treasury: Keypair): Promise<bigint> {
  const b = BigInt(await connection.getBalance(treasury.publicKey, 'confirmed'));
  return b > config.reserveLamports ? b - config.reserveLamports : 0n;
}

/**
 * Launch ONE pair for a new member: name = their handle, symbol = ANT, from a
 * FRESH dev wallet (launchSpamPair always generates one — the treasury only ever
 * funds it, never creates the pair). Returns true if it launched.
 */
async function launchForHandle(treasury: Keypair, state: BotState, handle: string): Promise<boolean> {
  const cost = launchCostLamports();

  // Fund from claimed fees first, then top up from principal if enabled.
  try {
    const claimed = await claimRewards(treasury);
    if (claimed > 0n) {
      creditBuckets(state, { spam: claimed });
      state.totalClaimedLamports = (BigInt(state.totalClaimedLamports) + claimed).toString();
      recordClaim(state, claimed, Date.now());
      if (!config.dryRun) saveState(state);
    }
  } catch {
    /* claim is best-effort; fund from existing budget */
  }
  if (config.spamSpendPrincipal && !config.dryRun) {
    const sp = await spendableLamports(treasury);
    const bud = getBucket(state, 'spam');
    if (sp > bud) {
      creditBuckets(state, { spam: sp - bud });
      saveState(state);
    }
  }

  const runway = Number(getBucket(state, 'spam') / cost);
  const affordable = Number((await spendableLamports(treasury)) / cost);
  if (Math.min(runway, affordable) < 1) {
    log(`ant: can't fund a pair for @${handle} (need ~${lamportsToSol(cost).toFixed(4)} SOL) — skipped`);
    return false;
  }

  if (!config.dryRun) {
    debitBucket(state, 'spam', cost);
    saveState(state);
  }
  try {
    // Real behaviour: name = the joiner's handle. If ANT_TOKEN_NAME is set
    // (testing), every launch uses that fixed name instead.
    const launchName = config.antTokenName || handle;
    const res = await launchSpamPair(treasury, state, { name: launchName, symbol: config.antTokenSymbol });
    log(
      `ant: new member @${handle} -> launched 1 ${config.antTokenSymbol} pair` +
        (res.mint ? ` at ${res.mint} — https://pump.fun/coin/${res.mint}` : ' (dry run)')
    );
    ledger({ action: 'antJoinLaunch', handle, symbol: config.antTokenSymbol, mint: res.mint });
    return true;
  } catch (err) {
    const funded = (err as { funded?: boolean })?.funded;
    if (!config.dryRun && !funded) {
      creditBuckets(state, { spam: cost });
      saveState(state);
    }
    log(`ant: launch for @${handle} failed${funded ? ' after funding (recover via sweep)' : ''}: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Watch an X community's MEMBER LIST (via twitterapi.io) and launch 1 pair for
 * every NEW member — named after their @handle, ticker ANT, from a fresh dev
 * wallet each time. On first run it records the current members as a baseline
 * (no launches); after that, any handle not seen before triggers a launch.
 * Honors the global control.running pause switch.
 */
export async function runAntWatcher(treasury: Keypair, state: BotState): Promise<void> {
  const id = extractCommunityId(config.communityUrl);
  if (!id) {
    log('ant: no community set — put the community URL in X_COMMUNITY_URL (or OFFICIAL_TWITTER) in .env, then restart.');
    return;
  }
  if (!config.twitterApiKey) {
    log('ant: no TWITTERAPI_KEY set in .env — needed to read the member list.');
    return;
  }
  const pollMs = Math.max(10, config.communityPollSec) * 1000;
  log(
    `ant watcher live — community ${id}: 1 ${config.antTokenSymbol} pair per NEW member ` +
      `(name = their @handle), polling every ${config.communityPollSec}s${config.dryRun ? ' (DRY RUN)' : ''}.`
  );

  // Baseline: record everyone currently in the community so we only fire for joins from now on.
  let known = loadKnown();
  if (known.size === 0) {
    try {
      known = new Set(await fetchAllMembers(id));
      saveKnown(known);
      log(`ant: baseline ${known.size} current members recorded. Watching for new joins…`);
    } catch (e) {
      log(`ant: baseline fetch failed (${(e as Error).message}) — will retry.`);
    }
  }

  for (;;) {
    try {
      const c = getControl();
      if (!c.running) {
        await sleep(2000);
        continue;
      }
      const current = await fetchAllMembers(id);
      // Safety: if the startup baseline never got set (e.g. its fetch failed),
      // establish it now from this fetch and fire NOTHING — existing members must
      // never trigger a launch. Only members who appear AFTER a baseline exists do.
      if (known.size === 0) {
        known = new Set(current);
        saveKnown(known);
        log(`ant: baseline ${known.size} current members recorded (deferred). Watching for new joins…`);
        await sleep(pollMs);
        continue;
      }
      const fresh = current.filter((u) => !known.has(u));
      if (fresh.length) {
        log(`ant: ${fresh.length} new member(s): ${fresh.slice(0, 15).map((h) => '@' + h).join(', ')}${fresh.length > 15 ? '…' : ''}`);
        for (const handle of fresh) {
          const ok = await launchForHandle(treasury, state, handle);
          // Mark as known once launched (or in dry run) so we don't re-fire it.
          if (ok || config.dryRun) {
            known.add(handle);
            saveKnown(known);
          }
        }
      }
    } catch (err) {
      log(`ant: transient error, retrying in 5s: ${(err as Error).message}`);
      ledger({ action: 'antError', error: (err as Error).message });
      await sleep(5000);
    }
    await sleep(pollMs);
  }
}
