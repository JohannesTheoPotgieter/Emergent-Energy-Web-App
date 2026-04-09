# Pre-Implementation Migration Control Spec (Live Production)

Date: 2026-04-02  
Scope: ambiguity removal only (no code/migration/adapters in this pass)

## A. Executive summary

- This document freezes migration control boundaries before any implementation begins.
- Phase 1 is **read-path hardening and observability only** (no canonical writer changes).
- Phase 2 is **controlled bridge activation** (dual-read then selective dual-write), with explicit parity gates.
- Canonical ownership remains on current production tables/routes until cutover prerequisites are met and reconciliation thresholds pass.
- Any route/table classified below as “do-not-touch” is excluded from early implementation.

---

## B. Endpoint authority matrix

| Route / hook / page | Backend handler file | Service / repository / query path | Current read tables | Current write tables | Authority class | Target table/model | Safe migration posture | Risk if changed too early |
|---|---|---|---|---|---|---|---|---|
| Auth status/login/logout/me (`/api/auth/*`) + auth bootstrap hooks | `server/routes/auth-routes.ts`, `server/auth-context.ts`, `server/bootstrap/session.ts` | direct DB + token/session helpers | `users`, `session` | `session`, token-version fields on `users` | Canonical | `user_account`, `microsoft_identity`, `role_assignment` | Leave as-is (Phase 1/2) | Session invalidation gaps, forced logout loops, auth bypass risk |
| Project list/detail (`/api/projects`, `/api/projects/:id`) | `server/departments/project-routes.ts` (legacy mirror in `server/routes.ts`) | direct Drizzle queries + project services | `project_info`, `project_execution_state` (+ joins) | none (read endpoints) | Canonical read aggregate | `project_instance` + `project_info` | Adapter read (Phase 1), dual-read (Phase 2) | Wrong project identity joins, pagination drift, stale dashboard cards |
| Project detail master (`/api/project-detail-master`) and project hooks feeding detail page | `server/routes.ts` + detail services | in-file SQL + helper services | `project_info`, `project_execution_state`, `project_phase_history`, work/finance tables | none | Aggregate | `project_instance` composite view | Adapter read then dual-read | Breaks project cockpit and lifecycle panels simultaneously |
| Project create (`POST /api/projects`) | `server/template-routes.ts` | template apply + project init helpers | `clients`, `project_info`, template tables | `project_info`, `project_execution_state`, stage seed tables | Canonical writer | `project_instance` + `project_info` + `project_phase_history` | Leave as-is in Phase 1; dual-write later in Phase 2 | Duplicate project IDs/names, orphan stage rows |
| Project edit (`PATCH /api/project-info/:id`, `/assign-pm`, `/projects-summary/*`) | `server/departments/project-routes.ts` (plus legacy in `server/routes.ts`) | project update logic + audit logging | `project_info` | `project_info`, potentially sync helpers | Canonical writer | `project_info` under `project_instance` boundary | Leave as-is Phase 1; dual-write later | Divergent master metadata, broken import reconciliation |
| Approvals queue/actions (`/api/approvals*`) | `server/routes/approvals-routes.ts`, `server/approvals-routes.ts` | direct SQL in route files | `project_stage_instances`, `project_stage_exceptions`, `handover_packs`, general approvals tables | same tables | Canonical + compatibility overlap | `approval_requirement`, `approval_instance` | Dual-read Phase 2; deprecate one route family later | Double-processing approvals, badge count drift |
| Gates workspace (`/api/gates/*`) | `server/routes/gates-routes.ts` | `getProjectsWithStageData()` + SQL | `project_info`, `project_execution_state`, `project_stage_instances`, `project_stage_exceptions`, `handover_packs` | exception/handover/gate status updates | Canonical aggregate | `project_instance`, `project_phase_history`, approval models | Adapter read Phase 1; dual-read/write later | Gate status inconsistency, false blockers/false clears |
| Lifecycle board + stage lifecycle (`/api/lifecycle-board/*`, phase endpoints) | `server/lifecycle-routes.ts`, `server/services/lifecycle-stage-gate-service.ts`, `server/services/project-lifecycle-workspace-service.ts` | lifecycle services + direct SQL | `project_info`, `project_execution_state`, `project_phase_history`, stage tables | same + audit | Canonical | `project_instance`, `project_phase_history` | Adapter read in Phase 1; dual-write in Phase 2 only for audited fields | Phase regression, invalid phase transitions |
| Stage data and engineering stage routes (`/api/projects/:projectId/eng-stages*`) | `server/eng-stage-routes.ts`, `server/engineering-routes.ts`, stage services | direct + service composition | engineering stage/task/deliverable tables + project tables | engineering stage/task/deliverable tables | Canonical (engineering) | `deliverable_definition`, `deliverable_instance` + stage history | Leave as-is Phase 1; adapter read Phase 2 | Engineering workflow breakage and missed deliverable gates |
| Finance and project finance (`/api/finance/*`, `/api/financial-*`) | `server/departments/finance-routes.ts`, `server/routes.ts`, finance libs | heavy SQL + calculators | `normalized_cost_lines`, `normalized_revenue_lines`, `project_info`, related finance tables | override tables + request tables | Canonical + derived aggregates | `finance_record` | Adapter read Phase 1; dual-read Phase 2; dual-write later for overrides only | Financial totals mismatch, executive reporting trust loss |
| Imports and sync-state (`/api/imports/*`, smart import routes) | `server/routes/imports.routes.ts`, `server/smart-import-routes.ts`, `server/services/imports-governance-service.ts` | import normalizer + governance service | `smart_import_runs`, import artifacts, normalized lines, project tables | import run/artifact tables + normalized lines | Canonical for Excel-mastered ingress | unchanged + mapped into `project_instance`/`finance_record` consumers | Leave as-is Phase 1; compatibility reads only | Import lineage corruption, unrecoverable provenance loss |
| Reporting routes (`/api/reports/*`, PM/Engineering monthly, performance) | `server/report-routes.ts`, `server/routes/*monthly*`, `server/routes/performance-routes.ts`, report services | report service layer + SQL | mixed: project, lifecycle, work, finance, quality | report metadata tables | Aggregate | reporting materialization over target models | Adapter read + dual-read before any source switch | KPI drift; board pack credibility failure |
| Legacy `projectName` routes (`/api/projects/:projectName/*`, project-plan routes) | `server/routes/working-plan-routes.ts`, `server/routes.ts`, legacy adapters | legacy name-keyed lookups | `project_info` by `project_name`, `work_items` and related | work plan/dependency/change tables | Compatibility-only | `project_instance.id` keys | Deprecate later; keep aliases active in Phase 1/2 | Broken deep links/bookmarks, automation failures |
| Route aliases/redirects still in use (legacy→new paths) | client routing + server compatibility handlers (`server/routes/route-registry.ts`, route wrappers) | redirect checks + fallback handlers | n/a | n/a | Compatibility-only | canonical route contracts | Leave as-is until final cutover | 404 spikes, support-ticket surge |

