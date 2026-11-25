"use client";

import dynamic from "next/dynamic";

const DeliveryDemo = dynamic(
  () => import("./delivery-demo").then((mod) => mod.DeliveryDemo),
  {
    ssr: false,
    loading: () => (
      <div className="h-[420px] animate-pulse rounded-xl border bg-muted/40" aria-hidden />
    ),
  },
);

export function TrackerDemoClient() {
  return <DeliveryDemo />;
}
