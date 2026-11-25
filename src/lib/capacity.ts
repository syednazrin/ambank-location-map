import doc from "@/data/asiaone-profiles.json";
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
