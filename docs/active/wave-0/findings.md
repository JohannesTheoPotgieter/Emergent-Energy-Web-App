# Wave 0 Audit — Findings

**Date:** 2026-05-07
**Scope:** Read-only audit. Reference files: `docs/AGENT_GUARDRAILS.md`,
`docs/operating-model/playbook-v2.0.md`.
**Author:** Claude Code (Opus 4.7).

---

## § 0.1 Workflow refusals classification

Aggregate counts across `server/routes/`, `server/*-routes.ts`,
`server/middleware/`:

- `throw new ApiError`: 4 hits (all in `server/routes/document-management.routes.ts`).
- `res.status(403)`: 37 hits (RBAC / role / forbidden + a few workflow gates).
- `res.status(400)`: 206 hits (mostly Zod-style validation; some workflow-state).
- Legacy `server/*-routes.ts` `throw / 403 / 400` total: ~542. Top files:
  `handover-routes.ts` (47), `smart-import-routes.ts` (33), `quality-routes.ts` (30),
  `eng-stage-routes.ts` (26), `ms-sync-routes.ts` (22).

Classification proceeded by message-keyword bucketing on the captured grep
list (see `/tmp/refusals_all.txt` ephemeral cache during audit). Spot-reads
done where the keyword bucket was ambiguous.

### HARD — keep (security / data corruption per § 5A)

These are the only refusal classes the app must block. All belong here.

- `server/middleware/csrf.ts:69` — CSRF token check.
  Rule: § 5A "Disabling Helmet or CSRF middleware" (HARD).
- `server/middleware/requireRole.ts:41` — `Insufficient role`.
  Rule: § 5 + § 5A authorization.
- `server/middleware/requireAdmin.ts` — admin gating; same rule.
- `server/middleware/production-safety.ts` — prod write protection
  (e.g. `imports-admin-extracted-routes.ts:788` "Blocked in production",
  `auth-routes.ts:234` same). Rule: § 5A.
- `server/middleware/project-scope-middleware.ts` — project access scope.
- All `error: "forbidden"` 403s in route handlers (HARD as RBAC
  enforcement). Examples:
  - `server/lifecycle-routes.ts:50,368,1749` — Executive role / COO,CEO,CCO.
  - `server/quality-routes.ts:72,100,106,928,1039` — role gates.
  - `server/portfolio-routes.ts:41,47` — Programme Manager / COO.
  - `server/sync-routes.ts:34,41` — COO access.
  - `server/engineering-intake-routes.ts:18` — COO.
  - `server/ee-info-routes.ts:50,1522` — COO / per-node edit.
  - `server/pm-on-the-go-routes.ts:50` — PM/admin.
  - `server/tr-register-routes.ts:25` — Manager.
  - `server/eng-stage-routes.ts:74` — generic role gate.
  - `server/routes/sseg-submissions.routes.ts:23` — `forbidden`.
  - `server/routes/planning-tasks-routes.ts:1319` — task create perm.
  - `server/routes/project-development-workspace-rollup.routes.ts:50`.
  - `server/routes/finance-legacy-extracted-routes.ts:604` — project access.
  - `server/routes/mytool-routes.ts:676,763,783,814,848,1196,1216` —
    "Insufficient permissions to perform data imports".
  - `server/pd-routes.ts:693,766` — record-owner authorisation.
- All `res.status(400)` "Invalid project ID" / "Invalid gate ID" /
  "Required" / "Title and description are required" / "must start with
  http://" — Zod-style input validation per § 5 (HARD).

### SOFT — refactor candidates per Phase D.6 (workflow rules with override path)

Per § 0A, soft rules surface the rule + override path; they don't block.
The following refusals encode workflow / sign-off / state-machine rules
that should follow the override pattern (audit + reason + authoriser
role) instead of a flat 400/403 with no override surface.

- `server/handover-routes.ts:306` — "Only admin/program manager can reopen
  gates". Rule: handover gate-reopen (Six Rule #6, override = COO).
  Note: handler already has `requirePermission("handover","override")`
  upstream — this 403 is the secondary in-handler role check; refactor
  candidate to `stage_gate_overrides` shape.
