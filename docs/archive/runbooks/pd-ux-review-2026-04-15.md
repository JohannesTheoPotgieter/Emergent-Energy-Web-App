# PD UX Review & Safe Relabelling (2026-04-15)

Status: implemented on branch
`claude/improve-pipedrive-integration-2cllX`. Changes are narrow, additive
or label-only, and do not touch routes, permissions, data, handover
logic, or the Pipedrive integration boundary.

This follows the backend PD workflow review in
`docs/runbooks/pd-workflow-review-2026-04-15.md`. It is the UI half: now
that the backend can distinguish Pipedrive-synced from internal
opportunities and knows the difference between the three PD concerns,
the UI needs to say so too.

---

## 1. UX findings by page

### `/pd` — PD dashboard (`client/src/pages/pd-dashboard.tsx`)

Proven facts:
- Title "Project Development", subtitle was "PD ticket overview and quick
  actions" — pigeonholes PD as a ticket-only concern.
- Layout: top KPI strip (6 ticket stats) → "Pipeline Summary" (kanban
  columns + request-type tags) → "Handover Readiness" block → recent
  tickets / kanban toggle.
- Fetches `/api/pd/dashboard`, `/api/pd/tickets`, `/api/pd/pipeline`,
  `/api/pd-pm-handover/control`. Does **not** fetch `/api/opportunities`
  — the commercial pipeline was invisible on this page.
- "Pipeline Summary" sounds commercial but is actually the ticket
  pipeline, which is confusing because the real commercial pipeline
  lives on `/opportunities`.

Problems:
- No commercial pipeline visibility on the page the PD team lands on.
- "Pipeline Summary" label is a landmine — reads like "sales pipeline"
  but is actually work-queue kanban by ticket status.
- Subtitle undersells the page.

### `/pd/tickets` — PD ticket list (`client/src/pages/pd-tickets.tsx`)

Proven facts:
- `REQUEST_TYPES` hard-coded list has 14 entries
  (pd-tickets.tsx:20 before fix).
- `REQUEST_TYPES` in `pd-ticket-create.tsx:36` has only 8.
- Result: the filter lets users filter by types (`CP - PVSOL`,
  `Sizing Rational Request`, etc.) that new tickets cannot be created
  with. Zero documentation of which are legacy.
- Column header "Tasks" refers to sub-tasks spawned from the ticket's
  request-type template (`PD_REQUEST_TYPE_TASK_TEMPLATES`). The word
  "Tasks" here collides with the top-level "Tasks" concept elsewhere in
  the app (My Work → Tasks).

Problems:
- Two divergent `REQUEST_TYPES` lists — whichever drifts, the other
  lies.
- "Tasks" column is ambiguous.

### `/pd/tickets/create` — Create form

Proven facts:
- 3-step wizard: client → project → ticket details.
- Hard-codes its own `REQUEST_TYPES` list (the 8-entry one). Also
  hard-codes `PRIORITIES`, `FUNDING_TYPES`, `PROVINCES` inline.
- Everything else looks sound — requires project linkage upstream which
  is intentional.

Problems:
- Hard-coded constants are not shared with the list page. See above.

### `/pd/reports` — PD reports (`client/src/pages/pd-reports.tsx`)

Proven facts:
- `showInSidebar: false` in page-registry.ts → reachable only via the
  Reports button on the PD dashboard, not discoverable in nav.
- Page title "PD Reports" with no maturity signal. Renders throughput,
  pipeline health, handover cycle time.
- Fetches `/api/pd/reports`. The backend computes metrics on the fly.

Problems:
- Hidden page pretends to be production-grade. Users reaching it via
  the dashboard link have no signal that this is an internal view and
  not part of the governed reporting surface.

### `/opportunities` — Opportunities list (`client/src/pages/opportunities.tsx`)

Proven facts:
- Stage filter: prospect / qualification / proposal / negotiation / won
  / lost. No source filter, no visible distinction between Pipedrive-
  synced and internal rows.
- Header eyebrow "Project Development", icon `Sun` — duplicate with
  `/pd` in the sidebar (both use `Sun`).
- Row renders stage badge + contract type + value + close date, nothing
  about origin.

Problems:
- Users cannot tell a synced row from an internal one until they try to
  edit a CRM-owned field and lose it on the next sync (now warned by
  the backend `_warning` string, but not surfaced on the list).
- Icon collision with `/pd`.

