"""
Step 02: SQL Migrations

Scans migrations/*.sql and refreshes the 'SQL Migrations' sheet.
Fully mechanical — extracts headline (first -- comment or non-blank line),
tables touched (CREATE/ALTER/DROP/INSERT/UPDATE/DELETE), line count.
"""
from __future__ import annotations

import os
import re
from _common import ROOT, open_wb, save_wb, clear_data, write_rows, apply_autofilter


def scan_migrations():
    mig_dir = os.path.join(ROOT, "migrations")
    out = []
    for fname in sorted(os.listdir(mig_dir)):
        if not fname.endswith(".sql"):
            continue
        path = f"migrations/{fname}"
        with open(os.path.join(ROOT, path)) as fh:
            content = fh.read()
        lines = content.splitlines()

        headline = ""
        for ln in lines:
            s = ln.strip()
            if not s:
                continue
            if s.startswith("--"):
                # Skip ascii dividers like -------
                stripped = s.lstrip("-").strip()
                if not stripped:
                    continue
                headline = stripped
                break
            headline = s[:140]
            break

        date_m = re.match(r"^(\d+)", fname)
        date_prefix = date_m.group(1) if date_m else ""

        tables = set()
        for m in re.finditer(r'\b(?:CREATE|ALTER|DROP)\s+TABLE(?:\s+IF\s+(?:NOT\s+)?EXISTS)?\s+"?(\w+)"?', content, re.I):
            tables.add(m.group(1))
        for m in re.finditer(r'\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?(\w+)"?', content, re.I):
            tables.add(m.group(1))
        tables_str = ", ".join(sorted(tables))
        if len(tables_str) > 250:
            tables_str = tables_str[:247] + "..."

        out.append({
            "file": fname,
            "date": date_prefix,
            "headline": headline[:200] if headline else "(no headline)",
            "tables": tables_str,
            "lines": len(lines),
            "path": path,
        })
    return out


def main():
    migs = scan_migrations()
    print(f"Found {len(migs)} migrations")

    wb = open_wb()
    ws = wb["SQL Migrations"]
    clear_data(ws)
    rows = [[m["file"], m["date"], m["headline"], m["tables"], m["lines"], m["path"]] for m in migs]
    write_rows(ws, rows)
    apply_autofilter(ws, 1 + len(rows))
    save_wb(wb)
    print(f"SQL Migrations refreshed: {len(rows)} rows")


if __name__ == "__main__":
    main()
