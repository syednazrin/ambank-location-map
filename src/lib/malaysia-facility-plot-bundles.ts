import publicHospitalsGeocoded from "@/data/public-hospitals.geocoded.json";
import swastaBerlesenGeocoded from "@/data/swasta-berlesen.geocoded.json";
import kkmBedUtilisation from "@/data/kkmnow-hospital-bed-utilisation-by-facility.json";
import refPublicMalaysia from "@/data/reference/malaysia_public_hospitals.json";
import type { IntelligencePayload } from "@/types/intelligence";
import {
  mergePublicHospitalBedTotals,
  publicHospitalStableKey,
  type PublicSiteForBedJoin,
} from "@/lib/public-hospital-bed-merge";

export type MarkerSizingMode = "beds" | "catchment";

export type PublicRow = (typeof publicHospitalsGeocoded.locations)[number];
export type SwastaRow = (typeof swastaBerlesenGeocoded.hospitals)[number];

export type FacilityPointFc = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: Record<string, string | number>;
  }>;
};

export type FacilityPlotBundles = {
  plottedPublic: PublicRow[];
  plottedSwasta: SwastaRow[];
  publicGeojson: FacilityPointFc;
  swastaGeojson: FacilityPointFc;
};

const PUBLIC_MARKER_RADIUS_FALLBACK = 6.5;
const PUBLIC_MARKER_RADIUS_MIN = 4.25;
const PUBLIC_MARKER_RADIUS_MAX = 17;

const PRIVATE_MARKER_RADIUS_FALLBACK = 7;
const PRIVATE_MARKER_RADIUS_MIN = 4.5;
const PRIVATE_MARKER_RADIUS_MAX = 17.5;

function sqrtQuantityMarkerRadius(
  qty: number,
  minSqrt: number,
  maxSqrt: number,
  minR: number,
  maxR: number,
  zeroFallback: number,
): number {
  if (!(qty > 0) || !Number.isFinite(qty)) return zeroFallback;
  const vt = Math.sqrt(qty);
  if (!(maxSqrt > minSqrt) || !Number.isFinite(minSqrt) || !Number.isFinite(maxSqrt)) {
    return (minR + maxR) / 2;
  }
  let t = (vt - minSqrt) / (maxSqrt - minSqrt);
  t = Math.min(1, Math.max(0, t));
  return minR + t * (maxR - minR);
}

function computeBedScaledCircleRadius(
  total: number | null,
  minSqrt: number,
  maxSqrt: number,
  fallback: number,
  minR: number,
  maxR: number,
): number {
  if (total == null) return fallback;
  const vt = Math.sqrt(Math.max(total, 0));
  if (total <= 0) {
    return minR + (fallback - minR) * 0.45;
  }
  if (!(maxSqrt > minSqrt) || !Number.isFinite(minSqrt) || !Number.isFinite(maxSqrt)) {
    return (minR + maxR) / 2;
  }
  const lo = Math.sqrt(0);
  let t = (vt - Math.max(minSqrt, lo)) / (maxSqrt - minSqrt);
  t = Math.min(1, Math.max(0, t));
  return minR + t * (maxR - minR);
}

function computePublicHospitalCircleRadius(total: number | null, minSqrt: number, maxSqrt: number): number {
  return computeBedScaledCircleRadius(
    total,
    minSqrt,
    maxSqrt,
    PUBLIC_MARKER_RADIUS_FALLBACK,
    PUBLIC_MARKER_RADIUS_MIN,
    PUBLIC_MARKER_RADIUS_MAX,
  );
}

function swastaLicensedBedTotal(row: SwastaRow): number | null {
  const v = row.TOTAL_BEDS;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  return null;
}

function computePrivateHospitalCircleRadius(total: number | null, minSqrt: number, maxSqrt: number): number {
  return computeBedScaledCircleRadius(
    total,
    minSqrt,
    maxSqrt,
    PRIVATE_MARKER_RADIUS_FALLBACK,
    PRIVATE_MARKER_RADIUS_MIN,
    PRIVATE_MARKER_RADIUS_MAX,
  );
}

