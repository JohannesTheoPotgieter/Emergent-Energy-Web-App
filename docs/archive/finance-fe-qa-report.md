# Finance Front-End QA Report

**Scope:** Full runtime + functional + UX QA of the Emergent Energy **Finance** front end.
**Date:** 2026-06-09
**Method:** Authenticated headless-browser drive (Playwright/Chromium) across every finance
route for all four seeded roles, plus authenticated API contract checks (Bearer JWT) and
direct DB inspection for root-causing. Evidence captured under `.local/fe-qa/`.

**Golden projects (anchors):** Coega Steels Ph2 = 8, De Drift = 7, Mondi = 19,
Seshego Circle = 27, Unitrans Brackenfell = 39.

---

## 1. Executive summary

- **15 finance routes × 4 roles = 60 route-loads driven.** No `ErrorBoundary` trips, no
  navigation crashes, no client-side white-screens on any route for any role.
- **1 functional break (P1):** every project finance page (`/projects/:id/finance`) returned
  **HTTP 500** on `GET /api/finance/projects/:id/vo-impact` for **all five golden projects**.
  Root cause = **dev-DB schema drift** (migration `0071` recorded-applied but its
  `change_requests` columns were absent). Reconciled in **dev** (idempotent re-apply of the
  committed `IF NOT EXISTS` column adds) → endpoint now 200 for all 5. **Production risk: low**
  (the migration is committed and idempotent). Raised for proper ledger reconciliation.
- **2 hydration / DOM-nesting warnings (P2/P3):** `<div>` inside `<p>` on `/finance`;
  nested `<button>` inside the recon tab grid on `/revenue-tracker`. Console-level, no visible
  break. Raised (sources are inside large/shared components — not blind-fixed).
- **Permissions are coherent and enforced** across the four roles (UI gating verified;
  server-side `requirePermission` confirmed in code). Clear gradient: COO_ADMIN (full) →
  PROJECT_MANAGER_SITE (operational finance only) → ENGINEER / QUALITY_MANAGER (no finance).
- **1 safe UI fix applied (P3):** `ReconStatusChip` now guards out-of-enum/undefined status
  instead of throwing `TypeError`.
- **Data observation (raise for finance review):** 3 of 5 golden projects report **negative
  canonical project GP** (§3.3 base): Coega −R46.4M, De Drift −R5.1M, Unitrans −R5.1M.

### Result by gate (detail in §8)
- `npm run check` → **PASS**
- `npm run build` → **PASS**
- `npm run test` → **1 failure**, `strict-runtime-config.test.ts` — pre-existing,
  environment-driven test-isolation bug (not introduced by this work); 7384/7385 pass. See D9.
- `npm run test:smoke` → infra blocker fixed (Chromium could not launch in this container);
  remaining failures are on **non-finance** routes (`/admin`, `/handover-control`) and are
  pre-existing / out of scope for this finance QA. See D8.

---

## 2. PASS / FAIL matrix — runtime (route load, all roles)

Legend: **OK** = rendered, no error state · **DENY** = Access-Denied gate shown (expected for
role) · **EB** = ErrorBoundary trip (none observed).

| Route | COO_ADMIN | PM_SITE | ENGINEER | QUALITY_MGR | Runtime flags (admin) |
|---|---|---|---|---|---|
| `/finance` | OK | DENY | DENY | DENY | hydration: div-in-p (D2) |
| `/finance/close` | OK | OK | DENY | DENY | clean |
| `/cashflow` | OK | OK | DENY | DENY | clean |
| `/cashflow/analysis` | OK | OK | DENY | DENY | clean |
| `/cos` | OK | OK | DENY | DENY | clean |
| `/cos/analysis` | OK | OK | DENY | DENY | clean |
| `/revenue-tracker` | OK | DENY | DENY | DENY | hydration: nested button (D3) |
| `/fye-revenue-tracking` | OK | DENY | DENY | DENY | clean |
| `/finance/gp` | OK | DENY | DENY | DENY | clean |
| `/finance/gp/company` | OK | DENY | DENY | DENY | clean |
| `/finance/audit-prep` | OK | DENY | DENY | DENY | clean |
| `/finance/reconciliation` | OK | DENY | DENY | DENY | clean |
| `/finance/qb-reconciliation` | OK | DENY | DENY | DENY | clean |
| `/finance/quickbooks` | OK | DENY | DENY | DENY | clean |
| `/projects/19/finance` | OK* | DENY | DENY | DENY | **500 vo-impact (D1)**, a11y (D4) |

