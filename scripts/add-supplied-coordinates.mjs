import fs from "node:fs";

const path = "data/asiaone-locations.json";
const rows = JSON.parse(fs.readFileSync(path, "utf8"));

// Supplied coordinates (OSM / Nominatim) for the six addresses that could not be
// matched automatically. `precision` drives the marker note in the UI.
const SUPPLIED = {
  "columbia-asia-binh-duong": {
    lat: 10.9512013,
    lng: 106.7070829,
    precision: "exact",
    note: "The hospital itself, on Đường 22 Tháng 12.",
  },
  "tags-cheras": {
    lat: 3.1228929,
    lng: 101.7299483,
    precision: "good",
    note: "Tower 2 car park; the tower is about 100 m away.",
  },
  "tags-hartamas": {
    lat: 3.1614169,
    lng: 101.6502533,
    precision: "street",
    note: "Galeria Hartamas is on Jalan 26A/70A; OSM has no building feature here.",
  },
  "tags-johor-bahru": {
    lat: 1.4807367,
    lng: 103.7600896,
    precision: "approximate",
    note: "Dewanraya Taman Century; expect a few hundred metres of error.",
  },
  "tags-penang": {
    lat: 5.3944698,
    lng: 100.3028578,
    precision: "good",
    note: "30 Jalan Masjid Negeri, Greenlane.",
  },
  "tags-seremban": {
    lat: 2.6946589,
    lng: 101.9110870,
    precision: "good",
    note: "Jalan S2 B12, Uptown Avenue, Seremban 2.",
  },
};

const PRECISION_FROM_CONFIDENCE = {
  high: "exact",
  medium: "street",
  low: "approximate",
  none: "approximate",
};

let patched = 0;
for (const row of rows) {
  const supplied = SUPPLIED[row.id];
  const precision =
    supplied?.precision ??
    (row.geocode?.precision ??
      PRECISION_FROM_CONFIDENCE[row.geocode?.confidence ?? "none"] ??
      "approximate");

  if (supplied) {
    row.lat = supplied.lat;
    row.lng = supplied.lng;
    row.geocode = {
      query: row.address,
      source: "osm-supplied",
      type: "manual",
      label: supplied.note,
      confidence: supplied.precision,
      precision: supplied.precision,
      note: supplied.note,
    };
    patched++;
  } else {
    row.geocode.precision = precision;
    row.geocode.precisionNote = row.geocode.label ?? "";
  }
}

fs.writeFileSync(path, JSON.stringify(rows, null, 2));

const header = [
  "id", "name", "country", "state", "address", "lat", "lng", "phone", "email", "website",
  "geocode_confidence", "geocode_type", "geocode_label", "inside_state", "precision",
];
const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const csv = [
  header.join(","),
  ...rows.map((r) =>
    [
      r.id, r.name, r.country, r.state, r.address, r.lat ?? "", r.lng ?? "", r.phone, r.email,
      r.website, r.geocode.confidence, r.geocode.type, r.geocode.label,
      r.validation?.insideState ?? "", r.geocode.precision ?? "",
    ].map(esc).join(","),
  ),
].join("\r\n");
fs.writeFileSync("data/asiaone-locations.csv", csv);

const withCoords = rows.filter((r) => r.lat != null).length;
console.log(`patched ${patched}; ${withCoords}/${rows.length} now have coordinates`);
console.log(rows.filter((r) => r.geocode.precision !== "exact").map((r) => `${r.name} (${r.geocode.precision})`).join("\n"));
