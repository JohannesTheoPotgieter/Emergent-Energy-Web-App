# Feedback & Support (`/feedback`)

**Source file:** `client/src/pages/feedback.tsx` (427 lines)
**Route:** `/feedback` (`page-registry.ts` id `feedback`)
**Permission entity:** `feedback` (`usePermission('feedback', 'view')` gates
the body of the page after the query succeeds; a client-side
"Access Denied" card renders if the user lacks it).
**Nav group:** `KNOWLEDGE`, sidebar label "Feedback & Support"

## Purpose
Lightweight issue tracker for end users to file bug reports or feature
requests. Admins can triage: change status, reassign priority, and leave an
"Admin response" note that becomes visible on the ticket card.

## How the view is populated

- **Ticket list** (`feedback.tsx:88` — `useQuery({ queryKey: ["/api/feedback"], queryFn: apiFetch("/api/feedback") })`)
  - API: `GET /api/feedback`
  - Handler: `server/routes/support-extracted-routes.ts:541`
  - Query: `db.select().from(feedbackTickets).where(isNull(feedbackTickets.deletedAt)).orderBy(desc(feedbackTickets.createdAt))`
  - Reads table: **`feedback_tickets`**
  - Populates:
    - `tickets[]` rendered as cards (`feedback.tsx:237`)
    - The 4 KPI cards (`stats.total`, `stats.open`, `stats.inProgress`,
      `stats.resolved` — computed client-side at `feedback.tsx:139`)
    - The empty-state card when `filteredTickets.length === 0`

`apiFetch` is a hand-rolled wrapper at `feedback.tsx:55` that attaches the
`Authorization: Bearer <localStorage.auth_token>` header — this page does
**not** use the shared `lib/queryClient` fetcher.

## Buttons / Actions (exhaustive)

- **"New Report"** (`data-testid="button-new-ticket"`, `feedback.tsx:172`)
  - `onClick={() => setShowForm(true)}` — opens the "Submit Feedback" dialog.
  - No API call. UI state only.

- **Type toggle inside dialog — "Bug Report"** (`button-type-bug`, `feedback.tsx:292`)
  - `onClick={() => setFormType("bug")}` — pure UI state.

- **Type toggle inside dialog — "Feature Request"** (`button-type-feature`, `feedback.tsx:301`)
  - `onClick={() => setFormType("feature")}` — pure UI state.

- **"Submit"** (submit dialog footer, `button-submit-ticket`, `feedback.tsx:350`)
  - `onClick={handleSubmit}` → `feedback.tsx:118`. Validates both
    `formTitle` and `formDescription` are non-empty (toast "Missing fields"
    otherwise).
  - Mutation: `submitMutation` (`feedback.tsx:93`)
  - Call: `apiFetch("/api/feedback", { method: "POST", body: JSON.stringify({ type, title, description, priority }) })`
  - API: `POST /api/feedback`
  - Handler: `server/routes/support-extracted-routes.ts:550`
  - Body validated server-side; INSERTs into **`feedback_tickets`**
    (`type`, `title`, `description`, `priority`, `submittedBy`,
    `submittedByName`). Also logs to audit via `logAuditFromReq` →
    **`audit_events`**.
  - Side effects on success:
    - `queryClient.invalidateQueries(["/api/feedback"])` (re-fetches the
      list)
    - Closes dialog (`setShowForm(false)`)
    - Resets form state (`formTitle`, `formDescription`, `formPriority`,
      `formType`)
    - Toast: "Submitted — Your feedback has been submitted successfully."
  - On failure: toast "Error" with the thrown message.

- **"Cancel"** inside submit dialog (`button-cancel-ticket`, `feedback.tsx:349`)
  - `onClick={() => setShowForm(false)}` — UI state only.

- **"Manage"** per-ticket button (admin-only, `button-manage-${id}`,
  `feedback.tsx:272`)
  - `onClick={() => openAdminDialog(ticket)}` → seeds
    `adminStatus`, `adminNotes`, `adminPriority` from the ticket and
    opens the admin dialog.
  - No API call until "Save Changes" is pressed.

- **"Save Changes"** admin dialog footer (`button-save-admin`, `feedback.tsx:414`)
  - `onClick={() => updateMutation.mutate({ id, status: adminStatus, adminNotes, priority: adminPriority })}`
  - Mutation: `updateMutation` (`feedback.tsx:109`)
  - API: `PATCH /api/feedback/:id`
  - Handler: `server/routes/support-extracted-routes.ts:572`
    (`requireAuth`, `requireAdmin`)
  - `db.update(feedbackTickets).set({ status, adminNotes, priority, updatedAt: new Date() })` → **`feedback_tickets`** (UPDATE)
  - Also logs to **`audit_events`** via `logAuditFromReq`.
  - Side effects: invalidates `["/api/feedback"]`, closes dialog, toast
    "Updated — Ticket updated successfully."