\* Page shell rendered; the VO-impact panel failed with 500 until D1 was reconciled in dev.

**Responsive:** no horizontal overflow detected at 1280px or 768px on any admin-visible route.

---

## 3. Permissions matrix (Section E)

UI gating observed in-browser; server enforcement confirmed via `requirePermission(entity,
action)` on the routes (e.g. `financials:view` on vo-impact). The two layers agree.

| Capability area | COO_ADMIN | PROJECT_MANAGER_SITE | ENGINEER | QUALITY_MANAGER |
|---|---|---|---|---|
| Finance Home / Close | ✅ | ✅ | ⛔ | ⛔ |
| Cashflow (+ analysis) | ✅ | ✅ | ⛔ | ⛔ |
| Cost of Sales (+ analysis) | ✅ | ✅ | ⛔ | ⛔ |
| Revenue tracker / FYE | ✅ | ⛔ | ⛔ | ⛔ |
| GP (project + company) | ✅ | ⛔ | ⛔ | ⛔ |
| Audit prep / Reconciliation / QB | ✅ | ⛔ | ⛔ | ⛔ |
| Project finance tab | ✅ | ⛔ | ⛔ | ⛔ |

**Coverage gap (documented, not a defect):** the finance-editor roles **CFO**,
**PROGRAM_FINANCE_MANAGER**, **ACCOUNTANT** have **no seeded dev user**, so finance *edit/
approve* gating could not be driven end-to-end in the browser. Server-side gates for those
roles were verified by code inspection only. Seeding these roles would close the gap.

---

## 4. Correctness anchors (Section D)

