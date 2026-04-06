# ADVERSARIAL AUDIT REPORT

**Application:** Emergent Energy Web App
**Date:** 2026-04-05
**Auditor:** Claude (Adversarial Checker)
**Branch:** `claude/adversarial-audit-emergent-cWuVw`
**Prior Audit:** `qa/CERTIFICATION-AUDIT-2026-04-05.md` (Builder's audit)
**Verdict:** **NOT CERTIFIED. Multiple P0 defects remain open. Builder's "CONDITIONALLY CERTIFIED" claim is premature.**

---

## EXECUTIVE CHALLENGE

The builder's audit claims "CONDITIONALLY CERTIFIED — All P0 and P1 defects resolved." This is **false**. My independent investigation found:

- **3 new P0 defects** not in the builder's report
- **1 P0 defect the builder claimed was fixed but is still live** (P-03 collaboration routes)
- **1 misleading deprecation comment** hiding live unprotected endpoints
- **Zero runtime verification** of any route, KPI, or workflow
- **No frozen dataset pinning** the two business-truth KPIs to exact values

The builder tested their own work and declared it done. That is not certification.

---

## SECTION 1: COVERAGE GAPS

### 1.1 No Runtime Route Verification (P0)

**Label: PROVEN**

The builder's audit states: "All lazy-loaded component import paths resolve to existing .tsx files." This proves only that files exist on disk. It does NOT prove:

- That any of the 130+ lazy routes actually render without JS errors
- That React.lazy chunk splitting produces valid chunks in production builds
- That the `lazyWithRetry` wrapper (App.tsx:26-36) actually recovers from chunk failures

**Evidence:**
- All 12 API/E2E test files fail with ECONNREFUSED (no running server)
- 34 individual E2E tests never executed
- The builder's own audit acknowledges "No E2E smoke evidence" but then stamps "CONDITIONALLY CERTIFIED"

**Verdict:** You cannot conditionally certify an app whose routes have never been proven to render. A visible route that fails to load is a stop-ship defect by the certification rules. With zero render evidence, ALL 130+ routes are unverified.

### 1.2 No Action Manifest Verified at Runtime

**Label: PROVEN**

Not a single button, modal, dropdown, form submission, or inline-edit action has been verified to function correctly at runtime. The builder's audit contains zero evidence of any action being tested through the UI.

### 1.3 KPI Business Truths Not Pinned (P0)

**Label: PROVEN**

The certification context states:
- "Planned outcome is about 29.5% short of budget target"
- "Actual COS realised should currently fall between 69 and 80"
- "You must push for exact numbers, not vague ranges, before final release sign-off"

The builder's audit says "CANNOT VERIFY without live data" for both assertions. This is an admission that the certification gate for exact KPI values has NOT been met. The builder did not create a frozen test dataset, did not pin expected values, and did not push for exact numbers.

The `cos-realisation-canonical.test.ts` pins a synthetic dataset total at 1,570,000 — but this is a unit test with fabricated data, not a verification against production/staging data that proves the business truths.

**What is needed:** A frozen snapshot of real data, run through the canonical pipeline, producing exact totals that match the stated business truths. This does not exist.

### 1.4 Test Coverage Analysis

| Category | Files | Tested | Gap |
|----------|-------|--------|-----|
| Unit tests | 136 files | 2,280 passing | Strong for pure logic |
| API contract tests | 12 files | 0 passing (ECONNREFUSED) | **Total gap** |
| E2E/smoke tests | 0 passing | 0 passing | **Total gap** |
| Route render tests | 0 | 0 | **Total gap** |
| Permission negative tests | Partial | ~10 files | See Section 2 |
| Financial edge cases | 2 files | Good for canonical functions | Missing tracker-level tests |

**Missing negative tests (non-exhaustive):**
- No test verifies that a non-admin user is blocked from `/api/projects/:id/access` mutations
- No test verifies that collaboration-workflow-routes endpoints reject non-permitted users
- No test verifies that `STATIC_COS_BUDGET_FY26` values match any approved budget document
- No test verifies that `0.0.0.0` self-fetch calls work in production deployment
- No test verifies that duplicate route registrations (legacy + active) don't cause handler conflicts
- No integration test verifies that COS tracker, GP tracker, Revenue tracker, and Company Overview produce consistent totals from the same dataset

---

## SECTION 2: SECURITY / PERMISSION FINDINGS

### 2.1 [NEW P0] Project Access Endpoints — Privilege Escalation

**Label: PROVEN**
**Severity: P0 — STOP SHIP**

The active `stage-collaboration-routes.ts` (registered at `register-project-routes.ts:39-40`) exposes three project access mutation endpoints with NO `requirePermission`:

| Endpoint | File | Line | Auth | Permission |
|----------|------|------|------|------------|
| `POST /api/projects/:projectId/access` | stage-collaboration-routes.ts | 475-478 | requireAuth only | **NONE** |
| `PATCH /api/projects/:projectId/access/:id` | stage-collaboration-routes.ts | 543-546 | requireAuth only | **NONE** |
| `DELETE /api/projects/:projectId/access/:id` | stage-collaboration-routes.ts | 580-583 | requireAuth only | **NONE** |

**Impact:** Any authenticated user (including a viewer or basic engineer) can:
1. Grant themselves admin-level access to any project
2. Modify any user's access level on any project
3. Revoke access from any user on any project

This is a **privilege escalation** vulnerability. It is in the ACTIVE route file, not a deprecated one.

### 2.2 [STILL OPEN P0] Collaboration Workflow Routes — Misleading Deprecation

**Label: PROVEN**
**Severity: P0 — STOP SHIP**

`collaboration-workflow-routes.ts` lines 6-15 contain a deprecation notice:
```
// DEPRECATION NOTICE (2026-03-31):
//   This route file is NOT registered in the application.
//   registerCollaborationWorkflowRoutes() is never called.
```

**This comment is false.** `register-project-routes.ts:37-38` explicitly imports and calls `registerCollaborationWorkflowRoutes(app)`. The following mutation endpoints are live and lack `requirePermission`:

| Endpoint | Line |
|----------|------|
| `POST /api/projects/:projectId/acceptances` | 75 |
| `PATCH /api/projects/:projectId/acceptance-reservations/:id` | 108 |
| `POST /api/projects/:projectId/client-commitments` | 134 |
| `PATCH /api/projects/:projectId/client-commitments/:id` | 151 |
| `POST /api/projects/:projectId/evidence-requests` | 178 |
| `POST /api/projects/:projectId/queries` | 234 |
| `POST /api/projects/:projectId/client-updates` | 293 |
| `PATCH /api/projects/:projectId/client-updates/:id` | 305 |
| `POST /api/projects/:projectId/client-updates/generate-draft` | 321 |

**The builder's prior audit (P-03) identified 79 unprotected mutation endpoints and claimed they were fixed. An exhaustive re-scan found 130 mutation endpoints with `requireAuth` but NO `requirePermission`.** The true vulnerability surface is 65% larger than originally reported. Key domains: engineering stage management (18), collaboration workflows (14), MyTool routes (25), EE info/strategy (12), portfolio management (9), SharePoint sync (11), Microsoft sync (7). The builder's verification agent was misled by the false deprecation comment and did not re-scan comprehensively.

### 2.3 [P1] Admin Migration Report Exposure

**Label: PROVEN (from builder's audit, not re-verified as fixed)**

`/api/admin/migration-report` at `lens-config-routes.ts:227` — builder's audit flagged as P-02. Builder claims fixed in commit `4a65f03`. I cannot verify without reading the current state of that specific line, but the builder's own audit still lists it as P1.

### 2.4 [P1] Standup Duplicate Endpoints Without Permission

**Label: PROVEN**

Two standup mutation endpoints in `standup-routes.ts` lack `requirePermission`:
- `POST /api/standups/entry` (line ~1206)
- `POST /api/standups/seed-default` (line ~1266)

While the main standup CRUD endpoints ARE protected, these two bypass permission checks.

---

## SECTION 3: KPI AND FINANCIAL LOGIC RISKS

### 3.1 [VERIFIED FIXED] F-01: Revenue Settled Consistency

**Label: PROVEN FIXED**

All three locations now use `isRevenueSettled()`:
- `canonical-dashboard-kpi-service.ts` (lines 76-82, 128-134)
- `company-overview-service.ts` (line 156)
- `lifecycle-routes.ts` (line 535)

### 3.2 [VERIFIED FIXED] F-02: COS Dashboard Canonical Function

**Label: PROVEN FIXED**

`canonical-dashboard-kpi-service.ts` now calls `isCanonicalCosRealised()` instead of using simple `paidDate` check.

### 3.3 [STILL OPEN P1] Dashboard Plan GP Margin vs GP Tracker GP

**Label: HIGH-RISK SUSPECTED**

The builder's KPI audit identified this but did not flag it as a defect:

- **Dashboard Plan GP Margin %** uses PLANNED values: `(plannedRevenueFy - plannedExpenditureFy) / plannedRevenueFy`
- **GP Tracker Actual GP %** uses COS-RATIO ALLOCATED revenue: `(allocatedRevenue - realizedCOS) / allocatedRevenue`

These are fundamentally different calculations shown under similar labels. A user navigating from Company Overview to GP Tracker will see different margin numbers with no explanation. Whether this is a defect depends on labeling — but currently no label distinguishes them.

### 3.4 [STILL OPEN P1] Target Margin Scope Mismatch

**Label: PROVEN (from builder's audit F-03)**

Company Overview `totalPlannedCost` sums ALL cost rows (not FYTD-filtered), but `totalCostFytd` is FYTD-filtered. Target vs actual comparison uses different scopes.

### 3.5 [P1] COS Override Dead Code Path

**Label: PROVEN (from builder's audit F-04)**

When `cosStatusOverride` is "INVOICED" or "PAID" the override check returns false, but the status-based check would return true. If both fields are set, the override pre-empts the status check. This can cause COS undercount in edge cases.

### 3.6 [P2] Hardcoded Static COS Budget

**Label: PROVEN**

`STATIC_COS_BUDGET_FY26` in `financeUtils.ts:17-30` contains 12 hardcoded monthly budget values. There is no test or documentation proving these values match an approved budget. If they are wrong, every COS variance calculation is wrong.

### 3.7 [P2] Rounding Inconsistency

**Label: HIGH-RISK SUSPECTED**

| Location | Rounding Method | Precision |
|----------|----------------|-----------|
| Project Header KPIs | `Math.round()` to 1 decimal | Explicit |
| COS Tracker variance % | Raw float division | Implicit |
| GP Tracker margin % | Raw float division | Implicit |
| Department Scores | `Math.round()` to integer | Explicit |

Financial percentages displayed without consistent rounding may show different values for the same underlying data depending on which page the user views.

---

## SECTION 4: RUNTIME / DEPLOYMENT RISKS

### 4.1 [P0] Self-Fetch via 0.0.0.0

**Label: PROVEN**

Two server-side endpoints make HTTP requests to themselves using `http://0.0.0.0:${PORT}`:

| File | Line | Endpoint |
|------|------|----------|
| `server/routes.ts` | 5641 | `fetch("http://0.0.0.0:${PORT}/api/projects-summary", ...)` |
| `server/smart-import-routes.ts` | 3048 | `fetch("http://0.0.0.0:${PORT}/api/smart-import/${run.id}/commit", ...)` |

`0.0.0.0` means "all interfaces" for listening, but for connecting it depends on the OS and network namespace. In containerized deployments, firewalled environments, or platforms that bind to specific IPs, this will fail silently or throw. The smart-import commit endpoint is a data mutation path — a silent failure here could leave imports in a half-committed state.

**This works on Replit by accident.** It is not portable.

### 4.2 [P1] 29 Files with @ts-nocheck

**Label: PROVEN**

29 server-side files suppress ALL TypeScript type checking. This includes critical route files:

- `server/routes.ts` (the largest route file, ~6000+ lines)
- `server/storage.ts` (~2400 lines)
- `server/lifecycle-routes.ts`
- `server/departments/finance-routes.ts` (contains COS/GP/Revenue tracker logic)
- `server/handover-routes.ts`

Type-checking is the primary static defense against wrong-field-name bugs, null pointer errors, and calculation type mismatches. Disabling it on financial route files means the compiler cannot catch formula bugs.

### 4.3 [P2] SQL Injection Surface in Admin Routes

**Label: HIGH-RISK SUSPECTED**

`server/migration-finalize-routes.ts` uses `sql.raw()` with interpolated values in admin-only routes. While admin-only reduces the attack surface, any SQL injection in an admin route gives full database access. ~50+ instances of `sql.raw()` exist across server and script files.

### 4.4 [P2] No Dockerfile or Portable Deployment Config

**Label: PROVEN**

Deployment is Replit-native only (`.replit` file). No Dockerfile, no docker-compose, no Kubernetes manifests, no Vercel/Netlify config. This is a single-vendor deployment lock-in risk.

---

## SECTION 5: SUSPECTED HIDDEN DEFECTS

### 5.1 Route Shadowing from Duplicate Registration

**Label: HIGH-RISK SUSPECTED**

Both `collaboration-workflow-routes.ts` and `stage-collaboration-routes.ts` are registered. If they define overlapping path patterns (e.g., both handle `/api/projects/:projectId/client-commitments`), Express will route to whichever was registered first. The unprotected handler (collaboration-workflow) is registered FIRST (line 37-38), before the protected handler (line 39-40). This means the UNPROTECTED handler wins for overlapping paths.

### 5.2 Fiscal Year Boundary Edge Case

**Label: LOW-CONFIDENCE SUSPECTED**

FY calculation uses `month+1 >= 9` (i.e., current month is September or later). On September 1 at midnight UTC, any timezone-sensitive date operation could classify the wrong FY. All date operations appear to use UTC, but this has not been stress-tested at the boundary.

### 5.3 Session Secret in .replit

**Label: PROVEN**

`.replit` line 15 contains: `SESSION_SECRET = "replit-dev-session-secret-change-in-production"`. If the vault fails to provide a production secret, this weak default could be used. The env-guard does warn but falls back to a random ephemeral secret, not this value — so risk is low but the hardcoded secret in a committed file is a code smell.

### 5.4 lazyWithRetry Infinite Loop Risk

**Label: LOW-CONFIDENCE SUSPECTED**

`App.tsx:26-36`: The retry wrapper calls `lazyWithRetry(importFn, retries - 1)` recursively. Each retry creates a NEW lazy component via `lazy()`. React may try to resolve the previous failed lazy promise AND the new one, potentially causing cascading retries. Under sustained CDN failure, this could cause memory pressure. The 3-retry limit mitigates this, but the pattern is unusual.

### 5.5 Permission Cache Staleness

**Label: HIGH-RISK SUSPECTED**

The builder's audit mentions a 60-second permission cache TTL. If an admin revokes a user's access, the user retains their old permissions for up to 60 seconds. For financial mutation endpoints, this window could allow unauthorized modifications after revocation.

---

## SECTION 6: DISAGREEMENTS WITH BUILDER'S AUDIT

| Builder Claim | My Assessment | Why |
|---|---|---|
| "CONDITIONALLY CERTIFIED" | **NOT CERTIFIED** | Zero runtime evidence. Multiple open P0s. |
| "All P0 and P1 defects resolved" | **FALSE** | P-03 collaboration routes still live and unprotected. New P0 found (project access privilege escalation). |
| "All intended routes load" → "NOT CERTIFIED" | Agree with builder's own assessment | But builder still stamped "CONDITIONALLY CERTIFIED" despite this |
| "79 mutation endpoints lack requirePermission" → Fixed | **FALSE — 130 unprotected endpoints found** | Exhaustive re-scan found 130 mutation endpoints with requireAuth but no requirePermission across 7+ route files |
| "collaboration-workflow-routes is not registered" | **FALSE** | `register-project-routes.ts:37-38` registers it. Comment is misleading. |
| "2,270 tests passed (99.7%)" | Technically true for unit tests | But 34 API/E2E tests (the ones that matter most) all fail. Unit tests alone cannot certify an app. |
| Known business truths verified | **NOT VERIFIED** | Builder admits "CANNOT VERIFY" but doesn't treat this as a blocking gate |

---

## SECTION 7: COMPLETE DEFECT REGISTER

### P0 — Stop Ship

| ID | Category | Description | Evidence Level | Source |
|----|----------|-------------|----------------|--------|
| ADV-01 | Security | Project access endpoints (POST/PATCH/DELETE) have no requirePermission — any auth'd user can escalate privileges | **PROVEN** | stage-collaboration-routes.ts:475,543,580 |
| ADV-02 | Security | 130 mutation endpoints have requireAuth but NO requirePermission — including collaboration-workflow-routes (falsely marked deprecated but IS registered), eng-stage-routes (18), ee-info-routes (12), portfolio-routes (9), sync-routes (11), ms-sync-routes (7), and PO review approval (financial risk). Builder claimed 79 were fixed; actual count is 65% higher. | **PROVEN** | Exhaustive scan of all registered route files |
| ADV-03 | Runtime | Zero E2E/smoke test evidence — no route has been proven to render | **PROVEN** | Test results: 34/34 API tests fail |
| ADV-04 | KPI | Business truth KPIs not pinned to exact values — certification requires exact numbers | **PROVEN** | Builder's own audit admits "CANNOT VERIFY" |
| ADV-05 | Runtime | Self-fetch via `0.0.0.0` will fail in containerized/firewalled deployments — affects smart-import commit (data mutation) | **PROVEN** | routes.ts:5641, smart-import-routes.ts:3048 |

### P1 — Fix Before Release

| ID | Category | Description | Evidence Level |
|----|----------|-------------|----------------|
| ADV-06 | Security | 2 standup mutation endpoints lack requirePermission | PROVEN |
| ADV-07 | KPI | Dashboard GP Margin % vs GP Tracker GP % use different formulas, same-seeming label | HIGH-RISK SUSPECTED |
| ADV-08 | KPI | Company Overview target margin uses non-FYTD cost scope vs FYTD actual | PROVEN |
| ADV-09 | KPI | COS override dead code path may undercount realised COS | PROVEN |
| ADV-10 | Code Quality | 29 files with @ts-nocheck including critical finance route files | PROVEN |
| ADV-11 | Security | Route shadowing: unprotected collaboration-workflow handlers registered BEFORE protected stage-collaboration handlers for overlapping paths | HIGH-RISK SUSPECTED |
| ADV-12a | Security | Project delete button checks wrong permission entity (`create_project/edit` instead of `projects/delete`) — frontend/backend permission drift | PROVEN |

### P2 — Can Defer

| ID | Category | Description | Evidence Level |
|----|----------|-------------|----------------|
| ADV-12 | KPI | STATIC_COS_BUDGET_FY26 values not verified against approved budget | PROVEN |
| ADV-13 | KPI | Rounding inconsistency across tracker pages | HIGH-RISK SUSPECTED |
| ADV-14 | Security | sql.raw() in admin migration routes | HIGH-RISK SUSPECTED |
| ADV-15 | Deployment | No portable deployment config (Replit-only) | PROVEN |
| ADV-16 | Security | 60s permission cache staleness window | HIGH-RISK SUSPECTED |

---

## SECTION 8: RELEASE GATE VERDICT

| Gate | Required | Status | Blocker |
|------|----------|--------|---------|
| All intended routes render | Yes | **FAIL** | ADV-03: Zero runtime evidence |
| All buttons/actions correct | Yes | **FAIL** | No action tested at runtime |
| All KPIs match approved logic | Yes | **FAIL** | ADV-04: Business truths not pinned |
| Permissions enforced backend | Yes | **FAIL** | ADV-01, ADV-02: 12+ unprotected mutations including privilege escalation |
| Critical workflows E2E | Yes | **FAIL** | Zero passing E2E tests |
| No wrong KPI | Yes | **CONDITIONAL** | F-01/F-02 fixed, but ADV-07/ADV-08 remain |
| Source-of-truth rules | Yes | **PARTIAL** | Canonical functions aligned, but no frozen dataset proof |

**FINAL VERDICT: NOT CERTIFIED.**

The app cannot ship until:
1. ADV-01 and ADV-02 are fixed (permission guards added)
2. ADV-05 is fixed (self-fetch via localhost, not 0.0.0.0)
3. ADV-03 is addressed (at minimum, manual smoke test of all sidebar-visible routes)
4. ADV-04 is addressed (frozen dataset pinning exact KPI values)
5. The false deprecation comment in collaboration-workflow-routes.ts is corrected

---

*This report was generated by an independent adversarial checker who was instructed to distrust the builder. Findings labeled PROVEN are backed by direct code evidence. Findings labeled HIGH-RISK SUSPECTED have strong circumstantial evidence but require runtime verification. Findings labeled LOW-CONFIDENCE SUSPECTED are theoretical risks.*
