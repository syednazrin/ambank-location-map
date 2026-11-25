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

/** Petaling Jaya corridor: parliament P.105 + P.106 (DOSM-aligned polygons in bundled GeoJSON). */
const PJ_PARLIAMENT_CODES = new Set(["P.105", "P.106"]);

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

type PreparedZone = {
  code: string;
  label: string;
  geom: PolygonalGeom;
  bounds: LngLatBounds;
};

function metroBBoxBounds(swNe: LngLatBoundsSWNE): LngLatBounds {
  const [[swLon, swLat], [neLon, neLat]] = swNe;
  return { minLng: swLon, maxLng: neLon, minLat: swLat, maxLat: neLat };
}

function prepareWilayahParZones(fc: AnyFc, metroBounds: LngLatBounds): PreparedZone[] {
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

function preparePjParZones(fc: AnyFc, metroBounds: LngLatBounds): PreparedZone[] {
  const zones: PreparedZone[] = [];
  for (const f of fc.features) {
    const rawSt = String(f.properties?.state ?? "").trim();
    if (rawSt !== "Selangor") continue;
    const props = (f.properties ?? {}) as ParFeatureProps;
    const code = String(props.code_parlimen ?? "").trim();
    if (!PJ_PARLIAMENT_CODES.has(code)) continue;
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
    const bbox = polygonGeomLngLatBBox(g as PolygonalGeom);
    if (!bbox || !boundsIntersect(bbox, metroBounds)) continue;
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

function classifyKvTriRegion(
  lng: number,
  lat: number,
  wilayahZones: PreparedZone[],
  pjZones: PreparedZone[],
  selangorDunZones: PreparedZone[],
): "kl" | "pj" | "selangor" | null {
  for (const z of wilayahZones) {
    if (!boundsIntersect(z.bounds, { minLng: lng, maxLng: lng, minLat: lat, maxLat: lat })) continue;
    if (!pointInPolygonLngLat(lng, lat, z.geom)) continue;
    return "kl";
  }
  for (const z of pjZones) {
    if (!boundsIntersect(z.bounds, { minLng: lng, maxLng: lng, minLat: lat, maxLat: lat })) continue;
    if (!pointInPolygonLngLat(lng, lat, z.geom)) continue;
    return "pj";
  }
  for (const z of selangorDunZones) {
    if (!boundsIntersect(z.bounds, { minLng: lng, maxLng: lng, minLat: lat, maxLat: lat })) continue;
    if (!pointInPolygonLngLat(lng, lat, z.geom)) continue;
    return "selangor";
  }
  return null;
}

function centroidInAnyPjZone(lng: number, lat: number, pjZones: PreparedZone[]): boolean {
  for (const z of pjZones) {
    if (!boundsIntersect(z.bounds, { minLng: lng, maxLng: lng, minLat: lat, maxLat: lat })) continue;
    if (pointInPolygonLngLat(lng, lat, z.geom)) return true;
  }
  return false;
}

const INTEL_ID_RE = /^(pub|pvt)-(\d+)$/;

export type KvTriRegionKey = "kl" | "pj" | "selangor";

export type KvTriRegionBedChartRow = {
  region: string;
  regionKey: KvTriRegionKey;
  publicPer10k: number | null;
  privatePer10k: number | null;
  totalPer10k: number | null;
  bedsPublic: number;
  bedsPrivate: number;
  population: number | null;
};

export type KvTriRegionBedModel = {
  chartRows: KvTriRegionBedChartRow[];
  unassignedBeds: number;
  unassignedMetroSites: number;
};

/**
 * Public vs licensed-private (+ Asia One disclosed beds) per 10k residents for KL (WP parliament),
 * PJ corridor (P.105 + P.106), and remaining Selangor DUN inside the metro framing box.
 *
 * Selangor denominator sums DUN populations whose bbox centroid falls outside P.105/P.106 to limit overlap with PJ seat totals.
 */
export function computeKvTriRegionBedStats(options: {
  hospitals: IntelligenceHospital[];
  metroBoundsSWNE: LngLatBoundsSWNE;
  dunFc: AnyFc;
  parFc: AnyFc;
  popDoc: ChoroplethMetricDoc;
  pubDoc: { locations: ReadonlyArray<PublicSiteForBedJoin & { lat?: unknown; lon?: unknown }> };
  swDoc: { hospitals: readonly SwastaHospital[] };
  kkm: unknown;
  refPublic: unknown;
}): KvTriRegionBedModel {
  const metroBoundsBox = metroBBoxBounds(options.metroBoundsSWNE);
  const wilayahZones = prepareWilayahParZones(options.parFc, metroBoundsBox);
  const pjZones = preparePjParZones(options.parFc, metroBoundsBox);
  const selangorDunZones = prepareSelangorDunZones(options.dunFc, metroBoundsBox);

  const mergedPublic = mergePublicHospitalBedTotals(
    options.pubDoc.locations,
    options.kkm as never,
    options.refPublic as never,
  );

  const bedsPublic: Record<KvTriRegionKey, number> = { kl: 0, pj: 0, selangor: 0 };
  const bedsPrivate: Record<KvTriRegionKey, number> = { kl: 0, pj: 0, selangor: 0 };

  let unassignedBeds = 0;
  let unassignedMetroSites = 0;

  for (const h of options.hospitals) {
    if (!isLngLatInKlangValleyMetro(h.lon, h.lat)) continue;

    const m = INTEL_ID_RE.exec(h.id);
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

    let bedN = 0;
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

    const hitRegion = classifyKvTriRegion(h.lon, h.lat, wilayahZones, pjZones, selangorDunZones);
    if (hitRegion == null) {
      unassignedBeds += bedN;
      unassignedMetroSites += 1;
      continue;
    }

    const isPublic = kind === "pub";
    if (isPublic) bedsPublic[hitRegion] += bedN;
    else bedsPrivate[hitRegion] += bedN;
  }

  const wpCodes = new Set(wilayahZones.map((z) => z.code));
  let popKlK = 0;
  let popKlAny = false;
  for (const code of wpCodes) {
    const row = options.popDoc.byParlimen[code]?.population;
    if (typeof row === "number" && Number.isFinite(row)) {
      popKlK += row;
      popKlAny = true;
    }
  }
  const populationKl = popKlAny ? Math.round(popKlK * 1000) : null;

  let popPjK = 0;
  let popPjAny = false;
  for (const code of PJ_PARLIAMENT_CODES) {
    const row = options.popDoc.byParlimen[code]?.population;
    if (typeof row === "number" && Number.isFinite(row)) {
      popPjK += row;
      popPjAny = true;
    }
  }
  const populationPj = popPjAny ? Math.round(popPjK * 1000) : null;

  let popSelK = 0;
  let popSelAny = false;
  const seenDun = new Set<string>();
  for (const z of selangorDunZones) {
    if (seenDun.has(z.code)) continue;
    seenDun.add(z.code);
    const cx = (z.bounds.minLng + z.bounds.maxLng) / 2;
    const cy = (z.bounds.minLat + z.bounds.maxLat) / 2;
    if (centroidInAnyPjZone(cx, cy, pjZones)) continue;
    const row = options.popDoc.byDun[z.code]?.population;
    if (typeof row === "number" && Number.isFinite(row)) {
      popSelK += row;
      popSelAny = true;
    }
  }
  const populationSelangor = popSelAny ? Math.round(popSelK * 1000) : null;

  const mkRow = (
    regionKey: KvTriRegionKey,
    label: string,
    population: number | null,
    pubBeds: number,
    pvtBeds: number,
  ): KvTriRegionBedChartRow => {
    const totalBeds = pubBeds + pvtBeds;
    const publicPer10k =
      population != null && population > 0 ? (pubBeds / population) * 10_000 : null;
    const privatePer10k =
      population != null && population > 0 ? (pvtBeds / population) * 10_000 : null;
    const totalPer10k =
      population != null && population > 0 ? (totalBeds / population) * 10_000 : null;
    return {
      region: label,
      regionKey,
      publicPer10k,
      privatePer10k,
      totalPer10k,
      bedsPublic: pubBeds,
      bedsPrivate: pvtBeds,
      population,
    };
  };

  const chartRows: KvTriRegionBedChartRow[] = [
    mkRow("kl", "KL (WP)", populationKl, bedsPublic.kl, bedsPrivate.kl),
    mkRow("pj", "PJ (P.105–106)", populationPj, bedsPublic.pj, bedsPrivate.pj),
    mkRow("selangor", "Selangor", populationSelangor, bedsPublic.selangor, bedsPrivate.selangor),
  ];

  return { chartRows, unassignedBeds, unassignedMetroSites };
}