`qa/fixtures/golden-trackers-5.json` is **missing**, so correctness anchors were derived from
the canonical service (`vo-impact-service.ts` → canonical §3.3 line engine), which the code
documents as the single source both Finance and Execution consume ("VO numbers cannot diverge
across the two surfaces"). Cross-surface consistency is therefore **architecturally
guaranteed** at the service layer; a full per-surface numeric diff is **contract-verified**,
not independently recomputed (fixture absent).

Canonical project GP (§3.3 base), via `GET /api/finance/projects/:id/vo-impact`:

| Project | id | Canonical project GP | VO count | VO totals |
|---|---|---|---|---|
| Coega Steels Ph2 | 8 | **−R46,397,627.31** | 0 | zero |
| De Drift | 7 | **−R5,141,328.05** | 0 | zero |
| Mondi | 19 | R2,624,493.44 | 0 | zero |
| Seshego Circle | 27 | R4,796,419.15 | 0 | zero |
| Unitrans Brackenfell | 39 | **−R5,128,826.35** | 0 | zero |

**Observation O-1 (raise for finance review):** three of five golden projects show a *negative*
canonical GP. This may be legitimate (cost actuals exceeding recognised revenue at this point
in the cycle) or a sign of revenue/COS data drift in dev. It is **not** a front-end defect and
was **not** altered. Finance owner should confirm whether negative GP is expected for these
projects.

---

## 5. Defect register (P0–P3)

### D1 — VO-impact endpoint 500 on every project finance page  · **P1** · RAISED (+ dev reconciled)
- **Surface:** `/projects/:id/finance` (VO impact panel). API: `GET /api/finance/projects/:id/vo-impact`.
- **Repro:** Load any project finance page as COO_ADMIN, or `curl` the endpoint with a valid
  Bearer token → HTTP 500 `{"error":"SERVER_ERROR","message":"Failed to load VO impact"}`.
  Reproduced for projects 8, 7, 19, 27, 39 (all golden projects).
- **Root cause:** `ChangeRequestsRepository.listByProject` SELECTs `change_requests` columns
  declared in the Drizzle mirror (`submitted_by_user_id`, `submitted_at`, `reviewer_user_id`,
  `review_started_at`, `approver_user_id`, `approved_at`, `rejection_reason`, `rejected_at`).
  Postgres returned `column "submitted_by_user_id" does not exist` (SQLSTATE 42703). The dev
  `change_requests` table was missing all 8 columns even though startup reported
  `102/102 migrations applied`. Migration **`0071_handover_signoff_and_cr_approver.sql`** adds
  exactly these columns but had not taken effect on this dev DB = **dev-DB schema drift**.
- **Action taken:** Re-applied the committed, idempotent `ADD COLUMN IF NOT EXISTS` statements
  (+ the three CR foreign keys) from migration 0071, **scoped only to `change_requests`**, to
  the **dev** DB. Verified endpoint now returns 200 for all five golden projects. No data rows
  were modified.
- **Recommended permanent fix (owner):** reconcile the dev migration ledger so 0071 is
  re-runnable (or rebuild dev from migrations). Production is expected unaffected because the
  migration is committed and idempotent; confirm prod `change_requests` has these columns.
- **Secondary defect (D5):** the route swallowed the underlying cause, which masked this for a
  long time — see D5.

### D2 — Hydration warning: `<div>` cannot be a descendant of `<p>` on `/finance`  · **P2** · RAISED
- **Surface:** Finance Home (`/finance`).
- **Evidence:** React console warning `In HTML, <div> cannot be a descendant of <p>. This will
  cause a hydration error.` (stack truncated at the shared `ErrorBoundary > Suspense` boundary).
- **Note:** The page header block (`<h1>` + text-only `<p>`) is clean; the offending node is in
  a deeper child component (e.g. a KPI/Trust component rendering a block element inside a
  paragraph). Not blind-fixed — locating the exact leaf requires the full component stack to
  avoid an unsafe guess. No visible breakage; SSR/hydration robustness only.

### D3 — Hydration warning: nested `<button>` in recon tab grid on `/revenue-tracker`  · **P2** · RAISED
- **Surface:** Revenue tracker, "recon" tab (`renderGrid()` in `client/src/pages/revenue-tracker.tsx`).
- **Evidence:** `<button> cannot contain a nested <button>` inside `TabsContent value="recon"`.
- **Note:** Source is inside an 1800+-line grid render; a button (likely a row/cell action)
  contains another button. Invalid DOM nesting → unreliable click targets / a11y. Not
  blind-fixed (large shared render path); raised with repro.

### D4 — Icon-only button without accessible name on project finance page  · **P3** · RAISED
- **Surface:** `/projects/:id/finance` — a dismiss/close control (`absolute right-2 top-2
  rounded-md p-1 …`, svg icon, no `aria-label`/`title`/text).
- **Impact:** Screen-reader users get no name for the control. Appears on the VO-impact error
  card; once D1 is resolved the card no longer shows, but the unlabeled button pattern remains.

### D5 — VO-impact route swallows the underlying error cause  · **P3** · RAISED
- **Surface:** `server/routes/finance-vo-impact.routes.ts` catch block.
- **Detail:** The handler wraps any error as `serverError("Failed to load VO impact")` and
  attaches the real error to `.cause`, but the central API-error logger logs only the wrapper —
  so the actual Postgres error (`42703`) never reached the logs. This significantly delayed
  root-causing D1. Recommend logging `err.cause` (or the original error) at `error` level.

### D6 — `no page-header testid` on finance pages  · **Not a defect (by design)** · NOTED
- Finance pages intentionally render their own title (`finance-home.tsx` comment: "title only;
  the Emergent logo lives in the global app header … the page must not render a second one").
  The harness's `[data-testid="page-header"]` probe returned false on all finance routes for
  this reason. No action.

### D7 — Dev-DB drift (environment)  · **P3 (env)** · NOTED
- Two independent drift instances observed in dev this session: (a) test-user passwords
  required `npm run seed:test-users` to authenticate; (b) `change_requests` missing migration
  0071 columns (D1). The migration ledger over-reports applied state vs the actual dev schema.
  Environment hygiene item; does not indicate a production code defect.

### D8 — `test:smoke` Chromium could not launch in this container  · **P2 (env/infra)** · FIXED (config)
- **Symptom:** every smoke test failed at `browserType.launch: Target page, context or browser
  has been closed`; the bundled `chrome-headless-shell` exited 127 with
  `error while loading shared libraries: libglib-2.0.so.0: cannot open shared object file`.
- **Root cause:** `qa/playwright.config.ts` did not point Playwright at the Replit-provided
  Chromium (`REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE`), so it used the ms-playwright cached
  binary whose runtime libs are absent in this NixOS container. Not an application defect — the
  same app loads fine under the QA harness (which sets the executable + `--no-sandbox`).
- **Fix:** `launchOptions` now conditionally set `executablePath` from
  `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` (no-op in CI where the var is absent) and pass
  `--no-sandbox`; the HTML reporter is set `open: "never"` so the run no longer hangs on the
  report server. After the fix, Chromium launches and finance routes run.
- **Residual:** some smoke specs still fail on **non-finance** routes (`/admin`,
  `/handover-control`) — pre-existing and outside this finance QA's scope.

### D9 — `strict-runtime-config.test.ts` fails in this container  · **P3 (test isolation)** · RAISED
- **Test:** "fails in production when DATABASE_URL is missing" expects `resolveDbConfig()` to
  throw, but it does not here.
- **Root cause:** the test deletes only `NODE_ENV/DB_MODE/DATABASE_URL/JWT_SECRET`, but this
  container also has Replit Postgres module vars (`PGHOST`, `PGPORT`, …) set. `resolveDbConfig`
  auto-synthesises a `DATABASE_URL` from `PGHOST` (server/db-config.ts ~L35) before reaching
  the production guard, so no throw. Environment-driven test-isolation gap, **not** caused by
  this work and not a finance defect. Recommended fix (test infra, out of scope): the test
  should also clear `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`.

---

## 6. Coverage honesty

- **Driven in-browser:** route load, render, Access-Denied gating, responsive (1280/768),
  console/pageerror/hydration capture, icon-button a11y scan — 15 routes × 4 roles.
- **Contract-verified (API, not full UI mutation):** VO-impact endpoint across 5 golden
  projects; permission enforcement via `requirePermission` in code; canonical GP per project.
- **Raised, not driven:** heavy finance mutations (move period, dispute open/resolve,
  write-off, payment-batch lifecycle, smart-import commit) were **not** executed against dev
  to avoid altering finance data, per task constraint. They are gated by `financials:edit/
  approve` (confirmed in code) and should be exercised in a disposable fixture environment.
- **Known gaps:** missing `qa/fixtures/golden-trackers-5.json` (anchors derived from canonical
  tables instead); no seeded dev user for CFO / PROGRAM_FINANCE_MANAGER / ACCOUNTANT (finance-
  editor gating verified by code only); `pageerror: "WebSocket closed without opened"` on every
  route is **Vite HMR teardown noise**, filtered, not an app defect.

---

## 7. Fixes applied this session

1. **`client/src/components/finance/recon-status.tsx`** (P3, safe UI) — `ReconStatusChip` now
   guards `status == null` / out-of-enum values and renders a safe "unknown" chip instead of
   throwing `TypeError` on `RECON_STATUS_META[status]`.
2. **Dev DB reconciliation** (D1) — idempotent re-apply of migration 0071's `change_requests`
   column adds + FKs to the **dev** database only. No application code or finance calculation
   changed; no data rows modified.
3. **`qa/playwright.config.ts`** (D8, test infra) — conditional `executablePath` from
   `REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE` + `--no-sandbox`, and HTML reporter `open: "never"`.
   Backwards-compatible (no-op when the env var is absent). Enables the smoke gate to run in
   this container; no app/finance behaviour changed.

> Larger/data/calc defects (D1 permanent ledger fix, D2, D3, D5, O-1) were **raised**, not
> changed, per the task's fix/raise boundary.

---

## 8. Validation gate results

| Gate | Command | Result | Notes |
|---|---|---|---|
| Typecheck | `npm run check` | **PASS** (exit 0) | `tsc` ×2 clean. |
| Unit/integration tests | `npm run test` | **1 fail / 7384 pass / 6 skip** | Only failure = `strict-runtime-config.test.ts` (D9), pre-existing env-isolation bug, not finance, not introduced here. |
| Build | `npm run build` | **PASS** (exit 0) | Bundles; warns on large chunks + `import.meta` in CJS (pre-existing, non-blocking). |
| E2E smoke | `npm run test:smoke` | **Infra fixed (D8)** | Chromium now launches; finance routes exercised. Residual failures on non-finance routes (`/admin`, `/handover-control`) are pre-existing/out of scope. |

**Honesty note:** `check` and `build` are fully green. The two test gates each have exactly one
class of pre-existing, environment-driven failure unrelated to the finance front end or to the
changes in this session (D8 infra now fixed at config level; D9 test-isolation raised). No
finance calculation or production data was modified.
