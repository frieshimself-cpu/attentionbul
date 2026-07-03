import { Keypair } from '@solana/web3.js';
import { config, lamportsToSol } from './config.js';
import { sendSerializedTx } from './rpc.js';
import { log, ledger } from './log.js';
import { getBullpostBalance } from './legends.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const JUP_BASE = 'https://api.jup.ag'; // keyless works (0.5 RPS); add JUPITER_API_KEY for more

function jupHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.jupiterApiKey) h['x-api-key'] = config.jupiterApiKey;
  return h;
}

/**
 * Market-buy $BULLPOST with `lamports` SOL via Jupiter (routes pump.fun
 * bonding curve pre-graduation and PumpSwap/Raydium after). Returns the
 * token base units actually received, measured by balance delta.
 */
export async function buyBullpost(creator: Keypair, lamports: bigint): Promise<bigint> {
  log(`buyback: swapping ${lamportsToSol(lamports).toFixed(4)} SOL -> $BULLPOST via Jupiter`);

  const quoteUrl =
    `${JUP_BASE}/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${config.bullpostMint}` +
    `&amount=${lamports}&slippageBps=${config.slippageBps}&restrictIntermediateTokens=true`;
  const quoteRes = await fetch(quoteUrl, { headers: jupHeaders() });
  if (!quoteRes.ok) throw new Error(`Jupiter quote failed (${quoteRes.status}): ${await quoteRes.text()}`);
  const quote = (await quoteRes.json()) as { outAmount?: string; error?: string };
  if (quote.error || !quote.outAmount) throw new Error(`Jupiter quote error: ${quote.error ?? 'no route'}`);
  log(`buyback: quote ~${quote.outAmount} base units out`);

  if (config.dryRun) {
    ledger({ action: 'buyback', dryRun: true, lamports: lamports.toString(), quotedOut: quote.outAmount });
    return BigInt(quote.outAmount);
  }

  const swapRes = await fetch(`${JUP_BASE}/swap/v1/swap`, {
    method: 'POST',
    headers: jupHeaders(),
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: creator.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: { priorityLevel: 'high', maxLamports: 1_000_000 },
      },
    }),
  });
  if (!swapRes.ok) throw new Error(`Jupiter swap build failed (${swapRes.status}): ${await swapRes.text()}`);
  const { swapTransaction } = (await swapRes.json()) as { swapTransaction: string };

  const before = await getBullpostBalance(creator);
  const sig = await sendSerializedTx(Buffer.from(swapTransaction, 'base64'), [creator], 'buyback');
  const after = await getBullpostBalance(creator);
  const received = after > before ? after - before : 0n;

  log(`buyback: received ${received} base units (tx ${sig})`);
  ledger({ action: 'buyback', lamports: lamports.toString(), received: received.toString(), sig });
  return received;
}
