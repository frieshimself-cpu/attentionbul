# $BULLPOST — Official Website

The coin that markets itself. 🐂📢

A fully static one-page site — no build step, no dependencies. Open `index.html` in a browser or host it anywhere (GitHub Pages, Vercel, Netlify, Cloudflare Pages).

## Structure

```
index.html      — the whole site (single page)
css/style.css   — all styling
js/main.js      — copy-CA button, mobile nav, scroll reveals
assets/logo.svg — hand-drawn SVG recreation of the mascot (fallback)
```

## Swapping in the real logo

Drop the original mascot PNG into `assets/logo.png` — the site automatically prefers it everywhere (nav, hero, community card, footer) and only falls back to the SVG when the PNG is missing.

## Things to fill in before launch

- **Contract address** — replace `TBA — dropping soon` inside the `#caText` element in `index.html`.
- **Links** — the Buy / Chart / Telegram / X buttons currently point to `#`. Search `href="#"` in `index.html` and paste the real URLs.

The creator-rewards split shown on the site: 50% pair spam, 50% bagworker army.

## Deploying on GitHub Pages

Repo → Settings → Pages → deploy from branch → select the branch and `/ (root)`.
