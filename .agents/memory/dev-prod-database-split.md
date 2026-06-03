---
name: Dev and prod use DIFFERENT databases (not shared)
description: Dev points at heliumdb, production at neondb — they are separate Postgres databases with diverged data
---

# Dev and prod are NOT on the same database

Despite earlier assumptions of a "shared dev+prod DB", they are different:

- **Dev** app `DATABASE_URL` → `heliumdb` (PGHOST `helium`). Older, cleaned-up copy
  of the data. Example: project "Red Rocket" has id **23** with a fully-structured
  plan (parent_id set, WBS outline 1/1.1/2/2.1, indent levels).
- **Production** → `neondb` (Neon). The live, real data. Same "Red Rocket" exists as
  id **287** with messy plan data (parent_id mostly null, duplicated WBS codes,
  duplicate task rows).
- `CLAUDE_RO_DATABASE_URL` is a read-only `claude_readonly` role on **neondb**
  (i.e. it reads PRODUCTION), exposing curated views in the `claude_views` schema
  (e.g. `v_work_items`, `v_projects`, `v_project_schedule`). Use these to inspect
  live prod data read-only.

**Why this matters:** "dev looks neater than prod" for the same screen is usually a
DATA difference (two different DBs), NOT a code/deploy difference. The breadcrumb
"Project Delivery > N" shows the project id, which is a quick tell of which DB you're
looking at (23 = dev/helium, 287 = prod/neon).

**How to apply:**
- Before blaming code or deploy lag for a dev-vs-prod discrepancy, confirm which DB
  each side hits (dev: `echo $PGHOST` / `current_database()` via `psql "$DATABASE_URL"`;
  prod: query `claude_views` via `psql "$CLAUDE_RO_DATABASE_URL"`).
- Inspect live production data read-only through `claude_views.*` on `CLAUDE_RO_DATABASE_URL`.
- Pointing dev at prod's data means repointing the dev `DATABASE_URL` secret to the
  Neon connection (a config change, not code).
