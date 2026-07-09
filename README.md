# $COPYCAT — Official Website

The coin that is one giant advertisement. 📢🖱️

A fully static one-page site — no build step, no dependencies. Open `index.html` in a browser or host it anywhere (GitHub Pages, Vercel, Netlify, Cloudflare Pages). It is *deliberately* loud, blinking and hard to navigate — every inch of it is a fake banner ad. That's the theme.

## Structure

```
index.html      — the whole site (single page)
css/style.css   — all styling (marquees, blink/shake/wobble animations, ad-popup swarm)
js/main.js      — copy-CA button, respawning ad popups, sticker swarm, emoji confetti
assets/logo.svg — the $COPYCAT coin logo (used on-site and in pair metadata)
```

## Things to fill in before launch

- **Contract address** — replace the `TBA — 📢 AD SLOT RESERVED` placeholder in `#caText` (and set `const CA` in `js/main.js`) once the coin drops.
- **Links** — the Buy / Chart / Telegram / X buttons currently point to `#`. Search `href="#"` in `index.html` and paste the real URLs.

The creator-rewards allocation shown on the site: **100% new-pair spam** — 100% of every fee auto-spam-launches new $COPYCAT pairs on pump.fun, non-stop.

## Deploying on GitHub Pages

Repo → Settings → Pages → deploy from branch → select the branch and `/ (root)`.