---

## C. Source-of-truth matrix

| Concept | Current writer of record | Current reader(s) of record | Target writer of record | Bridge strategy | Cutover prerequisite | Rollback target |
|---|---|---|---|---|---|---|
| Project identity | `project_info` mutations via project/template routes | project lists, lifecycle, gates, reports | `project_instance` + `project_info` | Phase 1 adapter-read only; Phase 2 dual-read | 14-day zero identity mismatch between legacy vs bridge | revert reads to `project_info` only |
| Project execution state | `project_execution_state` via lifecycle/gates flows | lifecycle board, gates, project detail | `project_instance.execution_state` projection | dual-read with diff logging | 99.95% parity on stage/status fields for 7 days | legacy `project_execution_state` |
| Lifecycle/stage status | lifecycle + stage services writing stage tables/history | lifecycle board, gates, approvals | `project_phase_history` + stage projection | adapter-read then selective dual-write | transition validator passes 100% for forbidden transitions | legacy stage tables + history |
| Work items | work-item services/routes to `work_items` | my-work, project plan, dashboards | `work_items` (unchanged canonical) | no writer move; only identity mapping bridge | none beyond id-mapping invariants | current `work_items` pathways |
| Approvals | approvals routes over stage/exception/handover/general tables | approvals queues, counts, gates, dashboards | `approval_requirement` + `approval_instance` | Phase 2 dual-read, then dual-write for new approvals | queue/count parity ≥ 99.9% for 14 days | current approvals tables/routes |
| Evidence/deliverables | engineering/collaboration/handover routes | engineering pages, gate readiness, reports | `deliverable_definition` + `deliverable_instance` + links | read-compat adapters first | evidence-link completeness ≥ 99.5% | legacy deliverable/evidence tables |
| Finance | import/finance routes writing normalized + override tables | finance workspace, lifecycle finance KPIs, reports | `finance_record` materialized contract | read bridge first, no writer switch early | amount parity within tolerance (see section G) | normalized lines + overrides |
| Party/contact data | counterparties/contacts + assignment services | procurement, assignments, handover | `party`, `party_role`, `contact_method`, `project_party_link` | map-on-read + ID registry | 0 unresolved assignee references over 7 daily runs | counterparties + contacts + assignments |
| Audit/activity history | audit logger/event services | admin/audit/reporting | same audit spine (append-only) | no ownership move early | immutable append check passes | current audit tables |
| Imports | smart import pipeline | imports dashboards + downstream consumers | imports remain ingress SoT | no writer move | governance checks stable for 2 cycles | current import pipeline |

