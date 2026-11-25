/**
 * Klang Valley “metro” framing aligned with the Slide 01 map default fit:
 * KL / PJ / core Selangor corridor box, tightened toward centre (same math as Mapbox `fitBounds`).
 */

export type LngLatBoundsSWNE = [[number, number], [number, number]];

function shrinkBoundsTowardCenter(
  b: LngLatBoundsSWNE,
  zoomInLinearFactor: number,
): LngLatBoundsSWNE {
  const [[swLon, swLat], [neLon, neLat]] = b;
  const cx = (swLon + neLon) / 2;
  const cy = (swLat + neLat) / 2;
  const hLon = (neLon - swLon) / 2 / zoomInLinearFactor;
  const hLat = (neLat - swLat) / 2 / zoomInLinearFactor;
  return [
    [cx - hLon, cy - hLat],
    [cx + hLon, cy + hLat],
  ];
}

const KLANG_VALLEY_METRO_BASE_SW_NE: LngLatBoundsSWNE = [
  [101.38, 2.95],
  [101.9, 3.34],
];

/** Southwest [lng, lat] and northeast [lng, lat] — shared by map + analytics panel. */
export const KLANG_VALLEY_METRO_BOUNDS_SW_NE = shrinkBoundsTowardCenter(KLANG_VALLEY_METRO_BASE_SW_NE, 1.2);

export function isLngLatInKlangValleyMetro(lng: number, lat: number): boolean {
  const [[swLon, swLat], [neLon, neLat]] = KLANG_VALLEY_METRO_BOUNDS_SW_NE;
  return lng >= swLon && lng <= neLon && lat >= swLat && lat <= neLat;
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const dφ = ((lat2 - lat1) * Math.PI) / 180;
  const dλ = ((lon2 - lon1) * Math.PI) / 180;
  const h =
    Math.sin(dφ / 2) * Math.sin(dφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) * Math.sin(dλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

export function klangValleyMetroBoundsCenter(): { lng: number; lat: number } {
  const [[swLon, swLat], [neLon, neLat]] = KLANG_VALLEY_METRO_BOUNDS_SW_NE;
  return { lng: (swLon + neLon) / 2, lat: (swLat + neLat) / 2 };
}
