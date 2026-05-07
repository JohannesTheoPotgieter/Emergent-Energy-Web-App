# Wave-0 Read-only Codebase Audit — Findings

**Date:** 2026-05-07. **Mode:** Read-only. No code changed.
**Scope cap honoured:** ≤50 file reads. Scoping per item; no general exploration.
**Reference:** `docs/AGENT_GUARDRAILS.md` (canonical guardrails, esp. § 0A, § 3, § 5A, § 9), `docs/operating-model/playbook-v2.0.md` (Companion Templates).

---

## 0.1 — Workflow refusals (HARD vs SOFT)

**Survey scope:** `server/routes/*.routes.ts`, `server/*-routes.ts` (legacy flat files), `server/middleware/*`.

**Raw counts** (greps over the three globs, see Appendix A):
- `throw new ApiError`: **4** total (all in `server/routes/document-management.routes.ts`).
- `res.status(400).*` / `res.status(403).*`: **785** total. The 30 highest-density files are all stage / lifecycle / handover / smart-import / finance-legacy files. Top 5: `server/handover-routes.ts` (47), `server/stage-lifecycle-routes.ts` (36), `server/smart-import-routes.ts` (33), `server/quickbooks-routes.ts` (32), `server/quality-routes.ts` (30).
- `status: 400|403` (object-literal form): 0.

**Classification** — per § 5A the only HARD refusals are security and financial-formula integrity. Everything else is SOFT (records + override path).

### HARD — keep (security / formula integrity)

| File:line | Pattern | Rule |
|---|---|---|
| `server/middleware/csrf.ts:69` | `res.status(403)` "Invalid or missing CSRF token" | § 5A — CSRF middleware, hard refusal. |
| `server/middleware/requireAdmin.ts:54` | `res.status(403)` admin gate | § 5A — auth bypass HARD. |
| `server/middleware/requireRole.ts:41` | `res.status(403)` "Insufficient role" | § 5A — RBAC HARD. |
| `server/middleware/project-scope-middleware.ts:94` | `res.status(403)` project-scope guard | § 5A — RBAC HARD. |
| `server/middleware/production-safety.ts:10,31,44` | `res.status(403/400)` block dev-only routes in prod | § 5A — security HARD. |
| `server/middleware/validateBody.ts:8` | `res.status(400)` Zod failure | § 5 — input validation HARD (Zod at boundaries). |
| `server/middleware/errorHandler.ts:18` | `res.status(400)` Zod errors | § 5 — same. |
| Most route-level `res.status(400)` "Invalid X / X is required" | input shape | § 5 — input validation HARD. |
| Most route-level `res.status(403)` "Only X can do Y" / "Insufficient role" | RBAC | § 5 — RBAC HARD. |

The 400-validation and 403-role pattern dominates the 785 hits. Treat as compliant by category.

### SOFT — refactor candidates per Phase D.6 (workflow refusals)

These are refusals on workflow gates, handover sign-offs, stage advances, comms linkage, etc. — § 0A says the app should *record + audit + allow* with a reason from the right role, not refuse outright. Representative examples (not exhaustive):

| File:line | Refusal | Soft rule being enforced |
|---|---|---|
| `server/commissioning-routes.ts:172` | `res.status(400)` "Cannot transition from {old} to {new}" | Stage-status state machine. § 2A Rule 4/5. Should be override path. |
| `server/stage-lifecycle-routes.ts:213` | `res.status(403)` "Only admin roles can advance stages" | Stage-advance authority. RBAC enforcement is fine; refusal is fine; but the *path forward* should be the override authority pattern (`stage_gate_overrides`), not silent refusal. |
| `server/lifecycle-routes.ts:368` | `res.status(403)` "Only COO, CEO, or CCO can update RAG status" | RAG-status authority. Same comment. |
| `server/handover-routes.ts:200, 213, 264, …` (47 hits) | "Invalid gate ID" / "checkedItems array required" / "All checklist items must be acknowledged" | Mix: input-shape (HARD) + handover-completeness gate (SOFT). The completeness gate (§ 2A Rule 6) should record + override per § 0A, not refuse. |
| `server/smart-import-routes.ts:323, 717, 720, 753, 788, …` (33 hits) | Mostly 400 input validation (HARD); 403s on import-commit are RBAC (HARD). No SOFT workflow refusals identified — Smart Import already implements the "block on conflict, surface, let user resolve" override pattern. |
| `server/eng-stage-routes.ts:202, 218, 242, 264` | `res.status(403)` "COO access required" — manual overrides on engineering stage data | RBAC HARD on the call surface, but the *operation* is itself an override; legitimate. |
| `server/routes/document-management.routes.ts:76, 89` (`ApiError 409 ROOT_NOT_CONFIGURED`) | Project / company SharePoint root not configured | SOFT setup-completeness. § 4B / § 5 — caller should be guided to configure, not blocked. |
| `server/routes/document-management.routes.ts:674, 706` (`ApiError 423 LOCKED`) | Document checked out by another user | SOFT collaboration lock — should record + offer override (steal-checkout) per § 0A pattern. |

