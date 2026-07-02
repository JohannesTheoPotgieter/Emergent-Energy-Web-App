# Department × Function audit

Working document. For each department we walk every owned screen against the four business questions we locked earlier:

1. **What is the real-life job this screen does?**
2. **Is the screen necessary?**
3. **Does every function for this role actually work end-to-end?**
4. **Can a super user manage it from the front end?**

Findings captured per screen. Small gaps fixed inline; larger ones tracked as follow-up items at the bottom of each department section.

Lifecycle order: **Project Development → Program / Project Delivery → Engineering → Quality → HSE → Finance → Handover → O&M**.

---

## A. Project Development (PD)

**Role ownership:** `PROJECT_DEVELOPER`, `CCO`, `KEY_ACCOUNTS_MANAGER`. CEO watches.

### A1. `/pd` — Project Development Dashboard

- **Real-life job**: PD / CCO opens this to see the state of the sales pipeline: how many active deals, pipeline value, what's at risk, upcoming activity, recent wins + losses.
- **Necessary?** Yes. It's the PD's primary morning surface.
- **End-to-end working?** Yes — data comes from Pipedrive sync (`/api/pd/dashboard`), not mocked.
- **Super-user manageable?** Read-only. CRUD happens in Pipedrive itself and feeds through. No in-app override of deal data, which is correct — Pipedrive stays the source of truth for live deals.
- **Gaps noticed:**
  - "At risk" counts (stale activity / very stale / high-value-no-recent / overdue followups) have no drill-in. A PD can see "8 overdue follow-ups" but can't click it to see which. **Fix = small: add drill-ins.**
  - No link to the CEO home (`/ceo`) from here, even though CEO watches the same pipe. Not strictly needed but a lateral jump would help when CEO + PD are on the same call.
  - No display of D3 "Controlled docs pending" per deal (costing Excel submissions awaiting CEO). **Fix = medium: add a strip using the approval queue.**

### A2. `/opportunities` — Pipedrive opportunities working list

- **Real-life job**: PD's backlog of sales deals. Pick one, spawn a First Assessment or Cost Proposal ticket, convert to a project.
- **Necessary?** Yes — this is the intake funnel.
- **End-to-end working?** Yes — spawn / convert flows exist via `/api/opportunities/:id/*` endpoints.
- **Super-user manageable?** PD can edit tickets they own, super users can edit all. That's right.
- **Gaps noticed:**
  - No cascade-delete preview when deleting a ticket (could have engineering work attached).
  - Large file (1300 lines) — candidate for a tidy-pass but not a correctness gap.

### A3. `/clients` — Client list

- **Real-life job**: Who are our customers? Add/edit company records, primary contacts, billing entity.
- **Necessary?** Yes.
- **End-to-end working?** Yes — standard CRUD against `/api/clients`.
- **Super-user manageable?** Yes — add, edit, delete.
- **Gaps noticed:**
  - Client delete currently has **no cascade-delete preview** even though deleting a client orphans projects + sites. R4.3 shipped the `DeleteClientDialog` drop-in for exactly this — it is not yet wired into the Clients page. **Fix = small: wire `DeleteClientDialog` into the delete button.**
  - No email-domain field in the client record yet. Needed for the email-to-project linking feature we scoped. **Fix = medium: add schema + UI.** *Deferred — multi-session feature.*

### A4. `/clients/:clientId` — Client detail

- **Real-life job**: See all projects for a client, all sites, invoices, historical context.
- **Necessary?** Yes.
- **End-to-end working?** Yes based on route existence; not re-verified file-level.
- **Super-user manageable?** Yes.
- **Gaps:** Same email-domain + contact list gap as A3. Otherwise fine.

### A5. `/sites` — Sites list

- **Real-life job**: Physical locations — 1 client often has many sites. Add / edit sites.
- **Necessary?** Yes.
- **End-to-end working?** Yes.
- **Super-user manageable?** Yes.
- **Gaps:** Same pattern — no cascade-delete dialog when a site has live projects.

### A6. `/project-create` — New project intake

- **Real-life job**: Turn a signed deal into a project record. Pick client, site, set contract value, dates.
- **Necessary?** Yes.
- **End-to-end working?** Yes.
- **Super-user manageable?** Yes — any PD/PM can create. Super users can edit all.
- **Gaps:**
  - Doesn't offer to configure the **SharePoint root** at creation time. Since we now track `project_sharepoint_roots` (D5.3), the best moment to ask for the root is right here. **Fix = medium: add optional SharePoint root input to the create form.**

