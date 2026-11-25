"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import { LOCATIONS, type Location } from "@/lib/locations";

const CENTER: [number, number] = [3.139, 101.6869];
const START_ZOOM = 12;

const TYPE_CODE: Record<Location["type"], string> = {
  "Head Office": "HQ",
  Branch: "BR",
  "Business Centre": "BC",
  ATM: "ATM",
};

const BASEMAPS = {
  midnight: {
    label: "Midnight",
    swatch: "#1a1d22",
    layers: [
      {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        maxNativeZoom: 16,
      },
      {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
        maxNativeZoom: 16,
      },
    ],
    attribution:
      'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
  },
  paper: {
    label: "Paper",
    swatch: "#eceae5",
    layers: [
      {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        maxNativeZoom: 16,
      },
      {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
        maxNativeZoom: 16,
      },
    ],
    attribution:
      'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
  },
  streets: {
    label: "Streets",
    swatch: "#e8dfc9",
    layers: [
      {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
        maxNativeZoom: 19,
      },
    ],
    attribution:
      'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
  },
} as const;

type BasemapKey = keyof typeof BASEMAPS;

/* ---------- custom pin ---------- */

const PIN_SVG = `<svg class="pin-svg" viewBox="0 0 26 34" width="26" height="34" aria-hidden="true">
  <path d="M13 1C6.4 1 1 6.3 1 12.9 1 21 13 33 13 33s12-12 12-20.1C25 6.3 19.6 1 13 1Z"
    fill="#e9a63d" stroke="rgba(255,255,255,.55)" stroke-width="1.1" />
  <path d="M13 1C6.4 1 1 6.3 1 12.9 1 15.9 2.6 19.4 5 23c2.4-6.9 7.7-11.4 7.7-11.4S18.7 7 13 1Z"
    fill="rgba(255,255,255,.22)" />
  <circle cx="13" cy="12.6" r="4" fill="#17130d" />
</svg>`;

const iconCache = new Map<string, L.DivIcon>();

