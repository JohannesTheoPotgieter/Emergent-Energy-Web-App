"""
Step 17: Clean Screen Actions

Deletes rows from the 'Screen Actions' sheet whose URL column (col 2) is not
in the current Screens sheet. These are rows describing buttons / APIs on
screens that have been removed or renamed since the sheet was auto-generated.

This sheet is not regenerated because its rich "What it does" / "Data it
reads or changes" / "Where it goes next" / "Tables touched" columns are
human-authored. We only prune stale rows.
"""
from __future__ import annotations

from _common import open_wb, save_wb, apply_autofilter


def current_screen_urls(wb) -> set[str]:
    ws = wb["Screens"]
    urls = set()
    for r in range(2, ws.max_row + 1):
        u = ws.cell(row=r, column=2).value
        if u:
            urls.add(u)
    return urls


def main():
    wb = open_wb()
    current = current_screen_urls(wb)

    ws = wb["Screen Actions"]
    before = ws.max_row - 1

    # Collect row indexes to delete (bottom-up)
    to_delete = []
    stale = set()
    for r in range(2, ws.max_row + 1):
        url = ws.cell(row=r, column=2).value
        if url and url not in current:
            to_delete.append(r)
            stale.add(url)

    # Delete bottom-up to preserve indexes
    for r in sorted(to_delete, reverse=True):
        ws.delete_rows(r, 1)

    after = ws.max_row - 1
    apply_autofilter(ws, ws.max_row)
    save_wb(wb)

    print(f"Screen Actions: {before} → {after} rows ({before - after} stale rows removed)")
    if stale:
        print("Stale URLs removed:")
        for u in sorted(stale):
            print(f"  - {u}")


if __name__ == "__main__":
    main()
