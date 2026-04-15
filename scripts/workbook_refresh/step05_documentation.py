"""
Step 05: Documentation

Scans for all .md files in the repo (excluding node_modules, .git, dist, build)
and refreshes the 'Documentation' sheet. Fully mechanical.
"""
from __future__ import annotations

import os
from _common import ROOT, open_wb, save_wb, clear_data, write_rows, apply_autofilter


def scan_docs():
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git", "dist", "build", ".next")]
        for fname in filenames:
            if not fname.endswith(".md"):
                continue
            full = os.path.join(dirpath, fname)
            rel = os.path.relpath(full, ROOT)
            # .agents/skills docs live on the 'Skills' sheet, not 'Documentation'
            if rel.startswith(".agents" + os.sep):
                continue
            try:
                with open(full, encoding="utf-8", errors="ignore") as fh:
                    content = fh.read()
            except Exception:
                continue
            lines = content.splitlines()
            headline = ""
            for ln in lines:
                s = ln.strip()
                if not s:
                    continue
                if s.startswith("#"):
                    headline = s.lstrip("#").strip()
                    break
                headline = s[:140]
                break
            folder = os.path.dirname(rel) or "(root)"
            out.append({
                "file": fname,
                "folder": folder,
                "headline": headline[:200] if headline else "(no headline)",
                "lines": len(lines),
                "path": rel,
            })
    out.sort(key=lambda x: (x["folder"], x["file"]))
    return out


def main():
    docs = scan_docs()
    print(f"Found {len(docs)} .md docs")

    wb = open_wb()
    ws = wb["Documentation"]
    clear_data(ws)
    # Headers: Doc file | Folder | Headline | Lines | File
    rows = [[d["file"], d["folder"], d["headline"], d["lines"], d["path"]] for d in docs]
    write_rows(ws, rows)
    apply_autofilter(ws, 1 + len(rows))
    save_wb(wb)
    print(f"Documentation refreshed: {len(rows)} rows")


if __name__ == "__main__":
    main()
