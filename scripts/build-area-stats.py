"""
Build src/lib/area-stats.ts from the DOSM parquet files in data/.

    pip install pandas pyarrow
    python scripts/build-area-stats.py
"""

import json
import os
import re
import sys

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
BORDERS = os.path.join(ROOT, "public", "data", "malaysia")
YEAR = "2024-01-01"

# Naming differences between DOSM and the boundary file.
STATE_ALIAS = {"wpklumpur": "wpkualalumpur"}
DISTRICT_ALIAS = {
    "sptengah": "seberangperaitengah",
    "sptutara": "seberangperaiutara",
    "sputara": "seberangperaiutara",
    "sptselatan": "seberangperaiselatan",
    "spselatan": "seberangperaiselatan",
    "larutmatang": "larutdanmatang",
    "hulu": "huluterengganu",
}


def slug(value):
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def state_key(name):
    key = slug(name)
    return STATE_ALIAS.get(key, key)


def district_key(name):
    key = slug(name)
    return DISTRICT_ALIAS.get(key, key)


def load(name):
    df = pd.read_parquet(os.path.join(DATA, name))
    df = df[(df.sex == "both") & (df.age == "overall") & (df.ethnicity == "overall")]
    df = df[df.date.astype(str) == YEAR]
    return df


def geojson(name):
    with open(os.path.join(BORDERS, name), encoding="utf-8") as handle:
        return json.load(handle)["features"]


def report(label, features, lookup):
    hit, miss = 0, []
    for feature in features:
        props = feature["properties"]
        if lookup(props) is None:
            miss.append(props.get("name") or props.get("parlimen") or props.get("dun"))
        else:
            hit += 1
    print(f"{label}: {hit}/{len(features)} matched")
    if miss:
        print("   miss:", " | ".join(str(m) for m in miss[:12]))


districts = load("population_district.parquet")
dun = load("population_dun (2).parquet")
parlimen = load("population_parlimen.parquet")

DISTRICT_POP = {
    f"{state_key(row.state)}|{district_key(row.district)}": round(float(row.population) * 1000)
    for row in districts.itertuples()
}

DUN_POP = {
    f"{state_key(row.state)}|{slug(row.dun)}": round(float(row.population) * 1000)
    for row in dun.itertuples()
}

PARLIMEN_POP = {slug(row.parlimen): round(float(row.population) * 1000) for row in parlimen.itertuples()}

# State totals = the sum of their districts, so every level is the same vintage.
STATE_POP = {}
for row in districts.itertuples():
    key = state_key(row.state)
    STATE_POP[key] = STATE_POP.get(key, 0) + round(float(row.population) * 1000)

STATE_NAME_BY_CODE = {}
for feature in geojson("malaysia.state.geojson"):
    props = feature["properties"]
    STATE_NAME_BY_CODE[props["state"]] = props["name"]

# Free the frames before loading the (large) boundary files.
import gc

del districts, dun, parlimen
gc.collect()

report("state", geojson("malaysia.state.geojson"), lambda p: STATE_POP.get(state_key(p["name"])))
report(
    "district",
    geojson("malaysia.district.geojson"),
    lambda p: DISTRICT_POP.get(f"{state_key(STATE_NAME_BY_CODE.get(p['state'], ''))}|{district_key(p['name'])}"),
)
report("parlimen", geojson("malaysia.parlimen.geojson"), lambda p: PARLIMEN_POP.get(slug(p["parlimen"])))
report("dun", geojson("malaysia.dun.geojson"), lambda p: DUN_POP.get(f"{state_key(p['state'])}|{slug(p['dun'])}"))


def block(name, mapping, comment):
    rows = "\n".join(
        f"  {json.dumps(k)}: {v}," for k, v in sorted(mapping.items())
    )
    return f"/** {comment} */\nexport const {name}: Record<string, number> = {{\n{rows}\n}};\n"


def strings(name, mapping, comment):
    rows = "\n".join(f"  {json.dumps(k)}: {json.dumps(v)}," for k, v in sorted(mapping.items()))
    return f"/** {comment} */\nexport const {name}: Record<string, string> = {{\n{rows}\n}};\n"


out = f'''/**
 * Area population for the choropleth — generated from the DOSM parquet files in `data/`.
 *
 *   district    {len(DISTRICT_POP)} areas
 *   DUN         {len(DUN_POP)} seats
 *   parliament  {len(PARLIMEN_POP)} seats
 *   state       {len(STATE_POP)} (summed from districts)
 *   year        {YEAR[:4]}
 *
 * All values are persons. Keys are slugged: `state`, `state|district`,
 * `state|dun`, or the parliament name on its own.
 *
 * Regenerate with: python scripts/build-area-stats.py
 */

export const POPULATION_YEAR = "{YEAR[:4]}";

{block("STATE_POPULATION", STATE_POP, "State slug → population.")}
{block("DISTRICT_POPULATION", DISTRICT_POP, "`state|district` → population.")}
{block("DUN_POPULATION", DUN_POP, "`state|dun` → population.")}
{block("PARLIMEN_POPULATION", PARLIMEN_POP, "Parliament slug → population.")}
{strings("STATE_NAME_BY_CODE", STATE_NAME_BY_CODE, "Boundary state code (SGR, KDH …) → state name.")}

export const slugKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const STATE_ALIAS: Record<string, string> = {{ wpklumpur: "wpkualalumpur" }};

export const stateKey = (name: string) => STATE_ALIAS[slugKey(name)] ?? slugKey(name);

export const districtKey = (state: string, district: string) =>
  `${{stateKey(state)}}|${{slugKey(district)}}`;

export const dunKey = (state: string, dun: string) => `${{stateKey(state)}}|${{slugKey(dun)}}`;
'''

target = os.path.join(ROOT, "src", "lib", "area-stats.ts")
with open(target, "w", encoding="utf-8", newline="\n") as handle:
    handle.write(out)

print(f"\nwrote {target}")