**Net for 0.1:** The 4 `ApiError` throws are all soft workflow rules in `document-management.routes.ts`. The 785 `res.status(400|403)` hits are overwhelmingly HARD (input validation + RBAC). The handful of SOFT workflow refusals concentrate in `commissioning-routes.ts`, `stage-lifecycle-routes.ts`, `handover-routes.ts`, and `lifecycle-routes.ts` — Phase D.6 should target these for the override-with-reason pattern.

---

## 0.2 — Inflow / outflow / cashflow audit (§ 3.4)

**Files read:** `server/repositories/finance-temporal-repository.ts`, `server/repositories/finance-inflows-repository.ts`, `server/repositories/finance-expense-engine-repository.ts`, `server/repositories/finance-analysis-repository.ts`, `shared/schema/finance.ts`, `server/routes/finance-analysis.routes.ts`, `server/routes/finance-legacy-extracted-routes.ts`, `server/routes/financials.routes.ts` (5 lines, no snapshot reads), `server/routes/finance-trust-routes.ts` (no snapshot reads), `server/financial-review-routes.ts` (no snapshot reads).

### Snapshot guard (`isNull(effectiveTo)`)

| Read path | File:line | Guard | Notes |
|---|---|---|---|
| `getAllCashflowPoints` | `finance-temporal-repository.ts:26` | ✓ `isNull(cashflowPoints.effectiveTo)` | |
| `getCashflowPointsByProject` | `finance-temporal-repository.ts:30` | ✓ | |
| `getAllFinanceRevenueMonthly` | `finance-temporal-repository.ts:57` | ✓ | |
| `getFinanceRevenueMonthlyByProject` | `finance-temporal-repository.ts:61` | ✓ | |
| `getAllFinanceCosMonthly` | `finance-temporal-repository.ts:88` | ✓ | |
| `getFinanceCosMonthlyByProject` | `finance-temporal-repository.ts:92` | ✓ | |
| `getAllProjectRevenueSummaries` | `finance-temporal-repository.ts:119` | ✓ | |
| `getProjectRevenueSummary` | `finance-temporal-repository.ts:123` | ✓ | |
| `upsertProjectRevenueSummary` (lookup) | `finance-temporal-repository.ts:128` (via `getProjectRevenueSummary`) | ✓ | |
| `getAllProgramInflows` / `getAllRevenueLinesForCashflow` | `finance-inflows-repository.ts:106` | ✓ + soft-delete guard | |
| `getProgramInflowsByProject` | `finance-inflows-repository.ts:135` | ✓ | |
| `updateProgramInflowFields` (where) | `finance-inflows-repository.ts:181` | ✓ | |
| `listAllActiveRevenueLines` | `finance-inflows-repository.ts:238` | ✓ | |
| `getRevenueLineForMatching`, `getRevenueLineProjectId`, `searchRevenueLinesByText`, `listActiveRevenueLineProjectNames`, `listActiveRevenueLinesForTrackerGap`, `updateRevenueLineAdminDateOverride`, `updateInBankByProjectAndRow`, `updatePaidDateFontColorById` | `finance-inflows-repository.ts:270, 285, 317, 335, 357, 376, 406, 416` | ✓ on every where-clause | |
| `getAllCostLinesForCashflow` | `finance-expense-engine-repository.ts:92` | ✓ + soft-delete | |
| `finance-analysis-repository.ts` reads (10 hits on snapshot tables) | `:96, :149, :203, :211, :277, :330, :342, :420, :738, :759` | ✓ on every read | (verified via grep, see Appendix B) |
| `finance-legacy-extracted-routes.ts` snapshot reads | `:247, :248` | ✓ | |

