import { matchMalaysiaPublicReferenceRow } from "@/lib/public-hospital-bed-merge";
import type { IntelligenceHospital } from "@/types/intelligence";

/** Canonical key aligned with fuzzy merge normalisation (`norm` semantics in MOH merges). */
function panelHospitalNameKey(raw: string | null | undefined): string {
  if (raw == null) return "";
  return String(raw)
    .toUpperCase()
    .replace(/['’`]/g, " ")
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Kuala Lumpur · Selangor · Putrajaya public facilities withheld from this panel’s denominators —
 * merged telemetry is unreliable or systematically blank for these establishments.
 *
 * KPI count, totals, averages, and the facility directory all omit rows matching these names (`panelHospitalNameKey`).
 */
export const KV_TRI_PANEL_KPI_EXCLUDED_HOSPITAL_NAMES = [
  "Hospital Ampang",
  "Hospital Banting",
  "Hospital Cyberjaya",
  "Hospital Kuala Kubu Bharu",
  "Hospital Orang Asli Gombak",
  "Hospital Serdang",
  "Hospital Tanjung Karang",
  "Hospital Tengku Ampuan Jemaah",
  "Hospital Tengku Ampuan Rahimah",
  "Hospital Selayang",
  "Hospital Shah Alam",
  "Hospital Rehabilitasi Cheras",
] as const satisfies readonly string[];

export const KV_TRI_PANEL_KPI_EXCLUDED_SITE_COUNT = KV_TRI_PANEL_KPI_EXCLUDED_HOSPITAL_NAMES.length;

const KV_TRI_PUBLIC_PANEL_KPI_EXCLUDED_KEYS = new Set(
  KV_TRI_PANEL_KPI_EXCLUDED_HOSPITAL_NAMES.map((n) => panelHospitalNameKey(n)),
);

export function isKvTriPublicPanelKpiExcludedName(name: string): boolean {
  return KV_TRI_PUBLIC_PANEL_KPI_EXCLUDED_KEYS.has(panelHospitalNameKey(name));
}

export function isKvTriAdministrativeArea(state: string): boolean {
  const u = state.trim().toUpperCase();
  if (u.includes("SELANGOR")) return true;
  if (u.includes("PUTRAJAYA")) return true;
  if (u.includes("KUALA LUMPUR")) return true;
  return false;
}

function kvTriStateRank(state: string): number {
  const u = state.toUpperCase();
  if (u.includes("SELANGOR")) return 0;
  if (u.includes("KUALA LUMPUR")) return 1;
  if (u.includes("PUTRAJAYA")) return 2;
  return 3;
}

export type MalaysiaPublicHospitalRefLike = {
  state: string;
  hospital: string;
  beds: number | null;
  icu_beds: number | null;
  bed_utilization_percent: number | null;
};

export type KvTriPublicTableRow = {
  id: string;
  state: string;
  name: string;
  bedsNonIcu: number | null;
  utilizationPercent: number | null;
};

export type KvTriPublicPanelModel = {
  hospitalCount: number;
  utilizationAvg: number | null;
  /** Facilities contributing to utilization average — have a finite utilization % after merge. */
  utilizationAvgEligibleCount: number;
  /** Listed facilities omitted from utilization average because utilization column is blank (no merged rate). */
  utilizationExcludedMissingRateCount: number;
  totalBedsNonIcu: number | null;
  bedsSampleSize: number;
  rows: KvTriPublicTableRow[];
};

/**
 * KPI + table rows for Kuala Lumpur, Selangor, and Putrajaya public cohorts only (after removing `KV_TRI_PANEL_KPI_EXCLUDED_HOSPITAL_NAMES`).
 * Otherwise fills missing merged attributes via `matchMalaysiaPublicReferenceRow`.
 */
export function buildKvTriPublicBedPanel(
  hospitals: readonly IntelligenceHospital[],
  reference: readonly MalaysiaPublicHospitalRefLike[],
): KvTriPublicPanelModel {
  const pubs = hospitals.filter(
    (h) =>
      h.kind === "public" &&
      isKvTriAdministrativeArea(h.state) &&
      !isKvTriPublicPanelKpiExcludedName(h.name),
  );

  const rows: KvTriPublicTableRow[] = pubs.map((h) => {
    const hit = matchMalaysiaPublicReferenceRow(h.name, h.state, reference, 10);
    const bedsNonIcu = h.bedsNonIcu ?? hit?.beds ?? null;
    const utilizationPercent = h.utilNonIcu ?? hit?.bed_utilization_percent ?? null;
    return { id: h.id, state: h.state, name: h.name, bedsNonIcu, utilizationPercent };
  });

  rows.sort(
    (a, b) => kvTriStateRank(a.state) - kvTriStateRank(b.state) || a.name.localeCompare(b.name, "en-MY"),
  );

  const hasKnownUtilization = (r: KvTriPublicTableRow): boolean =>
    r.utilizationPercent != null && Number.isFinite(r.utilizationPercent);

  const utilizationAvgRows = rows.filter((r) => hasKnownUtilization(r));
  const utilizationAvg =
    utilizationAvgRows.length === 0
      ? null
      : utilizationAvgRows.reduce((s, r) => s + (r.utilizationPercent as number), 0) / utilizationAvgRows.length;

  const utilizationExcludedMissingRateCount = rows.filter((r) => !hasKnownUtilization(r)).length;

  const bedsWithValues = rows.filter((r): r is KvTriPublicTableRow & { bedsNonIcu: number } => {
    const b = r.bedsNonIcu;
    return b != null && Number.isFinite(b);
  });

  const totalBedsNonIcu =
    bedsWithValues.length === 0
      ? null
      : bedsWithValues.reduce((s, r) => s + (r.bedsNonIcu ?? 0), 0);

  return {
    hospitalCount: rows.length,
    utilizationAvg,
    utilizationAvgEligibleCount: utilizationAvgRows.length,
    utilizationExcludedMissingRateCount,
    totalBedsNonIcu,
    bedsSampleSize: bedsWithValues.length,
    rows,
  };
}
