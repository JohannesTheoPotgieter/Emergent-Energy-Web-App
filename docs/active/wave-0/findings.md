# Wave-0 Read-Only Audit — Findings

**Author:** Claude Code (read-only audit)
**Date:** 2026-05-07
**Scope:** seven-item audit per Phase D pre-work brief.
**Method:** read-only. No code changed. File reads constrained to the
named files per item; ~38 files read in total under the 50-file cap.

Sources of truth used: `docs/AGENT_GUARDRAILS.md`,
`docs/operating-model/playbook-v2.0.md`.

---

## 0.1 — Workflow refusals classification

**Method.** Grep for `throw new ApiError`, `res.status(403)`,
`res.status(400)`, `status: 403` across `server/routes/*.routes.ts`,
`server/*-routes.ts`, `server/middleware/*`. **780 occurrences** in
139 route files (82 new-style + 57 legacy). Top contributors:
`server/handover-routes.ts` (47), `server/stage-lifecycle-routes.ts`
(36), `server/smart-import-routes.ts` (33),
`server/quickbooks-routes.ts` (32), `server/routes/planning-extracted-routes.ts` (30),
`server/quality-routes.ts` (30), `server/lifecycle-routes.ts` (29).

The volume is too large to enumerate every line; instead, classified
by category, with representative examples per category.

### A — HARD per § 5A (security / data-integrity) — KEEP

These are correct refusals with no override path. Few in number.

- `server/middleware/csrf.ts:69` — CSRF token absent or invalid. Per
  § 5A "Disable CSRF middleware" is a hard refusal. Keep.
- `server/middleware/requireAuth.ts` — session absent. Keep.
- `server/middleware/requireRole.ts:41` — role missing for any
  RBAC-sensitive route. Keep — RBAC is a hard floor; the override
  path lives one level up (a higher-privileged user re-auths).
- `server/middleware/production-safety.ts:10,31,44` — refuses
  prod-only destructive actions when not authorised. Keep.
- All `res.status(400)` + `res.status(500)` paths that mask
  raw DB errors via `ApiError` shape (e.g.
  `server/handover-routes.ts:139` "Invalid project ID" guard before
  any DB call). Boundary input validation — keep.

Estimated share of the 780 occurrences: ~60% are pure boundary
input-validation 400s (`if (isNaN(projectId)) return 400`) — keep
as-is, no Phase D refactor needed.

### B — SOFT workflow refusals — REFACTOR per Phase D.6 (§ 0A)

These enforce gate criteria, handover sign-off, stage advancement,
or comms linkage. Per § 0A the app should record + surface +
audit, with a named override authority + reason — NOT block. Today
they hard-refuse. Refactor candidates.