function pinIcon(active: boolean) {
  const key = active ? "active" : "idle";
  let icon = iconCache.get(key);
  if (!icon) {
    icon = L.divIcon({
      className: `pin-root${active ? " is-active" : ""}`,
      html: PIN_SVG,
      iconSize: [26, 34],
      iconAnchor: [13, 33],
      popupAnchor: [0, -29],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

/* ---------- helpers bound to the map instance ---------- */

function MapBridge({ onReady }: { onReady: (map: L.Map) => void }) {
  const map = useMap();
  useEffect(() => {
    onReady(map);
  }, [map, onReady]);
  return null;
}

function CoordsHud({ map }: { map: L.Map | null }) {
  const [pos, setPos] = useState<L.LatLng | null>(null);
  const [zoom, setZoom] = useState(START_ZOOM);
  const last = useRef(0);

  useEffect(() => {
    if (!map) return;

    const onMove = (event: L.LeafletMouseEvent) => {
      const now = performance.now();
      if (now - last.current < 70) return;
      last.current = now;
      setPos(event.latlng);
    };
    const onZoom = () => setZoom(map.getZoom());
    const onMoveEnd = () => setPos(null);

    map.on("mousemove", onMove);
    map.on("zoomend", onZoom);
    map.on("moveend", onMoveEnd);

    return () => {
      map.off("mousemove", onMove);
      map.off("zoomend", onZoom);
      map.off("moveend", onMoveEnd);
    };
  }, [map]);

  const fmt = (v: number, posLabel: string, negLabel: string) =>
    `${Math.abs(v).toFixed(4)}°${v >= 0 ? posLabel : negLabel}`;

  return (
    <div className="pointer-events-auto hidden items-center gap-2.5 rounded-full border border-white/10 bg-[#0e0e11]/85 px-3.5 py-2 font-mono text-[11px] tracking-tight text-stone-300 backdrop-blur-xl md:flex">
      <span className="tabular-nums">
        {pos ? `${fmt(pos.lat, "N", "S")}  ${fmt(pos.lng, "E", "W")}` : "— hover the map"}
      </span>
      <span className="h-3 w-px bg-white/15" />
      <span className="tabular-nums text-amber-200/80">z{zoom}</span>
    </div>
  );
}

/* ---------- main view ---------- */

export default function MapView() {
  const [map, setMap] = useState<L.Map | null>(null);
  const [basemap, setBasemap] = useState<BasemapKey>("midnight");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [me, setMe] = useState<L.LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const markerRefs = useRef<Record<string, L.Marker | null>>({});

  const handleReady = useCallback((instance: L.Map) => setMap(instance), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const focus = useCallback(
    (loc: Location) => {
      setActiveId(loc.id);
      if (!map) return;
      map.flyTo(loc.coords, Math.max(map.getZoom(), 15), { duration: 0.9 });
      markerRefs.current[loc.id]?.openPopup();
    },
    [map],
  );

  const resetView = useCallback(() => {
    setActiveId(null);
    map?.closePopup();
    map?.flyTo(CENTER, START_ZOOM, { duration: 0.8 });
  }, [map]);

  const locate = useCallback(() => {
    if (!map || locating) return;
    setLocating(true);
    map.locate({ enableHighAccuracy: true, timeout: 9000 });

    const onFound = (e: L.LocationEvent) => {
      setLocating(false);
      setMe(e.latlng);
      map.flyTo(e.latlng, 15, { duration: 1 });
    };
    const onError = () => {
      setLocating(false);
      setToast("Couldn't get your location — check browser permissions.");
    };

    map.once("locationfound", onFound);
    map.once("locationerror", onError);
  }, [map, locating]);

  const current = useMemo(
    () => BASEMAPS[basemap],
    [basemap],
  );

  const controlBtn =
    "grid h-9 w-9 place-items-center rounded-lg text-stone-300 transition hover:bg-white/10 hover:text-white active:scale-95 disabled:opacity-40";

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#0b0b0d]">
      <MapContainer
        center={CENTER}
        zoom={START_ZOOM}
        zoomControl={false}
        minZoom={3}
        maxZoom={19}
        worldCopyJump
        className="absolute inset-0 h-full w-full"
        zoomSnap={0.5}
        preferCanvas
      >
        {current.layers.map((layer) => (
          <TileLayer
            key={`${basemap}-${layer.url}`}
            url={layer.url}
            attribution={current.attribution}
            maxZoom={19}
            maxNativeZoom={layer.maxNativeZoom}
          />
        ))}

        <MapBridge onReady={handleReady} />

        {LOCATIONS.map((loc) => (
          <Marker
            key={loc.id}
            position={loc.coords}
            icon={pinIcon(activeId === loc.id)}
            ref={(instance) => {
              markerRefs.current[loc.id] = instance;
            }}
            eventHandlers={{ click: () => setActiveId(loc.id) }}
          >
            <Popup className="loc-popup" closeButton={false} offset={[0, -4]}>
              <div className="w-[228px]">
                <p className="text-[9.5px] font-medium uppercase tracking-[0.2em] text-amber-300/80">
                  {loc.type}
                </p>
                <h3 className="mt-1.5 text-[15px] font-semibold leading-tight text-stone-50">
                  {loc.name}
                </h3>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-stone-400">
                  {loc.address}
                </p>

                <div className="mt-3 space-y-1 border-t border-white/10 pt-2.5 text-[11px] text-stone-400">
                  <p className="flex items-center gap-2">
                    <span className="text-stone-500">Hours</span>
                    <span className="text-stone-300">{loc.hours}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="text-stone-500">Phone</span>
                    <span className="text-stone-300">{loc.phone}</span>
                  </p>
                </div>

                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${loc.coords[0]},${loc.coords[1]}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-amber-300/90 px-3 py-2 text-[11.5px] font-semibold text-stone-900 transition hover:bg-amber-200"
                >
                  Get directions
                  <span aria-hidden>↗</span>
                </a>
              </div>
            </Popup>
          </Marker>
        ))}

        {me && (
          <Marker
            position={me}
            icon={L.divIcon({
              className: "pin-root",
              html: '<span class="me-dot"><span class="me-dot__pulse"></span></span>',
              iconSize: [18, 18],
              iconAnchor: [9, 9],
            })}
          />
        )}
      </MapContainer>

      {/* ---------- overlays ---------- */}
      <div className="pointer-events-none absolute inset-0 z-[1000] flex flex-col justify-between p-4 pb-10 sm:p-6 sm:pb-9">
        <div className="flex items-start justify-between gap-4">
          <header className="pointer-events-auto w-[15.5rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/10 bg-[#0e0e11]/90 p-4 shadow-[0_30px_70px_-30px_rgba(0,0,0,0.95)] backdrop-blur-xl sm:w-[16.5rem]">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-amber-200 to-amber-500 text-[12px] font-bold text-stone-900">
                AB
              </div>
              <div className="min-w-0">
                <p className="text-[9.5px] font-medium uppercase tracking-[0.22em] text-amber-200/70">
                  AmBank
                </p>
                <h1 className="truncate text-[15px] font-semibold text-stone-50">
                  Location Explorer
                </h1>
              </div>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-stone-400">
              Drag to pan, scroll to zoom, pick a spot below to fly there.
            </p>

            <ul className="-mx-1 mt-3 max-h-[34vh] space-y-0.5 overflow-y-auto">
              {LOCATIONS.map((loc) => (
                <li key={loc.id}>
                  <button
                    type="button"
                    onClick={() => focus(loc)}
                    className={`group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
                      activeId === loc.id
                        ? "bg-white/10"
                        : "hover:bg-white/[0.06]"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full transition ${
                        activeId === loc.id
                          ? "bg-amber-300"
                          : "bg-stone-500 group-hover:bg-amber-300/70"
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-stone-300 group-hover:text-stone-100">
                      {loc.name}
                    </span>
                    <span className="shrink-0 text-[9.5px] uppercase tracking-wider text-stone-500">
                      {TYPE_CODE[loc.type]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </header>

          <div className="pointer-events-auto space-y-2">
            <div className="rounded-xl border border-white/10 bg-[#0e0e11]/90 p-1.5 backdrop-blur-xl">
              {(Object.keys(BASEMAPS) as BasemapKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setBasemap(key)}
                  aria-pressed={basemap === key}
                  title={BASEMAPS[key].label}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] transition ${
                    basemap === key
                      ? "bg-white/12 text-stone-50"
                      : "text-stone-400 hover:bg-white/[0.07] hover:text-stone-200"
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/25"
                    style={{ background: BASEMAPS[key].swatch }}
                  />
                  <span className="hidden sm:inline">{BASEMAPS[key].label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-end justify-between gap-3">
          <CoordsHud map={map} />

          <div className="pointer-events-auto ml-auto flex flex-col gap-1 rounded-xl border border-white/10 bg-[#0e0e11]/90 p-1.5 backdrop-blur-xl">
            <button
              type="button"
              onClick={() => map?.zoomIn()}
              className={controlBtn}
              aria-label="Zoom in"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => map?.zoomOut()}
              className={controlBtn}
              aria-label="Zoom out"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 12h14" />
              </svg>
            </button>
            <span className="mx-1 h-px bg-white/10" />
            <button
              type="button"
              onClick={locate}
              disabled={locating}
              className={controlBtn}
              aria-label="Find my location"
            >
              {locating ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/25 border-t-amber-300" />
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3.2" />
                  <circle cx="12" cy="12" r="8.2" />
                  <path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={resetView}
              className={controlBtn}
              aria-label="Reset view"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <path d="M3 4.5V10h5.5" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-[1100] flex justify-center px-4">
          <p className="rounded-full border border-white/10 bg-black/70 px-4 py-2 text-[11.5px] text-stone-200 shadow-2xl backdrop-blur-xl">
            {toast}
          </p>
        </div>
      )}
    </div>
  );
}