- `server/handover-routes.ts:703` — "Could not submit handover. Likely
  reason: no draft exists." Workflow state-machine.
- `server/handover-routes.ts:950, 966, 1068, 1142, 1215, 1250, 1493` —
  "Cannot accept handover", "mandatory sections incomplete", "Cannot
  reject handover", "Excel tracker link can only be updated after
  handover is accepted", "PD/PM sign-off requires ACCEPTED status",
  "Admin override only applies to completed handovers". All
  state-machine guards on the handover lifecycle. Rule per § 6
  (handovers are signed) — soft per § 0A; should expose override path
  not flat refusal.
- `server/handover-routes.ts:1210, 1245` — "PD sign-off requires Project
  Developer role" / "PM sign-off requires PM role". RBAC layer is HARD
  but the *segregation of duty* rule is soft.
- `server/eng-stage-routes.ts:979` — "You cannot approve your own stage
  gate". Segregation-of-duty rule. Soft (override = COO authorisation
  with reason).
- `server/lifecycle-routes.ts:1749` — "Your role is not authorized to
  submit stage gate overrides". RBAC HARD; the override surface itself
  is the override path (correct shape).
- `server/stage-lifecycle-routes.ts:213` — "Only admin roles can advance
  stages". Hardcoded role list `["COO_ADMIN","CEO_ADMIN"]` — see § 5
  hard refusal: "Hardcode role strings in route handlers". Refactor to
  `requireRole(...)` middleware reading `COMPANY_ROLES`.
- `server/stage-lifecycle-routes.ts:269` — "Only admin roles can place a
  project on hold". Same hardcoded role list.
- `server/stage-lifecycle-routes.ts:303` — "Only admin roles can resume
  a project". Same.
- `server/stage-lifecycle-routes.ts:339` — "Only admin roles can mark a
  project done". Same.
- `server/sync-routes.ts:622` — "CP already signed". Workflow refusal
  (cost proposal already signed). Soft per § 6.

> Top SOFT refactor cluster: handover state-machine in
> `server/handover-routes.ts` and the four hardcoded-role advance/hold/
> resume/done handlers in `server/stage-lifecycle-routes.ts:213/269/303/339`.

---

## § 0.2 Inflow / outflow / cashflow audit per § 3.4

### Files inspected

- `server/repositories/finance-temporal-repository.ts` (143 lines, full
  read)
- `server/repositories/finance-inflows-repository.ts` (lines 80–195
  inspected — canonical inflow path)
- `server/repositories/finance-analysis-repository.ts` (lines 416–425 —
  cashflow point series read)
- `server/repositories/finance-expense-engine-repository.ts` (lines
  100–280 — outflow path)
- `shared/schema/finance.ts` (lines 500–700 — revenue + cost line
  schemas)
- `server/lib/finance/cos-realisation.ts` (full inspection of canonical
  predicate)
- Routes: `finance-analysis.routes.ts`, `finance-trust-routes.ts`,
  `financials.routes.ts`, `routes/finance-legacy-extracted-routes.ts`,
  `financial-review-routes.ts`.

### Per-rule pass / fail

**(1) `isNull(effectiveTo)` snapshot guard on every read** —
**PASS.**
- `finance-temporal-repository.ts:26,30,57,61,88,92,119,123` — all
  guarded.
- `finance-inflows-repository.ts:106,135,181` — guarded.
- `finance-analysis-repository.ts:423` — guarded for cashflowPoints.
- `finance-legacy-extracted-routes.ts:247–248` — guarded for cost +
  revenue lines.
- `home-extracted-routes.ts:461,486,539,567` — guarded.
- `overview-extracted-routes.ts:40,41` — guarded.
- `lifecycle-routes.ts:579,583,598,608,1027,1046,1400,1415` — guarded.
- `deliverable-capture-routes.ts:67,79` — guarded.
- `invoice-pattern-routes.ts:59,528,673` — guarded; `:744` uses raw SQL
  with `effective_to IS NULL`.

**(2) Inflow reads use payment-receipt date, not invoice / contract**
— **PASS.**
- `finance-inflows-repository.ts:155–168` field map: `paymentReceivedDate
  → paidDate`. The inflow adapter (`adaptRevenueToInflow`) consumes
  `paidDate` + `paidDateConfirmed` as the realisation signal — the
  receipt-date rule per § 3.4. Invoice date is stored separately as
  `invoiceRaisedDate → invoiceDate` and is NOT the realisation signal
  for inflow.