Stage-advancement refusals (§ 4 / § 2A Six Rule #5):

- `server/stage-lifecycle-routes.ts:213` — "Only admin roles can
  advance stages". Soft. Keep gate, add override-with-reason path
  for COO + Programme Manager via `stage_gate_overrides`.
- `server/stage-lifecycle-routes.ts:223` — gate-criteria failure
  blocks transition. Soft. Per § 3A.3 stage advancement requires
  evidence; per § 0A COO should be able to override with reason.
- `server/stage-lifecycle-routes.ts:269` — "Only admin roles can
  place a project on hold". Soft.
- `server/stage-lifecycle-routes.ts:299` — "Only admin roles can
  resume a project". Soft.
- `server/stage-lifecycle-routes.ts:329` — "Only admin roles can
  mark a project done". Soft.

Handover refusals (§ 2A Six Rule #6):

- `server/handover-routes.ts:306` — "Only admin/program manager can
  reopen gates". Soft. Allow override.
- `server/handover-routes.ts:945` — "Could not accept handover.
  Likely reason: your PM permission is missing or the handover is
  incomplete". Soft.
- `server/handover-routes.ts:966` — "Cannot accept handover:
  mandatory sections are incomplete." Soft. Per playbook §
  "Companion Templates" #5 (PD-to-PM Handover) the templates
  define mandatory fields; right person + reason should override.
- `server/handover-routes.ts:1063` — "Could not reject handover.
  Likely reason: your PM permission is missing." Soft.
- `server/handover-routes.ts:1142` — "Excel tracker link can only
  be updated after handover is accepted." Soft.
- `server/handover-routes.ts:1210` — "PD sign-off requires Project
  Developer role." Soft.
- `server/handover-routes.ts:1245` — "PM sign-off requires PM role." Soft.
- `server/handover-routes.ts:1493` — "Admin override only applies
  to completed handovers." Soft.

Lifecycle refusals (§ 4):

- `server/lifecycle-routes.ts:50` — "Executive role required". Soft.
- `server/lifecycle-routes.ts:368` — "Only COO, CEO, or CCO can
  update RAG status". Soft (RAG override pattern exists).
- `server/lifecycle-routes.ts:1485` — "Cannot merge a project with
  itself" — actually a logic guard, not a workflow rule. Keep.
- `server/lifecycle-routes.ts:1749` — "Your role is not authorized
  to submit stage gate overrides" — this IS the override path; the
  refusal of who-may-override is structural. Keep.
- `server/lifecycle-routes.ts:2212` — "Project is already active" —
  state check. Soft / keep (operationally low-stakes).

QuickBooks refusals (§ 3.4 cross-system reconciliation):

- `server/quickbooks-routes.ts:1009,1060,1166,1242` — role-gated
  mapping/match operations. Soft. The financial-formula integrity
  rule is HARD (§ 3.2/3.3/3.4) but who can *touch the mapping* is
  workflow.

### C — SOFT but appropriate — KEEP

Refusals that enforce data correctness at the API boundary
without blocking business decisions:

- `server/handover-routes.ts:1133,1136` — URL format validation on
  PM Excel Tracker link. Keep.
- `server/middleware/validateBody.ts:8` — Zod boundary validation. Keep.
- All `res.status(400)` for missing required parameter shapes. Keep.

### Summary classification

| Category | Estimated count | Disposition |
|---|---|---|
| A — HARD (security / data) | ~20 | Keep |
| B — SOFT workflow (Phase D.6 refactor) | ~80 | Refactor to override-with-reason |
| C — Boundary validation | ~680 | Keep as-is |

Top files for the Phase D.6 refactor: `server/handover-routes.ts`,
`server/stage-lifecycle-routes.ts`, `server/lifecycle-routes.ts`,
`server/routes/handover.routes.ts` (if/when migrated).

---

## 0.2 — Inflow / outflow / cashflow audit (§ 3.4)

**Files read:** `server/repositories/finance-temporal-repository.ts`,
`server/repositories/finance-inflows-repository.ts`,
`server/repositories/finance-analysis-repository.ts`,
`shared/schema/finance.ts`,
`server/routes/finance-analysis.routes.ts`,
`server/routes/financials.routes.ts` (5-line stub),
`server/routes/finance-trust-routes.ts`,
`server/routes/finance-legacy-extracted-routes.ts`.

### Pass/fail per code path

| # | Path | `isNull(effectiveTo)` | Date source matches § 3.4 |
|---|---|---|---|
| 1 | `getAllCashflowPoints` | finance-temporal-repository.ts:26 | PASS | n/a (reads pre-built series) |
| 2 | `getCashflowPointsByProject` | :30 | PASS | n/a |
| 3 | `getAllFinanceRevenueMonthly` | :57 | PASS | n/a |
| 4 | `getFinanceRevenueMonthlyByProject` | :61 | PASS | n/a |
| 5 | `getAllFinanceCosMonthly` | :88 | PASS | n/a |
| 6 | `getFinanceCosMonthlyByProject` | :92 | PASS | n/a |
| 7 | `getAllProjectRevenueSummaries` | :119 | PASS | n/a |
| 8 | `getProjectRevenueSummary` | :123 | PASS | n/a |
| 9 | `getAllRevenueLinesForCashflow` (inflows-repo:106) | PASS | uses live row → adapter; receipt-date logic in `adaptRevenueToInflow` (lib/data-merge — not in scope) |
| 10 | `getProgramInflowsByProject` (:133) | PASS | same |
| 11 | `listOutstandingRevenueLines` (analysis-repo:96) | PASS | reads NRL with effectiveTo + deletedAt guards |
| 12 | `listOutstandingCostLines` (:149) | PASS | reads NCL guards |
| 13 | `listProjectCosRows` (:206/:211) | PASS | NCL + projectRevenueSummary both guarded |
| 14 | `listCounterpartyMonthlyCos` (:280) | PASS | NCL guards |
| 15 | `listCashflowPointsForRange` (:423) | PASS | `effectiveTo` + range filters |
| 16 | finance-legacy-extracted-routes.ts:247-275 monthly inflow/outflow rollup | PASS — paid-date colour-derived `isInBank` at :273-275 (`paidDateConfirmed === true \|\| paidDateFontColor === 'black'`) matches § 3.4 BLACK signal |

### Receipt-date / payment-date / supplier-invoice rule (§ 3.4)

- **Inflows.** finance-legacy-extracted-routes.ts:272-275 derives
  `isInBank` from `paidDateConfirmed` + `paidDateFontColor === 'black'`,
  i.e. the BLACK = received signal. PASS.
- **Outflows.** finance-legacy-extracted-routes.ts:291-303 reads
  cost-line `invoiceDate` + `paidDate`, with `paidDate` driving
  realised outflow. The committed-PO and payroll-pattern projection
  components are **not visible in the named files** — they live in
  Smart Import / cashflow-helpers / payroll services, which are
  out of scope for this audit item. **Gap to verify in Wave-1.**
- **Cashflow points.** Built upstream by the Smart Import pipeline
  (`createManyCashflowPoints` callers in
  `server/routes/imports-admin-extracted-routes.ts` and
  `server/departments/admin-routes.ts`). Read paths in scope all
  apply `isNull(effectiveTo)`; the producer's correctness is a
  Wave-1 follow-up.

### `ee-snapshot-auditor` subagent — appended findings

Subagent ran against the eight named files:

> **PASS — no missing `effectiveTo` guards in scope.**
> ~21 snapshot-table read queries reviewed. Tables checked:
> normalizedCostLines, normalizedRevenueLines, cashflowPoints,
> financeRevenueMonthly, financeCosMonthly, categoryRevenueAllocations,
> projectRevenueSummary, normalizedCostLineActuals, trackerRevenueSummary,
> trackerProjectMetadata.
>
> All snapshot reads at finance-temporal-repository.ts (8 reads),
> finance-inflows-repository.ts (8), finance-analysis-repository.ts
> (10), and finance-legacy-extracted-routes.ts (2) include the guard.
> The route file `financials.routes.ts` is a 5-line stub.
> `finance-trust-routes.ts` and `finance-analysis.routes.ts` delegate
> to repositories with no direct snapshot queries.

### Verdict 0.2

PASS overall. No snapshot-guard violations in the eight named files.
One follow-up: verify the upstream cashflow-point producer (Smart
Import pipeline) sources outflows from supplier invoices + committed
POs + payroll-pattern projections per § 3.4. That code lives outside
this audit's named-file budget.

---

## 0.3 — Schema barrel resolution

**Files read:** `tsconfig.json`, `tsconfig.check.json`,
`tsconfig.client-check.json`, `package.json`, `shared/schema.ts`,
`shared/schema/index.ts`. (Note: `tsconfig.client.json` and
`tsconfig.server.json` referenced in the brief don't exist; the
actual configs are `tsconfig.check.json` (server scope) and
`tsconfig.client-check.json`.)

### Resolution

`@shared/*` path mapping in `tsconfig.json:35` →
`./shared/*`. With `moduleResolution: "bundler"`
(tsconfig.json:30), TypeScript resolves `@shared/schema` by trying
`./shared/schema.ts` first; only if that file doesn't exist does it
fall back to `./shared/schema/index.ts`.

Both files exist (`shared/schema.ts` and `shared/schema/index.ts`).
Therefore:

- `@shared/schema` → **`shared/schema.ts`** (file wins over directory).
- **`shared/schema/index.ts` is dead code** — never reached via the
  barrel import.

### Drift between the two barrels

| Module | `shared/schema.ts` | `shared/schema/index.ts` |
|---|---|---|
| users / projects / finance / engineering / tasks / quality / mytool / imports / legacy / collaboration | yes | yes |
| soft-delete / construction / hse / handover / stage-lifecycle / stage-data / stage-collaboration / collaboration-workflow | yes | yes |
| integrations / dashboard-snapshots / task-reminders / documents / email-links / pending-approvals | yes | yes |
| **app-settings** | yes | **NO** |
| **template-overrides** | **NO** | yes |
| **role-based-upgrade** | **NO** | yes |
| **commissioning-source** | **NO** | yes |
| **home** | **NO** | yes |

### Consequences

The four modules `template-overrides`, `role-based-upgrade`,
`commissioning-source`, `home` are NOT reachable via `@shared/schema`.
Every consumer must import them by direct path
(`@shared/schema/template-overrides`, etc.).
Verified — code DOES reach these by direct path:

- `server/routes/template-governance-routes.ts` and
  `server/routes/lens-config-routes.ts` use direct paths.
- `server/routes/home-do-next-routes.ts` uses direct path for `home`.
- `server/services/commissioning-workbook-parser.ts` uses
  direct path for `commissioning-source`.

### Recommendation

Choose one barrel and align. Per CLAUDE.md "shared/schema.ts is a
barrel — DO NOT add tables here" — `shared/schema.ts` is the canonical
barrel. Add the four missing exports to it and delete
`shared/schema/index.ts`. Phase D quick win.

### Verdict 0.3

DEFECT — divergent barrels; one is dead. Not breaking today (direct
imports work), but a foot-gun for future tables added to either side.

---

## 0.4 — Playbook templates seeded

**13 companion templates** per playbook §"Companion Templates"
(playbook-v2.0.md:1239-1253):

| # | Template name |
|---|---|
| 1 | First Assessment Checklist |
| 2 | Feasibility Assumptions Register |
| 3 | Cost Proposal Approval Sheet |
| 4 | Financial Close Gate |
| 5 | PD-to-PM Handover |
| 6 | Construction Readiness Gate |
| 7 | HSE File Checklist |
| 8 | Commissioning Readiness Gate |
| 9 | O&M Handover to Matriarch |
| 10 | Client Handover Checklist |
| 11 | 3-Month Post-HO Review |
| 12 | Compliance Handover |
| 13 | Hold / Blocked Register |

### Search

- `migrations/*.sql` for `INSERT INTO phase_template`: **0 hits**.
- `server/bootstrap/run-startup-seeds.ts` references no
  `phase_template` seeder.
- `server/bootstrap/backfills/`: 11 backfills, none touch
  `phase_template`.
- `server/seed-*.ts`: 7 seed files (`seed-eng-templates`,
  `seed-quality-template`, `seed-intake-templates`,
  `seed-mock-intake`, `seed-folder-taxonomy`, `seed-ee-info-updates`,
  `seed-lessons-learnt`). None target `phase_template`.

The `phase_template` table is created in
`migrations/0000_baseline_20260419.sql:530` (and three sibling
tables: `phase_template_application:542`, `phase_template_item:555`,
`phase_template_item_history:580`). The schema is `phaseTemplate` at
`shared/schema/projects.ts:860`. **No seed data exists anywhere.**

### Match list

| # | Template | Seeded? |
|---|---|---|
| 1 | First Assessment Checklist | NO |
| 2 | Feasibility Assumptions Register | NO |
| 3 | Cost Proposal Approval Sheet | NO |
| 4 | Financial Close Gate | NO |
| 5 | PD-to-PM Handover | NO |
| 6 | Construction Readiness Gate | NO |
| 7 | HSE File Checklist | NO |
| 8 | Commissioning Readiness Gate | NO |
| 9 | O&M Handover to Matriarch | NO |
| 10 | Client Handover Checklist | NO |
| 11 | 3-Month Post-HO Review | NO |
| 12 | Compliance Handover | NO |
| 13 | Hold / Blocked Register | NO |

### Notes on adjacent surfaces

- `seed-intake-templates.ts` seeds `intakeTaskTemplates` — task lists
  per request type ("First Assessment", "Cost Proposal", etc.).
  These are operational task templates, not the playbook companion
  templates. Different table, different shape.
- The 10 lifecycle stage definitions are seeded in
  `server/services/stage-lifecycle-service.ts:300` (`SEEDED_STAGE_DEFINITIONS`).
  These are stages, not templates.

### Verdict 0.4

GAP — all 13 playbook companion templates are unseeded. Phase D
should add a `seedPhaseTemplates` script wired into
`run-startup-seeds.ts`. Idempotent on `application_key`.

---

## 0.5 — `no_po_flag` usages

**Search:** case-insensitive grep for `no_po_flag`, `noPoFlag`,
`no-po-flag`, `NoPoFlag` across `*.ts`, `*.tsx`, `*.sql`, `*.json`,
`*.md`, excluding `node_modules`.

**Result: zero hits.** No definitions, migrations, reads, writes,
or UI references.

### Cross-reference with policy

Per AGENT_GUARDRAILS.md § 13:
> "the no-PO flag rule that previously appeared in the AGENTS.md
> invariant set has been removed at owner direction (2026-05-07).
> Invoices may exist without POs; the audit / flag pattern is no
> longer required."

### Recommendation

DROP QUIETLY. The flag is already gone from the codebase. The
deprecation is already documented in § 13. No follow-up code change
needed.

---

## 0.6 — Silent-allow audit gaps

**Method.** Grep for function definitions whose names contain
`advance|override|accept|reject|markComplete|setStage|transition`
across `server/routes/`, `server/services/`, `server/repositories/`,
`server/api/v2/`, `server/*-routes.ts`. For each candidate, verified
whether the function writes to the canonical audit tables
(`auditEvents`, `stageGateOverrides`, `mergeAuditLog`) or only to a
domain-specific history table.

### Functions that change project lifecycle stage / override gate / complete handover

| Function | File:Line | Domain audit | Canonical `auditEvents`? |
|---|---|---|---|
| `transitionStageStatus` | server/services/stage-lifecycle-service.ts:766 | `projectStageDecisions` (:814) + `stageGateEvidenceSnapshots` (:193) | **NO** |
| `advanceToStage` | server/services/stage-lifecycle-service.ts:1168 | `projectStageDecisions` (:1205, :1241) | **NO** |
| `markProjectDone` | server/services/stage-lifecycle-service.ts:1494 | `projectStageDecisions` (presumed; same module) | **NO** |
| `transitionProjectToConstruction` | server/api/v2/repositories/project-v2-repository.ts:43 | `projectPhaseHistory` (:52) | **NO** — imports `auditEvents` for read-only listing only (:376) |
| `markOmHandoverComplete` | server/services/om-handover-service.ts:126 | `omHandovers` (:106) | **NO** |
| `acceptProposal` (QB cascade) | server/services/quickbooks-cascade-proposals-service.ts:761 | `qbLinkProposedCascade` status update | **NO** |
| `rejectPending` | server/services/pending-approvals-service.ts:144 | `pendingApprovals` status update | **NO** |
| `acceptException` / `rejectException` | server/services/stage-exception-service.ts:30,98 | `projectStageExceptions` + `projectStageDecisions` (:77,:121) | **NO** |
| Gate override creation | server/lifecycle-routes.ts:1765 | `stageGateOverrides` (correct table; canonical for this surface) | n/a — this IS the canonical override surface |
| Eng-stage override flow | server/eng-stage-routes.ts:1254-1276 | `auditEvents` write at :1276 (`logAudit({ entityId: overrideStageInfo.projectId, ... })`) | **YES** |

### Functions that do write `auditEvents` (sanity check — not gaps)

`server/handover-routes.ts` writes audit on every state-changing
endpoint via `logAuditFromReq` (lines 245, 327, 674, 814, 824, 999,
1033, 1092, 1148, 1187, 1223, 1258, 1285, 1519). The legacy handover
flat file is the cleanest example in the codebase.

### Audit gap pattern

The pattern is consistent: services in `server/services/` write
domain-specific decision / history tables (`projectStageDecisions`,
`projectStageEvidence`, `projectPhaseHistory`, `omHandovers`,
`pendingApprovals`) but DO NOT emit a `auditEvents` row for the
broader cross-cutting audit feed described in § 4 ("Major state
transitions emit audit events").

The route files that wrap these services (e.g.
`server/stage-lifecycle-routes.ts`) sometimes call `logAuditFromReq`
at the route level — but not consistently.

### Recommended follow-up

Phase D — add a single helper that the service layer can call once
per major state transition and that writes both:

1. Domain table (`projectStageDecisions`, etc.) — already happening.
2. Canonical `auditEvents` row with `entityType`, `entityId`,
   `action`, `actorRole`, `changesJson`.

Highest-priority targets in order of blast radius:
- `transitionStageStatus` (every stage move)
- `advanceToStage` (skip-ahead)
- `markProjectDone` (terminal transition)
- `markOmHandoverComplete` (Six Rule #6)
- `transitionProjectToConstruction` (legacy v2 path; possibly
  decommission rather than fix)
- `acceptException` / `rejectException`
- `rejectPending` / `acceptPending`
- `acceptProposal` (QB cascade)

### Verdict 0.6

DEFECT — eight major state-change paths bypass the canonical
`auditEvents` feed. Domain-specific audit exists; cross-cutting
audit_events does not. § 4 invariant violated in spirit if not
literally.

---

## 0.7 — Smart Import planned/actual + comparison scope (§ 3.7, § 9.3)

**Files read:** `server/lib/import/baseline.ts`,
`server/lib/import/merge-engine.ts`,
`server/lib/import/conflict-engine.ts`,
`server/lib/import/row-matcher.ts`,
`server/imports/import-conflict-policy.ts`,
`server/lib/import/commit-executor.ts` (referenced by the brief
implicitly — required to verify the field-write rules),
`server/lib/import/normalizer.ts` (color extraction only),
`shared/excel-vs-app/contract.ts` (the canonical tracked-fields
list — required for (c)),
`shared/schema/finance.ts` (table columns).

### (a) Imports pull ACTUAL dates into actuals fields, no planned fallback

**Trace — work_items / PLAN section:**

`server/lib/import/commit-executor.ts:507-515` (and again at
:765-776, :826-833):

```ts
const actualStart = fileRow.actualStartDate;
const actualEnd   = fileRow.actualEndDate;
return {
  startDate:     toFieldValue(actualStart ?? planStart),  // display field
  endDate:       toFieldValue(actualEnd   ?? planEnd),    // display field
  baselineStart: toFieldValue(planStart),                 // planned
  baselineEnd:   toFieldValue(planEnd),                   // planned
  actualStart:   toFieldValue(actualStart),               // pure actual ← § 3.7
  actualEnd:     toFieldValue(actualEnd),                 // pure actual ← § 3.7
};
```

The pure-actual columns (`actualStart`, `actualEnd`) receive ONLY
the actual value. If the actual is blank in the workbook, the
actuals column stays blank. PASS.

The display fields (`startDate`, `endDate`) ARE populated with
`actual ?? planned` for ergonomic display in the project plan UI.
That is NOT the actuals field; it is a derived display column
co-located on the same row. § 3.7 forbids fallback into "the app's
actuals fields"; `actualStart` / `actualEnd` are those fields and
they hold actual-only.

**Caveat to flag:** the field name `startDate` / `endDate` is
ambiguous and reading code may incorrectly assume it is the actual.
Realisation calculations (§ 3.2 / § 3.3 / § 3.4) MUST read
`actualStart` / `actualEnd`, never `startDate` / `endDate`. Worth a
Wave-1 sweep of consumers to confirm none read the display field
for realisation.

**Trace — revenue lines (`normalized_revenue_lines`):**

commit-executor.ts:1327-1330, :1448-1453:

```ts
invoiceDate:        f.invoiceDate,                                        // direct, no fallback
invoiceDateFontColor: f.invoiceDateFontColor || null,
invoiceDateConfirmed: f.invoiceDateConfirmed || false,
expectedPaymentDate:  f.expectedPaymentDate,                              // direct
paidDate:             f.paidDate,                                         // direct (the receipt date)
inBankDate:           f.inBankDate,                                       // direct
```

No `?? planned` collapse anywhere. Actual date columns receive
actuals; planned (`expectedPaymentDate`) is its own column. PASS.

**Trace — cost lines (`normalized_cost_lines`):**

commit-executor.ts:1843-1849 — same pattern as revenue: actual
columns set directly from file row, no planned-fallback. PASS.

### (a) verdict — PASS with caveat noted on the `startDate` display field.

### (b) Excel replica preserves both planned and actual

PLAN section: `baselineStart`, `baselineEnd`, `baselineDuration`
columns hold planned values verbatim alongside `actualStart`,
`actualEnd`, `actualDuration`. commit-executor.ts:765-776 explicitly
states:

> "baselineStart/baselineEnd/baselineDuration so the Excel replica
> can mirror the workbook's planned + actual side-by-side layout"

Revenue / Cost: `expectedPaymentDate` / `forecastPaymentDate`
preserve the planned/forecast values; `paidDate` / `inBankDate`
hold the actuals. Both flow into the row.

### (b) verdict — PASS.

### (c) Conflict-detection compares only dates / amounts / row add-delete / colour

The canonical tracked-field allowlist lives in
`shared/excel-vs-app/contract.ts` with a 2026-05-07 narrowing
comment quoting the COO instruction verbatim:

> "On the Excel-vs-App comparison only things to compare are dates,
> amounts, deleted entries vs added entries, date colour (confirms
> payment or realisation)."

Lists (`shared/excel-vs-app/contract.ts:80-133`):

- `PLAN_TRACKED_FIELDS` — startDate, endDate, baselineStart,
  baselineEnd, actualStart, actualEnd. Dates only.
- `REVENUE_TRACKED_FIELDS` — amountExVat, vat, invoiceDate,
  expectedPaymentDate, paidDate, inBankDate, invoiceDateConfirmed,
  paidDateConfirmed. Amounts + dates + colour-confirmed flags.
- `EXPENDITURE_TRACKED_FIELDS` — amountExVat, budget*, actualQty/Rate,
  revenueRecognitionAmount, invoiceDate, approvedDate, paidDate,
  forecastPaymentDate, invoiceDateConfirmed, paidDateConfirmed,
  cosRealised, cashflowConfirmed. Same shape.

Dropped (per the comment): `status`, `owner`, `pctComplete`,
`description`, `milestone`, `outline`, `lead`, `resource*`,
`trackerComments`, `workDays`, `milestoneNotes`, `invoiceNumber`,
`poNumber`, `costCategory`, `counterpartyName`, `comments`,
`checkFlag`, `savingOverrun`, `usdExchangeRate`, `pricePerWatt`,
`noRevenueLinked`, `milestonePercent`. All free-text / identifier /
status / derived metadata — out of scope per § 9.3.

Comparison uses `PLAN_COMPARE_FIELDS` /
`REVENUE_COMPARE_FIELDS` / `EXPENDITURE_COMPARE_FIELDS` from
`server/lib/import/row-matcher.ts:297-325`, which mirror the
contract. `conflict-engine.ts:176-178` switches on section to pick
the right list. No route file branches the field set — the contract
is the single source of truth.

Row add / delete is handled separately by the row-matcher's S-rules
(`row-matcher.ts:567-569` and surrounding logic), not by the field
allowlist.

### (c) verdict — PASS. No defect-flag fields detected outside the locked four-class scope.

### (d) Date colour read at import + survives round-trip

**Read.** `server/lib/import/commit-executor.ts:1129-1136`:

```ts
const fc = getCellFontColor(ws, i, invoiceDateCol);
invoiceDateFontColor   = fc.color;
invoiceDateConfirmed   = fc.isBlack;
// ... and likewise for paidDateCol → paidDateFontColor / paidDateConfirmed
```

`classifyColorHex` at :553 maps hex → `{ color, isBlack }`. BLACK is
the realisation signal per § 3.7.

**Persist.** Both the raw font hex and the derived `*Confirmed`
boolean are stored on every revenue/cost row at the writer paths
(commit-executor.ts:1328-1333, :1448-1453, :1844-1849, :1989-1994).

**Round-trip.** `*Confirmed` flags are in
`REVENUE_TRACKED_FIELDS` / `EXPENDITURE_TRACKED_FIELDS` and in
`*_COMPARE_FIELDS`, so they participate in the 3-way merge. On
re-import with identical workbook colour, the merge classifies as
`no_change` for the flag and preserves the realised state. If colour
changes, it is flagged as a real diff (correctly). The `cosRealised`
+ `cashflowConfirmed` columns on cost lines extend the same
mechanism.

### (d) verdict — PASS.

### Summary 0.7 — overall PASS

| Sub-rule | Verdict |
|---|---|
| (a) Actual-only into actuals | PASS (caveat: `startDate` display field) |
| (b) Excel replica preserves both | PASS |
| (c) Comparison scope locked to four classes | PASS |
| (d) Date-colour realisation survives round-trip | PASS |

**Surprise:** the 2026-05-07 contract narrowing in
`shared/excel-vs-app/contract.ts` is well-documented and clearly
implements § 9.3. This is one of the cleanest invariant-enforcement
points in the codebase.

**Caveat for Wave-1:** sweep consumers of `startDate` / `endDate`
on `work_items` to ensure no realisation calculation reads the
display field instead of `actualStart` / `actualEnd`.

---

## Cross-cutting observations

- **Boundary between recording and refusing** (§ 0A) is still
  inconsistent. Handover routes are exemplary: every state change
  writes audit_events. Stage-lifecycle services do the opposite:
  they record domain decisions but skip the canonical audit feed.
- **Two sources of truth for the schema barrel** is a small foot-gun
  with a quick fix.
- **All Smart Import HARD invariants from § 3.7 / § 9 hold** in the
  named files. The only Smart Import follow-ups are non-import
  consumers (e.g. who reads `startDate` for what).
- **`phase_template` infrastructure exists but is empty.** The
  schema is ready; the seed isn't written. Phase D should close this
  with a single seeder.

*End of findings.*