function buildPublicGeoJson(
  rows: PublicRow[],
  bedTotals: Map<string, number | null>,
  sizing: MarkerSizingMode,
  reachByIntelId: Map<string, number>,
) {
  const plottedEntries = rows
    .map((row) => ({ row, intelId: `pub-${publicHospitalsGeocoded.locations.indexOf(row)}` }))
    .filter(
      (e): e is { row: PublicRow & { lat: number; lon: number }; intelId: string } =>
        typeof e.row.lat === "number" &&
        typeof e.row.lon === "number" &&
        !Number.isNaN(e.row.lat) &&
        !Number.isNaN(e.row.lon),
    );

  const positiveBeds = plottedEntries
    .map(({ row }) => bedTotals.get(publicHospitalStableKey(row)))
    .filter((n): n is number => typeof n === "number" && n > 0);
  const sqrtMedianBeds = Math.sqrt(200);
  const minSqrtBeds =
    positiveBeds.length > 0 ? Math.sqrt(Math.min(...positiveBeds)) : sqrtMedianBeds;
  const maxSqrtBeds =
    positiveBeds.length > 0 ? Math.sqrt(Math.max(...positiveBeds)) : sqrtMedianBeds;

  const poolsPositive =
    sizing === "catchment"
      ? plottedEntries
          .map(({ intelId }) => reachByIntelId.get(intelId))
          .filter((n): n is number => typeof n === "number" && n > 0 && Number.isFinite(n))
      : [];
  const sqrtMedianPools = Math.sqrt(400);
  const minSqrtPools =
    poolsPositive.length > 0 ? Math.sqrt(Math.min(...poolsPositive)) : sqrtMedianPools;
  const maxSqrtPools =
    poolsPositive.length > 0 ? Math.sqrt(Math.max(...poolsPositive)) : sqrtMedianPools;

  const features = plottedEntries.map(({ row, intelId }) => {
    const total = bedTotals.get(publicHospitalStableKey(row)) ?? null;
    const pool = reachByIntelId.get(intelId) ?? 0;
    const r =
      sizing === "catchment"
        ? sqrtQuantityMarkerRadius(
            pool,
            minSqrtPools,
            maxSqrtPools,
            PUBLIC_MARKER_RADIUS_MIN,
            PUBLIC_MARKER_RADIUS_MAX,
            PUBLIC_MARKER_RADIUS_FALLBACK,
          )
        : computePublicHospitalCircleRadius(total, minSqrtBeds, maxSqrtBeds);

    return {
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [row.lon, row.lat] as [number, number],
      },
      properties: {
        series: "public",
        name: row.name,
        address: row.address,
        phone: "",
        contact: row.contact,
        stateTitle: row.stateTitle ?? "",
        beds_total: total == null ? "" : String(total),
        circle_radius: r,
      },
    };
  });

  const plotted = plottedEntries.map((e) => e.row);
  return { plotted, geojson: { type: "FeatureCollection" as const, features } };
}

