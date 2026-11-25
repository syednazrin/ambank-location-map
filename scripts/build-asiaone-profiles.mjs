/**
 * Builds src/data/asiaone-profiles.json — bed + specialist figures for the 32 Asia One sites.
 *
 *   node scripts/build-asiaone-profiles.mjs
 *
 * Inputs
 *  - data/asiaone-profiles.json          published figures scraped from the brand sites
 *                                        (scripts/scrape-asiaone-profiles.mjs)
 *  - src/data/swasta-berlesen.geocoded.json   MOH licensed-private register (TOTAL_BEDS)
 *  - src/data/nsr-specialist-register.json    National Specialist Register (establishment)
 *
 * Precedence
 *  beds        site claim → MOH licensed register → null
 *  specialists site claim → NSR establishment count → doctors listed on site → null
 *
 * Every value records where it came from so the UI can label it honestly.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mergePublicHospitalBedTotals } from "../src/lib/public-hospital-bed-merge.ts";

const ROOT = process.cwd();
const read = async (p) => JSON.parse(await readFile(path.join(ROOT, p), "utf8"));

const STOP = new Set([
  "HOSPITAL",
  "HOSPITALS",
  "MEDICAL",
  "CENTRE",
  "CENTER",
  "SDN",
  "BHD",
  "THE",
  "AND",
  "SPECIALIST",
  "SPECIALISTS",
  "EXTENDED",
  "CARE",
  "HEALTHCARE",
  "GROUP",
  "MALAYSIA",
  "PRIVATE",
  "LIMITED",
  "SON",
]);

function norm(s) {
  return String(s ?? "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(s) {
  return norm(s)
    .split(" ")
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

function stateKey(s) {
  const u = norm(s);
  if (u.includes("LABUAN")) return "FT_LABUAN";
  if (u.includes("PUTRAJAYA")) return "FT_PUTRAJAYA";
  if (u.includes("KUALA") && u.includes("LUMPUR")) return "FT_KL";
  return u;
}

/** Tokens of the query found in the candidate, weighted by token length. */
function score(queryTokens, candidate) {
  const hay = new Set(norm(candidate).split(" "));
  let total = 0;
  for (const t of queryTokens) if (hay.has(t)) total += t.length;
  return total;
}

const scraped = await read("data/asiaone-profiles.json");
const locations = await read("data/asiaone-locations.json");
const moh = await read("src/data/swasta-berlesen.geocoded.json");
const nsr = await read("src/data/nsr-specialist-register.json");

const locRows = Array.isArray(locations) ? locations : locations.locations;
const mohRows = moh.hospitals ?? [];
const nsrRows = nsr.records ?? [];

/** Register rows whose facility name omits the branch, resolved by exact register label. */
const MANUAL_MOH = {
  "columbia-asia-extended-care-hospital-shah-alam":
    "HOSPITAL RAWATAN LANJUTAN COLUMBIA ASIA (COLUMBIA ASIA EXTENDED CARE HOSPITAL)",
};

// Pre-index NSR by establishment text once.
const nsrEstablishments = nsrRows
  .map((r) => norm(r.establishmentText ?? r.establishmentRaw ?? ""))
  .filter(Boolean);

function bestMoh(loc) {
  const manual = MANUAL_MOH[loc.id];
  if (manual) {
    const row = mohRows.find((r) => r.NAMA_PENUH_FASILITI === manual);
    if (row) return { row, score: 999 };
  }
  const tokens = nameTokens(loc.name);
  if (!tokens.length) return null;
  const state = stateKey(loc.state);
  let best = null;
  for (const row of mohRows) {
    if (stateKey(row.NEGERI) !== state) continue;
    const s = score(tokens, row.NAMA_PENUH_FASILITI);
    if (s > (best?.score ?? 0)) best = { row, score: s };
  }
  // fall back to any state if nothing matched in the right one
  if (!best) {
    for (const row of mohRows) {
      const s = score(tokens, row.NAMA_PENUH_FASILITI);
      if (s > (best?.score ?? 0)) best = { row, score: s };
    }
  }
  if (!best) return null;
  const coverage = best.score / tokens.reduce((n, t) => n + t.length, 0);
  if (best.score < 10 || coverage < 0.999) return null;
  return best;
}

function nsrCount(loc) {
  const tokens = nameTokens(loc.name);
  if (tokens.length < 2) return 0;
  let n = 0;
  for (const est of nsrEstablishments) {
    const words = new Set(est.split(" "));
    let all = true;
    for (const t of tokens) {
      if (!words.has(t)) {
        all = false;
        break;
      }
    }
    if (all) n += 1;
  }
  return n;
}

const byId = new Map(scraped.profiles.map((p) => [p.id, p]));
const out = [];