### `/clients` — Clients list

Proven facts:
- In `PROJECTS` navGroup, not `PROJECT_DEVELOPMENT`, but exposed as
  "Clients" in the app-navigation Project Development secondary nav.
- 3 API calls (`/api/pd/clients`, project-counts, projects-summary),
  expandable rows.

Problems:
- Minor — the `navGroup` mismatch with the visible section is
  confusing if anyone greps for it, but the behaviour is correct.
  Not fixed here; documentation-only observation.

### `/pd/handover/:projectId` — PD→PM handover form (1019 lines)

Proven facts:
- 9-tab wizard with a readiness checklist, role-gated inputs, explicit
  `disabled={!pdCanEdit}` throughout.
- Status mapping correctly uses `project_pd_pm_handover.status` as the
  authoritative source (not the deprecated
  `opportunities.handover_readiness`).
- Registered in page-registry.ts as `label: "PD to PM Handover"`.

Problems:
- None on the page itself. The page-registry label collides with
  `/handover-control` which was also called "PD to PM Handover".
  **Confusing to anyone reading the registry.** Fixed by renaming the
  registry entry for `/handover-control` (see below).

### `/handover-control` — Handover control (`handover-control.tsx`)

Proven facts:
- Page title inside the component: "Handover Health Score".
- `showInSidebar: true`, in `PROJECT_MANAGEMENT` navGroup.
- page-registry.ts label: **"PD to PM Handover"** — identical to the
  per-project form above.

Problems:
- The registry label tells users this is the form, but it is actually
  the COO-level health dashboard. Direct cause of the duplicate-label
  smell the audit flagged.

---

## 2. Misleading labels / mixed mental models (summary)

| Surface                            | Old wording                                 | Issue                                                                 |
| ---------------------------------- | ------------------------------------------- | --------------------------------------------------------------------- |
| `/pd` subtitle                     | "PD ticket overview and quick actions"      | Understates PD; hides the commercial pipeline and handover concerns.  |
| `/pd` "Pipeline Summary" section   | "Pipeline Summary"                          | Reads as commercial; actually a ticket kanban.                        |
| `/pd/tickets` "Tasks" column       | "Tasks"                                     | Collides with the top-level My Work → Tasks concept.                  |
| `/pd/tickets` filter               | One hard-coded list of 14                   | Out of sync with `/pd/tickets/create`'s list of 8. No legacy marker.  |
| `/pd/reports`                      | "PD Reports", hidden from sidebar           | No maturity signal. Ships a hidden, ungoverned reporting surface.     |
| `/opportunities`                   | No origin badge                             | Cannot tell CRM-synced from internal without a round trip.            |
| `/opportunities` sidebar icon      | `Sun` — same as `/pd`                       | Indistinguishable icons in the Project Development group.             |
| `/handover-control` registry label | "PD to PM Handover"                         | Identical to `/pd/handover/:projectId`. Not the same thing.           |

---

## 3. Exact components / files changed

Created:
- `client/src/lib/pd/request-types.ts` — canonical
  `PD_REQUEST_TYPES_ACTIVE` (8) and `PD_REQUEST_TYPES_FILTERABLE` (14,
  active ∪ legacy) with a comment explaining the split.
- `client/src/components/ui/maturity-badge.tsx` — reusable
  `<MaturityBadge level="internal" | "preview" | "beta" />` pill that
  uses the existing `Badge` primitive and avoids "Pro"/"Smart"/"AI"
  language.
- `docs/runbooks/pd-ux-review-2026-04-15.md` — this file.

Edited:
- `client/src/config/page-registry.ts`:
  - Line for `handoverControl`: label "PD to PM Handover" → "Handover
    Control". Resolves the duplicate label.
  - Line for `opportunities`: iconKey `"Sun"` → `"TrendingUp"`. Resolves
    the icon collision with `/pd`.
- `client/src/pages/pd-dashboard.tsx`:
  - Subtitle: "PD ticket overview and quick actions" → "Commercial
    pipeline, PD work queue, and PD→PM handover readiness."
  - New additive query to `/api/opportunities` (retry: 0, block hides
    if it fails or returns nothing).
  - New section "Commercial pipeline (Opportunities)" with 4 tiles
    (Active, Won, Synced from Pipedrive, Internal), a pipeline-value
    badge, and a "View all" link to `/opportunities`.
  - Renamed "Pipeline Summary" → "PD work queue" with a
    `FileEdit` icon. Section value badge relabelled "Tickets value" so
    it is clearly about the work queue and not a sales number.
  - Renamed "Handover Readiness" → "PD → PM handover readiness" with a
    `Handshake` icon. CTA copy: "View handover control".