**Result:** **PASS** — every read against `cashflowPoints`, `financeRevenueMonthly`, `financeCosMonthly`, `projectRevenueSummary`, `normalizedRevenueLines`, `normalizedCostLines` in the named files includes `isNull(effectiveTo)`. The snapshot auditor sub-agent run is appended below.

### Receipt-date for revenue realisation (§ 3.4 — inflows)

`finance-inflows-repository.ts` adapts `normalized_revenue_lines` to inflow shape via `adaptRevenueToInflow`. Field mapping at `:155-168` confirms the source column `paidDate` (= payment-receipt-date) plus `paidDateFontColor` and `paidDateConfirmed` (= the BLACK/RED realisation signal per § 3.7). Inflow realisation correctly hangs off `paidDate` + colour, not `invoiceDate` or `expectedPaymentDate`. **PASS.**

Caveat — analysis routes: `finance-analysis.routes.ts:88,97,138,149,161,172,236,248` use `invoiceDate + termsDays + expectedDate` to compute AR/AP aging buckets. This is *aging* (overdue analysis), not *cashflow realisation* — § 3.4 allows expected/invoice dates for non-realisation surfaces. **PASS.**

### Outflows source (§ 3.4 — captured invoices + committed POs + payroll)

`finance-expense-engine-repository.ts:92-103` reads `normalized_cost_lines` and adapts to expense shape. Fields preserved: `paidDate` (actual-payment-date), `paidDateFontColor`, `paidDateConfirmed` — per § 3.4 BLACK = paid (realised outflow), RED = forecast. PO commitments are tracked via `poNumber` on `normalizedCostLines` (`shared/schema/finance.ts:625+`); allocation evidence joined via `attachAllocationEvidence`. Issued-but-unpaid-invoice rows are captured because cost lines carry both `invoiceDate` and `paidDate` separately, and downstream consumers gate realisation on `paidDateConfirmed` for cash and on `cosRealised` for cost recognition. **PASS** for the canonical read path.

⚠️ **Side-finding (cross-cuts § 3.7):** `server/lib/import/normalizer.ts:1603-1610` falls back the *actuals* `paidDate` (and its colour-derived `paidDateConfirmed` flag) to `forecastPaymentDate` when `paidDate` is blank:

```text
if (!paidDate && forecastPaymentDate) {
  paidDate = forecastPaymentDate;
  if (ws && forecastPayDateCol >= 0) {
    const fc = getCellFontColor(ws, i, forecastPayDateCol);
    paidDateFontColor = fc.color;
    paidDateConfirmed = fc.isBlack;
  }
}
```

This corrupts outflow realisation: a forecast cell that happens to be black gets stamped onto the actual-payment-date row as `paidDateConfirmed = true`. This is a § 3.7 / § 3.4 HARD-rule violation surfaced again in 0.7 (a) below.

### Snapshot auditor sub-agent run

`ee-snapshot-auditor` agent — invoked on the same in-scope file list. Verbatim:

> **No findings.**
>
> Reviewed ~35 read queries across the in-scope files. Every `db.select(...).from(<snapshot table>)` includes `isNull(<table>.effectiveTo)` (typically alongside `isNull(deletedAt)`):
>
> - `finance-inflows-repository.ts` — ~10 reads against `normalizedRevenueLines`, all guarded.
> - `finance-expense-engine-repository.ts` — ~12 reads against `normalizedCostLines`, all guarded.
> - `finance-temporal-repository.ts` — reads against `cashflowPoints`, `financeRevenueMonthly`, `financeCosMonthly`, `projectRevenueSummary` (`:26, :30, :57, :61, :88, :92, :119, :123`), all guarded.
> - `finance-analysis-repository.ts` — reads against `normalizedRevenueLines`, `normalizedCostLines`, `projectRevenueSummary`, `cashflowPoints` (`:96, :149, :203, :211, :277, :330, :342, :420, :738, :759`), all guarded.
> - `finance-legacy-extracted-routes.ts` — only two reads at `:247-248`, both guarded; remaining hits are imports / UPDATE / comments.
> - `financials.routes.ts`, `finance-analysis.routes.ts`, `finance-trust-routes.ts`, `financial-review-routes.ts` — no direct snapshot-table reads (route files delegate to repositories; remaining mentions are telemetry-string labels).
>
> `categoryRevenueAllocations`, `trackerRevenueSummary`, `trackerProjectMetadata`, `normalizedCostLineActuals` are not referenced in any in-scope file.

