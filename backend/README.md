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
npm run cycle    # one full cycle
npm run loop     # cycle every CYCLE_MINUTES, forever
npm run status   # show bucket balances + lifetime stats
npm test         # allocation math self-checks
```

**`DRY_RUN=true` is the default.** The bot logs exactly what it would claim,
split, launch and send — but signs nothing. Flip to `false` only after a dry
cycle looks right, then let it run.

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

## Module map

```
src/index.ts    orchestrator — the cycle described above
src/claim.ts    creator-fee claim via @pump-fun/pump-sdk (+ WSOL unwrap)
src/split.ts    integer 50/50 allocation math (tested)
src/spam.ts     billboard launches via PumpPortal local API + Pinata IPFS
src/payroll.ts  SOL transfer to the bagworker wallet
src/rpc.ts      simulate / priority-fee / rebroadcast transaction landing
src/state.ts    persistent buckets + ledger
```

## Notes

- Creator fees accrue **wallet-wide** on pump.fun — the spam pairs' own creator
  rewards flow back into the same vault the bot claims, feeding the flywheel.
- The billboard pairs' metadata carries the official website + CA in the
  description, pinned once to IPFS and reused.
- pump.fun fee schedule changes several times a year; percentages here are
  whatever the program pays out — the bot just claims and splits what arrives.
