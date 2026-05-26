# Finance Module — Deep Audit V3

**Date:** 2026-05-26
**Builds on:** V1 (`audit/FINANCE_AUDIT_2026-05-26.md`, PR #943 / #945 merged), V2 (`audit/FINANCE_AUDIT_V2_2026-05-26.md`, PR #948 merged)
**Owner:** Johannes Theo Potgieter (COO)
**Auditor:** Claude (Opus 4.7) via Claude Code on the web

> **Scope of V3 (areas V1 and V2 did not deeply cover):** performance / scalability, deep security beyond V1's RBAC and Zod, cross-domain interactions, frontend reliability under load, verification of V2's "deferred — cannot verify" items, schema archaeology, and **end-to-end business workflows** (month-end close, QB recon, FY rollover, refunds, disputes, write-offs, audit prep, board pack, handover).
>
> Findings use the `TF-` prefix (Third Finding). They continue conceptually from V1's `F-` / `U-` and V2's `DF-` / `DU-` series. Verifications I could spot-check directly are marked **verified**; agent claims I could not personally re-check are marked **(per agent)**.

---

## 1. Executive summary

V1 proved the formulas. V2 hardened the second-order invariants (timezone, lifecycle, transactions, tests). **V3 went looking for what V1 and V2 didn't touch — and found the operational and governance layers are thin.**

The headline pattern is that **the math and the routes are sound, but the workflows and the cache layer are not**:

1. **Three core business workflows are missing entirely** — no "Disputed invoice" status, no "Bad debt / write-off" path, no "Handover finance close-out" gate. Operators today use negative-amount workarounds and external spreadsheets.
2. **One critical security finding** — the QB invoice-match approve endpoint resolves `projectId` from the suggestion but never re-checks that the user can edit *that* project. A user with global `financials:edit` can approve QB links on projects they shouldn't touch.
3. **A second security finding** — `applyMutation` inside QB cascade acceptance writes to `paid_date`, `invoice_number`, `amount_ex_vat` and counterparty mappings without per-field audit events. The audit log captures "proposal accepted" but not "field X went from A to B".
4. **DF-2 from V2 is now verified absent and elevated to CRITICAL.** Exhaustive grep across `server/`, `scripts/`, `migrations/`, `.replit`, `replit.nix`, bootstrap, and bridge code found **zero writers** to `derived_project_kpis`. Three production code paths read from it (priority detail, project header, strategic chain) and get stale-or-zero data forever.
5. **DF-4 from V2 leans Case B (USD conversion missing).** The exchange rate is captured, persisted, and surfaced in the tracker replica view, but never multiplied into `amount_ex_vat`. If the Excel convention is raw USD (highly likely given that capturing the rate as metadata would otherwise be pointless), every USD cost line is undercounted by ~18×.
6. **Two missing composite indexes** on `normalized_cost_lines` and `normalized_revenue_lines` — `(project_id, effective_to)`. Every finance aggregate filters on both columns; the existing indexes don't cover them together. 50–100ms penalty per portfolio query.
7. **Accessibility gap** — large money values like `R 1 234 567` render as plain text. Screen readers read "R one two three four five six seven", not "R one million two hundred thirty-four thousand five hundred sixty-seven". WCAG 2.1 AAA violation.
8. **9 finance pages still use non-canonical money formatters** despite PR #945. PR #945 only migrated the two highest-traffic pages.

**Severity counts (V3 new findings):** 11 HIGH · 14 MEDIUM · 6 LOW.

What's in this PR: the audit doc and the safe fixes that don't need owner sign-off. § 12 lists what's deferred and why.

---

## 2. TF-1 (HIGH — security) — QB approve flow does not re-check project scope

**Where:** `server/routes/quickbooks-invoice-matches.routes.ts:941–1085`.

**Verified:** read the route directly. The handler:
1. `requirePermission("financials", "edit")` — global gate, not project-scoped
2. `getSuggestionById(suggestionId)` — pulls the suggestion
3. `getCostLineProjectId(appEntityId)` — resolves projectId from the cost-line id stored on the suggestion
4. Calls `confirmCostLineLink({ projectId, ... })` — accepts whatever projectId the suggestion resolved to

Nothing in the chain calls `resolveProjectScope` / `isProjectAccessibleByName`. A user with `financials:edit` can approve any suggestion ID they can guess or browse, regardless of which project the underlying cost line belongs to.

**Why it matters:** the QB cascade then mutates `paid_date`, `invoice_number`, `amount_ex_vat`, and counterparty mappings on the linked cost / revenue line. So the user can not only "approve a match they shouldn't see" but trigger downstream finance state changes on the foreign project's books.

**Severity:** HIGH. Cross-project finance write under a permission that's supposed to be a generic finance-edit gate.

**Fix shape:** add a project-scope check inside the route, after resolving `projectId`:
```ts
const scope = await resolveProjectScope(userId, role, name);
const projectName = await loadProjectNameForId(projectId);
if (!isProjectAccessibleByName(scope, projectName)) {
  return sendError(res, forbidden("Project not in user scope"));
}
```

**Status:** **Not fixed in this PR.** Needs the same treatment for the `/approve-multi`, `/manual-link`, and `/reject` siblings — every endpoint that takes a suggestion or link id and acts on the underlying app row. Owner should confirm whether `financials:edit` is intended to be project-bounded or global.

---

## 3. TF-2 (HIGH — security / compliance) — QB cascade `applyMutation` doesn't audit per-field changes

**Where:** `server/services/quickbooks-cascade-proposals-service.ts:949–1091` (`applyMutation`) and `:862–905` (`acceptProposal`).

**Verified by agent; behaviour pattern matches the file structure.** `applyMutation` writes the underlying field change (paid_date overwrite, invoice_number overwrite, vendor/customer mapping insert, etc.). `acceptProposal` logs the proposal acceptance via `logAuditFromReq`. But the individual field mutations land in `normalized_cost_lines` / `normalized_revenue_lines` / `qb_vendor_mappings` etc. without a corresponding `audit_events` row.

**Effect:** an auditor looking at `audit_events` for cost-line ID 12345 sees nothing about why `paid_date` flipped from `null` to `2026-05-15`. The trail is in `qb_link_proposed_cascades.status = 'accepted'`, but that's an integration-domain table the finance auditor doesn't think to query.

**Severity:** HIGH for compliance. The mutation is correct; the audit trail is fragmented.

**Fix shape:** inside `applyMutation`, after the underlying write, append an `audit_events` row with:
- entityType: `cost_line` / `revenue_line` / `vendor_mapping`
- action: `field_override_${proposal.proposalType}`
- changesJson: `{ field, oldValue, newValue, cascadeProposalId: proposal.id }`

**Status:** **Not fixed in this PR.** Needs a careful look at the existing diff-engine pattern (`server/lib/audit/diff-engine.ts`) to reuse rather than duplicate.

---

## 4. TF-3 (HIGH — performance) — Missing composite indexes on `(project_id, effective_to)`

**Where:** `shared/schema/finance.ts`.

**Verified by grep.** Existing indexes on `normalized_cost_lines` and `normalized_revenue_lines`:
- `normalized_revenue_lines_row_hash_active_idx` — partial on `(projectId, rowHash)` WHERE `effectiveTo IS NULL`
- `normalized_cost_lines_row_hash_active_idx` — same shape

The hot query pattern across every finance aggregate is `WHERE projectId = ANY(...) AND effectiveTo IS NULL AND deletedAt IS NULL`. The partial index helps the row-hash dedup path, but the `(project_id, effective_to)` predicate falls back to a sequential filter once the planner has matched the partial.

**Estimated impact (per the performance agent):** 50–100ms per project on a portfolio aggregate at 25,000-row scale. PM dashboard issuing the canonical query for a 20-project portfolio takes 50–80ms today; the missing composite would cut that to <30ms on a warm cache and ~80–120ms cold.

**Severity:** HIGH for scalability. The current behaviour works because EE's row counts are modest; the cost compounds as projects accumulate.

**Fix shape:** add via additive migration:
```sql
CREATE INDEX IF NOT EXISTS idx_normalized_cost_lines_project_effective
  ON normalized_cost_lines (project_id, effective_to);
CREATE INDEX IF NOT EXISTS idx_normalized_revenue_lines_project_effective
  ON normalized_revenue_lines (project_id, effective_to);
```
Plus a `(paid_date, effective_to)` on `normalized_revenue_lines` for AR-aging hot path.

**Status:** **Migration authored in this PR** (`migrations/0075_finance_audit_v3_indexes.sql`); NOT applied — needs `db:migrate` approval.

---

## 5. TF-4 (CRITICAL — escalated from V2 DF-2) — `derived_project_kpis` has no writer anywhere in the repo

**Where:** the table is read by:
- `server/services/project-platform-summary-service.ts:569–586`
- `server/services/project-header-kpi-service.ts:240`
- `server/lib/priorities/progress-source.ts:86`
- `migrations/0003_priority_derived_metrics_view.sql:34–37` (the PG view that powers the priority KPI surface)

**Verified by exhaustive grep:** zero `INSERT INTO derived_project_kpis`, zero `.insert(derivedProjectKpis`, zero `UPDATE derived_project_kpis`, zero `.update(derivedProjectKpis`, zero `REFRESH MATERIALIZED VIEW`, zero `CREATE TRIGGER` referencing it, zero `materializeDerived*`, zero `refreshDerived*`. The only mutation is one `DELETE` in `lifecycle-routes.ts:3493` (cleanup on project archival). The only INSERT is in a test fixture (`qa/tests/api/project-list-summary-service.test.ts:54`).

Searched: `server/`, `scripts/`, `migrations/`, `server/bootstrap/`, `server/bridge/`, `.replit`, `replit.nix`, `seed/`, `qa/`.

**V2 deferred this as "may be populated by an external pipeline".** V3 confirms no in-repo writer exists. Either:
- An external pipeline (Replit cron / Lambda / something not in this repo) populates the table — owner needs to confirm and document, OR
- The table has been silently empty / stale forever, and the priority KPI surface has been reading null/zero for the entire history of the system.

**Severity:** CRITICAL. The "priority dashboard headline" is what executives look at. If it's been wrong without anyone noticing, that itself is the highest-severity finding.

**Fix shape:** owner must confirm the writer. If none exists in production, build an in-app materializer at `server/bootstrap/derived-project-kpis-scheduler.ts` that runs every N minutes (or on finance-write events) and rebuilds the cache from the canonical sources (`finance-line-level-repository` + `work_items` + `audit_events`).

**Status:** **Not fixed in this PR.** Blocks F-1 Phase 2 (priority surface POC migration). Owner decision required.

---

## 6. TF-5 (HIGH-conditional — escalated from V2 DF-4) — USD exchange rate not applied; Case B looks likely

**Where:** `shared/schema/finance.ts:704` defines `usdExchangeRate: decimal(10, 4)` on `normalized_cost_lines`. `server/lib/import/normalizer.ts:1641, 1706` read it from the workbook and persist it. `server/routes/tracker-replica.routes.ts:114–130` surfaces it as project header metadata alongside `pricePerWatt`.

**Verified by exhaustive grep:** no path in `server/` or `client/` multiplies `actualTotal × usdExchangeRate`. The rate is captured, persisted, and rendered to the UI, but never used as a conversion factor.

**Why Case B (raw USD) is the likely convention:**
1. Capturing and persisting the rate is pointless if `amount_ex_vat` already holds ZAR. If Case A held, the field would be dead metadata — why bother writing it?
2. The tracker-replica route surfaces it on the project HEADER (alongside per-Wp pricing), which is the natural place for a project-level conversion factor.
3. Per § 3 of the audit guardrails, foreign-supplier costs (panels, inverters from CN/EU/US) are common in EE's projects — the rate would only be needed if those amounts are stored raw.

**Effect if Case B holds:** every USD cost line is summed at face value as if it were ZAR. A R10M project with $50K USD components (typical for solar inverters at 18.5× rate = R925K equivalent) would show as R10.05M instead of R10.925M. Cost is undercounted, GP is overstated.

**Severity:** HIGH if Case B is correct. Trivial if Case A is correct (the field is just metadata).

**Status:** **Not fixed in this PR.** Owner one-line answer needed: "is `amount_ex_vat` already ZAR-equivalent or raw USD?"

---

## 7. TF-6 (HIGH — accessibility / WCAG AAA) — Money values lack aria-labels

**Where:** every finance page rendering money via `formatZar(value)`. Verified in `cashflow.tsx`, `cos.tsx`, `revenue-tracking.tsx`, `priority-detail.tsx`, etc.

**Effect:** a screen reader reads `R 1 234 567` as "R one two three four five six seven" — character-by-character. Not "R one million two hundred thirty-four thousand five hundred sixty-seven". A blind user cannot reliably consume finance dashboards.

**Severity:** HIGH for WCAG 2.1 Level AAA compliance. The numbers are visually correct but functionally inaccessible.

**Fix shape:** add a `formatZarAccessible(value)` companion that returns `{ visual, ariaLabel }`. Wire it into a small `<MoneyValue>` component that all finance tiles can use. The visual string stays as-is; the aria-label gets a spoken form.

**Status:** **Not fixed in this PR.** Touches every finance tile; bundled as a follow-up dedicated to accessibility.

---

## 8. TF-7 (HIGH — workflow) — Disputed-invoice workflow does not exist

**Where:** `shared/schema/finance.ts` — `revenueLineStatusEnum = ['planned', 'invoiced', 'paid', 'in_bank', 'realised']`. No `disputed` status. Same for `costLineStatusEnum`. No "hold from cashflow" mechanism.

**Effect:** when a customer disputes an invoice (wrong amount, wrong scope, wrong service), there's no app surface to capture that. The invoice stays "invoiced" → "outstanding" in cashflow forever, distorts AR aging, and lands in overdue lists with no flag explaining why. The PM / Finance Manager has to track disputes externally (email, spreadsheet, head).

**Severity:** HIGH. Disputed invoices distort active receivables tracking and management can't see the queue.

**Fix shape:** add `disputed` to both status enums; add a `dispute_opened_at` / `dispute_resolved_at` / `dispute_reason` triplet; add a "Disputed AR" section to Cashflow Analysis. Disputed lines should be excluded from the active overdue list.

**Status:** **Not fixed in this PR.** Schema + UI work; needs owner sign-off on the workflow shape.

---

## 9. TF-8 (HIGH — workflow / governance) — Bad-debt / write-off path does not exist

**Where:** same schema location. No `write_off` status. No allowance for doubtful debts. No CFO gate on write-offs.

**Effect:** an uncollectible invoice stays as "outstanding" indefinitely. The aging report flags it (e.g. "365+ days overdue") but there's no domain workflow to write it off. Finance creates a manual negative-amount revenue line as a workaround, with no audit trail tying the write-off to a CFO authorisation or a reason.

**Severity:** HIGH for governance. No control prevents an editor from silently writing off a debt; no record of who authorised what.

**Fix shape:** add `write_off` revenue-line status + `write_off_authorised_by` / `write_off_reason` / `write_off_authorised_at` columns. Require `requirePermission("financials", "approve")` to transition into it.

**Status:** **Not fixed in this PR.** Needs owner sign-off on threshold + authorising role.

---

## 10. TF-9 (HIGH — workflow / compliance) — Audit-prep export endpoints do not exist

**Where:** the only data-export surface on finance pages is the `ExportDropdown` added in PR #945 for COS / Cashflow / Revenue Tracking. There's no dedicated endpoint that produces:
- "Every invoice in FY26 grouped by project, with PO + payment evidence"
- "Every revenue milestone billed in FY26 with contract evidence"
- "Every period that was locked / unlocked with authoriser + reason"

`cos_period_locks` carries the authoriser data but isn't exposed as a report. There's no "Contract evidence" linkage on revenue lines (no `contract_id` FK).

**Severity:** HIGH for audit readiness. External auditors will request these bundles; Finance has to assemble them by hand each year.

**Fix shape:** three new endpoints under `/api/finance/audit-export/`:
- `GET /invoices-by-project?fy=2026` → CSV bundle
- `GET /revenue-milestones?fy=2026` → CSV bundle
- `GET /period-locks?fy=2026` → CSV bundle

Plus a small "Audit Prep" page that previews and downloads each. Each export carries a timestamp + the authorising user.

**Status:** **Not fixed in this PR.** Bundle for the next finance-route housekeeping PR.

---

## 11. TF-10 (HIGH — workflow) — Project handover has no finance close-out gate

**Where:** `server/handover-routes.ts` (handover gate logic). The handover lifecycle has operational / technical / compliance gates but no "finance close-out" gate.

**Effect:** a project can move to `closed` with outstanding invoices, open POs, unreceived payments, and an open Final Reconciliation. No app-side checklist confirms "all in / all out". No warranty-holdback automation (typical solar EPC retains 5–10% for 12 months post-handover).

**Severity:** HIGH for project governance. The first warning a CFO gets that a closed project has unresolved finance is when an old invoice surfaces months later.

**Fix shape:** add a `finance_close_out` gate to the handover model. The gate checks:
- Outstanding AR for the project = 0
- Outstanding AP for the project = 0
- Open POs = 0 (or all cancelled)
- Optionally: warranty holdback reserve booked

A new "Final Project Reconciliation Report" surface aggregates these checks.

**Status:** **Not fixed in this PR.** Workflow + schema; needs owner sign-off.

---

## 12. TF-11 (HIGH — RBAC drift) — Snapshot test covers only 22 of ~84 finance endpoints

**Where:** `qa/tests/unit/finance-rbac-pr943-snapshot.test.ts` (added in PR #948) pins the 22 endpoints migrated by PR #943.

**Verified by file inspection.** Remaining unpinned finance endpoints:
- `quickbooks-invoice-matches.routes.ts` — 16 endpoints
- `quickbooks-routes.ts` — ~35 endpoints (OAuth + finance integration)
- `finance-lines.routes.ts` — 5 endpoints
- `finance-trust-routes.ts` — 6 endpoints (4 gated)

Total of ~62 unpinned finance endpoints. A future commit could silently remove or downgrade a gate on any of them.

**Severity:** HIGH. The PR #943 fix work could regress without a CI signal.

**Fix shape:** extend the snapshot test to cover the remaining endpoints in the same source-text-grep pattern.

**Status:** **Fix applied in this PR** — `qa/tests/unit/finance-rbac-pr943-snapshot.test.ts` extended to cover ~50 additional endpoints across the four files above.

---

## 13. TF-12 (MEDIUM — performance) — Bridge writer has unbounded in-memory queue

**Where:** `server/bridge/bridge-writer.ts` + the in-memory job queue.

**Per the performance agent.** The bridge fires off promoted-schema writes via a `MemoryJob[]` array with no maximum depth check. Under heavy import load, the queue could grow unbounded — process memory pressure, then OOM.

**Severity:** MEDIUM. Hasn't bit production yet because import volumes are modest. Becomes critical at higher row counts.

**Fix shape:** add `MAX_QUEUE_DEPTH = 10_000`; reject (and log) new enqueues beyond that. Add Prometheus / CloudWatch metric for queue depth.

**Status:** **Not fixed in this PR.** Architectural; needs careful look at how the queue is drained.

---

## 14. TF-13 (MEDIUM — security) — Cost-line POST permits over-posting via Zod `.passthrough()`

**Where:** `server/routes/finance-legacy-extracted-routes.ts:1183–1208`. The `costLineSchema` / `revenueLineSchema` use Zod's default (which is permissive on unknown fields).

**Per the agent; tested behaviour matches.** A POST body can include fields beyond the declared schema — e.g. `effectiveFrom`, `createdBy`, `source` — and they pass through to the service layer. The service layer doesn't always validate them, so the user can spoof audit metadata.

**Severity:** MEDIUM. Combined with TF-1 (no project-scope check), the over-posting widens the attack surface.

**Fix shape:** switch the schemas to `.strict()` (Zod rejects unknown fields). Add an explicit project-scope check in the route before calling the service.

**Status:** **Fix applied in this PR** — both schemas switched to `.strict()`.

---

## 15. TF-14 (MEDIUM — audit-trail) — Smart Import commit not linked to upload audit

**Where:** `server/smart-import-routes.ts` upload endpoint logs `logAuditFromReq({ action: "upload" })` once. The subsequent commit writes individual cost/revenue lines but doesn't link each write back to the originating upload run.

**Severity:** MEDIUM. A forensic question like "which import run wrote this cost line?" requires manual reconstruction.

**Fix shape:** carry an `import_run_id` through the commit-executor and write it into the per-line audit event.

**Status:** **Not fixed in this PR.** Touches commit-executor signature; medium scope.

---

## 16. TF-15 (MEDIUM — security) — No rate limiting on QB endpoints

**Where:** `server/quickbooks-routes.ts` + `server/routes/quickbooks-invoice-matches.routes.ts`.

**Per the agent.** Bulk QB endpoints (find-matches, sync-now, approve-multi) have no rate limit. An authenticated user could hammer `/api/quickbooks/invoice-matches/find` and DOS the QB API.

**Severity:** MEDIUM. Mostly self-limiting because QB itself rate-limits upstream.

**Fix shape:** add `express-rate-limit` (10 req/min/user) on the high-cost QB endpoints.

**Status:** **Not fixed in this PR.**

---

## 17. TF-16 (MEDIUM — frontend consistency) — 9 finance pages still use non-canonical money formatters

**Where:** PR #945 migrated `dashboard.tsx` and `coo-home.tsx`. The agent identified 9 other pages still using local `formatCurrency` / direct `Intl.NumberFormat` / `.toLocaleString`:
- `client/src/pages/pm-monthly-report-project.tsx:56–58`
- `client/src/pages/portfolio-detail.tsx`
- `client/src/pages/priority-detail.tsx:515`
- `client/src/pages/project-lifecycle.tsx:1425–1430`
- `client/src/pages/financial-linking.tsx`
- `client/src/pages/program-reports.tsx`
- `client/src/pages/po-approval-board.tsx`
- `client/src/pages/expenditure-breakdown.tsx:1–2`
- `client/src/pages/subcontractor-dashboard.tsx`

**Severity:** MEDIUM. Behaviour drift: when canonical `formatZar` changes (e.g. adds a sign prefix), only the canonical sites change. Null handling differs (some show "R 0", canonical shows "—").

**Status:** **Partially fixed in this PR** — migrated the 3 highest-traffic pages (`priority-detail.tsx`, `project-lifecycle.tsx`, `portfolio-detail.tsx`). Remaining 6 are queued.

---

## 18. TF-17 (MEDIUM — frontend reliability) — Cashflow mutations missing optimistic updates

**Where:** `client/src/pages/cashflow.tsx`. Mutations like `overrideExpenseDate`, `overrideInflowDate`, OPEX budget edits use `onSuccess` + `onError` only — no `onMutate` optimistic rollback.

**Effect:** user types a date override → button spins → refetch → UI updates. Feels slow vs. the budget-edit pattern in `cos.tsx` which has full optimistic UI.

**Severity:** MEDIUM. UX polish.

**Status:** **Not fixed in this PR.**

---

## 19. TF-18 (MEDIUM — frontend) — Inconsistent React Query `staleTime` across finance pages

**Where:** different pages set different `staleTime` values:
- `cos.tsx:960` — 30s
- `cashflow.tsx:1544` — 5min
- `dashboard.tsx:551` — 2min refetchInterval

`refetchOnWindowFocus: false` is the default, which means leaving a tab idle for 10 minutes returns stale data on focus.

**Severity:** MEDIUM. Confusing UX consistency.

**Fix shape:** define a `FINANCE_STALE_POLICY` constant — volatile (30s + focus refetch), stable (5min), real-time (10s polling) — and apply uniformly.

**Status:** **Not fixed in this PR.**

---

## 20. TF-19 (MEDIUM — frontend correctness) — No drill-down reconciliation indicator

**Where:** dashboard tiles → drilldown page transitions on `priority-detail.tsx`, `project-lifecycle.tsx`.

**Effect:** when user clicks a "Revenue: R 5M" tile and the drilldown rows sum to R 4.9M, the discrepancy is invisible. No "total: R X across N rows" footer.

**Severity:** MEDIUM. A user could make a decision on a number that doesn't reconcile to its own breakdown.

**Status:** **Not fixed in this PR.**

---

## 21. TF-20 (MEDIUM — cross-domain governance) — Cost-line edits bypass the approval system

**Per the cross-domain agent.** `PATCH /api/finance/cost-lines/:id` checks `requirePermission("financials", "edit")` and nothing else. A finance editor can change `invoice_date`, `paid_date`, `po_number` directly without a manager sign-off.

**Severity:** MEDIUM. EE has an approvals engine; finance edits don't use it.

**Fix shape:** route material finance edits (paid_date, invoice_date changes that flip realisation) through `pending_approvals` with a configurable threshold.

**Status:** **Not fixed in this PR.** Cross-domain — needs owner direction.

---

## 22. TF-21 (MEDIUM — cross-domain consistency) — `payment_request.paidDate` not synced to `cost_line.paidDate`

**Per the cross-domain agent.** Procurement domain marks a payment request as paid; finance domain's `normalized_cost_lines.paidDate` is set separately, by a different write path. The two can diverge — Cashflow shows "paid" while Finance shows "outstanding" for the same invoice.

**Severity:** MEDIUM. Cross-domain inconsistency observed by operators.

**Fix shape:** when a payment request transitions to `paid`, find the matching cost line(s) by PO + supplier and propose an update via a cascade-proposal-style flow.

**Status:** **Not fixed in this PR.**

---

## 23. TF-22 (MEDIUM — lifecycle / governance) — `S_HOLD` does not freeze finance writes

**Per the cross-domain agent.** Moving a project to `S_HOLD` doesn't lock cost-line or revenue-line edits. A held project can still receive new invoices and have revenue adjusted.

**Severity:** MEDIUM. Per § 4A of guardrails, Hold is a status not a stage — but EE owners typically expect held projects to have their books frozen.

**Status:** **Not fixed in this PR.** Owner decides: freeze on Hold, or allow with audit?

---

## 24. TF-23 (MEDIUM — cross-domain) — QB realm switch leaves orphaned links

**Per the cross-domain agent.** When a QB realm is disconnected (e.g. company switches QB instances), `quickbooks_invoice_links` rows with the old realm_id stay in place. Cost lines show "QB-linked" but the link points to a realm that no longer answers.

**Severity:** MEDIUM. Operationally rare but creates ghost links that confuse the reconciliation surface.

**Fix shape:** on realm disconnect, mark old links `status='orphaned'` instead of leaving them active.

**Status:** **Not fixed in this PR.**

---

## 25. TF-24 (MEDIUM — cross-domain) — PO cancellation doesn't cascade to cost lines

**Per the cross-domain agent.** When a PO is cancelled in the procurement domain, cost lines referencing it by `po_number` (string match, no FK) keep their `INVOICED` / `PAID` status as if the PO were still live.

**Severity:** MEDIUM. Mostly affects forecast cleanliness rather than realised totals.

**Status:** **Not fixed in this PR.**

---

## 26. TF-25 (MEDIUM — test coverage) — 5 of 6 finance KPIs have no unit test pinning the formula

**Per the V2-deferred agent.** `shared/kpi-definitions.ts` defines 6 finance KPIs. Only `cos_tracker_realised` has dedicated unit tests (the 47-test suite in `cos-realisation-consistency.test.ts`). The others — `revenue_planned`, `gp_tracker_actual`, `revenue_tracker_allocated`, `dashboard_plan_gp_margin`, `finance_recognised_revenue` — have no formula-pinning tests.

**Severity:** MEDIUM. Regressions could land silently.

**Status:** **Not fixed in this PR.** Bundle for the next test-coverage PR alongside DF-21 / DF-28.

---

## 27. TF-26 (MEDIUM — code hygiene) — Deprecated PE/PI types still publicly exported

**Per the schema agent.** `shared/schema/finance.ts:61–165` defines `ProgramExpense` / `InsertProgramExpense` / `ProgramInflows` / `InsertProgramInflows` with `@deprecated` doc comments — but exports them at module scope. New code can still import them, contradicting the deprecation.

**Severity:** MEDIUM. Cosmetic but confusing for new contributors.

**Status:** **Fix applied in this PR** — types annotated as `@internal` and the doc comment updated to point at the compatibility shim.

---

## 28. TF-27 (LOW — naming) — Duplicate migration file prefixes

**Verified.** Seven pairs of migration files share the same numeric prefix (0016, 0032, 0033, 0051, 0069, 0070). The journal idx is strictly sequential 0–72; Drizzle uses idx for ordering, not the filename prefix, so **execution order is not affected**. The pairs are just naming inconsistency from concurrent PR merges.

The schema agent flagged this as CRITICAL; verification downgrades to LOW.

**Severity:** LOW. Aesthetic only.

**Status:** **Not fixed in this PR.** Renaming would churn migration files unnecessarily; flag and move on.

---

## 29. TF-28 (MEDIUM — compliance) — No VAT period tracking

**Per the workflow agent.** SA VAT is bi-monthly (Feb / Apr / Jun / Aug / Oct / Dec close-outs). The app has no `vat_period` field, no "VAT 201 export", no post-filing edit lock. Finance assembles VAT 201 manually from Excel.

**Severity:** MEDIUM for compliance. Post-filing edits create an unflagged variance against the SARS submission.

**Status:** **Not fixed in this PR.** Schema + workflow; owner sign-off needed.

---

## 30. TF-29 (LOW — security) — Error messages expose exception text

**Per the security agent.** Several `res.status(500).json({ error: error.message })` patterns in `server/departments/finance-routes.ts` and similar. Postgres constraint names aren't secrets, but a network / OAuth error message could leak more than necessary.

**Severity:** LOW.

**Status:** **Not fixed in this PR.**

---

## 31. TF-30 (LOW — frontend) — `controlled_documents` and `project_sharepoint_roots` tables unused

**Per the schema agent.** Both tables are exported in the Drizzle schema and created by migrations, but no SELECT / INSERT / UPDATE references them in `server/`. They're dormant.

**Severity:** LOW. Schema weight only.

**Status:** **Not fixed in this PR.** Cleanup candidate for a later schema-archaeology PR.

---

## 32. TF-31 (LOW — frontend) — Date display inconsistency

**Per the frontend agent.** `revenue-tracking.tsx:64–67` shows raw `YYYY-MM-DD` strings. Other pages use `.toLocaleString()` (browser timezone, not SAST). Canonical helper `formatDateTimeZA()` exists but isn't used on finance pages.

**Severity:** LOW.

**Status:** **Not fixed in this PR.**

---

## 33. TF-32 (LOW — frontend) — No "stale data" badge on KPI tiles

**Per the frontend agent.** TanStack `dataUpdatedAt` is exposed but not rendered next to KPI tiles. User can't tell whether the number is 30 seconds old or 30 minutes.

**Severity:** LOW.

**Status:** **Not fixed in this PR.**

---

## 34. TF-33 (LOW — frontend) — Status badges in COS variance cells rely on colour alone

**Per the frontend agent.** Variance cells use only CSS colour (red / emerald / muted). Colour-blind users lose information when the value is short or in a narrow column. Numbers are still present, so impact is minor.

**Severity:** LOW.

**Status:** **Not fixed in this PR.**

---

## 35. TF-34 (LOW — accessibility / frontend) — No client-side date validation before submit

**Per the frontend agent.** Future paidDate is rejected by the server (PR #945 Zod refinement, DF-29 test) but the form posts first, gets a 400, shows a toast. Client-side validation would catch it earlier.

**Severity:** LOW.

**Status:** **Not fixed in this PR.**

---

## 36. TF-35 (LOW — frontend) — No multi-tab cache sync (BroadcastChannel)

**Per the frontend agent.** Two browser tabs open on the same finance page have independent React Query caches. Tab A edits, Tab B's cache stays stale until manual refresh / window focus.

**Severity:** LOW. Acceptable for current EE scale (no two-officer concurrent editing).

**Status:** **Not fixed in this PR.**

---

## 37. Fixes applied in this PR

| # | Finding | What changed | Files | Risk |
|---|---------|-------------|-------|------|
| 1 | TF-3 | Additive index migration `(project_id, effective_to)` on `normalized_cost_lines` and `normalized_revenue_lines`; `(paid_date, effective_to)` on `normalized_revenue_lines`. NOT applied — needs `db:migrate` approval. | `migrations/0075_finance_audit_v3_indexes.sql` (new), `migrations/meta/_journal.json` | None until applied; pure performance improvement |
| 2 | TF-11 | Extended RBAC snapshot test to cover ~50 additional finance endpoints across `quickbooks-invoice-matches.routes.ts`, `quickbooks-routes.ts`, `finance-lines.routes.ts`, `finance-trust-routes.ts`. | `qa/tests/unit/finance-rbac-pr943-snapshot.test.ts` | None — test only |
| 3 | TF-13 | Switched `costLineSchema` and `revenueLineSchema` from default-permissive to `.strict()`; over-posted fields now rejected at the route boundary. | `server/routes/finance-legacy-extracted-routes.ts` | Low — caller-side over-posting was never expected; legitimate clients send only declared fields |
| 4 | TF-16 (partial) | Migrated 3 of 9 remaining pages to canonical `formatZar`: `priority-detail.tsx`, `project-lifecycle.tsx`, `portfolio-detail.tsx`. | client/src/pages/{priority-detail,project-lifecycle,portfolio-detail}.tsx | Low — same numeric output for valid numbers; "—" placeholder for null |
| 5 | TF-26 | Marked deprecated `ProgramExpense` / `InsertProgramExpense` / `ProgramInflows` / `InsertProgramInflows` types as `@internal` with pointer to the compat shim. | `shared/schema/finance.ts` | None — annotation only |

All other findings deferred — see § 38.

---

## 38. Deferred to follow-up

| # | Finding | Why deferred |
|---|---------|--------------|
| TF-1 | QB approve project-scope check | Security-critical but needs owner direction on whether `financials:edit` is global or project-bounded; touches 4+ sibling routes |
| TF-2 | QB cascade per-field audit events | Audit-shape design choice; bundles with diff-engine |
| TF-3 apply | Migration 0073 | Needs `db:migrate` approval |
| TF-4 | derived_project_kpis writer | CRITICAL — needs owner to confirm external writer identity or authorise in-app materializer |
| TF-5 | USD conversion | One-line owner answer needed: Case A or Case B |
| TF-6 | Accessibility aria-labels on money | Touches every finance tile; bundle as dedicated a11y PR |
| TF-7 | Disputed-invoice workflow | Schema + UI; owner sign-off on shape |
| TF-8 | Bad-debt write-off workflow | Schema + governance; owner sign-off on threshold + authorising role |
| TF-9 | Audit-prep export endpoints | New routes + UI; bundle as a dedicated export PR |
| TF-10 | Handover finance close-out gate | Cross-domain (handover + finance); owner sign-off |
| TF-12 | Bridge writer queue depth | Architectural |
| TF-14 | Smart Import audit linkage | Touches commit-executor signature |
| TF-15 | Rate limiting on QB | Easy but needs decision on per-user vs per-IP |
| TF-16 remaining 6 | Other pages on canonical formatZar | Mechanical; bundle next housekeeping |
| TF-17 | Optimistic updates on cashflow | UX polish |
| TF-18 | Standard `staleTime` policy | Architecture |
| TF-19 | Drill-down reconciliation indicator | Cross-page UX |
| TF-20 | Cost-line edits via approvals | Cross-domain; owner sign-off |
| TF-21 | payment_request ↔ cost_line sync | Cross-domain |
| TF-22 | S_HOLD finance freeze | Lifecycle governance; owner sign-off |
| TF-23 | QB realm orphan handling | Operational |
| TF-24 | PO cancellation cascade | Cross-domain |
| TF-25 | KPI formula unit tests | Test-coverage PR |
| TF-28 | VAT period tracking | Compliance schema |
| TF-29 | Error message scrubbing | Security cleanup |
| TF-30 | Drop controlled_documents tables | Schema cleanup |
| TF-31 | Date display canonical helper | Frontend consistency |
| TF-32 | "Stale data" badge | Frontend polish |
| TF-33 | Variance cell colour fallback | Accessibility |
| TF-34 | Client-side date validation | Frontend polish |
| TF-35 | BroadcastChannel multi-tab sync | Frontend nice-to-have |

---

## 39. Could-not-verify items

- The schema agent flagged "out-of-order migration journal entries" as CRITICAL. Direct verification showed the journal `idx` is strictly sequential 0–72; Drizzle uses `idx`, not the filename prefix. The "out-of-order" was naming inconsistency only — execution order is correct. Downgraded to LOW (TF-27).
- TF-4 (`derived_project_kpis` writer) — I personally verified the absence by grep, but cannot rule out a writer that runs outside the repo (Replit cron, AWS Lambda, etc.). Owner confirmation needed.
- TF-5 (USD convention) — strong circumstantial evidence for Case B but the definitive answer is "what does the tracker actually store in `amount_ex_vat` for a USD-sourced line?" — needs an example workbook to inspect.
- The end-to-end workflow agent assessed 13 business processes; many MEDIUM/HIGH findings depend on operational expectations I can't fully model without owner input.

---

## 40. Recommended sequence

1. **Owner one-liner on TF-5 (USD convention).** Five minutes of owner time unblocks a HIGH finding.
2. **Owner direction on TF-4 (derived_project_kpis writer).** Either identify the external writer (and document it) or commit to building one — F-1 Phase 2 is blocked either way.
3. **TF-1 + TF-2 (QB approve security).** Add project-scope check + per-field audit. Single sprint.
4. **TF-3 apply (indexes).** Needs `db:migrate` approval. Single migration window.
5. **Workflow gaps (TF-7, TF-8, TF-9, TF-10).** These are products in their own right; each needs an owner sign-off on the shape.
6. **Test coverage (TF-25 + V2's DF-21, DF-28).** Bundle as one PR once an API DB harness exists.

V1 proved the formulas. V2 hardened the invariants. V3 surfaces the workflows. The remaining work is mostly **product decisions** (what does a dispute look like? what's a write-off authority threshold? when does a project closure become a final reconciliation?), not engineering decisions.

*End of V3 audit.*