for (const loc of locRows) {
  const site = byId.get(loc.id);
  const mohHit = bestMoh(loc);
  const nsrN = nsrCount(loc);

  let beds = null;
  if (site?.beds) {
    beds = { value: site.beds.value, source: "site", note: site.beds.snippet, url: site.beds.source };
  } else if (mohHit && typeof mohHit.row.TOTAL_BEDS === "number") {
    beds = {
      value: mohHit.row.TOTAL_BEDS,
      source: "moh",
      note: `MOH licensed register · ${mohHit.row.NAMA_PENUH_FASILITI}`,
      url: null,
    };
  }

  let specialists = null;
  if (site?.specialists) {
    specialists = {
      value: site.specialists.value,
      source: "site",
      note: site.specialists.snippet,
      url: site.specialists.source,
    };
  } else if (nsrN > 0) {
    specialists = {
      value: nsrN,
      source: "nsr",
      note: "NSR records naming this establishment",
      url: "https://nsr.org.my/list1pview.asp",
    };
  } else if (site?.doctorsListed) {
    specialists = {
      value: site.doctorsListed,
      source: "listed",
      note: "Doctor profiles listed on the brand site",
      url: site.website,
    };
  }

  out.push({
    id: loc.id,
    name: loc.name,
    state: loc.state,
    country: loc.country,
    website: loc.website,
    beds,
    specialists,
    mohFacility: mohHit ? mohHit.row.NAMA_PENUH_FASILITI : null,
  });
}

await writeFile(
  path.join(ROOT, "src", "data", "asiaone-profiles.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      sources: {
        site: "Published figure on the brand website (see note/snippet)",
        moh: "MOH licensed private hospital register (TOTAL_BEDS)",
        nsr: "National Specialist Register, records whose establishment matches the site",
        listed: "Doctor profiles listed on the brand website (lower bound)",
      },
      profiles: out,
    },
    null,
    2,
  ),
  "utf8",
);

const pad = (v, n) => String(v ?? "—").padEnd(n);
console.log(`\n${"site".padEnd(46)} ${"beds".padEnd(10)} ${"spec".padEnd(10)} src`);
for (const p of out) {
  console.log(
    `${p.name.slice(0, 44).padEnd(46)} ${pad(p.beds?.value, 6)}${pad(p.beds?.source ?? "", 4)} ${pad(p.specialists?.value, 6)}${pad(p.specialists?.source ?? "", 4)}`,
  );
}

const withBeds = out.filter((p) => p.beds).length;
const withSpec = out.filter((p) => p.specialists).length;
console.log(`\nbeds: ${withBeds}/${out.length} · specialists: ${withSpec}/${out.length}`);
console.log("wrote src/data/asiaone-profiles.json");

/* ---------- cohort summary: Asia One vs licensed private vs public ---------- */

const [pubDoc, kkmDoc, refDoc, payloadDoc, swastaDoc] = await Promise.all([
  read("src/data/public-hospitals.geocoded.json"),
  read("src/data/kkmnow-hospital-bed-utilisation-by-facility.json"),
  read("src/data/reference/malaysia_public_hospitals.json"),
  read("src/data/intelligence-payload.production.json"),
  read("src/data/swasta-berlesen.geocoded.json"),
]);

const mergedPublicBeds = mergePublicHospitalBedTotals(
  pubDoc.locations,
  kkmDoc,
  refDoc,
);

let publicBeds = 0;
let publicBedSites = 0;
for (const value of mergedPublicBeds.values()) {
  if (typeof value === "number" && Number.isFinite(value)) {
    publicBeds += value;
    publicBedSites += 1;
  }
}

let privateBeds = 0;
let privateBedSites = 0;
const swastaRows = swastaDoc.hospitals ?? [];
for (const row of swastaRows) {
  if (typeof row.TOTAL_BEDS === "number" && Number.isFinite(row.TOTAL_BEDS)) {
    privateBeds += row.TOTAL_BEDS;
    privateBedSites += 1;
  }
}

const specByKind = {
  public: { total: 0, sites: 0 },
  private: { total: 0, sites: 0 },
};
for (const hospital of payloadDoc.hospitals ?? []) {
  const bucket = specByKind[hospital.kind];
  if (!bucket) continue;
  const n = hospital.specialistTotal ?? 0;
  bucket.total += n;
  if (n > 0) bucket.sites += 1;
}

const asiaBeds = out.reduce((sum, p) => sum + (p.beds?.value ?? 0), 0);
const asiaSpec = out.reduce((sum, p) => sum + (p.specialists?.value ?? 0), 0);

const cohorts = [
  {
    key: "asia-one",
    label: "Asia One",
    sites: out.length,
    beds: asiaBeds,
    bedsSites: withBeds,
    specialists: asiaSpec,
    specialistSites: withSpec,
    bedsNote: "published figures + MOH register",
    specialistsNote: "published figures + NSR matches",
  },
  {
    key: "private",
    label: "Private · MOH licensed",
    sites: swastaRows.length,
    beds: privateBeds,
    bedsSites: privateBedSites,
    specialists: specByKind.private.total,
    specialistSites: specByKind.private.sites,
    bedsNote: "MOH licensed register",
    specialistsNote: "NSR establishment matches",
  },
  {
    key: "public",
    label: "Public · MOH",
    sites: pubDoc.locations.length,
    beds: publicBeds,
    bedsSites: publicBedSites,
    specialists: specByKind.public.total,
    specialistSites: specByKind.public.sites,
    bedsNote: "reference + KKMNOW wards/ICU",
    specialistsNote: "NSR establishment matches",
  },
];

await writeFile(
  path.join(ROOT, "src", "data", "cohort-summary.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), cohorts }, null, 2),
  "utf8",
);

for (const c of cohorts) {
  console.log(
    `${c.label.padEnd(22)} sites ${String(c.sites).padStart(4)} · beds ${String(c.beds).padStart(6)} (${c.bedsSites}) · specialists ${String(c.specialists).padStart(6)} (${c.specialistSites})`,
  );
}
console.log("wrote src/data/cohort-summary.json");
