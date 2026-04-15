"""
Step 09: Screens

Parses client/src/config/page-registry.ts and refreshes the 'Screens' sheet.
Preserves Purpose / Who uses it / Key information columns (which are the
human-authored narrative content) for URLs that still exist.

The registry entries are one-per-line, so we use a line-level regex (same
approach as the original scripts/build_system_map_workbook.py).
"""
from __future__ import annotations

import os
import re
from _common import ROOT, open_wb, save_wb, snapshot, clear_data, write_rows, apply_autofilter


ENTRY_RE = re.compile(
    r'^\s*\{\s*id:\s*"([^"]+)",\s*path:\s*"([^"]+)",\s*label:\s*"([^"]+)"(.*?)\},?\s*$',
    re.M,
)


def parse_registry():
    with open(f"{ROOT}/client/src/config/page-registry.ts") as f:
        content = f.read()
    entries = []
    for m in ENTRY_RE.finditer(content):
        rest = m.group(4)
        nav = re.search(r'navGroup:\s*"([^"]+)"', rest)
        perm = re.search(r'permissionEntity:\s*"([^"]+)"', rest)
        rck = re.search(r'routeComponentKey:\s*"([^"]+)"', rest)
        redirect = re.search(r'redirectTo:\s*"([^"]+)"', rest)
        is_alias = 'type: "alias"' in rest or redirect is not None
        entries.append({
            "id": m.group(1),
            "path": m.group(2),
            "label": m.group(3),
            "nav_group": nav.group(1) if nav else "",
            "perm": perm.group(1) if perm else "",
            "route_component_key": rck.group(1) if rck else "",
            "redirect": redirect.group(1) if redirect else "",
            "is_alias": is_alias,
        })
    return entries


def resolve_source(entry: dict) -> str:
    if entry["is_alias"]:
        return "(alias — redirects to another page)"
    rck = entry["route_component_key"]
    candidates = []
    if rck:
        # Convert PascalCase to kebab-case
        kebab = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", rck).lower()
        candidates += [
            f"client/src/pages/{rck}.tsx",
            f"client/src/pages/{rck.replace('_','-')}.tsx",
            f"client/src/pages/{kebab}.tsx",
        ]
    candidates += [
        f"client/src/pages/{entry['id']}.tsx",
        f"client/src/pages/{entry['id'].replace('_','-')}.tsx",
    ]
    for c in candidates:
        if os.path.exists(f"{ROOT}/{c}"):
            return c
    return ""


def main():
    pages = parse_registry()
    print(f"Parsed {len(pages)} registry entries")

    wb = open_wb()
    ws = wb["Screens"]
    # Headers: Screen / Page | URL | Area | Purpose | Who uses it | Key info | Permission gate | Source file | Action rows
    existing = snapshot(
        ws,
        key_col=2,
        value_cols={
            1: "screen", 3: "area", 4: "purpose", 5: "who", 6: "data",
            7: "perm_gate", 8: "source", 9: "actions",
        },
    )
    clear_data(ws)

    rows = []
    preserved = new = 0
    seen_urls = set()
    for p in pages:
        seen_urls.add(p["path"])
        url = p["path"]
        src = resolve_source(p)
        if url in existing:
            e = existing[url]
            screen = e["screen"] or p["label"]
            area = e["area"] or p["nav_group"]
            purpose = e["purpose"]
            who = e["who"]
            data = e["data"]
            perm_col = e["perm_gate"] or p["perm"]
            source = src or e["source"]
            actions = e["actions"]
            preserved += 1
        else:
            screen = p["label"]
            area = p["nav_group"]
            purpose = "(NEW — added since last workbook alignment)"
            who = ""
            data = ""
            perm_col = p["perm"]
            source = src
            actions = ""
            new += 1
        rows.append([screen, url, area, purpose, who, data, perm_col, source, actions])

    # Preserve rows that exist in the sheet but not in PAGE_REGISTRY.
    # These are auth / root / 404 routes defined directly in App.tsx, not the registry.
    extra = 0
    for url, e in existing.items():
        if url in seen_urls:
            continue
        rows.append([
            e["screen"], url, e["area"], e["purpose"], e["who"], e["data"],
            e["perm_gate"], e["source"], e["actions"],
        ])
        extra += 1
    if extra:
        print(f"  preserved {extra} extra row(s) not in PAGE_REGISTRY (App.tsx direct routes)")

    write_rows(ws, rows)
    apply_autofilter(ws, 1 + len(rows))
    save_wb(wb)
    print(f"Screens refreshed: {len(rows)} rows ({preserved} preserved, {new} new)")

    current = {p["path"] for p in pages}
    for u in sorted(current - set(existing.keys())):
        print(f"  + {u}")
    for u in sorted(set(existing.keys()) - current):
        print(f"  - {u}")


if __name__ == "__main__":
    main()