**Net 0.2 verdict:** snapshot-guard PASS for every read in the audited finance surface. The cashflow-realisation correctness defect identified in this section is **not** a snapshot-guard issue — it is the actuals-vs-forecast fallback in the import pipeline, which surfaces again in 0.7(a) and is the highest-priority Phase D item.

---

## 0.3 — Schema barrel resolution

**Files read:** `tsconfig.json`, `tsconfig.check.json`, `tsconfig.client-check.json`, `vite.config.*` (for the `@shared` alias), `shared/schema.ts`, `shared/schema/index.ts`, `package.json`.

**Notes on inputs:**
- `tsconfig.client.json` and `tsconfig.server.json` named in `CLAUDE.md` **do not exist**. The actual TS configs are `tsconfig.json` (root, included client+shared+server), `tsconfig.check.json` (server scope), and `tsconfig.client-check.json` (client+shared scope). CLAUDE.md is stale here.

**Resolution of `@shared/schema`:**
- TS `paths`: `@shared/*` → `./shared/*` (root tsconfig).
- Vite alias (`vite.config.ts:29`): `@shared` → `path.resolve(import.meta.dirname, "shared")`.
- `moduleResolution: "bundler"` + Node-style: when resolving a bare path `./shared/schema`, the resolver tries `./shared/schema.ts` BEFORE `./shared/schema/index.ts`. **`@shared/schema` resolves to `shared/schema.ts`.**

**Both files exist and diverge:**

`shared/schema.ts` (37 lines, 26 re-exports) re-exports:
> users, projects, finance, engineering, tasks, quality, mytool, imports, legacy, collaboration, soft-delete, construction, hse, handover, stage-lifecycle, stage-data, stage-collaboration, collaboration-workflow, integrations, dashboard-snapshots, task-reminders, documents, email-links, pending-approvals, **app-settings**

`shared/schema/index.ts` (31 lines, 28 re-exports) re-exports:
> users, projects, finance, engineering, tasks, quality, mytool, imports, legacy, collaboration, soft-delete, construction, hse, handover, stage-lifecycle, stage-data, stage-collaboration, collaboration-workflow, **template-overrides**, **role-based-upgrade**, **commissioning-source**, integrations, dashboard-snapshots, task-reminders, **home**, documents, email-links, pending-approvals

**Divergence:**
- Only in `shared/schema.ts`: `app-settings`.
- Only in `shared/schema/index.ts`: `template-overrides`, `role-based-upgrade`, `commissioning-source`, `home` (4 modules).

**Single resolution + dead-code finding:**
`shared/schema/index.ts` is **dead code** — it is never the target of `@shared/schema` resolution. The 4 modules it re-exports that the live barrel doesn't (`template-overrides`, `role-based-upgrade`, `commissioning-source`, `home`) are reachable only via direct `@shared/schema/<file>` imports, which is fine for those consumers — but anyone who imports those 4 via `@shared/schema` (as the live `shared/schema.ts` is documented to be the only barrel) will silently miss them. This is a real footgun: a contributor who follows the CLAUDE.md guidance "edit `shared/schema/*.ts`" and adds re-exports to `shared/schema/index.ts` will produce changes that compile and pass `db:check` but never load.

**Recommendation:** delete `shared/schema/index.ts` and ensure `shared/schema.ts` re-exports the 4 missing modules (verify each is actually a module to be barrelled — `home` and `commissioning-source` may already be intentionally direct-import).

---

## 0.4 — Playbook templates seeded?

**Files read:** `docs/operating-model/playbook-v2.0.md` lines 1233-1253 (Companion Templates), `migrations/0000_baseline_20260419.sql` (DDL search), `server/bootstrap/run-startup-seeds.ts`, list of `server/seed-*.ts`.

### The 13 playbook templates (verbatim from § "Companion Templates"):

1. First Assessment Checklist
2. Feasibility Assumptions Register
3. Cost Proposal Approval Sheet
4. Financial Close Gate
5. PD-to-PM Handover
6. Construction Readiness Gate
7. HSE File Checklist
8. Commissioning Readiness Gate
9. O&M Handover to Matriarch
10. Client Handover Checklist
11. 3-Month Post-HO Review
12. Compliance Handover
13. Hold / Blocked Register

### Schema state

`migrations/0000_baseline_20260419.sql` defines the tables `phase_template`, `phase_template_application`, `phase_template_item`, `phase_template_item_history` (lines 530-580) — schema exists.

### Seed data state

