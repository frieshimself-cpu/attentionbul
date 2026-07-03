# $BULLPOST rewards bot

Self-hosted bot that turns pump.fun creator rewards into marketing, on a loop:

```
claim creator rewards (bonding curve + PumpSwap vaults)
        │
        ▼
 split 50 / 50 into persistent buckets
        │
        ├─ 50%  Pair Spam Engine  → launches new $BULLPOST billboard pairs on pump.fun
        └─ 50%  Bagworker Army     → SOL forwarded to the bagworker wallet, which pays
                                     the hired army bullposting $BULLPOST everywhere
```

Keys never leave the box: claims are built with the official `@pump-fun/pump-sdk`
and spam launches with PumpPortal's *local* (self-sign) API. Every action is
appended to `state/ledger.jsonl`.

**Each spam pair is launched by its own fresh dev wallet**, not the treasury, so
the pairs aren't all traceable to one creator. The treasury funds a throwaway
wallet with exactly the launch cost, that wallet creates the pair, and its key
is saved to `state/dev-wallets.json` so leftover SOL (and any fees the pair
earns) can be reclaimed with `npm run sweep`.

## Setup

```bash
cd backend
npm install
cp .env.example .env   # then fill it in
```

You need:

| Thing | Where |
| --- | --- |
| `CREATOR_WALLET_SECRET` | The wallet that launched $BULLPOST (it accrues the creator rewards). Phantom base58 export or solana-keygen JSON array. |
| `BAGWORKER_WALLET` | Wallet that receives the 50% bagworker bucket. |
| `RPC_URL` | Free Helius endpoint recommended (public RPC drops transactions under load). |
| `PINATA_JWT` | Free at pinata.cloud — spam launches must pin token metadata to IPFS since pump.fun closed their upload endpoint. |
| `BULLPOST_MINT` | Optional. The official CA, once launched — only used to stamp the CA into spam metadata. |

## Running

```bash
npm run cycle      # one full cycle
npm run loop       # cycle every CYCLE_MINUTES, forever
npm run status     # bucket balances + lifetime stats
npm test           # allocation math self-checks
```

**`DRY_RUN=true` is the default.** The bot logs exactly what it would claim,
split, launch and send — but signs nothing. Flip to `false` only after a dry
cycle looks right, then let it run.

## Test each piece before you trust it

Dedicated one-shot commands so you can prove a path in isolation, cheaply:

```bash
npm run claimable    # read-only: how much creator fee is claimable right now
npm run claim        # claim creator fees only (no split/spam)
npm run launch-one   # launch exactly ONE billboard from a fresh dev wallet
npm run sweep        # reclaim leftover SOL + fees from used dev wallets
```

Each honors `DRY_RUN`. Recommended sequence for a real, cheap end-to-end test
(costs ~0.013 SOL for the launch, most of it recoverable):

1. Fund the treasury wallet with ~0.05 SOL and set `DRY_RUN=false`.
2. `npm run claimable` → confirms the claim path reads the vaults (0 SOL yet).
3. `npm run launch-one` → creates one pair from a fresh dev wallet. Open the
   printed `pump.fun/coin/<mint>` link — **that proves the spam path works.**
4. To also prove claiming pays out, set `SPAM_DEV_BUY_SOL=0.002` and
   `npm run launch-one` again: the dev buy is a real trade, so it seeds a tiny
   creator fee. Then `npm run sweep` claims that fee and returns the leftover
   SOL to the treasury — **that proves the claim path pays out.**
5. Once both look right, run `npm run cycle` (or `loop`) for real.

> Fees only accrue from **trading volume**. A brand-new pair with no trades has
> nothing to claim — that's why step 4 does a small dev buy to generate some.

Deploy anywhere Node 20+ runs (a $5 VPS is plenty). For unattended running:

```bash
# systemd, pm2, or plain nohup:
pm2 start "npm run loop" --name bullpost-bot --cwd backend
```

## Safety rails

- **Buckets are persistent** (`state/state.json`): rewards claimed while a step
  is failing stay budgeted for that step and retry next cycle.
- Buckets are debited *before* sending — a crash mid-send can only under-spend,
  never double-spend.
- `RESERVE_SOL` is never touched, so the wallet always keeps gas.
- Per-cycle launch cap (`SPAM_MAX_LAUNCHES_PER_CYCLE`) stops a fat bucket from
  machine-gunning launches in one go.
- All transactions are simulated before sending, use percentile-based priority
  fees, and are rebroadcast until confirmed or expired.
- Each dev wallet's key is saved **before** it's funded, so a crash mid-launch
  can never strand SOL you can't reach. `npm run sweep` reclaims it all.

> **Keep `state/` private.** `state/dev-wallets.json` holds the dev wallets'
> private keys (written `0600`, and `state/` is gitignored). Back it up if the
> launches matter; never commit or share it.

## Module map

```
src/index.ts     orchestrator + one-shot test commands
src/claim.ts     creator-fee claim via @pump-fun/pump-sdk (+ WSOL unwrap)
src/split.ts     integer 50/50 allocation math (tested)
src/spam.ts      billboard launches from fresh per-pair dev wallets
src/keystore.ts  persists the dev wallets (state/dev-wallets.json)
src/sweep.ts     reclaims leftover SOL + fees from used dev wallets
src/payroll.ts   SOL transfer to the bagworker wallet
src/rpc.ts       simulate / priority-fee / rebroadcast transaction landing
src/state.ts     persistent buckets + ledger
```

## Notes

- The official $BULLPOST coin's creator fees (claimed wallet-wide by the
  treasury) are what drive the flywheel. Spam pairs are launched by separate
  fresh wallets, so their own (usually negligible) fees don't auto-claim — run
  `npm run sweep` to pull them back in along with leftover launch SOL.
- The billboard pairs' metadata carries the official website + CA in the
  description, pinned once to IPFS and reused.
- pump.fun fee schedule changes several times a year; percentages here are
  whatever the program pays out — the bot just claims and splits what arrives.