- Snapshot reads in `finance-temporal-repository.ts` aggregate
  `cashflowPoints` rows that the import pipeline produced from
  receipt-dated revenue lines — see also `kpi-traceability-routes.ts:36`
  ("series_name LIKE '%revenue%'") which is the consumer side.

**(3) Outflow reads use captured supplier invoices + committed POs +
payroll-pattern projections** — **PARTIAL PASS.**
- Realised outflow signal: `finance-expense-engine-repository.ts:116–
  118, 269–271` maps `expensePaymentDate → paidDate` and the
  `paymentDateConfirmed`/`paymentDateFontColor` colour signal. ✓ This is
  the actual-payment-date per § 3.4.
- COS realisation predicate `isCanonicalCosRealised()`
  (`server/lib/finance/cos-realisation.ts:76–124`) correctly enforces
  invoice + black-font-or-confirmed (§ 3.2). ✓
- **Soft deviation 1 (§ 3.2 backward-compat fallback):**
  `cos-realisation.ts:107–115` falls back to "invoice alone = realised"
  when neither `invoiceDateFontColor` nor `invoiceDateConfirmed` is
  supplied. Comment acknowledges the legacy path. Per § 3.2 the rule is
  invoice + BLACK; this fallback is technically a partial deviation but
  is gated to legacy callers and intended to be retired. Worth flagging
  to the owner.
- **Soft deviation 2 (§ 3.2 QB-evidence path):**
  `cos-realisation.ts:82–89` realises COS when `lineAssignedQbExVat > 0`
  regardless of font-colour. § 3.2 says the rule is invoice + BLACK with
  no other override path. QB capture is functionally equivalent to a
  confirmed invoice but is not literally what § 3.2 specifies.
- **Gap (§ 3.4 forecast outflow sources):** I could not locate the
  "committed POs without an invoice yet" forecast path or the
  "payroll-pattern projections" path. Searching
  `finance-expense-engine-repository.ts` for `committedPO`,
  `payrollPattern`, `forecast.*outflow` returned nothing. The
  `forecastPaymentDate` column on `normalizedCostLines` exists but I did
  not trace a forecast-outflow read that aggregates over committed POs +
  payroll. Either the forecast outflow series is not implemented, or it
  lives elsewhere (Excel-side). **Action:** confirm with owner whether
  forecast outflow per § 3.4 is implemented; if so, point me at the
  path.

### ee-snapshot-auditor sub-agent — appendix

Sub-agent verdict on the same file list: **0 missing
`isNull(effectiveTo)` guards.** ~52 snapshot-table read queries
reviewed. (Auditor cross-reference of some line numbers between
home-extracted-routes / overview-extracted-routes / lifecycle-routes
was inverted in its summary, but the substantive verdict — zero misses
— is correct against my own grep.)

> Note on by-id PK reads: `excel-vs-app.routes.ts:557,559,581,583,603,
> 605,630,632` and `finance-legacy-extracted-routes.ts:1227,1281` do
> `where(eq(table.id, rowId))` without an `effectiveTo` guard. These
> are id-pinned write/read paths inside a tx; under the soft-close
> pattern (an id-row gets `effectiveTo` set in place; new versions
> insert with new ids — see `softCloseByProjectName`), an id lookup
> can return a soft-closed row. Defensible for "fetch this specific
> record to operate on it" but worth tightening to add the guard.

---

## § 0.3 Schema barrel resolution

### tsconfig facts

- `tsconfig.json:38` — `"@shared/*": ["./shared/*"]`,
  `"moduleResolution": "bundler"` (`tsconfig.json:34`).
- `tsconfig.check.json` extends base; includes `shared/**/*.ts` for
  server-side check.
- `tsconfig.client-check.json` extends base; includes `shared/**/*.ts`.
- No `tsconfig.client.json` / `tsconfig.server.json`; the project uses
  `tsconfig.check.json` + `tsconfig.client-check.json`.

### Resolution

