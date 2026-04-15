"""
Step 14: Status Enums

Scans shared/**/*.ts for pgEnum(...) declarations and refreshes the
'Status Enums' sheet. Fully mechanical.
"""
from __future__ import annotations

import re
from _common import ROOT, open_wb, save_wb, clear_data, write_rows, apply_autofilter, walk_files


# Matches both pgEnum("name", [...]) and pgEnum('name', [...]), multi-line arrays
PG_ENUM_RE = re.compile(
    r'pgEnum\(\s*[\'"]([\w_]+)[\'"]\s*,\s*\[([^\]]*)\]',
    re.S,
)

# Matches `export const FOO = ['a', 'b', 'c'] as const`
TS_TUPLE_RE = re.compile(
    r'export const (\w+)\s*=\s*\[([^\]]*)\]\s*as\s+const',
    re.S,
)


def scan_enums():
    out = []
    for rel in walk_files("shared", (".ts",)):
        with open(f"{ROOT}/{rel}", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        # Postgres enums
        for m in PG_ENUM_RE.finditer(content):
            sql_name = m.group(1)
            values_raw = m.group(2)
            values = [v.strip().strip('"').strip("'") for v in values_raw.split(",") if v.strip()]
            out.append({
                "name": sql_name,
                "kind": "Postgres enum",
                "values": ", ".join(values),
                "file": rel,
            })
        # TS const tuples (used as string literal unions)
        for m in TS_TUPLE_RE.finditer(content):
            name = m.group(1)
            values_raw = m.group(2)
            values = [v.strip().strip('"').strip("'") for v in values_raw.split(",") if v.strip()]
            if not values:
                continue
            # Only keep if all values look like string literals (simple heuristic)
            if not all(re.match(r'^[\w\s\-\.]*$', v) for v in values):
                continue
            out.append({
                "name": name,
                "kind": "TS const tuple",
                "values": ", ".join(values),
                "file": rel,
            })
    out.sort(key=lambda x: (x["kind"], x["file"], x["name"]))
    return out


def main():
    enums = scan_enums()
    print(f"Found {len(enums)} pgEnum declarations")

    wb = open_wb()
    ws = wb["Status Enums"]
    # Headers: Enum name | Kind | Values | Defined in
    clear_data(ws)
    rows = [[e["name"], e["kind"], e["values"], e["file"]] for e in enums]
    write_rows(ws, rows)
    apply_autofilter(ws, 1 + len(rows))
    save_wb(wb)
    print(f"Status Enums refreshed: {len(rows)} rows")


if __name__ == "__main__":
    main()
