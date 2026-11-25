/** Joined state codes from KKMNOW panel → scrape `stateTitle` strings on public hospitals JSON. */

const KKM_STATE: Record<string, string> = {
  jhr: "Johor",
  kdh: "Kedah",
  ktn: "Kelantan",
  kul: "W.P. Kuala Lumpur",
  lbn: "W.P. Labuan",
  mlk: "Melaka",
  nsn: "Negeri Sembilan",
  phg: "Pahang",
  pjy: "W.P. Putrajaya",
  pls: "Perlis",
  png: "Pulau Pinang",
  prk: "Perak",
  sbh: "Sabah",
  sgr: "Selangor",
  swk: "Sarawak",
  trg: "Terengganu",
};

export type PublicSiteForBedJoin = {
  name: string;
  stateTitle: string;
  lat?: unknown;
  lon?: unknown;
};

type RefHospital = {
  state: string;
  hospital: string;
  beds: number | null;
  icu_beds: number | null;
};

function norm(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .toUpperCase()
    .replace(/['’`]/g, " ")
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Aligns WP / spellings — must match scripts/export-institutional-excel.mjs. */
export function stateMatchKey(s: string | null | undefined): string {
  const u = norm(s);
  if (u.includes("LABUAN")) return "__FT_LABUAN__";
  if (u.includes("PUTRAJAYA")) return "__FT_PUTRAJAYA__";
  if (u.includes("KUALA") && u.includes("LUMPUR")) return "__FT_KL__";
  return u;
}

function parseKkmCell(v: string | undefined | null): number | null {
  if (v == null || v === "" || String(v).trim() === "" || String(v) === "None") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function nameMatchScore(establishment: string, hospitalName: string): number {
  const e = norm(establishment);
  const h = norm(hospitalName);
  if (e.length < 4 || h.length < 4) return 0;
  if (e.includes(h)) return h.length;
  if (h.includes(e) && e.length >= 10) return e.length;
  const ht = h.split(" ").filter((t) => t.length > 3);
  let sc = 0;
  for (const t of ht) {
    if (e.includes(t)) sc += t.length;
  }
  return sc;
}

function sumRefPairs(beds: number | null | undefined, icu: number | null | undefined): number | null {
  if (beds == null && icu == null) return null;
  return (beds ?? 0) + (icu ?? 0);
}

function sumKkmPairs(nonIcuRaw: unknown, icuRaw: unknown): number | null {
  const non = parseKkmCell(nonIcuRaw != null ? String(nonIcuRaw) : "");
  const icu = parseKkmCell(icuRaw != null ? String(icuRaw) : "");
  if (non == null && icu == null) return null;
  return (non ?? 0) + (icu ?? 0);
}

/** Stable lookup key shared with export-institutional naming logic. */
export function publicHospitalStableKey(l: { name: string; stateTitle: string }): string {
  return `${stateMatchKey(l.stateTitle)}|${norm(l.name)}`;
}

type KkmRow = {
  state: string;
  data?: {
    hospital?: string | null;
    beds_nonicu?: string | number | null;
    beds_icu?: string | number | null;
  };
};

type KkmFile = {
  rows?: KkmRow[];
};

function hasGeoCoords(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    !Number.isNaN(lat) &&
    !Number.isNaN(lon)
  );
}

/**
 * Best-effort totals = general wards + ICU (reference first, KKMNOW fallback).
 * Uses `pub-${originalIndex}` exactly like scripts/export-institutional-excel.mjs.
 *
 * Returns a map keyed by `publicHospitalStableKey` — only hospitals with coordinates receive entries.
 */
export function mergePublicHospitalBedTotals(
  locations: readonly PublicSiteForBedJoin[],
  kkm: KkmFile,
  reference: RefHospital[],
): Map<string, number | null> {
  const basePublic: { id: string; name: string; state: string }[] = [];
  locations.forEach((p, i) => {
    if (!hasGeoCoords(p.lat, p.lon)) return;
    basePublic.push({ id: `pub-${i}`, name: p.name, state: p.stateTitle });
  });

  const kkmByPublicId = new Map<string, { nonIcuRaw: unknown; icuRaw: unknown }>();
  for (const row of kkm.rows ?? []) {
    const hosp = row.data?.hospital;
    if (hosp == null || String(hosp).trim() === "") continue;
    const stateName = KKM_STATE[row.state] ?? row.state;
    let bestPub: (typeof basePublic)[number] | null = null;
    let bestSc = 0;
    for (const h of basePublic) {
      if (stateMatchKey(h.state) !== stateMatchKey(stateName)) continue;
      const sc = nameMatchScore(String(hosp), h.name);
      if (sc > bestSc) {
        bestSc = sc;
        bestPub = h;
      }
    }
    if (bestPub != null && bestSc >= 10) {
      kkmByPublicId.set(bestPub.id, {
        nonIcuRaw: row.data!.beds_nonicu,
        icuRaw: row.data!.beds_icu,
      });
    }
  }

  const refByPublicId = new Map<string, { beds: number | null; icu_beds: number | null }>();
  for (const h of basePublic) {
    let bestRef: RefHospital | null = null;
    let bestSc = 0;
    for (const r of reference) {
      if (stateMatchKey(r.state) !== stateMatchKey(h.state)) continue;
      const sc = nameMatchScore(r.hospital, h.name);
      if (sc > bestSc) {
        bestSc = sc;
        bestRef = r;
      }
    }
    if (bestRef != null && bestSc >= 10) {
      refByPublicId.set(h.id, { beds: bestRef.beds, icu_beds: bestRef.icu_beds });
    }
  }

  const out = new Map<string, number | null>();
  locations.forEach((location, i) => {
    if (!hasGeoCoords(location.lat, location.lon)) return;
    const id = `pub-${i}`;
    const refMatch = refByPublicId.get(id);
    const kkmMatch = kkmByPublicId.get(id);

    let total: number | null = null;
    if (refMatch != null) {
      const fromRef = sumRefPairs(refMatch.beds, refMatch.icu_beds);
      if (fromRef != null) total = fromRef;
      else if (kkmMatch != null) total = sumKkmPairs(kkmMatch.nonIcuRaw, kkmMatch.icuRaw);
    } else if (kkmMatch != null) {
      total = sumKkmPairs(kkmMatch.nonIcuRaw, kkmMatch.icuRaw);
    }

    out.set(publicHospitalStableKey(location), total);
  });

  return out;
}

/**
 * Matches a geocoded / intelligence cohort public row to [`malaysia_public_hospitals.json`](../data/reference/malaysia_public_hospitals.json)
 * rows (same `stateMatchKey` + fuzzy name scoring as MOH merges).
 */
export function matchMalaysiaPublicReferenceRow<T extends { state: string; hospital: string }>(
  establishmentName: string,
  establishmentStateTitle: string,
  reference: readonly T[],
  minScore = 10,
): T | null {
  let best: T | null = null;
  let bestSc = 0;
  for (const r of reference) {
    if (stateMatchKey(r.state) !== stateMatchKey(establishmentStateTitle)) continue;
    const sc = nameMatchScore(r.hospital, establishmentName);
    if (sc > bestSc) {
      bestSc = sc;
      best = r;
    }
  }
  if (best == null || bestSc < minScore) return null;
  return best;
}