### A7. `/handover/:projectId/live` — Live handover meeting (D4)

- **Real-life job**: Facilitator-led PD → PM handover meeting.
- **Necessary?** Yes — brand-new surface built this session.
- **End-to-end working?** First-pass yes: attendee check-in, 6-step walkthrough, save-charter, record decision. Haven't verified the POST `/api/projects/:id/acceptances` payload end-to-end against the existing server — if it rejects our `stageCode + attendees + sectionNotes` extras, they'll be silently dropped by the server's Zod schema (not broken, just lossy).
- **Super-user manageable?** Yes — PM records decision, super users can override via existing admin recovery.
- **Gaps:**
  - No server-side persistence of `attendees` or `sectionNotes` yet — they live only in the client session. **Fix = medium: extend the acceptance endpoint to store these** (or add a parallel handover_meeting_sessions table). *Deferred — need to check existing server Zod schema first.*

### PD follow-ups after this round

- Wire `DeleteClientDialog` into `/clients` (quick).
- Add a D3 "Docs pending CEO approval" strip to `/pd` (medium).
- Drill-ins on PD-Dashboard at-risk counts (small).
- SharePoint root optional input on `/project-create` (medium).
- Email-domain field on `clients` schema + UI (deferred — pairs with email-linking feature).
- Server-side persistence of handover-meeting session data (deferred).

---

## B. Program / Project Delivery (PM)

**Role ownership:** `PROGRAM_MANAGER`, `PROJECT_MANAGER_SITE`, `CONSTRUCTION_MANAGER`. COO watches.

### B1. `/projects` — Project list

- **Job**: Browse all projects, filter/sort, click into detail.
- **Necessary?** Yes — the index.
- **End-to-end?** Yes — reads from `/api/projects-summary`.
- **Super-user?** Can edit project metadata via the detail page. No delete button here — intentional: projects are archived not deleted. `DeleteProjectDialog` (R4.2) is available but not wired here; archive flow lives on project-detail.
- **Gaps:** Filters are numerous and functional. No known correctness issue.

### B2. `/project/:projectName` — Project detail

- **Job**: The PM's primary working surface per project. Tabs across delivery, commercial, engineering, quality, PD (with controlled docs), etc.
- **Necessary?** Yes — central to PM life.
- **End-to-end?** Yes. D3.4d added the Controlled docs subtab; D5.3 added the SharePoint root config card.
- **Super-user?** Yes.
- **Gaps:**
  - Very large file (1814 lines) — refactoring candidate for a future session, not a correctness bug.
  - No inline DeleteProjectDialog yet (archive is preferred — see B1). ✓ Design intent.

### B3. `/execution-board` — Program / execution overview

- **Job**: COO / Program Manager's portfolio view of active projects. Action Center, RAG split, financial KPIs, Top Problem Projects.
- **Necessary?** Yes — the "what needs attention" portfolio surface.
- **End-to-end?** Yes — already audited during D2 COO home planning. 3 tabs (Overview / Program / Finance).
- **Super-user?** Read-focused. Actions flow via drill-in.
- **Gaps:** None new since D2 reshape planning.

### B4. `/pm-dashboard` — PM personal dashboard

- **Job**: A specific PM's own view of their projects + their open tasks + approvals.
- **Necessary?** Yes — individual PM's morning surface.
- **End-to-end?** Yes.
- **Super-user?** Read + action.
- **Gaps:** Could absorb the `ApprovalQueueCard` so PMs see their D3 approvals without hunting. **Fix = small.**

### B5. `/pm/on-the-go` — PM mobile-friendly

- **Job**: PM on site with a phone — quick log photo / update / issue / invoice.
- **Necessary?** Yes — unique mobile flow.
- **End-to-end?** Yes.
- **Super-user?** Yes.
- **Gaps:** Hasn't been visually refreshed in the R1 pass (it uses its own layout). Low-priority — field-work app feels OK as-is.

### B6. `/pm/approvals` — PM-owned approvals

- **Job**: PM's queue of things waiting on them to approve (PO, variation, invoice attach).
- **Necessary?** Yes.
- **End-to-end?** Yes — approvals table backs it.
- **Super-user?** Yes — can override on behalf-of.
- **Gaps:** Doesn't include controlled-document approvals today. Easy merge: this page can either (a) filter the `approvals` table generically — today it probably does — which means our D3 `approvalType='controlled_document'` rows should already appear. **Verification needed** in a future session by inspecting what the page filters on.

