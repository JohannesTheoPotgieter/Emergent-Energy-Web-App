"""
Step 03: Components

Scans client/src/components/**/*.tsx and refreshes the 'Components' sheet.
Preserves the 'Purpose (inferred)' column for components whose file path
still exists.
"""
from __future__ import annotations

import os
from _common import ROOT, open_wb, save_wb, snapshot, clear_data, write_rows, apply_autofilter, walk_files


FOLDER_MAP = {
    "admin": "Admin",
    "tabs": "Tabs",
    "stage-workspaces": "Stage Workspaces",
    "ui": "UI primitives",
    "finance": "Finance",
    "engineering": "Engineering",
    "construction": "Construction",
    "quality": "Quality",
    "pm": "PM",
    "dashboard": "Dashboard",
    "project": "Project",
    "procurement": "Procurement",
    "layout": "Layout",
    "modals": "Modals",
    "forms": "Forms",
    "nav": "Navigation",
    "auth": "Auth",
    "inbox": "Inbox",
    "calendar": "Calendar",
    "tasks": "Tasks",
    "onboarding": "Onboarding",
    "action-launchpad": "Action launchpad",
    "launchpad": "Launchpad",
    "settings": "Settings",
    "commercial": "Commercial",
    "delivery": "Delivery",
    "people": "People",
    "customer": "Customer",
    "reports": "Reports",
    "kpi": "KPI",
    "hub": "Hub",
}


def scan_components():
    comps = []
    base = "client/src/components"
    for rel in walk_files(base, (".tsx",)):
        full = os.path.join(ROOT, rel)
        with open(full) as fh:
            lines = fh.read().splitlines()
        rel_folder = os.path.dirname(os.path.relpath(rel, base))
        if not rel_folder:
            folder = "Root"
        else:
            first = rel_folder.split(os.sep)[0]
            folder = FOLDER_MAP.get(first, first.replace("-", " ").capitalize())
        name = os.path.basename(rel).replace(".tsx", "")
        comps.append({"name": name, "folder": folder, "path": rel, "lines": len(lines)})
    return comps


def main():
    comps = scan_components()
    print(f"Found {len(comps)} components")

    wb = open_wb()
    ws = wb["Components"]
    # Headers: Component | Folder / Area | Path | File size (lines) | Purpose (inferred)
    existing = snapshot(ws, key_col=3, value_cols={5: "purpose"})
    clear_data(ws)

    comps.sort(key=lambda x: (x["folder"], x["name"]))
    rows = []
    preserved = new = 0
    for c in comps:
        purpose = existing.get(c["path"], {}).get("purpose", "")
        if purpose:
            preserved += 1
        else:
            purpose = f"{c['name'].replace('-', ' ')} — component in {c['folder']}."
            new += 1
        rows.append([c["name"], c["folder"], c["path"], c["lines"], purpose])

    write_rows(ws, rows)
    apply_autofilter(ws, 1 + len(rows))
    save_wb(wb)
    print(f"Components refreshed: {len(rows)} rows ({preserved} preserved purposes, {new} inferred)")


if __name__ == "__main__":
    main()