---

## D. Field-level mapping for high-risk domains

### D1) `users` → `user_account` / `microsoft_identity` / `role_assignment`

| Source field | Target field | Transform rule | Null/default handling | Compatibility handling | Validation query | Rollback dependency |
|---|---|---|---|---|---|---|
| `users.id` | `user_account.legacy_user_id` | copy int | non-null required | keep as foreign reference in adapters | count-distinct parity by user id | requires legacy id retention |
| `users.email` | `user_account.primary_email` | lower/trim | null allowed only for service users | fallback to legacy email when target null | email uniqueness collision check | keep legacy auth lookup |
| `users.name` | `user_account.display_name` | trim | default `Unknown User` if blank | read fallback to legacy name | blank-name count should be 0 | legacy profile render path |
| `users.role` | `role_assignment.role_code` | 1:1 role map dictionary | unknown→`LEGACY_UNMAPPED` | preserve legacy role for auth checks in Phase 1 | unmapped role count must be 0 pre-cutover | legacy permission resolver |
| Microsoft/OAuth identifiers (from MS sync tables) | `microsoft_identity.ms_object_id` / tokens metadata | normalize GUID + tenant id | nullable for non-MS users | maintain existing MS fallback | identity link coverage query | legacy MS callback handlers |
| `users.isActive` | `user_account.status` | true→`ACTIVE`, false→`INACTIVE` | default `ACTIVE` if null | legacy boolean remains auth gate until cutover | active user parity check | legacy login enforcement |

### D2) `project_info` / `project_execution_state` → `project_instance` / `project_info` / `project_phase_history`

| Source field | Target field | Transform rule | Null/default handling | Compatibility handling | Validation query | Rollback dependency |
|---|---|---|---|---|---|---|
| `project_info.id` | `project_instance.legacy_project_info_id` | copy int | non-null | keep old id exposed in API for compat | id coverage count = 100% | legacy route params by id |
| `project_info.project_name` | `project_instance.project_code` + `project_info.project_name` | canonicalize spacing/case-preserving label | reject blank | continue resolving by projectName alias | duplicate-name detector returns 0 | legacy `:projectName` routes |
| `project_execution_state.current_stage_code` | `project_instance.current_stage_code` | copy enum with guard | null→`UNASSIGNED` | fallback to legacy stage | stage enum mismatch query | lifecycle board legacy reads |
| `project_execution_state.execution_phase` | `project_phase_history.phase_code` (latest) | append latest phase event | null keeps previous phase | legacy phase field still read primary in Phase 1 | latest-phase parity query | legacy phase transitions |
| `project_execution_state.gate_status` | `project_instance.gate_status` | normalize enum values | null→`UNKNOWN` | fallback to legacy gate status | gate status parity query | gates workspace legacy query |
| `project_info.pm` / `pd` | `project_party_link` rows (role PM/PD) | resolve user IDs by email/name mapping | unresolved→`UNRESOLVED_REF` table | continue text fallback fields | unresolved assignments must be 0 before cutover | legacy text owner fields |

### D3) approvals family → `approval_requirement` / `approval_instance`

| Source field | Target field | Transform rule | Null/default handling | Compatibility handling | Validation query | Rollback dependency |
|---|---|---|---|---|---|---|
| `project_stage_instances.approver_user_id` | `approval_requirement.required_approver_user_id` | copy | nullable allowed by policy | legacy approver column remains source in Phase 1 | non-null approver parity check | stage instance table unchanged |
| `project_stage_instances.stage_status` approval states | `approval_instance.status` | map READY/APPROVED/BLOCKED | unknown→`PENDING` | dual-read status compare | status distribution parity | legacy queue endpoints |
| `project_stage_exceptions.reason_text` | `approval_requirement.reason` | trim + 8k max | null→empty string | keep legacy reason in response | long-text truncation audit query | legacy exception workflows |
| `handover_packs.checklist_status` | `approval_instance.status` | map pending_review/complete/rejected | null→`PENDING` | maintain handover-specific API fields | handover status parity | handover routes |