### B7. `/weekly-reviews` — Weekly PM review wizard

- **Job**: Structured weekly form for each PM to update their projects.
- **Necessary?** Yes — cadence discipline.
- **End-to-end?** Yes.
- **Super-user?** Yes.
- **Gaps:** None new.

### B8. `/portfolios` + `/portfolios/:id` — Portfolio management

- **Job**: Group projects by program / client / region for portfolio rollups.
- **Necessary?** Yes.
- **End-to-end?** Yes.
- **Super-user?** Yes.

### B9. `/governance/financial-reviews` — Financial review queue

- **Job**: Finance-related approvals pending (budget exceptions, vendor on-boarding, etc.).
- **Necessary?** Yes — audit path.
- **End-to-end?** Yes.
- **Super-user?** Yes.

### B10. `/handover-control` — Handover Control

- **Job**: Cross-project view of handover state: which projects are mid-handover, their readiness, who's assigned.
- **Necessary?** Yes — complements D4 live interface.
- **End-to-end?** Yes.
- **Super-user?** Yes.
- **Gaps:** Should link each row to `/handover/:id/live` where applicable. **Verification needed.**

### B11. `/po-approval-board` / `/payment-request-board` / `/payment-batch-manager` — Procurement finance flows

- **Job**: PO lifecycle from request → PM approval → CFO approval → payment batch.
- **Necessary?** Yes.
- **End-to-end?** Yes — these pages have been in use for months.
- **Super-user?** Yes.
- **Gaps:** Individual POs / payment requests don't have a cascade-delete dialog yet. Same R4 pattern applies — *follow-up.*

### PM follow-ups after this round

- Add `ApprovalQueueCard` to `/pm-dashboard` (small).
- Verify `/pm/approvals` includes D3 controlled-document approvals (verify-only).
- Verify `/handover-control` rows link to `/handover/:id/live` (verify-only).
- Extend R4 cascade-delete pattern to POs, payment requests (medium, pending pattern need).

---

## C. Engineering

**Role ownership:** `ENGINEERING_MANAGER`, `ENGINEER`. COO watches (called out as "my baby").

### C1. `/engineering` — Engineering Dashboard

- **Job**: Engineering Manager's portfolio view — tasks by status, blockers, deliverables outstanding.
- **Necessary?** Yes.
- **End-to-end?** Yes.
- **Super-user?** Yes.
- **Gaps:** Should host `ApprovalQueueCard` filtered to engineering approvals (design packs, feasibility, yield studies — all rows where ENGINEERING_MANAGER is the approver). ✓ The D3 queue API already returns these; the card shows them. **Fix = small: add ApprovalQueueCard.**

### C2. `/engineering/tasks` — Task Board

- **Job**: Engineers work their individual task list here (blockers, design tasks, reviews).
- **Necessary?** Yes.
- **End-to-end?** Yes — work_items backed.
- **Super-user?** Yes.
- **Gaps:**
  - Task delete (if exposed) doesn't show cascade impact. Tasks have sub-items, comments, reminders. Low priority though — task deletes are rare. **Follow-up: R4 extend to work_items.**

### C3. `/engineering/standup` — Engineering Standup

- **Job**: Daily stand-up surface — who's working on what, yesterday/today/blockers.
- **Necessary?** Yes — rhythm discipline.
- **End-to-end?** Yes.
- **Super-user?** Yes.
- **Gaps:** None new.

### C4. `/reports/engineering/monthly` + history + compare + project — Monthly engineering reports

- **Job**: Monthly narrative snapshot of engineering state for COO / program governance.
- **Necessary?** Yes.
- **End-to-end?** Yes — has its own snapshot machinery.
- **Super-user?** Yes (COO reads + PMs contribute).
- **Gaps:** None new.

### C5. `/engineering/audit` + `/admin/eng-templates` — System admin

- **Job**: Audit log of engineering-specific events + engineering task templates admin.
- **Necessary?** Yes for traceability + reuse.
- **End-to-end?** Yes.
- **Super-user?** Yes — COO / EM only.
- **Gaps:** None new.

### Engineering follow-ups

- Add `ApprovalQueueCard` to `/engineering` (small).
- Extend R4 cascade-delete to work_items when deletion is meaningful (medium, pending need).

