# Migration Dossier — Section 5 (Live Functionality Preservation Checklist)

## Completed scope

Section 5 from the chunked plan: enumerate critical live functionality that must survive migration and identify what breaks if migration occurs out of order.

---

## 1) Must-survive live functionality inventory

## A. Login/Auth and role-aware access
- Login and callback routes in `client/src/App.tsx` (`/auth/login`, `/auth/ms-callback`)
- Session/JWT + middleware chain (`server/auth-context.ts`, `server/jwt.ts`, bootstrap security/session middleware)
- Role-driven route visibility and permission entities (`client/src/config/page-registry.ts`, `client/src/config/app-navigation.ts`)

**Must preserve:** existing login paths, session semantics, role-based nav visibility, and backend permission enforcement.

## B. Project creation and editing
- Project create route/page (`/project-create`) and backend template/project endpoints (`server/template-routes.ts`)
- Project detail via legacy route `/project/:projectName` and v2 data by projectId (`use-project-v2.ts`)

**Must preserve:** both projectName and projectId access patterns during transition.

## C. Task/work-item flows
- Unified work model (`work_items` + extension/assignment/dependency/status history tables)
- Task management and engineering workflows via route groups in core/project registrars
- Personal/my-work flows and approval shortcuts in page registry aliases

**Must preserve:** assignment, dependency, status transitions, and owner-centric work queues.

## D. Gates / approvals / evidence
- Stage lifecycle + stage data APIs (`/api/projects/:projectId/stages*`, `/stage-data`, `/charter`)
- Unified approvals APIs (`/api/approvals*`) and gate workspace APIs (`/api/gates/*`)
- Domain evidence stores (stage evidence, quality evidence, engineering/task deliverables)

**Must preserve:** gate readiness, exception workflows, and approval queue integrity across domains.

## E. Finance and procurement flows
- Financial line ingestion and views (`program_*`, `finance_*`, procurement/payment routes)
- Financial review workflow routes and board pages
- Name-based finance compatibility endpoints still used by pages like financial-linking

**Must preserve:** dual-identity lookup (`projectName` + `projectId`) and reconciliation lineage.

## F. Import and sync operations
- Smart import upload/validate/commit/rollback flow (`server/smart-import-routes.ts`)
- Sync/intake routes (`server/sync-routes.ts`, `server/ms-sync-routes.ts`)

**Must preserve:** commit/rollback safety and issue-resolution continuity.

## G. Reporting and dashboards
- PM/Engineering monthly reports, programme reports, performance dashboards, company overview
- Portfolio/project navigation that links to project detail routes

**Must preserve:** report endpoints and cross-page navigation links.

## H. Routing/navigation compatibility
- Legacy redirects + alias pages in `page-registry.ts`
- Role-specific allowed path lists in `App.tsx`

**Must preserve:** old bookmarks, deep links, and permission-consistent routing behavior.

---

## 2) What breaks if migration order is wrong

1. **If projectName compatibility is removed before route/API adapters**
   - Breaks `/project/:projectName` navigation, financial-linking flows, legacy finance/admin endpoints, and search/deep links.

2. **If role model changes before nav+API permission sync**
   - Users may see routes they cannot access (403 loops) or lose access to required pages.

3. **If work-item consolidation happens before board/workflow endpoint parity**
   - Task boards, dependencies, assignment views, and status transitions can desynchronize.

4. **If approval/evidence models are merged before queue parity tests**
   - Approvals disappear from unified queues, evidence lookup fails, and gate decisions become inconsistent.

5. **If finance tables are normalized before dual-id read compatibility**
   - Revenue/COS/cashflow/reporting pages and import reconciliation will drift or fail.

6. **If import flow is touched before migration mapping/audit stabilization**
   - Smart import commit/rollback reliability drops; traceability and rollback confidence are lost.

7. **If lifecycle source-of-truth is switched without route-level authority map**
   - Stage status, exceptions, and gate readiness can diverge across dashboards.

---

## 3) Preservation guardrails for upcoming phases

- Keep all legacy routes and aliases active until replacement routes are shadow-validated.
- Enforce adapter-based reads where target model is introduced (no hard swap reads).
- Use dual-write only where reconciliation and rollback checkpoints exist.
- Add per-domain parity checks before enabling write cutover (tasks, approvals, finance, import).
- Preserve audit/event capture in both old and new paths during transition.

---

## Section 5 feedback

- Completed scope: live-functionality preservation checklist and breakage-by-order analysis.
- Key findings: projectName compatibility, role+permission sync, and import/finance lineage are highest-risk live dependencies.
- Risks identified now: route regressions, hidden auth regressions, silent workflow drift.
- Blockers/ambiguities: final ownership model for some cross-domain approval/evidence records still unresolved.
- Recommendation before proceeding: use this checklist as pass/fail gates for Section 6 risk register and Section 7 phased plan.
- Ready for next section: **Yes**.