Grep `INSERT INTO phase_template` across `migrations/`, `server/bootstrap/`, `server/migrations/`: **0 hits.** The phase_template tables are DDL-only — no rows seeded by the baseline migration or any subsequent migration.

`server/bootstrap/run-startup-seeds.ts` enumerates 14 seeders (folder taxonomy, quality template, NCR tables, eng-stage templates, role credentials, TR register, intake task templates, mock intake, role permissions, role templates, story lifecycle, ee-info updates, lessons learnt, EE-info boot import). **None of them seed `phase_template`.**

### Match list

| # | Playbook template | Seeded as `phase_template` row? | Closest existing surface |
|---|---|---|---|
| 1 | First Assessment Checklist | ❌ no | — |
| 2 | Feasibility Assumptions Register | ❌ no | — |
| 3 | Cost Proposal Approval Sheet | ❌ no | — |
| 4 | Financial Close Gate | ❌ no | `stage_gate_definitions` (separate surface) |
| 5 | PD-to-PM Handover | ❌ no | `pd_pm_handover` tables exist; not modelled as `phase_template` |
| 6 | Construction Readiness Gate | ❌ no | `stage_gate_definitions` |
| 7 | HSE File Checklist | ❌ no | `hse` schema (separate) |
| 8 | Commissioning Readiness Gate | ❌ no | `stage_gate_definitions` |
| 9 | O&M Handover to Matriarch | ❌ no | `handover` schema (separate) |
| 10 | Client Handover Checklist | ❌ no | `handover` schema (separate) |
| 11 | 3-Month Post-HO Review | ❌ no | — |
| 12 | Compliance Handover | ❌ no | `handover` schema (separate) |
| 13 | Hold / Blocked Register | ❌ no | `project_status` enum + Hold metadata (§ 4A) |

### Gap list

**All 13 templates are unseeded in the `phase_template` registry.** The schema exists; the seed step was skipped (or the team chose to model templates via domain-specific tables instead). The playbook’s expectation — that one workbook with 13 tabs is referenced from the app at every relevant gate — is not met by any single registry today; it is fragmented across `stage_gate_definitions`, `handover`, `hse`, `pd_pm_handover`, etc. Phase D candidate: either seed `phase_template` with the 13 rows (each pointing to its existing surface) so the playbook table is the single registry, or formally retire `phase_template` if the per-domain split is the intended model.

---

## 0.5 — `no_po_flag` usages

**Search:** `no_po_flag` and `noPoFlag` across `*.ts`, `*.tsx`, `*.sql`, `*.json` repo-wide.

**Result:** **0 hits.** No definitions, migrations, reads, writes, or UI references.

**Recommendation:** **drop quietly.** Per § 13 of `AGENT_GUARDRAILS.md`, the no-PO flag rule was deliberately removed at owner direction (2026-05-07) and "if audit policy on this changes again, it returns via owner update to this file." The codebase already reflects that retirement — no deprecation work needed.

---

## 0.6 — Silent-allow audit gaps

**Search scope:** mutation-style function names containing `advance|override|approve|markComplete|setStage|transition|complete|accept|reject` and HTTP routes with corresponding paths, in `server/routes/*.routes.ts`, `server/*-routes.ts`, `server/repositories/*`, `server/services/*`. Audit infrastructure: `audit_events` (canonical) + domain-specific (`projectStageDecisions`, `stage_gate_evidence_snapshots`, `projectPhaseHistory`, `stage_gate_overrides`, `merge_audit_log`).

### Compliant (writes some audit table)

