export type ChoroplethMetricDoc = {
  metrics: Record<string, { label: string; description?: string }>;
  stats: {
    dun: Record<string, { min: number; max: number }>;
    parlimen: Record<string, { min: number; max: number }>;
    state?: Record<string, { min: number; max: number }>;
  };
  byDun: Record<string, Record<string, number>>;
  byParlimen: Record<string, Record<string, number>>;
};

/**
 * Kuala Lumpur, Labuan, and Putrajaya: overlay uses **parliament** boundaries and
 * `byParlimen` stats only (DUN polygons for those territories are skipped).
 * DOSM `population-choropleth.json` includes P.125 (Putrajaya) and P.166 (Labuan).
 */
export function isWilayahParliamentChoroplethState(state: string): boolean {
  const s = state.trim();
  return (
    s === "W.P. Kuala Lumpur" ||
    s === "WP Kuala Lumpur" ||
    s === "W.P. Labuan" ||
    s === "WP Labuan" ||
    s === "W.P. Putrajaya" ||
    s === "WP Putrajaya"
  );
}

type Polygonal = { type: "Polygon" | "MultiPolygon"; coordinates: unknown };

type ChoroplethFeature = {
  type: "Feature";
  geometry: Polygonal;
  properties: Record<string, string | number | undefined>;
};

export type ChoroplethFeatureCollection = {
  type: "FeatureCollection";
  features: ChoroplethFeature[];
};

export type AnyFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry?: { type: string; coordinates: unknown };
    properties?: Record<string, unknown>;
  }>;
};

function isPolygonalGeometry(g: { type: string }): g is Polygonal {
  return g.type === "Polygon" || g.type === "MultiPolygon";
}

/** DUN polygons for most states; single **parliament** polygon for Kuala Lumpur, Labuan, Putrajaya. */
export function buildMalaysiaChoroplethGeoJson(
  dunFc: AnyFeatureCollection,
  parFc: AnyFeatureCollection,
  doc: ChoroplethMetricDoc,
  metricKey: string,
): ChoroplethFeatureCollection {
  const features: ChoroplethFeature[] = [];

  for (const f of dunFc.features) {
    if (!f.geometry || !isPolygonalGeometry(f.geometry)) continue;
    const st = String(f.properties?.state ?? "");
    if (isWilayahParliamentChoroplethState(st)) continue;
    const code = String(f.properties?.code_state_dun ?? "");
    const row = doc.byDun[code];
    const v = row?.[metricKey];
    const base =
      f.properties && typeof f.properties === "object"
        ? (f.properties as Record<string, unknown>)
        : {};
    const props: Record<string, string | number | undefined> = {
      ...(base as Record<string, string | number | undefined>),
    };
    props.ch_metric = metricKey;
    if (typeof v === "number" && Number.isFinite(v)) props.ch_value = v;
    else delete props.ch_value;
    features.push({ type: "Feature", geometry: f.geometry, properties: props });
  }

  for (const f of parFc.features) {
    if (!f.geometry || !isPolygonalGeometry(f.geometry)) continue;
    const st = String(f.properties?.state ?? "");
    if (!isWilayahParliamentChoroplethState(st)) continue;
    const code = String(f.properties?.code_parlimen ?? "");
    const row = doc.byParlimen[code];
    const v = row?.[metricKey];
    const base =
      f.properties && typeof f.properties === "object"
        ? (f.properties as Record<string, unknown>)
        : {};
    const props: Record<string, string | number | undefined> = {
      ...(base as Record<string, string | number | undefined>),
    };
    props.ch_metric = metricKey;
    if (typeof v === "number" && Number.isFinite(v)) props.ch_value = v;
    else delete props.ch_value;
    features.push({ type: "Feature", geometry: f.geometry, properties: props });
  }

  return { type: "FeatureCollection", features };
}

export function combinedMetricMinMax(doc: ChoroplethMetricDoc, metricKey: string): { min: number; max: number } {
  const d = doc.stats.dun[metricKey];
  const p = doc.stats.parlimen[metricKey];
  if (!d || !p) {
    throw new Error(`choropleth: missing stats.dun or stats.parlimen for metric "${metricKey}"`);
  }
  return { min: Math.min(d.min, p.min), max: Math.max(d.max, p.max) };
}
