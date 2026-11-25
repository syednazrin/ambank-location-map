import { readFile } from "fs/promises";
import path from "path";

import type { ChoroplethMetricDoc } from "@/lib/malaysia-choropleth";
import { isWilayahParliamentChoroplethState } from "@/lib/malaysia-choropleth";
import type {
  CorridorRow,
  HospitalKind,
  IntelligenceHospital,
  IntelligencePayload,
  SpecialtyBucket,
  SpecialistMapPoint,
  StateBedsRow,
  UtilizationRow,
} from "@/types/intelligence";

const KKM_STATE: Record<string, string> = {
  jhr: "Johor",
  kdh: "Kedah",
  ktn: "Kelantan",
  kul: "W.P. Kuala Lumpur",
  lbn: "W.P. Labuan",
  mlk: "Melaka",
  nsn: "Negeri Sembilan",
  phg: "Pahang",
  pjy: "W.P. Putrajaya",
  pls: "Perlis",
  png: "Pulau Pinang",
  prk: "Perak",
  sbh: "Sabah",
  sgr: "Selangor",
  swk: "Sarawak",
  trg: "Terengganu",
};

function dataPath(...segments: string[]) {
  return path.join(process.cwd(), "src", "data", ...segments);
}

/** Matches map UI “nearby specialist depth”: sum matched NSR counts at hospitals within this distance. */
const CATCHMENT_RADIUS_METERS = 15_000;

function haversineMetersBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const dφ = ((b.lat - a.lat) * Math.PI) / 180;
  const dλ = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dφ / 2) * Math.sin(dφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) * Math.sin(dλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

function norm(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .toUpperCase()
    .replace(/['’`]/g, " ")
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classifySpecialty(spec: string | null | undefined): SpecialtyBucket {
  const u = norm(spec);
  if (u.includes("CARDIO")) return "cardiology";
  if (u.includes("ONCO")) return "oncology";
  if (u.includes("PEDIA")) return "pediatrics";
  if (u.includes("ORTHOP")) return "orthopedics";
  if (u.includes("NEURO")) return "neurology";
  if (u.includes("GASTRO") || u.includes("HEPATO")) return "gastroenterology";
  return "other";
}

function parseNum(v: string | undefined): number | null {
  if (v == null || v === "None") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function nameMatchScore(establishment: string | null | undefined, hospitalName: string | null | undefined): number {
  const e = norm(establishment);
  const h = norm(hospitalName);
  if (e.length < 4 || h.length < 4) return 0;
  if (e.includes(h)) return h.length;
  if (h.includes(e) && e.length >= 10) return e.length;
  const ht = h.split(" ").filter((t) => t.length > 3);
  let sc = 0;
  for (const t of ht) {
    if (e.includes(t)) sc += t.length;
  }
  return sc;
}

function bestHospitalForRow(
  establishmentText: string | null | undefined,
  hospitals: Array<{ id: string; name: string; state: string }>,
): { id: string; score: number } | null {
  let best: { id: string; score: number } | null = null;
  for (const h of hospitals) {
    const s = nameMatchScore(establishmentText, h.name);
    if (s > (best?.score ?? 0)) best = { id: h.id, score: s };
  }
  if (!best || best.score < 8) return null;
  return best;
}

function jitter(lng: number, lat: number, seed: number, ring: number, i: number, n: number) {
  const t = (i / Math.max(n, 1)) * Math.PI * 2 + seed * 0.001;
  const r = ring * (0.35 + ((seed % 97) / 97) * 0.65);
  const dLat = (r / 111_000) * Math.sin(t);
  const dLng = (r / (111_000 * Math.cos((lat * Math.PI) / 180))) * Math.cos(t);
  return { lng: lng + dLng, lat: lat + dLat };
}

type DunFeature = {
  properties?: { state?: string; code_state_dun?: string };
};

type ParFeature = {
  properties?: { state?: string; code_parlimen?: string };
};

export async function computeIntelligencePayload(): Promise<IntelligencePayload> {
  const [
    nsrRaw,
    kkmRaw,
    publicRaw,
    swastaRaw,
    dunRaw,
    parRaw,
    popRaw,
  ] = await Promise.all([
    readFile(dataPath("nsr-specialist-register.json"), "utf8"),
    readFile(dataPath("kkmnow-hospital-bed-utilisation-by-facility.json"), "utf8"),
    readFile(dataPath("public-hospitals.geocoded.json"), "utf8"),
    readFile(dataPath("swasta-berlesen.geocoded.json"), "utf8"),
    readFile(dataPath("District and Dun Data", "malaysia.dun.json"), "utf8"),
    readFile(dataPath("District and Dun Data", "malaysia.parlimen.json"), "utf8"),
    readFile(dataPath("District and Dun Data", "population", "population-choropleth.json"), "utf8"),
  ]);

  const nsr = JSON.parse(nsrRaw) as {
    records: Array<{
      establishmentText: string;
      specialtyDisplay: string;
      name: string;
    }>;
  };
  const kkm = JSON.parse(kkmRaw) as {
    rows: Array<{
      state: string;
      data: { hospital: string; beds_nonicu: string; util_nonicu: string };
    }>;
  };
  const pubDoc = JSON.parse(publicRaw) as {
    locations: Array<{ name: string; stateTitle: string; lat: number; lon: number }>;
  };
  const swDoc = JSON.parse(swastaRaw) as {
    hospitals: Array<{
      BIL: number;
      NAMA_PENUH_FASILITI: string;
      NEGERI: string;
      lat: number;
      lon: number;
    }>;
  };
  const dunFc = JSON.parse(dunRaw) as { features: DunFeature[] };
  const parFc = JSON.parse(parRaw) as { features: ParFeature[] };
  const popDoc = JSON.parse(popRaw) as ChoroplethMetricDoc;

  const baseHospitals: Array<{
    id: string;
    name: string;
    state: string;
    lat: number;
    lon: number;
    kind: HospitalKind;
  }> = [];

  pubDoc.locations.forEach((p, i) => {
    if (typeof p.lat !== "number" || typeof p.lon !== "number") return;
    baseHospitals.push({
      id: `pub-${i}`,
      name: p.name,
      state: p.stateTitle,
      lat: p.lat,
      lon: p.lon,
      kind: "public",
    });
  });
  swDoc.hospitals.forEach((p, i) => {
    if (typeof p.lat !== "number" || typeof p.lon !== "number") return;
    baseHospitals.push({
      id: `pvt-${i}`,
      name: String(p.NAMA_PENUH_FASILITI ?? "").trim(),
      state: titleCaseState(String(p.NEGERI ?? "")),
      lat: p.lat,
      lon: p.lon,
      kind: "private",
    });
  });

  const matchIndex = baseHospitals.map((h) => ({ id: h.id, name: h.name, state: h.state }));

  const counts = new Map<
    string,
    { total: number; by: Record<SpecialtyBucket, number>; samples: string[] }
  >();
  for (const id of baseHospitals.map((h) => h.id)) {
    counts.set(id, {
      total: 0,
      by: {
        cardiology: 0,
        oncology: 0,
        pediatrics: 0,
        orthopedics: 0,
        neurology: 0,
        gastroenterology: 0,
        other: 0,
      },
      samples: [],
    });
  }

  const specialtyTotals: Record<SpecialtyBucket, number> = {
    cardiology: 0,
    oncology: 0,
    pediatrics: 0,
    orthopedics: 0,
    neurology: 0,
    gastroenterology: 0,
    other: 0,
  };

  for (const r of nsr.records) {
    const b = classifySpecialty(r.specialtyDisplay);
    specialtyTotals[b] += 1;
    const hit = bestHospitalForRow(r.establishmentText, matchIndex);
    if (!hit) continue;
    const c = counts.get(hit.id);
    if (!c) continue;
    c.total += 1;
    c.by[b] += 1;
    if (c.samples.length < 6 && r.specialtyDisplay != null && String(r.specialtyDisplay).trim() !== "") {
      c.samples.push(String(r.specialtyDisplay));
    }
  }

  const kkmByPublicId = new Map<
    string,
    { beds: number | null; util: number | null; hospital: string; state: string }
  >();
  for (const row of kkm.rows) {
    const hosp = row.data?.hospital;
    if (hosp == null || String(hosp).trim() === "") continue;
    const stateName = KKM_STATE[row.state] ?? row.state;
    let bestPub: (typeof baseHospitals)[number] | null = null;
    let bestSc = 0;
    for (const h of baseHospitals) {
      if (h.kind !== "public") continue;
      if (h.state !== stateName && norm(h.state) !== norm(stateName)) continue;
      const sc = nameMatchScore(hosp, h.name);
      if (sc > bestSc) {
        bestSc = sc;
        bestPub = h;
      }
    }
    if (bestPub && bestSc >= 10) {
      kkmByPublicId.set(bestPub.id, {
        beds: parseNum(row.data.beds_nonicu),
        util: parseNum(row.data.util_nonicu),
        hospital: String(hosp),
        state: stateName,
      });
    }
  }

  const maxSpec = Math.max(1, ...[...counts.values()].map((c) => c.total));

  const hospitalsCore = baseHospitals.map((h) => {
    const c = counts.get(h.id)!;
    const k = h.kind === "public" ? kkmByPublicId.get(h.id) : undefined;
    const competitiveIntensity = Math.round((c.total / maxSpec) * 100);
    const talentAccessibilityScore = Math.min(100, Math.round(42 + (c.total / (maxSpec * 0.35)) * 58));
    const distanceScore = Math.max(15, 100 - Math.min(85, Math.round((maxSpec - c.total) / 4)));

    const keys = [...new Set(c.samples)].slice(0, 4);

    return {
      id: h.id,
      name: h.name,
      state: h.state,
      lat: h.lat,
      lon: h.lon,
      kind: h.kind,
      bedsNonIcu: k?.beds ?? null,
      utilNonIcu: k?.util ?? null,
      specialistTotal: c.total,
      bySpecialty: { ...c.by },
      keySpecialties: keys,
      competitiveIntensity,
      distanceScore,
      talentAccessibilityScore,
    };
  });

  const hospitals: IntelligenceHospital[] = hospitalsCore.map((h) => {
    let reach = 0;
    for (const k of hospitalsCore) {
      if (haversineMetersBetween(h, k) <= CATCHMENT_RADIUS_METERS) reach += k.specialistTotal;
    }
    return { ...h, specialistReach15Km: reach };
  });

  hospitals.sort((a, b) => b.specialistTotal - a.specialistTotal);

  const specialistPoints: SpecialistMapPoint[] = [];
  const MAX_POINTS = 4500;
  let pt = 0;
  for (const r of nsr.records) {
    if (pt >= MAX_POINTS) break;
    const hit = bestHospitalForRow(r.establishmentText, matchIndex);
    if (!hit) continue;
    const h = baseHospitals.find((x) => x.id === hit.id);
    if (!h) continue;
    const bucket = classifySpecialty(r.specialtyDisplay);
    const c = counts.get(hit.id)!;
    const j = jitter(
      h.lon,
      h.lat,
      String(r.name ?? "").length + pt,
      650,
      c.total > 0 ? pt % c.total : 0,
      Math.max(c.total, 1),
    );
    specialistPoints.push({
      lng: j.lng,
      lat: j.lat,
      bucket,
      hospitalId: h.id,
      label: String(r.name ?? "").trim() || "Specialist",
    });
    pt += 1;
  }

  const statePopulation = new Map<string, { pop: number; incomeSum: number; incomeN: number; growthSum: number; growthN: number }>();
  const bump = (state: string, pop: number, income?: number, growth?: number) => {
    const s = state.trim();
    if (!s) return;
    const cur = statePopulation.get(s) ?? { pop: 0, incomeSum: 0, incomeN: 0, growthSum: 0, growthN: 0 };
    cur.pop += pop;
    if (income != null && Number.isFinite(income)) {
      cur.incomeSum += income;
      cur.incomeN += 1;
    }
    if (growth != null && Number.isFinite(growth)) {
      cur.growthSum += growth;
      cur.growthN += 1;
    }
    statePopulation.set(s, cur);
  };

  for (const f of dunFc.features) {
    const st = String(f.properties?.state ?? "");
    const code = String(f.properties?.code_state_dun ?? "");
    if (!code || isWilayahParliamentChoroplethState(st)) continue;
    const row = popDoc.byDun[code];
    if (!row) continue;
    const popK = row.population;
    if (typeof popK !== "number") continue;
    bump(st, popK * 1000, row.income, row.growthPct);
  }
  for (const f of parFc.features) {
    const st = String(f.properties?.state ?? "");
    if (!isWilayahParliamentChoroplethState(st)) continue;
    const code = String(f.properties?.code_parlimen ?? "");
    const row = popDoc.byParlimen[code];
    if (!row) continue;
    const popK = row.population;
    if (typeof popK !== "number") continue;
    bump(st, popK * 1000, row.income, row.growthPct);
  }

  const bedsPublicByState = new Map<string, number>();
  const utilPublicByState = new Map<string, { sum: number; n: number }>();
  for (const h of hospitals) {
    if (h.kind !== "public") continue;
    if (h.bedsNonIcu != null) {
      bedsPublicByState.set(h.state, (bedsPublicByState.get(h.state) ?? 0) + h.bedsNonIcu);
    }
    if (h.utilNonIcu != null) {
      const u = utilPublicByState.get(h.state) ?? { sum: 0, n: 0 };
      u.sum += h.utilNonIcu;
      u.n += 1;
      utilPublicByState.set(h.state, u);
    }
  }

  const privateCountByState = new Map<string, number>();
  for (const h of hospitals) {
    if (h.kind !== "private") continue;
    privateCountByState.set(h.state, (privateCountByState.get(h.state) ?? 0) + 1);
  }

  const stateBeds: StateBedsRow[] = [];
  for (const [state, agg] of statePopulation) {
    const pop = agg.pop;
    if (pop < 1) continue;
    const bedsPublic = bedsPublicByState.get(state) ?? 0;
    const pvt = privateCountByState.get(state) ?? 0;
    const bedsPrivateProxy = pvt * 72;
    const bedsPer10k = ((bedsPublic + bedsPrivateProxy) / pop) * 10_000;
    stateBeds.push({
      state,
      population: Math.round(pop),
      bedsPublic,
      bedsPrivateProxy,
      bedsPer10k,
      incomeMedian: agg.incomeN > 0 ? Math.round(agg.incomeSum / agg.incomeN) : null,
      growthPct: agg.growthN > 0 ? agg.growthSum / agg.growthN : null,
    });
  }
  stateBeds.sort((a, b) => b.bedsPer10k - a.bedsPer10k);

  const utilization: UtilizationRow[] = [];
  for (const h of hospitals) {
    if (h.kind !== "public" || (h.bedsNonIcu == null && h.utilNonIcu == null)) continue;
    const u = h.utilNonIcu ?? 0;
    utilization.push({
      hospital: h.name,
      state: h.state,
      bedsNonIcu: h.bedsNonIcu,
      utilNonIcu: h.utilNonIcu,
      stress: Math.min(100, Math.round(u * (h.bedsNonIcu != null && h.bedsNonIcu < 80 ? 1.08 : 1))),
    });
  }
  utilization.sort((a, b) => (b.utilNonIcu ?? 0) - (a.utilNonIcu ?? 0));

  const specByState = new Map<string, number>();
  for (const h of hospitals) {
    specByState.set(h.state, (specByState.get(h.state) ?? 0) + h.specialistTotal);
  }

  const corridorRows: CorridorRow[] = stateBeds.map((s) => {
    const utilAgg = utilPublicByState.get(s.state);
    const utilAvg = utilAgg && utilAgg.n > 0 ? utilAgg.sum / utilAgg.n : null;
    const specDepth = specByState.get(s.state) ?? 0;
    const popD = s.population / 1e6;
    const incomeNorm = s.incomeMedian != null ? Math.min(1, s.incomeMedian / 12000) : 0.45;
    const utilNorm = utilAvg != null ? Math.min(1, utilAvg / 100) : 0.5;
    const bedShort = 1 - Math.min(1, s.bedsPer10k / 45);
    const specNorm = Math.min(1, specDepth / Math.max(1, popD * 3500));
    const growthNorm = s.growthPct != null ? Math.min(1, (s.growthPct + 1) / 4) : 0.5;
    const opportunityScore = Math.round(
      100 *
        (0.22 * incomeNorm + 0.24 * utilNorm + 0.22 * bedShort + 0.18 * specNorm + 0.14 * growthNorm),
    );
    return {
      rank: 0,
      area: s.state,
      state: s.state,
      population: s.population,
      bedsPer10k: Math.round(s.bedsPer10k * 10) / 10,
      utilAvg: utilAvg != null ? Math.round(utilAvg * 10) / 10 : null,
      specialistDepth: specDepth,
      opportunityScore,
    };
  });
  corridorRows.sort((a, b) => b.opportunityScore - a.opportunityScore);
  corridorRows.forEach((c, i) => {
    c.rank = i + 1;
  });
  const corridors = corridorRows.slice(0, 10);

  const topHosp = hospitals[0];
  const topState = corridorRows[0]?.state ?? "Selangor";
  const highUtil = utilization[0];

  const narrative = {
    talent: topHosp
      ? `${topHosp.name} anchors one of the deepest NSR-matched specialist concentrations in the dataset, supporting premium service positioning where catchment depth aligns with private capacity.`
      : "Specialist accessibility remains concentrated where private licensed beds overlap the NSR establishment graph.",
    supply: highUtil
      ? `Public non-ICU pressure exceeds ${Math.round(highUtil.utilNonIcu ?? 0)}% in parts of the MOH panel (${highUtil.hospital}), tightening spillover demand into adjacent private corridors.`
      : "Utilisation telemetry from the MOH panel highlights uneven stress across states — outer Klang Valley and growth states warrant corridor-level diligence.",
    corridors: `${topState} and peer growth states score highest on the composite opportunity index, combining income momentum, public utilisation, and measured private bed depth per capita.`,
  };

  return {
    generatedAt: new Date().toISOString(),
    specialtyTotals,
    hospitals,
    specialistPoints,
    stateBeds,
    utilization,
    corridors,
    narrative,
  };
}

/**
 * On Vercel, NSR ingestion is baked at build (`npm run intel:payload`) — avoid serverless timeouts/OOM at cold start.
 * Locally the full compute walks 20.8k NSR rows (tens of seconds); set `INTELLIGENCE_USE_PREBUILT=1`
 * to serve the pre-built snapshot instead.
 */
export async function loadIntelligencePayload(): Promise<IntelligencePayload> {
  const usePrebuilt = process.env.VERCEL === "1" || process.env.INTELLIGENCE_USE_PREBUILT === "1";
  if (usePrebuilt) {
    const raw = await readFile(dataPath("intelligence-payload.production.json"), "utf8");
    return JSON.parse(raw) as IntelligencePayload;
  }
  return computeIntelligencePayload();
}

function titleCaseState(s: string): string {
  const t = s.trim().toLowerCase();
  const map: Record<string, string> = {
    johor: "Johor",
    kedah: "Kedah",
    kelantan: "Kelantan",
    melaka: "Melaka",
    "negeri sembilan": "Negeri Sembilan",
    pahang: "Pahang",
    perak: "Perak",
    perlis: "Perlis",
    "pulau pinang": "Pulau Pinang",
    sabah: "Sabah",
    sarawak: "Sarawak",
    selangor: "Selangor",
    terengganu: "Terengganu",
    "wilayah persekutuan (kuala lumpur)": "W.P. Kuala Lumpur",
    "wilayah persekutuan (labuan)": "W.P. Labuan",
    "wilayah persekutuan (putrajaya)": "W.P. Putrajaya",
    "wp kuala lumpur": "W.P. Kuala Lumpur",
  };
  return map[t] ?? s.replace(/\b\w/g, (c) => c.toUpperCase());
}
