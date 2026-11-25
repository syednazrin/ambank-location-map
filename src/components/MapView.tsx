"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import { LOCATIONS, STATES, type Location } from "@/lib/locations";
import publicHospitalsGeocoded from "@/data/public-hospitals.geocoded.json";
import swastaBerlesenGeocoded from "@/data/swasta-berlesen.geocoded.json";
import kkmBedUtilisation from "@/data/kkmnow-hospital-bed-utilisation-by-facility.json";
import refPublicMalaysia from "@/data/reference/malaysia_public_hospitals.json";
import {
  ASIA_BED_RANGE,
  ASIA_SPECIALIST_RANGE,
  CAPACITY_BY_ID,
  CAPACITY_REPORTED,
  CAPACITY_TOTALS,
  numericRange,
  scaledRadius,
  SIZE_LABEL,
  SOURCE_LABEL,
  type SizeMode,
} from "@/lib/capacity";
import { mergePublicHospitalBedTotals, publicHospitalStableKey } from "@/lib/public-hospital-bed-merge";
import { CapacityWidget } from "@/components/maps/capacity-widget";
import { loadBorders } from "@/lib/malaysia-borders";
import {
  DISTRICT_CENTROID,
  DISTRICT_NAME,
  DISTRICT_POPULATION,
  DISTRICT_RADIUS_KM,
  DUN_POPULATION,
  PARLIMEN_POPULATION,
  POPULATION_YEAR,
  STATE_NAME_BY_CODE,
  STATE_POPULATION,
  districtKey,
  dunKey,
  slugKey,
  stateKey,
} from "@/lib/area-stats";

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
type Shade = "off" | "population";

const BORDER_OPTIONS: { id: BorderLevel; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "state", label: "State" },
  { id: "district", label: "District" },
  { id: "dun", label: "DUN" },
  { id: "parlimen", label: "Parliament" },
];

const BORDER_WEIGHT: Record<BorderLevel, number> = {
  off: 0,
  state: 1.2,
  district: 0.7,
  dun: 0.35,
  parlimen: 0.9,
};

const RAMP = ["#efece5", "#cfc7b8", "#a89d88", "#6f6350", "#2b241c"];

const BORDER_LABEL: Record<BorderLevel, string> = {
  off: "Off",
  state: "State",
  district: "District",
  dun: "DUN",
  parlimen: "Parliament",
};

const SHADE_LABEL: Record<Shade, string> = {
  off: "Off",
  population: "Population",
};

type ShadeData = {
  level: BorderLevel;
  min: number;
  max: number;
};

function valueFor(props: Record<string, unknown>, level: BorderLevel): number | null {
  if (level === "state") {
    return STATE_POPULATION[stateKey(String(props.name ?? ""))] ?? null;
  }
  if (level === "district") {
    const stateName = STATE_NAME_BY_CODE[String(props.state ?? "")] ?? "";
    return DISTRICT_POPULATION[districtKey(stateName, String(props.name ?? ""))] ?? null;
  }
  if (level === "parlimen") {
    return PARLIMEN_POPULATION[slugKey(String(props.parlimen ?? ""))] ?? null;
  }
  if (level === "dun") {
    return DUN_POPULATION[dunKey(String(props.state ?? ""), String(props.dun ?? ""))] ?? null;
  }
  return null;
}

function fmtValue(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1_000) return `${(value / 1000).toFixed(1)}k`;
  return `${Math.round(value)}`;
}

/** Great-circle distance in kilometres. */
function haversineKm(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Distance from a point to a district, measured to the edge of an equal-area circle
 * around the district centroid. Without this, a hospital sitting 12 km from a large
 * district's centroid but inside its boundary would score as "out of range".
 */
function districtDistanceKm(key: string, centre: [number, number], point: [number, number]) {
  const radius = DISTRICT_RADIUS_KM[key] ?? 0;
  return Math.max(0, haversineKm(centre, point) - radius);
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-secondary/40 px-2.5 py-2">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-[15px] font-semibold leading-none tabular-nums">{value}</p>
    </div>
  );
}

type Analytics = {
  stateRows: { state: string; count: number; population: number }[];
  coverageRows: { state: string; share: number }[];
  maxCount: number;
  totalPopulation: number;
  coveredShare: number;
};

type CatchmentRow = {
  loc: Location;
  served: number;
  within: number;
  contributions: { key: string; name: string; population: number }[];
};

