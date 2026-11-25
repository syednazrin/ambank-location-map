"use client";

import dynamic from "next/dynamic";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="grid h-dvh w-full place-items-center bg-[#0b0b0d]">
      <div className="flex items-center gap-3 text-[12px] tracking-wide text-stone-500">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/15 border-t-amber-300" />
        Loading map
      </div>
    </div>
  ),
});

export default function MapClient() {
  return <MapView />;
}
