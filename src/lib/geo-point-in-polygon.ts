/**
 * Lightweight point-in-polygon for GeoJSON Polygon / MultiPolygon (WGS84, ring order [lng, lat]).
 */

export type PolygonalGeom = {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown;
};

export type LngLatBounds = {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
};

function extendBounds(b: LngLatBounds, lng: number, lat: number): void {
  if (lng < b.minLng) b.minLng = lng;
  if (lng > b.maxLng) b.maxLng = lng;
  if (lat < b.minLat) b.minLat = lat;
  if (lat > b.maxLat) b.maxLat = lat;
}

function ringBounds(ring: readonly number[][]): LngLatBounds | null {
  if (ring.length === 0) return null;
  const out: LngLatBounds = { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity };
  for (const pt of ring) {
    const lng = pt[0];
    const lat = pt[1];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    extendBounds(out, lng, lat);
  }
  return Number.isFinite(out.minLng) ? out : null;
}

/** Union bbox of polygon exterior rings (holes ignored — slightly conservative for prefilter only). */
export function polygonGeomLngLatBBox(geom: PolygonalGeom): LngLatBounds | null {
  if (geom.type === "Polygon") {
    const polys = geom.coordinates as unknown;
    if (!Array.isArray(polys) || polys.length === 0) return null;
    const outer = polys[0] as unknown;
    if (!Array.isArray(outer)) return null;
    return ringBounds(outer as number[][]);
  }
  if (geom.type === "MultiPolygon") {
    const multi = geom.coordinates as unknown;
    if (!Array.isArray(multi)) return null;
    let acc: LngLatBounds | null = null;
    for (const poly of multi as unknown[]) {
      if (!Array.isArray(poly) || poly.length === 0) continue;
      const outer = poly[0] as unknown;
      if (!Array.isArray(outer)) continue;
      const b = ringBounds(outer as number[][]);
      if (!b) continue;
      if (!acc) {
        acc = { ...b };
        continue;
      }
      extendBounds(acc, b.minLng, b.minLat);
      extendBounds(acc, b.maxLng, b.maxLat);
    }
    return acc;
  }
  return null;
}

export function boundsIntersect(a: LngLatBounds, b: LngLatBounds): boolean {
  return !(a.maxLng < b.minLng || a.minLng > b.maxLng || a.maxLat < b.minLat || a.minLat > b.maxLat);
}

function ringContains(lng: number, lat: number, ring: readonly number[][]): boolean {
  /** Ray casting: odd intersections = inside. */
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const inter =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (inter) inside = !inside;
  }
  return inside;
}

function polygonCoordinatesContain(lng: number, lat: number, coords: unknown): boolean {
  if (!Array.isArray(coords) || coords.length === 0) return false;
  const rings = coords as unknown[][];
  const outer = rings[0] as unknown;
  if (!Array.isArray(outer) || outer.length < 3) return false;
  const outerRing = outer as number[][];
  if (!ringContains(lng, lat, outerRing)) return false;
  for (let r = 1; r < rings.length; r++) {
    const hole = rings[r] as unknown;
    if (!Array.isArray(hole) || hole.length < 3) continue;
    if (ringContains(lng, lat, hole as number[][])) return false;
  }
  return true;
}

export function pointInPolygonLngLat(lng: number, lat: number, geom: PolygonalGeom): boolean {
  if (geom.type === "Polygon") {
    return polygonCoordinatesContain(lng, lat, geom.coordinates);
  }
  if (geom.type === "MultiPolygon") {
    const multis = geom.coordinates as unknown;
    if (!Array.isArray(multis)) return false;
    for (const poly of multis) {
      if (polygonCoordinatesContain(lng, lat, poly)) return true;
    }
  }
  return false;
}
