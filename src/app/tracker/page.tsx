import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { TrackerDemoClient } from "@/components/maps/tracker-demo-client";

export const metadata: Metadata = {
  title: "Delivery tracker · Paper pattern",
  description:
    "A live delivery card: MapLibre map, route split at the driver, ETA and step bar.",
};

export default function TrackerPage() {
  return (
    <main className="tracker-theme h-dvh overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-[460px] flex-col justify-center gap-6 px-4 py-10">
        <header className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            AmBank map
          </Link>
          <span className="rounded-full border px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            Live demo
          </span>
        </header>

        <TrackerDemoClient />

        <footer className="space-y-1 text-center text-[11px] leading-relaxed text-muted-foreground">
          <p>
            2.4 km · Bi-Rite Market → 412 Hayes St · route by OSRM · basemap by OpenFreeMap
          </p>
          <p>Driver simulated along the route — nothing is charged to an API key.</p>
        </footer>
      </div>
    </main>
  );
}