Under `moduleResolution: "bundler"`, given the import specifier
`@shared/schema`, the resolver tries (in order): `shared/schema.ts`,
`shared/schema.tsx`, then `shared/schema/index.ts`. The first match
wins.

- **`shared/schema.ts`** exists (37 lines, 25 re-exports). Resolution
  stops here.
- **`shared/schema/index.ts`** (31 lines, 28 re-exports) is shadowed —
  **dead code**.

### Drift between the two barrels

Domains in `shared/schema/index.ts` BUT NOT in the live
`shared/schema.ts`:

- `template-overrides`
- `role-based-upgrade`
- `commissioning-source`
- `home`

Domain in `shared/schema.ts` BUT NOT in `shared/schema/index.ts`:

- `app-settings`

Real-world impact: code that imports table symbols from
`@shared/schema` for the four `index.ts`-only domains would fail to
resolve. In practice, callers reach those domains via deep imports
(`@shared/schema/role-based-upgrade`, etc.) — confirmed in
`client/src/components/layout/LensSwitcher.tsx:10`,
`client/src/config/module-registry.ts:9–10`,
`client/src/components/dashboard/LifecycleGatesChecklist.tsx:17`,
`client/src/config/role-aware-ux.ts:2`,
`client/src/config/role-dashboard-config.ts:271`, etc. So nothing is
broken, but the live barrel is incomplete vs the directory.

### Recommendation

1. **Delete `shared/schema/index.ts`** — unreachable dead code. Per
   CLAUDE.md, `shared/schema.ts` is the canonical barrel.
2. **Add the missing exports to `shared/schema.ts`**:
   `template-overrides`, `role-based-upgrade`, `commissioning-source`,
   `home`. So `@shared/schema` is a complete barrel and the deep-
   import pattern becomes optional, not required.

---

## § 0.4 Playbook templates seeded?

### 13 playbook companion templates (from
`docs/operating-model/playbook-v2.0.md` § "Companion Templates")

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

### Schema target

`phase_template` table — `shared/schema/projects.ts:860` plus child
`phase_template_item` (`:875`), `phase_template_item_history` (`:903`),
`phase_template_application`. CRUD lives in `server/template-routes.ts`
(create/update/clone/version endpoints).

### Search results

- `migrations/*.sql` — **no `INSERT INTO phase_template`** found. Grep
  `INSERT INTO.*phase_template` across `migrations/` returns 0 matches.
  (The hits in `migrations/archive/20260317_multischema_domain_rollout
  .sql` are for `engineering.eng_stage_templates`, a different table.)
- `server/bootstrap/run-startup-seeds.ts` — invokes 9 named seeders:
  `seedFolderTaxonomy`, `seedQualityTemplate`, `seedEngStageTemplates`,
  `seedRoleCredentials`, `seedTrRegisterData`, `seedIntakeTaskTemplates`,
  `seedMockIntakeData`, `seedRolePermissions`, `seedRoleTemplates`,
  `seedLessonsLearnt`. **None target `phase_template`.**
- `server/seed-eng-templates.ts:22` seeds `eng_stage_templates` (a
  separate engineering-specific surface) with row name `"First
  Assessment"`. This is NOT the playbook companion template.
- No `server/migrations/*.ts` (TS maintenance) inserts into
  `phase_template`.

### Match list

**0 of 13 seeded.**

### Gap list

**All 13.** None of the playbook companion templates are present in the
DB out-of-the-box. Templates exist only after a user creates them via
the admin API (`POST /api/templates`).

### Recommendation

Add a `seedPhaseTemplates` step (idempotent — keyed on `(phase, name)`)
in `server/bootstrap/run-startup-seeds.ts` that inserts the 13
companion templates with the playbook canonical phase mapping. Phase D
candidate.

---

## § 0.5 `no_po_flag` usages

### Direct grep

```
grep -rIn "no_po_flag\|noPoFlag" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build .
```

**0 hits.** The flag is not present anywhere — no schema column, no
migration, no read, no write, no UI reference.

### Related artefact

`server/lib/finance/cos-realisation.ts:155` produces a `"INVOICE_WITHOUT
_PO"` diagnostic warning string (read-side, computed from
`expenseInvoiceNumber` + `poNumber`). This is a derived warning, not
a stored flag. Tests at `qa/tests/unit/cos-realisation-consistency
.test.ts:296,332` cover it.

