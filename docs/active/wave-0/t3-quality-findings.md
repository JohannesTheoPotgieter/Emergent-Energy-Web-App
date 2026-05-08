# T3 Quality Pillar Audit — findings

**Date:** 2026-05-08
**Scope:** Read-only audit of the Quality module per Plan v3 (Wave 0).
**Inputs read:** ~16 files (cap 30). Anchored against `docs/AGENT_GUARDRAILS.md`
§ 3A (workflow invariants), § 4 (architectural spine), § 5 / § 5A (security
& hard refusals), and `docs/operating-model/playbook-v2.0.md` Stage 5 § 5.6 /
§ 5.10 / § 5.11 and Stage 6.
**Posture:** Document only. No code, no schema, no migrations changed.

> Defect triage column on every finding row:
> `fix-now` = quality control demonstrably broken / silent on a HARD playbook control,
> `fix-soon` = data/audit shape degraded but the day-to-day workflow survives,
> `defer` = cosmetic / coverage gap / future-feature.

---

## T3.1 — Quality module surfaces

### Tables that exist (`shared/schema/quality.ts`)

| Table | Lines | Purpose | Notes |
|---|---|---|---|
| `qc_template` / `qc_template_phase` / `qc_template_group` / `qc_template_item` | `quality.ts:11-54` | 4-level checklist template (template → phase → group → item) | Item carries `isEvidenceRequired` + `defaultSeverity`; no `approverRole`, no `holdPointType` |
| `qc_template_risk_question` | `quality.ts:56-68` | Yes/no questions that can trigger a warning | `triggersWarning`, `triggerCondition`, `triggerSeverity` |
| `qc_template_postmortem_metric` | `quality.ts:70-79` | Sub-contractor / engineering scorecard metric definitions | `metricGroup` defaults to `contractor_quality` — this **IS** the sub-contractor scorecard surface |
| `qc_checklist` + `qc_item_instance` | `quality.ts:81-117` | Per-project checklist & item state | `qmStatus` enum drives state machine (`not_started` → `pass`/`fail`/`review`/`na`) |
| `qc_item_evidence` | `quality.ts:119-131` | Evidence URLs / file refs attached to items | Soft-delete via `deletedAt` |
| `qc_risk_answer` | `quality.ts:133-145` | Risk question answers per checklist | |
| `qc_plan_link` | `quality.ts:147-160` | Links checklist items to PM plan items / phases | Phase linkage at row level |
| `qc_warning` + `qc_warning_event` | `quality.ts:162-193` | Warnings raised by the engine + event log per warning | `warningType`, `severity`, `status` (`open`/`in_progress`/`resolved`), `ownerUserId` |
| `qc_postmortem` + `qc_postmortem_metric_value` + `qc_postmortem_summary` | `quality.ts:195-229` | Post-mortem with `contractorQualityScore`, `engineeringQualityScore`, `redFlag` | This **IS** the sub-contractor scorecard output |
| `qc_access_challenge` | `quality.ts:231-243` | Access-code rate-limit table (separate code gate for QM / EPM views) | Tied to `QM_ACCESS_CODE` / `EPM_ACCESS_CODE` env-based gate |
| `commissioning_items` | `quality.ts:249-271` | Stage 6 commissioning items + status enum | Has `gateId`, `category`, `evidenceNotes`, `approvalId` |
| `evidence_requirement_definitions` / `evidence_collected_items` / `evidence_evaluations` / `evidence_override_records` | `quality.ts:277-347` | Evidence-scoring model: definitions, collected items, computed evaluation, override audit | This is a clean override-with-audit surface — it could be the template for softening other quality refusals |
| `ncr_reports` / `ncr_attachments` / `ncr_comments` | `quality-ncr-routes.ts:25-61` | NCR lifecycle | **NOT in `shared/schema/*.ts`** — created via `CREATE TABLE IF NOT EXISTS` in `ensureNcrTables()` at runtime. Drizzle is unaware of these tables. |
| `site_inspections` | `construction.ts:60-79` | Inspections including `inspection_type = 'hold_point'` | Lives in `construction.ts`, not `quality.ts` — orphaned from QC checklist |
| `phase_template_item` | `projects.ts:875-901` | Phase task template with `requiresQcApproval`, `evidenceRequired`, `qualityItemKey`, `approverRole` | This is the **playbook-aligned** surface for QA hold points but is in `projects.ts`, not `quality.ts` |