- `client/src/pages/pd-tickets.tsx`:
  - `REQUEST_TYPES` now imports `PD_REQUEST_TYPES_FILTERABLE` from the
    new constants file. Filter behaviour is unchanged (same 14 values).
  - Column header "Tasks" → "Sub-tasks" with a title tooltip
    clarifying these are spawned from the ticket's request-type
    template.
- `client/src/pages/pd-ticket-create.tsx`:
  - `REQUEST_TYPES` now imports `PD_REQUEST_TYPES_ACTIVE`. Select
    options are unchanged (same 8 values).
- `client/src/pages/pd-reports.tsx`:
  - Header now renders `<MaturityBadge level="internal" />` beside the
    title.
  - Subtitle now explicitly states "Internal view — metrics here are
    computed on-the-fly and not yet part of the governed reporting
    surface. Not shown in the sidebar."
- `client/src/pages/opportunities.tsx`:
  - `OpportunityRow` interface gained `source?: string | null` and
    `pipedriveDealId?: string | null`.
  - Section eyebrow icon changed from `Sun` to `TrendingUp`.
  - Description now reads: "Commercial pipeline. N row(s) total — rows
    marked 'Pipedrive' are synced from the CRM and will be overwritten
    on the next sync run. 'Internal' rows are app-owned."
  - Each opportunity row now renders a "Pipedrive" (info) or "Internal"
    (secondary) badge with a `title` tooltip explaining the overwrite
    semantics.

---

## 4. Exact copy / labels updated

| File                                           | From                                          | To                                                                                             |
| ---------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `page-registry.ts` — `handoverControl`          | `label: "PD to PM Handover"`                  | `label: "Handover Control"`                                                                    |
| `page-registry.ts` — `opportunities`            | `iconKey: "Sun"`                              | `iconKey: "TrendingUp"`                                                                        |
| `pd-dashboard.tsx` — subtitle                   | `"PD ticket overview and quick actions"`      | `"Commercial pipeline, PD work queue, and PD→PM handover readiness."`                          |
| `pd-dashboard.tsx` — section heading            | `"Pipeline Summary"`                          | `"PD work queue"`                                                                              |
| `pd-dashboard.tsx` — pipeline value badge       | `"Pipeline Value: R …"`                       | `"Tickets value: R …"`                                                                         |
| `pd-dashboard.tsx` — section heading            | `"Handover Readiness"`                        | `"PD → PM handover readiness"`                                                                 |
| `pd-dashboard.tsx` — handover link              | `"View control center"`                      | `"View handover control"`                                                                      |
| `pd-tickets.tsx` — column header                | `"Tasks"`                                     | `"Sub-tasks"` (with `title` tooltip)                                                           |
| `pd-reports.tsx` — header                       | `"PD Reports"` + `{fyLabel}`                  | `"PD Reports"` + `MaturityBadge` + "Internal view — metrics here are computed on-the-fly …"   |
| `opportunities.tsx` — description               | `"N opportunities in pipeline"`               | `"Commercial pipeline. N row(s) total — rows marked 'Pipedrive' are synced from the CRM …"`    |
| `opportunities.tsx` — row                       | No origin badge                              | `Pipedrive` (info) or `Internal` (secondary) badge with tooltip                                 |

The only previously-existing behaviour changed by these edits is the
column header text "Tasks" → "Sub-tasks" in the PD tickets list, which
is purely cosmetic.

---

## 5. Safe UI diff plan

The changes were applied in this order so each one is independently
reviewable and rollback-safe:

1. **page-registry relabel** (single-line edits, no runtime effect on
   permission checks because the `id`, `path`, `permissionEntity`, and
   `navGroup` are unchanged).
2. **New constants file** `client/src/lib/pd/request-types.ts` —
   zero runtime effect until imported.
3. **Switch both PD ticket pages to import the constants** — values are
   unchanged from what they already had.
4. **Add `MaturityBadge` component** — no effect until imported.
5. **Apply `MaturityBadge` + copy to `/pd/reports`** — add-only.
6. **Rename `Tasks` → `Sub-tasks`** — one column header plus a
   `title` tooltip.
