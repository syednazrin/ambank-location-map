# Asia OneHealthcare — brand locations

Scraped from <https://asiaonehealth.com/our-brands> on 2026-11-25 (4 pages, 32 cards).

| File | What it is |
| --- | --- |
| `asiaone-locations.json` | Full records, including geocode provenance |
| `asiaone-locations.csv` | Flat export for Excel / Google Sheets |

## Fields

| Field | Notes |
| --- | --- |
| `id` | Slug of the brand name |
| `name`, `address`, `phone`, `email`, `website` | Straight from the directory card (emails decoded from Cloudflare obfuscation) |
| `country`, `state` | Derived from the address |
| `lat`, `lng` | WGS84 decimal degrees, `null` when unresolved |
| `geocode.source` | `nominatim`, `derived` (copied from a sibling record) or `null` |
| `geocode.type` | OSM `addresstype` — `building`, `road`, `city` … |
| `geocode.confidence` | `high` (building/POI), `medium` (street/suburb), `low` (city only), `none` |
| `geocode.label` | What the geocoder actually matched, for eyeballing |
| `validation.insideState` | Point-in-polygon check against `public/data/malaysia/malaysia.state.geojson` |

## Status

- **32** locations scraped, **26** with coordinates.
- All 26 points fall **inside the Malaysian state their address claims** (validated against the state boundary file).
- **6 need a better geocoder** — Nominatim had no result and the fallbacks landed on a wrong building or a centroid, so they were discarded rather than shipped wrong:

| Brand | Address |
| --- | --- |
| Columbia Asia Binh Duong | Đường 22 tháng 12, Thuận Giao, Thuận An, Bình Dương |
| TAGS Cheras | Menara PGRM 2, Jalan Pudu Ulu, 56100 Cheras |
| TAGS Hartamas | Galeria Hartamas, Jalan 26A/70A, 50480 Kuala Lumpur |
| TAGS Johor Bahru | Jalan Harimau Tarum, Taman Century, 80250 Johor Bahru |
| TAGS Penang | Jalan Masjid Negeri, Greenlane, 11600 George Town |
| TAGS Seremban | Jalan S2 B12, Uptown Avenue, Seremban 2, 70300 Seremban |

Drop a TomTom key in and the retry script can fill these in without touching the rest.

## How it was produced

1. Fetched the directory pages (`?page=1…4`) and parsed `article.directory-card` blocks.
2. Geocoded each address with [Nominatim](https://nominatim.openstreetmap.org) (1 req/sec, MY + VN).
3. Rejected matches that were obviously wrong, then validated every remaining point against the
   state polygons in `public/data/malaysia/`.

Rate limits and attribution: Nominatim data is © OpenStreetMap contributors, ODbL.