### Domain coverage matrix

| Playbook concept | Schema surface | Verdict | Triage |
|---|---|---|---|
| NCRs | `ncr_reports` table created at runtime by `quality-ncr-routes.ts:19-63` | ⚠️ Exists but **off-Drizzle**, no FK to `project_info.id`, no `phase` column, no link to `qc_warning` | fix-soon |
| QA hold points | `qc_template_item` (no `holdPoint`/`approverRole` flag) + `phase_template_item.requiresQcApproval` (in `projects.ts`) + `site_inspections.inspection_type = 'hold_point'` (in `construction.ts`) | ⚠️ **Three disjoint surfaces** with no integrity link. The seeded checklist (`seed-quality-template.ts:70-89`) has a generic "Quality checks" group; **no torque records, no IR test, no Voc** as discrete items. | fix-now |
| Warnings | `qc_warning` + `qc_warning_event` with engine in `quality-routes.ts:2575-2692` | ✅ Engine generates 5 warning types: `overdue`, `invalid_dates`, `missing_evidence`, `risk_trigger`, `task_complete_unapproved`, `phase_incomplete` | PASS |
| Inspections | `site_inspections` (`construction.ts:60-79`) | ⚠️ Schema exists but **no routes audit found writing to it from quality flows**; QC checklist items are not linked to it | fix-soon |
| Sub-contractor scorecards | `qc_postmortem_summary.contractorQualityScore` + `qc_template_postmortem_metric` (metricGroup `contractor_quality`) | ⚠️ Single end-of-project score, **per-sub-contractor identity is missing** (`qc_postmortem` has `projectId` only, not `subcontractorId` / `counterpartyId`); `contractor_assignments` exists in `construction.ts:83-99` with `performanceRating` but **is unlinked** to `qc_postmortem` | fix-soon |
| Quality sign-offs | `qc_item_instance.approved` / `approvedByUserId` / `approvedAt` / `approvalComment`; commissioning via `commissioning_items.status = 'approved'` + `approvalId` | ✅ Captured per-item; ✅ commissioning has explicit approval path | PASS |

**Verdict (T3.1):** Surfaces exist for every playbook concept but are **fragmented across `quality.ts`, `construction.ts`, `projects.ts` and a runtime-created NCR table**. The biggest structural defect is that `ncr_reports` is `CREATE TABLE IF NOT EXISTS`'d outside Drizzle, breaking the architectural-spine rule (§ 4 — every record FK to `project_info.id`).

---

## T3.2 — NCR handling end-to-end

### State machine (`quality-ncr-routes.ts:8-15`)

```
STATUS_ORDER: open → investigating → corrective_action → verification → closed
```

`canTransition(from, to)` enforces forward-only / one-step transitions
(`quality-ncr-routes.ts:10-15`). No `waived` state. No reverse-transition
allowed (`closed` is terminal).

