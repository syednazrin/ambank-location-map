import doc from "@/data/asiaone-profiles.json";
import summary from "@/data/cohort-summary.json";
import { LOCATIONS, type Location } from "@/lib/locations";

export type CapacitySource = "site" | "moh" | "nsr" | "listed";

export type CapacityFigure = {
  value: number;
  source: CapacitySource;
  note: string;
  url: string | null;
};

export type CapacityRow = {
  loc: Location;
  beds: CapacityFigure | null;
  specialists: CapacityFigure | null;
};

export const SOURCE_LABEL: Record<CapacitySource, string> = {
  site: "Site",
  moh: "MOH",
  nsr: "NSR",
  listed: "Listed",
};

export const SOURCE_NOTE: Record<CapacitySource, string> = {
  site: "published on the brand website",
  moh: "MOH licensed private hospital register",
  nsr: "National Specialist Register, matched by establishment",
  listed: "doctor profiles listed on the brand website",
};

type ProfileDoc = {
  profiles: Array<{
    id: string;
    beds: { value: number; source: string; note: string; url: string | null } | null;
    specialists: { value: number; source: string; note: string; url: string | null } | null;
  }>;
};

const FIGURE_BY_ID = new Map(
  (doc as ProfileDoc).profiles.map((profile) => [profile.id, profile]),
);

function figure(
  raw: { value: number; source: string; note: string; url: string | null } | null,
): CapacityFigure | null {
  if (!raw) return null;
  const source = raw.source as CapacitySource;
  if (!(source in SOURCE_LABEL)) return null;
  return { value: raw.value, source, note: raw.note, url: raw.url };
}

/** Every Asia One site, with whatever bed / specialist figures are known. */
export const CAPACITY_ROWS: CapacityRow[] = LOCATIONS.map((loc) => {
  const profile = FIGURE_BY_ID.get(loc.id);
  return {
    loc,
    beds: figure(profile?.beds ?? null),
    specialists: figure(profile?.specialists ?? null),
  };
}).sort(
  (a, b) =>
    (b.beds?.value ?? -1) - (a.beds?.value ?? -1) ||
    (b.specialists?.value ?? -1) - (a.specialists?.value ?? -1) ||
    a.loc.name.localeCompare(b.loc.name),
);

export const CAPACITY_BY_ID = new Map(CAPACITY_ROWS.map((row) => [row.loc.id, row]));

export const CAPACITY_TOTALS = {
  beds: CAPACITY_ROWS.reduce((sum, row) => sum + (row.beds?.value ?? 0), 0),
  bedsKnown: CAPACITY_ROWS.filter((row) => row.beds != null).length,
  specialists: CAPACITY_ROWS.reduce((sum, row) => sum + (row.specialists?.value ?? 0), 0),
  specialistsKnown: CAPACITY_ROWS.filter((row) => row.specialists != null).length,
  sites: CAPACITY_ROWS.length,
};

/** Rows that carry at least one figure — the ones worth showing in the table. */
export const CAPACITY_REPORTED = CAPACITY_ROWS.filter(
  (row) => row.beds != null || row.specialists != null,
);

/* ---------- cohort comparison (Asia One vs licensed private vs public) ---------- */

export type CohortKey = "asia-one" | "private" | "public";

export type Cohort = {
  key: CohortKey;
  label: string;
  sites: number;
  beds: number;
  bedsSites: number;
  specialists: number;
  specialistSites: number;
  bedsNote: string;
  specialistsNote: string;
};

export const COHORTS = (summary as { cohorts: Cohort[] }).cohorts;

export const COHORT_BY_KEY = new Map(COHORTS.map((cohort) => [cohort.key, cohort]));

export const MAX_COHORT_BEDS = Math.max(...COHORTS.map((cohort) => cohort.beds));
export const MAX_COHORT_SPECIALISTS = Math.max(...COHORTS.map((cohort) => cohort.specialists));

/* ---------- bubble sizing ---------- */

export type SizeMode = "beds" | "specialists" | "none";

export const SIZE_LABEL: Record<SizeMode, string> = {
  beds: "Beds",
  specialists: "Spec.",
  none: "None",
};

/** Positive min/max of a value list, for square-root marker scaling. */
export function numericRange(values: Array<number | null | undefined>): { min: number; max: number } {
  const nums = values.filter((value): value is number => typeof value === "number" && value > 0);
  if (!nums.length) return { min: 0, max: 1 };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

/** Area-true circle radius: sqrt of the value, clamped between lo and hi pixels. */
export function scaledRadius(
  value: number | null | undefined,
  range: { min: number; max: number },
  fallback: number,
  lo = 4.5,
  hi = 14,
): number {
  if (value == null || !(value > 0)) return fallback;
  if (!(range.max > range.min)) return (lo + hi) / 2;
  const t =
    (Math.sqrt(value) - Math.sqrt(range.min)) / (Math.sqrt(range.max) - Math.sqrt(range.min));
  return lo + Math.min(1, Math.max(0, t)) * (hi - lo);
}

export const ASIA_BED_RANGE = numericRange(CAPACITY_ROWS.map((row) => row.beds?.value));
export const ASIA_SPECIALIST_RANGE = numericRange(
  CAPACITY_ROWS.map((row) => row.specialists?.value),
);
