/**
 * Builds a geographic (great-circle) ring on the spheroid approximation used by turf.distance.
 * Closing coordinate duplicates the start for valid GeoJSON polygons.
 */
const MEAN_EARTH_RADIUS_M = 6371008.8;

export function geodesicCircleCoordinates(
  centerLngDeg: number,
  centerLatDeg: number,
  radiusMeters: number,
  steps = 96,
): [number, number][] {
  const ring: [number, number][] = [];
  const φ1 = (centerLatDeg * Math.PI) / 180;
  const λ1 = (centerLngDeg * Math.PI) / 180;
  const δ = radiusMeters / MEAN_EARTH_RADIUS_M;

  for (let i = 0; i <= steps; i += 1) {
    const bearing = (i / steps) * 2 * Math.PI;
    const sinφ1 = Math.sin(φ1);
    const cosφ1 = Math.cos(φ1);
    const sinδ = Math.sin(δ);
    const cosδ = Math.cos(δ);
    const φ2 = Math.asin(sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(bearing));
    const λ2 =
      λ1 +
      Math.atan2(
        Math.sin(bearing) * sinδ * cosφ1,
        cosδ - sinφ1 * Math.sin(φ2),
      );
    ring.push([(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI]);
  }
  return ring;
}

/** Single GeoJSON polygon feature representing a geographic circle at `radiusMeters`. */
export function geodesicCirclePolygonFeature<P extends Record<string, string>>(
  properties: P,
  centerLngDeg: number,
  centerLatDeg: number,
  radiusMeters: number,
  steps = 96,
) {
  return {
    type: "Feature" as const,
    properties,
    geometry: {
      type: "Polygon" as const,
      coordinates: [geodesicCircleCoordinates(centerLngDeg, centerLatDeg, radiusMeters, steps)],
    },
  };
}
