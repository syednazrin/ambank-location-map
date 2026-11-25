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
│  ├─ tracker/        # /tracker — MapLibre delivery-tracker demo
│  └─ globals.css     # map / pin / popup theming + light card tokens
├─ components/
│  ├─ MapClient.tsx   # client-only dynamic import (no SSR for Leaflet)
│  ├─ MapView.tsx     # map, markers, overlay UI
│  ├─ maps/           # map-kit, DeliveryTrackerCard, demo
│  └─ ui/             # shadcn-style Card + Button primitives
└─ lib/
   ├─ locations.ts    # demo location data — replace with your API
   ├─ delivery-demo.ts# OSRM route + demo order data
   └─ malaysia-borders.ts # typed loader for the boundary GeoJSON
```

## `/tracker` — delivery tracker pattern

`src/components/maps/delivery-tracker-card.tsx` is the reusable card: MapLibre map,
route split into travelled/remaining at the driver, ETA pill, step bar, driver row
with message/call actions. `src/app/tracker/page.tsx` runs it as a live demo —
the driver is interpolated along a real OSRM route, so the ETA counts down and
the step advances by itself.

- Basemap: OpenFreeMap (no API key). `mapStyle` accepts any MapLibre style URL/object.
- Route: any `[lng, lat][]` from OSRM, Mapbox or Google Directions.
- The MapLibre web worker is served from `public/maplibre/`; `npm run dev`/`build`
  re-copy it from `node_modules` via `predev` / `prebuild`.

## Boundary data

`public/data/malaysia/` holds country, state, district, JAKIM-zone, DUN and
parliamentary boundaries (~6.1 MB total) from
[mptwaktusolat/jakim.geojson](https://github.com/mptwaktusolat/jakim.geojson).
See `public/data/malaysia/README.md` for the licence caveat and per-file schema,
and `src/lib/malaysia-borders.ts` for typed loading:

```ts
import { loadBorders } from "@/lib/malaysia-borders";
const dun = await loadBorders("dun");
```

Regenerate with `node scripts/fetch-malaysia-borders.mjs`.

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