| Concern | Location | Verdict | Triage |
|---|---|---|---|
| State machine: open / in progress / closed / waived | `quality-ncr-routes.ts:8` defines `open / investigating / corrective_action / verification / closed` | ⚠️ **No `waived` state**; playbook § 5.10 implies waiver is possible (rare, owner-authorised). No override path exists. | fix-soon |
| Linkage to `project_info.id` | `quality-ncr-routes.ts:27` — `project_id INTEGER NOT NULL` (no FK constraint, off-Drizzle) | ⚠️ Column exists but no FK; cascade behaviour undefined; no validation that `project_id` is a real project | fix-now |
| Linkage to project stage / phase | None — `ncr_reports` has no `phase` or `phaseAtRaiseTime` column | ❌ § 4B-style "always keep history under its phase" is not honoured for NCRs. NCR raised in Construction will appear identically to one raised in Commissioning. | fix-soon |
| Linkage to sub-contractor | None — no `counterpartyId` / `subcontractorId` / `contractorAssignmentId` column | ❌ Cannot answer "how many open NCRs against ContractorX?" without a parallel scorecard. Playbook § 5.10 explicitly requires this linkage. | fix-now |
| Linkage to checklist / hold point | `related_checklist_item_id INTEGER` (`quality-ncr-routes.ts:39`) | ⚠️ Column exists; no FK to `qc_item_instance.id`; not joined in any read path | fix-soon |
| `audit_events` row per state transition | Yes — `logAuditFromReq` on create (`:101`), update (`:150`), delete (`:165`) | ✅ Every NCR mutation writes audit. Update audit captures `statusTransition: 'X -> Y'` only when status actually changes (`:150`) — exactly the right shape. | PASS |
| `recordAudit` (Plan v3 § 2.3) coverage | `quality-ncr-routes.ts` uses `logAuditFromReq` (request-bound). The 8 services that landed `recordAudit` calls in Plan v3 § 2.3 are: `om-handover-service`, `pending-approvals-service`, `quickbooks-cascade-proposals-service`, `stage-exception-service`, `stage-lifecycle-service` (5 distinct files; the "8" likely counts call-sites). **No quality service is on this list.** | ⚠️ **Quality is the gap.** `recalculateWarnings()` (a pure backend function with no `req` context, `quality-routes.ts:2575`) has no audit emission at all when it auto-resolves and re-creates open warnings. | fix-soon |
| Payment-holdback enforcement | Searched `payment_hold`, `holdback`, `paymentHold` across `shared/schema` + `server/`: **only hit is `procurement_payment_status` enum value `'on_hold'` (`finance.ts:24`)** — generic procurement state, **not driven by NCR status** | ❌ Playbook § 5.10 ("payment holdback rules where NCRs are open") is **not enforced anywhere**. No code path reads `ncr_reports.status` to gate procurement payment status. | fix-now (gap, not regression) |

### Verdict (T3.2)

NCR write-side audit coverage is good. The **structural** problems are
larger: NCRs live outside the schema source of truth, are unlinked to
phase / sub-contractor / checklist / payment, and the playbook's most
operationally important rule (no payment while NCR open) is not
implemented in code anywhere.

---

## T3.3 — QA hold points (Construction § 5.6 / Commissioning Stage 6)

Playbook § 5.6 requires: **torque records · IR tests · Voc readings ·
photos · sign-off**. § 5.11 names the same items as Construction exit
gate criteria. These are *the* HARD QA hold-point list.

| Hold-point control | Codified in template? | Owner role enforced? | Approval role enforced? | Evidence required flag set? | Sign-off recorded in audit? | Triage |
|---|---|---|---|---|---|---|
| Torque records (per row/area) | ❌ Searched all of `seed-quality-template.ts`, `shared/schema/`, `server/`, `client/` for `torque` — **only hit is in `server/seed-ee-info-updates.ts:1189` (a training-narrative seed), never in checklist data** | n/a | n/a | n/a | n/a | fix-now |
| IR (insulation resistance) tests | ❌ Same — only narrative hits in `seed-ee-info-updates.ts:879` and `ee-info-routes.ts:2080` | n/a | n/a | n/a | n/a | fix-now |
| Voc / Isc readings | ❌ Same — only narrative hits in `seed-ee-info-updates.ts:880,1208`. No `qc_template_item.itemName ~ 'Voc'`. | n/a | n/a | n/a | n/a | fix-now |
| Photos | ⚠️ Only via generic `qc_item_evidence` (`quality.ts:119-131`); not enforced as a typed evidence kind. `evidenceTypeEnum` does include `'photo'` (`quality.ts:275`) but the seeded checklist items do not pin to photos specifically. | n/a | n/a | partial — `isEvidenceRequired` is set on some construction items (`seed-quality-template.ts:80-83,86`) but not as photo-specific | via `audit_events` action `update` description "Evidence file uploaded" | fix-soon |
| Sign-off by Quality / Construction Manager | ✅ `qc_item_instance.approved` + `approvedByUserId` + `approvedAt` + `approvalComment`; only QM Manager / admin can move from review/fail back to pass (`quality-routes.ts:923-930, 1039`) | n/a | ✅ — hardcoded RBAC in route handler, not template-driven | n/a | ✅ `logAuditFromReq` on approve (`quality-routes.ts:1089`) | PASS |

### Schema observation — the right surface exists but is not used here

