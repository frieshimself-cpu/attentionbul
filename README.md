# $SPAM — Official Website

The spammiest coin on Solana. 🥫🚀

A fully static one-page site — no build step, no dependencies. Open `index.html` in a browser or host it anywhere (GitHub Pages, Vercel, Netlify, Cloudflare Pages). It is *deliberately* loud, blinking and hard to navigate — that's the theme.

## Structure

```
index.html      — the whole site (single page)
css/style.css   — all styling (marquees, blink/shake/wobble animations, sticker swarm)
js/main.js      — copy-CA button, respawning popup, sticker swarm, emoji confetti
assets/logo.jpg — the official $SPAM coin logo (used on-site and in pair metadata)
assets/logo.svg — vector fallback
```

## Things to fill in before launch

- **Contract address** — replace `TBA — DROPPING SOON!!!` inside the `#caText` element in `index.html`.
- **Links** — the Buy / Chart / Telegram / X buttons currently point to `#`. Search `href="#"` in `index.html` and paste the real URLs.

The creator-rewards allocation shown on the site: **100% pair spam** — every SOL of creator rewards recycles into spam-launching new $SPAM pairs, non-stop.

## Deploying on GitHub Pages

Repo → Settings → Pages → deploy from branch → select the branch and `/ (root)`.
