# PD Release Safety — Test Coverage & QA Checklist (2026-04-15)

Branch: `claude/improve-pipedrive-integration-2cllX`

---

## 1. Current test coverage assessment

### Existing tests (before this branch)

| File | Type | What it tests |
|---|---|---|
| `qa/tests/api/workflow-critical-pack.test.ts` | API | PD ticket create → view → spawn-tasks idempotency |
| `qa/tests/api/pd-pm-handover-formal-process.test.ts` | API | Handover submit with readiness gaps, snapshot |
| `qa/tests/unit/pd-pm-handover-route-contract.test.ts` | Source | Handover history record types in source |
| `qa/tests/unit/pd-pm-handover-page.test.ts` | Source | Thin placeholder |
| `qa/tests/unit/action-access.test.ts` | Unit | pd_tickets:create gating on quick-create |
| `qa/tests/unit/role-based-upgrade.test.ts` | Unit | Entity permission defaults for all roles |
| `qa/tests/unit/permission-resolver.test.ts` | Unit | DB override vs default fallback |
| `qa/tests/unit/project-client-linkage-contract.test.ts` | Source | Client linkage on project create |

### Critical gaps (all addressed in this commit)

| Gap | Risk | Test added |
|---|---|---|
| Opportunity CRUD permission entity alignment | **High** — wrong entity = wrong access control | `opportunity permission alignment` (7 assertions) |
| Pipedrive sync notes preservation | **High** — data loss on every sync run | `pipedrive sync safety` (7 assertions) |
| Client ID generation race safety | **High** — duplicate client IDs on concurrent create | `PD data trust` (3 assertions) |
| Project creation from opportunity | **Medium** — flagship new feature, untested | `project creation from opportunity` (10 assertions) |
| Permission guards on PD GET routes | **Medium** — previously unguarded, newly added | `permission guards on PD GET routes` (7 assertions) |
| Schema deprecation markers | **Low** — documentation, but catches accidental removal | `schema deprecation markers` (5 assertions) |
| PD request-type consistency | **Low** — catches drift between create form and list filter | `PD request-type consistency` (4 assertions) |
| PD data trust audit logging | **Medium** — catches removal of audit calls | `PD data trust` (6 assertions) |

### New test file

`qa/tests/unit/pd-function-release-safety.test.ts` — 8 describe
blocks, 50+ assertions. Source-code contract tests following the
project's existing pattern (read source, assert critical strings).

---

## 2. Manual QA checklist

Run these in a staging environment with real data and a Pipedrive API
token. Each item references the commit that introduced the behaviour
being tested.

### Pipedrive sync (commit `38eb080`)

- [ ] Open `/admin/pipedrive`. Click "Sync Now".
- [ ] Verify the sync completes and the log shows "completed" (green).
- [ ] Pick a synced opportunity. Edit its `notes` to "Test note".
- [ ] Run sync again. Verify `notes` still says "Test note" (not
      overwritten).
- [ ] Verify the opportunity's `source` field is "pipedrive".
- [ ] Start a second sync while the first is running (two tabs). The
      second should return 409 "Sync already in progress".

### Opportunities (commits `7a03251`, `cf3d681`)

- [ ] As a KEY_ACCOUNTS_MANAGER, open `/opportunities`. Verify the
      page loads (was previously blocked — now has
      `opportunities:view`).
- [ ] Create a new opportunity. Verify it has a grey "Internal" badge.
- [ ] Edit a Pipedrive-synced opportunity's stage. Verify the response
      includes a `_warning` about CRM overwrite.
- [ ] Check `audit_events` for `entityType='opportunity'` entries.
- [ ] As an ENGINEER, try to access `/api/opportunities` directly.
      Verify 403.

### PD tickets (commits `162e8a9`, `cf3d681`)

- [ ] Create a PD ticket with all required fields (projectId,
      requestType, dueDate, projectSiteName). Verify 201.
- [ ] Verify `audit_events` has `entityType='pd_ticket'`,
      `action='create'`.
- [ ] Try creating a PD ticket without `projectId`. Verify 400.
- [ ] Edit a ticket's status. Verify audit log captures the change.
- [ ] As a role without `pd_tickets:view`, try GET `/api/pd/tickets`.
      Verify 403.

### Clients (commits `162e8a9`, `cf3d681`)

- [ ] Create a client via `/api/pd/clients`. Verify the `clientId`
      is `EE-Cxxxx` format.
