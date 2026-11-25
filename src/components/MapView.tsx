"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { LOCATIONS, STATES, type Location } from "@/lib/locations";
import { loadBorders } from "@/lib/malaysia-borders";

const START_CENTER: [number, number] = [4.1, 102.4];
const START_ZOOM = 7;

const KIND_CODE: Record<Location["kind"], string> = {
  Hospital: "HOSP",
  "Specialist Centre": "SPEC",
  Physiotherapy: "PHYS",
};

/** Paper basemap — keyless Esri light canvas plus its label layer. */
const BASEMAP = {
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
};

/* ---------- boundary overlays ---------- */

type BorderLevel = "off" | "state" | "district" | "dun" | "parlimen";

const BORDER_OPTIONS: { id: BorderLevel; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "state", label: "State" },
  { id: "district", label: "District" },
  { id: "dun", label: "DUN" },
  { id: "parlimen", label: "Parliament" },
];

const BORDER_STYLE: Record<Exclude<BorderLevel, "off">, L.PathOptions> = {
  state: { color: "#191713", weight: 1.3, opacity: 0.55, fill: true, fillColor: "#191713", fillOpacity: 0 },
  district: { color: "#191713", weight: 0.9, opacity: 0.38, fill: true, fillColor: "#191713", fillOpacity: 0 },
  dun: { color: "#191713", weight: 0.5, opacity: 0.3, fill: true, fillColor: "#191713", fillOpacity: 0 },
  parlimen: { color: "#191713", weight: 1, opacity: 0.45, fill: true, fillColor: "#191713", fillOpacity: 0 },
};

function borderLabel(props: Record<string, unknown>) {
  return (props.dun ?? props.parlimen ?? props.name ?? "") as string;
}

