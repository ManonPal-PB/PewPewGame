# Topple Town (PewPewGame)

A 3D beach cannon game for phones: tap where you want to shoot and knock every jam jar and tin off the tables. 30 levels, an infinite-balls mode, and offline play once it's installed on the home screen.

## What's in here

| Path | What it is |
|---|---|
| `public/index.html` | The whole game |
| `public/sw.js` | Offline cache, so the game works with no internet after the first visit |
| `public/manifest.webmanifest` | App name, colours and icon for "Add to Home Screen" |
| `public/icon-*.png` | Home-screen icons |
| `public/_headers` | Tells Cloudflare not to cache the page and offline worker for too long, so updates get through |
| `wrangler.jsonc` | Tells Cloudflare to serve the `public` folder as a website |

There is no build step. Cloudflare serves the files as they are.

## Deploy on Cloudflare

1. In the Cloudflare dashboard go to **Workers & Pages → Create → Import a repository**.
2. Connect GitHub and pick **ManonPal-PB/PewPewGame**.
3. Leave the settings as they are:
   - Build command: *(leave blank)*
   - Deploy command: `npx wrangler deploy`
4. Click **Deploy**. You get an address like `https://pewpewgame.<your-subdomain>.workers.dev`.

Every push to `main` redeploys automatically.

## Install on an iPhone

1. Open the address in **Safari**.
2. Wait for **"✓ Saved for offline play"** on the start screen.
3. **Share → Add to Home Screen → Add**.
4. Check it: turn on Aeroplane Mode and open the icon.

## Releasing an update

When `public/index.html` changes, also change `VERSION` at the top of `public/sw.js` (for example `topple-town-v6` → `topple-town-v7`). That tells phones to swap their saved offline copy for the new one the next time they open the game online.
