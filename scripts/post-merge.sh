#!/bin/bash
set -e

# Post-merge setup for Emergent Energy.
# Runs after a task is merged into main.
#
# What it does:
#   - Reinstalls node deps so any new packages from the merged task land.
#
# What it intentionally does NOT do:
#   - Apply schema migrations. This codebase uses hand-authored numbered SQL
#     files in ./migrations/ that are applied out of band (psql or via the
#     deploy pipeline) — runtime schema sync is permanently disabled in
#     server/bootstrap/startup-orchestrator.ts. Auto-applying migrations
#     here would race with that policy.
#   - Restart workflows. The workflow reconciler runs after this script.
#
# Keep this script idempotent and non-interactive (stdin is closed).

echo "[post-merge] Installing node dependencies..."
npm install --no-audit --no-fund --silent

echo "[post-merge] Done."
