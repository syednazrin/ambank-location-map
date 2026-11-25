Regenerate numbers first if NSR or facility data changed:
  npm run intel:payload

Sheet KV_Beds: hospitals inside the Klang Valley metro bounding box (same as the map).
  beds_resolved uses MOH/KKM + reference merge for public sites, licensed TOTAL_BEDS for private,
  disclosed ward beds for Asia One locations — matching the institutional analytics pipeline.

Sheet KV_Specialists:
  specialists_on_site_establishment = NSR specialists matched to that hospital.
  specialists_within_15km_catchment_pool = pooled NSR count within ~15 km of the site (overlaps across hospitals).
  spec_* columns = on-site specialty bucket breakdown for that hospital.

Trailing summary block: sum_specialists_on_site is additive by admin area.
mean/max 15 km pool are per-hospital statistics only — do not sum pool column across hospitals.

Generated from intelligence payload + bundled facility JSON (106 hospitals).