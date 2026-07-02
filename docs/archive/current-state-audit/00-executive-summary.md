# Executive Summary: Current-State Architecture Audit

**Date:** 2026-04-07
**Scope:** Full application — backend, frontend, database, API, dead code detection

---

## What This Application Is

Emergent Energy Web App is a **full-stack enterprise project management and financial tracking platform** for a South African energy company. It manages the complete lifecycle of energy projects from opportunity through construction, commissioning, handover, and post-handover review.

**Stack:** Express.js v5 + React v19 + Drizzle ORM + PostgreSQL, deployed on Replit. Single package.json monolith. Vite for frontend bundling.

---

## The Real Architecture (Blunt Assessment)

### What Works
- **9-department navigation model** with 15 role-based views — well-structured, actively used
- **Stage lifecycle system** (10 gates) — core business logic, well-integrated end-to-end
- **Finance tracking spine** — normalized cost/revenue lines with dual-write bridge to promoted schema
- **183 page registry entries** mapping to 69 lazy-loaded route components — comprehensive but manageable
- **RBAC with 3-tier permission evaluation** — user overrides > role JSONB > code defaults
- **React Query data layer** — consistent patterns, 80+ hooks, centralized error handling

### What's Messy
1. **`routes.ts` monolith: 8,301 lines, 166 handlers** — the single largest technical debt item. Routes are being extracted into domain files but this file still contains the majority of endpoints. Evidence: `server/routes.ts` vs `server/routes/route-registry.ts` comment "This file will eventually replace server/routes.ts"
2. **`storage.ts` monolith: ~2,400 lines, 415+ methods** — the entire data access layer is one class. Every route calls through this single interface.
3. **Dual-write bridge migration in progress** — legacy tables (project_info, normalized_cost_lines, etc.) are primary write targets, with bridge writers syncing to promoted schema. Both old and new read paths coexist. Evidence: `server/bridge/bridge-writer.ts`, `server/services/promoted-read-compat.ts` (66KB compatibility layer)
4. **282 database tables defined** — many are scaffolded but may not be actively used. The schema spans 15 files in `shared/schema/`.
5. **1,010 route handlers across 73 files** — significant API surface, much of it in the monolith
6. **52 feature flags** — many defaulting to false, controlling features that may never have shipped

### Biggest Architectural Risks
1. **The dual-write bridge** — if the bridge fails silently, legacy and promoted tables drift. `bridge_sync_failures` table catches some failures, but reconciliation is manual.
2. **The routes.ts monolith** — any merge conflict in this file is catastrophic. Extraction is ongoing but incomplete.
3. **Schema bloat** — 282 tables with unclear usage boundaries. Some tables exist only because they were defined in schema files but may never have been populated.
4. **The `storage.ts` god class** — a single interface with 415+ methods means every data access change touches or risks this file.

### Biggest Cleanup Opportunities
1. **~26 unused UI components** in `client/src/components/ui/` (accordion, carousel, context-menu, etc.) — safe to remove
2. **4 orphaned analytics components** (`client/src/components/analytics/`) — never imported anywhere
3. **Feature-flagged code defaulting to false** that was never activated — potential dead code behind flags
4. **Legacy schema tables** that may never have been populated — need runtime verification
5. **Continued extraction of routes.ts** — each domain extracted reduces the monolith

### Scale Summary

| Metric | Count |
|--------|-------|
| Database tables defined | 282 |
| Route handlers | 1,010 across 73 files |
| Frontend pages/routes | 183 registry entries, 69 unique components |
| Frontend hooks | 80+ data-fetching hooks |
| Backend services | 46 service files |
| Feature flags | 52 |
| Schema files | 15 |
| Lines in routes.ts monolith | 8,301 |
| Lines in storage.ts monolith | ~2,400 |
| Roles defined | 15 company roles |
| Departments | 9 navigation departments |

---

## Risk-Ranked Issues

1. **CRITICAL: Dual-write bridge consistency** — actively being used, reconciliation pack exists but requires manual runs
2. **HIGH: routes.ts monolith** — merge conflicts, cognitive load, untestable in isolation
3. **HIGH: storage.ts god class** — same issues as routes.ts but for data access
4. **MEDIUM: Schema bloat** — 282 tables, unknown active usage for many
5. **MEDIUM: Feature flag dead code** — 52 flags, many false by default, code paths may be unreachable
6. **LOW: Orphaned UI components** — no runtime risk, just file bloat

---

## What Should NOT Be Touched Without Verification

1. Any table involved in the bridge sync (project_info, normalized_cost_lines, normalized_revenue_lines, project_execution_state)
2. The startup orchestrator sequence
3. Permission/RBAC tables and middleware
4. Session management configuration
5. Any table that might be written to by background jobs or the import pipeline
