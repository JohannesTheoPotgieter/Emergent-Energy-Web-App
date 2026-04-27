"""
Step 22: Clean Toasts with stale line references

The Toasts sheet records the source file (col 2) and line number (col 6)
where each toast() call was found. When the source file is refactored or
code moves around, the recorded line number drifts away from any toast-
related code.

This step checks a ±15-line window around the recorded line number for the
keywords 'toast' or 'notification'. If neither appears, the toast was
likely removed or relocated and the row is dropped.

Rows whose source file no longer exists are also dropped (step 19 handles
this too, but we double-check here for safety).
"""
from __future__ import annotations

import os

from _common import ROOT, open_wb, save_wb, apply_autofilter


TOAST_WINDOW = 15


def main():
    wb = open_wb()
    ws = wb["Toasts"]
    before = ws.max_row - 1

    to_delete = []
    for r in range(2, ws.max_row + 1):
        src_file = ws.cell(row=r, column=2).value
        line_no = ws.cell(row=r, column=6).value
        if not isinstance(src_file, str) or not isinstance(line_no, (int, float)):
            continue

        fpath = os.path.join(ROOT, src_file.strip())
        if not os.path.exists(fpath):
            to_delete.append(r)
            continue

        with open(fpath, encoding="utf-8", errors="replace") as f:
            lines = f.readlines()

        line_idx = int(line_no) - 1
        window = lines[max(0, line_idx - TOAST_WINDOW):min(len(lines), line_idx + TOAST_WINDOW)]
        text = "".join(window).lower()
        if "toast" not in text and "notification" not in text:
            to_delete.append(r)

    for r in sorted(to_delete, reverse=True):
        ws.delete_rows(r, 1)

    after = ws.max_row - 1
    apply_autofilter(ws, ws.max_row)
    save_wb(wb)

    print(f"Toasts: {before} → {after} rows ({len(to_delete)} stale line-ref rows removed)")


if __name__ == "__main__":
    main()