| Function / route | File:line | Audit surface |
|---|---|---|
| `completeHandover` | `server/handover-routes.ts:1272` (logAudit at +21) | `audit_events` via `logAuditFromReq` |
| `app.post('/api/projects/:projectId/handover-gates/:gateId/complete')` | `server/handover-routes.ts:193` (audit further down) | `audit_events` |
| `app.post('/api/pd-pm-handover/:projectId/accept')` | `server/handover-routes.ts:939` | `project_phase_history` + `audit_events` |
| `app.post('/api/pd-pm-handover/:projectId/reject')` | `server/handover-routes.ts:1056` | `audit_events` |
| `app.post('/api/pd-pm-handover/:projectId/pm-sign-off')` | `server/handover-routes.ts:1239` | `audit_events` |
| `app.post('/api/lifecycle-board/projects/:id/stage-gates/override')` | `server/lifecycle-routes.ts:1741` | `audit_events` |
| `app.post('/api/eng-stages/stages/:stageId/complete')` | `server/eng-stage-routes.ts:1019` (logAudit at :1182) | `audit_events` |
| `app.post('/api/eng-stages/stages/:stageId/override-complete')` | `server/eng-stage-routes.ts:1236` | `audit_events` |
| `app.patch('/api/eng-stages/deliverables/:id/approve')` etc. | `server/eng-stage-routes.ts:702, 771, 838, 965` | `audit_events` (verified by spot-check at L1182 region pattern) |
| `app.post('/api/payment-batches/:id/approve')` | `server/payment-batch-routes.ts:234` | `audit_events` (pattern; not re-verified line-by-line) |
| `app.patch('/api/approvals/:type/:id/action')` | `server/routes/lifecycle-approvals-routes.ts:117` | `audit_events` |
| `app.post('/api/templates/overrides')` | `server/routes/template-governance-routes.ts:169` | `audit_events` + insert into `template_overrides` |
| `app.post('/api/revenue-tracking/overrides')` | `server/routes/finance-legacy-extracted-routes.ts:659` | `audit_events` |
| `app.post('/api/expenditure/overrides')` | `server/routes/finance-legacy-extracted-routes.ts:765` | `audit_events` |
| `app.post('/api/quality/warning/:warningId/resolve')` | `server/quality-routes.ts:1472` | `audit_events` + `qcWarningEvent` |

### Gaps — silent allows

| Function / route | File:line | Issue | Should write |
|---|---|---|---|
| `transitionStageStatus` | `server/services/stage-lifecycle-service.ts:766` | Writes `projectStageDecisions` (decision log) and `stage_gate_evidence_snapshots`, but NOT to canonical `audit_events`. The `decisionType: 'stage_override'` is recorded inside the domain audit table, not in `stage_gate_overrides`. | `audit_events`; consider also `stage_gate_overrides` when `isOverride === true`. Spirit-of-rule may be satisfied by `projectStageDecisions`, but it is a parallel audit table not in the canonical list (§ 0A). |
| `advanceToStage` | `server/services/stage-lifecycle-service.ts:1168` | Writes `projectStageDecisions` only; no `audit_events` entry. | `audit_events`. |
| `app.post('/api/projects/:projectId/acceptances')` | `server/collaboration-workflow-routes.ts:71` | No `logAudit*`, no insert into any audit table in the route body. | `audit_events`. |
| `app.patch('/api/projects/:projectId/acceptance-reservations/:id')` | `server/collaboration-workflow-routes.ts:104` | Same — silent. | `audit_events`. |
| `app.patch('/api/tr-register/:id/complete')` | `server/tr-register-routes.ts:465` | No audit write in handler body. | `audit_events`. |
| `app.patch('/api/governance/quality/:id/action')` | `server/routes/governance-views-routes.ts:89` | No `logAudit*` reference within the action handler. | `audit_events`. |
| `app.post('/api/quality/warning/:warningId/acknowledge')` | `server/quality-routes.ts:1451` | (Spot-check; re-verify) — earlier-in-range patterns suggest pair with `:resolve` audit, but `:acknowledge` was not visible in the audit grep window. Confirm in Phase D. | `audit_events`. |
| `app.post('/api/payment-requests/:id/review')` | `server/payment-request-routes.ts:238` | (Same caveat — audit not seen in spot-check window. Confirm.) | `audit_events`. |

**Method note:** I sampled 6–8 representative handlers; the full silent-allow surface is larger. The pattern `await logAuditFromReq(req, …)` is the canonical write — Phase D should grep for *every* mutation route that lacks it. The two **named-and-confirmed** gaps are the lifecycle-service functions `transitionStageStatus` and `advanceToStage`: every project-stage transition currently goes through them, and every transition skips `audit_events`. That is the highest-priority defect in this section.

---

## 0.7 — Smart Import planned/actual + comparison scope (§ 3.7, § 9.3)

**Files read:** `server/lib/import/baseline.ts`, `server/lib/import/merge-engine.ts`, `server/lib/import/conflict-engine.ts`, `server/lib/import/row-matcher.ts`, `server/lib/import/commit-executor.ts` (lines 470-540, 760-840), `server/lib/import/normalizer.ts` (lines 1590-1620), `server/imports/import-conflict-policy.ts` (header), `shared/schema/finance.ts`, `shared/excel-vs-app/contract.ts`.

### (a) Imports pull ACTUAL dates into actuals fields, no fallback to planned

