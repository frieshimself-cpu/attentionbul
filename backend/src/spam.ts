import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair } from '@solana/web3.js';
import { config, solToLamports, lamportsToSol } from './config.js';
import { sendSerializedTx } from './rpc.js';
import { log, ledger } from './log.js';
import { BotState, saveState } from './state.js';

const backendDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUMPPORTAL = 'https://pumpportal.fun/api/trade-local';

/** Rent + network/priority fees for the create tx itself (mint + curve + metadata). */
export const LAUNCH_OVERHEAD_LAMPORTS = solToLamports(0.025);

/** Total a single billboard costs: create overhead plus the optional dev buy. */
export function launchCostLamports(): bigint {
  return LAUNCH_OVERHEAD_LAMPORTS + solToLamports(Math.max(0, config.spamDevBuySol));
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

/**
 * Metadata is identical for every billboard launch, so we pin the image and
 * JSON once and cache the URI in state. (pump.fun's own /api/ipfs endpoint
 * is discontinued — metadata must be pinned via your own IPFS provider.)
 */
async function getMetadataUri(state: BotState): Promise<string> {
  if (state.spamMetadataUri) return state.spamMetadataUri;

  const imagePath = path.resolve(backendDir, config.spamImagePath);
  const fallback = path.resolve(backendDir, '../assets/logo.svg');
  const chosen = fs.existsSync(imagePath) ? imagePath : fallback;
  if (chosen === fallback) log(`spam: image ${imagePath} not found, using ${fallback}`);
  const mime = chosen.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
  const imageCid = await pinToIpfs(new Blob([fs.readFileSync(chosen)], { type: mime }), path.basename(chosen));

  const metadata = {
    name: config.spamTokenName,
    symbol: config.spamTokenSymbol,
    image: `https://ipfs.io/ipfs/${imageCid}`,
    description:
      `This is a $BULLPOST billboard. The bull never shuts up. ` +
      `Official website: ${config.officialWebsite}` +
      (config.bullpostMint ? ` | Official CA: ${config.bullpostMint}` : ''),
    ...(config.officialTwitter ? { twitter: config.officialTwitter } : {}),
    ...(config.officialTelegram ? { telegram: config.officialTelegram } : {}),
    website: config.officialWebsite,
  };
  const metaCid = await pinToIpfs(
    new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
    'metadata.json'
  );
  state.spamMetadataUri = `https://ipfs.io/ipfs/${metaCid}`;
  saveState(state);
  log(`spam: pinned metadata ${state.spamMetadataUri}`);
  return state.spamMetadataUri;
}

/**
 * Launch one $BULLPOST billboard on pump.fun via PumpPortal's local
 * (self-sign) API, returning the new mint address.
 *
 * The token is created with NO dev buy: PumpPortal's trade-local currently
 * rejects an atomic create+buy (verified — every nonzero `amount` 400s),
 * while create-only succeeds. If SPAM_DEV_BUY_SOL > 0 we seed the curve with
 * a SEPARATE buy after the create confirms; a failed dev buy doesn't fail the
 * launch (the billboard is already live). Creation is free; the 0.5%
 * PumpPortal fee applies only to the dev buy.
 */
export async function launchSpamPair(creator: Keypair, state: BotState): Promise<string | null> {
  if (config.dryRun) {
    log(`spam: would launch billboard #${state.spamLaunchCount + 1}` +
      (config.spamDevBuySol > 0 ? ` + ${config.spamDevBuySol} SOL dev buy` : ' (create-only)'));
    ledger({ action: 'spamLaunch', dryRun: true, devBuySol: config.spamDevBuySol });
    return null;
  }

  const uri = await getMetadataUri(state);
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey.toBase58();

  // 1. Create the billboard (mint co-signs). Verified-working shape: amount 0.
  const createTx = await pumpPortalTx(
    {
      publicKey: creator.publicKey.toBase58(),
      action: 'create',
      tokenMetadata: { name: config.spamTokenName, symbol: config.spamTokenSymbol, uri },
      mint,
      denominatedInSol: 'true', // string on purpose — the API rejects JSON booleans
      amount: 0,
      slippage: Math.max(1, Math.round(config.slippageBps / 100)),
      priorityFee: 0.0001,
      pool: 'pump',
    },
    'create'
  );
  const sig = await sendSerializedTx(createTx, [mintKeypair, creator], 'spam-launch');

  state.spamLaunchCount += 1;
  saveState(state);
  log(`spam: billboard #${state.spamLaunchCount} live at ${mint} — https://pump.fun/coin/${mint}`);
  ledger({ action: 'spamLaunch', mint, launchNumber: state.spamLaunchCount, sig });

  // 2. Optional separate dev buy to seed the curve.
  if (config.spamDevBuySol > 0) {
    try {
      const buyTx = await pumpPortalTx(
        {
          publicKey: creator.publicKey.toBase58(),
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
      const buySig = await sendSerializedTx(buyTx, [creator], 'spam-dev-buy');
      log(`spam: seeded #${state.spamLaunchCount} with ${config.spamDevBuySol} SOL (tx ${buySig})`);
      ledger({ action: 'spamDevBuy', mint, devBuySol: config.spamDevBuySol, sig: buySig });
    } catch (err) {
      log(`spam: dev buy for ${mint} failed (billboard still live): ${(err as Error).message}`);
      ledger({ action: 'spamDevBuyFailed', mint, error: (err as Error).message });
    }
  }

  return mint;
}
