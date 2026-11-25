"use client";

import {
  COHORTS,
  MAX_COHORT_BEDS,
  MAX_COHORT_SPECIALISTS,
  type Cohort,
} from "@/lib/capacity";

function Metric({
  value,
  label,
  max,
}: {
  value: number;
  label: string;
  max: number;
}) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="mt-2.5">
      <p className="text-[17px] font-semibold leading-none tabular-nums md:text-[21px]">
        {value.toLocaleString("en-MY")}
      </p>
      <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-secondary">
        <span
          className="block h-full rounded-full bg-foreground/70"
          style={{ width: `${width}%` }}
        />
      </span>
    </div>
  );
}

export function CapacityWidget({
  cohorts = COHORTS,
  onClose,
}: {
  cohorts?: Cohort[];
  onClose: () => void;
}) {  return (
    <div className="pointer-events-auto w-full max-w-[600px] overflow-hidden rounded-xl border bg-card shadow-xl">
      <div className="flex items-start justify-between gap-3 border-b px-4 pb-2.5 pt-3">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            Capacity
          </p>
          <h2 className="mt-0.5 text-[14px] font-semibold leading-tight">
            Asia One vs the market
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close capacity widget"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-3 gap-px bg-border">
        {cohorts.map((cohort) => (
          <div
            key={cohort.key}
            className={`bg-card px-2 py-2.5 md:px-3 md:py-3 ${cohort.key === "asia-one" ? "bg-secondary/50" : ""}`}
          >
            <p className="truncate text-[9.5px] font-semibold md:text-[10.5px]">{cohort.label}</p>
            <p className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-muted-foreground">
              {cohort.sites} sites
            </p>

            <Metric value={cohort.beds} label="beds" max={MAX_COHORT_BEDS} />
            <Metric
              value={cohort.specialists}
              label="specialists"
              max={MAX_COHORT_SPECIALISTS}
            />

            <p className="mt-2 text-[8px] leading-relaxed text-muted-foreground">
              {cohort.bedsSites}/{cohort.sites} report beds · {cohort.specialistSites}/
              {cohort.sites} specialists
            </p>
          </div>
        ))}
      </div>

      <p className="border-t px-4 py-2 text-[8.5px] leading-relaxed text-muted-foreground">
        Beds: Asia One published + MOH register · private MOH licensed · public reference + KKMNOW
        wards/ICU. Specialists: NSR establishment matches; Asia One also includes published counts.
      </p>
    </div>
  );
}
