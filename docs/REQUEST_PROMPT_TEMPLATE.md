# Request-Prompt Template — Emergent Energy Web App
**Owner:** Johannes Theo Potgieter (COO)
**Last verified:** 2026-05-07
**Use with:** Claude Code, Codex, Replit Agent — tool-agnostic.
---
## Why this template exists
Even perfectly configured AI agents diverge on a sloppy human prompt. Same task → three different prompts → three different outputs. This template forces the human to define scope, files, invariants, and done-criteria *before* sending. The result: the same request produces structurally similar work regardless of which agent runs it.
**Rule:** every non-trivial task issued to any AI agent in this repo uses this template. "Non-trivial" = anything that touches more than one file, or any file under `server/`, `shared/`, `migrations/`, or `client/src/pages/`.
---
## The template — copy from the line below
```
# Request to AI Agent
## Read first
1. Read `docs/AGENT_GUARDRAILS.md` (the canonical agent guardrails).
2. If this task touches lifecycle phases, gates, deliverables, handovers, or
   stakeholder communications, also read the relevant section of
   `docs/operating-model/playbook-v2.0.md` (C&I Solar Delivery Playbook v2.0).
Precedence when sources disagree:
live code > playbook (business rules) > AGENT_GUARDRAILS.md (technical rules)
> architecture.md > tool-specific files (CLAUDE.md, AGENTS.md, replit.md).
## Operating principle
The app records and evidences. It does not block except for security and
data-corruption rules (§ 5A, § 8.1). Build features so the right people can
edit, override, or correct with a reason. The override path is: authorised
role + reason + audit entry. Use the existing `approvals`, `audit_events`,
`stage_gate_overrides`, and `pending_approvals` infrastructure — never
invent parallel patterns.
## Task
<one-sentence description of what to build / fix / change>
## Why (business context)
<2–4 sentences. What operational problem does this solve? Which user / role hits it?
Skip if obvious.>
## Files in scope — read ONLY these
- <path/to/file1.ts>
- <path/to/file2.ts>
- <shared/schema/<domain>.ts — only the table(s) in scope>
- <server/repositories/<domain>.ts>
- <existing test file under qa/tests/ that you will extend>
## Files explicitly out of scope — do NOT read or modify
- <legacy file paths to ignore, e.g. server/excelParser.ts, server/work-items-adapter.ts>
- <unrelated domains>
Do NOT "explore the codebase". If you think you need a file not listed, stop and ask.
## Invariants touched — confirm you understand each before coding
List which sections of AGENT_GUARDRAILS.md apply to this task:
- [ ] § 2A The Six Rules — which one(s)? <list, e.g. "Rule 2 SharePoint source of truth">
- [ ] § 3 Business invariants — which one(s)? <list, e.g. "3.4 snapshot guard">
- [ ] § 4 Architectural spine — which canonical table(s)? <list, e.g. "project_info, work_items">
- [ ] § 4A Hold/Blocked status rule — does this touch lifecycle stage advancement, terminal phases, or the project_status field?
- [ ] § 4B Stakeholder communications — does this ingest/display/route comms tied to a project (email, Teams, WhatsApp, etc.)?
- [ ] § 5 Security — does this touch RBAC / secrets / Graph / bank details?
- [ ] § 6 DB & migrations — does this require a schema change?
- [ ] § 9 Smart Import known-bug-prevention — only if touching server/imports/
- [ ] None — pure UI / pure refactor with no backend impact
## Lifecycle-stage impact — if applicable
- [ ] Lifecycle stage(s) touched (from `shared/phases.ts`): <list stage codes, e.g. S04_PLANNING, S07_COMMISSIONING>
- [ ] Stage gate(s) affected (from `stageGateDefinitions`): <list gate keys>
- [ ] Playbook section(s) read for this work: <list, e.g. "Stage 4 Planning § 4.2 Regulatory approvals">
- [ ] Required-evidence rule confirmed (no stage advancement without evidence)
## Document management impact — if applicable
- [ ] Files produced/consumed live in SharePoint via `managed_documents` (NOT in the legacy `controlled_documents` path)
- [ ] Folder taxonomy (`folder_taxonomy` / `project_folders`) referenced: <taxonomy keys>
- [ ] Approval requirements (`document_approval_requirements`) considered for files needing sign-off
- [ ] Metadata-only enforced — no file bodies stored in DB
## Override path — if the feature involves a workflow rule
For any soft rule the feature could conflict with (gate criteria, handover
sign-off, stage advancement, comms linkage, Hold/Blocked, approval thresholds):
- Authorising role(s) for override: <e.g. COO_ADMIN, PROGRAM_MANAGER>
- Where the reason is captured: <field name + table>
- Audit log entry written to: <audit_events / merge_audit_log / stage_gate_overrides / etc.>
- Override visible in UI as: <chip / banner / row flag — not hidden>
Do NOT build hard refusals into workflow rules. The app records and
evidences; the right person + reason can override.
## Acceptance criteria — done = ?
- <observable behaviour 1>
- <observable behaviour 2>
- <new endpoint / page / report visible at <path> for role <X>>
- All existing tests still pass
- No new TypeScript errors (`npm run check` clean)
- No `as any` / `@ts-ignore` introduced
## Tests required
- <new test file path under qa/tests/ — and what it asserts>
- <which existing tests must still pass>
Do NOT run `npm run qa:full-proof` during iteration. Use targeted runs.
## Migrations (if schema change)
- New file: `/migrations/<YYYYMMDD>_<short_snake_case>.sql`
- Additive only, IF NOT EXISTS / IF EXISTS guarded
- SQLite-compatible (no `::` casts)
- Generate via `npm run db:generate -- --name=<short_snake_case>` — do NOT run
  `npm run db:migrate` without explicit per-session approval from me.
## Risk flags — call out before coding
- [ ] Touches finance reads (snapshot guard required)
- [ ] Touches role list / RBAC enforcement
- [ ] Touches MS Graph / SharePoint sync
- [ ] Touches Smart Import baseline / merge / overrides
- [ ] Touches bank details or other encrypted fields
- [ ] Touches stage advancement or `nextPhase` / `prevPhase` logic
- [ ] Touches `email_project_links` / `teams_project_links` or any stakeholder-comms surface
- [ ] Touches `managed_documents`, `folder_taxonomy`, or `project_folders`
- [ ] Touches `projectInfo.project_status` or terminal phase logic
- [ ] None
## Plan first — wait for my approval
1. List every file you will change and why.
2. Schema changes (if any).
3. Migration path (if any).
4. Which `COMPANY_ROLES` gate the new endpoint(s).
5. Which tests you will add.
6. Anything in scope you would deprioritise / split into a follow-up.
Do NOT write code until I've approved the plan.
## After implementing
- Run `npm run check` (or `check:client` for client-only changes).
- Run the targeted test file you added.
- Report what you changed, what tests you ran, and any deviation from the plan.
- Do not push. Do not commit unless explicitly asked.
## What to do if something is unclear
Stop and ask. Do not guess. Do not extend scope.
```
---
## Worked example 1 — adding a feature
```
# Request to AI Agent
## Read first
Read `docs/AGENT_GUARDRAILS.md` before doing anything else.
## Task
Add a monthly cost variance endpoint at GET /api/financials/projects/:id/cost-variance.
## Why (business context)
Programme Finance Managers need to see actual vs budgeted COS per project per month
without exporting to Excel. Currently they pull two separate reports and reconcile
manually. This endpoint feeds the existing cost-variance card on the Programme
Finance dashboard.
## Files in scope — read ONLY these
- server/routes/financials.routes.ts
- server/repositories/finance-temporal-repository.ts
- shared/schema/finance.ts (only normalizedCostLines and project_budget_lines)
- qa/tests/api/financials.test.ts
## Files explicitly out of scope — do NOT read or modify
- server/excelParser.ts, server/importPipeline.ts (legacy)
- server/work-items-adapter.ts, server/work-items-backfill.ts (retired)
- Any other server route files
## Invariants touched
- [x] § 3.2 COS realisation rule — endpoint reads realised COS only (invoice captured + invoice-date BLACK per § 3.2 / § 3.7); does not project, does not realise on capture alone
- [x] § 3.3 Revenue realisation rule — if any revenue figure is computed, use the cost-to-cost COS-ratio formula; never trigger revenue from receipt date / invoice date / milestone
- [x] § 3.1 Snapshot guard — `normalizedCostLines` query MUST include
      isNull(normalizedCostLines.effectiveTo)
- [x] § 4 Spine — attach to project_info.id; reuse audit_events if I write any
- [x] § 5 Security — gate via requireRole(["PROGRAM_FINANCE_MANAGER","CFO","COO_ADMIN"])
## Acceptance criteria
- GET /api/financials/projects/:id/cost-variance returns
  { months: [{ month: "2026-01", actualCos, budgetCos, variance, variancePct }, ...] }
- Returns 403 for roles not in the gate
- Returns 404 if project_info.id does not exist
- All existing financials tests pass
- npm run check clean
## Tests required
- Extend qa/tests/api/financials.test.ts with:
  - Happy-path read for a seeded project across 3 months
  - 403 for an unauthorised role
  - Snapshot guard: insert a closed snapshot row (effectiveTo NOT NULL) and verify
    the response excludes it
## Risk flags
- [x] Touches finance reads — snapshot guard required (§ 3.1)
## Plan first — wait for my approval
```
---
## Worked example 2 — fixing a bug
```
# Request to AI Agent
## Read first
Read `docs/AGENT_GUARDRAILS.md` before doing anything else. Pay particular attention
to § 9 (Smart Import known-bug-prevention).
## Task
Fix: Smart Import wizard reports "More conflicts found — data changed while you
were resolving" intermittently when the same workbook is re-uploaded with no edits.
## Why (business context)
This blocks Programme Finance from completing imports. Workaround today is to
re-resolve the same conflicts; we want it to either present a stable conflict
set or no conflicts.
## Files in scope — read ONLY these
- server/lib/import/baseline.ts (loadBaselineFromSnapshots)
- server/lib/import/merge-engine.ts (mergeRow)
- server/lib/import/conflict-engine.ts (buildBaselineLookup, mergeSection)
- server/lib/import/row-matcher.ts (S001 externalRef pre-pass)
- qa/tests/api/smart-import-conflicts.test.ts
## Files explicitly out of scope
- server/excelParser.ts, server/importPipeline.ts (legacy)
- The route file — unless the bug is in routing (read only after grepping)
## Invariants touched
- [x] § 9.1 Baseline lookup is id-first — confirm mr.existingRowId precedence is intact
- [x] § 9.2 Snapshot fallback is field-level — confirm both engines skip nulls
      inside importSnapshot at field level
## Acceptance criteria
- Re-uploading an unchanged workbook produces zero new conflicts after the first
  resolution
- The planner and writer report identical conflict sets for the same input
- Existing Smart Import tests pass
- A regression test reproduces the original symptom and passes after the fix
## Tests required
- Extend qa/tests/api/smart-import-conflicts.test.ts:
  - Test: snapshot row written by an older tracked-fields set + workbook leaves
    those fields empty → no phantom conflict
  - Test: S001 externalRef pre-pass renames task — file row's businessKey differs
    from DB row's businessKey → mr.existingRowId still wins
## Risk flags
- [x] Touches Smart Import baseline / merge / overrides
## Plan first
- Reproduce the bug locally with a minimal fixture before changing code
- Identify whether the bug is in the planner, writer, or the lookup
- Plan the fix and the regression test before editing
```
---
## Pre-send checklist (for the human)
Before you paste a filled-in template into any agent, confirm:
- [ ] Files in scope are named — not directories.
- [ ] Files out of scope explicitly listed (legacy / unrelated).
- [ ] Invariants section is filled in honestly — Six Rules / finance / RBAC / Smart Import / Graph / Hold / Comms flags ticked or "None".
- [ ] Lifecycle stages touched are listed by stage code, with playbook sections read.
- [ ] Document-management impact stated (or N/A).
- [ ] Done-criteria is observable, not subjective ("works" is not a criterion).
- [ ] Tests required by file path, not by description.
- [ ] You named the role(s) gating any new endpoint.
- [ ] You did NOT redefine project stages, COS, revenue, cash flow, invoice, PO, handover semantics, or Hold/Blocked rules. If you needed to, this prompt should be a discussion with the owner first, not an agent task.
If any box is unchecked, the prompt is not ready. Do not send.
---
## Tool-specific footnotes (one line each, not part of the template)
These are operational hints, not template variations:
- **Claude Code:** drop the prompt into Plan Mode first (`Shift+Tab`). Approve the plan in your editor (`Ctrl+G`) before exiting plan mode.
- **Codex:** if scope creep happens, instruct it to log findings in `CODEX_FINDINGS.md` and continue — do not let it refactor sideways.
- **Replit Agent:** prefer Claude Code for anything that touches schema, migrations, RBAC, or finance. Replit Agent for UI iteration only when this prompt's "Files in scope" stays under `client/src/`.
---
## How this template gets enforced
| Layer | Mechanism | Owner |
|---|---|---|
| **Process** | Every agent task uses this template. Pasted into the agent unchanged. | Whoever issues the task |
| **People** | If the team grows, brief everyone on the template before granting agent access. Sign-off on first prompt. | Johannes (COO) |
| **Tools** | (Optional, Recommended) Pin this file in `docs/AGENT_GUARDRAILS.md` § 0. Add a `/ee-request` Claude Code slash command that pastes the empty template and requires fields filled before proceeding. | Tech lead |
---
*End of request-prompt template.*
