import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const stateDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'state');
const ledgerPath = path.join(stateDir, 'ledger.jsonl');

export function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

/** Append-only ledger of every action the bot takes (or would take in dry-run). */
export function ledger(entry: Record<string, unknown>): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.appendFileSync(ledgerPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}