`phase_template_item` (`projects.ts:875-901`) has the **right shape**
for hold points:

- `requiresQcApproval boolean`
- `qualityItemKey text` (links into `qc_template_item`)
- `evidenceRequired boolean`
- `approverRole text`
- `requiresOperationalApproval boolean`

But the **construction-phase QC template seeded by
`seed-quality-template.ts:70-89`** uses `qc_template_item` (which has
*no* `approverRole` and *no* `holdPointType`). So the architecturally
correct surface (`phase_template_item`) and the actually-seeded surface
(`qc_template_item`) are different surfaces, and the explicit hold
points named in the playbook live in **neither**.

| Concern | Verdict | Triage |
|---|---|---|
| QA hold-point template exists | ⚠️ Two competing template surfaces (`phase_template_item` vs `qc_template_item`); the seeded data lives in the lighter-weight one without per-item approver role. | fix-now |
| Each hold point has owner + approval role + evidence required | ⚠️ Approval role is enforced in route handler, not data. Evidence required is per-item. **Owner role is missing entirely** — no `ownerRole` column on `qc_template_item`. | fix-soon |
| Sign-off recorded in audit | ✅ `logAuditFromReq` fires on every `approve` / status change in `quality-routes.ts:864, 1009, 1089` | PASS |
| Commissioning § Stage 6 explicit | ✅ `commissioning_items` table with status enum, `gateId`, `approvalId` exists (`quality.ts:249-271`); no playbook-named hold-point items seeded into it (PR readiness gap, not bug) | fix-soon |

### Verdict (T3.3)

**The named hold points from playbook § 5.6 (torque / IR / Voc / photos)
do not exist as data.** They appear only in training narrative.
Site teams using the QC checklist today will tick "Quality checks"
generic items, not "Torque records uploaded for row 3-4". This is the
single highest-priority finding in the audit.

---

## T3.4 — Warning / event flow

### Generation engine (`quality-routes.ts:2575-2692`)

`recalculateWarnings(projectName)` is invoked on **8 mutation paths**
(`quality-routes.ts:1002, 1082, 1221, 1316, 1359, 1515, 1528` and the
explicit `:2294` recalc endpoint). Generates warnings of types:

| Warning type | Threshold / trigger | Severity |
|---|---|---|
| `overdue` | `item.endDate < today && !item.approved` (`:2598`) | High |
| `invalid_dates` | `endDate < startDate` (`:2606`) | High |
| `missing_evidence` | `approved && tmpl.isEvidenceRequired && !evidence.length` (`:2616`) | High |
| `risk_trigger` | risk question answer matches `triggerCondition` and `question.triggersWarning` is true (`:2632-2645`) | from question |
| `task_complete_unapproved` | linked plan task `actualPctComplete >= 1` but linked QC item `!approved` (`:2657`) | High |
| `phase_incomplete` | linked plan task ends within 7 days but QC item not approved (`:2667`) | High |

| Concern | Verdict | Triage |
|---|---|---|
| Thresholds reasonable | ✅ — overdue is hard (today > endDate), 7-day pre-milestone window, post-completion-but-unchecked. All defensible. | PASS |
| Warnings raised at right thresholds | ✅ | PASS |
| Routing to right roles per playbook | ❌ **`createQmNotification` is a no-op** (`quality-routes.ts:108-115` — function is intentionally stubbed; comment says "Notifications feature removed"). Warnings are visible only on `qm-dashboard.tsx` and `pm-monthly-report` polling — they do not push to HSE / PM / Construction Manager / Head of Eng. | fix-now |
| `audit_events` written when warning created | ⚠️ Only the bulk `recalculate-warnings` endpoint logs audit (`quality-routes.ts:2295`). The **automatic** recalculation triggered by mutations (`:1002, 1082, 1221, 1316, 1359, 1515, 1528`) fires `recalculateWarnings()` as a fire-and-forget `.catch()` with **no audit row** for the warnings it creates or auto-resolves. Auto-resolution of stale warnings is silent. | fix-soon |
| Acknowledge / resolve write audit | ✅ — both write `qc_warning_event` row AND `logAuditFromReq` (`:1455-1464`, `:1476-1485`) | PASS |
| Owner field on warning | ✅ `qc_warning.ownerUserId` (`quality.ts:174`) — but the engine **never sets it** (`recalculateWarnings:2596` and onward — no `ownerUserId` populated on insert). All warnings are created ownerless. | fix-soon |

