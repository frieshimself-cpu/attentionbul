import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Local keystore for the throwaway dev wallets used to launch spam pairs.
 * Each billboard is created by a DIFFERENT fresh wallet so the pairs aren't
 * all traceable to one creator. Their secrets are persisted here so leftover
 * SOL and any fees they earn stay recoverable (see `--sweep`).
 *
 * SECURITY: this file contains private keys. It lives under state/ which is
 * gitignored — never commit it, and back it up if the launches matter.
 */
export interface DevWalletRecord {
  ts: string;
  pubkey: string;
  secret: string; // base58
  fundedLamports: string;
  mint?: string;
  status: 'funded' | 'launched' | 'failed' | 'swept';
}

const stateDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'state');
const keystorePath = path.join(stateDir, 'dev-wallets.json');

export function loadDevWallets(): DevWalletRecord[] {
  try {
    return JSON.parse(fs.readFileSync(keystorePath, 'utf8')) as DevWalletRecord[];
  } catch {
    return [];
  }
}

function save(records: DevWalletRecord[]): void {
  fs.mkdirSync(stateDir, { recursive: true });
  const tmp = keystorePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, keystorePath);
}

/** Insert or update a wallet record, keyed by pubkey. */
export function upsertDevWallet(rec: DevWalletRecord): void {
  const records = loadDevWallets();
  const i = records.findIndex((r) => r.pubkey === rec.pubkey);
  if (i >= 0) records[i] = { ...records[i], ...rec };
  else records.push(rec);
  save(records);
}

export function keypairFromRecord(rec: DevWalletRecord): Keypair {
  return Keypair.fromSecretKey(bs58.decode(rec.secret));
}
