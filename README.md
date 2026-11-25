# AmBank · Location Explorer

A full-bleed, interactive Next.js map that fills the entire viewport — no chrome, no scrollbars,
just the map with a floating glass UI on top.

![Next.js](https://img.shields.io/badge/Next.js-16-black) ![React](https://img.shields.io/badge/React-19-black) ![Leaflet](https://img.shields.io/badge/Leaflet-1.9-199900)

## What's in it

- **Edge-to-edge map** — the Leaflet container is `100dvh` with `overflow: hidden`, so it engulfs the page on desktop and mobile.
- **No API keys** — three basemaps (Midnight, Paper, Streets) served by keyless Esri tile endpoints.
- **Custom pins + popups** — gold SVG pins, dark glass popups, one-tap Google Maps directions.
- **Location list** — click any branch in the panel to fly to it and open its popup.
- **Find my location** — geolocation with a pulsing "you are here" dot.
- **Live coordinate HUD** — lat/lng and zoom level follow the cursor.
- **Mobile ready** — touch pan/zoom, responsive panels, safe-area friendly padding.

## Getting started

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

```bash
npm run build   # production build
npm start       # serve the production build
npm run lint
```

## Project structure

```
src/
├─ app/
│  ├─ layout.tsx      # fonts, metadata, Leaflet CSS
│  ├─ page.tsx        # renders the map shell
│  └─ globals.css     # map / pin / popup theming
├─ components/
│  ├─ MapClient.tsx   # client-only dynamic import (no SSR for Leaflet)
│  └─ MapView.tsx     # map, markers, overlay UI
└─ lib/
   └─ locations.ts    # demo location data — replace with your API
```

## Editing the data

Everything the map renders lives in `src/lib/locations.ts`:

```ts
{
  id: "klcc",
  name: "AmBank KLCC",
  type: "Branch",            // Head Office | Branch | Business Centre | ATM
  address: "…",
  hours: "Daily · 10:00–20:00",
  phone: "+60 3-2382 0288",
  coords: [3.1582, 101.7116], // [lat, lng]
}
```

Add, remove or edit entries and the pins, popups and sidebar list update automatically.

## Basemaps

`BASEMAPS` in `src/components/MapView.tsx` defines the styles. The default set needs no token:

| Style    | Source                              |
| -------- | ----------------------------------- |
| Midnight | Esri World Dark Gray Canvas + labels |
| Paper    | Esri World Light Gray Canvas + labels |
| Streets  | Esri World Street Map               |

Swap in Mapbox / MapTiler / Stadia by pointing `layers[].url` at their tile URL and adding your key
to `.env.local` (e.g. `NEXT_PUBLIC_MAPBOX_TOKEN`).

## Notes

- The map component is loaded with `ssr: false` because Leaflet touches `window` at import time.
- The pin markers are `L.divIcon`s, so no marker image assets are needed.
- Popups are plain React, styled with Tailwind — the CSS overrides live in `globals.css`.

## Deploy

Deployed on Vercel. Any Node host works:

```bash
vercel --prod
```