function CatchmentWidget({
  row,
  radius,
  nearby,
  onClose,
  onFocus,
}: {
  row: CatchmentRow;
  radius: number;
  nearby: number;
  onClose: () => void;
  onFocus: () => void;
}) {
  const statePopulation = STATE_POPULATION[stateKey(row.loc.state)] ?? 0;
  const share = statePopulation ? row.served / statePopulation : 0;

  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-[1050] flex max-h-[calc(100dvh-1.5rem)] w-[460px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border bg-card shadow-xl">
      <div className="flex items-start gap-2 border-b px-4 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            {row.loc.kind} · {row.loc.state}
          </p>
          <h2 className="mt-1 text-[15px] font-semibold leading-tight">{row.loc.name}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="overflow-y-auto px-4 py-4">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            Population served · {radius} km
          </p>
          <p className="mt-1 text-[26px] font-semibold leading-none tabular-nums">
            {fmtValue(row.served)}
          </p>
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            people · {Math.round(share * 100)}% of {row.loc.state}
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Kpi label="In radius (overlapping)" value={fmtValue(row.within)} />
          <Kpi label="Other hospitals" value={nearby} />
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              Districts contributing
            </p>
            <p className="font-mono text-[9px] text-muted-foreground">
              {row.contributions.length}
            </p>
          </div>

          <div className="mt-1.5 max-h-[300px] overflow-y-auto">
            <table className="w-full border-collapse text-[10.5px]">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b">
                  <th className="py-1 pr-2 text-left font-mono text-[8.5px] font-normal uppercase tracking-[0.14em] text-muted-foreground">
                    District
                  </th>
                  <th className="px-2 py-1 text-right font-mono text-[8.5px] font-normal uppercase tracking-[0.14em] text-muted-foreground">
                    People
                  </th>
                  <th className="py-1 pl-2 text-right font-mono text-[8.5px] font-normal uppercase tracking-[0.14em] text-muted-foreground">
                    Share
                  </th>
                </tr>
              </thead>
              <tbody>
                {row.contributions.map((district) => (
                  <tr
                    key={district.key}
                    className="border-b border-border/50 last:border-0 hover:bg-secondary/50"
                  >
                    <td className="max-w-[210px] truncate py-1 pr-2">{district.name}</td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">
                      {fmtValue(district.population)}
                    </td>
                    <td className="py-1 pl-2 text-right font-mono tabular-nums text-muted-foreground">
                      {row.served ? `${Math.round((district.population / row.served) * 100)}%` : "—"}
                    </td>
                  </tr>
                ))}
                {row.contributions.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-2 text-[10.5px] text-muted-foreground">
                      No district centre falls inside this radius.
                    </td>
                  </tr>
                ) : null}
              </tbody>
              {row.contributions.length ? (
                <tfoot>
                  <tr className="border-t">
                    <td className="py-1 pr-2 font-medium">Total served</td>
                    <td className="px-2 py-1 text-right font-mono font-medium tabular-nums">
                      {fmtValue(row.served)}
                    </td>
                    <td className="py-1 pl-2 text-right font-mono tabular-nums text-muted-foreground">
                      100%
                    </td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </div>

        <p className="mt-3 text-[9.5px] leading-relaxed text-muted-foreground">
          Each district&apos;s population is split between the hospitals within {radius} km,
          weighted by distance and measured to the district&apos;s edge — so the column adds up
          and nearby sites share rather than one taking all. Straight-line approximation, not
          drive time.
        </p>

        <div className="mt-3 flex gap-1.5">
          <button
            type="button"
            onClick={onFocus}
            className="flex-1 rounded-md bg-primary px-2.5 py-2 text-[11px] font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            Show on map
          </button>
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${row.loc.coords[0]},${row.loc.coords[1]}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border px-2.5 py-2 text-[11px] font-medium transition hover:bg-secondary"
          >
            Directions ↗
          </a>
        </div>
      </div>
    </div>
  );
}

function PanelAnalytics({
  data,
  radius,
  locationCount,
  stateCount,
  rows,
  selectedId,
  onSelect,
  onFocus,
  onOpenCapacity,
}: {
  data: Analytics;
  radius: number;
  locationCount: number;
  stateCount: number;
  rows: CatchmentRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFocus: (loc: Location) => void;
  onOpenCapacity: () => void;
}) {
  const max = rows[0]?.served ?? 1;

  return (
    <div className="space-y-5 px-3 py-4">
      <div className="grid grid-cols-2 gap-2">
        <Kpi label="Locations" value={locationCount} />
        <Kpi label="States" value={stateCount} />
        <Kpi label="Population" value={fmtValue(data.totalPopulation)} />
        <Kpi label={`Within ${radius} km`} value={`${Math.round(data.coveredShare * 100)}%`} />
      </div>

      <section>
        <div className="flex items-baseline justify-between px-1">
          <h2 className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            Beds &amp; specialists
          </h2>
          <button
            type="button"
            onClick={onOpenCapacity}
            className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline"
          >
            Widget ↗
          </button>
        </div>

        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <Kpi label="Licensed beds" value={CAPACITY_TOTALS.beds.toLocaleString("en-MY")} />
          <Kpi label="Specialists" value={CAPACITY_TOTALS.specialists.toLocaleString("en-MY")} />
        </div>

        <p className="mt-1 px-1 text-[9px] leading-relaxed text-muted-foreground">
          {CAPACITY_TOTALS.bedsKnown} sites report beds · {CAPACITY_TOTALS.specialistsKnown} report
          specialists. Tap a row to fly there.
        </p>

        <table className="mt-1.5 w-full border-collapse">
          <thead>
            <tr className="border-b">
              <th className="px-1 pb-1 text-left font-mono text-[8.5px] font-normal uppercase tracking-[0.14em] text-muted-foreground">
                Hospital
              </th>
              <th className="px-1 pb-1 text-right font-mono text-[8.5px] font-normal uppercase tracking-[0.14em] text-muted-foreground">
                Beds
              </th>
              <th className="px-1 pb-1 pl-2 text-right font-mono text-[8.5px] font-normal uppercase tracking-[0.14em] text-muted-foreground">
                Spec.
              </th>
            </tr>
          </thead>
          <tbody>
            {CAPACITY_REPORTED.map((row) => (
              <tr
                key={row.loc.id}
                onClick={() => onFocus(row.loc)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onFocus(row.loc);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`Fly to ${row.loc.name}`}
                className="cursor-pointer border-b border-border/50 outline-none transition last:border-0 hover:bg-secondary/60 focus-visible:bg-secondary"
              >
                <td className="px-1 py-1.5">
                  <span className="block truncate text-[10.5px] leading-tight">{row.loc.name}</span>
                  <span className="mt-0.5 block truncate font-mono text-[8.5px] uppercase tracking-[0.08em] text-muted-foreground">
                    {row.loc.state}
                  </span>
                </td>
                <td className="px-1 py-1.5 text-right align-top">
                  <span className="block font-mono text-[10.5px] tabular-nums">
                    {row.beds ? row.beds.value.toLocaleString("en-MY") : "—"}
                  </span>
                  {row.beds ? (
                    <span className="block font-mono text-[7.5px] uppercase tracking-[0.1em] text-muted-foreground">
                      {SOURCE_LABEL[row.beds.source]}
                    </span>
                  ) : null}
                </td>
                <td className="py-1.5 pl-2 pr-1 text-right align-top">
                  <span className="block font-mono text-[10.5px] tabular-nums">
                    {row.specialists ? row.specialists.value.toLocaleString("en-MY") : "—"}
                  </span>
                  {row.specialists ? (
                    <span className="block font-mono text-[7.5px] uppercase tracking-[0.1em] text-muted-foreground">
                      {SOURCE_LABEL[row.specialists.source]}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-1.5 px-1 text-[8.5px] leading-relaxed text-muted-foreground">
          Site = brand website · MOH = licensed register · NSR = specialist register · Listed =
          doctor profiles.
        </p>
      </section>

      <section>
        <div className="flex items-baseline justify-between px-1">
          <h2 className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            Catchment by hospital
          </h2>
          <span className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-muted-foreground">
            {rows.length} sites
          </span>
        </div>
        <p className="mt-1 px-1 text-[9.5px] leading-relaxed text-muted-foreground">
          Tap a row to open its full catchment table.
        </p>
        {locationCount > rows.length ? (
          <p className="mt-0.5 px-1 text-[9px] leading-relaxed text-muted-foreground">
            {locationCount - rows.length} site outside Malaysia is excluded — DOSM population
            covers Malaysia only.
          </p>
        ) : null}

        <table className="mt-1.5 w-full border-collapse">
          <thead>
            <tr className="border-b">
              <th className="px-1 pb-1 text-left font-mono text-[8.5px] font-normal uppercase tracking-[0.14em] text-muted-foreground">
                Hospital
              </th>
              <th className="px-1 pb-1 text-right font-mono text-[8.5px] font-normal uppercase tracking-[0.14em] text-muted-foreground">
                Served
              </th>
              <th className="w-4 pb-1">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const selected = selectedId === row.loc.id;
              return (
                <tr
                  key={row.loc.id}
                  onClick={() => onSelect(row.loc.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(row.loc.id);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-expanded={selected}
                  aria-label={`Open ${row.loc.name} catchment table`}
                  title="Open catchment table"
                  className={`cursor-pointer border-b border-border/50 outline-none transition last:border-0 focus-visible:bg-secondary ${
                    selected ? "bg-secondary" : "hover:bg-secondary/60"
                  }`}
                >
                  <td className="px-1 py-1.5">
                    <span className="block truncate text-[10.5px] leading-tight">
                      {row.loc.name}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[8.5px] uppercase tracking-[0.08em] text-muted-foreground">
                      {row.loc.state}
                    </span>
                    <span className="mt-1 block h-0.5 overflow-hidden rounded-full bg-secondary">
                      <span
                        className="block h-full rounded-full bg-foreground/70"
                        style={{ width: `${Math.max(2, (row.served / max) * 100)}%` }}
                      />
                    </span>
                  </td>
                  <td className="px-1 py-1.5 text-right align-middle font-mono text-[10px] tabular-nums">
                    {fmtValue(row.served)}
                  </td>
                  <td className="pl-1 pr-0.5 text-right align-middle">
                    <svg
                      viewBox="0 0 24 24"
                      className={`ml-auto h-3 w-3 text-muted-foreground transition-transform ${
                        selected ? "rotate-90" : ""
                      }`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="px-1">
        <h2 className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
          Coverage within {radius} km
        </h2>
        <ul className="mt-2 space-y-2">
          {data.coverageRows.map((row) => (
            <li key={row.state}>
              <div className="flex items-baseline justify-between gap-2 text-[10.5px]">
                <span className="truncate">{row.state}</span>
                <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground">
                  {Math.round(row.share * 100)}%
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-foreground"
                  style={{ width: `${Math.max(2, row.share * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function borderLabel(props: Record<string, unknown>) {
  return (props.dun ?? props.parlimen ?? props.name ?? "") as string;
}

/** At street level a filled choropleth would swallow the basemap — fade its pane. */
function fadeChoropleth(map: L.Map) {
  const pane = map.getPane("choropleth");
  if (!pane) return;
  const zoom = map.getZoom();
  pane.style.transition = "opacity 200ms ease";
  pane.style.opacity = zoom >= 13 ? "0.15" : zoom >= 11 ? "0.45" : "1";
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

function ShadeChips({
  value,
  level,
  onChange,
}: {
  value: Shade;
  level: BorderLevel;
  onChange: (shade: Shade) => void;
}) {
  const options: { id: Shade; label: string }[] = [
    { id: "off", label: "Off" },
    { id: "population", label: "Population" },
  ];
  const supports = (id: Shade) => id === "off" || level !== "off";

  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => {
        const enabled = supports(option.id);
        return (
          <button
            key={option.id}
            type="button"
            disabled={!enabled}
            onClick={() => onChange(option.id)}
            aria-pressed={value === option.id}
            className={`rounded-md border px-2 py-1 text-[10.5px] transition ${
              value === option.id
                ? "border-primary bg-primary font-medium text-primary-foreground"
                : enabled
                  ? "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  : "cursor-not-allowed text-muted-foreground/40"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ShadeLegend({ data }: { data: ShadeData }) {
  return (
    <div className="mt-2">
      <div className="flex h-1.5 overflow-hidden rounded-full">
        {RAMP.map((colour) => (
          <span key={colour} className="flex-1" style={{ background: colour }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground">
        <span>{fmtValue(data.min)}</span>
        <span>{fmtValue(data.max)}</span>
      </div>
      <p className="mt-1 text-[9.5px] leading-relaxed text-muted-foreground">
        Population · {POPULATION_YEAR} · DOSM
      </p>
    </div>
  );
}

/* ---------- facility layers ---------- */

const SERIES = {
  asiaOne: { label: "Asia One", fill: "#191713" },
  public: { label: "Public · MOH", fill: "#2E6F9E" },
  private: { label: "Private · licensed", fill: "#B5713B" },
} as const;

type MapSite = {
  id: string;
  name: string;
  state: string;
  coords: [number, number];
  beds: number | null;
};

function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b[a-z]/g, (char) => char.toUpperCase());
}

const PUBLIC_BED_TOTALS = mergePublicHospitalBedTotals(
  publicHospitalsGeocoded.locations as never,
  kkmBedUtilisation as never,
  refPublicMalaysia as never,
);

const PUBLIC_SITES: MapSite[] = publicHospitalsGeocoded.locations.flatMap((row, index) =>
  typeof row.lat === "number" && typeof row.lon === "number"
    ? [
        {
          id: `pub-${index}`,
          name: row.name,
          state: row.stateTitle ?? "",
          coords: [row.lat, row.lon] as [number, number],
          beds: PUBLIC_BED_TOTALS.get(publicHospitalStableKey(row)) ?? null,
        },
      ]
    : [],
);

const PRIVATE_SITES: MapSite[] = swastaBerlesenGeocoded.hospitals.flatMap((row, index) =>
  typeof row.lat === "number" && typeof row.lon === "number"
    ? [
        {
          id: `pvt-${index}`,
          name: titleCase(String(row.NAMA_PENUH_FASILITI ?? "")),
          state: titleCase(String(row.NEGERI ?? "")),
          coords: [row.lat, row.lon] as [number, number],
          beds:
            typeof row.TOTAL_BEDS === "number" && Number.isFinite(row.TOTAL_BEDS)
              ? row.TOTAL_BEDS
              : null,
        },
      ]
    : [],
);

const PUBLIC_BED_RANGE = numericRange(PUBLIC_SITES.map((site) => site.beds));
const PRIVATE_BED_RANGE = numericRange(PRIVATE_SITES.map((site) => site.beds));

function LayerLegend({
  showAsiaOne,
  showPublic,
  showPrivate,
  onToggleAsiaOne,
  onTogglePublic,
  onTogglePrivate,
  sizeBy,
  onSizeChange,
}: {
  showAsiaOne: boolean;
  showPublic: boolean;
  showPrivate: boolean;
  onToggleAsiaOne: () => void;
  onTogglePublic: () => void;
  onTogglePrivate: () => void;
  sizeBy: SizeMode;
  onSizeChange: (mode: SizeMode) => void;
}) {
  const rows = [
    {
      key: "asia-one",
      label: SERIES.asiaOne.label,
      fill: SERIES.asiaOne.fill,
      count: LOCATIONS.length,
      on: showAsiaOne,
      toggle: onToggleAsiaOne,
      primary: true,
    },
    {
      key: "public",
      label: SERIES.public.label,
      fill: SERIES.public.fill,
      count: PUBLIC_SITES.length,
      on: showPublic,
      toggle: onTogglePublic,
      primary: false,
    },
    {
      key: "private",
      label: SERIES.private.label,
      fill: SERIES.private.fill,
      count: PRIVATE_SITES.length,
      on: showPrivate,
      toggle: onTogglePrivate,
      primary: false,
    },
  ];

  return (
    <div className="pointer-events-auto w-[178px] rounded-lg border bg-card/95 px-3 py-2.5 shadow-sm backdrop-blur">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
        Legend
      </p>

      <ul className="mt-2 space-y-0.5">
        {rows.map((row) => (
          <li key={row.key}>
            <button
              type="button"
              onClick={row.toggle}
              aria-pressed={row.on}
              className="flex w-full items-center gap-2 rounded py-0.5 text-left transition"
              title={row.on ? `Hide ${row.label}` : `Show ${row.label}`}
            >
              <span
                className={`shrink-0 rounded-full ring-2 ring-white/90 transition ${
                  row.primary ? "h-3 w-3" : "h-2.5 w-2.5 ring-1"
                } ${row.on ? "" : "opacity-30"}`}
                style={{ background: row.fill }}
              />
              <span
                className={`flex-1 text-[11px] transition ${
                  row.primary ? "font-semibold" : ""
                } ${row.on ? "text-foreground" : "text-muted-foreground line-through"}`}
              >
                {row.label}
              </span>
              <span className="font-mono text-[9px] tabular-nums text-muted-foreground">
                {row.count}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-1.5 border-t pt-1.5 text-[9px] leading-relaxed text-muted-foreground">
        Tap a row to show or hide.
      </p>

      <div className="mt-2 border-t pt-2">
        <p className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-muted-foreground">
          Bubble size
        </p>
        <div className="mt-1 grid grid-cols-3 gap-1">
          {(Object.keys(SIZE_LABEL) as SizeMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onSizeChange(mode)}
              aria-pressed={sizeBy === mode}
              title={
                mode === "none"
                  ? "Uniform dots"
                  : mode === "beds"
                    ? "Scale by licensed beds"
                    : "Scale by specialists (Asia One only)"
              }
              className={`rounded border px-1 py-1 text-[9px] font-medium transition ${
                sizeBy === mode
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {SIZE_LABEL[mode]}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[8px] leading-relaxed text-muted-foreground">
          Spec. applies to Asia One; public/private stay uniform.
        </p>
      </div>
    </div>
  );
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
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [me, setMe] = useState<L.LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [panelTab, setPanelTab] = useState<"network" | "analytics">("network");
  const [layersOpen, setLayersOpen] = useState(true);
  const [panelWidth, setPanelWidth] = useState(340);
  const [resizing, setResizing] = useState(false);
  const [catchmentOpen, setCatchmentOpen] = useState(true);
  const [showCatchment, setShowCatchment] = useState(true);
  const [showAsiaOne, setShowAsiaOne] = useState(true);
  const [showPublic, setShowPublic] = useState(true);
  const [showPrivate, setShowPrivate] = useState(true);
  const [sizeBy, setSizeBy] = useState<SizeMode>("beds");
  const [capacityOpen, setCapacityOpen] = useState(true);
  const [catchmentKm, setCatchmentKm] = useState(10);
  const [selectedHospitalId, setSelectedHospitalId] = useState<string | null>(null);
  const [borderLevel, setBorderLevel] = useState<BorderLevel>("parlimen");
  const [shade, setShade] = useState<Shade>("population");
  const [shadeData, setShadeData] = useState<ShadeData | null>(null);
  const markerRefs = useRef<Record<string, L.CircleMarker | null>>({});
  const borderLayerRef = useRef<L.GeoJSON | null>(null);

  const fitAll = useCallback((instance: L.Map) => {
    // The Bình Dương site sits in Vietnam; fitting all 32 sites would drag the
    // camera across the South China Sea.
    const local = LOCATIONS.filter((loc) => loc.country === "Malaysia");
    const bounds = L.latLngBounds(local.map((loc) => loc.coords));
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

  // Drag the panel's right edge to widen it.
  useEffect(() => {
    if (!resizing) return;
    const onMove = (event: PointerEvent) => {
      setPanelWidth(Math.min(640, Math.max(280, Math.round(event.clientX))));
    };
    const onUp = () => setResizing(false);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    const previousSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = previousSelect;
      document.body.style.cursor = previousCursor;
    };
  }, [resizing]);

  // Catchment circles: a straight-line radius around every location.
  useEffect(() => {
    if (!map || !showCatchment || !showAsiaOne) return;

    const radius = catchmentKm * 1000;
    if (!map.getPane("catchment")) {
      const pane = map.createPane("catchment");
      pane.style.zIndex = "390";
      pane.style.pointerEvents = "none";
    }
    const group = L.layerGroup().addTo(map);
    for (const loc of LOCATIONS) {
      L.circle(loc.coords, {
        radius,
        pane: "catchment",
        color: "#191713",
        weight: 1.2,
        opacity: 0.6,
        dashArray: "3 4",
        fill: true,
        fillColor: "#191713",
        fillOpacity: 0.03,
        interactive: false,
      }).addTo(group);
    }

    return () => {
      group.remove();
    };
  }, [map, showCatchment, showAsiaOne, catchmentKm]);

  // Fade the choropleth pane at street level, without touching the markers,
  // popups or catchment circles (which live in their own panes).
  useEffect(() => {
    if (!map) return;
    const apply = () => fadeChoropleth(map);
    map.on("zoomend", apply);
    apply();
    return () => {
      map.off("zoomend", apply);
    };
  }, [map]);

  // Boundary overlay + choropleth for the selected level.
  useEffect(() => {
    if (!map) return;
    borderLayerRef.current?.remove();
    borderLayerRef.current = null;
    if (borderLevel === "off") return;

    const level = borderLevel;
    const shaded = shade === "population";
    let cancelled = false;

    loadBorders(level)
      .then((collection) => {
        if (cancelled) return;
        const geo = collection as unknown as GeoJSON.FeatureCollection;

        const values = geo.features
          .map((feature) => (shaded ? valueFor(feature.properties ?? {}, level) : null))
          .filter((value): value is number => value != null)
          .sort((a, b) => a - b);

        const breaks = values.length
          ? [0.2, 0.4, 0.6, 0.8].map(
              (q) => values[Math.min(values.length - 1, Math.floor(q * values.length))],
            )
          : [];

        const colourOf = (value: number | null) => {
          if (value == null || !breaks.length) return null;
          const index = breaks.reduce((acc, brk) => acc + (value > brk ? 1 : 0), 0);
          return RAMP[Math.min(index, RAMP.length - 1)];
        };

        const baseWeight = BORDER_WEIGHT[level];

        if (!map.getPane("choropleth")) {
          const pane = map.createPane("choropleth");
          pane.style.zIndex = "350";
        }

        const layer = L.geoJSON(geo, {
          pane: "choropleth",
          style: (feature) => {
            const value = feature && shaded ? valueFor(feature.properties ?? {}, level) : null;
            const fill = colourOf(value);
            return fill
              ? {
                  color: "#ffffff",
                  weight: 0.6,
                  opacity: 0.9,
                  fill: true,
                  fillColor: fill,
                  fillOpacity: 0.9,
                }
              : { color: "#191713", weight: baseWeight, opacity: 0.4, fill: false };
          },
          onEachFeature: (feature, featureLayer) => {
            const props = feature.properties ?? {};
            const label = borderLabel(props);
            const value = shaded ? valueFor(props, level) : null;
            const fill = colourOf(value);

            if (label) {
              featureLayer.bindTooltip(
                value != null ? `${label} · ${fmtValue(value)}` : label,
                { className: "border-tip", sticky: true, direction: "top", opacity: 1 },
              );
            }

            const path = featureLayer as L.Path;
            featureLayer.on("mouseover", () =>
              path.setStyle({ weight: 1.6, opacity: 1, fillOpacity: fill ? 1 : 0 }),
            );
            featureLayer.on("mouseout", () =>
              path.setStyle({
                weight: fill ? 0.6 : baseWeight,
                opacity: fill ? 0.9 : 0.4,
                fillOpacity: fill ? 0.9 : 0,
              }),
            );
          },
        }).addTo(map);

        borderLayerRef.current = layer;
        fadeChoropleth(map);

        if (shaded && values.length) {
          setShadeData({
            level,
            min: values[0],
            max: values[values.length - 1],
          });
        }
      })
      .catch(() => {
        if (!cancelled) setToast("Couldn't load the boundary file.");
      });

    return () => {
      cancelled = true;
    };
  }, [map, borderLevel, shade]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const focus = useCallback(
    (loc: Location) => {
      setActiveId(loc.id);
      // Reveal the Asia One layer if the user hid it, then open the popup once the
      // marker is mounted and attached to the map.
      setShowAsiaOne(true);
      if (map) map.flyTo(loc.coords, Math.max(map.getZoom(), 15), { duration: 0.9 });

      let tries = 0;
      const openWhenReady = () => {
        const marker = markerRefs.current[loc.id];
        if (marker) {
          marker.openPopup();
          if (marker.isPopupOpen()) return;
        }
        if (tries++ < 10) window.setTimeout(openWhenReady, 60);
      };
      window.setTimeout(openWhenReady, 0);
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

  const changeBorders = (level: BorderLevel) => {
    setBorderLevel(level);
    setShade(level === "off" ? "off" : "population");
  };

  const shadeView = shadeData && shadeData.level === borderLevel && shade === "population" ? shadeData : null;

  // Population each hospital serves at the current radius. A district's population is
  // split between every hospital within reach, weighted by distance, so the numbers add
  // up across sites instead of double-counting — and no site shows zero just because a
  // neighbour is a few hundred metres closer.
  const hospitalCatchment = useMemo<CatchmentRow[]>(() => {
    const districts = Object.entries(DISTRICT_POPULATION)
      .map(([key, population]) => {
        const centre = DISTRICT_CENTROID[key];
        if (!centre) return null;
        return { key, centre, population };
      })
      .filter((district): district is NonNullable<typeof district> => district !== null);

    const sites = LOCATIONS.filter((loc) => loc.country === "Malaysia");
    const buckets = new Map<string, CatchmentRow>(
      sites.map((loc) => [loc.id, { loc, served: 0, within: 0, contributions: [] }]),
    );

    for (const district of districts) {
      const reachable = sites.map((loc) => ({
        loc,
        distance: districtDistanceKm(district.key, district.centre, loc.coords),
      })).filter((entry) => entry.distance <= catchmentKm);

      if (!reachable.length) continue;

      // Inverse-square weighting, softened so two sites in the same building still split.
      const weights = reachable.map((entry) => 1 / (entry.distance ** 2 + 0.25));
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

      reachable.forEach((entry, index) => {
        const bucket = buckets.get(entry.loc.id)!;
        const share = district.population * (weights[index] / totalWeight);
        bucket.within += district.population;
        bucket.served += share;
        bucket.contributions.push({
          key: district.key,
          name: DISTRICT_NAME[district.key] ?? district.key,
          population: share,
        });
      });
    }

    return [...buckets.values()]
      .map((row) => ({
        ...row,
        contributions: row.contributions.sort((a, b) => b.population - a.population),
      }))
      .sort((a, b) => b.served - a.served || b.within - a.within);
  }, [catchmentKm]);

  const selectedRow = selectedHospitalId
    ? hospitalCatchment.find((row) => row.loc.id === selectedHospitalId) ?? null
    : null;

  const analytics = useMemo(() => {
    const byState = new Map<string, number>();
    for (const loc of LOCATIONS) byState.set(loc.state, (byState.get(loc.state) ?? 0) + 1);

    const stateRows = [...byState.entries()]
      .map(([state, count]) => ({
        state,
        count,
        population: STATE_POPULATION[stateKey(state)] ?? 0,
      }))
      .sort((a, b) => b.count - a.count || b.population - a.population);

    const coverage = new Map<string, { covered: number; total: number }>();
    let total = 0;
    let covered = 0;

    for (const [key, population] of Object.entries(DISTRICT_POPULATION)) {
      const centre = DISTRICT_CENTROID[key];
      if (!centre) continue;
      const [stateSlug] = key.split("|");
      const entry = coverage.get(stateSlug) ?? { covered: 0, total: 0 };
      entry.total += population;
      total += population;

      const reachable = LOCATIONS.some(
        (loc) => districtDistanceKm(key, centre, loc.coords) <= catchmentKm,
      );
      if (reachable) {
        entry.covered += population;
        covered += population;
      }
      coverage.set(stateSlug, entry);
    }

    const coverageRows = stateRows
      .filter((row) => coverage.has(stateKey(row.state)))
      .map((row) => {
        const entry = coverage.get(stateKey(row.state));
        return {
          state: row.state,
          share: entry && entry.total ? entry.covered / entry.total : 0,
        };
      })
      .sort((a, b) => a.share - b.share);

    return {
      stateRows,
      coverageRows,
      maxCount: stateRows[0]?.count ?? 1,
      totalPopulation: total,
      coveredShare: total ? covered / total : 0,
    };
  }, [catchmentKm]);

  const controlBtn =
    "grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground active:scale-95 disabled:opacity-40";

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      {/* ---------- side panel ---------- */}
      <aside
        className={`relative hidden shrink-0 overflow-hidden bg-card md:flex md:flex-col ${
          collapsed ? "w-0" : "border-r"
        } ${resizing ? "" : "transition-[width] duration-300 ease-out"}`}
        style={{ width: collapsed ? 0 : panelWidth }}
        aria-hidden={collapsed}
      >
        <div className="flex h-full shrink-0 flex-col" style={{ width: panelWidth }}>
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
                  {panelTab === "network" ? "Hospital network" : "Analysis"}
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
              {panelTab === "network"
                ? `${LOCATIONS.length} hospitals and specialist centres across ${STATES.length} states. Pick a name to fly there.`
                : `Where the network is dense, where it is thin, and how much population sits within reach.`}
            </p>

            <div className="mt-3 flex rounded-lg bg-secondary p-0.5">
              {(
                [
                  { id: "network", label: "Network" },
                  { id: "analytics", label: "Analytics" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPanelTab(tab.id)}
                  aria-pressed={panelTab === tab.id}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[11px] transition ${
                    panelTab === tab.id
                      ? "bg-card font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-b px-5 py-3">
            <button
              type="button"
              onClick={() => setLayersOpen((open) => !open)}
              aria-expanded={layersOpen}
              aria-controls="border-controls"
              className="flex w-full items-center justify-between gap-2"
            >
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                Borders
              </span>
              <span className="flex items-center gap-1.5">
                {!layersOpen ? (
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                    {BORDER_LABEL[borderLevel]}
                    {shade !== "off" ? ` · ${SHADE_LABEL[shade]}` : ""}
                  </span>
                ) : null}
                <svg
                  viewBox="0 0 24 24"
                  className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                    layersOpen ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </button>

            {layersOpen ? (
              <div id="border-controls" className="mt-2.5 space-y-3">
                <BorderChips value={borderLevel} onChange={changeBorders} />

                <div>
                  <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                    Shade by
                  </p>
                  <ShadeChips value={shade} level={borderLevel} onChange={setShade} />
                  {shadeView ? <ShadeLegend data={shadeView} /> : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-b px-5 py-3">
            <button
              type="button"
              onClick={() => setCatchmentOpen((open) => !open)}
              aria-expanded={catchmentOpen}
              aria-controls="catchment-controls"
              className="flex w-full items-center justify-between gap-2"
            >
              <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                Catchment
              </span>
              <span className="flex items-center gap-1.5">
                {!catchmentOpen ? (
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                    {showCatchment ? `${catchmentKm} km` : "Off"}
                  </span>
                ) : null}
                <svg
                  viewBox="0 0 24 24"
                  className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                    catchmentOpen ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </button>

            {catchmentOpen ? (
              <div id="catchment-controls" className="mt-2.5 space-y-2.5">
                <div className="flex flex-wrap gap-1">
                  {[
                    { id: false, label: "Off" },
                    { id: true, label: "On" },
                  ].map((option) => (
                    <button
                      key={String(option.id)}
                      type="button"
                      onClick={() => setShowCatchment(option.id)}
                      aria-pressed={showCatchment === option.id}
                      className={`rounded-md border px-2 py-1 text-[10.5px] transition ${
                        showCatchment === option.id
                          ? "border-primary bg-primary font-medium text-primary-foreground"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <div className={showCatchment ? "" : "opacity-45"}>
                  <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                    <span>Radius</span>
                    <span>{catchmentKm} km</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={30}
                    step={1}
                    value={catchmentKm}
                    disabled={!showCatchment}
                    onChange={(event) => setCatchmentKm(Number(event.target.value))}
                    aria-label="Catchment radius in kilometres"
                    className="mt-1.5 w-full accent-foreground"
                  />
                </div>

                <p className="text-[9.5px] leading-relaxed text-muted-foreground">
                  Straight-line radius around each point — not drive time.
                </p>
              </div>
            ) : null}
          </div>

          {panelTab === "network" ? (
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
                          {loc.precision !== "exact" ? (
                            <span
                              title={`${loc.precision} pin${loc.precisionNote ? ` — ${loc.precisionNote}` : ""}`}
                              className="shrink-0 font-mono text-[9px] text-muted-foreground"
                            >
                              ≈
                            </span>
                          ) : null}
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
          ) : (
            <div className="flex-1 overflow-y-auto">
              <PanelAnalytics
                data={analytics}
                radius={catchmentKm}
                locationCount={LOCATIONS.length}
                stateCount={analytics.stateRows.length}
                rows={hospitalCatchment}
                selectedId={selectedHospitalId}
                onSelect={(id) =>
                  setSelectedHospitalId((current) => (current === id ? null : id))
                }
                onFocus={focus}
                onOpenCapacity={() => setCapacityOpen(true)}
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t px-5 py-3 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
            <span>{LOCATIONS.length} locations</span>
            <span>Malaysia</span>
          </div>
        </div>

        {!collapsed ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            title="Drag to resize"
            onPointerDown={(event) => {
              event.preventDefault();
              setResizing(true);
            }}
            onDoubleClick={() => setPanelWidth(340)}
            className="absolute right-0 top-0 z-20 h-full w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-border"
          />
        ) : null}
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

          {showPublic
            ? PUBLIC_SITES.map((site) => {
                const radius =
                  sizeBy === "beds"
                    ? scaledRadius(site.beds, PUBLIC_BED_RANGE, 4.5, 4, 11)
                    : 4.5;
                return (
                  <CircleMarker
                    key={site.id}
                    center={site.coords}
                    radius={radius}
                    pathOptions={{
                      color: "#ffffff",
                      weight: 1,
                      opacity: 0.85,
                      fillColor: SERIES.public.fill,
                      fillOpacity: 0.9,
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -4]} opacity={1}>
                      {`${site.name} · ${site.state}${site.beds != null ? ` · ${site.beds} beds` : ""}`}
                    </Tooltip>
                  </CircleMarker>
                );
              })
            : null}

          {showPrivate
            ? PRIVATE_SITES.map((site) => {
                const radius =
                  sizeBy === "beds"
                    ? scaledRadius(site.beds, PRIVATE_BED_RANGE, 4.5, 4, 11)
                    : 4.5;
                return (
                  <CircleMarker
                    key={site.id}
                    center={site.coords}
                    radius={radius}
                    pathOptions={{
                      color: "#ffffff",
                      weight: 1,
                      opacity: 0.85,
                      fillColor: SERIES.private.fill,
                      fillOpacity: 0.9,
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -4]} opacity={1}>
                      {`${site.name} · ${site.state}${site.beds != null ? ` · ${site.beds} beds` : ""}`}
                    </Tooltip>
                  </CircleMarker>
                );
              })
            : null}

          {showAsiaOne
            ? LOCATIONS.map((loc) => {
            const active = activeId === loc.id;
            const hovered = hoverId === loc.id;
            const capacity = CAPACITY_BY_ID.get(loc.id);
            const base =
              sizeBy === "beds"
                ? scaledRadius(capacity?.beds?.value ?? null, ASIA_BED_RANGE, 5.5, 4.5, 13)
                : sizeBy === "specialists"
                  ? scaledRadius(
                      capacity?.specialists?.value ?? null,
                      ASIA_SPECIALIST_RANGE,
                      5.5,
                      4.5,
                      13,
                    )
                  : 6;
            const radius = active ? Math.max(base + 2.5, 9) : hovered ? base + 1 : base;
            return (
              <CircleMarker
                key={loc.id}
                center={loc.coords}
                radius={radius}
                pathOptions={{
                  color: "#ffffff",
                  weight: active ? 2.5 : 1.5,
                  opacity: 0.95,
                  fillColor: "#191713",
                  fillOpacity: 1,
                }}
                ref={(instance) => {
                  markerRefs.current[loc.id] = instance;
                }}
                eventHandlers={{
                  click: () => setActiveId(loc.id),
                  mouseover: () => setHoverId(loc.id),
                  mouseout: () => setHoverId((id) => (id === loc.id ? null : id)),
                }}
              >
                <Popup className="loc-popup" closeButton={false} offset={[0, -8]}>
                  <div>
                    <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground">
                      {loc.kind} · {loc.state}
                    </p>
                    <h3 className="mt-1 text-[15px] font-semibold leading-tight">{loc.name}</h3>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                      {loc.address}
                    </p>

                    {capacity && (capacity.beds || capacity.specialists) ? (
                      <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground">
                        {capacity.beds ? (
                          <span>
                            <span className="text-[11px] font-semibold text-foreground">
                              {capacity.beds.value.toLocaleString("en-MY")}
                            </span>{" "}
                            beds · {SOURCE_LABEL[capacity.beds.source]}
                          </span>
                        ) : null}
                        {capacity.specialists ? (
                          <span>
                            <span className="text-[11px] font-semibold text-foreground">
                              {capacity.specialists.value.toLocaleString("en-MY")}
                            </span>{" "}
                            specialists · {SOURCE_LABEL[capacity.specialists.source]}
                          </span>
                        ) : null}
                      </p>
                    ) : null}

                    {loc.precision !== "exact" ? (
                      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                        <span className="font-mono uppercase tracking-[0.08em]">
                          {loc.precision} pin
                        </span>
                        {loc.precisionNote ? ` — ${loc.precisionNote}` : ""}
                      </p>
                    ) : null}

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
                        className="popup-cta flex-1 rounded-md bg-primary px-2.5 py-2 text-center text-[11px] font-medium text-primary-foreground transition hover:bg-primary/90"
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
              </CircleMarker>
            );
          })
            : null}

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

        {/* legend */}
        <div className="pointer-events-none absolute right-3 top-3 z-[1000] hidden md:block">
          <LayerLegend
            showAsiaOne={showAsiaOne}
            showPublic={showPublic}
            showPrivate={showPrivate}
            onToggleAsiaOne={() => setShowAsiaOne((value) => !value)}
            onTogglePublic={() => setShowPublic((value) => !value)}
            onTogglePrivate={() => setShowPrivate((value) => !value)}
            sizeBy={sizeBy}
            onSizeChange={setSizeBy}
          />
        </div>

        {/* catchment detail widget */}
        {selectedRow ? (
          <CatchmentWidget
            row={selectedRow}
            radius={catchmentKm}
            nearby={
              LOCATIONS.filter(
                (other) =>
                  other.id !== selectedRow.loc.id &&
                  haversineKm(other.coords, selectedRow.loc.coords) <= catchmentKm,
              ).length
            }
            onClose={() => setSelectedHospitalId(null)}
            onFocus={() => focus(selectedRow.loc)}
          />
        ) : null}

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
            <button
              type="button"
              onClick={() => setLayersOpen((open) => !open)}
              aria-expanded={layersOpen}
              className="flex w-full items-center justify-between gap-2"
            >
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                Borders · {BORDER_LABEL[borderLevel]}
              </span>
              <svg
                viewBox="0 0 24 24"
                className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                  layersOpen ? "rotate-180" : ""
                }`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {layersOpen ? <BorderChips value={borderLevel} onChange={changeBorders} /> : null}
            {layersOpen && shadeView ? (
              <div className="flex items-center gap-2">
                <div className="flex h-1.5 flex-1 overflow-hidden rounded-full">
                  {RAMP.map((colour) => (
                    <span key={colour} className="flex-1" style={{ background: colour }} />
                  ))}
                </div>
                <span className="font-mono text-[9px] text-muted-foreground">
                  {fmtValue(shadeView.min)}–{fmtValue(shadeView.max)}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* capacity widget */}
        {capacityOpen ? (
          <div className="pointer-events-none absolute inset-x-2 bottom-4 z-[1040] md:inset-x-auto md:bottom-20 md:left-3 md:w-[600px]">
            <CapacityWidget onClose={() => setCapacityOpen(false)} />
          </div>
        ) : null}

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
              onClick={() => setCapacityOpen((open) => !open)}
              className={controlBtn}
              aria-label="Capacity widget"
              aria-pressed={capacityOpen}
              title="Beds & specialists vs market"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M5 20v-7M12 20V5M19 20v-4" />
              </svg>
            </button>
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
