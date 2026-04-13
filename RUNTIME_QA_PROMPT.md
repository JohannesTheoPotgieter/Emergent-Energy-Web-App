# Emergent Energy Platform — Runtime QA & Number Reconciliation Prompt

> **Paste this entire prompt into a Claude Code session that has the Playwright MCP server attached.** The agent will drive a real browser, click through every view as every role, extract every number on the screen, and present them to you for approval. It will **NOT** assert expected values — you are the source of truth on what each number should be.
>
> Companion document: `QA_REVIEW_PROMPT.md` covers data-layer / API integrity. This document covers **runtime UI behaviour and on-screen number reconciliation**.

---

## 0. FILL THESE IN BEFORE RUNNING

```
STAGING_URL       = <https://your-replit-preview-url>
COO_ADMIN_USER    = <username>         # sees everything, can simulate lenses
COO_ADMIN_PASS    = <password>
PM_USER           = <username>         # Project Manager Site
PM_PASS           = <password>
ENGINEER_USER     = <username>
ENGINEER_PASS     = <password>
QUALITY_USER      = <username>
QUALITY_PASS      = <password>
PD_USER           = <username>         # Project Developer / Head of PD
PD_PASS           = <password>
```

If any credential is missing, **stop and ask the user** before proceeding with that role.

> The repo's existing Playwright smoke test at `qa/tests/e2e/smoke.spec.ts` lists reference users (`johannes/2023`, `eon/2035`, `paul/2029`, `dean/2025`). These are local-seed users and will only work on staging if `ENABLE_STARTUP_USER_SEED=true`. Prefer the credentials provided above.

---

## 1. YOUR ROLE & GROUND RULES

You are a **senior runtime QA engineer**. You have access to:

- **Playwright MCP** — drive a real Chromium browser. You can navigate, click, type, screenshot, read DOM, wait for selectors.
- **The repo** at `/home/user/Emergent-Energy-Web-App` — read-only for reference. You may read `client/src/config/app-navigation.ts`, `client/src/config/page-registry.ts`, and any page component to understand what a view *should* render.

### Golden Rules

1. **READ-ONLY behaviour.** Never create, edit, delete, approve, reject, submit, or save anything. No POSTs, PUTs, PATCHes, DELETEs triggered from the UI. If a button would mutate state, **record the button exists and is clickable, but do not click it**. Click only buttons that navigate, open read-only modals, toggle filters/tabs, or expand rows.
2. **Extract, don't assert.** For every number on screen, your job is to *capture* it — not to judge if it's correct. Present numbers in a table to the user for approval.
3. **Screenshot every view.** After the page settles (`networkidle` + 500ms), take a full-page screenshot and save it to `qa/runtime-review/<role>/<route-slug>.png`.
4. **Don't skip errors — log them.** If a view 500s, shows an error toast, has an infinite spinner (>15s), or console logs an error, record it in the Findings section and move on. Do not retry more than twice.
5. **Stop for approval at checkpoints.** After each role's walkthrough is complete, pause and output the Findings + Numbers table for that role. Wait for the user to reply "approved" or "continue" before starting the next role.
6. **Never leave devtools/console noise unrecorded.** Capture every browser console error/warning and every failed network request per view.

---

## 2. APP MAP (reference — don't re-derive)

Stack: React 19 + Vite + Wouter client routing, Express API, Drizzle/Postgres.

**11 top-level nav sections** (from `client/src/config/app-navigation.ts`):

| Section | Default Route | Sub-items (partial) |
|---|---|---|
| HOME | `/` | My Dashboard, My Tasks, Approvals, Calendar, Meetings, Inbox |
| PORTFOLIO | `/lifecycle-board` | Company Overview, Gate Tracker, Blocked Gates, Exceptions |
| PRIORITIES | `/priorities` | My, Department, Company |
| PROJECT_DEVELOPMENT | `/pd` | PD Dashboard, Opportunities, Tickets, Clients, Handover Queue, Reports |
| PROJECT_DELIVERY | `/execution-board` | Execution Dashboard, PM Dashboard, Portfolios, Projects, PO Approvals, Payment Requests/Batches, Milestone Tracker, Sites, Financial Reviews |
| FINANCE | `/cashflow` | Cashflow, Revenue, COS, GP/Margin, FYE Revenue, Counterparties, Subcontractors, Invoice Patterns |
| ENGINEERING | `/engineering` | Engineering Dashboard, Task Board, Standup |
| HSE | `/hse` | HSE Dashboard |
| QUALITY | `/quality` | Quality Dashboard, Commissioning |
| REPORTS | `/reports/center` | Report Center, Programme, PM/Engineering Monthly, Performance |
| ADMIN | `/admin/control-center` | Control Center, Roles & Permissions, Smart Import, Audit Log, Processes & SOPs, Templates, Recovery |

