# Malaysia administrative & electoral boundaries

GeoJSON boundary files (WGS84 / EPSG:4326, `[longitude, latitude]`).
Served by the app at `/data/malaysia/<file>` and loadable with `loadBorders()` from
`src/lib/malaysia-borders.ts`.

## Source

| | |
| --- | --- |
| Repository | https://github.com/mptwaktusolat/jakim.geojson (`master`) |
| Retrieved | 2026-11-25 |
| Purpose upstream | JAKIM prayer-time zones mapped to districts |
| Licence | **None declared upstream.** Confirm terms with the repo owner before redistributing or using commercially. |

## Files

| Level | File | Features | Size | Properties |
| --- | --- | ---: | ---: | --- |
| `country` | `malaysia.geojson` | 1 | 272 KB | `name`, `iso`, `abr` |
| `state` | `malaysia.state.geojson` | 16 | 351 KB | `state_id`, `name`, `state` |
| `district` | `malaysia.district.geojson` | 160 | 855 KB | `name`, `code_state`, `state` |
| `district-jakim` | `malaysia.district-jakim.geojson` | 170 | 1.42 MB | `name`, `code_state`, `state`, `jakim_code` |
| `dun` | `malaysia.dun.geojson` | 613 | 2.09 MB | `state`, `parlimen`, `dun`, `code_state`, `code_parlimen`, `code_dun`, `code_state_dun` |
| `parlimen` | `malaysia.parlimen.geojson` | 222 | 1.25 MB | `state`, `parlimen`, `code_state`, `code_parlimen` |

Total ≈ 6.1 MB. `manifest.json` holds the same metadata plus per-state feature counts.

### Conventions in this data

- `state` on districts/DUN/parliament is a **code** (`SGR`, `KDH`, `JHR`, …). Only `malaysia.state.geojson` carries the full name in `name`.
- Electoral names keep their prefix: `"P.140 Segamat"`, `"N.01 Buloh Kasap"`. Strip with `split(" ").slice(1).join(" ")` if you want the bare name.
- **DUN includes 13 federal-territory features** (K.L. 11, Putrajaya 1, Labuan 1) that mirror parliamentary seats — FTs have no state assembly. The 13 states hold the real 600 seats; filter `state` if you only want those.
- Geometry is `MultiPolygon` (some JAKIM zones are single `Polygon`).

## Using it

```ts
import { loadBorders } from "@/lib/malaysia-borders";

const states = await loadBorders("state");
const ipoh = states.features.find((f) => f.properties.name === "Perak");
```

With Leaflet or MapLibre, wrap the collection in an `L.geoJSON(...)` layer or a
MapLibre `geojson` source — the files are already in the shape both expect.

## Regenerating

```bash
node scripts/fetch-malaysia-borders.mjs
```

(Downloads the six files from upstream and rewrites `manifest.json`.)
