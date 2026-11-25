/**
 * Re-download the Malaysia boundary GeoJSON from upstream and rebuild manifest.json.
 *
 *   node scripts/fetch-malaysia-borders.mjs
 */
import fs from "node:fs";
import path from "node:path";

const REPO = "mptwaktusolat/jakim.geojson";
const BRANCH = "master";
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
const OUT = path.join(process.cwd(), "public", "data", "malaysia");

const LEVELS = [
  { file: "malaysia.geojson", level: "country", label: "Country outline" },
  { file: "malaysia.state.geojson", level: "state", label: "States / federal territories" },
  { file: "malaysia.district.geojson", level: "district", label: "Districts / daerah" },
  { file: "malaysia.district-jakim.geojson", level: "district-jakim", label: "Districts with JAKIM zone codes" },
  { file: "malaysia.dun.geojson", level: "dun", label: "State assembly seats (DUN)" },
  { file: "malaysia.parlimen.geojson", level: "parlimen", label: "Parliamentary seats" },
];

const bboxOf = (coords, acc) => {
  if (typeof coords[0] === "number") {
    acc[0] = Math.min(acc[0], coords[0]);
    acc[1] = Math.min(acc[1], coords[1]);
    acc[2] = Math.max(acc[2], coords[0]);
    acc[3] = Math.max(acc[3], coords[1]);
  } else {
    for (const c of coords) bboxOf(c, acc);
  }
  return acc;
};

fs.mkdirSync(OUT, { recursive: true });

const entries = [];
const loaded = {};

for (const { file, level, label } of LEVELS) {
  const res = await fetch(RAW + file, { headers: { "User-Agent": "ambank-location-map/1.0" } });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const text = await res.text();
  fs.writeFileSync(path.join(OUT, file), text);

  const geo = JSON.parse(text);
  const features = geo.features ?? [];
  const props = new Set();
  let bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of features) {
    Object.keys(f.properties ?? {}).forEach((k) => props.add(k));
    if (f.geometry?.coordinates) bbox = bboxOf(f.geometry.coordinates, bbox);
  }

  loaded[level] = features;
  entries.push({
    level,
    label,
    file,
    path: `/data/malaysia/${file}`,
    sizeBytes: Buffer.byteLength(text),
    features: features.length,
    properties: [...props],
    bbox: bbox.map((n) => Number(n.toFixed(5))),
  });
  console.log(`${level.padEnd(15)} ${features.length} features`);
}

const countBy = (features, key) =>
  features.reduce((acc, f) => {
    const v = f.properties?.[key] ?? "?";
    acc[v] = (acc[v] ?? 0) + 1;
    return acc;
  }, {});

const manifest = {
  dataset: "Malaysia administrative & electoral boundaries",
  source: {
    repository: `https://github.com/${REPO}`,
    branch: BRANCH,
    raw: RAW,
    retrieved: new Date().toISOString().slice(0, 10),
    note: "Compiled by the waktusolat project for JAKIM prayer-time zones. The upstream repo declares no licence — confirm terms with the owner before redistribution.",
  },
  crs: "WGS84 (EPSG:4326), [longitude, latitude]",
  bbox: [99.6406, 0.854, 119.269, 7.3806],
  levels: entries,
  counts: {
    states: loaded.state?.length ?? 0,
    districts: loaded.district?.length ?? 0,
    parlimen: loaded.parlimen?.length ?? 0,
    dun: loaded.dun?.length ?? 0,
    dunByState: countBy(loaded.dun ?? [], "state"),
    parlimenByState: countBy(loaded.parlimen ?? [], "state"),
  },
};

fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log("manifest.json written");