### Verdict (T3.4)

The detection engine is sound. The **delivery layer is gone** — the
warning fires, lands in a table, and waits for someone to look at the
QM dashboard. There is no email, no in-app notification, no role-routing
based on `warningType`. Combined with the lack of automatic-warning
audit emission, the chain is silent end-to-end.

---

## T3.5 — Quality refusals (cross-ref + softening candidates)

T1.x's earlier sweep counted "~30 refusals in `quality-routes.ts`". A
fresh `grep -c 'res.status(40|50)'` on `server/quality-routes.ts`
returns **42 refusals** at line numbers `:72, :100, :106, :425, :460,
:490, :525, :541, :553, :561, :575, :604, :701, :740, :861, :883, :907,
:911, :919, :928, :959, :1024, :1039, :1056, :1093, :1101, :1104,
:1114, :1122, :1127, :1139, :1147, :1151, :1158, :1165, :1169, :1172,
:1180, :1189, :1192, :1205, :1232, :1243, :1253, :1256, :1270, :1289,
:1293, :1303, :1308, :1323, :1377, :1392, :1447, :1468, :1489, :1502,
:1510, :1511, :2483, :2487, :2502, :2507, :2512`. (NB: this includes
404 / 503 / 500 returns; classic "refusals" — 400 / 401 / 403 — number ~25.)

Plus **6** in `quality-ncr-routes.ts`. Plus the access-code gate
in `qm-access-challenge` enforcing rate-limit lockouts.

### Classification — focused on the refusals that matter for softening

| Line(s) | Refusal | Class | Softening candidate? | Note |
|---|---|---|---|---|
| `:72` | `requireRole(...)` returns 403 | HARD-RBAC | No (template-style guard) | Standard pattern |
| `:100` `requireAdminOrQm` | 403 unless admin or `QUALITY_MANAGER` | **SOFT-WORKFLOW** | **YES** — Phase D.G candidate | Per § 0A, an authorised over-role (e.g., COO) with a reason should be able to act here. Today: hard 403. ENTITY_REGISTRY `quality.override_roles = ['COO_ADMIN', 'CEO_ADMIN']` (`registry.ts:134`) already lists the right authorisers. |
| `:106` `requireAdminOrEpm` | 403 unless admin or `ENGINEERING_MANAGER` | **SOFT-WORKFLOW** | **YES** — Phase D.G candidate | Same shape as above. |
| `:425, :490` | 503 if `QM_ACCESS_CODE` / `EPM_ACCESS_CODE` not configured | HARD-CONFIG | No | Configuration error, not a workflow refusal |
| `:460, :525` | 401 invalid access code | HARD-AUTH | No | Auth |
| `:561, :604, :740, :861, :1192, :1256, :1303, :1308` | 404 not found | HARD-INPUT | No | Input integrity |
| `:907, :911, :919` | 400 invalid status / negative number / invalid status transition | HARD-INPUT | No | Input integrity / state machine |
| `:928` | 403 "Only QM Manager can move from Review/Failed back to Pass" | **SOFT-WORKFLOW** | **YES** — Phase D.G candidate | Hardcoded role check inside handler. Override role `COO_ADMIN` not honoured. Should use `requireAuthoriserFor("quality")`. |
| `:959, :1056` | 400 `evidence_required` — blocks pass if evidence missing | **SOFT-WORKFLOW** | **YES** — Phase D.G candidate | This **IS** the playbook's "QA hold point" gate. Today: pure 400 refusal. The right shape is the existing `evidenceOverrideRecords` table (`quality.ts:333-347`) — soft block + COO override + audit. The data model is **already there**; the route handler ignores it. |
| `:1039` | 403 "Only Quality Manager or Admin can approve items in Review or Failed" | **SOFT-WORKFLOW** | **YES** — Phase D.G candidate | Same as `:928`. |
| `:1101, :1104, :1122, :1127, :1147, :1151, :1158, :1165, :1169, :1172, :1180, :1189, :1205` | 400 input / config refusals (evidence URL required, project context missing, SharePoint not configured, file required, etc.) | HARD-INPUT / HARD-CONFIG | No | |
| `:1253, :1270` | 400 missing item name / no template groups | HARD-INPUT | No | |
| `:1510, :1511` | 400 missing planItemId / phaseId | HARD-INPUT | No | |
| `:2483, :2502` | 403 "Admin access required" | **SOFT-WORKFLOW** | **YES** — Phase D.G candidate (low-priority) | User role / bulk-checklist admin endpoints. Override role `COO_ADMIN` already in registry. |
| `quality-ncr-routes.ts:132` | 400 invalid_transition | HARD-STATE | No | State machine integrity (forward-only transitions); waiver path TBD per § T3.2 |
| `quality-ncr-routes.ts` 401/404 | various | HARD-AUTH / HARD-INPUT | No | |

