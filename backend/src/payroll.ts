import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { config, lamportsToSol } from './config.js';
import { sendInstructions } from './rpc.js';
import { log, ledger } from './log.js';

/** Send the bagworker bucket (SOL) to the payroll wallet. */
export async function payBagworkers(creator: Keypair, lamports: bigint): Promise<string | null> {
  const dest = new PublicKey(config.bagworkerWallet);
  log(`payroll: sending ${lamportsToSol(lamports).toFixed(4)} SOL to bagworker wallet ${dest.toBase58()}`);

  if (config.dryRun) {
    ledger({ action: 'payroll', dryRun: true, lamports: lamports.toString(), dest: dest.toBase58() });
    return null;
  }

  const sig = await sendInstructions(
    [SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: dest, lamports })],
    creator,
    [],
    'payroll'
  );
  ledger({ action: 'payroll', lamports: lamports.toString(), dest: dest.toBase58(), sig });
  return sig;
}