### Recommendation

**Drop quietly.** The flag is already gone from the codebase. § 13 of
the guardrails records the owner-directed removal on 2026-05-07.
Nothing to deprecate. The `INVOICE_WITHOUT_PO` diagnostic is
defensible read-side risk surfacing — leave as-is.

---

## § 0.6 Silent-allow audit gaps

### Method

Grepped routes + repos for handlers with names matching
`advance|override|accept|reject|complete|transition|stage|hold` and
read the surrounding code looking for writes to `audit_events` (via
`logAuditFromReq`), `stage_gate_overrides`, `merge_audit_log`, or the
domain-specific audit tables.

### Handlers with audit writes — OK

- `server/handover-routes.ts:193` POST `…/handover-gates/:gateId/complete`
  → `logAuditFromReq` ✓
- `server/handover-routes.ts:297` POST `…/handover-gates/:gateId/reopen`
  → `logAuditFromReq` ✓
- `server/handover-routes.ts:939` POST `/api/pd-pm-handover/:projectId/
  accept` → `logAuditFromReq` ✓
- `server/handover-routes.ts:1056` POST `…/reject` → `logAuditFromReq` ✓
- `server/handover-routes.ts:1486` PUT `…/admin-override` →
  `logAuditFromReq` ✓
- `server/eng-stage-routes.ts:1019` POST `…/stages/:stageId/complete` →
  `logAuditFromReq` ✓
- `server/eng-stage-routes.ts:1236` POST `…/stages/:stageId/override-
  complete` → `logAuditFromReq` ✓
- `server/eng-stage-routes.ts:1290` PATCH `…/stages/:stageId/status` →
  `logAuditFromReq` ✓
- `server/eng-stage-routes.ts:702` PATCH `…/deliverables/:id/approve`,
  `:771` POST `…/issue-for-construction`, `:838` POST `…/mark-as-built`
  — all have `logAuditFromReq` ✓
- `server/lifecycle-routes.ts:1741` POST `…/stage-gates/override` →
  `logAuditFromReq` ✓
- `server/lifecycle-routes.ts:2006` PATCH `…/execution-gate` → writes
  `executionGateLog` AND `logAuditFromReq` ✓
- `server/routes/lifecycle-approvals-routes.ts:117` PATCH `/api/
  approvals/:type/:id/action` → `logAuditFromReq` ✓
- `server/routes/gates-routes.ts:342` PATCH `…/gates/exceptions/:id/
  action` → `logAuditFromReq` ✓
- `server/change-control-routes.ts:115,172,283` create / patch / delete
  CR — all `logAuditFromReq` ✓

### Handlers with audit GAPS — Phase D fix list

The four stage-lifecycle handlers go through
`server/services/stage-lifecycle-service.ts` which writes domain audit
(`projectStageDecisions`, `stageGateEvidenceSnapshots`) but NOT the
canonical `audit_events`. Per § 4 architectural invariants, "major
state transitions emit audit events" — these qualify.

| Route handler | Service function | Domain audit | `audit_events`? |
|---|---|---|---|
| `server/stage-lifecycle-routes.ts:202` POST `/api/projects/:projectId/stages/advance-to/:targetStageCode` | `advanceToStage()` (`server/services/stage-lifecycle-service.ts:1168`) | `projectStageDecisions:1205,1241` + `captureStageGateSnapshot` | **MISSING** |
| `server/stage-lifecycle-routes.ts:258` POST `…/stages/hold` | `placeProjectOnHold()` (`server/services/stage-lifecycle-service.ts:1338`) | (uses snapshot helpers) | **MISSING** |
| `server/stage-lifecycle-routes.ts:295` POST `…/stages/resume` | `resumeProjectFromHold()` (`server/services/stage-lifecycle-service.ts:1406`) | (uses snapshot helpers) | **MISSING** |
| `server/stage-lifecycle-routes.ts:321` POST `…/stages/done` | `markProjectDone()` (`server/services/stage-lifecycle-service.ts:1494`) | (uses snapshot helpers) | **MISSING** |

