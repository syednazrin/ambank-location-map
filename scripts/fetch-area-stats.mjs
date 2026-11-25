import fs from "node:fs";

const BASE = "https://api.data.gov.my/data-catalogue";
const get = async (id) => {
  const res = await fetch(`${BASE}?id=${id}&limit=200000`);
  if (!res.ok) throw new Error(`${id}: ${res.status}`);
  return res.json();
};

const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Naming differences between DOSM and the boundary file. */
const STATE_ALIAS = { wpklumpur: "wpkualalumpur" };
const DISTRICT_ALIAS = {
  sptengah: "seberangperaitengah",
  sptutara: "seberangperaiutara",
  sputara: "seberangperaiutara",
  sptselatan: "seberangperaiselatan",
  spselatan: "seberangperaiselatan",
  larutmatang: "larutdanmatang",
  hulu: "huluterengganu",
};
const canonState = (name) => STATE_ALIAS[slug(name)] ?? slug(name);
const canonDistrict = (name) => DISTRICT_ALIAS[slug(name)] ?? slug(name);

/* ---------- DOSM ---------- */

const popRaw = await get("population_state");
const popOverall = popRaw.filter(
  (r) => r.age === "overall_age" && r.sex === "overall_sex" && r.ethnicity === "overall_ethnicity",
);
const popDate = [...new Set(popOverall.map((r) => r.date))].sort().at(-1);
const STATE_POPULATION = {};
for (const r of popOverall.filter((r) => r.date === popDate)) {
  STATE_POPULATION[canonState(r.state)] = Math.round(r.population * 1000);
}

const distRaw = await get("hh_income_district");
const distDate = [...new Set(distRaw.map((r) => r.date))].sort().at(-1);
const DISTRICT_INCOME = {};
for (const r of distRaw.filter((r) => r.date === distDate)) {
  DISTRICT_INCOME[`${canonState(r.state)}|${canonDistrict(r.district)}`] = r.income_median;
}

const parRaw = await get("hh_income_parlimen");
const parDate = [...new Set(parRaw.map((r) => r.date))].sort().at(-1);
const PARLIMEN_INCOME = {};
for (const r of parRaw.filter((r) => r.date === parDate)) {
  PARLIMEN_INCOME[slug(r.parlimen)] = r.income_median;
}

/* ---------- validate against the boundary files ---------- */

const DIR = "public/data/malaysia";
const read = (f) => JSON.parse(fs.readFileSync(`${DIR}/${f}`, "utf8"));

const stateGeo = read("malaysia.state.geojson");
const STATE_NAME_BY_CODE = {};
for (const f of stateGeo.features) STATE_NAME_BY_CODE[f.properties.state] = f.properties.name;

const report = (label, features, lookup) => {
  const missing = [];
  let hit = 0;
  for (const f of features) {
    const value = lookup(f.properties);
    if (value == null) missing.push(f.properties.name ?? f.properties.district ?? f.properties.parlimen ?? "?");
    else hit++;
  }
  console.log(`${label}: ${hit}/${features.length} matched`);
  if (missing.length) console.log("   miss:", missing.slice(0, 12).join(" | "));
};

report("state ↔ population", stateGeo.features, (p) => STATE_POPULATION[canonState(p.name)]);

const districtGeo = read("malaysia.district.geojson");
report("district ↔ income", districtGeo.features, (p) => {
  const stateName = STATE_NAME_BY_CODE[p.state] ?? "";
  return DISTRICT_INCOME[`${canonState(stateName)}|${canonDistrict(p.name)}`];
});

const parGeo = read("malaysia.parlimen.geojson");
report("parlimen ↔ income", parGeo.features, (p) => PARLIMEN_INCOME[slug(p.parlimen)]);

/* ---------- write the module ---------- */

const sort = (obj) =>
  Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

const lines = (obj) =>
  Object.entries(obj)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${typeof v === "number" ? v : JSON.stringify(v)},`)
    .join("\n");

const file = `/**
 * Area statistics for the map choropleth — generated from the DOSM open data API.
 *
 *   population  \`population_state\`      latest ${popDate.slice(0, 4)}   (persons)
 *   income      \`hh_income_district\`    latest ${distDate.slice(0, 4)}   (median household income, RM)
 *   income      \`hh_income_parlimen\`    latest ${parDate.slice(0, 4)}   (median household income, RM)
 *
 * Keys are slugged (lowercase alphanumerics). District keys are \`state|district\`.
 * DOSM does not publish population (or income) for DUN seats.
 *
 * Regenerate with: node scripts/fetch-area-stats.mjs
 */

export const POPULATION_YEAR = "${popDate.slice(0, 4)}";
export const INCOME_YEAR = "${parDate.slice(0, 4)}";

/** State name slug → population (persons). */
export const STATE_POPULATION: Record<string, number> = {
${lines(sort(STATE_POPULATION))}
};

/** \`state|district\` → median household income (RM). */
export const DISTRICT_INCOME: Record<string, number> = {
${lines(sort(DISTRICT_INCOME))}
};

/** Parliament slug → median household income (RM). */
export const PARLIMEN_INCOME: Record<string, number> = {
${lines(sort(PARLIMEN_INCOME))}
};

/** Boundary state code (SGR, KDH …) → state name. */
export const STATE_NAME_BY_CODE: Record<string, string> = {
${lines(sort(STATE_NAME_BY_CODE))}
};

export const slugKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "WP K Lumpur" (boundary file) and "W.P. Kuala Lumpur" (DOSM) are the same place. */
const STATE_ALIAS: Record<string, string> = { wpklumpur: "wpkualalumpur" };

export const stateKey = (name: string) => STATE_ALIAS[slugKey(name)] ?? slugKey(name);
`;

fs.writeFileSync("src/lib/area-stats.ts", file);
console.log("\nwrote src/lib/area-stats.ts");
