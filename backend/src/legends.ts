import { Keypair, PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getMint,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { config, LEGEND_WALLETS } from './config.js';
import { splitEqually } from './split.js';
import { sendInstructions, connection } from './rpc.js';
import { log, ledger } from './log.js';

/**
 * Classic pump.fun coins are SPL Token; coins minted via create_v2 are
 * Token-2022. Detect from the mint account's owner so ATA derivation and
 * transfers target the right program.
 */
async function mintProgramAndDecimals(mint: PublicKey): Promise<{ program: PublicKey; decimals: number }> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`Mint ${mint.toBase58()} not found on-chain`);
  const program = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const mintInfo = await getMint(connection, mint, 'confirmed', program);
  return { program, decimals: mintInfo.decimals };
}

/**
 * Send `tokenAmount` (base units) of $BULLPOST from the creator wallet,
 * split equally, to the four legend wallets in one transaction. Creates
 * their token accounts if missing (creator pays ~0.002 SOL rent each, once).
 */
export async function feedTheLegends(creator: Keypair, tokenAmount: bigint): Promise<string | null> {
  if (tokenAmount <= 0n) {
    log('legends: nothing to distribute');
    return null;
  }
  const mint = new PublicKey(config.bullpostMint);
  const shares = splitEqually(tokenAmount, LEGEND_WALLETS.length);

  if (config.dryRun) {
    for (const [i, legend] of LEGEND_WALLETS.entries()) {
      log(`legends: would send ${shares[i]} base units to ${legend.name} (${legend.address})`);
    }
    ledger({ action: 'feedTheLegends', dryRun: true, tokenAmount: tokenAmount.toString(), shares: shares.map(String) });
    return null;
  }

  const { program, decimals } = await mintProgramAndDecimals(mint);
  const sourceAta = getAssociatedTokenAddressSync(mint, creator.publicKey, false, program);

  const instructions = LEGEND_WALLETS.flatMap((legend, i) => {
    const owner = new PublicKey(legend.address);
    const ata = getAssociatedTokenAddressSync(mint, owner, true, program);
    log(`legends: ${legend.name} gets ${shares[i]} base units -> ${legend.address}`);
    return [
      createAssociatedTokenAccountIdempotentInstruction(creator.publicKey, ata, owner, mint, program),
      createTransferCheckedInstruction(sourceAta, mint, ata, creator.publicKey, shares[i], decimals, [], program),
    ];
  });

  const sig = await sendInstructions(instructions, creator, [], 'feed-the-legends');
  ledger({ action: 'feedTheLegends', tokenAmount: tokenAmount.toString(), shares: shares.map(String), sig });
  return sig;
}

/** Current $BULLPOST balance (base units) held by the creator wallet. */
export async function getBullpostBalance(creator: Keypair): Promise<bigint> {
  const mint = new PublicKey(config.bullpostMint);
  const info = await connection.getAccountInfo(mint);
  if (!info) return 0n;
  const program = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const ata = getAssociatedTokenAddressSync(mint, creator.publicKey, false, program);
  try {
    const bal = await connection.getTokenAccountBalance(ata);
    return BigInt(bal.value.amount);
  } catch {
    return 0n; // ATA doesn't exist yet
  }
}
