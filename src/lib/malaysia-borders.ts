/**
 * Malaysia administrative & electoral boundaries.
 *
 * Files live in `public/data/malaysia/` and are fetched on demand (≈6.1 MB in total),
 * so only pay for the level you actually draw. Source & licensing: see
 * `public/data/malaysia/README.md`.
 */

export type Position = [number, number];

export type BorderGeometry =
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

export type BorderFeature<P> = {
  type: "Feature";
  properties: P;
  geometry: BorderGeometry;
};

export type BorderCollection<P> = {
  type: "FeatureCollection";
  features: BorderFeature<P>[];
};

export type CountryProps = { name: string; iso: string; abr: string };

export type StateProps = { state_id: number; name: string; state: string };

export type DistrictProps = { name: string; code_state: number; state: string };

export type DistrictJakimProps = DistrictProps & { jakim_code: string };

export type DunProps = {
  state: string;
  parlimen: string;
  dun: string;
  code_state: number;
  code_parlimen: string;
  code_dun: string;
  code_state_dun: string;
};

export type ParlimenProps = {
  state: string;
  parlimen: string;
  code_state: number;
  code_parlimen: string;
};

export type BorderLevel = "country" | "state" | "district" | "district-jakim" | "dun" | "parlimen";

export type BorderPropsFor<L extends BorderLevel> = L extends "country"
  ? CountryProps
  : L extends "state"
    ? StateProps
    : L extends "district"
      ? DistrictProps
      : L extends "district-jakim"
        ? DistrictJakimProps
        : L extends "dun"
          ? DunProps
          : ParlimenProps;

export const BORDER_FILES: Record<BorderLevel, string> = {
  country: "/data/malaysia/malaysia.geojson",
  state: "/data/malaysia/malaysia.state.geojson",
  district: "/data/malaysia/malaysia.district.geojson",
  "district-jakim": "/data/malaysia/malaysia.district-jakim.geojson",
  dun: "/data/malaysia/malaysia.dun.geojson",
  parlimen: "/data/malaysia/malaysia.parlimen.geojson",
};

const cache = new Map<BorderLevel, Promise<unknown>>();

/** Fetch a boundary level once and cache it for the session. */
export function loadBorders<L extends BorderLevel>(
  level: L,
): Promise<BorderCollection<BorderPropsFor<L>>> {
  let pending = cache.get(level);
  if (!pending) {
    pending = fetch(BORDER_FILES[level]).then((res) => {
      if (!res.ok) throw new Error(`Failed to load ${level} boundaries (HTTP ${res.status})`);
      return res.json();
    });
    cache.set(level, pending);
  }
  return pending as Promise<BorderCollection<BorderPropsFor<L>>>;
}

/** `"P.140 Segamat"` → `"Segamat"`, `"N.01 Buloh Kasap"` → `"Buloh Kasap"`. */
export function bareSeatName(name: string) {
  return name.replace(/^[NP]\.\d+\s+/, "");
}
