# Healthcare data (copied from `Ambank - Jeff ( One Asia)`)

Snapshot of the data folder from the One Asia intelligence project, copied on
2026-11-25 so the hospital / doctor / demographic layers can be reused here.

Import from app code with the `@` alias, e.g.:

```ts
import hospitals from "@/data/public-hospitals.json";
import kkmnow from "@/data/kkmnow-hospital-bed-utilisation-by-facility.json";
```

JSON is enabled in `tsconfig.json` (`resolveJsonModule`), so static imports get types.

## Files

### Facilities

| File | Shape | What it is |
| --- | --- | --- |
| `public-hospitals.json` | `{ meta, byState, hospitals[143] }` | MOH public hospital directory |
| `public-hospitals.geocoded.json` | array | Same list with WGS84 `lat`/`lng` |
| `public-hospitals.missing-coordinates.json` | array | Rows the geocoder could not resolve |
| `swasta-berlesen.geocoded.json` | `{ meta, hospitals[224] }` | MOH-licensed **private** hospitals, geocoded, with `TOTAL_BEDS`, `BANDAR`, `POSKOD`, `moh_bil` |
| `swasta-berlesen.missing-coordinates.json` | array | Unresolved private rows |
| `Licensed Private Hospitals.xlsx` | sheet | Original MOH private register export |
| `reference/malaysia_public_hospitals.json` | array[110] | Curated public-hospital reference (wards + ICU beds) |

> **Asia One sites are deliberately not part of this dataset.** The app's own network is
> `src/lib/locations.ts` (32 brands, scraped from asiaonehealth.com) so the 14 imported
> Asia One rows were removed to avoid a second source of truth.

### Bed utilisation / capacity

| File | What it is |
| --- | --- |
| `kkmnow-hospital-bed-utilisation-by-facility.json` | KKMNOW scrape, 148 facility rows: beds (non-ICU), ICU beds, utilisation |
| `hospitals_enriched_websites_doctors.json` | Enriched private hospitals: websites, doctor-directory links, `topPrivateHospitalsByBeds` |

### Doctors / specialists

| File | What it is |
| --- | --- |
| `mmc-registered-doctors.background-run.json` | Malaysian Medical Council register scrape, 2,500 records |
| `mmc-registered-doctors.smoke.json` | Small sample of the same scrape (test fixture) |
| `nsr-specialist-register.json` | National Specialist Register, 20,779 records (≈12.9 MB) |
| `nsr-institution-sector-openai-cache.json` | Cached OpenAI classification of NSR institutions by sector |

### Pre-computed intelligence payload

| File | What it is |
| --- | --- |
| `intelligence-payload.production.json` | Ready-to-render bundle (≈0.7 MB): 367 hospitals, 4,500 specialist points, `specialtyTotals`, `stateBeds`, `utilization`, `corridors`, `narrative` |
| `asiaone-profiles.json` | Bed + specialist figures for the 32 Asia One sites. Each value carries its `source`: `site` (published on the brand website), `moh` (licensed private register `TOTAL_BEDS`), `nsr` (National Specialist Register rows naming the establishment), or `listed` (doctor profiles on the site) |

Rebuild the Asia One figures with:

```bash
npm run profiles:scrape   # fetch each brand site for published bed / specialist counts
npm run profiles:build    # fill gaps from the MOH register + NSR, write src/data/asiaone-profiles.json
```

`data/asiaone-profiles.json` holds the raw scrape output (snippets included); the
`scripts/build-asiaone-profiles.mjs` pass is what produces the file the app imports.

### Demographics — `District and Dun Data/`