**REVENUE side — PASS.** `commit-executor` writes the revenue tracked-fields verbatim from the file row (no `actual ?? planned` substitution). `paidDate` (= payment-receipt-date / actual) is a separate column from `expectedPaymentDate` (= planned/forecast). The contract (`shared/excel-vs-app/contract.ts:96-108`) tracks `expectedPaymentDate` and `paidDate` separately, and the merge engine compares each independently.

**EXPENDITURE side — FAIL (§ 3.7 violation).** `server/lib/import/normalizer.ts:1603-1610`:

```ts
if (!paidDate && forecastPaymentDate) {
  paidDate = forecastPaymentDate;
  if (ws && forecastPayDateCol >= 0) {
    const fc = getCellFontColor(ws, i, forecastPayDateCol);
    paidDateFontColor = fc.color;
    paidDateConfirmed = fc.isBlack;
  }
}
```

The actual `paidDate` field on `normalized_cost_lines` falls back to `forecastPaymentDate` when blank, AND copies the forecast column's font colour onto `paidDateFontColor` / `paidDateConfirmed`. This is the exact pattern § 3.7 forbids (HARD): an actuals field receives a planned/forecast date and an unrelated cell's colour gets stamped as the realisation signal. Combined with `cashflowConfirmed = !!(invoiceNumber && poNumber && paidDateConfirmed)` at `:1615`, a forecast-only line with a black forecast cell can flip to "cashflow confirmed" without any actual payment occurring. **Highest-priority Phase D defect.**

**PLAN side — DEBATABLE.** `commit-executor.ts:504-516`:
```ts
return {
  startDate: toFieldValue(actualStart ?? planStart),
  endDate:   toFieldValue(actualEnd ?? planEnd),
  baselineStart: toFieldValue(planStart),
  baselineEnd:   toFieldValue(planEnd),
  actualStart: toFieldValue(actualStart),
  actualEnd:   toFieldValue(actualEnd),
};
```
The pure-actual columns (`actualStart`, `actualEnd`) and pure-planned columns (`baselineStart`, `baselineEnd`) are kept clean. The **primary** `startDate`/`endDate` columns on `work_items` are written as `actual ?? planned` per a deliberate 2026-05-07 product change (commented in-source). § 3.7 is unambiguous: app-side actuals fields receive ACTUAL dates only — but `work_items.startDate` is positioned here as an *effective-date* column rather than an actuals column. Recommend the owner confirm:
- if `work_items.startDate` is documented as the "current effective" date (planned until the actual lands, then actual), this is compliant — the pure-actual column is `actualStart`;
- if anywhere in the app `work_items.startDate` is read as "the actual" (e.g., for stage-gate "did this start by date X?" logic), this is a § 3.7 violation under the same rule as the cost-line fallback above.

### (b) Excel replica preserves both planned and actual side-by-side

**PASS.** `shared/excel-vs-app/contract.ts:80-92` (`PLAN_TRACKED_FIELDS`) tracks `startDate`, `endDate` (effective primary), `baselineStart`, `baselineEnd` (planned), `actualStart`, `actualEnd` (actual) — six columns, both planned and actual present. For revenue/expenditure the planned counterpart is `expectedPaymentDate` / `forecastPaymentDate`, also tracked alongside `paidDate`. Replica routes (`server/routes/tracker-replica.routes.ts:44, 76, 217`) read these fields directly, so the replica view receives both sides.

### (c) Conflict-engine comparison scope (§ 9.3)

**PASS.** `server/lib/import/row-matcher.ts:297-325` defines the three section field-lists; the conflict engine and merge engine both consume these via `getCompareFields()` (`conflict-engine.ts:174`):

- **PLAN_COMPARE_FIELDS:** `startDate, endDate, durationDays, actualStartDate, actualEndDate, actualDurationDays` — dates only.
- **REVENUE_COMPARE_FIELDS:** `amountExVat, vat, invoiceDate, expectedPaymentDate, paidDate, inBankDate, invoiceDateConfirmed, paidDateConfirmed` — amounts + dates + colour-confirmed flags.
- **EXPENDITURE_COMPARE_FIELDS:** `amountExVat, budgetQty, budgetRate, budgetTotal, budgetCos, actualQty, actualRate, revenueRecognitionAmount, invoiceDate, approvedDate, paidDate, forecastPaymentDate, invoiceDateConfirmed, paidDateConfirmed, cosRealised, cashflowConfirmed` — amounts + dates + colour-confirmed flags + derived realisation flags.