### Phase D.G softening shortlist (priority order)

1. **`quality-routes.ts:959, 1056` — evidence-required gate.** The
   strongest candidate: this IS a HARD refusal of a SOFT business rule,
   and the override-with-audit table (`evidenceOverrideRecords`) already
   exists in schema with the right shape. **Replacing the 400 with a
   `requireAuthoriserFor("quality")`-protected override path is a
   pattern-match against the QB / handover / stage-advance softening
   already shipped.**
2. **`quality-routes.ts:928, 1039` — QM Manager-only review/fail
   transitions.** Hardcoded role check. Move to
   `requireAuthoriserFor("quality")`; reads `COO_ADMIN, CEO_ADMIN` from
   ENTITY_REGISTRY and writes audit. Drop the inline role check.
3. **`quality-routes.ts:100, 106, 2483, 2502` — `requireAdminOrQm` /
   `requireAdminOrEpm` / "Admin access required".** Lower-priority,
   but the same shape. Replace with the standard middleware.

### Verdict (T3.5)

42 raw refusals; ~25 are HARD (input/auth/state-machine integrity)
and stay. **Five are clean softening candidates**; one (the
evidence-required gate) is a particularly clean fit because the override
table already exists. None of these soften financial-formula or
security-class HARD rules per § 5A.

---

## T3.6 — Quality data into reporting

### What flows from quality into reporting today

| Reporting surface | Reads quality data? | Verdict | Triage |
|---|---|---|---|
| `pages/programme-reports.tsx` Quality report → `/api/reports/quality` (`report-routes.ts:739-793`) | ❌ **No** — reads `project_info.ragStatus` only. Comment at `:738` says: *"Quality is tracked via RAG status on projects. No separate quality_metrics table exists."* This comment is wrong: 13 quality tables exist. | **FAIL — quality KPIs invisible to programme report consumer** | fix-now |
| `dashboard.tsx` (`/api/program-dashboard` → `program-dashboard-repository.ts:173`) | ✅ — pulls `qc_warning` rows raw via `db.execute` | ⚠️ Reads warnings only. No NCR count. No sub-contractor scorecard. No hold-point closure rate. | fix-soon |
| Home dashboard (`dashboard-repository.ts:12, 187, 219-224`) | ✅ — joins `qc_warning` for the home attention list | ✅ Open warnings surface here | PASS |
| PM Monthly Report (`pm-monthly-report-service.ts:22, 139, 449`) | ✅ — pulls `qcWarning` rows; surfaces as `qcWarnings` / `openWarnings` in snapshot JSON | ✅ Snapshot includes warnings; no NCR count, no postmortem score | fix-soon |
| Engineering Monthly Report | ⚠️ — service file analogous to PM (not opened in this audit) | likely same as PM | fix-soon |
| Company Overview KPIs (`company-overview-service.ts:561-604`) | ✅ — five Quality KPIs registered: `qual_red_team_pass_rate` (= `qcProgressResult.progressPercent`), `qual_snag_closeout_ageing` (avg snag open days), `qual_ho_pack_pass_rate`, `qual_phase_evidence_completeness`, `qual_repeat_defect_rate` (hardcoded `0` per `:596`) | ⚠️ — only `qual_red_team_pass_rate` and `qual_snag_closeout_ageing` reach reality. **Three of five Quality KPIs are degenerate or static today**: `qual_repeat_defect_rate = 0` (literal), HO pack rate defaults to 100% when no rows reviewed, phase evidence reads `stage_requirements` (a different surface from `qc_item_evidence`). | fix-soon |
| **NCR open count** | ❌ Not anywhere — `ncr_reports` is read only by `quality-ncr-routes.ts` itself | **FAIL — NCRs invisible to all reporting** | fix-now |
| Sub-contractor scorecards | ❌ `qc_postmortem_summary.contractorQualityScore` exists but is not surfaced in any report endpoint searched | **FAIL — scorecards exist but unread** | fix-soon |
| Hold-point closure rate | ❌ No metric exists today (consequence of § T3.3 — hold points are not first-class) | **FAIL — gap** | fix-now |

