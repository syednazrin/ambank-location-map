/**
 * Scrape Asia One brand sites for published bed counts and specialist/consultant counts.
 *
 *   node scripts/scrape-asiaone-profiles.mjs
 *
 * Reads data/asiaone-locations.json, fetches each site's home + likely "about" /
 * "doctors" pages, and writes data/asiaone-profiles.json with matches, the text
 * snippet they came from, and the source URL. Values are NOT auto-trusted — the
 * snippet lets you eyeball each one.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIMEOUT_MS = 12000;
const DELAY_MS = 300;

const SUBPAGES = ["/about-us", "/our-doctors", "/doctors", "/our-team"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function visibleText(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

async function get(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) return { url, ok: false, status: res.status, html: "" };
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return { url, ok: false, status: res.status, html: "" };
    return { url: res.url || url, ok: true, status: res.status, html: await res.text() };
  } catch (error) {
    return { url, ok: false, status: 0, html: "", error: String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Collect bed-count candidates with the sentence they came from. */
function findBeds(text) {
  const out = [];
  const patterns = [
    /(\d{1,4})\s*[-–—]?\s*(?:licensed|operating|total)?\s*beds?\b/gi,
    /(\d{1,4})\s*[-–—]\s*bedded\b/gi,
    /bed\s*(?:capacity|count)\s*(?:of|:)?\s*(\d{1,4})/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) {
      const value = Number(m[1]);
      if (!Number.isFinite(value) || value < 10 || value > 3000) continue;
      const start = Math.max(0, m.index - 70);
      const snippet = text.slice(start, m.index + m[0].length + 70).trim();
      const context = snippet.toLowerCase();
      // reject room-rate / non-capacity mentions
      if (/rm\s?\d|room rate|\bper bed\b|nursery cot|two-bedded room|single room/.test(context)) continue;
      out.push({ value, matched: m[0].trim(), snippet });
    }
  }
  return out;
}

/** Collect "N specialists / consultants / doctors" claims. */
function findSpecialists(text) {
  const out = [];
  const patterns = [
    // "more than 120 medical specialists", "over 260 highly experienced specialists"
    /(?:\bover|\bmore than|\bteam of|\bcomprising|\bcapacity of|\bequipped with)\s+(\d{1,4})\s*\+?\s*((?:[a-z][a-z-]*\s+){0,4})(specialists?|consultants?|doctors?)\b/gi,
    // "120 medical specialists" / "60 consultants" (noun must follow directly)
    /(\d{1,4})\s*\+?\s+(?:medical\s+|resident\s+)?(specialists?|consultants?)\b/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) {
      const value = Number(m[1]);
      if (!Number.isFinite(value) || value < 3 || value > 1000) continue;
      const start = Math.max(0, m.index - 80);
      const snippet = text.slice(start, m.index + m[0].length + 80).trim();
      if (/patient nationalities|visits|reviews|followers|google|\+60|careline|whatsapp|@/i.test(snippet)) continue;
      if (/\b(?:ago|year|years)\b/i.test(snippet)) continue;
      out.push({ value, matched: m[0].trim(), snippet });
    }
  }
  return out;
}

/** Unique doctor profile links on a page — a lower bound on listed specialists. */
function countDoctorLinks(html, base) {
  const links = new Set();
  const re = /href="([^"#?]+)"/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    if (!/\/(doctors?|specialists?|consultants?)\//i.test(href)) continue;
    if (/\/(doctors?|specialists?|consultants?)\/?$/i.test(href)) continue;
    try {
      links.add(new URL(href, base).toString());
    } catch {
      /* ignore */
    }
  }
  return links.size;
}

function pickBest(candidates) {
  if (!candidates.length) return null;
  const counts = new Map();
  for (const c of candidates) counts.set(c.value, (counts.get(c.value) ?? 0) + 1);
  // prefer the value repeated most often, then the largest
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])
    .map(([value]) => candidates.find((c) => c.value === value))
    .at(0);
}

const raw = JSON.parse(await readFile(path.join(ROOT, "data", "asiaone-locations.json"), "utf8"));
const locations = Array.isArray(raw) ? raw : raw.locations;

const profiles = [];

for (const [index, loc] of locations.entries()) {
  const origin = new URL(loc.website).origin;
  const pages = [loc.website, ...SUBPAGES.map((p) => origin + p)];
  const beds = [];
  const specialists = [];
  const fetched = [];
  let doctorLinks = 0;
  let bedsSource = null;
  let specSource = null;

  for (const url of pages) {
    const res = await get(url);
    await sleep(DELAY_MS);
    if (!res.ok || !res.html) continue;
    fetched.push(res.url);
    const text = visibleText(res.html);

    const b = findBeds(text);
    if (b.length && !bedsSource) {
      beds.push(...b);
      bedsSource = res.url;
    }
    const s = findSpecialists(text);
    if (s.length && !specSource) {
      specialists.push(...s);
      specSource = res.url;
    }
    doctorLinks = Math.max(doctorLinks, countDoctorLinks(res.html, res.url));
  }

  const bedHit = pickBest(beds);
  const specHit = pickBest(specialists);

  profiles.push({
    id: loc.id,
    name: loc.name,
    website: loc.website,
    beds: bedHit ? { value: bedHit.value, snippet: bedHit.snippet, source: bedsSource } : null,
    specialists: specHit
      ? { value: specHit.value, snippet: specHit.snippet, source: specSource }
      : null,
    doctorsListed: doctorLinks || null,
    pagesFetched: fetched.length,
  });

  const b = bedHit ? bedHit.value : "—";
  const s = specHit ? specHit.value : "—";
  console.log(
    `${String(index + 1).padStart(2)}  ${loc.name.slice(0, 44).padEnd(46)} beds=${String(b).padEnd(5)} specialists=${String(s).padEnd(5)} links=${doctorLinks}`,
  );
}

await writeFile(
  path.join(ROOT, "data", "asiaone-profiles.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      method:
        "Fetched each brand site's home + /about-us, /our-doctors, /doctors, /our-team, /specialists; regex-extracted published bed and specialist/consultant counts. Values need eyeballing — see snippet.",
      profiles,
    },
    null,
    2,
  ),
  "utf8",
);

console.log(`\nwrote data/asiaone-profiles.json (${profiles.length} sites)`);
