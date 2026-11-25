import type { LngLatBoundsSWNE } from "@/lib/klang-valley-metro";
import { isLngLatInKlangValleyMetro } from "@/lib/klang-valley-metro";
import { isWilayahParliamentChoroplethState } from "@/lib/malaysia-choropleth";
import type { ChoroplethMetricDoc } from "@/lib/malaysia-choropleth";
import {
  boundsIntersect,
  pointInPolygonLngLat,
  polygonGeomLngLatBBox,
  type LngLatBounds,
  type PolygonalGeom,
} from "@/lib/geo-point-in-polygon";
import { mergePublicHospitalBedTotals, publicHospitalStableKey, type PublicSiteForBedJoin } from "@/lib/public-hospital-bed-merge";
import type { IntelligenceHospital } from "@/types/intelligence";

type DunFeatureProps = {
  state?: string;
  dun?: string;
  code_state_dun?: string;
};

type ParFeatureProps = {
  state?: string;
  parlimen?: string;
  code_parlimen?: string;
};

type AnyFc = {
  type: string;
  features: Array<{
    type?: string;
    geometry?: PolygonalGeom;
    properties?: Record<string, unknown>;
  }>;
};

type SwastaHospital = {
  TOTAL_BEDS?: unknown;
};

function metroBBoxBounds(swNe: LngLatBoundsSWNE): LngLatBounds {
  const [[swLon, swLat], [neLon, neLat]] = swNe;
  return { minLng: swLon, maxLng: neLon, minLat: swLat, maxLat: neLat };
}

function classifyMetroAdminCode(
  lng: number,
  lat: number,
  wilayahParZones: PreparedZone[],
  selangorDunZones: PreparedZone[],
): { tier: "dun" | "parliament"; code: string } | null {
  for (const z of wilayahParZones) {
    if (!boundsIntersect(z.bounds, { minLng: lng, maxLng: lng, minLat: lat, maxLat: lat })) continue;
    if (!pointInPolygonLngLat(lng, lat, z.geom)) continue;
    return { tier: "parliament", code: z.code };
  }
  for (const z of selangorDunZones) {
    if (!boundsIntersect(z.bounds, { minLng: lng, maxLng: lng, minLat: lat, maxLat: lat })) continue;
    if (!pointInPolygonLngLat(lng, lat, z.geom)) continue;
    return { tier: "dun", code: z.code };
  }
  return null;
}

type PreparedZone = {
  code: string;
  label: string;
  geom: PolygonalGeom;
  bounds: LngLatBounds;
};

function prepareWilayahParlimenZones(fc: AnyFc, metroBounds: LngLatBounds): PreparedZone[] {
  const zones: PreparedZone[] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    const rawSt = String(f.properties?.state ?? "").trim();
    if (!isWilayahParliamentChoroplethState(rawSt) || !g || (g.type !== "Polygon" && g.type !== "MultiPolygon"))
      continue;
    const bbox = polygonGeomLngLatBBox(g as PolygonalGeom);
    if (!bbox || !boundsIntersect(bbox, metroBounds)) continue;
    const props = (f.properties ?? {}) as ParFeatureProps;
    const code = String(props.code_parlimen ?? "").trim();
    if (!code) continue;
    const label = String(props.parlimen ?? "").trim() || code;
    zones.push({ code, label, geom: g as PolygonalGeom, bounds: bbox });
  }
  return zones;
}

function prepareSelangorDunZones(fc: AnyFc, metroBounds: LngLatBounds): PreparedZone[] {
  const zones: PreparedZone[] = [];
  for (const f of fc.features) {
    const rawSt = String(f.properties?.state ?? "").trim();
    if (rawSt !== "Selangor") continue;
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
    const bbox = polygonGeomLngLatBBox(g as PolygonalGeom);
    if (!bbox || !boundsIntersect(bbox, metroBounds)) continue;
    const props = (f.properties ?? {}) as DunFeatureProps;
    const code = String(props.code_state_dun ?? "").trim();
    if (!code) continue;
    const label = String(props.dun ?? "").trim() || code;
    zones.push({ code, label, geom: g as PolygonalGeom, bounds: bbox });
  }
  return zones;
}

export type MetroAdminBedRow = {
  tier: "dun" | "parliament";
  code: string;
  label: string;
  population: number | null;
  beds: number;
  bedsPer10k: number | null;
};

const INTEL_ID_RE = /^(pub|pvt)-(\d+)$/;