### KPI definition vs reality (Quality department, `kpi-registry.ts:267-313`)

| KPI key | Registered intent | Actual computation | Drift |
|---|---|---|---|
| `qual_red_team_pass_rate` (weight 25) | "Red Team First-Pass Pass Rate" | = QC checklist progress % (`computeQcProgress(qcItems)`) | **Drift** — name implies first-pass red-team review; code returns generic checklist progress. Not the same metric. |
| `qual_snag_closeout_ageing` (weight 20) | Days open | avg of `(today - createdAt)` for non-closed snags | OK |
| `qual_ho_pack_pass_rate` (weight 20) | HO pack first-pass pass | reads `handoverPackRows.checklistStatus`; defaults to 100 when `reviewedHoPacks.length == 0` | **Drift** — empty-data → 100% means a fresh tenant scores perfect. Same shape as Surprise 1 from T1.x but in the opposite direction. |
| `qual_phase_evidence_completeness` (weight 15) | Phase evidence completeness | reads `stage_requirements` table | **Drift** — `stage_requirements` is a separate surface from `qc_item_evidence`; the QC evidence already collected does NOT count toward this KPI |
| `qual_repeat_defect_rate` (weight 20) | Repeat defect rate | hardcoded `= 0` (`company-overview-service.ts:596`) | **Drift — fully static.** 20% of the Quality department score is a constant zero. |

### Verdict (T3.6)

Quality data exists in 13 schema tables but **only `qcWarning` reliably
flows into reporting**. The Programme Quality report explicitly
disclaims quality data ("RAG only"). NCR count never reaches a
reporting surface. Three of five KPIs are computational dummies.
Quality is the **least-instrumented pillar in reporting** of the
modules audited so far.

---

## Summary

1. **Top defects (top 4):**
   (a) `seed-quality-template.ts:70-89` — the seeded Construction-phase
   QC template has **no torque-records / IR-test / Voc-reading items**,
   despite playbook § 5.6 naming these as the four hard QA hold points.
   Site teams have nothing to tick. **fix-now.**
   (b) `quality-ncr-routes.ts:25-61` — `ncr_reports` table created
   off-Drizzle via `CREATE TABLE IF NOT EXISTS`; no FK to `project_info.id`,
   no phase column, no sub-contractor link, no checklist-FK enforcement.
   Architectural-spine violation per § 4. **fix-now.**
   (c) Payment-holdback rule (playbook § 5.10) — **completely
   unimplemented**. No code path reads `ncr_reports.status` to gate
   procurement payment. The only `'on_hold'` enum value is in
   `procurement_payment_status` and is not driven by NCR. **fix-now.**
   (d) `report-routes.ts:739-793` — `/api/reports/quality` reads only
   `project_info.ragStatus` and explicitly disclaims quality data
   (`:738`). NCR / warning / postmortem all invisible to the Programme
   Quality report. **fix-now.**

2. **Top quick wins:**
   - Add `phase`, `subcontractor_id`, `closed_by_user_id` columns to
     `ncr_reports`, move it into `shared/schema/quality.ts` with
     proper FKs.
   - Move `:959, :1056` evidence-required gate to use the
     `evidenceOverrideRecords` table that already exists — this is a
     ~30-line softening that cleanly matches the QB / handover /
     stage-advance pattern.
   - Restore notification routing (the `createQmNotification` no-op at
     `quality-routes.ts:109-115`) for warning types `phase_incomplete`,
     `task_complete_unapproved`, `missing_evidence` — the highest-signal
     three.
   - Set `qc_warning.ownerUserId` in `recalculateWarnings()` based on
     warning type (HSE → HSE_MANAGER; phase_incomplete → PM; etc.).

