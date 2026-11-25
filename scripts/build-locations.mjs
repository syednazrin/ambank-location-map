import fs from "node:fs";

const rows = JSON.parse(
  fs.readFileSync("data/asiaone-locations.json", "utf8"),
).filter((r) => r.lat != null);

const STATE_LABEL = {
  "kuala lumpur": { state: "Kuala Lumpur", code: "KUL" },
  "wilayah persekutuan kuala lumpur": { state: "Kuala Lumpur", code: "KUL" },
  selangor: { state: "Selangor", code: "SGR" },
  "pulau pinang": { state: "Pulau Pinang", code: "PNG" },
  penang: { state: "Pulau Pinang", code: "PNG" },
  johor: { state: "Johor", code: "JHR" },
  "negeri sembilan": { state: "Negeri Sembilan", code: "NSN" },
  perak: { state: "Perak", code: "PRK" },
  sarawak: { state: "Sarawak", code: "SWK" },
  melaka: { state: "Melaka", code: "MLK" },
  pahang: { state: "Pahang", code: "PHG" },
  kedah: { state: "Kedah", code: "KDH" },
  kelantan: { state: "Kelantan", code: "KTN" },
  terengganu: { state: "Terengganu", code: "TRG" },
  perlis: { state: "Perlis", code: "PLS" },
  sabah: { state: "Sabah", code: "SBH" },
  "w.p. labuan": { state: "Labuan", code: "LBN" },
  "w.p. putrajaya": { state: "Putrajaya", code: "PJY" },
};

function formatPhone(raw) {
  if (!raw) return "";
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits.startsWith("+60")) return raw;
  const rest = digits.slice(3);
  const twoDigitMobile = /^1/.test(rest);
  const area = twoDigitMobile ? rest.slice(0, 2) : rest.slice(0, 1);
  const local = rest.slice(area.length);
  let body = local;
  if (local.length === 8) body = `${local.slice(0, 4)} ${local.slice(4)}`;
  else if (local.length === 7) body = `${local.slice(0, 3)} ${local.slice(3)}`;
  return `+60 ${area}-${body}`;
}

function kindOf(name) {
  if (/physio/i.test(name)) return "Physiotherapy";
  if (/^TAGS/i.test(name)) return "Specialist Centre";
  return "Hospital";
}

const items = rows
  .map((r) => {
    const meta = STATE_LABEL[r.state.toLowerCase()] ?? { state: r.state, code: "MY" };
    const precision = r.geocode?.precision ?? "exact";
    return {
      id: r.id,
      name: r.name.replace(/\s*\(.*\)$/, ""),
      kind: kindOf(r.name),
      country: r.country,
      state: meta.state,
      stateCode: meta.code,
      address: r.address,
      phone: formatPhone(r.phone),
      email: r.email,
      website: r.website,
      precision,
      precisionNote: r.geocode?.note ?? "",
      coords: [Number(r.lat.toFixed(5)), Number(r.lng.toFixed(5))],
    };
  })
  .sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));

const lines = items
  .map(
    (l) => `  {
    id: ${JSON.stringify(l.id)},
    name: ${JSON.stringify(l.name)},
    kind: ${JSON.stringify(l.kind)},
    country: ${JSON.stringify(l.country)},
    state: ${JSON.stringify(l.state)},
    stateCode: ${JSON.stringify(l.stateCode)},
    address: ${JSON.stringify(l.address)},
    phone: ${JSON.stringify(l.phone)},
    email: ${JSON.stringify(l.email)},
    website: ${JSON.stringify(l.website)},
    precision: ${JSON.stringify(l.precision)},
    precisionNote: ${JSON.stringify(l.precisionNote)},
    coords: [${l.coords[0]}, ${l.coords[1]}],
  },`,
  )
  .join("\n");

const file = `/**
 * Asia OneHealthcare network — scraped from asiaonehealth.com/our-brands on 2026-11-25.
 * All 32 listed brands carry coordinates; the six that automated geocoding missed use
 * supplied OSM points, flagged by \`precision\` (exact | good | street | approximate).
 * Source data and provenance: \`data/asiaone-locations.json\`.
 *
 * Regenerate with: node scripts/build-locations.mjs
 */

export type LocationKind = "Hospital" | "Specialist Centre" | "Physiotherapy";

/** How exact the pin is: exact building, ~100 m, street-level, or approximate. */
export type LocationPrecision = "exact" | "good" | "street" | "approximate";

export type Location = {
  id: string;
  name: string;
  kind: LocationKind;
  country: string;
  state: string;
  /** Short state code shown as a badge in the list. */
  stateCode: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  precision: LocationPrecision;
  precisionNote: string;
  /** [latitude, longitude] */
  coords: [number, number];
};

export const LOCATIONS: Location[] = [
${lines}
];

export const STATES = [...new Set(LOCATIONS.map((l) => l.state))].sort();
`;

fs.writeFileSync("src/lib/locations.ts", file);

const byState = items.reduce((a, l) => ((a[l.state] = (a[l.state] ?? 0) + 1), a), {});
console.log(`wrote ${items.length} locations`);
console.log(byState);
console.log(items.slice(0, 3).map((l) => `${l.name} · ${l.phone} · ${l.kind}`));