### D4) deliverables/evidence family → `deliverable_definition` / `deliverable_instance` / `resource_link` / `deliverable_evidence_link`

| Source field | Target field | Transform rule | Null/default handling | Compatibility handling | Validation query | Rollback dependency |
|---|---|---|---|---|---|---|
| engineering deliverable template keys | `deliverable_definition.definition_code` | stable slug | non-null required | keep old template key in metadata | duplicate definition code = 0 | engineering template loaders |
| per-project deliverable rows | `deliverable_instance` | 1 row per project+definition | missing project→reject row | fallback to legacy deliverable list | instance count parity by project | legacy engineering deliverables |
| evidence document/link fields | `resource_link.url` / `resource_link.storage_key` | normalize URL/storage refs | null allowed when pending | expose both legacy/new link ids | orphan resource links = 0 | legacy evidence storage |
| deliverable↔evidence relation | `deliverable_evidence_link` | bridge table insert | no evidence→no link | compatibility join on legacy ids | required evidence coverage ≥99.5% | legacy evidence join logic |

### D5) finance family → `finance_record`

| Source field | Target field | Transform rule | Null/default handling | Compatibility handling | Validation query | Rollback dependency |
|---|---|---|---|---|---|---|
| `normalized_cost_lines.amount_ex_vat` | `finance_record.amount_ex_vat` | numeric(18,2) cast | null→0 only for non-financial placeholders | keep placeholder exclusion rules | sum parity by project/month | normalized cost lines |
| `normalized_revenue_lines.amount_ex_vat` | `finance_record.amount_ex_vat` (type=REVENUE) | numeric cast + type flag | null→0 with warning row | dual-read totals in finance endpoints | revenue total parity | normalized revenue lines |
| `project_name` + `project_id` refs | `finance_record.project_instance_id` | resolve by id first, then name | unresolved→quarantine rows | legacy projectName still emitted in API | unresolved finance refs must be 0 | name-based reporting routes |
| due/paid date fields | `finance_record.due_date` / `settled_date` | ISO date normalize | invalid→null + quality flag | keep legacy raw fields for audit | invalid-date rate <0.1% | current calculators |

### D6) party-related tables → `party` / `party_role` / `contact_method` / `project_party_link`

| Source field | Target field | Transform rule | Null/default handling | Compatibility handling | Validation query | Rollback dependency |
|---|---|---|---|---|---|---|
| `counterparties.id` | `party.legacy_counterparty_id` | copy | non-null | maintain legacy FK outward | id coverage 100% | procurement routes |
| `counterparties.name_canonical` | `party.legal_name` | trim/canonical case | blank rejected | fallback name from legacy for UI | blank legal_name must be 0 | legacy counterparty CRUD |
| `counterparties.type_default` | `party_role.role_type` | enum map | unknown→`OTHER` | keep old type for filters | role map mismatch <0.1% | legacy type filters |
| `counterparty_contacts.*` | `contact_method` | split email/phone/name | missing contact value→skip record | retain old contact id refs | contact count parity by party | assignment service lookups |
| project-counterparty assignment tables | `project_party_link` | map project+party+role | null project/party→reject | keep old assignment APIs | unresolved assignment links = 0 | current assignment endpoints |

---

## E. File-level implementation plan

### Phase 1 (safe: no writer ownership change)