**Roles to test** (each has a different nav visibility and lens):
- COO_ADMIN (super admin — sees everything, can simulate other lenses)
- PROJECT_MANAGER_SITE
- ENGINEER / ENGINEERING_MANAGER
- QUALITY_MANAGER
- PROJECT_DEVELOPER / Head of PD

**Lens simulation**: as COO_ADMIN, you can call `startSimulation(lens, "read_only")` from the UI (look for a lens switcher in the top nav) to view the app as another lens without actually logging out. Use this to shortcut re-testing when creds for a role are not available.

---

## 3. EXECUTION PROCEDURE

Run the following for **each role** in order: `COO_ADMIN`, `PROJECT_MANAGER_SITE`, `ENGINEER`, `QUALITY_MANAGER`, `PROJECT_DEVELOPER`.

### 3.1 Login
1. Navigate to `${STAGING_URL}/auth/login`.
2. Fill username + password (username is lowercased by the client before submit).
3. Submit. Wait for redirect away from `/auth/login`.
4. Capture the landing route — this is that role's default landing page per `DEFAULT_LENS_PROFILES`. Note it.
5. Screenshot the landing page.

### 3.2 Nav enumeration
1. Locate the primary sidebar/top-nav component.
2. Extract the list of visible nav items (section label + every sub-item). Compare to the expected visibility for this role per `ROLE_VISIBLE_SECTIONS` in `client/src/config/app-navigation.ts`. Note any mismatches.
3. Output the role's visible nav tree.

### 3.3 Per-view walkthrough
For **every visible nav item** this role can see, perform the **View Audit Protocol** (§4). Do this breadth-first: visit each top-level section first, then sub-items.

### 3.4 Checkpoint
After finishing all visible views for the role, output the per-role report (§5) and wait for user approval before proceeding to the next role.

---

## 4. VIEW AUDIT PROTOCOL (run on every view)

For each visited route `<route>`:

### A. Load & settle
1. Navigate. Wait for `networkidle`. Wait an additional 500ms.
2. If a loading skeleton is visible after 5s, wait up to 15s total. If still loading, mark as **TIMEOUT** and continue.
3. Screenshot full-page → `qa/runtime-review/<role>/<route-slug>.png`.
4. Capture the page `<h1>` / heading text.

### B. Button & interactive enumeration
List every interactive element on the page:
- `<button>`, `[role="button"]`, `<a href>`, tabs, toggles, select/dropdowns, date pickers, search inputs, filter chips, table sort headers, row expanders, pagination controls.