Verified by `grep -n "logAudit\|audit_event\|auditEvents" server/
services/stage-lifecycle-service.ts` returning 0 matches and the route
handler bodies (lines 201–340) not calling `logAuditFromReq` either.

### Recommendation

Wrap each route handler (or, cleaner, the service function) with a
`logAuditFromReq` call emitting `entityType: "project_stage"`,
`entityId: String(projectId)`, `action:
"advance"|"hold"|"resume"|"done"`. Phase D.6 work item. The domain
audit row is preserved; this just adds the canonical platform audit
row required by § 4.

> Stage-lifecycle hardcoded role lists at `:213,269,303,339` are also
> a § 5 violation ("Hardcode role strings in route handlers") —
> tracked in § 0.1 SOFT bucket.

---

## § 0.7 Smart Import — planned vs actual + comparison scope (§ 3.7, § 9.3)

### Files inspected

- `server/lib/import/baseline.ts`
- `server/lib/import/merge-engine.ts`
- `server/lib/import/conflict-engine.ts`
- `server/lib/import/row-matcher.ts` (skim — id-first lookup confirmed)
- `server/lib/import/normalizer.ts` (lines 1000–1190 revenue, 1480–
  1670 cost)
- `server/lib/import/commit-executor.ts:48–148` (TRACKED_FIELDS imports)
- `server/imports/import-conflict-policy.ts`
- `shared/excel-vs-app/contract.ts:1–139` (canonical tracked-field
  contract)
- `shared/schema/finance.ts:500–700` (revenue + cost line columns)

### (a) Imports pull ACTUAL dates into actuals; no fallback to planned
— **PASS (with one note).**

Trace: revenue line.

- `normalizer.ts:1056–1062` reads from the workbook:
  - `invoiceDate ← parseDate(row[invoiceDateCol])` (col mapped from
    `invoice_date`)
  - `expectedPaymentDate ← parseDate(row[plannedDateCol])` (col mapped
    from `planned_payment_date`) — kept as PLANNED in its own field.
  - `paidDate ← parseDate(row[paidDateCol])` (col mapped from
    `payment_received_date`) — actual receipt.
  - `inBankDate ← parseDate(row[inBankDateCol])` — actual.
- `normalizer.ts:1165–1188` writes the line with each date in its
  proper slot; no fallback from `expectedPaymentDate` to `paidDate`.

Trace: cost line.

- `normalizer.ts:1506–1509` reads:
  - `rawInvoiceDate ← parseDate(row[invoiceDateCol])`
  - `approvedDate ← parseDate(row[approvedDateCol])`
  - `paidDate ← parseDate(row[paidDateCol])`