| File | Why it would change | Change type | Phase | Feature-flagged | Test coverage | Rollback |
|---|---|---|---|---|---|---|
| `server/services/promoted-read-compat.ts` | centralize adapter-read comparators | additive service logic | Phase 1 | Yes | `qa/tests/unit/source-of-truth-policy.test.ts`, `qa/tests/unit/route-migration.test.ts` | disable flags + revert service import |
| `server/departments/project-routes.ts` | add optional bridge read path + diff logging | non-breaking read branch | Phase 1 | Yes | `qa/tests/unit/project-lifecycle-workspace-service.test.ts`, `qa/tests/unit/project-header-kpi-service.test.ts` | flag off |
| `server/routes/gates-routes.ts` | adapter-read projections for gate data comparisons | non-breaking read branch | Phase 1 | Yes | `qa/tests/unit/lifecycle-stage-gate-engine.test.ts`, `qa/tests/api/workflow-critical-pack.test.ts` | flag off |
| `server/routes/approvals-routes.ts` and `server/approvals-routes.ts` | reconcile overlapping approval queues | observability + parity logs only | Phase 1 | Yes | `qa/tests/api/engineering-deliverables.test.ts` + approvals regression pack | flag off, keep existing response contract |
| `server/lifecycle-routes.ts` | add reconciliation instrumentation around lifecycle reads | instrumentation only | Phase 1 | Yes | `qa/tests/unit/project-lifecycle-workspace.test.ts`, `qa/tests/unit/financial-review-stage-sync.test.ts` | remove instrumentation branch |
| `server/departments/finance-routes.ts` | parallel-read finance totals for diagnostics | read-only parity hooks | Phase 1 | Yes | `qa/tests/unit/revenue-matching-reconciliation.test.ts`, `qa/tests/api/finance-workspace-trust.test.ts` | flag off |
| `server/services/imports-governance-service.ts` | expose cutover blocking signals | governance checks | Phase 1 | Yes | `qa/tests/unit/frontend-smartimport-parity.test.ts` | flag off |
| `shared/feature-flags.ts` | declare new migration control flags | config-only | Phase 1 | n/a | `qa/tests/unit/rollout-gate.test.ts` | revert flag constants |

### Phase 2 (controlled bridge activation)

| File | Why it would change | Change type | Phase | Feature-flagged | Test coverage | Rollback |
|---|---|---|---|---|---|---|
| `server/services/work-item-conversion-service.ts` | project identity remap support | bridge conversion logic | Phase 2 | Yes | `qa/tests/unit/work-item-conversion-service.test.ts`, `qa/tests/unit/work-items-adapter.test.ts` | disable remap flag |
| `server/services/project-lifecycle-workspace-service.ts` | consume `project_instance` bridge model | read/write bridge | Phase 2 | Yes | lifecycle workspace tests | flag off + legacy workspace builder |
| `server/services/approval-service.ts` | dual-write `approval_instance` after parity | additive write branch | Phase 2 | Yes | approvals integration suite | disable dual-write flag |
| `server/report-routes.ts` + monthly report services | switch report data source to dual-read model | aggregate source switch | Phase 2 | Yes | reporting API tests + KPI tests | fallback to legacy query path |
| `server/services/company-overview-service.ts` | company metrics source alignment | read model switch | Phase 2 | Yes | `qa/tests/unit/dashboard-metrics-access.test.ts` | flag off |
| `server/routes/auth-routes.ts` + `server/auth-context.ts` (late Phase 2 only) | identity abstraction for `user_account` | auth read bridge only | Phase 2 (late) | Yes | `qa/tests/api/auth-routes.test.ts`, csrf/jwt tests | immediate flag-off and legacy lookup |

---

## F. Feature flag spec

| Flag name | Purpose | Default | Owner | Scope | Kill-switch effect | Dependencies | Safe enable/disable verification |
|---|---|---|---|---|---|---|---|
| `migration_bridge_project_read_v1` | enable project adapter-read with diff capture | false | Backend Platform | project read endpoints | instantly reverts all project reads to legacy-only | none | run project list/detail parity query + smoke endpoints pre/post toggle |
| `migration_bridge_lifecycle_read_v1` | lifecycle/gates dual-read comparisons | false | PM Platform | lifecycle + gates routes | disables bridge computations and uses legacy stage data only | project read bridge optional | verify gate counts and stage distributions unchanged within ±0.1% |
| `migration_bridge_approvals_dual_read_v1` | compare legacy vs bridge approval queues | false | Governance Platform | approvals routes | bridge queue removed; legacy queue authoritative | lifecycle read bridge recommended | compare `/api/approvals` counts exact match for 3 consecutive runs |
| `migration_bridge_finance_read_v1` | finance dual-read and reconciliation telemetry | false | Finance Platform | finance/reporting reads | disables bridge totals and diagnostics | project identity bridge | verify sum deltas under thresholds in section G |
| `migration_bridge_party_read_v1` | map counterparties/contacts to party abstraction on read | false | Procurement Platform | assignment/procurement read surfaces | legacy counterparty path only | project identity bridge | verify assignment resolution success rate 100% on sampled workload |
| `migration_bridge_deliverables_read_v1` | evidence/deliverable compatibility read path | false | Engineering Platform | engineering/handover evidence reads | revert to legacy deliverable/evidence joins | lifecycle read bridge optional | verify deliverable counts per project exact match |
| `migration_bridge_approvals_dual_write_v1` | mirrored write into `approval_instance` | false | Governance Platform | approvals mutations | stops mirrored writes immediately; legacy writes continue | approvals dual-read parity green for 14 days | confirm no 5xx; legacy action success remains 100% |
| `migration_bridge_project_dual_write_v1` | mirrored writes for project master fields | false | Backend Platform | project edit/create writes | disables mirror writes; legacy-only writes remain | project read bridge + reconciliation jobs | compare write success and no duplicate target keys |

