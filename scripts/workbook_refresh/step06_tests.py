"""
Step 06: Tests

Scans for .test. and .spec. files and refreshes the 'Tests' sheet. Fully
mechanical — extracts top-level describe label, it/test counts, describe
counts, and area from folder.
"""
from __future__ import annotations

import os
import re
from _common import ROOT, open_wb, save_wb, clear_data, write_rows, apply_autofilter


def area_for(rel: str) -> str:
    if rel.startswith("qa/"):
        return "QA"
    if rel.startswith("server/"):
        return "Server"
    if rel.startswith("client/"):
        return "Client"
    if rel.startswith("shared/"):
        return "Shared"
    if rel.startswith("scripts/") or rel.startswith("script/"):
        return "Scripts"
    if rel.startswith("tests/"):
        return "Root tests"
    return "Other"


def scan_tests():
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git", "dist", "build", ".next")]
        for fname in filenames:
            if not ((".test." in fname) or (".spec." in fname)):
                continue
            if not (fname.endswith(".ts") or fname.endswith(".tsx") or fname.endswith(".js")):
                continue
            full = os.path.join(dirpath, fname)
            rel = os.path.relpath(full, ROOT)
            try:
                with open(full, encoding="utf-8", errors="ignore") as fh:
                    content = fh.read()
            except Exception:
                continue
            lines = content.splitlines()
            desc_m = re.search(r'describe\s*\(\s*[`\'"]([^`\'"]+)[`\'"]', content)
            top_describe = desc_m.group(1) if desc_m else ""
            it_count = len(re.findall(r"\bit\s*\(\s*[`'\"]", content)) + len(re.findall(r"\btest\s*\(\s*[`'\"]", content))
            desc_count = len(re.findall(r"\bdescribe\s*\(\s*[`'\"]", content))
            short = re.sub(r"\.(test|spec)\.(ts|tsx|js)$", "", fname)
            suffix = "test" if ".test." in fname else "spec"
            out.append({
                "name": f"{short}.{suffix}",
                "area": area_for(rel),
                "describe": top_describe[:140],
                "it": it_count,
                "desc_count": desc_count,
                "lines": len(lines),
                "path": rel,
            })
    out.sort(key=lambda x: (x["area"], x["path"]))
    return out


def main():
    tests = scan_tests()
    print(f"Found {len(tests)} tests")

    wb = open_wb()
    ws = wb["Tests"]
    clear_data(ws)
    # Headers: Test file | Area | Top-level describe label | it/test count | describe count | Lines | File
    rows = [[t["name"], t["area"], t["describe"], t["it"], t["desc_count"], t["lines"], t["path"]] for t in tests]
    write_rows(ws, rows)
    apply_autofilter(ws, 1 + len(rows))
    save_wb(wb)
    print(f"Tests refreshed: {len(rows)} rows")


if __name__ == "__main__":
    main()
