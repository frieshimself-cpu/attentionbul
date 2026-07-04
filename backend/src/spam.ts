import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';
import { config, solToLamports, lamportsToSol } from './config.js';
import { sendSerializedTx, sendInstructions } from './rpc.js';
import { log, ledger } from './log.js';
import { BotState, saveState } from './state.js';
import { upsertDevWallet } from './keystore.js';
import { varyName } from './names.js';

const backendDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUMPPORTAL = 'https://pumpportal.fun/api/trade-local';

/** Rent (~0.0107 SOL, measured) for the create tx's mint + curve + metadata accounts. */
export const LAUNCH_OVERHEAD_LAMPORTS = solToLamports(0.011);

/**
 * Buffer funded to each fresh dev wallet on top of rent + dev buy, to cover
 * its own tx fees, priority fees, and the 0.5% PumpPortal fee on any dev buy.
 * Leftover is recoverable via `--sweep`.
 */
export const DEV_WALLET_BUFFER_LAMPORTS = solToLamports(0.002);

/** SOL the treasury funds into the fresh dev wallet for one billboard. */
export function launchCostLamports(): bigint {
  return LAUNCH_OVERHEAD_LAMPORTS + DEV_WALLET_BUFFER_LAMPORTS + solToLamports(Math.max(0, config.spamDevBuySol));
}

async function pumpPortalTx(body: Record<string, unknown>, label: string): Promise<Uint8Array> {
  const res = await fetch(PUMPPORTAL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PumpPortal ${label} failed (${res.status}): ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer()); // raw serialized tx bytes, not JSON
}