/** Total licensed / reported beds mapped to metro facilities; summed by DOSM polygon (Selangor DUN or Wilayah parliament). */
export function computeMetroAdminBedRows(options: {
  hospitals: IntelligenceHospital[];
  metroBoundsSWNE: LngLatBoundsSWNE;
  dunFc: AnyFc;
  parFc: AnyFc;
  popDoc: ChoroplethMetricDoc;
  pubDoc: { locations: ReadonlyArray<PublicSiteForBedJoin & { lat?: unknown; lon?: unknown }> };
  swDoc: { hospitals: readonly SwastaHospital[] };
  kkm: unknown;
  refPublic: unknown;
}): {
  dunRows: MetroAdminBedRow[];
  parRows: MetroAdminBedRow[];
  unassignedBeds: number;
  unassignedMetroSites: number;
} {
  const metroBoundsBox = metroBBoxBounds(options.metroBoundsSWNE);
  const wilayahZones = prepareWilayahParlimenZones(options.parFc, metroBoundsBox);
  const selangorZones = prepareSelangorDunZones(options.dunFc, metroBoundsBox);

  const mergedPublic = mergePublicHospitalBedTotals(
    options.pubDoc.locations,
    options.kkm as never,
    options.refPublic as never,
  );

  const labelByTierCode = new Map<string, string>();
  for (const z of wilayahZones) labelByTierCode.set(`p:${z.code}`, z.label);
  for (const z of selangorZones) labelByTierCode.set(`d:${z.code}`, z.label);

  const bedsByAggKey = new Map<string, number>();
  let unassignedBeds = 0;
  let unassignedMetroSites = 0;

  for (const h of options.hospitals) {
    if (!isLngLatInKlangValleyMetro(h.lon, h.lat)) continue;

    const m = INTEL_ID_RE.exec(h.id);
    let bedN = 0;
    if (!m) {
      unassignedMetroSites += 1;
      continue;
    }
    const kind = m[1];
    const idx = Number(m[2]);
    if (!Number.isFinite(idx)) {
      unassignedMetroSites += 1;
      continue;
    }

    if (kind === "pub") {
      const loc = options.pubDoc.locations[idx];
      if (!loc || typeof loc.lat !== "number" || typeof loc.lon !== "number") {
        unassignedMetroSites += 1;
        continue;
      }
      const merged = mergedPublic.get(publicHospitalStableKey(loc));
      if (merged != null && Number.isFinite(merged)) bedN = merged;
      else if (h.bedsNonIcu != null && Number.isFinite(h.bedsNonIcu)) bedN = h.bedsNonIcu;
      else continue;
    } else if (kind === "pvt") {
      const row = options.swDoc.hospitals[idx];
      if (!row) continue;
      const tb = row.TOTAL_BEDS;
      if (typeof tb !== "number" || !Number.isFinite(tb)) continue;
      bedN = tb;
    } else {
      continue;
    }

    const hit = classifyMetroAdminCode(h.lon, h.lat, wilayahZones, selangorZones);
    if (!hit) {
      unassignedBeds += bedN;
      unassignedMetroSites += 1;
      continue;
    }
    const key = `${hit.tier === "dun" ? "d" : "p"}:${hit.code}`;
    bedsByAggKey.set(key, (bedsByAggKey.get(key) ?? 0) + bedN);
  }

  const buildRows = (tier: "dun" | "parliament", aggKeysFiltered: string[]): MetroAdminBedRow[] => {
    const prefix = tier === "dun" ? "d:" : "p:";
    const popBucket = tier === "dun" ? options.popDoc.byDun : options.popDoc.byParlimen;
    const out: MetroAdminBedRow[] = [];
    for (const aggKey of aggKeysFiltered) {
      if (!aggKey.startsWith(prefix)) continue;
      const code = aggKey.slice(prefix.length);
      const beds = bedsByAggKey.get(aggKey) ?? 0;
      if (beds <= 0) continue;
      const popRow = popBucket[code];
      const popK =
        popRow?.population !== undefined && typeof popRow.population === "number" && Number.isFinite(popRow.population)
          ? popRow.population
          : null;
      const population = popK != null ? Math.round(popK * 1000) : null;
      const bedsPer10k =
        population != null && population > 0 ? (beds / population) * 10_000 : null;
      const label = labelByTierCode.get(aggKey) ?? code;
      out.push({ tier, code, label, population, beds, bedsPer10k });
    }
    out.sort((a, b) => {
      const ap = a.bedsPer10k;
      const bp = b.bedsPer10k;
      if (ap != null && bp != null && ap !== bp) return bp - ap;
      if (ap == null && bp != null) return 1;
      if (ap != null && bp == null) return -1;
      return b.beds - a.beds;
    });
    return out;
  }

  const aggKeysAll = [...bedsByAggKey.keys()];
  const dunRows = buildRows(
    "dun",
    aggKeysAll.filter((k) => k.startsWith("d:")),
  );
  const parRows = buildRows(
    "parliament",
    aggKeysAll.filter((k) => k.startsWith("p:")),
  );

  return { dunRows, parRows, unassignedBeds, unassignedMetroSites };
}
