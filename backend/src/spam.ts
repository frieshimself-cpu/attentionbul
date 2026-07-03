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

/**
 * Metadata is identical for every billboard launch. Resolution order:
 *   1. SPAM_METADATA_URI env — reuse an already-pinned URI (no Pinata needed).
 *   2. a URI we pinned on a previous run (cached in state).
 *   3. pin the image + JSON fresh via Pinata (needs PINATA_JWT).
 * (pump.fun's own /api/ipfs endpoint is discontinued.)
 */
async function getMetadataUri(state: BotState): Promise<string> {
  if (config.spamMetadataUri) return config.spamMetadataUri;
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
export async function launchSpamPair(treasury: Keypair, state: BotState): Promise<string | null> {
  const funding = launchCostLamports();

  if (config.dryRun) {
    log(`spam: would generate a fresh dev wallet, fund it ${lamportsToSol(funding).toFixed(4)} SOL, ` +
      `and launch billboard #${state.spamLaunchCount + 1}` +
      (config.spamDevBuySol > 0 ? ` + ${config.spamDevBuySol} SOL dev buy` : ' (create-only)'));
    ledger({ action: 'spamLaunch', dryRun: true, funding: funding.toString(), devBuySol: config.spamDevBuySol });
    return null;
  }

  const uri = await getMetadataUri(state);

  // 1. Fresh dev wallet for this billboard. Persist the key BEFORE funding so
  //    a crash mid-launch can never lose access to the SOL we're about to send.
  const dev = Keypair.generate();
  const devPk = dev.publicKey.toBase58();
  upsertDevWallet({
    ts: new Date().toISOString(),
    pubkey: devPk,
    secret: bs58.encode(dev.secretKey),
    fundedLamports: funding.toString(),
    status: 'funded',
  });

  // 2. Fund the dev wallet from the treasury.
  const fundSig = await sendInstructions(
    [SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: dev.publicKey, lamports: funding })],
    treasury,
    [],
    'fund-dev-wallet'
  );
  log(`spam: funded fresh dev wallet ${devPk} with ${lamportsToSol(funding).toFixed(4)} SOL (tx ${fundSig})`);

  // 3. The dev wallet creates the billboard (dev wallet + mint co-sign).
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey.toBase58();
  const createTx = await pumpPortalTx(
    {
      publicKey: devPk, // this fresh wallet is the pair's creator
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
  const sig = await sendSerializedTx(createTx, [mintKeypair, dev], 'spam-launch');

  state.spamLaunchCount += 1;
  saveState(state);
  upsertDevWallet({ ts: new Date().toISOString(), pubkey: devPk, secret: bs58.encode(dev.secretKey), fundedLamports: funding.toString(), mint, status: 'launched' });
  log(`spam: billboard #${state.spamLaunchCount} live at ${mint} — https://pump.fun/coin/${mint}`);
  ledger({ action: 'spamLaunch', mint, devWallet: devPk, launchNumber: state.spamLaunchCount, sig });

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

  return mint;
}
