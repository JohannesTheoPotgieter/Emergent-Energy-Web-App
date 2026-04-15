"""
Step 11: Server Handlers

Scans server/**/*.ts for route registrations and records method, path, file,
and line number. Also does a simple scan for drizzle table identifiers used
in the same file (for 'Tables touched'). Fully mechanical refresh.
"""
from __future__ import annotations

import os
import re
from _common import ROOT, open_wb, save_wb, clear_data, write_rows, apply_autofilter, walk_files


ROUTE_RE = re.compile(
    r'\b(?:app|router|r)\.(get|post|put|patch|delete)\s*\(\s*[`\'"]([^`\'"]+)[`\'"]',
    re.I,
)


def load_drizzle_table_names() -> set[str]:
    """Read shared/**/*.ts for exported drizzle table JS identifiers."""
    names = set()
    for rel in walk_files("shared", (".ts",)):
        with open(f"{ROOT}/{rel}", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        for m in re.finditer(r'export const (\w+) = pgTable\(\s*"([\w_]+)"', content):
            names.add((m.group(1), m.group(2)))
    return names


def main():
    table_ids = load_drizzle_table_names()  # {(jsName, sqlName)}
    js_to_sql = {js: sql for js, sql in table_ids}

    handlers = []
    for rel in walk_files("server", (".ts",)):
        full = f"{ROOT}/{rel}"
        with open(full, encoding="utf-8", errors="ignore") as f:
            content = f.read()
        lines = content.splitlines()

        # Find tables referenced anywhere in the file (by JS drizzle name)
        file_tables = set()
        for js, sql in table_ids:
            # Match the JS name as a whole word
            if re.search(rf"\b{re.escape(js)}\b", content):
                file_tables.add(sql)
        tables_str = ", ".join(sorted(file_tables))
        if len(tables_str) > 300:
            tables_str = tables_str[:297] + "..."

        # Find each route + line
        for i, ln in enumerate(lines, start=1):
            m = ROUTE_RE.search(ln)
            if not m:
                continue
            method = m.group(1).upper()
            path = m.group(2)
            if not path.startswith("/"):
                continue
            handlers.append({
                "method": method,
                "path": path,
                "file": rel,
                "line": i,
                "tables": tables_str,
            })

    handlers.sort(key=lambda h: (h["path"], h["method"], h["file"], h["line"]))
    print(f"Found {len(handlers)} server handler rows")

    wb = open_wb()
    ws = wb["Server Handlers"]
    clear_data(ws)
    # Headers: Method | URL path | Source file | Line | Tables touched (from file scan)
    rows = [[h["method"], h["path"], h["file"], h["line"], h["tables"]] for h in handlers]
    write_rows(ws, rows)
    apply_autofilter(ws, 1 + len(rows))
    save_wb(wb)
    print(f"Server Handlers refreshed: {len(rows)} rows")


if __name__ == "__main__":
    main()
