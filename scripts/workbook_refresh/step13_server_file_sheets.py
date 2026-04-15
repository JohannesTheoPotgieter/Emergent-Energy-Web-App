"""
Step 13: Server Departments / Services / Repositories / Middleware

Enumerates files in server/departments, server/services, server/repositories,
server/middleware and refreshes the matching sheets. Preserves the human-
authored Purpose (or equivalent) column for files whose path still exists.
"""
from __future__ import annotations

import os
import re
from _common import ROOT, open_wb, save_wb, snapshot, clear_data, write_rows, apply_autofilter


def count_endpoints(content: str) -> int:
    return len(re.findall(
        r'\b(?:app|router|r)\.(get|post|put|patch|delete)\s*\(\s*[`\'"]',
        content, re.I,
    ))


def exports_from(content: str) -> str:
    names = set()
    for m in re.finditer(r'export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)', content):
        names.add(m.group(1))
    for m in re.finditer(r'export\s+default\s+(?:async\s+)?(?:function|class)\s*(\w+)?', content):
        if m.group(1):
            names.add(m.group(1))
    lst = sorted(names)[:8]
    return ", ".join(lst) + (f" (+{len(names)-8} more)" if len(names) > 8 else "")


def tables_referenced(content: str, table_ids: set[tuple[str, str]]) -> str:
    tables = set()
    for js, sql in table_ids:
        if re.search(rf"\b{re.escape(js)}\b", content):
            tables.add(sql)
    lst = sorted(tables)
    s = ", ".join(lst)
    if len(s) > 250:
        s = s[:247] + "..."
    return s


def load_drizzle_table_names() -> set[tuple[str, str]]:
    from _common import walk_files
    names = set()
    for rel in walk_files("shared", (".ts",)):
        with open(f"{ROOT}/{rel}", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        for m in re.finditer(r'export const (\w+) = pgTable\(\s*"([\w_]+)"', content):
            names.add((m.group(1), m.group(2)))
    return names


def list_ts_files(subdir: str):
    base = f"{ROOT}/server/{subdir}"
    if not os.path.isdir(base):
        return []
    out = []
    for fname in sorted(os.listdir(base)):
        if not fname.endswith(".ts"):
            continue
        out.append(fname)
    return out


TABLE_IDS = load_drizzle_table_names()


def refresh_departments(wb):
    ws = wb["Server Departments"]
    # Headers: Friendly name | Key | Purpose | Endpoints | Lines | File
    existing = snapshot(ws, key_col=6, value_cols={1: "friendly", 3: "purpose"})
    clear_data(ws)

    files = list_ts_files("departments")
    rows = []
    preserved = new = 0
    for fname in files:
        rel = f"server/departments/{fname}"
        with open(f"{ROOT}/{rel}", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        lines = content.splitlines()
        key = fname.replace(".ts", "")
        e = existing.get(rel, {})
        friendly = e.get("friendly", "") or key.replace("-", " ").replace("_", " ").title()
        purpose = e.get("purpose", "") or f"Department routes module: {key}."
        if e.get("purpose"):
            preserved += 1
        else:
            new += 1
        rows.append([friendly, key, purpose, count_endpoints(content), len(lines), rel])
    write_rows(ws, rows)
    apply_autofilter(ws, 1 + len(rows))
    print(f"Server Departments: {len(rows)} rows ({preserved} preserved, {new} new)")


def refresh_services(wb):
    ws = wb["Server Services"]
    # Headers: Friendly name | Key | Purpose | Exports | Tables touched | Lines | File
    existing = snapshot(ws, key_col=7, value_cols={1: "friendly", 3: "purpose"})
    clear_data(ws)

    files = list_ts_files("services")
    rows = []
    preserved = new = 0
    for fname in files:
        rel = f"server/services/{fname}"
        with open(f"{ROOT}/{rel}", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        lines = content.splitlines()
        key = fname.replace(".ts", "")
        e = existing.get(rel, {})
        friendly = e.get("friendly", "") or key.replace("-", " ").replace("_", " ").title()
        purpose = e.get("purpose", "") or f"Service module: {key}."
        if e.get("purpose"):
            preserved += 1
        else:
            new += 1
        rows.append([friendly, key, purpose, exports_from(content),
                     tables_referenced(content, TABLE_IDS), len(lines), rel])
    write_rows(ws, rows)
    apply_autofilter(ws, 1 + len(rows))
    print(f"Server Services: {len(rows)} rows ({preserved} preserved, {new} new)")


def refresh_repositories(wb):
    ws = wb["Server Repositories"]
    # Headers: Friendly name | Key | Purpose | Exports | Tables touched | Lines | File
    existing = snapshot(ws, key_col=7, value_cols={1: "friendly", 3: "purpose"})
    clear_data(ws)

    files = list_ts_files("repositories")
    rows = []
    preserved = new = 0
    for fname in files:
        rel = f"server/repositories/{fname}"
        with open(f"{ROOT}/{rel}", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        lines = content.splitlines()
        key = fname.replace(".ts", "")
        e = existing.get(rel, {})
        friendly = e.get("friendly", "") or key.replace("-", " ").replace("_", " ").title()
        purpose = e.get("purpose", "") or f"Repository module: {key}."
        if e.get("purpose"):
            preserved += 1
        else:
            new += 1
        rows.append([friendly, key, purpose, exports_from(content),
                     tables_referenced(content, TABLE_IDS), len(lines), rel])
    write_rows(ws, rows)
    apply_autofilter(ws, 1 + len(rows))
    print(f"Server Repositories: {len(rows)} rows ({preserved} preserved, {new} new)")


def refresh_middleware(wb):
    ws = wb["Middleware"]
    # Headers: Middleware | Key | What it does | Exports | File size (lines) | File
    existing = snapshot(ws, key_col=6, value_cols={1: "friendly", 3: "desc"})
    clear_data(ws)

    files = list_ts_files("middleware")
    rows = []
    preserved = new = 0
    for fname in files:
        rel = f"server/middleware/{fname}"
        with open(f"{ROOT}/{rel}", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        lines = content.splitlines()
        key = fname.replace(".ts", "")
        e = existing.get(rel, {})
        friendly = e.get("friendly", "") or key.replace("-", " ").replace("_", " ").title()
        desc = e.get("desc", "") or f"Middleware module: {key}."
        if e.get("desc"):
            preserved += 1
        else:
            new += 1
        rows.append([friendly, key, desc, exports_from(content), len(lines), rel])
    write_rows(ws, rows)
    apply_autofilter(ws, 1 + len(rows))
    print(f"Middleware: {len(rows)} rows ({preserved} preserved, {new} new)")


def main():
    wb = open_wb()
    refresh_departments(wb)
    refresh_services(wb)
    refresh_repositories(wb)
    refresh_middleware(wb)
    save_wb(wb)


if __name__ == "__main__":
    main()
