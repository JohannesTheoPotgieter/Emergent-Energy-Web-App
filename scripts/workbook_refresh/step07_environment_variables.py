"""
Step 07: Environment Variables

Scans the repo for process.env.X references and refreshes the 'Environment
Variables' sheet. Preserves 'Friendly name' and 'Purpose' for existing vars,
and always refreshes the reference count + first-files-referencing list.
"""
from __future__ import annotations

import os
import re
from collections import defaultdict
from _common import ROOT, open_wb, save_wb, snapshot, clear_data, write_rows, apply_autofilter


EXTS = (".ts", ".tsx", ".js", ".mjs", ".cjs")


def scan_env_vars():
    refs = defaultdict(list)
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git", "dist", "build", ".next")]
        for fname in filenames:
            if not fname.endswith(EXTS):
                continue
            rel = os.path.relpath(os.path.join(dirpath, fname), ROOT)
            try:
                with open(os.path.join(dirpath, fname), encoding="utf-8", errors="ignore") as fh:
                    for lno, ln in enumerate(fh, start=1):
                        for m in re.finditer(r"process\.env\.(\w+)", ln):
                            refs[m.group(1)].append((rel, lno))
            except Exception:
                continue
    return refs


def main():
    refs = scan_env_vars()
    vars_sorted = sorted(refs.keys())
    print(f"Found {len(vars_sorted)} env vars referenced")

    wb = open_wb()
    ws = wb["Environment Variables"]
    # Headers: Variable | Friendly name | Purpose | Reference count | First files referencing
    existing = snapshot(ws, key_col=1, value_cols={2: "friendly", 3: "purpose"})
    clear_data(ws)

    rows = []
    preserved = new = 0
    for var in vars_sorted:
        file_set = sorted({f for f, _ in refs[var]})
        first = ", ".join(file_set[:3])
        if len(file_set) > 3:
            first += f" (+{len(file_set) - 3} more)"
        if var in existing and existing[var]["purpose"]:
            friendly = existing[var]["friendly"] or var.replace("_", " ").title()
            purpose = existing[var]["purpose"]
            preserved += 1
        else:
            friendly = var.replace("_", " ").title()
            purpose = "Environment variable referenced in code."
            new += 1
        rows.append([var, friendly, purpose, len(refs[var]), first])

    write_rows(ws, rows)
    apply_autofilter(ws, 1 + len(rows))
    save_wb(wb)
    print(f"Environment Variables refreshed: {len(rows)} rows ({preserved} preserved, {new} new)")


if __name__ == "__main__":
    main()