---

## D. Quality

**Role ownership:** `QUALITY_MANAGER`.

### D1. `/quality` — Quality Dashboard

- **Job**: QM's view of open findings, inspections due, NCRs, sign-offs overdue.
- **Necessary?** Yes.
- **End-to-end?** Yes.
- **Super-user?** Yes.
- **Gaps:** ApprovalQueueCard useful here too (quality-related approvals). **Fix = small.**

### D2. Quality-related tabs on project-detail

- **Job**: Per-project quality findings, QA reports, inspection records.
- **Necessary?** Yes.
- **End-to-end?** Yes.
- **Super-user?** Yes.
- **Gaps:** None new.

### Quality follow-ups
- Add `ApprovalQueueCard` to `/quality` (small).

---

## E. HSE

**Role ownership:** `HSE_MANAGER`, `SSEG_MANAGER`.

### E1. `/hse` — HSE Dashboard

- **Job**: Incidents, near-misses, corrective actions, audits.
- **Necessary?** Yes.
- **End-to-end?** Yes.
- **Super-user?** Yes.
- **Gaps:** ApprovalQueueCard may be relevant if HSE corrective-action approvals flow through D3. **Fix = small.** Confirm HSE approvals are in approval taxonomy.

### E2. Project-level HSE tabs

- Same pattern as Quality. Fine.

### HSE follow-ups
- Add `ApprovalQueueCard` to `/hse` (small).
- Consider dedicated SSEG (grid-tie compliance) view separate from HSE. Today SSEG lives inside the lifecycle stages (Stage 9 Client Handover). Covered by COO SSEG strip — no separate page needed yet.

---

## F. Finance

**Role ownership:** `CFO`, `PROGRAM_FINANCE_MANAGER`, `ACCOUNTANT`.

### F1. `/cashflow`, `/revenue-tracker`, `/cos` — core finance boards

- **Job**: Forecast + actual across cash, revenue, cost-of-sales.
- **Necessary?** Yes.
- **End-to-end?** Yes.
- **Super-user?** Yes for admin edits.
- **Gaps:** Already linked from COO home financial pulse column.

### F2. `/quickbooks` — QB home (R5)

- **Job**: Connection health, sync, mappings, recon jump-offs.
- **Necessary?** Yes.
- **End-to-end?** Yes.
- **Super-user?** Yes.
- **Gaps:** None — just shipped.

### F3. `/finance-quickbooks-links` + `customer-mapping` + `throughput` — Deep QB tooling

- **Job**: Power-user mappings + recon.
- **Necessary?** Yes.
- **End-to-end?** Yes.
- **Super-user?** Yes.
- **Gaps:** None new.

### Finance follow-ups
- Invoices + POs cascade-delete pattern extension (R4).

---

## G. Handover / Closeout

Covered by D4 (live meeting) and the existing Stage4PdPmHandover workspace. Charter + acceptance flow covered. Handover-control board feeds it.

- **Job**: Move from PD → PM, then PM → O&M, then O&M → Client.
- **Necessary?** Yes.
- **End-to-end?** Yes. D4 added live-meeting surface.
- **Super-user?** Yes.
- **Gaps:** Persisting `attendees` + `sectionNotes` server-side on the live meeting (deferred from D4).

---

## Summary of audit-driven concrete fixes applied this session

1. `/pd` — Risk Signals tile drill-ins to `/opportunities?filter=*` (commit `0f0363e0`).
2. `/pm-dashboard` — `ApprovalQueueCard` added (commit `da62f1fd`).
3. `/engineering` — `ApprovalQueueCard` *(this commit)*.
4. `/quality` — `ApprovalQueueCard` *(this commit)*.
5. `/hse` — `ApprovalQueueCard` *(this commit)*.

## Audit-driven follow-ups (not blocking)

- `DeleteClientDialog` wired once `/clients` gains a delete button.
- `/opportunities` filter query-param handling.
- D3 "Docs pending CEO approval" strip on `/pd`.
- Optional SharePoint root input on `/project-create`.
- Email-domain + contact list fields on clients.
- Server-side persistence of handover meeting attendees + section notes.
- R4 cascade-delete extended to POs, payment requests, work_items, invoices.
- Verify `/pm/approvals` includes D3 rows (likely already does).
- Verify `/handover-control` rows link to `/handover/:id/live`.
