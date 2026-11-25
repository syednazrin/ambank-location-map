"use client";

import dynamic from "next/dynamic";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="grid h-dvh w-full place-items-center bg-background">
      <div className="flex items-center gap-3 text-[12px] tracking-wide text-muted-foreground">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-foreground" />
        Loading map
      </div>
    </div>
  ),
});

export default function MapClient() {
  return <MapView />;
}
