"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";
import { DeliveryTrackerCard } from "./delivery-tracker-card";
import type { LngLat } from "./map-kit";
import {
  DELIVERY_DESTINATION,
  DELIVERY_DRIVER,
  DELIVERY_ORDER_ID,
  DELIVERY_ORIGIN,
  DELIVERY_ROUTE,
  DELIVERY_ROUTE_MINUTES,
  DELIVERY_STEPS,
} from "@/lib/delivery-demo";

const TICK_MS = 300;
const STEP_SIZE = 0.0092;

/** Linear interpolation along the polyline, t ∈ [0, 1]. */
function pointAt(route: LngLat[], t: number): LngLat {
  const clamped = Math.min(1, Math.max(0, t));
  const exact = clamped * (route.length - 1);
  const index = Math.min(route.length - 2, Math.floor(exact));
  const fraction = exact - index;
  const [ax, ay] = route[index];
  const [bx, by] = route[index + 1];
  return [ax + (bx - ax) * fraction, ay + (by - ay) * fraction];
}

function stepForProgress(progress: number) {
  if (progress < 0.06) return "packed";
  if (progress < 0.26) return "picked-up";
  if (progress < 0.86) return "on-the-way";
  if (progress < 1) return "arriving";
  return "delivered";
}

export function DeliveryDemo() {
  const [progress, setProgress] = React.useState(0.02);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    const id = setInterval(() => {
      setProgress((current) => Math.min(1, current + STEP_SIZE));
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Hold on "Delivered" for a moment, then run it again.
  React.useEffect(() => {
    if (progress < 1) return;
    const id = setTimeout(() => setProgress(0.02), 4200);
    return () => clearTimeout(id);
  }, [progress]);

  React.useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 2400);
    return () => clearTimeout(id);
  }, [notice]);

  const driverPosition = React.useMemo(() => pointAt(DELIVERY_ROUTE, progress), [progress]);
  const etaMinutes = Math.max(0, Math.ceil((1 - progress) * DELIVERY_ROUTE_MINUTES + 0.35));
  const currentStepId = stepForProgress(progress);

  return (
    <div className="space-y-4">
      <DeliveryTrackerCard
        orderId={DELIVERY_ORDER_ID}
        origin={DELIVERY_ORIGIN}
        destination={DELIVERY_DESTINATION}
        driver={{ ...DELIVERY_DRIVER, position: driverPosition }}
        route={DELIVERY_ROUTE}
        steps={DELIVERY_STEPS}
        currentStepId={currentStepId}
        etaMinutes={etaMinutes}
        onCall={() => setNotice("Calling Marcus Lee…")}
        onMessage={() => setNotice("Opening chat with Marcus Lee…")}
        accentColor="#ec4899"
        routeColor="#2e2e2e"
      />

      <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
        <p>
          {Math.round(progress * 100)}% of {DELIVERY_ROUTE.length}-point OSRM route
        </p>
        <button
          type="button"
          onClick={() => setProgress(0.02)}
          className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 transition hover:bg-accent hover:text-accent-foreground"
        >
          <RotateCcw className="size-3" />
          Restart
        </button>
      </div>

      <div className="h-6 text-center" aria-live="polite">
        {notice ? (
          <span className="rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background">
            {notice}
          </span>
        ) : null}
      </div>
    </div>
  );
}
