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

Output is a flat array of `Food`-shaped objects (per-100g macros + the macro
breakdown CIQUAL provides). It is fetched lazily at runtime by the food search
(see lib/ciqual.ts), so it never enters the JS bundle. Micronutrients are a
deliberate follow-up — kept out of v1 to bound the payload.
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
OUT = Path(__file__).resolve().parent.parent / "public" / "ciqual-database.json"


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

    OUT.write_text(
        json.dumps(foods, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    size_kb = round(OUT.stat().st_size / 1024)
    print(f"wrote {len(foods)} foods ({dropped} dropped) -> {OUT} ({size_kb} KB)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: build-ciqual.py <path-to-ciqual.xls>")
    main(sys.argv[1])