- **"Cancel"** inside admin dialog (`feedback.tsx:413`)
  - `onClick={() => setAdminDialog(null)}` — UI state only.

- **Type filter `SearchableSelect`** (`select-type-filter`, `feedback.tsx:198`)
  - `onValueChange={setTypeFilter}` — filters `tickets[]` client-side
    (`feedback.tsx:133`). Options: `all`, `bug`, `feature`.
  - No API call.

- **Status filter `SearchableSelect`** (`select-status-filter`,
  `feedback.tsx:210`)
  - `onValueChange={setStatusFilter}` — filters client-side. Options:
    `all`, `open`, `in_progress`, `resolved`, `closed`.
  - No API call.

- **"Retry"** button from `PageError` (shown on query error)
  - `onRetry={() => refetch()}` — re-runs the `GET /api/feedback`
    query.

> `DELETE /api/feedback/:id` (handler at `support-extracted-routes.ts:589`)
> exists but is **not wired to any button** in the current page — there is
> no UI path to delete a ticket from the frontend.

## Forms / Inputs

### Submit Feedback dialog (`feedback.tsx:283`)

| Field | Input id | Type | Validation | Target in `POST /api/feedback` body |
|-------|----------|------|------------|-------------------------------------|
| Type  | n/a (button pair) | enum | `bug` or `feature` | `type` |
| Title | `#fb-title` | text | required, trim non-empty | `title` |
| Description | `#fb-desc` | textarea (4 rows) | required, trim non-empty | `description` |
| Priority | `SearchableSelect` | enum | one of `low`, `medium`, `high`, `critical` | `priority` |

### Manage Ticket dialog (admin-only, `feedback.tsx:359`)

Shows read-only `title` and `description`, plus editable:

| Field | Target in `PATCH /api/feedback/:id` body |
|-------|------------------------------------------|
| Status (`select-admin-status`) | `status` — `open` \| `in_progress` \| `resolved` \| `closed` |
| Priority (`select-admin-priority`) | `priority` — `low` \| `medium` \| `high` \| `critical` |
| Admin Notes / Response (`input-admin-notes`, textarea 3 rows) | `adminNotes` |

## Tabs / Sub-views / Filters / Sorts
- No tabs.
- **Type filter**: `all` (default) / `bug` / `feature` — client-side filter.
- **Status filter**: `all` / `open` / `in_progress` / `resolved` / `closed`
  — client-side filter.
- **Sort**: fixed, controlled by the server — tickets come back ordered by
  `feedback_tickets.createdAt DESC`.

## Numbers / Counters / KPIs shown
All four are computed on the client from the full `tickets[]` array (not
the filtered view) in `feedback.tsx:139`:

| Card label | Source |
|------------|--------|
| **Total** (`text-total-tickets`) | `tickets.length` |
| **Open** (`text-open-tickets`) | `tickets.filter(t => t.status === "open").length` |
| **In Progress** (`text-progress-tickets`) | `tickets.filter(t => t.status === "in_progress").length` |
| **Resolved** (`text-resolved-tickets`) | `tickets.filter(t => t.status === "resolved" \|\| t.status === "closed").length` |

Each ticket card shows:
- `ticket.title`, `ticket.description`
- Status badge (from `STATUS_CONFIG[ticket.status]`)
- Priority badge (from `PRIORITY_CONFIG[ticket.priority]`)
- `ticket.submittedByName`
- `ticket.createdAt` formatted with `date-fns`: `"dd MMM yyyy HH:mm"`
- `ticket.adminNotes` (if present) — shown as an "Admin response" block

## Dialogs / Modals opened from this page
1. **Submit Feedback dialog** — inline in `feedback.tsx:283`, triggered by
   "New Report". Submits to `POST /api/feedback`.
2. **Manage Ticket dialog** (admin-only) — inline in `feedback.tsx:358`,
   triggered by the per-ticket "Manage" button. Submits to
   `PATCH /api/feedback/:id`.

No other routes are opened — the page has no navigation out.

## Navigation out of this page
None. The page is self-contained.

## Database tables touched
- **`feedback_tickets`** (SELECT / INSERT / UPDATE) — the primary table
  behind this screen. Schema in `shared/schema/collaboration.ts`.
- **`audit_events`** (INSERT) — touched by `logAuditFromReq` on every
  create and every admin update. Schema in `shared/schema/collaboration.ts`.
- **`users`** — not queried directly by the page's handlers, but
  `requireAuth` in `server/middleware` loads the authenticated user from
  `users` to stamp `submittedBy` / `submittedByName`.