For each, record: **label / aria-label / text**, **DOM tag**, **disabled state**, and a **classification**:
- `NAV` — navigates to another route (safe to click)
- `FILTER` — changes view state (safe to click, but reset afterwards)
- `MODAL_RO` — opens a read-only modal/drawer (safe: click, screenshot, close)
- `MUTATION` — submits/saves/approves/deletes/creates (**do not click**, record only)
- `EXPORT` — downloads a file (click, note filename, but don't open it)
- `UNKNOWN` — cannot classify from label/DOM (**do not click**, flag for user review)

Click every `NAV`, `FILTER`, `MODAL_RO`, and `EXPORT` exactly once. After each click:
- Confirm no console errors appeared.
- Confirm no failed network requests appeared.
- Return to the original route before moving to the next element.

### C. Number extraction (THE CORE RECON STEP)
Extract **every numeric value** visible on the page. "Numeric" includes:
- Currency (R, $, €, any format)
- Percentages
- Counts / integers
- Decimal ratios
- kWh / kWp / watts
- Dates (record but mark as `DATE`, not for approval)

For each number, record:

| Field | Example |
|---|---|
| `view` | `/revenue-tracker` |
| `label` | "YTD Revenue" |
| `value_raw` | "R 12,345,678.90" |
| `value_numeric` | 12345678.90 |
| `period_context` | "FY2026, Jul–Mar" |
| `source_selector` | CSS selector / aria-label used to locate it |
| `api_endpoint` | (optional) the API call that populated it — check Network tab |

**Do not compare to any expected value.** You are a capture device. The user is the oracle.

### D. Known high-signal views — extra numeric detail
When you reach these views, make sure you capture the specified fields:

**`/` Home Dashboard** (`client/src/pages/dashboard.tsx`) — role-dependent, but always extract:
- FinancialSummaryTiles: Actual, Plan, Forecast, Variance, Variance %, trend direction, selected period
- MyWorkToday: task count, approvals count, overdue count
- AttentionPanel: number of items, severity counts
- ImportHealthWidget: last import timestamp, row counts, error count
- Any KPI tile rendered from `/api/dashboard/kpis`

**`/revenue-tracker`** — per month row: `monthLabel`, `totalRevenue`, `realisedRevenue`, `unrealisedRevenue`, `budget`, `variance`, `variancePct`. Plus YTD row: `ytdRevenue`, `ytdRealised`, `ytdUnrealised`, `ytdBudget`, `ytdVariance`, `ytdVariancePct`. Also capture the project breakdown if visible.

**`/cashflow`** — per month: opening balance, inflows, outflows, opex budget, closing balance. Capture every period column.

**`/cos`** — COS totals, per-project COS, recognized vs deferred.

**`/gp-tracker`** — Gross Profit per project / portfolio, GP %.

**`/fye-revenue-tracking`** — full-year-end revenue projection numbers.

**`/invoice-patterns`** — invoice counts, totals, outstanding, aging buckets.

**`/counterparties`** — per counterparty: total owed, total paid, outstanding.

**`/subcontractor-dashboard`** — per subbie: contracted, paid, outstanding, retention.

**`/execution-board`, `/pm-dashboard`** — milestone counts, % complete, project health tiles.

**`/pd`** — pipeline value, opportunity counts by stage, conversion rates.

**`/sites`** — site count, kWp totals, by status.

**`/engineering`, `/hse`, `/quality`** — any counts/percentages shown in dashboards.

**`/admin/*`** — user counts, permission counts, audit log entry counts, template counts.

### E. Console & network hygiene
Record for this view:
- Every `console.error` / `console.warn` text
- Every failed network request (non-2xx) — method, URL, status
- Every request slower than 3000ms — URL, duration

---

## 5. PER-ROLE REPORT FORMAT

After finishing all views for a role, output exactly this structure and **pause for user approval**:

```markdown
## Role: <ROLE_NAME>

### Summary
- Views visited: <n>
- Views with errors: <n>
- Total buttons enumerated: <n>
- Mutations found (not clicked): <n>
- Unknown-classification buttons (need user review): <n>
- Numbers captured for approval: <n>

### Nav visibility diff vs expected
<list any extra or missing sections/items>

### Findings (errors, timeouts, oddities)
| Severity | View | What happened | Screenshot |
|---|---|---|---|
| BLOCKER | /cashflow | 500 from /api/cashflow-2026 | qa/runtime-review/.../cashflow.png |
| MAJOR | ... | ... | ... |
| MINOR | ... | ... | ... |

### Mutation buttons found (recorded, not clicked)
| View | Label | Classification reason |
|---|---|---|

### Unknown-classification buttons (user decision needed)
| View | Label | DOM snippet |
|---|---|---|

### Numbers for approval
(One table per view. User will reply "approved" or list corrections.)

#### /revenue-tracker
| Label | Value (raw) | Value (numeric) | Period | Source |
|---|---|---|---|---|
| YTD Revenue | R 12,345,678.90 | 12345678.90 | FY2026 YTD | [data-testid="ytd-revenue"] |
| ... | | | | |

#### /cashflow
...
```

**STOP HERE. Wait for user response before starting the next role.**

---

## 6. FINAL CONSOLIDATED REPORT

After all roles are approved, produce a final report at `qa/runtime-review/REPORT.md`:

1. **Executive summary** — roles tested, total views, total buttons, blocker/major/minor counts.
2. **Cross-role inconsistencies** — same number shown differently to different roles? Same view present for one role but missing for another that should see it?
3. **Accessibility spot-check** — for the top 10 most-used views, note: missing alt text, low-contrast text flagged by console, buttons without aria-labels.
4. **All findings** merged and deduped.
5. **All approved numbers** merged into a single spreadsheet-style CSV at `qa/runtime-review/numbers.csv` with columns: `role,view,label,value_raw,value_numeric,period_context,approved`.
6. **Next-step recommendations** the user might want to act on — but do not open PRs or change code. Report only.

---

## 7. WHEN TO ASK THE USER INSTEAD OF GUESSING

Stop and ask if:
- A credential set is missing.
- A button's classification is genuinely ambiguous (`UNKNOWN`).
- A view requires a modal to be submitted to see its contents.
- A number on one view obviously contradicts another and you cannot tell which is canonical.
- You encounter a view not listed in `page-registry.ts` — confirm it's a real page before auditing.
- The staging instance appears to be seeded with synthetic data that doesn't reflect production — the user needs to decide if numbers are still worth reconciling.

---

## 8. RESUMABILITY

Keep a progress file at `qa/runtime-review/.progress.json`:

```json
{
  "roles": {
    "COO_ADMIN": { "status": "done", "views_visited": [...] },
    "PROJECT_MANAGER_SITE": { "status": "in_progress", "last_view": "/cashflow" }
  }
}
```

Update after every view. If the session restarts, resume from `last_view` for the in-progress role.

---

**Begin when the user provides the credentials in §0 and says "go".**
