# Export for new slides — hospital locations

> **Asia One rows removed.** These files now contain MOH public and MOH-licensed private
> facilities only. The Asia One network lives in the app at `src/lib/locations.ts`.
> References to the `asia_one` cohort below describe the upstream generator, not the
> current contents. The matching `.xlsx` files were not regenerated.

Run from repo root:

```bash
npm run export:slides:hospitals
```

This refreshes:

- **`malaysia-hospital-locations-public-private-asia-one.json`** — combined array under `facilities` with metadata.
- **`malaysia-hospital-locations-public-private-asia-one.xlsx`** — same rows, one sheet (`Facilities`).

## Cohorts

| `kind` | Source file | Meaning |
|--------|-------------|---------|
| `public` | `src/data/public-hospitals.geocoded.json` | MOH public hospital list + geocoding |
| `private_moh_licensed` | `src/data/swasta-berlesen.geocoded.json` | Licensed private hospitals (MOH register) + geocoding + bed merge when present |
| `asia_one` | `src/data/asia-one-healthcare.geocoded.json` | Asia One Healthcare portfolio sites + disclosed/estimated beds where noted |

Only facilities with **finite WGS84 `latitude` / `longitude`** are included.

## Columns (JSON + Excel)

- **`kind`** — cohort key (see table).
- **`id`** — stable string within this export (`pub-*`, `pvt-*`, `asia-*` + index). Not a national MOH primary key for private duplicates.
- **`name`** — display name.
- **`latitude`**, **`longitude`** — decimal degrees.
- **`state`** — public & private use MOH-style state labels; Asia One rows may leave this empty (address still in **`address`**).
- **`address`**, **`contact_or_phone`** — where the source provides them.
- **`total_beds`** — MOH **`TOTAL_BEDS`** for licensed private; portfolio **`beds`** for Asia One; usually `null` for public.
- **`bed_disclosure_note`** — Asia One **`beds_note`** or short note for private.
- **`moh_bil`** — MOH running number on private register when present (`null` otherwise). The same **`moh_bil`** can appear on more than one row when the register has multiple sites under one number.
- **`city`**, **`postcode`** — from private register (`BANDAR`, `POSKOD`).
- **`asia_confidence`** — Asia One bed disclosure confidence when present.

To change the underlying lists, edit the **`src/data/*.geocoded.json`** sources (or regenerate them via the repo’s geocode / merge scripts), then re-run **`npm run export:slides:hospitals`**.

---

## Klang Valley only — hospitals with bed counts

Filter: same **metro bounding box** as the intelligence map / `exports/klang-valley-private-licensed-hospitals.json` (`src/lib/klang-valley-metro.ts`).

```bash
npm run export:slides:kv-hospitals
```

Produces:

| File | Description |
|------|--------------|
| **`klang-valley-hospitals-with-beds.json`** | `hospitals` array + meta (bounds, counts). |
| **`klang-valley-hospitals-with-beds.xlsx`** | Sheet `KV_hospitals_beds`. |

**Bed columns**

- **`bed_count_total`**
  - **Public**: reference wards + ICU from `reference/malaysia_public_hospitals.json` when name/state matches; else KKMNOW `beds_nonicu` + `beds_icu` (same logic as `npm run export:excel`).
  - **Private MOH**: `TOTAL_BEDS` from the licensed-private register.
  - **Asia One**: portfolio `beds` (often `null` or `0` for non-inpatient sites — read **`bed_source_detail`** / original `beds_note`).

Some sites may appear in both **Asia One** and **private MOH** with different **`kind`**; keep both rows or dedupe by name/coords if your slide treats them as one facility.

---

## Klang Valley — licensed private hospitals only (Excel)

MOH **swasta berlesen** facilities inside the **KV metro bbox** only (no public, no Asia One list rows — but URLs may overlap the Asia One portfolio).

```bash
npm run export:slides:kv-private-xlsx
```

| File | Description |
|------|-------------|
| **`klang-valley-private-hospitals.xlsx`** | Sheet **`KV_private_hospitals`**: coordinates, beds, website & specialist directory URLs, optional specialist roster row counts from merged doctor-directory scrape. Sheet **`Export_meta`**. |
