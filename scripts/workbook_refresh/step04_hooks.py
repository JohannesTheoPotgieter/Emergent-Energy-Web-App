"""
Step 04: Hooks

Scans client/src/hooks/*.ts[x] and refreshes the 'Hooks' sheet.
Preserves Friendly name / What it does / Tables touched for existing hooks.
"""
from __future__ import annotations

import os
import re
from _common import ROOT, open_wb, save_wb, snapshot, clear_data, write_rows, apply_autofilter


def scan_hooks():
    hooks_dir = os.path.join(ROOT, "client", "src", "hooks")
    out = []
    for f in sorted(os.listdir(hooks_dir)):
        if not (f.endswith(".ts") or f.endswith(".tsx")):
            continue
        if f.startswith("index."):
            continue
        name = re.sub(r"\.(ts|tsx)$", "", f)
        out.append({"name": name, "file": f"client/src/hooks/{f}"})
    return out


def main():
    hooks = scan_hooks()
    print(f"Found {len(hooks)} hooks")

    wb = open_wb()
    ws = wb["Hooks"]
    # Headers: Hook name | Friendly name | What it does | Tables touched | File
    existing = snapshot(ws, key_col=1, value_cols={2: "friendly", 3: "desc", 4: "tables"})
    clear_data(ws)

    rows = []
    preserved = new = 0
    for h in hooks:
        if h["name"] in existing:
            e = existing[h["name"]]
            friendly = e["friendly"]
            desc = e["desc"]
            tables = e["tables"]
            preserved += 1
        else:
            friendly = h["name"].replace("use-", "").replace("-", " ").capitalize()
            desc = "(NEW — added since last workbook alignment)"
            tables = ""
            new += 1
        rows.append([h["name"], friendly, desc, tables, h["file"]])

    write_rows(ws, rows)
    apply_autofilter(ws, 1 + len(rows))
    save_wb(wb)
    print(f"Hooks refreshed: {len(rows)} rows ({preserved} preserved, {new} new)")

    current = {h["name"] for h in hooks}
    for n in sorted(current - set(existing.keys())):
        print(f"  + {n}")
    for n in sorted(set(existing.keys()) - current):
        print(f"  - {n}")


if __name__ == "__main__":
    main()