async function pinToIpfs(body: Blob, filename: string): Promise<string> {
  if (!config.pinataJwt) {
    throw new Error('PINATA_JWT is required for spam launches (free account at pinata.cloud)');
  }
  const form = new FormData();
  form.append('network', 'public');
  form.append('file', body, filename);
  const res = await fetch('https://uploads.pinata.cloud/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.pinataJwt}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Pinata upload failed (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { data: { cid: string } };
  return json.data.cid;
}

/** Pin the billboard image once and cache its CID; reused across every pair. */
async function getImageCid(state: BotState): Promise<string> {
  if (state.spamImageCid) return state.spamImageCid;
  const imagePath = path.resolve(backendDir, config.spamImagePath);
  const fallback = path.resolve(backendDir, '../assets/logo.svg');
  const chosen = fs.existsSync(imagePath) ? imagePath : fallback;
  if (chosen === fallback) log(`spam: image ${imagePath} not found, using ${fallback}`);
  const mime = chosen.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
  const cid = await pinToIpfs(new Blob([fs.readFileSync(chosen)], { type: mime }), path.basename(chosen));
  state.spamImageCid = cid;
  saveState(state);
  return cid;
}

/**
 * Metadata URI for one launch:
 *   1. SPAM_METADATA_URI env — reuse a fixed already-pinned URI (no Pinata). The
 *      image is shared; the on-chain name still varies per pair.
 *   2. Otherwise pin a fresh, LINK-FREE per-pair JSON via Pinata: just the
 *      varied name/symbol + the shared image. No website, CA, twitter or
 *      telegram — nothing that links the pairs to each other or the project.
 * (pump.fun's own /api/ipfs endpoint is discontinued.)
 */
async function getMetadataUri(state: BotState, name: string, symbol: string): Promise<string> {
  if (config.spamMetadataUri) return config.spamMetadataUri;

  const imageCid = await getImageCid(state);
  const metadata = {
    name,
    symbol,
    image: `https://ipfs.io/ipfs/${imageCid}`,
    showName: true,
  };
  const metaCid = await pinToIpfs(
    new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
    'metadata.json'
  );
  return `https://ipfs.io/ipfs/${metaCid}`;
}

/**
 * Launch one $BULLPOST billboard on pump.fun via PumpPortal's local
 * (self-sign) API, returning the new mint address.
 *
 * Each billboard is created by its OWN fresh dev wallet (not the treasury) so
 * the pairs aren't all traceable to one creator. The treasury funds that dev
 * wallet with exactly the launch cost, the dev wallet creates the pair, and
 * its key is saved to the keystore so leftover SOL / any fees it earns stay
 * recoverable via `--sweep`.
 *
 * The token is created with NO dev buy: PumpPortal's trade-local currently
 * rejects an atomic create+buy (verified — every nonzero `amount` 400s),
 * while create-only succeeds. If SPAM_DEV_BUY_SOL > 0 the dev wallet seeds the
 * curve with a SEPARATE buy after the create confirms; a failed dev buy
 * doesn't fail the launch (the billboard is already live).
 */
/** A launch's outcome. `funded` = SOL already left the treasury into the dev
 *  wallet (recoverable via sweep), so the caller must NOT refund the budget. */
export interface LaunchResult {
  mint: string | null;
  funded: boolean;
}

export async function launchSpamPair(treasury: Keypair, state: BotState): Promise<LaunchResult> {
  const funding = launchCostLamports();
  // A fresh, slightly-different name/ticker each launch (same image, no links).
  const { name, symbol } = varyName(config.spamTokenName);

  if (config.dryRun) {
    log(`spam: would generate a fresh dev wallet, fund it ${lamportsToSol(funding).toFixed(4)} SOL, ` +
      `and launch "${name}" ($${symbol}) #${state.spamLaunchCount + 1}` +
      (config.spamDevBuySol > 0 ? ` + ${config.spamDevBuySol} SOL dev buy` : ' (create-only)'));
    ledger({ action: 'spamLaunch', dryRun: true, name, symbol, funding: funding.toString() });
    return { mint: null, funded: false };
  }

  // Pre-funding: pin metadata. If this throws, no SOL has moved (funded=false).
  const uri = await getMetadataUri(state, name, symbol);

  // Fresh dev wallet. Persist the key BEFORE funding so a crash can't strand SOL.
  const dev = Keypair.generate();
  const devPk = dev.publicKey.toBase58();
  const rec = () => ({ ts: new Date().toISOString(), pubkey: devPk, secret: bs58.encode(dev.secretKey), fundedLamports: funding.toString() });
  upsertDevWallet({ ...rec(), status: 'funded' as const });

  let funded = false;
  try {
    // Fund the dev wallet from the treasury — after this, money has left.
    const fundSig = await sendInstructions(
      [SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: dev.publicKey, lamports: funding })],
      treasury,
      [],
      'fund-dev-wallet'
    );
    funded = true;
    log(`spam: funded fresh dev wallet ${devPk} with ${lamportsToSol(funding).toFixed(4)} SOL (tx ${fundSig})`);

    // The dev wallet creates the billboard (dev wallet + mint co-sign).
    const mintKeypair = Keypair.generate();
    const mint = mintKeypair.publicKey.toBase58();
    const createTx = await pumpPortalTx(
      {
        publicKey: devPk, // this fresh wallet is the pair's creator
        action: 'create',
        tokenMetadata: { name, symbol, uri }, // varied per launch
        mint,
        denominatedInSol: 'true', // string on purpose — the API rejects JSON booleans
        amount: 0,
        slippage: Math.max(1, Math.round(config.slippageBps / 100)),
        priorityFee: 0.0001,
        pool: 'pump',
      },
      'create'
    );
    const sig = await sendSerializedTx(createTx, [mintKeypair, dev], 'spam-launch');

    state.spamLaunchCount += 1;
    saveState(state);
    upsertDevWallet({ ...rec(), mint, status: 'launched' });
    log(`spam: billboard #${state.spamLaunchCount} "${name}" ($${symbol}) live at ${mint} — https://pump.fun/coin/${mint}`);
    ledger({ action: 'spamLaunch', mint, name, symbol, devWallet: devPk, launchNumber: state.spamLaunchCount, sig });

    return await withOptionalDevBuy(dev, devPk, mint, state, funded);
  } catch (err) {
    // Mark the wallet 'failed' if it was funded so `npm run sweep` reclaims it.
    upsertDevWallet({ ...rec(), status: 'failed' as const });
    (err as Error & { funded?: boolean }).funded = funded;
    throw err;
  }
}

/** Optional dev buy after a successful create; failure never fails the launch. */
async function withOptionalDevBuy(
  dev: Keypair,
  devPk: string,
  mint: string,
  state: BotState,
  funded: boolean
): Promise<LaunchResult> {

  // 4. Optional separate dev buy (from the same fresh wallet) to seed the curve.
  if (config.spamDevBuySol > 0) {
    try {
      const buyTx = await pumpPortalTx(
        {
          publicKey: devPk,
          action: 'buy',
          mint,
          denominatedInSol: 'true',
          amount: config.spamDevBuySol,
          slippage: Math.max(1, Math.round(config.slippageBps / 100)),
          priorityFee: 0.0001,
          pool: 'pump',
        },
        'dev-buy'
      );
      const buySig = await sendSerializedTx(buyTx, [dev], 'spam-dev-buy');
      log(`spam: seeded #${state.spamLaunchCount} with ${config.spamDevBuySol} SOL (tx ${buySig})`);
      ledger({ action: 'spamDevBuy', mint, devWallet: devPk, devBuySol: config.spamDevBuySol, sig: buySig });
    } catch (err) {
      log(`spam: dev buy for ${mint} failed (billboard still live): ${(err as Error).message}`);
      ledger({ action: 'spamDevBuyFailed', mint, devWallet: devPk, error: (err as Error).message });
    }
  }

  return { mint, funded };
}
