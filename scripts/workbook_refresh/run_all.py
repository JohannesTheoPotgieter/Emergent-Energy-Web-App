"""
Run every workbook refresh step in order.

Usage:
    python3 scripts/workbook_refresh/run_all.py

Phase 1 — Mechanical regeneration (steps 01-15)
  Re-derive each sheet from the live codebase. Human-authored columns
  (descriptions, purpose text) are preserved by keying on a stable identifier
  (SQL table name, URL, file path, etc.) where possible.

Phase 2 — Cleanup / truth-checking (steps 17-22)
  Prune narrative sheets that can't be fully regenerated but CAN be partially
  verified:
    17 — Screen Actions: remove rows whose URL no longer matches a live screen
    18 — Navigation Map: remove rows with broken/unresolvable URLs
    19 — File-path sheets: remove rows whose source file no longer exists
    20 — React Query Cache Keys: remove rows with unresolvable ${...} key names
    21 — Role & Permission Matrix: resolve spread notation; remove fully-invalid rows
    22 — Toasts: remove rows whose line number drifted away from any toast code

Phase 3 — README (step 16, must run last)
  Reads live row counts from the workbook to build the summary sheet.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path


STEPS = [
    # Phase 1: mechanical regeneration
    "step01_database_tables",
    "step02_sql_migrations",
    "step03_components",
    "step04_hooks",
    "step05_documentation",
    "step06_tests",
    "step07_environment_variables",
    "step08_feature_flags",
    "step09_screens",
    "step10_data_sources",
    "step11_server_handlers",
    "step12_dev_scripts",
    "step13_server_file_sheets",
    "step14_status_enums",
    "step15_table_relations_and_indexes",
    # Phase 2: cleanup / truth-checking
    "step17_clean_screen_actions",
    "step18_clean_navigation_map",
    "step19_drop_missing_files",
    "step20_clean_rq_cache_keys",
    "step21_clean_role_matrix",
    "step22_clean_toasts",
    # Phase 3: readme (must be last — reads live counts)
    "step16_readme",
]


def main():
    here = Path(__file__).parent
    sys.path.insert(0, str(here))
    for name in STEPS:
        print(f"\n=== {name} ===")
        mod = importlib.import_module(name)
        mod.main()


if __name__ == "__main__":
    main()