---

## G. Parity and reconciliation spec

### G1) Project identity bridge
- **Check SQL logic**: compare legacy project rows to bridge projection by `legacy_project_info_id`; assert exact match for `project_name`, `client_name`, `pm`, `pd`, `current_stage_code`, `gate_status`.
- **Threshold**: `mismatch_rate <= 0.05%` per run and `0 critical mismatches` (null/duplicate IDs).
- **Frequency**: every 30 minutes (automated), plus pre-release manual run.
- **Rollout blocker**: Backend Platform on-call + release manager; any critical mismatch blocks Phase 2 enable.

### G2) Approvals bridge
- **Check logic**: for each approval type (gate/exception/handover/general), compare queue counts and terminal statuses across legacy source vs `approval_instance`.
- **Threshold**: count delta must be `0`; status distribution delta per type `<= 0.1%`; stale items (>15m replication lag) `<= 10` globally.
- **Frequency**: every 15 minutes.
- **Rollout blocker**: Governance owner; any count delta >0 in two consecutive runs blocks dual-write rollout.

### G3) Lifecycle/stage parity
- **Check logic**: compare lifecycle board dataset fields (`phase`, `stage`, `gate_status`, `rag_status`, `is_active`) by project id.
- **Threshold**: exact match on phase/stage/gate; `rag_status` mismatch `<= 0.2%`.
- **Frequency**: hourly.
- **Rollout blocker**: PM Platform lead; any phase/stage mismatch blocks.

### G4) Finance parity
- **Check logic**: aggregate per project + fiscal month revenue/cost/open AR/AP from legacy normalized tables vs `finance_record` projection.
- **Threshold**: absolute delta per project-month `<= 0.50` currency units; portfolio-level relative delta `<= 0.05%`; unresolved project mappings `0`.
- **Frequency**: hourly + end-of-day signed report.
- **Rollout blocker**: CFO delegate + Finance Platform lead; any threshold breach in two consecutive runs blocks finance bridge enable.

### G5) Deliverable/evidence parity
- **Check logic**: per project, compare required deliverables, submitted evidence count, and missing-required count.
- **Threshold**: required deliverables exact match; evidence-link completeness `>= 99.5%`; missing-required delta `0`.
- **Frequency**: every 4 hours.
- **Rollout blocker**: Engineering manager; any required-count mismatch blocks.

### G6) Party/contact parity
- **Check logic**: compare resolvable assignee targets and contact lookups between legacy counterparties/contacts and party abstraction.
- **Threshold**: resolution success `100%` for active assignments; contact retrieval match `>= 99.9%`.
- **Frequency**: daily.
- **Rollout blocker**: Procurement owner; any unresolved active assignment blocks.

---

## H. Do-not-touch list for Phase 1 and Phase 2

### Phase 1 do-not-touch (strict)
- **Tables**: session/auth token storage, raw import artifact tables, normalized line raw lineage columns, audit append tables.
- **Routes/handlers**: `/api/auth/*` mutation semantics, Microsoft callback/exchange routes, smart-import write pipeline, destructive lifecycle endpoints (`merge`, `delete`, `restore`) behavior.
- **Imports**: normalizer parser logic and raw-row lineage keys.
- **Auth logic**: token revocation/version semantics, session limit enforcement internals.
- **UI sections**: login/session surfaces, admin destructive actions, import upload wizard.

