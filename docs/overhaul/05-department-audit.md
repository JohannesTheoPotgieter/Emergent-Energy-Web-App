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

(Next departments will be appended as we walk them: PM delivery → Engineering → Quality → HSE → Finance → Handover → O&M.)
