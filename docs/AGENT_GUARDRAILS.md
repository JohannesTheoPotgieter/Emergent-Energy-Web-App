# AGENT_GUARDRAILS.md — Emergent Energy Web App
**Owner:** Johannes Theo Potgieter (COO)
**Repo:** `JohannesTheoPotgieter/Emergent-Energy-Web-App`
**Last verified:** 2026-05-07
**Status:** Layer 1 canonical guardrails. Source of truth for all AI coding agents (Claude Code, Codex, Replit Agent) operating against this repo.
---
## 0. How to use this file
This is the single document every AI agent must read **before** doing work in this repo. Tool-specific files (`CLAUDE.md`, `AGENTS.md`, `replit.md`) reference this file and contain only IDE-specific operational guidance (commands, hooks, slash commands). Everything substantive — business invariants, security boundaries, architectural rules, the Do NOT list — lives here.
If a tool-specific file disagrees with this one, **this file wins** unless the disagreement is about facts that live in the live code (see Precedence below).
The codebase exists to implement the **C&I Solar Delivery Playbook v2.0**, the company operating model. The playbook is committed at `docs/operating-model/playbook-v2.0.md`. The playbook outranks every technical document for business rules. If a code change appears to require redefining a stage, gate, or handover from the playbook, **stop and ask the owner**.
---
## 0A. The Override Principle — read before everything else
> **The app is there for recording and evidence. It should never be a blocker. Always allow the correct people to edit or override with a reason.**
This is the operating philosophy of the entire system. Every rule in this document, every gate in the playbook, every workflow constraint in the schema — all of them are **records and guardrails**, not walls. The app keeps the record; the right people still make the calls.
**Rules in this file fall into exactly two categories:**
1. **Hard rules — the app must refuse.** Reserved for security and data-corruption / financial-formula integrity. These are the only things the app blocks. They are listed explicitly in § 5A and § 8 ("Hard refusals"). An agent encountering one stops and reports — no override path.
2. **Soft rules — the app records, the right person can override.** Everything else. The app's role is to make the default path easy, surface the rule when someone deviates, capture role + reason + audit, and proceed. An agent encountering a soft rule **flags it to the user with the rule and the override path**, and proceeds when the user authorises with a reason.
**Override mechanics — every soft rule gets the same shape:**
- **Authoriser:** the role allowed to override (typically COO, CFO, Head of Engineering, or Programme Manager — see playbook for the matrix). RBAC enforced in the route layer.
- **Reason:** free-text justification, mandatory, captured against the action.
- **Audit:** entry in `audit_events` (or domain-specific audit log) with actor, role at time of action, rule overridden, reason, timestamp.
- **Surfacing:** overrides remain visible in the relevant view — never hidden, never silently applied.
**Existing infrastructure** (use this; do not invent parallel patterns): `stage_gate_overrides`, `pending_approvals`, the `approvals` engine, `audit_events`, `merge_audit_log`, `stage_gate_definitions`, `project_gate_evaluations`, `executionGateLog`. New override surfaces follow these shapes.
**For the AI agent specifically:** when asked to violate a soft rule, the agent does not silently refuse. It states the rule, names the override path, and asks the user to authorise with a reason. The user's reply (in-session) is the audit-bearing override. When asked to violate a hard rule, the agent refuses and explains why.
---
## 1. Precedence — when sources disagree
When you find conflicting information, resolve in this order:
1. **Live code** — `shared/schema/*.ts`, `server/repositories/*`, `server/middleware/*`, route registry. Wins for *facts* (role list, table list, types, file paths, function signatures, command scripts in `package.json`).
2. **`docs/operating-model/playbook-v2.0.md`** (C&I Solar Delivery Playbook) — wins for *business rules* (lifecycle stages, gate criteria, handover artefacts, the Six Rules, Hold/Blocked semantics, regulatory ownership). Code that contradicts the playbook is a defect, even if it compiles.
3. **This file (`AGENT_GUARDRAILS.md`)** — wins for *technical rules and how playbook rules are enforced in code* (security boundaries, Do NOT list, governance, precedence itself).
4. **`docs/architecture.md`** — wins for *system structure* (canonical spine tables, `/api/platform/*` contracts, extension guardrails for new capabilities).
5. **Tool-specific agent files** (`CLAUDE.md`, `AGENTS.md`, `replit.md`) — win only for *tool-specific operational guidance* (commands, hooks, IDE behaviour, plan-mode usage). Anything substantive in these files must reference this document.
6. **Other docs** (`docs/claude-code-mastery-guide.md`, `docs/smart-import-v2-spec.md`, READMEs, comments) — non-binding reference and onboarding aids only.
If you cannot resolve a disagreement using this hierarchy, **stop and ask the user** before writing code.
---
## 2. Communication style — for all agents
Use simple, everyday language. Concrete over abstract. State conclusions and trade-offs first, supporting detail second. Avoid filler. Match the user's level — assume technical literacy but not memorisation of every file path.
This applies to Claude Code, Codex, and Replit Agent equally.
---
## 2A. The Six Rules — operating model invariants
Verbatim from the C&I Solar Delivery Playbook v2.0. These are **soft rules with the override pattern** — the app's job is to make the default path easy, record deviations, and surface them. The right person + a reason + audit can override any of these.
1. **The project is the spine.** Every artefact, transaction, and decision is anchored to the project record (`projectInfo.id`). *Override:* Programme Manager / COO can re-link or unlink with a reason captured in `audit_events`.
2. **SharePoint is the document source of truth.** If it is not in the project SharePoint folder, it does not exist. The app holds metadata + Graph references (`driveId` / `driveItemId`) — never file bodies. *Override:* document-control admin can manually attach an external link with reason; **storing file bodies in the DB stays HARD-banned (see § 5A)** — that's data corruption / privacy, not a workflow rule.
3. **Excel, QuickBooks, the app, and Pipedrive must reconcile.** Numbers that disagree across systems are a defect, not a quirk. *Override:* COO / CFO can accept a documented variance with reason; the app records the variance and continues.
4. **App stages and permissions match the real lifecycle.** The canonical lifecycle lives in `shared/phases.ts` and is locked to the playbook's stages. *Override:* COO / Head of Engineering can authorise a manual phase correction with reason captured against `project_phase_history`.
5. **No stage movement without evidence.** Gates are signed, not assumed. *Override:* COO / Programme Manager can advance a project past an unmet gate via `stage_gate_overrides` with reason; the gate remains visible as overridden, not hidden.
6. **Handovers are signed, not assumed.** PD-to-PM, PM-to-O&M, EPC-to-Client, EPC-to-Compliance are formal events with named owners and accepted artefacts. *Override:* COO can authorise a deferred handover with reason; the handover record carries the override flag.
**Agent behaviour:** if asked to violate any of these, the agent flags the rule, names the override authority, and asks the user to authorise with a reason. The user's in-session authorisation is the audit-bearing override.
---
## 3. Financial-formula integrity — HARD rules
These are not workflow rules — they are math rules. Violating any of these produces wrong numbers, not a policy choice. **No override path. Hard refusal.** They must be respected in code regardless of who asks. They override every soft rule and every override authority.
### 3.1 Snapshot-table guard — `effectiveTo IS NULL`
Every read query against a snapshot table MUST include `isNull(table.effectiveTo)` (Drizzle) or `effective_to IS NULL` (raw SQL). Omitting the guard double-counts historical snapshot rows and produces wrong totals.
Snapshot tables today: `normalizedCostLines`, `normalizedRevenueLines`, `cashflowPoints`, `financeRevenueMonthly`, `financeCosMonthly`, `categoryRevenueAllocations`, `projectRevenueSummary`.
Verify the live list with `grep -rln "effective_to" shared/schema/` before aggregate work. The list grows when new temporal tables ship.
### 3.2 COS realisation formula
**A COS line is realised when BOTH conditions are true: (a) an invoice is captured against the line, AND (b) the invoice-date cell colour on the workbook line is BLACK.** Black is the canonical confirmed-actual signal. Either condition alone is not enough. No projection, no snapshot, no other override realises COS. This is the formula, not a workflow rule. Code that realises COS from any other source — including invoice capture without the black-colour gate — is wrong.
The canonical predicate is `isCanonicalCosRealised()` in `server/lib/finance/cos-realisation.ts`. All read paths must go through it. The colour is the signal at import; the app stores the derived realised flag against the actual-date row (see § 3.7).
If a user wants to record an expected cost, that's a *projection*, a *budget line*, or a *forecast* — different fields, different reports. Never a realised COS.
### 3.3 Revenue realisation formula
**Revenue realisation is derived from realised COS via the cost-to-cost percentage-of-completion method.** Per line item:
```
revenueRealised_line = (actualCOS_line / totalCOScosted_project) × totalRevenueCosted_project
```
Where:
- `actualCOS_line` — the realised COS amount on the line per § 3.2 (zero if the line is not realised under the black-colour + invoice rule).
- `totalCOScosted_project` — the project's total budgeted/costed COS (sum across all costed cost lines).
- `totalRevenueCosted_project` — the project's total budgeted/costed revenue.
Aggregated to the project: `Σ revenueRealised_line` across all lines (unrealised lines contribute zero because `actualCOS_line` is zero).
Revenue is **not** realised on payment receipt date, invoice date, contract date, or milestone completion. Those drive *expected* revenue, *forecast* revenue, *cash inflow* (§ 3.4), or *workflow gates* — never the realisation figure. Code that triggers revenue realisation from any signal other than the COS-ratio formula above is wrong.
**Inflow ≠ revenue.** Cash inflow (§ 3.4) reads payment receipt date — that is correct for cash, not for revenue realisation. The two surfaces must not be conflated in any KPI tile, dashboard, or report.
### 3.4 Inflows and outflows formulas
Cashflow is **cash**, not revenue (see § 3.3 — they are different surfaces and must not be conflated). The cashflow point series (`cashflowPoints`) and inflow/outflow projections must be derived from the canonical sources only:
- **Inflows:** payment receipts (realised — driven by receipt date) + scheduled receipts (forecast). Never derived from invoices in isolation. This is the receipt-date rule for *cash*, not for revenue.
- **Outflows:** captured supplier invoices realised under § 3.2 (invoice captured + black-colour invoice date) + committed POs without invoices yet (forecast) + payroll-pattern outflows (forecast).
- **Cashflow ramp / variance / scenario calculations** read from the snapshot tables in § 3.1 and must apply the snapshot guard.
Any new dashboard, report, or KPI touching inflows/outflows/cashflow must use these definitions. Inventing a parallel definition because it's "easier for this view" produces numbers that disagree with QuickBooks and breaks Six Rule #3 (cross-system reconciliation) — except here it's data corruption, not a workflow violation, so there's no override path.
### 3.5 Smart Import line-ID stability
`expense_line_id` and `inflow_line_id` are hash-based and must be stable across re-imports. Changing the hash inputs orphans every existing override. See § 9 for the engine-level rules.
### 3.6 Smart Import field-level snapshot fallback
Both planner (`loadBaselineFromSnapshots`) and writer (`mergeRow`) must skip null/undefined values inside `importSnapshot` and fall back at the field level. See § 9.
### 3.7 Planned vs actual dates on import
The program plan in the Excel workbook carries **both planned and actual dates** for each milestone, payment, receipt, and cost line. The import rule:
- **App-side actuals fields receive ACTUAL dates only.** Planned dates do not flow into the app's actuals. If the actual is blank, the actual stays blank — the app does not fall back to planned.
- **Planned dates are preserved in the Excel replica view only.** The replica is read-back / visual comparison surface; it is not a second source of truth for app data.
- **Realisation calculations (§ 3.2 COS, § 3.3 Revenue, § 3.4 Cashflow) read actuals.** Reading planned dates for any realisation calculation is wrong — same class of error as reading the wrong column.
Why this is HARD: pulling planned dates into the actuals fields silently shifts the entire project state. Wrong stage, wrong gates, wrong cashflow. The app's read-back to the user becomes an unverifiable mirror of "what was planned" rather than "what happened". This is data corruption, not a workflow choice.
**Realisation signal — date colour:** in the Excel program plan, specific cell colours mark a date as *payment confirmed* or *revenue realised*. The import reads colour as the canonical realisation signal; the app stores the derived realised flag against the actual date row. Loss of colour fidelity during import (or during any future re-import / round-trip) is a hard regression — the realisation signal must survive the round-trip.
**Open challenge to be resolved by owner:** date colour is a fragile signal (lost on copy/paste, lost on PDF export, lost across Excel versions). The current rule is "colour is canonical at import time" — but once imported, the app should store the realisation as a derived `realised: bool` + `realisation_method: 'colour' | 'manual' | …` so the app never depends on colour after the import boundary. **Confirm with owner before any agent extends colour-handling code.**
---
## 3A. Business-workflow invariants — SOFT rules with override paths
These are operationally important but they are *workflow* rules, not math. The right person + reason + audit can override. The app records the override; it does not refuse.
1. **No approval bypass without a corresponding `audit_events` entry.** This is the override pattern itself — it does not block; it records. Code that bypasses approval without writing audit is wrong because it loses the record, not because the bypass itself is forbidden. *Override:* not applicable — this rule *is* the override pattern.
2. **The PD → PM handover gate must be explicitly approved before lifecycle advances.** *Override:* COO / Programme Manager via `stage_gate_overrides` with reason; the gate remains visible as overridden.
3. **Stage advancement requires evidence at the gate.** *Override:* same as above.
4. **Hold/Blocked status requires the six fields** (reason, owner, review date, dependency, decision owner, evidence link). *Override:* COO / Programme Manager can record a hold without all six, with reason for the missing fields, captured in audit.
**Do not redefine** the underlying terms (project stages, COS, revenue, cash flow, invoice, PO, handover) without explicit written instruction from the owner. Redefinition is a playbook change, not an app change.
---
## 4. Architectural invariants — the canonical spine
From `docs/architecture.md`. When adding new capabilities, attach to these existing structures rather than creating parallel ones:
- **`project_info`** — canonical project identity. Every new record that belongs to a project must FK to `project_info.id`.
- **`work_items`** — cross-functional work tracking. Writes go directly to `public.work_items` via Drizzle (the writable-view architecture was retired; do not extend `server/work-items-adapter.ts` or `server/work-items-backfill.ts`).
- **`entity_assignments` / `work_item_assignments`** — assignments. Do not introduce a new `*_assignments` table without owner approval.
- **`approvals`** — approval workflows.
- **`deliverables`** — deliverables.
- **`audit_events`** — auditable mutation history. Major state transitions emit audit events.
- **`/api/platform/*`** — stable cross-module summary contracts. Prefer these over page-specific joins for cross-module reads.
**Extension rules when adding capabilities:**
1. Attach records to canonical project identity (`project_info.id`).
2. Reuse canonical workflow tables before introducing new structures.
3. Enforce authorization on backend routes (never client-side only).
4. Emit audit events for major state transitions.
5. Keep lifecycle/state normalization aligned to shared mappings (`shared/phases.ts`).
---
## 4A. Hold / Blocked is a STATUS, not a stage
Per the playbook: *"If a project is waiting on the municipality, the meter, the client, or a supplier, it remains in its current lifecycle stage and is flagged 'On Hold' or 'Blocked'."* Hold and Blocked are project statuses orthogonal to the lifecycle phase, not new lifecycle phases.
**Implementation today:**
- `project_status` enum on `projectInfo` carries `'active' | 'hold' | 'internal' | 'closed' | 'tbc'`.
- `S_HOLD` and `S_DONE` exist in `shared/phases.ts` as **terminal branch phases** so the lifecycle UI can render Hold/Done buckets next to the sequential board. They are `isSequential: false, isTerminal: true` and do NOT participate in next/prev/stage-advance logic.
- Both representations exist for UX rendering convenience. **The playbook rule still applies:** Hold is operationally a status, not a stage. The current sequential phase is preserved on the project so it can resume from where it left off.
**Required fields when a project moves to Hold or Blocked status (per playbook):**
reason · owner · review date · dependency · decision owner · evidence link.
A project may not advance lifecycle stage while on Hold or Blocked. The stage continues to own the project until the blocker clears. If a hold persists beyond a defined trigger (e.g., 30 days for municipal meter; varies by case), the PM escalates to the Programme Manager and the COO.
**Default rules for agents (soft — override path exists):**
- 🚫 **Default: do not** add new "branch" stage codes (e.g. `S_BLOCKED`, `S_WAITING`, `S_ESCROW`). Hold/Done are the only terminal phases today. Blocked is captured via project status + required-field metadata. *Override:* COO authorises a new branch code in-session with reason; the schema change still requires migration + owner sign-off.
- 🚫 **Default: do not** add a sequential phase that represents "waiting for X" (e.g. "Awaiting Approval"). The waiting condition is a status against the existing phase. *Override:* same as above — playbook owner authorises a new sequential phase before any code change.
- 🚫 **Default: do not** allow `nextPhase` / `prevPhase` to operate on `S_HOLD` / `S_DONE`. *Override:* COO can authorise a manual phase correction via `project_phase_history` with reason — bypassing `nextPhase` logic, not extending it.
- ✅ Any feature that surfaces "what's blocked" reads the status + required fields, not a parallel "blockers" model.
- ✅ Resume-from-hold restores the previous sequential phase. *Override:* COO can restore to a different phase with reason.
**Why these are soft, not hard:** these are schema and workflow choices the right person can revisit. Hard rules in this file are reserved for security and financial-formula integrity (§ 5A, § 3).
---
## 4B. Stakeholder communications must link to a project
Per playbook Six Rule #1 ("the project is the spine") and the user's locked rule: *"Always keep all history but under its phase."* Every customer or stakeholder communication that the app ingests, displays, or routes must be traceable to a `projectInfo.id` and must record the lifecycle phase at link time.
**Implementation today:**
- `email_project_links` and `teams_project_links` tables already enforce this pattern. **Use these. Do not invent parallel comms-storage tables.**
- Both store **metadata only** — `graphMessageId` / `graphConversationId` (Outlook), `graphChannelId` / `graphThreadId` (Teams). Bodies are fetched live from Graph at render time. Storing email bodies or attachment bytes in the DB is a hard fail.
- Both record `phaseAtLinkTime` — a snapshot of the project's lifecycle phase the moment the link is created. **This field is load-bearing.** It is the implementation of the rule "always keep all history but under its phase". An email captured during First Assessment stays grouped under First Assessment in any future view, even after the project has moved to Construction.
- Link `signal` enum (`client_domain`, `client_contact`, `subject_tag`, `thread_inheritance`, `pipedrive`, `manual`) drives trust scoring. Signals other than `manual` may need human confirmation before they surface in client-facing views.
**Mixed rules — most soft, two HARD:**
- ❌ **HARD (§ 5A):** Do NOT store email bodies, attachment bytes, message contents, or transcripts in the DB. Always Graph-fetch live. *No override path* — this is data-corruption / privacy, not workflow.
- ❌ **HARD (§ 5A):** Do NOT mutate `phaseAtLinkTime` after creation. It's a historical snapshot. *No override path* — mutating it corrupts the historical record.
- 🚫 **Default: do not** create a new comms / messages / activity / mentions table without `projectId` and `phaseAtLinkTime`. *Override:* COO can authorise a parallel structure if a genuine new pattern emerges; expectation is that you justify the gap from `email_project_links` / `teams_project_links` first.
- 🚫 **Default: do not** use `client_domain` alone as evidence of project linkage. Domain matching attributes to client only; project linkage prefers a stronger signal. *Override:* user can manually confirm the project link with reason.
- ✅ Any UI that lists project history (timelines, activity feeds, communications panels) respects `phaseAtLinkTime` grouping by default.
- ✅ When ingesting from a new comms source (WhatsApp, Slack), follow the `email_project_links` / `teams_project_links` shape — graph-style external ID + phase snapshot + signal.
- ✅ Any new "create project" flow considers how existing client-domain emails get retroactively linked once the project exists.
---
## 5. Security & data boundaries
- **Secrets:** never commit `.env*`. Production secrets via Azure Key Vault. Do not read, log, or relay anything in `server/secrets/`. Do not run `env`, `printenv`, `cat .env`, or equivalent.
- **Input validation:** Zod at all system boundaries (request bodies, file uploads, external API payloads).
- **Errors:** throw `ApiError` from `server/lib/api-error.ts`. Never expose raw DB errors, stack traces, or Drizzle error objects to the client.
- **Authorization:** server-side enforcement via `requireAuth` (`server/middleware/requireAuth.ts`) and `requireRole` (`server/middleware/requireRole.ts`). Never implement client-side-only permission checks for sensitive actions. Never import `requireRole` from `server/permission-middleware.ts` — wrong path.
- **Roles:** read `COMPANY_ROLES` from `shared/schema/users.ts`. Never hardcode role strings in route handlers.
- **Bank details:** field-encrypted. Follow the pattern in `scripts/encrypt-existing-bank-details.ts` and `server/lib/field-encryption.ts`. Plain-text bank fields in writes are a hard fail.
- **Microsoft 365:** metadata + deep links only. Never store full email bodies or attachment bytes in the database. Tokens encrypted via `server/lib/token-encryption.ts`.
- **SharePoint Engineering intake sync:** COO-only (`requireRole(["COO_ADMIN"])`), manual Pull/Push trigger.
- **Helmet + CSRF middleware** in `server/middleware/` are not optional. Do not disable them.
---
## 5A. Hard refusals — the only things the app must block
Per the Override Principle (§ 0A), the app records and evidences. It refuses only in these two categories:
### Security
The app must refuse, no override path:
- Storing or transmitting secrets in plaintext (DB, logs, responses, error messages, URL parameters, version control)
- Storing email bodies / attachment bytes / message contents / transcripts in the DB
- Bypassing authentication entirely (skipping `requireAuth`)
- Disabling Helmet or CSRF middleware
- Storing plaintext bank fields (must be encrypted via `server/lib/field-encryption.ts`)
- Reading, logging, or relaying `server/secrets/` or `.env*` content
- Running `env`, `printenv`, `cat .env`, equivalents that exfiltrate environment
- Exposing raw DB errors / Drizzle error objects / stack traces to the client
- Building features that scrape facial images or analyse facial data
### Data corruption / financial-formula integrity
The app must refuse, no override path:
- Reading a snapshot table without the `effectiveTo IS NULL` guard (§ 3.1) — produces wrong totals
- Realising COS from anything other than (invoice captured + invoice-date cell colour BLACK) per § 3.2
- Realising revenue using anything other than the cost-to-cost COS-ratio formula in § 3.3 (no invoice-date / receipt-date / contract-date / milestone triggers for revenue)
- Inflows / outflows / cashflow series derived from non-canonical sources (§ 3.4)
- Changing Smart Import line-ID hash inputs (§ 3.5) — orphans every existing override
- Reverting Smart Import baseline lookup to key-only or snapshot fallback to row-level (§ 9) — re-introduces shipped bugs
- Mutating `phaseAtLinkTime` on existing comms-link rows — corrupts historical record
### Everything else is soft
Schema architecture rules, code-quality rules (`as any`, `@ts-ignore`), repository discipline, route patterns, the legacy / deprecated file rules, the Six Rules, business-workflow invariants, Hold/Blocked semantics, comms-to-project linkage rules — **all soft**. The right person + reason + audit can override. The agent flags the rule, the user authorises with a reason, the app records.
For destructive operations (`db:migrate`, `db:push` on prod, `DROP TABLE`, install npm packages) — the override path is **explicit per-session user approval in chat**. The agent does not proceed silently; it asks. The user's reply is the audit-bearing override.
---
## 6. Database & migrations governance
### Schema source of truth
- **Tables defined in:** `shared/schema/*.ts` (26 domain files: `finance.ts`, `projects.ts`, `users.ts`, `engineering.ts`, etc.).
- **`shared/schema.ts`** is a barrel re-export only. **Do not add tables there.**
- **Types:** use `typeof table.$inferSelect` / `$inferInsert` or the exported `Insert*` / `*` types. Do not declare route-local interfaces that duplicate inferred types.
### Migrations
- **Location:** `/migrations/` at repo root. Not `server/migrations/` (TS maintenance scripts only). Not `drizzle/` (does not exist).
- **Generation:** `npm run db:generate -- --name=<short_snake_case>` after editing `shared/schema/*.ts`.
- **Policy:** **Additive only.** Every statement guarded with `IF NOT EXISTS` / `IF EXISTS`. No destructive `ALTER TABLE … DROP` or `RENAME` without an explicit multi-step safe-migration plan approved by the owner.
- **SQLite-compatible SQL.** PostgreSQL-specific syntax (`::` casts, certain enum tricks, some `RETURNING` edge cases) must be guarded — it breaks the dual-mode dev path.
- **Schema-drift CI guard:** `npm run db:check` fails any PR that edits `shared/schema/*.ts` without a matching new migration file.
- **Applying migrations (`npm run db:migrate`):** **Agents may run this only with explicit per-session approval from the user.** The default is to generate migrations and stop. Reasoning is captured in audit logs / session history. Do not run on prod DBs from agent sessions under any circumstance.
- **`db:push`:** dev-only, destructive (drops columns not in schema). Never on prod.
- **Raw SQL:** avoid unless unavoidable. When unavoidable, use `sql` tagged template + parameters — never string interpolation.
### Repository discipline
- **All CRUD goes through `server/repositories/*`.** Route handlers must not call `db.select()` / `db.insert()` directly.
---
## 7. Agent-tool boundary rules
| Tool | Primary use | Constraint |
|---|---|---|
| **Claude Code** (CLI / IDE) | Multi-file features, plans, refactors, schema changes | Use plan mode (Shift+Tab) before non-trivial work. Constrain reads — never "explore the whole codebase". |
| **Codex** (OpenAI) | Targeted edits inside named files; commit-gated changes | Honour the AGENTS.md scope rules. If something is out of scope, log in `CODEX_FINDINGS.md` and continue. Do not refactor outside the target file. |
| **Replit Agent** | Quick UI iteration, preview-driven changes inside Replit | Treat as the least authoritative for cross-cutting changes. Prefer Claude Code for anything that touches schema, migrations, RBAC, or finance. |
For anything that crosses tool boundaries (e.g. Replit Agent making a schema change), require human review and a Claude Code or Codex pass before merging to `main`.
---
## 8. Do NOT list — split by enforcement
### 8.1 HARD refusals — no override path (security + data corruption)
The app blocks and the agent refuses. These mirror § 5A.
- ❌ Skip `isNull(effectiveTo)` on snapshot-table aggregate queries — produces wrong totals (§ 3.1).
- ❌ Realise COS from anything other than (invoice captured + invoice-date cell colour BLACK) per § 3.2.
- ❌ Realise revenue from any signal other than the § 3.3 cost-to-cost COS-ratio formula (no invoice-date / receipt-date / contract-date / milestone triggers).
- ❌ Derive inflows / outflows / cashflow from non-canonical sources (§ 3.4).
- ❌ Change Smart Import line-ID hash inputs (`expense_line_id`, `inflow_line_id`) — orphans every existing override (§ 3.5).
- ❌ Revert Smart Import baseline lookup to key-only, or snapshot fallback to row-level — re-introduces shipped bugs (§ 9).
- ❌ Mutate `phaseAtLinkTime` after a comms link is created — corrupts historical record.
- ❌ Pull planned dates into the app's actuals fields on Smart Import (§ 3.7) — corrupts project state.
- ❌ Drop the date-colour realisation signal during import or round-trip (§ 3.7).
- ❌ Extend the Excel ↔ app comparison scope beyond dates / amounts / add-delete / colour (§ 9.3) without owner approval.
- ❌ Store email bodies / attachment bytes / message contents / transcripts in the DB.
- ❌ Disable `helmet` or CSRF middleware.
- ❌ Read, log, or relay `server/secrets/` or `.env*`.
- ❌ Bypass authentication entirely (skip `requireAuth`).
- ❌ Store plaintext bank fields — must be encrypted.
- ❌ Expose raw DB errors / stack traces / Drizzle error objects to the client.
- ❌ Scrape or analyse facial images.
### 8.2 Strongly preferred — soft (right person + reason can override)
The agent's default is to refuse and surface the rule. The user can authorise with a reason in-session; the override is recorded.
- 🚫 Put new migrations in `server/migrations/` or `drizzle/` — they belong in `/migrations/`.
- 🚫 Add tables to `shared/schema.ts` — it's a barrel; edit `shared/schema/*.ts`.
- 🚫 Use `::` cast syntax in queries — breaks the SQLite dev fallback.
- 🚫 Create route files as `server/<name>-routes.ts` — use `server/routes/<name>.routes.ts`.
- 🚫 Call `db.select()` / `db.insert()` directly inside route handlers — go through `server/repositories/`.
- 🚫 Import `requireRole` from `server/permission-middleware.ts` — correct path is `server/middleware/requireRole.ts`.
- 🚫 Silence TypeScript errors with `as any` or `@ts-ignore` — fix the root cause.
- 🚫 Run `npm run qa:full-proof` during normal iteration — release-only.
- 🚫 Hardcode role strings in route handlers — read `COMPANY_ROLES` from `shared/schema/users.ts`.
- 🚫 Wipe other projects on Smart Import — upsert by `projectCode`.
- 🚫 Overwrite imported baseline rows with override values — overrides go in their own audit-trailed tables.
- 🚫 Extend `server/work-items-adapter.ts` or `server/work-items-backfill.ts` — retired, read-only reference.
- 🚫 Extend `server/excelParser.ts` or `server/importPipeline.ts` — legacy.
- 🚫 Extend `controlled_documents` and friends — deprecated, replaced by `managed_documents` + folder taxonomy.
- 🚫 Add new "branch" or "waiting" stage codes (e.g. `S_BLOCKED`, `S_WAITING`). Hold is a status, not a stage — see § 4A.
- 🚫 Allow stage-advance / `nextPhase` / `prevPhase` to operate on terminal phases (`S_HOLD`, `S_DONE`).
- 🚫 Build a parallel comms / messages / activity table without `projectId` + `phaseAtLinkTime` — see § 4B.
- 🚫 Use `client_domain` alone as evidence of project linkage for stakeholder communications.
- 🚫 Refactor code you were not asked to change; rename variables outside the target file.
### 8.3 Destructive operations — explicit per-session approval required
Default refusal; user authorises in-session with a reason; agent records and proceeds.
- ⚠️ `npm run db:migrate` — apply migrations.
- ⚠️ `npm run db:push` against a prod DB.
- ⚠️ Any `DROP TABLE` / non-additive migration / column rename.
- ⚠️ Install new npm packages.
- ⚠️ Redefine project stages, COS, revenue, cash flow, invoice, handover semantics, or Hold/Blocked rules — playbook owner approval.
---
## 9. Known-bug-prevention notes — Smart Import v2
These two rules are **load-bearing**. Reverting either re-introduces a previously-fixed production bug. Any agent touching `server/imports/` or `server/lib/import/` must read this section before editing.
### 9.1 Baseline lookup is **id-first**, not business-key-first
In `server/lib/import/conflict-engine.ts`, `buildBaselineLookup` returns both `byRowId` and `byBusinessKey`. `mergeSection` MUST prefer `mr.existingRowId` and fall back to business key only for the legacy `summaryJson.normalization` baseline path. The S001 `externalRef` pre-pass in `row-matcher.ts` can pair a file row to a DB row whose business keys differ (e.g. renamed task) — `mr.businessKey` then holds the file row's key while the baseline row lives under the DB row's key. Reverting to a key-only lookup re-introduces the *"BASELINE: empty"* false-conflict bug.
### 9.2 Snapshot fallback is **field-level**, not row-level
Both engines must skip null/undefined values inside `importSnapshot` and fall back to the live DB row at the field level:
- Planner: `loadBaselineFromSnapshots` in `server/lib/import/baseline.ts`
- Writer: `mergeRow` in `server/lib/import/merge-engine.ts`
Reverting to row-level fallback (`importSnapshot ?? existingRow`) re-introduces hundreds of phantom *"BASELINE: empty"* conflicts whenever a row's snapshot was written by an older import with a smaller tracked-fields set, or stored explicit nulls for fields the workbook left empty. The two engines must use the same rule, or the planner and writer disagree on the conflict set and the wizard bounces with *"More conflicts found — data changed while you were resolving"*.
### 9.3 Excel ↔ app comparison scope — narrow and locked
The conflict-detection engine compares the imported workbook against the live app data. **Only four classes of difference are flagged:**
1. **Dates** — actual dates per § 3.7 (the imported actual vs the app's stored actual). Planned dates are NOT compared because they don't live in the app.
2. **Amounts** — currency / numeric values on cost, revenue, inflow, outflow, and PO line items.
3. **Row add / delete** — new rows in the workbook that aren't in the app, and rows in the app that have been removed from the workbook.
4. **Date colour** — the realisation signal per § 3.7. A change in cell colour against an unchanged date is a flagged difference.
**Everything else is out of scope for the diff:**
- Free-text fields (descriptions, notes, names, supplier names, line item titles) — not compared
- Row ordering — not compared
- Cell formatting other than the realisation colour — not compared
- Hidden columns, comments, formulas — not compared
- Sheet structure, header reformatting — not compared
**Why this scope is locked:** every field added to the comparison set produces noise; users abandon imports when the conflict wizard surfaces 400 cosmetic diffs. The four classes above are the ones that move money or move time. **Extending this scope requires owner approval before any agent change.**
**Engine implementation rules:**
- Comparison logic lives in `server/lib/import/conflict-engine.ts` and `server/lib/import/merge-engine.ts`. Centralise the field allowlist there — do not branch field-checking logic into route handlers.
- The Excel replica view (`managed_documents` referenced from the project page, or whatever current surface) shows BOTH planned and actual dates side-by-side. Do not flatten to actual-only in the replica; the user wants the visual comparison.
- Renamed entries (a row whose "name" / description changes but whose stable key matches an existing app row) are NOT a delete + add. They are a no-op for diff purposes (free-text fields are out of scope per above). The S001 externalRef pre-pass and id-first lookup (§ 9.1) handle this.
**Open edge cases to watch in Wave 0 / Phase D:**
- A row whose business key changed AND whose dates changed — what wins? Per § 9.1, id-first lookup pairs by `mr.existingRowId`, so the dates-changed flag is correct; rename is invisible.
- A row that loses its colour but keeps the date — flagged as colour change (correctly, signals de-realisation).
- Bulk colour reformat in Excel (someone applies a theme) — would surface as N colour changes. Mitigate with import-time review and an explicit "ignore all colour changes" override authority for this import only (per § 0A override pattern).
---
## 10. Local QA — mock connectors
- External integrations (MS Graph / Outlook / SharePoint / Teams, QuickBooks, Pipedrive) auto-serve fixture data when their credentials are absent **and** `NODE_ENV !== "production"`.
- Decision order in `server/lib/connector-mode.ts`: prod → real only; `USE_MOCK_CONNECTORS=false` → force real; `USE_MOCK_CONNECTORS=true` → force mock; creds present → real; creds absent → mock.
- Fixtures: `server/mocks/{ms-graph,quickbooks,pipedrive}-fixtures.ts`. Adjust when the UI needs new realistic data.
- Mock mode never affects production. The flag is `NODE_ENV`-gated.
---
## 11. Process, People, Tools — accountability
| Layer | Rule | Owner |
|---|---|---|
| **Process** | Monthly review of this file + tool-specific files. Bump `Last verified` on each. Run the freshness checks in `docs/claude-code-mastery-guide.md` § "Keeping CLAUDE.md fresh". | Johannes (COO) |
| **People** | Any change to `shared/schema/users.ts` `COMPANY_ROLES`, the snapshot-tables list, or business-rule invariants must update this file in the same PR. | PR author + reviewer |
| **Tools** | (Recommended) `npm run check:agent-docs` CI script — fails PRs where `Last verified` is stale (>90d), role count mismatches schema, or snapshot-table list drifts. Not yet wired; decision pending. | Tech lead |
---
## 12. Keeping this file fresh
This file encodes facts that drift. Stale rules are worse than no rules. Re-verify on these triggers:
- `COMPANY_ROLES` changes in `shared/schema/users.ts` → update § 5 reference; verify count in CLAUDE.md.
- New table with an `effective_to` column → update § 3.4 snapshot-tables list; update `finance-snapshot-queries` skill; update `ee-snapshot-auditor` subagent.
- A retired legacy file → update § 8 Do NOT list.
- Smart Import pipeline location move or v3 rollout → update § 9 and the `smart-import-v2` skill.
- Architectural spine change (new canonical table, new `/api/platform/*` contract) → update § 4.
- New business invariant (or change to one of the existing six) → update § 3, mirror in code/audit logging.
**Refresh procedure:** run the bash checks in `docs/claude-code-mastery-guide.md` § "Keeping CLAUDE.md fresh"; reconcile every section here against reality; bump `Last verified` at the top; commit with `docs(agent-guardrails): refresh — 2026-MM-DD verification`.
If you cannot re-verify a rule, **remove it** rather than leaving it stale. A missing rule makes the agent ask. A wrong rule makes it confidently break things.
---
## 13. What this file deliberately does not redefine
Per owner standing instructions and the playbook:
- Project stages (the canonical 10-sequential + 2-terminal phase set in `shared/phases.ts`, mirrored in the playbook)
- The Six Rules from the playbook
- COS realisation formula, revenue realisation formula, inflow / outflow / cashflow formulas (§ 3 — hard data-corruption rules)
- Invoice and handover workflow semantics
- SharePoint integration logic and the canonical folder taxonomy
- Pipedrive integration logic
- App database logic or the data model itself
- Hold/Blocked status semantics
These can change — but only via an explicit playbook update + owner authorisation. The agent does not redefine them mid-task. If a code change appears to require redefinition, **stop and ask the owner** before proceeding.
**Note:** the no-PO flag rule that previously appeared in the AGENTS.md invariant set has been removed at owner direction (2026-05-07). Invoices may exist without POs; the audit / flag pattern is no longer required. If audit policy on this changes again, it returns via owner update to this file.
---
*End of canonical guardrails. See companion files: `CLAUDE.md` (Claude Code operational guidance), `AGENTS.md` (Codex operational guidance), `replit.md` (Replit Agent operational guidance), `docs/architecture.md` (system structure), `docs/claude-code-mastery-guide.md` (Claude Code playbook).*
