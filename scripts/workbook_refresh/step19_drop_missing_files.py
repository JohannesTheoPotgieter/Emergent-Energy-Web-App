"""
Step 19: Drop rows whose referenced file no longer exists

For each sheet that has a file-path column, walk the rows and delete any
row whose path doesn't exist in the repo anymore. This removes legacy rows
from the sheets we didn't mechanically regenerate.

Special cases:
- React Query Cache Keys has two example files (reader + invalidator). We
  only delete the row when BOTH are missing.
- Background Jobs column 2 is formatted like 'server/foo.ts (L1090)' — we
  strip the suffix before checking.
- Build Config filenames like 'package.json' are relative to repo root.
- Click Handlers column 5 is the source file; any row pointing to a deleted
  file is dropped.
- Rows whose file column starts with `${` (template literal fragment) are
  considered noise and dropped.
"""
from __future__ import annotations

import os
import re
from _common import ROOT, open_wb, save_wb, apply_autofilter


# sheet_name → list of file-path columns (1-indexed). If multiple columns, row is
# only deleted if ALL of them are missing (so sheets with reader+invalidator
# don't drop rows where one is still valid).
SHEET_FILE_COLS = {
    "Toasts":                     [2],
    "App Entry":                  [4],
    "Client Library":             [5],
    "Client Data & Tours":        [4],
    "Client Configs":             [6],
    "Click Handlers":             [5],     # source file column
    "Server Lib & Helpers":       [6],
    "Server Policies & Infra":    [5],
    "Bootstrap & Schedulers":     [6],
    "Microsoft & Secrets":        [5],
    "Shared Business Logic":      [5],
    "API Contracts & Validators": [6],
    "QA Infrastructure":          [5],
    "Public Assets":              [5],
    "Misc Artifacts":             [4],
    "Attached Assets":            [6],
    "React Query Cache Keys":     [4, 5],  # delete only if BOTH missing
    "Background Jobs":            [2],     # has '(Lnnn)' suffix to strip
    "Build Config":               [2],     # filename relative to root
}


def resolve_path(raw: str) -> str | None:
    """Strip noise like '(L1090)' and normalize. Return None if clearly bogus."""
    if not isinstance(raw, str):
        return None
    s = raw.strip()
    if not s:
        return None
    if s.startswith("${") or "${" in s or s.startswith("`"):
        return None
    # Strip '(Lnnn)' line suffix
    s = re.sub(r"\s*\(L\d+\)\s*$", "", s)
    # Strip ':line' suffix (e.g. 'shared/schema/foo.ts:123')
    s = re.sub(r":\d+$", "", s)
    return s.strip() or None


def exists(path: str) -> bool:
    abs_path = os.path.join(ROOT, path)
    return os.path.exists(abs_path)


def clean_sheet(wb, name: str, cols: list[int]) -> tuple[int, int]:
    ws = wb[name]
    before = ws.max_row - 1
    to_delete = []

    for r in range(2, ws.max_row + 1):
        statuses = []
        for c in cols:
            raw = ws.cell(row=r, column=c).value
            path = resolve_path(raw)
            if path is None:
                # Treat unparseable paths as "missing" for deletion purposes
                statuses.append(False)
            else:
                statuses.append(exists(path))
        # Delete row only if ALL tracked columns are missing/invalid
        if not any(statuses):
            to_delete.append(r)

    for r in sorted(to_delete, reverse=True):
        ws.delete_rows(r, 1)

    apply_autofilter(ws, ws.max_row)
    after = ws.max_row - 1
    return before, after


def main():
    wb = open_wb()
    report = []
    for name, cols in SHEET_FILE_COLS.items():
        if name not in wb.sheetnames:
            continue
        before, after = clean_sheet(wb, name, cols)
        delta = before - after
        marker = "" if delta == 0 else f"  (-{delta} removed)"
        report.append((name, before, after, delta))
        print(f"{name:<32} {before:>5} → {after:>5}{marker}")
    save_wb(wb)

    total_removed = sum(d for _, _, _, d in report)
    print(f"\nTotal stale rows removed across {len(report)} sheets: {total_removed}")


if __name__ == "__main__":
    main()
