import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, lamportsToSol, validateLiveConfig, SPAM_PRESETS, resolvePreset } from './config.js';
import { loadKeypair } from './wallet.js';
import { loadState, getBucket, rewardRatePerHour } from './state.js';
import { connection } from './rpc.js';
import { getClaimable } from './claim.js';
import { launchCostLamports } from './spam.js';
import { runSpamEngine, throttleIntervalSec } from './engine.js';
import { getControl, updateControl } from './control.js';
import { loadDevWallets } from './keystore.js';
import { log } from './log.js';

const PORT = Number(process.env.PANEL_PORT ?? 8080);
// Bind to localhost unless PANEL_HOST is set. If exposed publicly (0.0.0.0),
// PANEL_TOKEN MUST be set — every route requires ?key=<token> and the panel
// lives at /admin?key=<token>. No token + public host would be wide open.
const HOST = process.env.PANEL_HOST ?? '127.0.0.1';
const TOKEN = process.env.PANEL_TOKEN ?? '';
const ADMIN_HTML = path.join(path.dirname(fileURLToPath(import.meta.url)), 'admin.html');

if (HOST !== '127.0.0.1' && !TOKEN) {
  throw new Error('PANEL_HOST is public but PANEL_TOKEN is empty — refusing to start an unprotected panel.');
}

function authed(url: URL, req: http.IncomingMessage): boolean {
  if (!TOKEN) return true; // localhost dev, no token
  return url.searchParams.get('key') === TOKEN || req.headers['x-panel-key'] === TOKEN;
}

validateLiveConfig();
const creator = loadKeypair(config.creatorWalletSecret);
const state = loadState();

/** Gather everything the panel shows. RPC calls are best-effort. */
async function status() {
  let balance = 0n;
  let claimable = 0n;
  try {
    [balance, claimable] = await Promise.all([
      connection.getBalance(creator.publicKey, 'confirmed').then((b) => BigInt(b)),
      getClaimable(creator),
    ]);
  } catch { /* RPC hiccup — show last-known 0s rather than crash the panel */ }

  const budget = getBucket(state, 'spam');
  const adFund = getBucket(state, 'adFund');
  const cost = launchCostLamports();
  const runway = Number(budget / cost);
  const c = getControl();
  const ratePerHour = rewardRatePerHour(state);
  const pairsPerHour = ratePerHour > 0n ? Number((ratePerHour * BigInt(Math.round(config.spamRewardFraction * 100))) / 100n / cost) : 0;
  const wallets = loadDevWallets();

  return {
    dryRun: config.dryRun,
    treasury: creator.publicKey.toBase58(),
    mint: config.coinMint || null,
    balanceSol: lamportsToSol(balance),
    reserveSol: lamportsToSol(config.reserveLamports),
    spendableSol: lamportsToSol(balance > config.reserveLamports ? balance - config.reserveLamports : 0n),
    claimableSol: lamportsToSol(claimable),
    budgetSol: lamportsToSol(budget),
    adFundSol: lamportsToSol(adFund),
    costPerPairSol: lamportsToSol(cost),
    runway,
    currentIntervalSec: throttleIntervalSec(runway, c),
    rewardSolPerHr: lamportsToSol(ratePerHour),
    sustainablePairsPerHr: pairsPerHour,
    launchedLifetime: state.spamLaunchCount,
    devWalletsUnswept: wallets.filter((w) => w.status !== 'swept').length,
    rewardFractionPct: Math.round(config.spamRewardFraction * 100),
    control: c,
    recent: recentLaunches(),
  };
}

function recentLaunches(): { mint: string; name: string; symbol: string; ts: string }[] {
  try {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'state');
    const lines = fs.readFileSync(path.join(dir, 'ledger.jsonl'), 'utf8').trim().split('\n');
    const out: { mint: string; name: string; symbol: string; ts: string }[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < 15; i--) {
      try {
        const e = JSON.parse(lines[i]);
        if (e.action === 'spamLaunch' && e.mint && !e.dryRun) {
          out.push({ mint: e.mint, name: e.name ?? '', symbol: e.symbol ?? '', ts: e.ts });
        }
      } catch { /* skip */ }
    }
    return out;
  } catch {
    return [];
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => resolve(d));
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    // Everything requires the key when a token is configured.
    if (!authed(url, req)) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      return res.end('unauthorized — append ?key=YOUR_KEY to the URL');
    }

    if (req.method === 'GET' && (url.pathname === '/admin' || url.pathname === '/')) {
      const html = fs.readFileSync(ADMIN_HTML, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      const s = await status();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(s));
    }

    if (req.method === 'POST' && url.pathname === '/api/control') {
      const body = JSON.parse((await readBody(req)) || '{}');
      // A preset button maps to burst + interval + runway in one shot.
      if (typeof body.preset === 'string') {
        const p = SPAM_PRESETS[resolvePreset(body.preset)];
        Object.assign(body, { burst: p.burst, intervalSec: p.minInterval, maxIntervalSec: p.maxInterval, fullSpeedRunway: p.fullSpeedRunway });
        delete body.preset;
      }
      const updated = updateControl(body);
      log(`panel: control updated -> running=${updated.running} burst=${updated.burst} interval=${updated.intervalSec}s`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(updated));
    }

    res.writeHead(404).end('not found');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
});

server.listen(PORT, HOST, () => {
  log(`admin panel: http://localhost:${PORT}   (${config.dryRun ? 'DRY RUN — safe' : 'LIVE — real funds'})`);
  log('engine is loaded and PAUSED — press START in the panel to begin.');
  // Run the engine loop in-process; it launches only while control.running is true.
  runSpamEngine(creator, state, undefined, false).catch((e) => log(`engine crashed: ${e.message}`));
});
