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
This is gonna be the projects photo: <img width="1024" height="1008" alt="image" src="https://github.com/user-attachments/assets/2ca0fafe-5c7e-4596-96fc-167657972613" />
This is gonna be the one I want you to spam with: <img width="224" height="222" alt="Screenshot 2026-07-05 015620" src="https://github.com/user-attachments/assets/e9de9d41-9756-41e0-8d56-f53e98635b0c" />