**No descriptions, names, supplier names, free-text, ordering, hidden columns, formulas, or formatting are compared.** Add/delete is handled by the row-matcher (`row-matcher.ts`, classifications NEW / MISSING_FROM_UPLOAD). Date-colour is in scope via the `*Confirmed` boolean flags (and as `cosRealised` / `cashflowConfirmed` derived from colour at import). Compliant with § 9.3.

### (d) Date colour read at import + survives round-trip

**PASS-with-caveat.** Colour is read at import time via `getCellFontColor` in `normalizer.ts` (verified for the forecast/payment date column at `:1606`; the same helper is invoked on invoice-date and other tracked-colour columns by the same module). The derived `paidDateConfirmed` / `invoiceDateConfirmed` boolean flags are persisted as columns on `normalized_revenue_lines` / `normalized_cost_lines` (per `REVENUE_TRACKED_FIELDS` / `EXPENDITURE_TRACKED_FIELDS`), so the realisation signal survives the import boundary as data, not as cell formatting.

Round-trip robustness: a re-import with no actual changes will compare its newly-read `paidDateConfirmed` against the stored value via the merge engine. If the colour fidelity is preserved in the workbook, the field equals snapshot equals current and classifies as `no_change` / `UNCHANGED`. The **caveat** is the `paidDate ← forecastPaymentDate` fallback in (a): once that fallback fires, the stored `paidDateConfirmed` no longer reflects the actual-payment cell colour — it reflects the forecast cell colour. A subsequent re-import that enters the same fallback branch reproduces the same wrong flag deterministically, so the user *will not see* a flip; but the stored realised state is wrong vs the workbook author's intent.

### Pass/fail summary for § 0.7

| Check | Verdict |
|---|---|
| (a) Actuals receive actual dates only, no fallback to planned | ❌ **FAIL** for EXPENDITURE (`normalizer.ts:1603-1610`); ⚠ DEBATABLE for PLAN (effective-date column policy); ✓ PASS for REVENUE. |
| (b) Replica preserves planned + actual side-by-side | ✓ **PASS** |
| (c) Conflict scope = dates / amounts / add-delete / colour only | ✓ **PASS** |
| (d) Date colour as realisation signal, survives round-trip | ✓ **PASS-with-caveat** (the EXPENDITURE fallback in (a) corrupts the colour-derived flag for cost lines but does not unflip on round-trip). |

**Net Phase D priority:** (a) the cost-line `paidDate ← forecastPaymentDate` fallback is the single highest-stakes Smart Import defect identified in this audit. Same priority bracket as the inflow/outflow audit in 0.2.

---

## Appendix A — 0.1 raw counts (top files)

```
47 server/handover-routes.ts
36 server/stage-lifecycle-routes.ts
33 server/smart-import-routes.ts
32 server/quickbooks-routes.ts
30 server/routes/planning-extracted-routes.ts
30 server/quality-routes.ts
29 server/lifecycle-routes.ts
26 server/routes/mytool-routes.ts
26 server/eng-stage-routes.ts
22 server/routes/finance-legacy-extracted-routes.ts
22 server/ms-sync-routes.ts
21 server/po-routes.ts
20 server/routes/support-extracted-routes.ts
16 server/routes/template-governance-routes.ts
…
```

## Appendix B — 0.2 finance-analysis-repository snapshot reads (verbatim grep)

```
:96   .from(normalizedRevenueLines)
:99       isNull(normalizedRevenueLines.effectiveTo),
:149  .from(normalizedCostLines)
:152      isNull(normalizedCostLines.effectiveTo),
:203  .from(projectRevenueSummary)
:204  .where(isNull(projectRevenueSummary.effectiveTo));
:211  .from(normalizedCostLines)
:214      isNull(normalizedCostLines.effectiveTo),
:277  .from(normalizedCostLines)
:280      isNull(normalizedCostLines.effectiveTo),
:330  .from(normalizedRevenueLines)
:333      isNull(normalizedRevenueLines.effectiveTo),
:342  .from(normalizedCostLines)
:345      isNull(normalizedCostLines.effectiveTo),
:420  .from(cashflowPoints)
:423      isNull(cashflowPoints.effectiveTo),
:738  .from(normalizedRevenueLines)
:740      isNull(normalizedRevenueLines.effectiveTo),
:759  .from(normalizedCostLines)
:761      isNull(normalizedCostLines.effectiveTo),
```