### Phase 2 do-not-touch (until final cutover window)
- **Tables**: legacy approval tables remain writable until dual-write stable for 14 days; legacy `project_info` remains primary writer until project dual-write proven.
- **Routes/handlers**: legacy `:projectName` routes and redirects must stay active; `/api/approvals` existing response shape must not change; finance export contracts must remain unchanged.
- **Imports**: no direct target-table writes bypassing import governance.
- **Auth logic**: no full auth source switch in early Phase 2.
- **UI sections**: no route removal for legacy bookmarks/navigation aliases.

---

## I. Product-owner decisions required

Only unresolved decisions requiring Johannes before implementation:

1. **HSE placement (org ownership + nav authority)**
   - Decide whether HSE remains under Quality-owned governance or moves to standalone HSE domain.
   - Required for lifecycle gate ownership, approvals routing, and reporting dimensions.

2. **Priorities placement**
   - Confirm if project priorities are owned by PM/project domain or Strategy/Executive domain.
   - Required to decide canonical writer and avoid dual-owner conflicts.

3. **Department ownership conflicts (explicit tie-breaks)**
   - Approvals ownership split across PM/Engineering/Handover governance.
   - Party/contact ownership split across Procurement vs PM assignment workflows.
   - Must assign one domain owner per concept for cutover authority.

4. **Specialized-domain placement**
   - Final placement for SSEG/regulatory/authority-tracking data (Engineering vs dedicated compliance domain).
   - Determines target table namespace and route ownership.

5. **Legacy `projectName` deprecation policy**
   - Decide hard date for deprecation window start and minimum support period (recommended: 2 releases + 60 days).

6. **Cutover governance authority**
   - Confirm who can approve/abort each domain cutover (Backend lead, CFO delegate, PM lead, Engineering lead).

---

## J. Exact implementation prompt for the next step

Use this exact prompt in the implementation turn:

> Implement **Phase 1 only** from `docs/pre-implementation-migration-control-spec.md`.
> 
> Constraints:
> - No schema migrations.
> - No destructive route removals.
> - No auth/session behavior changes.
> - No import parser/lineage changes.
> - Keep all legacy `projectName` routes and aliases intact.
> 
> Required work:
> 1. Add feature flags from Section F into `shared/feature-flags.ts` and wire server-side checks.
> 2. Add adapter-read + parity logging only for:
>    - project reads,
>    - lifecycle/gates reads,
>    - approvals dual-read diagnostics,
>    - finance dual-read diagnostics,
>    - deliverables read diagnostics,
>    - party/contact read diagnostics.
> 3. Add reconciliation jobs/check endpoints exactly as defined in Section G thresholds/frequency.
> 4. Keep all writes authoritative on current legacy tables.
> 5. Add/extend tests listed in Section E so Phase 1 changes are covered.
> 
> Definition of done:
> - All new behaviors are feature-flagged default OFF.
> - Existing endpoint response contracts unchanged when flags OFF.
> - Reconciliation output clearly indicates pass/fail vs thresholds.
> - No regressions in auth, import, approvals, lifecycle, finance, and reporting baseline tests.


---

## K. Phase 1A implementation notes (2026-04-02 update)

### Controlled exception: `server/routes.ts`
- **Exception scope:** `server/routes.ts` includes minimal diagnostics-only reads for project parity instrumentation.
- **Why exception is allowed:** project list/detail routes remain legacy-authoritative while exposing additive reconciliation metadata behind Section F bridge flags.
- **Safety controls:** no schema changes, no write-authority changes, no scheduler/background jobs, and immediate rollback via feature-flag disable.

### Instrumentation coverage status by requested Phase 1A domain

| Domain | Status | Implementation level |
|---|---|---|
| Project identity bridge (G1) | **Fully instrumented** | Manual-run reconciliation endpoint computes threshold pass/fail (mismatch-rate + critical mismatch rules). |
| Lifecycle/stage parity (G3) | **Admin reconciliation summary** | Summary-level parity metrics and threshold evaluation only; no bridge writes. |
| Approvals bridge (G2) | **Admin reconciliation summary** | Summary-level queue/status threshold evaluation only; no bridge writes. |
| Finance parity (G4) | **Admin reconciliation summary** | Summary-level count/relative-delta threshold evaluation only; no bridge writes. |
| Deliverable/evidence parity (G5) | **Admin reconciliation summary** | Summary-level required/evidence completeness threshold evaluation only; no bridge writes. |
| Party/contact parity (G6) | **Admin reconciliation summary** | Summary-level resolution/match threshold evaluation only; no bridge writes. |