| File | What it is |
| --- | --- |
| `malaysia.state.json`, `malaysia.parlimen.json`, `malaysia.dun.json` | Boundary GeoJSON (state / parliament / DUN). Mirrors `public/data/malaysia/*.geojson` |
| `population/population-choropleth.json` | DOSM population by DUN / parliament / state, with metrics + stats |
| `population/population-lookups.json` | Name lookups (`byDun`, `byParlimen`, `byState`) |
| `population/population_dun.parquet` | Raw DOSM DUN population extract |
| `population/population_parlimen.parquet` | Raw DOSM parliament population extract |
| `Household Income/hh_income_dun.parquet`, `hh_income_parlimen.parquet` | Household income by DUN / parliament |
| `Household Expenditure/hh_expenditure_dun.parquet`, `hh_expenditure_parlimen.parquet` | Household expenditure by DUN / parliament |

> The population parquet files here duplicate `data/population_dun (2).parquet`,
> `data/population_parlimen.parquet` and `data/population_district.parquet` used by
> `scripts/build-area-stats.py` → `src/lib/area-stats.ts`. Use the root `data/` copies
> for that pipeline; these are kept alongside the rest of the source dataset.

## Ready-made exports — `data/exports/`

Generated slide/report artefacts (JSON + XLSX):

| Folder | Contents |
| --- | --- |
| `data/exports/hospitals/` | All Malaysian hospital locations (public + private) and a **Klang Valley hospitals with beds** cut. See `EXPORT_README.md` |
| `data/exports/final/` | NSR specialist counts by institution, KV doctor-directory specialists, KV licensed private hospitals + URL overrides, `hospitals-public-private.xlsx` |
| `data/exports/final-export/` | `Klang_Valley_Hospitals.xlsx` + `malaysia-private-hospitals-names.json` |

## Loaders (ported from the same project)

| Module | What it gives you |
| --- | --- |
| `src/types/intelligence.ts` | Types for the intelligence payload (`IntelligencePayload`, `IntelligenceHospital`, `SpecialistMapPoint`, `StateBedsRow`, `UtilizationRow`, `CorridorRow`) |
| `src/server/intelligence-snapshot.ts` | `loadIntelligencePayload()` / `computeIntelligencePayload()` — joins NSR specialists + KKMNOW utilisation + public/private beds + DOSM population into one payload |
| `src/app/api/intelligence/data/route.ts` | `GET /api/intelligence/data` — cached JSON of that payload |
| `src/lib/public-hospital-bed-merge.ts` | Fuzzy name/state join of public hospitals to KKMNOW + reference bed counts |
| `src/lib/metro-admin-bed-stats.ts` | Beds per DUN / parliament inside the Klang Valley metro box |
| `src/lib/kv-tri-region-bed-stats.ts` | Public vs private beds per 10k for KL / PJ (P.105–106) / Selangor |
| `src/lib/kv-tri-public-bed-panel.ts` | KPI + table model for the KL/Selangor/Putrajaya public cohort |
| `src/lib/malaysia-facility-plot-bundles.ts` | Point GeoJSON for the public and private cohorts, radius-scaled by beds or 15 km specialist reach |
| `src/lib/malaysia-choropleth.ts` | Builds DUN (or parliament for the federal territories) choropleth GeoJSON for any metric |
| `src/lib/klang-valley-metro.ts` | Metro bounding box + `haversineMeters()` |
| `src/lib/geo-point-in-polygon.ts` | Point-in-polygon + bbox helpers |
| `src/lib/geodesic-circle-polygon.ts` | Geodesic circle → GeoJSON polygon (for radius/catchment overlays) |

`loadIntelligencePayload()` computes from the raw files in development and reads
`intelligence-payload.production.json` when `VERCEL=1` (the computation walks the whole
20.8k-row NSR register, so it is slow on a cold dev request — ~30 s here). Set
`INTELLIGENCE_USE_PREBUILT=1` to serve the pre-built snapshot locally instead.

## Caveats

- Coordinates are WGS84 decimal degrees. Rows without a finite `latitude` / `longitude`
  were dropped from the geocoded/exports files.
- Some sites appear in both the public and private registers; dedupe by name + coordinates
  if a view needs one row per physical hospital.
- These files are a snapshot. If the One Asia project regenerates them, re-copy rather
  than editing here.