- `normalizer.ts:1517` — `const invoiceDate = rawInvoiceDate ??
  lastDayOfMonthFromDate(paidDate);` **NOTE:** when the workbook does
  not cache the formula result for `invoice_date`, the importer fills
  it with `EOMONTH(paidDate)`. The comment justifies this as
  replicating the workbook's own formula `IF(FINANCE_PAYMENT_DATE > 1,
  EOMONTH(FINANCE_PAYMENT_DATE, 0), "")`. This is NOT a planned-to-
  actual fallback (the substitute is derived from another actual,
  `paidDate`). Defensible but worth confirming with the owner.

Schema-level confirmation: `normalizedRevenueLines.expectedPaymentDate`
(`shared/schema/finance.ts:530`), `paidDate` (`:531`), `inBankDate`
(`:534`) — three distinct columns. `normalizedCostLines
.forecastPaymentDate` (`:663`) is its own forecast column. Planned and
actual stay separated at the schema level.

### (b) Excel replica view preserves planned + actual side-by-side
— **PASS.**

The replica surface is the trio of pages
`client/src/pages/program-plan.tsx`,
`client/src/pages/revenue-tracking.tsx`,
`client/src/pages/expenditure-breakdown.tsx`, backed by
`server/repositories/tracker-replica-repository.ts`.

Plan-section tracked fields contract
(`shared/excel-vs-app/contract.ts:80–92`) explicitly preserves both
sides:

```
PLAN_TRACKED_FIELDS = [
  "startDate", "endDate",            // primary (actual ?? planned)
  "baselineStart", "baselineEnd",    // PLANNED, preserved
  "actualStart", "actualEnd",        // pure ACTUAL
]
```

For revenue lines, `expectedPaymentDate` (planned) sits alongside
`paidDate` (actual) on every row. For cost lines,
`forecastPaymentDate` (forecast) sits alongside `paidDate` (actual).
The `cellFormat` JSON column (`finance.ts:551`) stores per-cell font
+ fill colours captured at import time, preserving the visual
fidelity the COO wants.

### (c) Conflict-detection scope locked to dates / amounts / row add-
delete / date-colour — **PASS.**

`shared/excel-vs-app/contract.ts:1–139` is the single source of truth
and was tightened on 2026-05-07 ("On the Excel-vs-App comparison only
things to compare are dates, amounts, deleted entries vs added
entries, date colour"). The three tracked-field lists:

- `PLAN_TRACKED_FIELDS` (`:80–92`) — dates only (planned + actual +
  derived primary).
- `REVENUE_TRACKED_FIELDS` (`:96–108`) — amounts (`amountExVat`, `vat`)
  + dates (`invoiceDate`, `expectedPaymentDate`, `paidDate`,
  `inBankDate`) + date-colour (`invoiceDateConfirmed`,
  `paidDateConfirmed`).
- `EXPENDITURE_TRACKED_FIELDS` (`:112–133`) — amounts (incl. budget +
  qty/rate components) + dates (`invoiceDate`, `approvedDate`,
  `paidDate`, `forecastPaymentDate`) + date-colour
  (`invoiceDateConfirmed`, `paidDateConfirmed`, `cosRealised`,
  `cashflowConfirmed`).

The contract comment explicitly enumerates what was DROPPED (status,
owner, %complete, description, milestone, outline, lead, resource*,
trackerComments, workDays, milestoneNotes, invoiceNumber, poNumber,
costCategory, counterpartyName, comments, checkFlag, savingOverrun,
usdExchangeRate, pricePerWatt, noRevenueLinked, milestonePercent) —
matches § 9.3 exactly. Row add / delete is handled outside the per-
field merge by the planner (per the in-file note `:73–77`).

`server/lib/import/commit-executor.ts:146–148` aliases the merge-field
lists to the contract lists (`PLAN_MERGE_FIELDS = PLAN_TRACKED_FIELDS`
etc.) so engines and diff page cannot drift.

### (d) Date colour read at import → realisation flag survives round-
trip — **PASS.**

- Colour extraction: `normalizer.ts:553` `classifyColorHex()` returns
  `{ color, isBlack }`.
- Import-time write of the realised flag:
  - Revenue: `normalizer.ts:1131` `invoiceDateConfirmed = fc.isBlack`,
    `:1136` `paidDateConfirmed = fc.isBlack`.
  - Cost: `normalizer.ts:1583` and `:1588` mirror the same pattern.
- The full `cell_format` JSON is captured (`normalizer.ts:1151–1163`
  for revenue, similar for cost) preserving the original ARGB on every
  tracked column.
- Round-trip preservation via the merge engine: the `*Confirmed` flags
  are members of `REVENUE_TRACKED_FIELDS` (`:106,107`) and
  `EXPENDITURE_TRACKED_FIELDS` (`:129,130`), so the 3-way merge
  compares the snapshot's colour-flag value to the file's. A re-import
  of the same workbook (no actual changes) finds `fileVal == snapVal`
  for the confirmed flags → outcome `no_change` (`merge-engine.ts
  :168–171`). Realised state preserved across round-trip.

### Summary table

| Sub-rule | Verdict |
|---|---|
| (a) actual-only mapping, no planned fallback | **PASS** (one note: `normalizer.ts:1517` EOM-derivation when invoice_date cell is uncached — actual-derived, not planned-derived; confirm with owner) |
| (b) Excel replica preserves planned + actual side-by-side | **PASS** |
| (c) conflict scope locked to dates / amounts / row add-delete / colour | **PASS** |
| (d) date colour read at import; survives round-trip | **PASS** |

§ 0.7 overall: **PASS** with one low-risk note. No Phase D blocker
under this section.

---

*End of findings.*
