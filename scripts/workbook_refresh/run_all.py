"""
Run every workbook refresh step in order.

Usage:
    python3 scripts/workbook_refresh/run_all.py

Each step is self-contained and idempotent. They read the workbook, refresh
their sheet(s), and write the workbook back. Human-authored columns
(descriptions, friendly names, purpose text) are preserved by keying on a
stable identifier (SQL table name, URL, file path, etc.) where possible.

The scripts touch mechanically-derivable sheets only. Narrative sheets
(Screen Actions, Click Handlers, Navigation Map, Toasts, React Query Cache
Keys, Role & Permission Matrix) are left alone — they still reflect the
state at the last full autogen run.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path


STEPS = [
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
    "step16_readme",  # must run last — reads live counts from the workbook
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
