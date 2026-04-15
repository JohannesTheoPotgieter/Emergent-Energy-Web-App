"""
Step 12: Dev Scripts

Enumerates files in script/ and scripts/ and refreshes the 'Dev Scripts' sheet.
Preserves the Purpose column for scripts whose file path still exists.
"""
from __future__ import annotations

import os
import re
from _common import ROOT, open_wb, save_wb, snapshot, clear_data, write_rows, apply_autofilter


EXTS = (".ts", ".tsx", ".js", ".mjs", ".cjs", ".sh", ".sql", ".py", ".md")


def scan_scripts():
    out = []
    for folder in ("script", "scripts"):
        base = f"{ROOT}/{folder}"
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            # Skip the new workbook_refresh/_archive folders
            dirnames[:] = [d for d in dirnames if d not in ("_archive", "__pycache__")]
            for fname in filenames:
                if not fname.endswith(EXTS):
                    continue
                full = os.path.join(dirpath, fname)
                rel = os.path.relpath(full, ROOT)
                try:
                    with open(full, encoding="utf-8", errors="ignore") as fh:
                        lines = fh.read().splitlines()
                except Exception:
                    continue
                name = re.sub(r"\.(ts|tsx|js|mjs|cjs|sh|sql|py|md)$", "", fname)
                display_folder = f"{folder}/" + (os.path.relpath(dirpath, base) + "/" if dirpath != base else "")
                display_folder = display_folder.rstrip("/") + "/"
                out.append({
                    "folder": display_folder if display_folder != "./" else f"{folder}/",
                    "script": name,
                    "lines": len(lines),
                    "path": rel,
                })
    out.sort(key=lambda x: (x["folder"], x["script"]))
    return out


def main():
    scripts = scan_scripts()
    print(f"Found {len(scripts)} dev scripts")

    wb = open_wb()
    ws = wb["Dev Scripts"]
    # Headers: Folder | Script | Purpose | Lines | File
    existing = snapshot(ws, key_col=5, value_cols={3: "purpose"})
    clear_data(ws)

    rows = []
    preserved = new = 0
    for s in scripts:
        purpose = existing.get(s["path"], {}).get("purpose", "")
        if purpose:
            preserved += 1
        else:
            purpose = "(NEW — added since last workbook alignment)"
            new += 1
        rows.append([s["folder"], s["script"], purpose, s["lines"], s["path"]])

    write_rows(ws, rows)
    apply_autofilter(ws, 1 + len(rows))
    save_wb(wb)
    print(f"Dev Scripts refreshed: {len(rows)} rows ({preserved} preserved, {new} new)")


if __name__ == "__main__":
    main()
