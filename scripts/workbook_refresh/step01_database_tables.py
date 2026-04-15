"""
Step 01: Database Tables

Scans shared/**/*.ts for `export const X = pgTable("name", ...)` and refreshes
the 'Database Tables' sheet. Preserves the human-authored Domain/Friendly/
Description columns for any SQL table that still exists.
"""
from __future__ import annotations

import re
from _common import ROOT, open_wb, save_wb, snapshot, clear_data, write_rows, apply_autofilter, walk_files


def scan_tables():
    tables = []
    for rel in walk_files("shared", (".ts",)):
        with open(f"{ROOT}/{rel}") as f:
            content = f.read()
        for m in re.finditer(r'export const (\w+) = pgTable\(\s*"([\w_]+)"', content):
            tables.append({"js": m.group(1), "sql": m.group(2), "file": rel})
    return tables


def main():
    tables = scan_tables()
    print(f"Found {len(tables)} tables in shared/")

    wb = open_wb()
    ws = wb["Database Tables"]
    # Headers: Domain / Area | Technical Name (SQL) | Friendly Name | Plain-English Description | Code object | Schema file
    existing = snapshot(ws, key_col=2, value_cols={1: "domain", 3: "friendly", 4: "desc"})

    clear_data(ws)

    rows = []
    preserved = new = 0
    for t in sorted(tables, key=lambda x: x["sql"]):
        sql = t["sql"]
        if sql in existing:
            e = existing[sql]
            row = [e["domain"], sql, e["friendly"], e["desc"], t["js"], t["file"]]
            preserved += 1
        else:
            row = ["", sql, "", "(NEW — added since last workbook alignment)", t["js"], t["file"]]
            new += 1
        rows.append(row)

    write_rows(ws, rows)
    apply_autofilter(ws, 1 + len(rows))
    save_wb(wb)

    print(f"Database Tables refreshed: {len(rows)} rows ({preserved} preserved, {new} new)")
    current_sql = {t["sql"] for t in tables}
    for sql in current_sql - set(existing.keys()):
        print(f"  + {sql}")
    for sql in set(existing.keys()) - current_sql:
        print(f"  - {sql}")


if __name__ == "__main__":
    main()
