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

## The three tabs of `/admin/roles`

| Tab          | Use it when…                                                                  |
| ------------ | ----------------------------------------------------------------------------- |
| **People**   | One person needs more (or less) access. Pick them, pick a template, apply.    |
| **Roles**    | A whole team's permissions need to change. Pick a template, apply to a role.  |
| **Advanced** | You want the full matrix (entity × role × action) — the old admin-roles UI.   |

## Recipes

### "I just hired a new project manager"
1. Open **People**.
2. Search their name.
3. In the *Apply template* dropdown, pick **Project Manager**.
4. Read the plain-English diff (e.g. "*Will gain edit on Engineering, Project
   Phases, Stage Gates*").
5. Type a short reason ("New hire — Sept intake") — this goes into the audit
   log — and click **Apply template**.

### "I want every Engineering Manager to be able to approve POs"
1. Open **Roles**.
2. Find the **Engineering Manager** template.
3. Pick **Apply to role → ENGINEERING_MANAGER**.
4. The diff will show "*Will gain approve on Procurement*". Apply.

### "Someone from Finance needs read-only access to a few projects"
1. Open **Roles**.
2. Apply the **Finance Read-Only** template to their role.
3. Use **Advanced → User Overrides** to grant `projects:view` on the specific
   projects they need.

### "An employee left — revoke everything"
1. Open the user in **People**.
2. Apply the **Read-Only Viewer** template (they can still log in but cannot
   change anything).
3. Disable the user via the SSO console (Azure / Microsoft 365).

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

## Audit & rollback

- Every apply writes a row to the audit log with **who**, **what** (template
  name + diff), **why** (your reason), and **when**.
- The Advanced tab includes per-row **notes** so you can leave context next to
  any custom override.
- A rework-day snapshot (`qa/fixtures/permission-snapshot-pre-rework.json`)
  is checked into the repo and a CI test fails on any drift, so you have an
  irrefutable baseline of "what worked the day we cut over".

## For developers

Backend handlers must use `requirePermission(entity, action)` from
`server/permission-middleware.ts`. The CI guard at
`qa/tests/unit/route-permission-coverage.test.ts` will fail the build if a
new route is added without it (or without a documented `// permission-skip:`
comment).

Frontend code must use `<PermissionGate>` or `usePermission()` from
`client/src/components/PermissionGate.tsx` and `client/src/hooks/use-permissions.ts`.
Avoid `user.role === "…"` checks in new code — they bypass overrides.
