import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";

import { loadIntelligencePayload } from "@/server/intelligence-snapshot";

/** Parsing NSR offline at build avoids cold-start failures; allow slack for artifact read + cache hydrate. */
export const maxDuration = 60;

const getCached = unstable_cache(
  async () => loadIntelligencePayload(),
  ["intelligence-payload-v3"],
  { revalidate: 3600 },
);

export async function GET() {
  try {
    const data = await getCached();
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[GET /api/intelligence/data]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
