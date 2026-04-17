"""
Step 20: Clean React Query Cache Keys

Removes rows from the 'React Query Cache Keys' sheet whose first-segment
cache key column (col 1) contains an unresolved template-literal fragment
(e.g. "${CASHFLOW_API_BASE}/...", "/api/projects/${projectId}/...").

These rows were generated when the scraper captured a queryKey array whose
first element was a runtime variable or template expression rather than a
stable string literal. They cannot be mapped to a meaningful, human-readable
cache-key name and are therefore noise.

Legitimate template literals in the example reader/invalidator file columns
(cols 4-5) are NOT targeted here — those are handled by step 19.
"""
from __future__ import annotations

from _common import open_wb, save_wb, apply_autofilter


def main():
    wb = open_wb()
    ws = wb["React Query Cache Keys"]
    before = ws.max_row - 1

    to_delete = []
    for r in range(2, ws.max_row + 1):
        key = ws.cell(row=r, column=1).value
        if isinstance(key, str) and "${" in key:
            to_delete.append(r)

    for r in sorted(to_delete, reverse=True):
        ws.delete_rows(r, 1)

    after = ws.max_row - 1
    apply_autofilter(ws, ws.max_row)
    save_wb(wb)

    print(f"React Query Cache Keys: {before} → {after} rows ({len(to_delete)} unresolvable key rows removed)")
    if to_delete:
        print("  (rows whose first-segment key contained ${...} template literals)")


if __name__ == "__main__":
    main()
