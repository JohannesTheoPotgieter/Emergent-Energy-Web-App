# API v2 Backend Architecture

## Folder structure

```txt
server/api/v2/
  controllers/
    v2-controller.ts
  policies/
    access-policy.ts
    permission-catalog.ts
  repositories/
    project-v2-repository.ts
  routes/
    v2-routes.ts
  services/
    audit-service.ts
    project-v2-service.ts
  utils/
    http.ts
  validators/
    project-v2-validators.ts
```

## Current architecture direction (post-PR95 completion hardening)
- **Controllers are thin**: no direct DB calls remain in `v2-controller.ts`; all reads/writes go through service/repository layers.
- **Service layer owns orchestration**: workflow transitions, role-aware dashboard shaping, and domain-level output contracts live in `project-v2-service.ts`.
- **Repository layer owns DB access**: procurement, PO, invoices, finance read models, engineering designs, quality checks, milestones and lifecycle transitions are all explicit repository methods.
- **Policy is centralized in code** via `permission-catalog.ts` (authoritative grants) + `access-policy.ts` (`assertPermission`) and applied consistently on mutation routes.
- **Validation is explicit per domain mutation** with dedicated schemas for milestones, quality checks, engineering designs, procurement patch/PO, invoices, and finance variations.
- **Audit service remains the single persistence entrypoint** for mutation event capture.

## Schema and contract alignment
- v2 uses only project-linked new schema entities (`project_info`, `project_phase_history`, `work_items`, `procurement_items`, `invoice_captures`, `project_eng_*`, `qc_*`, `normalized_*`, `audit_events`).
- Aliases/placeholders were replaced by real domain handlers:
  - `engineering/designs` now has dedicated list/create/patch behavior.
  - `quality/checks` now has dedicated list/create/patch behavior.
  - `milestones` now maps to milestone-specific work item flows (`isMilestone=true`).
  - `procurement/pos` now maps to PO-specific list/create/patch behavior (distinct from generic procurement item routes).
  - finance detail routes return differentiated payloads (`cashflow`, `cos`, `revenue`, `expenditure`, `variations`).

## Workflow/source-of-truth rigor
- Development handover now executes as a DB transaction that writes phase history **and** updates the current `project_info.phase` and phase metadata.

## Performance discipline
- Paginated project listing retained.
- Finance detail endpoints return scoped fields and capped line payloads (limit 100 lines).
- Repository methods avoid controller-driven fan-out and preserve grouped SQL execution for core overview reads.

## Remaining <8/10 risks
- Finance variations currently leverage `work_items` with `workstream=FINANCE` + `type=VARIATION`; this is production-usable but a dedicated variations table could improve long-term domain clarity.
- POs currently leverage `procurement_items` with required `poId`; this is now a distinct API flow but still backed by shared storage.
