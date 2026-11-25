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

- **32** locations, all with coordinates.
- 26 came from automatic geocoding and were validated against the state polygons; 6 use
  supplied OSM points and carry a `precision` flag:

| Brand | Precision | Note |
| --- | --- | --- |
| Columbia Asia Binh Duong | exact | The hospital itself, Đường 22 Tháng 12 |
| TAGS Cheras | good | Tower 2 car park; tower ~100 m away |
| TAGS Hartamas | street | Galeria Hartamas is on Jalan 26A/70A, no building feature in OSM |
| TAGS Penang | good | 30 Jalan Masjid Negeri, Greenlane |
| TAGS Seremban | good | Jalan S2 B12, Uptown Avenue |
| TAGS Johor Bahru | approximate | Dewanraya Taman Century; a few hundred metres of error |

Anything that isn't `exact` shows a `≈` in the panel list and a "pin" note in the popup.

The Bình Dương hospital is in Vietnam, so the map still fits to Malaysia on load and the
catchment analytics (which use DOSM population) cover the 31 Malaysian sites.

## How it was produced

1. Fetched the directory pages (`?page=1…4`) and parsed `article.directory-card` blocks.
2. Geocoded each address with [Nominatim](https://nominatim.openstreetmap.org) (1 req/sec, MY + VN).
3. Rejected matches that were obviously wrong, then validated every remaining point against the
   state polygons in `public/data/malaysia/`.

Rate limits and attribution: Nominatim data is © OpenStreetMap contributors, ODbL.