7. **Restructure `/pd` dashboard headings + add opportunities block**
   — additive fetch (retries=0, block hides on empty or error). The
   existing sections keep working unchanged.
8. **Opportunities list source badge** — type extension + additional
   rendered elements per row. No existing logic altered.

If any step causes regressions it can be reverted in isolation.

---

## 6. Changed-state descriptions (no screenshots available)

Because this is a headless repo and the dev server is not running,
here are text descriptions of what the user will now see.

**`/pd` landing page (logged-in PD user, permissions intact)**

1. Title row unchanged: "Project Development" icon, "Reports" button,
   "New PD Ticket" button.
2. Subtitle under the title now reads: *"Commercial pipeline, PD work
   queue, and PD→PM handover readiness."*
3. Top 6-card KPI strip unchanged (Total, Active, Overdue, Due This
   Week, On Hold, Completed).
4. **New block:** "Commercial pipeline (Opportunities)" — four small
   cards: *Active in pipeline / Won (closed) / Synced from Pipedrive /
   Internal (app-only)*. A value pill on the right reads
   *"R X active"* when the active pipeline value is non-zero, and a
   "View all" link navigates to `/opportunities`. A one-line caption
   underneath explains "Pipedrive is the CRM source of truth for
   synced deals. Internal opportunities are app-only."
5. **Renamed:** "PD work queue" (was "Pipeline Summary"). Same kanban
   columns, same request-type tags, same overdue callout. Value pill
   now reads "Tickets value: R …" so it is not confused with
   commercial pipeline value.
