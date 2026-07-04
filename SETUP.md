# Running the $BULLPOST bot on your own computer

The bot is a small program you run on your machine. It holds your wallet key and
sends transactions, so it has to run somewhere you control — it can't be a
website link. This takes ~10–15 minutes the first time.

> **Launching the coin on pump.fun is separate — do that whenever you want, it
> doesn't need the bot.** The bot just automates the spam/claim afterward.

## 1. Install Node.js

Download the **LTS** version from <https://nodejs.org> and install it (just click
through). This gives you the `npm` command the bot needs.

## 2. Get the code

Easiest way (no git needed):
1. Go to the repo on GitHub, branch **`claude/bullpost-coin-website-fqf257`**.
2. Click the green **Code** button → **Download ZIP**.
3. Unzip it somewhere you'll find it (e.g. your Desktop).

## 3. Open a terminal in the `backend` folder

- **Mac**: open the `backend` folder in Finder → right-click → *New Terminal at Folder*.
- **Windows**: open the `backend` folder → click the address bar, type `cmd`, press Enter.

## 4. Create the settings file

In the `backend` folder, make a file named exactly **`.env`** (yes, starting with
a dot) and paste the settings block. **You'll get the exact block — with your
wallet key already filled in — from the chat.** Never share this file or commit
it anywhere; it contains your private key.

## 5. Install and run

In that terminal, run these one at a time:

```bash
npm install
npm run panel
```

When it says `admin panel: http://localhost:8080`, open that address in your
browser:

```
http://localhost:8080/admin
```

You'll see the control panel — START/STOP, speed and amount sliders, live stats.

## 6. Safe first / going live

- It starts in **DRY RUN** (a green banner) — it simulates, spends nothing. Press
  START and watch it work with zero risk.
- To go live for real: stop it, change `DRY_RUN=true` to `DRY_RUN=false` in `.env`,
  and make sure a metadata source is set (ask in chat — it's one line). Then
  `npm run panel` again.

## Notes

- The panel is **localhost only** — only your computer can open it. Nobody else
  can reach it.
- It only runs while your computer is on and the terminal is open. For 24/7, run
  it on a cheap always-on server (VPS) instead — ask in chat for that path.
- `npm run sweep` reclaims leftover SOL from used dev wallets back to your wallet.