function BorderChips({
  value,
  onChange,
}: {
  value: BorderLevel;
  onChange: (level: BorderLevel) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {BORDER_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          aria-pressed={value === option.id}
          className={`rounded-md border px-2 py-1 text-[10.5px] transition ${
            value === option.id
              ? "border-primary bg-primary font-medium text-primary-foreground"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- custom pin ---------- */

const PIN_SVG = `<svg class="pin-svg" viewBox="0 0 26 34" width="26" height="34" aria-hidden="true">
  <path d="M13 1C6.4 1 1 6.3 1 12.9 1 21 13 33 13 33s12-12 12-20.1C25 6.3 19.6 1 13 1Z"
    fill="#191713" stroke="rgba(255,255,255,.92)" stroke-width="1.2" />
  <circle cx="13" cy="12.6" r="3.7" fill="#ffffff" />
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
    <div className="pointer-events-auto hidden items-center gap-2.5 rounded-full border bg-card px-3 py-1.5 font-mono text-[10.5px] text-muted-foreground shadow-sm md:flex">
      <span className="tabular-nums">
        {pos ? `${fmt(pos.lat, "N", "S")}  ${fmt(pos.lng, "E", "W")}` : "— hover the map"}
      </span>
      <span className="h-3 w-px bg-border" />
      <span className="tabular-nums">z{zoom}</span>
    </div>
  );
}

/* ---------- main view ---------- */

export default function MapView() {
  const [map, setMap] = useState<L.Map | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [me, setMe] = useState<L.LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [borderLevel, setBorderLevel] = useState<BorderLevel>("state");
  const markerRefs = useRef<Record<string, L.Marker | null>>({});
  const borderLayerRef = useRef<L.GeoJSON | null>(null);

  const fitAll = useCallback((instance: L.Map) => {
    const bounds = L.latLngBounds(LOCATIONS.map((loc) => loc.coords));
    const wide = window.matchMedia("(min-width: 768px)").matches;
    instance.fitBounds(bounds, {
      paddingTopLeft: wide ? [32, 32] : [16, 124],
      paddingBottomRight: wide ? [32, 56] : [16, 64],
      maxZoom: 9,
      animate: false,
    });
  }, []);

  const handleReady = useCallback(
    (instance: L.Map) => {
      setMap(instance);
      fitAll(instance);
    },
    [fitAll],
  );

  // The map sits beside a collapsible panel, so its size changes with the window
  // and with the panel width — watch the container itself.
  useEffect(() => {
    if (!map) return;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  // Boundary overlay: swap the layer whenever the level changes.
  useEffect(() => {
    if (!map) return;
    borderLayerRef.current?.remove();
    borderLayerRef.current = null;
    if (borderLevel === "off") return;

    const style = BORDER_STYLE[borderLevel];
    let cancelled = false;

    loadBorders(borderLevel)
      .then((collection) => {
        if (cancelled) return;
        const layer = L.geoJSON(collection as unknown as GeoJSON.FeatureCollection, {
          style: () => ({ ...style }),
          onEachFeature: (feature, featureLayer) => {
            const label = borderLabel(feature.properties ?? {});
            if (label) {
              featureLayer.bindTooltip(label, {
                className: "border-tip",
                sticky: true,
                direction: "top",
                opacity: 1,
              });
            }
            const path = featureLayer as L.Path;
            featureLayer.on("mouseover", () =>
              path.setStyle({ weight: 2, opacity: 0.9, fillOpacity: 0.06 }),
            );
            featureLayer.on("mouseout", () => path.setStyle({ ...style }));
          },
        }).addTo(map);

        layer.bringToBack();
        borderLayerRef.current = layer;
      })
      .catch(() => {
        if (!cancelled) setToast("Couldn't load the boundary file.");
      });

    return () => {
      cancelled = true;
    };
  }, [map, borderLevel]);

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
    if (map) fitAll(map);
  }, [map, fitAll]);

  const locate = useCallback(() => {
    if (!map || locating) return;
    setLocating(true);
    map.locate({ enableHighAccuracy: true, timeout: 9000 });

    const onFound = (e: L.LocationEvent) => {
      setLocating(false);
      setMe(e.latlng);
      map.flyTo(e.latlng, 14, { duration: 1 });
    };
    const onError = () => {
      setLocating(false);
      setToast("Couldn't get your location — check browser permissions.");
    };

    map.once("locationfound", onFound);
    map.once("locationerror", onError);
  }, [map, locating]);

  const controlBtn =
    "grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground active:scale-95 disabled:opacity-40";

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      {/* ---------- side panel ---------- */}
      <aside
        className={`hidden shrink-0 overflow-hidden bg-card transition-[width] duration-300 ease-out md:flex md:flex-col ${
          collapsed ? "w-0" : "w-[340px] border-r"
        }`}
        aria-hidden={collapsed}
      >
        <div className="flex h-full w-[340px] shrink-0 flex-col">
          <div className="border-b px-5 pb-4 pt-5">
            <div className="flex items-start gap-2.5">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-foreground text-[11px] font-semibold text-background">
                AO
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground">
                  Asia OneHealthcare
                </p>
                <h1 className="truncate text-[15px] font-semibold leading-tight">
                  Hospital network
                </h1>
              </div>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                aria-label="Collapse panel"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 6l-6 6 6 6" />
                </svg>
              </button>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              {LOCATIONS.length} hospitals and specialist centres across {STATES.length} states.
              Pick a name to fly there.
            </p>
          </div>

          <div className="border-b px-5 py-3">
            <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              Borders
            </p>
            <BorderChips value={borderLevel} onChange={setBorderLevel} />
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2">
            {STATES.map((state) => (
              <div key={state} className="mb-1.5">
                <p className="px-2 pb-1 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                  {state}
                </p>
                <ul className="space-y-px">
                  {LOCATIONS.filter((loc) => loc.state === state).map((loc) => (
                    <li key={loc.id}>
                      <button
                        type="button"
                        onClick={() => focus(loc)}
                        className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${
                          activeId === loc.id ? "bg-secondary" : "hover:bg-secondary/60"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full transition ${
                            activeId === loc.id
                              ? "bg-foreground"
                              : "bg-border group-hover:bg-muted-foreground"
                          }`}
                        />
                        <span className="min-w-0 flex-1 truncate text-[11.5px]">{loc.name}</span>
                        <span className="shrink-0 font-mono text-[9px] uppercase text-muted-foreground">
                          {KIND_CODE[loc.kind]}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 border-t px-5 py-3 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
            <span>{LOCATIONS.length} locations</span>
            <span>Malaysia</span>
          </div>
        </div>
      </aside>

      {/* ---------- map ---------- */}
      <div className="relative flex-1">
        <MapContainer
          center={START_CENTER}
          zoom={START_ZOOM}
          zoomControl={false}
          minZoom={3}
          maxZoom={19}
          worldCopyJump
          className="absolute inset-0 h-full w-full"
          zoomSnap={0.5}
          preferCanvas
        >
          {BASEMAP.layers.map((layer) => (
            <TileLayer
              key={layer.url}
              url={layer.url}
              attribution={BASEMAP.attribution}
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
                <div className="w-[236px]">
                  <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground">
                    {loc.kind} · {loc.state}
                  </p>
                  <h3 className="mt-1 text-[15px] font-semibold leading-tight">{loc.name}</h3>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                    {loc.address}
                  </p>

                  <div className="mt-3 space-y-1 border-t pt-2.5 text-[11px]">
                    <p className="flex gap-2">
                      <span className="w-11 shrink-0 text-muted-foreground">Phone</span>
                      <a href={`tel:${loc.phone.replace(/\s/g, "")}`} className="hover:underline">
                        {loc.phone}
                      </a>
                    </p>
                    <p className="flex gap-2">
                      <span className="w-11 shrink-0 text-muted-foreground">Email</span>
                      <a
                        href={`mailto:${loc.email}`}
                        className="truncate hover:underline"
                        title={loc.email}
                      >
                        {loc.email}
                      </a>
                    </p>
                  </div>

                  <div className="mt-3 flex gap-1.5">
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${loc.coords[0]},${loc.coords[1]}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 rounded-md bg-primary px-2.5 py-2 text-center text-[11px] font-medium text-primary-foreground transition hover:bg-primary/90"
                    >
                      Directions
                    </a>
                    <a
                      href={loc.website}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border px-2.5 py-2 text-[11px] font-medium transition hover:bg-secondary"
                    >
                      Website ↗
                    </a>
                  </div>
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

        {/* reopen the panel once collapsed */}
        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Open panel"
            className="absolute left-3 top-3 z-[1000] hidden h-9 w-9 place-items-center rounded-lg border bg-card text-muted-foreground shadow-sm transition hover:bg-secondary hover:text-foreground md:grid"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        )}

        {/* compact header on small screens — the panel needs a real width */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] p-3 md:hidden">
          <div className="pointer-events-auto space-y-2 rounded-lg border bg-card px-3 py-2 shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground text-[10px] font-semibold text-background">
                AO
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold leading-tight">
                  Hospital network
                </p>
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                  {LOCATIONS.length} locations · Malaysia
                </p>
              </div>
            </div>
            <BorderChips value={borderLevel} onChange={setBorderLevel} />
          </div>
        </div>

        {/* bottom controls */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1000] flex items-end justify-between gap-3 p-3 pb-9">
          <CoordsHud map={map} />

          <div className="pointer-events-auto ml-auto flex flex-col gap-0.5 rounded-xl border bg-card p-1 shadow-sm">
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
            <span className="mx-1 my-0.5 h-px bg-border" />
            <button
              type="button"
              onClick={locate}
              disabled={locating}
              className={controlBtn}
              aria-label="Find my location"
            >
              {locating ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-foreground" />
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
              aria-label="Fit all locations"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <path d="M3 4.5V10h5.5" />
              </svg>
            </button>
          </div>
        </div>

        {toast && (
          <div className="pointer-events-none absolute inset-x-0 bottom-24 z-[1100] flex justify-center px-4">
            <p className="rounded-full border bg-card px-3.5 py-1.5 text-[11.5px] shadow-sm">
              {toast}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