- [ ] In two tabs, simultaneously create two clients. Both should
      succeed with sequential IDs (no collision).
- [ ] PATCH a client with `primaryContactEmail`. Verify it persists.
- [ ] PATCH a client with `billingEmail` (old broken field). Verify
      400.

### Project creation from opportunity (commits `768086f`, `5ea180f`, `dae1447`)

- [ ] On the opportunities list, click the `FolderPlus` icon on an
      active opportunity. Verify it navigates to
      `/project-create?opportunityId=X`.
- [ ] Verify the blue conversion banner shows the opportunity's
      notes, value, and Pipedrive/Internal badge.
- [ ] Verify the client field is pre-filled from the opportunity.
- [ ] Submit the form. Verify the project is created with
      `opportunityId` linked.
- [ ] Check `audit_events` for `action='create_from_opportunity'`.
- [ ] Try converting a "prospect" stage opportunity. Verify the amber
      advisory banner appears (before submission) and the
      `_earlyStageAdvisory` appears (after submission).
- [ ] Try converting the same opportunity again. Verify the amber
      `_duplicateConversionWarning` appears on the success screen.
- [ ] As a role WITHOUT `create_project:edit` permission, verify the
      `FolderPlus` button is NOT visible on opportunity rows.

### PD→PM handover (existing — regression check)

- [ ] Open `/pd/handover/:projectId` for a project in DRAFT status.
- [ ] As a PD role, edit the form, save draft. Verify it saves.
- [ ] Complete the readiness checklist to 100%. Submit for PM review.
- [ ] As a PM role, open the same handover. Accept it.
- [ ] Verify the project phase advances and history records
      `PD_PM_HANDOVER_ACCEPTED`.
- [ ] Test the reject flow: submit another handover, reject it with a
      reason, verify the rejection appears in history.

### PD dashboard (commit `c89bf7a`)

- [ ] Open `/pd`. Verify three sections visible: "Commercial pipeline
      (Opportunities)", "PD work queue", "PD → PM handover readiness".
- [ ] Verify the "Tickets value" badge does NOT include opportunity
      values (separate from pipeline value in the opportunities
      section).

### PD reports (commit `3cd1e66`)

- [ ] Open `/pd/reports` via the dashboard Reports button.
- [ ] Verify the "INTERNAL" maturity badge is visible.
- [ ] Verify four sections: Commercial Funnel, PD Work Queue —
      Throughput, PD Work Queue — Active State, PD → PM Handover.
- [ ] Verify the "Active By Status" chart shows FY-scoped data (not
      all-time system totals).

### Permission boundary (commit `cf3d681`)

- [ ] As CCO, create a PD ticket. Should succeed (was blocked by
      hardcoded `canCreatePdTicket` before; now uses central
      permissions).
- [ ] As PROGRAM_FINANCE_MANAGER, access `/api/opportunities`.
      Should return data (they have `opportunities:view`).
- [ ] As ENGINEER, access `/api/pd/dashboard`. Should return 403.

---

## 3. Release risk summary

### Low risk (contained, tested)

- Pipedrive sync notes preservation — source-code contract test +
  behaviour was already running in production-equivalent since commit
  `38eb080`.
- Permission entity alignment — source-code contract test asserts the
  correct entity is used and tests the resolver evaluates correctly.
- Schema deprecation markers — contract test catches removal.
- Request-type consistency — contract test catches drift.

### Medium risk (new functionality, tested at source level only)

- **Project creation from opportunity** — the conversion flow is new
  and has 10 source-level assertions. But no API-level test exists
  because the test environment has no DB. Manual QA is critical.
- **Permission guards on PD GET routes** — newly added, could cause
  403s for roles that previously had auth-only access (ENGINEER,
  ACCOUNTANT). The change is correct but may surface as user
  complaints. Monitor after deploy.
- **Client ID advisory lock** — race condition fix. Tested at source
  level (advisory lock present) but the actual lock behaviour cannot
  be tested without concurrent DB connections.

### Regression risks to watch

- **CCO can now create PD tickets** — the hardcoded `canCreatePdTicket`
  check that excluded CCO was removed. The central permission table
  always allowed it. Verify CCO users are not confused by the change.
- **Backfill routes now require admin** — any tooling that called
  `/api/admin/backfill/*` without an admin role will now get 403.
- **Opportunities zod schema tightened** — the dead `name` field is
  gone. Any external script sending `name` will get 400.

---

End of release safety doc.
