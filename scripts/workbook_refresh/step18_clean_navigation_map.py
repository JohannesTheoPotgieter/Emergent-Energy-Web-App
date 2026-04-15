"""
Step 18: Clean Navigation Map

Deletes rows where:
- From URL is clearly not a URL (source file path starting with `client/`,
  `server/`, etc.)
- To URL is clearly not a URL (contains a template literal fragment like
  `${...}`, is a string fragment with backticks, or is a comment fragment)
- After stripping query strings and dynamic suffixes, the base path is not
  a current screen URL.

Many Navigation Map rows were extracted from source files and ended up with
template literal strings instead of resolved URLs. Those are noise and
should be removed.
"""
from __future__ import annotations

import re
from _common import open_wb, save_wb, apply_autofilter


def normalize(url: str) -> str | None:
    if not isinstance(url, str):
        return None
    url = url.strip()
    if not url:
        return None
    # Filter obvious non-URLs
    if any(bad in url for bad in ("${", "`", "→", "|", "  ")):
        return None
    if url.startswith(("client/", "server/", "shared/", "scripts/", "docs/")):
        return None
    if not url.startswith("/"):
        return None
    # Strip query string and fragment
    base = url.split("?", 1)[0].split("#", 1)[0]
    return base


def current_urls_and_patterns(wb) -> tuple[set[str], list[str]]:
    """Return (exact_urls, parameterized_patterns_as_regex_strings)."""
    ws = wb["Screens"]
    exact = set()
    patterns = []
    for r in range(2, ws.max_row + 1):
        u = ws.cell(row=r, column=2).value
        if not u:
            continue
        exact.add(u)
        if ":" in u:
            # Convert /project/:projectName -> ^/project/[^/]+$
            regex = "^" + re.sub(r":\w+", r"[^/]+", u) + "$"
            patterns.append(regex)
    return exact, patterns


def matches_current(url: str, exact: set[str], patterns: list[str]) -> bool:
    if url in exact:
        return True
    for p in patterns:
        if re.match(p, url):
            return True
    return False


def main():
    wb = open_wb()
    exact, patterns = current_urls_and_patterns(wb)

    ws = wb["Navigation Map"]
    before = ws.max_row - 1

    to_delete = []
    for r in range(2, ws.max_row + 1):
        fu = ws.cell(row=r, column=2).value
        tu = ws.cell(row=r, column=5).value
        fn = normalize(fu)
        tn = normalize(tu)
        if fn is None or tn is None:
            to_delete.append(r)
            continue
        if not matches_current(fn, exact, patterns) or not matches_current(tn, exact, patterns):
            to_delete.append(r)

    for r in sorted(to_delete, reverse=True):
        ws.delete_rows(r, 1)

    after = ws.max_row - 1
    apply_autofilter(ws, ws.max_row)
    save_wb(wb)

    print(f"Navigation Map: {before} → {after} rows ({before - after} stale rows removed)")


if __name__ == "__main__":
    main()
