# Roles & Permissions — COO/CEO Guide

This is the plain-English guide to who can see and do what inside Emergent
Energy. It targets the COO and CEO — no code reading required.

> **One door:** everything access-related lives under
> [`/admin/roles`](/admin/roles). The old `/admin/control-center` link
> redirects there.

## How it works in one paragraph

Every screen and every save button maps to an **entity** (e.g. *Financials*,
*Engineering*, *Project Phases*) and an **action** (`view`, `create`, `edit`,
`approve`, `override`, `delete`). The same rule decides "can the button
appear?" on the screen and "is the save allowed?" on the server, so what the
user sees is what they can actually do.

## The single screen at `/admin/roles`

There are **no tabs**. The page is one screen with two columns:

| Column                     | What lives there                                                          |
| -------------------------- | ------------------------------------------------------------------------- |
| **Left rail (the picker)** | A `People ↔ Roles` toggle, a search box, and the list of matching items.  |
| **Right panel (detail)**   | Detail for whatever you picked — a person on the left, a role on the left. |

The page header carries three things you can reach from anywhere on the
screen: a **Change history** slide-over (every apply, reassign, exception
add/remove), a link to **/admin/settings → Visibility** (workflow visibility
lives there, not here), and a link back to this guide.

You can also jump straight to a person or a role by URL:

- `/admin/roles?user=42` → People mode, user 42 selected.
- `/admin/roles?role=PROJECT_MANAGER` → Roles mode, that role selected.

## Recipes

### "I just hired a new project manager"
1. Make sure the rail's **People** toggle is on, search their name, click them.
2. In the right panel, open the *Apply template* dropdown and pick
   **Project Manager**.
3. Read the plain-English diff (e.g. "*Will gain edit on Engineering, Project
   Phases, Stage Gates*").
4. Type a short reason ("New hire — Sept intake") — this goes into the audit
   log — and click **Apply template**.

### "I want every Engineering Manager to be able to approve POs"
1. Flip the rail to **Roles**, search and click **Engineering Manager**.
2. In the right panel header, open the *Apply template* dropdown and pick the
   **Engineering Manager** template (or whichever template you want to apply
   to the whole role).
3. The diff will show "*Will gain approve on Procurement*". Type a reason
   and apply — every user with that role inherits the change immediately.

### "Someone from Finance needs read-only access to a few projects"
1. Flip the rail to **People**, click the user.
2. Apply the **Finance Read-Only** template to write the baseline exceptions.
3. In the **Exceptions** card on the right, click **+ Add exception** to grant
   `projects:view` on the specific projects they need.

### "An employee left — revoke everything"
1. Find the user in **People**, click them.
2. Apply the **Read-Only Viewer** template (they can still log in but cannot
   change anything).
3. Click **Manage account** in the user header to delete the local user record,
   then disable the user in the SSO console (Azure / Microsoft 365).

### "I need to compare two roles side-by-side"
1. Flip the rail to **Roles** and click one of the two roles you want to
   compare.
2. In the right panel header, click **Compare with another role** and pick
   the other role from the dropdown.

## Templates we ship

The list below is the catalogue under **Roles**. Every template has a one-line
summary you can read inside the app.

- **Executive (full)** — CEO/COO god-mode.
- **CFO Full** — owns Finance, Reporting and Approvals; read access elsewhere.
- **Accountant** — day-to-day finance edits, no approvals.
- **Finance Read-Only** — view-only across Finance.
- **Program Manager** — orchestrates phases & gates across all projects.
- **Project Manager** — owns their projects end-to-end.
- **Project Developer** — opportunities, clients, calendar; no execution edit.
- **Engineering Manager** — owns engineering, can approve.
- **Engineer** — does engineering work, no approvals.
- **Construction Manager** — site, procurement, handover.
- **QA / HSE** — quality, safety, audits across all projects.
- **SSEG Manager** — SSEG/handover focus.
- **Read-Only Viewer** — login + view nothing else.

## Finance route access (recorded 2026-06-11)

The finance section nav is exactly seven items — **Finance Home, Revenue, Cost of Sales, Gross
Profit, Cashflow, Reconciliation, QB Reconciliation** — per the canonical
`docs/finance-source-of-truth-audit.md` Part I § G.

- **Revenue page:** route `/revenue-tracker` (label *Revenue*), with `/finance/revenue` registered as
  an **alias** of it. Gated by the `revenue_tracker` entity (`revenue_tracker:view`). The COO/CEO
  Executive template and finance templates carry this, so COO_ADMIN can view Revenue.
- **Corrected access:** an earlier regression left `/finance/revenue` **unregistered**, so it resolved
  to an unknown path and was denied for everyone (including COO_ADMIN). It is now registered as the
  alias above — Revenue is reachable for anyone with `revenue_tracker:view`. (Reconciliation was a
  similar mis-gate; see the note in `client/src/config/app-navigation.ts` — finance nav items must not
  be gated with an `entity:action` string in `requiredPathPermissions`, which is evaluated as a path.)

## Audit & rollback

- Every apply writes a row to the audit log with **who**, **what** (template
  name + diff), **why** (your reason), and **when**. Open it from the
  **Change history** button in the page header.
- The role detail panel exposes per-row **notes** on each role-permission and
  user-override so you can leave context next to any custom change.
- A rework-day snapshot (`qa/fixtures/permission-snapshot-pre-rework.json`)
  is checked into the repo and a CI test fails on any drift, so you have an
  irrefutable baseline of "what worked the day we cut over".

## For developers

Backend handlers must use `requirePermission(entity, action)` from
`server/permission-middleware.ts`.

**CI guard scope (read this carefully).** The route-permission coverage test
at `qa/tests/unit/route-permission-coverage.test.ts` runs in two parts:

1. **Hard fail — new routes.** Any *new* route added after the cutover that
   isn't reached by `requirePermission` (or by a documented allow-list
   entry, or annotated with `// permission-skip:` + reason) fails CI
   immediately. This is the line the rework defends.
2. **Baseline burndown — legacy routes.** The existing 606-route surface
   that was already in the codebase before Task #101 is captured in a
   *legacy baseline allow-list*. Those routes still get traffic and most
   are gated by the older `requireAdmin` / `requireRole` shims (which now
   delegate to `requirePermission` — same evaluator). Migrating each
   legacy route over to the canonical decorator is **deferred to follow-up
   Task #102** so the cutover stayed the size of one reviewable PR. The
   burndown task drives that allow-list to zero.

In other words: the rework guarantees no *regression* in route coverage
and full coverage on every new route, but it does not flip every legacy
route to the new decorator in this same change. That work is tracked.

Frontend code must use `<PermissionGate>` or `usePermission()` from
`client/src/components/PermissionGate.tsx` and `client/src/hooks/use-permissions.ts`.
Avoid `user.role === "…"` checks in new code — they bypass overrides.
A small first wave of legacy `user.role === "…"` call sites was migrated
in this rework; the longer tail is tracked under follow-up Task #104.
