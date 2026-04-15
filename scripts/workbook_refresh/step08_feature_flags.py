"""
Step 08: Feature Flags

Rebuilds the 'Feature Flags' sheet from the canonical source of truth
shared/feature-flags.ts (ROLLOUT_FEATURE_FLAGS). The label, description,
and default value are all authored in that TS file, so this is a full
refresh rather than a preserving merge.
"""
from __future__ import annotations

import re
from _common import ROOT, open_wb, save_wb, clear_data, write_rows, apply_autofilter


def scan_flags():
    with open(f"{ROOT}/shared/feature-flags.ts") as f:
        content = f.read()

    start = content.find("ROLLOUT_FEATURE_FLAGS")
    if start == -1:
        raise SystemExit("ROLLOUT_FEATURE_FLAGS not found")
    body = content[start:]

    flag_re = re.compile(
        r'\{\s*key\s*:\s*"([^"]+)"\s*,\s*label\s*:\s*"([^"]+)"\s*,\s*description\s*:\s*"([^"]+)"\s*,\s*defaultValue\s*:\s*(true|false)',
        re.S,
    )
    flags = []
    for m in flag_re.finditer(body):
        flags.append({
            "key": m.group(1),
            "label": m.group(2),
            "desc": m.group(3),
            "default": "ON" if m.group(4) == "true" else "OFF",
        })

    # Cross-check against FEATURE_FLAG_KEYS
    keys_m = re.search(r"FEATURE_FLAG_KEYS\s*=\s*\[([^\]]*)\]", content, re.S)
    declared = set()
    if keys_m:
        for km in re.finditer(r'"([^"]+)"', keys_m.group(1)):
            declared.add(km.group(1))
    defined_keys = {f["key"] for f in flags}
    for k in sorted(declared - defined_keys):
        flags.append({
            "key": k,
            "label": k.replace("_", " ").title(),
            "desc": "(Declared in FEATURE_FLAG_KEYS but no full definition found in ROLLOUT_FEATURE_FLAGS)",
            "default": "",
        })
    return flags


def main():
    flags = scan_flags()
    print(f"Parsed {len(flags)} feature flags from shared/feature-flags.ts")

    wb = open_wb()
    ws = wb["Feature Flags"]
    clear_data(ws)
    # Headers: Flag key | Label | What it gates | Default (on/off)
    flags.sort(key=lambda x: x["key"])
    rows = [[f["key"], f["label"], f["desc"], f["default"]] for f in flags]
    write_rows(ws, rows)
    apply_autofilter(ws, 1 + len(rows))
    save_wb(wb)
    print(f"Feature Flags refreshed: {len(rows)} rows")


if __name__ == "__main__":
    main()
