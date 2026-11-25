export type SpecialtyBucket =
  | "cardiology"
  | "oncology"
  | "pediatrics"
  | "orthopedics"
  | "neurology"
  | "gastroenterology"
  | "other";

export type HospitalKind = "public" | "private";

export type IntelligenceHospital = {
  id: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
  kind: HospitalKind;
  bedsNonIcu: number | null;
  utilNonIcu: number | null;
  specialistTotal: number;
  bySpecialty: Record<SpecialtyBucket, number>;
  keySpecialties: string[];
  competitiveIntensity: number;
  distanceScore: number;
  talentAccessibilityScore: number;
  /** Sum of establishment-matched NSR specialist totals at hospitals within ~15km (same geography as overlay map clustering narrative). */
  specialistReach15Km: number;
};

export type SpecialistMapPoint = {
  lng: number;
  lat: number;
  bucket: SpecialtyBucket;
  hospitalId: string;
  label: string;
};

export type StateBedsRow = {
  state: string;
  population: number;
  bedsPublic: number;
  bedsPrivateProxy: number;
  bedsPer10k: number;
  incomeMedian: number | null;
  growthPct: number | null;
};

export type UtilizationRow = {
  hospital: string;
  state: string;
  bedsNonIcu: number | null;
  utilNonIcu: number | null;
  stress: number;
};

export type CorridorRow = {
  rank: number;
  area: string;
  state: string;
  population: number;
  bedsPer10k: number;
  utilAvg: number | null;
  specialistDepth: number;
  opportunityScore: number;
};

export type IntelligencePayload = {
  generatedAt: string;
  specialtyTotals: Record<SpecialtyBucket, number>;
  hospitals: IntelligenceHospital[];
  specialistPoints: SpecialistMapPoint[];
  stateBeds: StateBedsRow[];
  utilization: UtilizationRow[];
  corridors: CorridorRow[];
  narrative: {
    talent: string;
    supply: string;
    corridors: string;
  };
};
