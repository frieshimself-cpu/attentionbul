import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Load a keypair from either a base58-encoded secret (Phantom "export
 * private key" format) or a JSON byte array (solana-keygen format).
 */
export function loadKeypair(secret: string): Keypair {
  const trimmed = secret.trim();
  if (!trimmed) throw new Error('Empty wallet secret');
  if (trimmed.startsWith('[')) {
    const bytes = Uint8Array.from(JSON.parse(trimmed) as number[]);
    return Keypair.fromSecretKey(bytes);
  }
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}
