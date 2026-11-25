"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  setWorkerUrl,
  type GeoJSONSource,
  type MarkerOptions,
  type PaddingOptions,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { cn } from "@/lib/utils";

/** Served from public/ (see scripts/sync-maplibre-worker.mjs). */
const WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";

export type LngLat = [number, number];
export type MapStyle = string | StyleSpecification;

/** OpenFreeMap — free, no API key, no account. */
export const DEFAULT_MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

export type UseMapOptions = {
  style?: MapStyle;
  interactive?: boolean;
  center?: LngLat;
  zoom?: number;
  /** Runs once the style has loaded — add sources and layers here. */
  onLoad?: (map: MapLibreMap) => void;
};

/**
 * Creates a MapLibre map in a container ref and reports when the style is ready.
 * The style is applied once at mount; remount to swap it.
 */
export function useMap({
  style = DEFAULT_MAP_STYLE,
  interactive = false,
  center = [0, 0],
  zoom = 2,
  onLoad,
}: UseMapOptions = {}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [map, setMap] = React.useState<MapLibreMap | null>(null);
  const [ready, setReady] = React.useState(false);
  const onLoadRef = React.useRef(onLoad);

  React.useEffect(() => {
    onLoadRef.current = onLoad;
  });

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setWorkerUrl(WORKER_URL);

    const instance = new MapLibreMap({
      container,
      style,
      center,
      zoom,
      interactive,
      attributionControl: { compact: true },
    });
    let cancelled = false;

    instance.on("load", () => {
      if (cancelled) return;
      onLoadRef.current?.(instance);
      setMap(instance);
      setReady(true);
    });

    return () => {
      cancelled = true;
      instance.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { containerRef, map, ready };
}

/** The div the map draws into. Parent must define the height (e.g. `relative h-72`). */
export function MapCanvas({
  containerRef,
  className,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  // MapLibre sets `position: relative` inline on this node, which would defeat
  // `absolute inset-0` — so size it with h-full/w-full instead.
  return <div ref={containerRef} className={cn("relative h-full w-full", className)} />;
}

/**
 * A React-rendered map marker: children are portalled into an element that
 * MapLibre owns, so you can use normal components and Tailwind inside.
 */
export function MapMarker({
  map,
  position,
  children,
  zIndex = 1,
  anchor = "center",
}: {
  map: MapLibreMap | null;
  position: LngLat;
  children: React.ReactNode;
  zIndex?: number;
  anchor?: MarkerOptions["anchor"];
}) {
  const [element, setElement] = React.useState<HTMLDivElement | null>(null);
  const markerRef = React.useRef<Marker | null>(null);
  const positionRef = React.useRef(position);

  // Move the marker without recreating it.
  React.useEffect(() => {
    positionRef.current = position;
    markerRef.current?.setLngLat(position);
  }, [position]);

  React.useEffect(() => {
    if (!map || !element) return;
    const marker = new Marker({ element, anchor })
      .setLngLat(positionRef.current)
      .addTo(map);
    markerRef.current = marker;
    return () => {
      marker.remove();
      markerRef.current = null;
    };
  }, [map, element, anchor]);

  return (
    <>
      <div ref={setElement} style={{ zIndex }} />
      {element ? createPortal(children, element) : null}
    </>
  );
}

/** A GeoJSON line through the given points. */
export function lineFeature(points: LngLat[]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: points },
  };
}

/** Replace a GeoJSON source's data, if it exists. */
export function setSourceData(map: MapLibreMap, sourceId: string, data: GeoJSON.GeoJSON) {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  source?.setData(data);
}

/** Fit the camera to a set of points with padding for the surrounding UI. */
export function fitToPoints(
  map: MapLibreMap,
  points: LngLat[],
  padding: number | PaddingOptions = 48,
) {
  if (!points.length) return;
  const bounds = points.reduce(
    (acc, point) => acc.extend(point),
    new LngLatBounds(points[0], points[0]),
  );
  map.fitBounds(bounds, { padding, duration: 0, maxZoom: 15.5 });
}
