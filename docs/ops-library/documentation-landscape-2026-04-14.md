# Documentation Landscape Cleanup Report (2026-04-14)

## A) What to archive (historical reference only)
### Archived in this change
- `DB_MIGRATION_PROMPT.md` → `docs/archive/prompts/DB_MIGRATION_PROMPT.md`
- `QA_REVIEW_PROMPT.md` → `docs/archive/prompts/QA_REVIEW_PROMPT.md`

### Should remain archived (already under `docs/archive/`)
- Audit waves and one-off quality sweeps.
- Rollout prompts and implementation super-prompts.
- Completed migration dossiers and closeout narratives.
- Historical QA matrices and release readiness snapshots.

## B) What to keep active
Keep only operator-grade docs for live operation:
- Architecture operating guide.
- Source-of-truth and data ownership guide.
- Lifecycle and handover SOPs.
- Finance/report trust controls.
- Role authority guides.
- Admin safety controls and change gates.

These are now consolidated under `docs/ops-library/`.

## C) Core docs currently missing (before this cleanup)
- A single active architecture doc with ownership and boundary rules.
- A concise source-of-truth conflict resolution guide.
- A single handover SOP spanning PD→PM and PM→O&M.
- A finance trust control doc aligned to COS/invoice/PO/payment rules.
- Role-specific operational authority guide.
- Admin high-risk action safety gate checklist.

## D) Proposed structure (implemented)
- `docs/ops-library/architecture-guide.md`
- `docs/ops-library/source-of-truth-guide.md`
- `docs/ops-library/lifecycle-handover-sops.md`
- `docs/ops-library/finance-report-trust-guide.md`
- `docs/ops-library/role-guides.md`
- `docs/ops-library/admin-safety-guide.md`

## Active truth vs historical reference
- **Active truth:** `docs/ops-library/`
- **Historical reference:** `docs/archive/`

Historical documents are retained for traceability only and must not be used as standalone execution instructions.
