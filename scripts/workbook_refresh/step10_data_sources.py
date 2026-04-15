"""
Step 10: Data Sources

Scans server/**/*.ts for Express route registrations
(app|router|r).get|post|put|patch|delete(path, ...) and refreshes the
'Data Sources' sheet. Preserves the Area + Friendly name columns for any
(METHOD, URL) pair that still exists.
"""
from __future__ import annotations

import re
from _common import ROOT, open_wb, save_wb, clear_data, write_rows, apply_autofilter, walk_files


ROUTE_RE = re.compile(
    r'\b(?:app|router|r)\.(get|post|put|patch|delete|all|use)\s*\(\s*[`\'"]([^`\'"]+)[`\'"]',
    re.I,
)


def scan_routes():
    routes = set()
    for rel in walk_files("server", (".ts",)):
        with open(f"{ROOT}/{rel}", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        for m in ROUTE_RE.finditer(content):
            method = m.group(1).upper()
            path = m.group(2)
            if method == "USE":
                continue  # mount points, not endpoints
            # Only keep routes that look like API paths
            if not path.startswith("/"):
                continue
            routes.add((method, path))
    return sorted(routes, key=lambda x: (x[1], x[0]))


def main():
    routes = scan_routes()
    print(f"Found {len(routes)} unique (method, path) routes in server/")

    wb = open_wb()
    ws = wb["Data Sources"]
    # Headers: Area | Friendly name | Read / Write | Method | URL path (technical)
    # Snapshot existing by (method, path) key
    existing = {}
    for r in range(2, ws.max_row + 1):
        method = ws.cell(row=r, column=4).value
        path = ws.cell(row=r, column=5).value
        if not (method and path):
            continue
        existing[(method, path)] = {
            "area": ws.cell(row=r, column=1).value or "",
            "friendly": ws.cell(row=r, column=2).value or "",
            "rw": ws.cell(row=r, column=3).value or "",
        }

    clear_data(ws)

    def rw_for(method):
        return "Read" if method == "GET" else "Write"

    def infer_area(path):
        # /api/<segment>/... — use the first segment after /api/
        parts = [p for p in path.split("/") if p]
        if len(parts) >= 2 and parts[0] == "api":
            seg = parts[1]
            return seg.replace("-", " ").replace("_", " ").title()
        return "Other"

    rows = []
    preserved = new = 0
    for method, path in routes:
        key = (method, path)
        if key in existing and (existing[key]["area"] or existing[key]["friendly"]):
            e = existing[key]
            area = e["area"] or infer_area(path)
            friendly = e["friendly"]
            rw = e["rw"] or rw_for(method)
            preserved += 1
        else:
            area = infer_area(path)
            friendly = ""
            rw = rw_for(method)
            new += 1
        rows.append([area, friendly, rw, method, path])

    write_rows(ws, rows)
    apply_autofilter(ws, 1 + len(rows))
    save_wb(wb)
    print(f"Data Sources refreshed: {len(rows)} rows ({preserved} preserved, {new} new)")

    current = set(routes)
    old = set(existing.keys())
    added = sorted(current - old)
    removed = sorted(old - current)
    print(f"  + {len(added)} new endpoints")
    print(f"  - {len(removed)} removed endpoints")


if __name__ == "__main__":
    main()
