# XBook product trailer (Remotion)

Programmatic ~58s **1080p / 30fps** promo video for XBook Console.

## Quick start

```bash
cd promo/trailer
npm install
npm run dev          # Remotion Studio — scrub timeline, edit scenes
npm run render       # writes out/xbook-trailer.mp4
```

From the repo root (after install in this folder):

```bash
npm run promo:studio
npm run promo:render
```

## Composition

| ID | `XBookTrailer` |
|----|----------------|
| Duration | 1740 frames (~58s) |
| Size | 1920×1080 |
| FPS | 30 |

Scenes live under `src/scenes/`:

1. **Hook** — bookmarks pile up  
2. **Promise** — product one-liner  
3. **Import** — X + YouTube  
4. **Enrich** — local LLM process inbox  
5. **Search** — semantic retrieve  
6. **Desktop** — Tauri / local SQLite  
7. **CTA** — github.com/GINNOV/xbook  

Timeline constants: `src/XBookTrailer.tsx` (`SCENE`).

## Real screenshots (optional upgrade)

Drop PNG/JPG into `public/` and swap mock panels for:

```tsx
import { Img, staticFile } from "remotion";
<Img src={staticFile("dashboard.png")} />
```

Keep sensitive tokens out of shots.

## Agent notes

When the user asks to **update the promo video** / **re-render trailer**:

1. Edit copy/scenes under `promo/trailer/src/`  
2. Preview with `npm run promo:studio`  
3. Render with `npm run promo:render`  
4. Commit source; treat `out/*.mp4` as optional artifact (gitignored by default)

Remotion is free for teams of up to 3 — see [remotion.pro/license](https://www.remotion.pro/license).