function buildSwastaGeoJson(
  rows: SwastaRow[],
  sizing: MarkerSizingMode,
  reachByIntelId: Map<string, number>,
) {
  const plottedEntries = rows
    .map((row) => ({ row, intelId: `pvt-${swastaBerlesenGeocoded.hospitals.indexOf(row)}` }))
    .filter(
      (e): e is { row: SwastaRow & { lat: number; lon: number }; intelId: string } =>
        typeof e.row.lat === "number" &&
        typeof e.row.lon === "number" &&
        !Number.isNaN(e.row.lat) &&
        !Number.isNaN(e.row.lon),
    );

  const positiveTotals = plottedEntries
    .map(({ row }) => swastaLicensedBedTotal(row))
    .filter((n): n is number => typeof n === "number" && n > 0);
  const sqrtMedianLicensed = Math.sqrt(100);
  const minSqrtLicensed =
    positiveTotals.length > 0 ? Math.sqrt(Math.min(...positiveTotals)) : sqrtMedianLicensed;
  const maxSqrtLicensed =
    positiveTotals.length > 0 ? Math.sqrt(Math.max(...positiveTotals)) : sqrtMedianLicensed;

  const poolsPositive =
    sizing === "catchment"
      ? plottedEntries
          .map(({ intelId }) => reachByIntelId.get(intelId))
          .filter((n): n is number => typeof n === "number" && n > 0 && Number.isFinite(n))
      : [];
  const sqrtMedianPools = Math.sqrt(400);
  const minSqrtPools =
    poolsPositive.length > 0 ? Math.sqrt(Math.min(...poolsPositive)) : sqrtMedianPools;
  const maxSqrtPools =
    poolsPositive.length > 0 ? Math.sqrt(Math.max(...poolsPositive)) : sqrtMedianPools;

  const features = plottedEntries.map(({ row, intelId }) => {
    const poskod = row.POSKOD != null && row.POSKOD !== "" ? String(row.POSKOD) : "";
    const bandar = String(row.BANDAR ?? "").trim();
    const negeri = String(row.NEGERI ?? "").trim();
    const address = [String(row.ALAMAT ?? "").trim(), [poskod, bandar].filter(Boolean).join(" "), negeri]
      .filter(Boolean)
      .join(", ");

    const licensed = swastaLicensedBedTotal(row);
    const pool = reachByIntelId.get(intelId) ?? 0;
    const r =
      sizing === "catchment"
        ? sqrtQuantityMarkerRadius(
            pool,
            minSqrtPools,
            maxSqrtPools,
            PRIVATE_MARKER_RADIUS_MIN,
            PRIVATE_MARKER_RADIUS_MAX,
            PRIVATE_MARKER_RADIUS_FALLBACK,
          )
        : computePrivateHospitalCircleRadius(licensed, minSqrtLicensed, maxSqrtLicensed);

    return {
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [row.lon, row.lat] as [number, number],
      },
      properties: {
        series: "swasta",
        name: String(row.NAMA_PENUH_FASILITI ?? "").trim(),
        address,
        phone: "",
        contact: "",
        stateTitle: negeri,
        beds_total: licensed == null ? "" : String(licensed),
        circle_radius: r,
      },
    };
  });

  const plotted = plottedEntries.map((e) => e.row);
  return { plotted, geojson: { type: "FeatureCollection" as const, features } };
}

/**
 * Point bundles for the MOH public and licensed-private cohorts.
 * Asia One sites are excluded — the app's own `LOCATIONS` store is the single
 * source for that network.
 */
export function buildFacilityPlotBundles(
  intelligencePayload: IntelligencePayload | null,
  markerSizingMode: MarkerSizingMode,
): FacilityPlotBundles {
  const reachById = new Map<string, number>();
  if (intelligencePayload) {
    for (const h of intelligencePayload.hospitals) {
      reachById.set(h.id, h.specialistReach15Km);
    }
  }
  const effectiveSizing: MarkerSizingMode =
    markerSizingMode === "catchment" && reachById.size > 0 ? "catchment" : "beds";

  const bedTotalsAll = mergePublicHospitalBedTotals(
    publicHospitalsGeocoded.locations as readonly PublicSiteForBedJoin[],
    kkmBedUtilisation as never,
    refPublicMalaysia as never,
  );

  const pub = buildPublicGeoJson(
    publicHospitalsGeocoded.locations,
    bedTotalsAll,
    effectiveSizing,
    reachById,
  );
  const swasta = buildSwastaGeoJson(swastaBerlesenGeocoded.hospitals, effectiveSizing, reachById);

  return {
    plottedPublic: pub.plotted,
    publicGeojson: pub.geojson,
    plottedSwasta: swasta.plotted,
    swastaGeojson: swasta.geojson,
  };
}
