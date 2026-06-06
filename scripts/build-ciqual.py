#!/usr/bin/env python3
"""Generate public/ciqual-database.json from the ANSES-CIQUAL 2020 table.

Source data: ANSES-CIQUAL 2020 food composition table (English edition),
published under the Etalab Open Licence (Licence Ouverte). Attribution:
"Source: ANSES-CIQUAL". https://ciqual.anses.fr

The XLS is NOT vendored (3.6 MB binary). Download it, then run this script:

    curl -sL -o /tmp/ciqual.xls \\
      "https://zenodo.org/records/4770202/files/Table%20Ciqual%202020_ENG_2020%2007%2007.xls?download=1"
    python3 -m venv /tmp/cqenv && /tmp/cqenv/bin/pip install xlrd
    /tmp/cqenv/bin/python scripts/build-ciqual.py /tmp/ciqual.xls

Outputs two files:
  - public/ciqual-database.json — `Food`-shaped objects (per-100g macros + the
    macro breakdown). Fetched lazily by the food-search typeahead
    (lib/ciqual.ts), so it never enters the JS bundle and stays lean (no micros
    — the typeahead doesn't use them).
  - public/ciqual-micronutrients.json — `{ name, micronutrients }` rows in each
    nutrient's canonical unit (g/mg/µg per 100g, matching packages/core/src/rda),
    read server-side by the enrich-micronutrients cron.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import xlrd  # type: ignore[import-untyped]  # dev-only; see module docstring

# Column indices in the single 'compo' sheet.
COLS = {
    "code": 6,
    "name": 7,
    "group": 3,
    "kcal": 10,
    "protein": 14,
    "carbs": 16,
    "fat": 17,
    "sugars": 18,
    "fiber": 26,
    "saturatedFat": 31,
    "monoFat": 32,
    "polyFat": 33,
}
BREAKDOWN = ("sugars", "fiber", "saturatedFat", "monoFat", "polyFat")
# Micronutrients → MicronutrientValues keys (packages/core/src/rda.ts). CIQUAL's
# columns are already in each key's canonical unit (g/mg/µg per 100g), so values
# map straight across — no scaling, unlike the OFF base-SI grams path.
MICRO_COLS = {
    "fiber": 26,
    "sodium": 60,
    "potassium": 58,
    "calcium": 50,
    "iron": 53,
    "magnesium": 55,
    "zinc": 61,
    "vitaminC": 68,
    "vitaminD": 64,
    "vitaminB12": 75,
}
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "ciqual-database.json"
MICRO_OUT = ROOT / "public" / "ciqual-micronutrients.json"


def parse(value: object) -> float | None:
    """A CIQUAL cell to a float, or None when not measured.

    Decimals use a comma; '-' / '' mean "not measured"; 'traces' and '< X'
    (below the quantification limit) are treated as 0.
    """
    s = str(value).strip()
    if not s or s == "-":
        return None
    if s.lower() == "traces" or s.startswith("<"):
        return 0.0
    try:
        return float(s.replace(",", ".").replace(" ", ""))
    except ValueError:
        return None


def rnd(x: float | None) -> float | None:
    return round(x, 2) if x is not None else None


def main(xls_path: str) -> None:
    sheet = xlrd.open_workbook(xls_path).sheet_by_index(0)
    foods: list[dict[str, object]] = []
    micros_out: list[dict[str, object]] = []
    dropped = 0

    for r in range(1, sheet.nrows):
        cell = lambda key: parse(sheet.cell_value(r, COLS[key]))  # noqa: E731
        protein, carbs, fat = cell("protein"), cell("carbs"), cell("fat")
        kcal = cell("kcal")
        if kcal is None:
            if protein is None and carbs is None and fat is None:
                dropped += 1
                continue  # no usable nutrition
            # Derive from Atwater factors when the regulation energy is absent.
            kcal = (protein or 0) * 4 + (carbs or 0) * 4 + (fat or 0) * 9

        code = int(float(sheet.cell_value(r, COLS["code"])))
        food: dict[str, object] = {
            "id": f"ciqual:{code}",
            "name": str(sheet.cell_value(r, COLS["name"])).strip(),
            "calories": rnd(kcal),
            "protein": rnd(protein or 0),
            "carbs": rnd(carbs or 0),
            "fat": rnd(fat or 0),
        }
        group = str(sheet.cell_value(r, COLS["group"])).strip()
        if group:
            food["category"] = group
        for key in BREAKDOWN:
            val = rnd(cell(key))
            if val is not None:
                food[key] = val
        foods.append(food)

        # Micronutrients go to a separate file — the food-search typeahead
        # (which fetches ciqual-database.json) never reads them, so bundling them
        # there would only bloat that fetch. The enrich cron reads this instead.
        micros: dict[str, float] = {}
        for key, col in MICRO_COLS.items():
            val = rnd(parse(sheet.cell_value(r, col)))
            if val is not None:
                micros[key] = val
        if micros:
            micros_out.append({"name": food["name"], "micronutrients": micros})

    OUT.write_text(
        json.dumps(foods, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    MICRO_OUT.write_text(
        json.dumps(micros_out, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    size_kb = round(OUT.stat().st_size / 1024)
    micro_kb = round(MICRO_OUT.stat().st_size / 1024)
    print(f"wrote {len(foods)} foods ({dropped} dropped) -> {OUT} ({size_kb} KB)")
    print(f"wrote {len(micros_out)} micro rows -> {MICRO_OUT} ({micro_kb} KB)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: build-ciqual.py <path-to-ciqual.xls>")
    main(sys.argv[1])