3. **Surprises:**
   - The five Quality KPIs in `kpi-registry.ts` carry **20% weight on
     `qual_repeat_defect_rate`, which is a hardcoded literal `0`** in
     `company-overview-service.ts:596`. Twenty percent of the Quality
     department's score is a constant.
   - **NCRs are marked "Legacy" in the client** — `page-registry.ts:150`
     redirects `/quality/ncrs` to `/quality`; `NcrLegacyDeepLinkBanner`
     exists to soften the deep-link loss. Yet the NCR routes are
     actively maintained and audit-emitting. The client treats NCR as
     deprecated; the backend treats it as live. This drift is the most
     confusing surface I found.
   - The seeded Quality template at `seed-quality-template.ts:46-180`
     is generic ("Quality checks", "Form preparation", "Site
     activities"). The playbook's specific HARD list (torque records,
     IR tests, Voc readings, photos) is in narrative seeds
     (`seed-ee-info-updates.ts:879-1208`) but **never crosses over** to
     the operational checklist data.
   - `phase_template_item` (`projects.ts:875-901`) has the correct
     shape for hold points — `requiresQcApproval`, `evidenceRequired`,
     `qualityItemKey`, `approverRole`. The seeded QC template uses a
     parallel, weaker surface (`qc_template_item`). Two competing
     truth surfaces.

4. **`recordAudit` coverage gap for quality services — YES.**
   The 8 `recordAudit` call-sites Plan v3 § 2.3 added are in 5 service
   files: `om-handover-service.ts`, `pending-approvals-service.ts`,
   `quickbooks-cascade-proposals-service.ts`, `stage-exception-service.ts`,
   `stage-lifecycle-service.ts`. **No quality service is on the list.**
   Specifically:
   - `quality-routes.ts:2575-2692` — `recalculateWarnings()` creates
     and silently auto-resolves warnings as a side-effect of 7 mutation
     paths; **no audit emission**.
   - `quality-routes.ts:108-115` — `createQmNotification` is a no-op
     stub (intentional, comment says "Notifications feature removed");
     no notification audit either.
   - `quality-ncr-routes.ts` is fine — uses `logAuditFromReq` on every
     write path including delete.

5. **Softening candidates (Phase D.G shortlist):**
   - `quality-routes.ts:959, :1056` — evidence-required gate. **Highest
     priority** because the override-with-audit table
     (`evidenceOverrideRecords`, `quality.ts:333-347`) already exists
     in schema.
   - `quality-routes.ts:928, :1039` — QM-Manager-only review/fail
     transitions. Hardcoded role checks; replace with
     `requireAuthoriserFor("quality")`.
   - `quality-routes.ts:100, :106` — `requireAdminOrQm` /
     `requireAdminOrEpm` middleware definitions. Replace with the
     standard pattern; `quality.override_roles` in
     `permissions/registry.ts:134` already lists `COO_ADMIN, CEO_ADMIN`.
   - `quality-routes.ts:2483, :2502` — admin-access-required guards on
     bulk endpoints. Same shape, lower priority.
   - **Add a `waived` state to NCR (`quality-ncr-routes.ts:8`)** —
     today the state machine forbids waiver entirely; playbook § 5.10
     implies an authorised waiver is rare-but-possible. Should be a
     soft state with override + reason + audit, not a missing transition.

6. **Missing reporting integration:**
   - **NCR open / closed counts** — never reach any reporting surface.
   - **Sub-contractor scorecards** (`qc_postmortem_summary.contractorQualityScore`)
     — exist in DB, unread by any report endpoint.
   - **Hold-point closure rate** — no metric exists (downstream of
     § T3.3 — hold points are not first-class data).
   - **`/api/reports/quality`** explicitly defers to `ragStatus`. This
     is the obvious integration point if the Programme Quality report
     is ever to mean "Quality" rather than "RAG colour".

---

*End of file. ~16 source files read; cap was 30. Read-only audit. No
code, schema, or migrations were changed.*
