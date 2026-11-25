/**
 * MapLibre resolves its web worker relative to the bundle URL, which Turbopack
 * does not emit. Copy the worker from node_modules into public/ so it can be
 * served at a stable path, and keep it in sync with the installed version.
 *
 *   node scripts/sync-maplibre-worker.mjs
 *
 * Runs automatically via `predev` / `prebuild`.
 */
import fs from "node:fs";
import path from "node:path";

const SRC = path.join("node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs");
const DEST_DIR = path.join("public", "maplibre");
const DEST = path.join(DEST_DIR, "maplibre-gl-worker.mjs");

if (!fs.existsSync(SRC)) {
  console.warn(`[maplibre] worker not found at ${SRC} — skipping`);
  process.exit(0);
}

const src = fs.statSync(SRC);
const upToDate = fs.existsSync(DEST) && fs.statSync(DEST).size === src.size;
if (upToDate) {
  console.log("[maplibre] worker already in sync");
  process.exit(0);
}

fs.mkdirSync(DEST_DIR, { recursive: true });
fs.copyFileSync(SRC, DEST);
console.log(`[maplibre] worker copied (${(src.size / 1024).toFixed(0)} KB)`);