6. **Renamed:** "PD → PM handover readiness" (was "Handover
   Readiness"), with a handshake icon. CTA: "View handover control"
   (was "View control center"). Same 4 cards, same rejected alert.
7. Recent tickets / Kanban toggle unchanged below.

**`/pd/tickets`**

- Column header reads "Sub-tasks" (was "Tasks") with a hover tooltip
  explaining these are template-spawned sub-tasks. Column body
  unchanged.
- Filter "Type" dropdown contents unchanged in value, but the list is
  now imported from the canonical constants file so the create form
  and the filter cannot drift apart.

**`/pd/tickets/create`**

- No visible change. Internally, the `REQUEST_TYPES` select is now
  imported from the canonical constants file.

**`/pd/reports`**

- Title row: "PD Reports" followed by a small grey "INTERNAL" badge.
- Subtitle now explicitly says this is an internal view of metrics
  computed on the fly and not part of the governed reporting surface.
- All metrics/tables unchanged.

**`/opportunities`**

- Icon in the eyebrow changed from a `Sun` to `TrendingUp` so the
  sidebar / breadcrumb no longer collides with `/pd`.
- Description line updated to state the Pipedrive vs Internal split
  explicitly.
- Each row now shows either a blue `Pipedrive` pill or a grey
  `Internal` pill next to the stage and contract-type badges. Hovering
  the Pipedrive pill shows a tooltip: *"Synced from Pipedrive. Stage,
  status, estimated value, expected close date, signed date and
  client will be overwritten on the next sync. Notes and commercial
  risks are app-owned and are preserved."*

**Sidebar / breadcrumbs**

- The real sidebar is built from `client/src/config/app-navigation.ts`
  (TOP_SECTIONS), which already uses sane labels ("PD Dashboard",
  "Pipeline / Opportunities", "PD Tickets", "Clients", "Handover
  Queue"). No changes were needed there.
- Breadcrumbs and any code that looks up labels through
  `client/src/config/page-registry.ts` now get "Handover Control"
  instead of the duplicate "PD to PM Handover", and the
  `Opportunities` entry has a distinct icon key.

---

## 7. Untouched risky areas (intentional)

These would be worthwhile follow-ups but are out of scope for a UX
clarity pass:

- **Clients page `navGroup` vs visible section mismatch.** `clients` is
  in `PROJECTS` navGroup in the registry but appears under
  "Project Development" in the visible nav. Not broken; just confusing
  in code.
- **Hard-coded `PRIORITIES`, `FUNDING_TYPES`, `PROVINCES`,
  `PROJECT_TYPES`, `SYSTEM_TYPES`, `FUNDING_MODELS`, `RISK_CATEGORIES`,
  `STAKEHOLDER_ROLES` in each form.** These should also move to shared
  constants, but each needs its own audit for what is "active" vs
  "legacy". Not done here — only PD request types were fixed.
- **The 1019-line `pd-pm-handover-v2.tsx`** page is left alone on
  purpose. It works, it is role-gated correctly, and a UX pass on a
  9-tab handover wizard deserves its own design review.
- **`data-testid` attributes** are still present in production code.
  Removing them is a codebase-wide cleanup, not a UX fix.
- **Kanban view** on the PD dashboard is left alone. It loads from the
  real pipeline API and works; any redesign is a separate product
  decision.
- **`opportunities.handoverReadiness` field** is still written by no
  one and read by nothing in the UI. The backend runbook marks it
  `@deprecated`. The UI review intentionally does not surface or
  remove it.

---

## 8. Regression risks

- **`page-registry.ts` label change for `/handover-control`.** Any
  code that does a label-string lookup against the registry (rare,
  mostly deep-link breadcrumb titles) will now see "Handover Control"
  instead of "PD to PM Handover". No usages of the old string were
  found. The `id`, `path`, and permission entity are unchanged, so
  access control is unaffected.
- **`/opportunities` additive fetch on the PD dashboard.** If
  `/api/opportunities` is slow or errors out, the new block simply
  does not render (retries=0, block is gated on `total > 0`). The
  rest of the dashboard is unaffected because the fetch does not
  block the main render.
- **Opportunities list row shape extension.** `OpportunityRow` now
  declares `source` and `pipedriveDealId` as optional. Existing rows
  without these fields still render as "Internal".
- **`MaturityBadge` is a new component.** Only used on `/pd/reports`
  so far. Does not affect any other page.
- **Constants file split.** The `PD_REQUEST_TYPES_FILTERABLE` union is
  identical to the former hard-coded 14-value list; the
  `PD_REQUEST_TYPES_ACTIVE` list is identical to the former 8-value
  create-form list. Runtime behaviour is bit-for-bit identical.
- **No route added, no route removed.** No permission change. No data
  migration. The handover pages, Pipedrive sync boundary, project /
  client linkage, and business rules are untouched.

---

## 9. Manual QA checklist

1. **Sidebar / top nav**
   - [ ] `/pd` and `/opportunities` show as distinct entries in the
         Project Development group; icons are visually different.
   - [ ] `/handover-control` breadcrumb title reads "Handover Control"
         (breadcrumb code may or may not surface this — spot check).
2. **`/pd` dashboard**
   - [ ] Subtitle reads: "Commercial pipeline, PD work queue, and
         PD→PM handover readiness."
   - [ ] A "Commercial pipeline (Opportunities)" block appears above
         the PD work queue block, with four tiles. Clicking any tile
         or "View all" navigates to `/opportunities`.
   - [ ] The work-queue kanban block's heading reads "PD work queue".
         Value pill reads "Tickets value: R …" when non-zero.
   - [ ] The handover block heading reads "PD → PM handover readiness".
3. **`/pd/tickets`**
   - [ ] Column header between Developer and Next Action reads
         "Sub-tasks" with a hover tooltip.
   - [ ] Type filter still includes the 14 values it did before (CP -
         PVSOL, Sizing Rational Request, etc.).
   - [ ] Creating a new ticket on `/pd/tickets/create` only shows the
         8 active request types.
4. **`/pd/reports`**
   - [ ] Title row shows a grey "INTERNAL" pill next to "PD Reports".
   - [ ] Subtitle mentions "Internal view" and "not yet part of the
         governed reporting surface".
5. **`/opportunities`**
   - [ ] Description under the page title mentions both Pipedrive and
         Internal rows.
   - [ ] Pipedrive-sourced rows show a blue "Pipedrive" pill; others
         show a grey "Internal" pill.
   - [ ] Hovering the Pipedrive pill surfaces the tooltip explaining
         which fields are overwritten on sync.
   - [ ] The `Sun` icon in the eyebrow is gone; `TrendingUp` is shown.
6. **Regressions to watch for**
   - [ ] Permission checks on `/pd`, `/pd/tickets`, `/pd/reports`,
         `/opportunities`, `/pd/handover/:projectId`,
         `/handover-control` still behave as before.
   - [ ] Pipedrive sync still works end-to-end (admin page unchanged).
   - [ ] PD→PM handover form, gates, and history unchanged.
   - [ ] Client and project linkage unchanged.

---

End of review.



