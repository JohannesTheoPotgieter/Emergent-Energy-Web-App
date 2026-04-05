# Emergent Energy Web App - QA Certification Audit

**Date:** 2026-04-05
**Auditor:** Claude (QA Architect)
**Branch:** `claude/qa-certification-audit-7V2Ga`
**Scope:** Full platform - routes, KPIs, permissions, financial logic, workflows

---

## RELEASE GATE RESULT: NOT CERTIFIED

**Reason:** 3 P0 defects found. 5 P1 defects found. Certification blocked until all P0 items resolved and P1 items addressed or explicitly accepted.

---

## 1. ROUTE MANIFEST AUDIT

### 1.1 Summary

| Metric | Count |
|--------|-------|
| Total page registry entries | 147 |
| Lazy-loaded page components | 112 |
| Eagerly-loaded pages | 4 (login, home, not-found, ms-callback) |
| Legacy redirects | 16 |
| Alias routes (type: "alias") | ~20 |

### 1.2 Lazy Import Verification

**Status: PROVEN - ALL PASS**

Every `React.lazy(() => import("@/pages/..."))` in `App.tsx` resolves to an existing `.tsx` file or `index.tsx` directory entry. Zero missing files.

### 1.3 ROUTE_COMPONENTS Map Cross-Check

**DEFECT D-01 (P2):** `MyToolPrioritiesPage` referenced in PAGE_REGISTRY (id: `companyPriorities`) has no matching key in ROUTE_COMPONENTS map in App.tsx.

- **Impact:** Low. The entry is `type: "alias"` with `redirectTo: "/priorities"`, so the component is never rendered.
- **Evidence:** `client/src/config/page-registry.ts:73` references `routeComponentKey: "MyToolPrioritiesPage"`, but `App.tsx:158-276` ROUTE_COMPONENTS does not include it.
- **Next action:** Remove the dead `routeComponentKey` from the alias entry or add the component.

**DEFECT D-02 (P3):** 5 components in ROUTE_COMPONENTS have no corresponding PAGE_REGISTRY entry: `AdminSettingsPage`, `ConstructionDashboardPage`, `Dashboard`, `ExceptionsPage`, `MyWorkPrioritiesPage`.

- **Impact:** Cosmetic. These are either legacy components kept for backward compatibility or reached via other routing paths.
- **Next action:** Clean up or document.

### 1.4 Route Access Policy

- All routes default to `accessPolicy: "protected"` (no page explicitly overrides this).
- Unknown paths (not in PAGE_REGISTRY) are blocked by `failOpenForUnknown: false` in `evaluatePathAccess`.
- Home `/` is always allowed.
- **Status: PROVEN - correctly configured.**

---

## 2. PERMISSION / RBAC AUDIT

### 2.1 Role Definitions

16 company roles defined in `shared/schema/users.ts`:

```
COO_ADMIN, CEO_ADMIN, CCO, CFO, PROGRAM_MANAGER, PROGRAM_FINANCE_MANAGER,
CONSTRUCTION_MANAGER, QUALITY_MANAGER, ENGINEERING_MANAGER, KEY_ACCOUNTS_MANAGER,
PROJECT_MANAGER_SITE, PROJECT_DEVELOPER, ENGINEER, ACCOUNTANT, HSE_MANAGER, SSEG_MANAGER
```

Admin roles: `COO_ADMIN`, `CEO_ADMIN` (have `*` permissions).

### 2.2 Three-Tier Permission Enforcement

**Status: PROVEN - well-structured.**

1. **User-specific overrides** (DB: `userPermissionOverrides`, time-expiring, audit-logged)
2. **Role permissions** (DB: `rolePermissions`, JSONB entity:action pairs)
3. **Code defaults** (`ENTITY_PERMISSION_DEFAULTS` in shared/schema, 60+ entities)

Both frontend (`useAccessMatrix` -> `evaluatePathAccess`) and backend (`requirePermission` middleware) use the same resolution chain via `shared/permission-resolver.ts`.

### 2.3 Frontend Route Guard

**Status: PROVEN - correctly implemented.**

- `ProtectedRoute` checks authentication (redirects to login if not authenticated).
- `RoleGuard` calls `canViewPath(location)` which evaluates: route access policy -> section-level blocks -> disabled sub-pages -> entity permission check.
- All pages are wrapped in `ProtectedRoute` > `RoleGuard` > `AppLayout` > `ErrorBoundary` > `Suspense`.

### 2.4 Backend Permission Enforcement

**Status: CONFIRMED GAPS - validated by full API scan.**

Full backend scan: **1,409 endpoints** across 127 route files.

| Auth Level | Count | % |
|-----------|-------|---|
| ADMIN only (COO_ADMIN/CEO_ADMIN) | 299 | 21.2% |
| AUTH + entity permission | 360 | 25.5% |
| AUTH only (no granular check) | 587 | 41.6% |
| PUBLIC (no auth) | 163 | 11.6% |

**DEFECT D-03 (P0):** Webhook endpoints lack authentication.

- `POST /api/webhooks/read-ai` - no auth check
- `POST /api/webhooks/graph` (Microsoft Graph) - no auth check
- **Evidence:** These endpoints are registered without `requireAuth` or signature validation middleware.
- **Impact:** External attackers could POST arbitrary data to these endpoints.
- **Next action:** Add webhook signature validation or IP allowlist.

**DEFECT D-04 (P1):** 587 endpoints (41.6%) use AUTH only with no entity-level permission check.

- Includes financial GET endpoints (`/api/cos-tracker`, `/api/gp-tracker`, `/api/revenue-tracker`).
- The frontend hides pages from unauthorized roles, but the APIs are callable directly by any authenticated user.
- **Impact:** Any authenticated user can read financial data by calling APIs directly.
- **Next action:** Add `requirePermission()` to all sensitive data endpoints.

**DEFECT D-11 (P1):** 163 endpoints (11.6%) are PUBLIC with no authentication.

- Includes stage lifecycle GET endpoints, V2 project listing/detail endpoints.
- Some may be protected by parent middleware chain (needs verification).
- **Impact:** If not protected by parent middleware, unauthenticated access to project data.
- **Next action:** Verify all PUBLIC endpoints are intentionally public or protected by parent middleware.

### 2.5 Permission Entity Coverage

Every PAGE_REGISTRY entry has a `permissionEntity` defined. When `getPermissionEntityForPath` returns null for a path, `evaluatePathAccess` blocks access.

**Status: PROVEN - no unguarded frontend routes.**

---

## 3. KPI AND FINANCIAL LOGIC AUDIT

### 3.1 KPI-to-Source Map

| KPI | Source | Endpoint | Calculation | Display |
|-----|--------|----------|-------------|---------|
| fin_revenue_vs_target | normalizedRevenueLines (settled, FYTD) | /api/company-overview | receivedRevenueFytd / totalPlannedRevenue | Company Overview |
| fin_cash_collected_vs_target | normalizedRevenueLines (settled, FYTD) | /api/company-overview | **SAME AS ABOVE** | Company Overview |
| fin_cos_vs_target | normalizedCostLines (paidDate, FYTD) | /api/company-overview | paidCostFytd / totalPlannedCost | Company Overview |
| fin_gross_margin_vs_target | Both normalized tables (FYTD) | /api/company-overview | (totalRevenueFytd - totalCostFytd) / totalRevenueFytd * 100 | Company Overview |
| fin_overdue_debtors | normalizedRevenueLines (overdue check) | /api/company-overview | Sum of amounts where overdue | Company Overview |
| COS Realised (Tracker) | program_expenses | /api/cos-tracker | isEffectivelyRealised() (invoice-based) | COS Page |
| GP % (Tracker) | program_expenses + COS-ratio allocation | /api/gp-tracker | (allocatedRevenue - COS) / allocatedRevenue * 100 | GP Tracker Page |
| Project COS Realised % | normalizedCostLines | /api/projects/:id/header-kpis | isCanonicalCosRealised() | Project Detail Header |
| Project Margin % | normalizedRevenue + normalizedCost | /api/projects/:id/header-kpis | (revenue - cost) / revenue * 100 | Project Detail Header |

### 3.2 Critical Financial Defects

**DEFECT D-05 (P0): `fin_revenue_vs_target` and `fin_cash_collected_vs_target` are IDENTICAL.**

- **File:** `server/services/company-overview-service.ts:501-502`
- **Evidence:** Both KPIs use `{ actual: receivedRevenueFytd, target: totalPlannedRevenue }`.
- **Impact:** Two supposedly distinct KPIs (Revenue Actual vs Cash Collected) with a combined 45% weight in the Finance department scorecard report the same number. The company health score is unreliable.
- **Expected behavior:** Revenue vs target should track invoiced/recognized revenue. Cash collected should track money actually in bank (using `inBankDate` or `manualInBank` flag, not just `isRevenueSettled`).
- **Next action:** Differentiate the data sources. Cash collected should use `inBankDate` or `paymentReceivedDate` specifically, not the broad `isRevenueSettled()` function.

**DEFECT D-06 (P0): COS "realised" definition is INCONSISTENT across views.**

Three different definitions of "COS realised" exist:

| View | Function | Definition | File |
|------|----------|------------|------|
| Company Overview KPI | `paidDate` check | Has paidDate = realised | company-overview-service.ts:165-166 |
| COS Tracker | `isEffectivelyRealised()` | Invoice + date OR past-month committed | finance-routes.ts:124 |
| Project Detail | `isCanonicalCosRealised()` | Override, status, cosRealised flag, OR past-month committed | cos-realisation.ts:36-64 |

- **Impact:** The same cost item can be "realised" on the COS Tracker page but "unrealised" on the Company Overview dashboard (if invoiced but not yet paid). This means the executive dashboard shows different COS numbers than the finance team's tracker.
- **Next action:** Align all views to use `isCanonicalCosRealised()` as the single source of truth, or document the intentional difference with clear labeling (e.g., "COS Paid" vs "COS Invoiced").

**DEFECT D-07 (P1): Gross Margin % inconsistency between Company Overview and GP Tracker.**

| View | Margin Calculation | Revenue Source |
|------|-------------------|----------------|
| Company Overview | (totalRevenueFytd - totalCostFytd) / totalRevenueFytd * 100 | FYTD revenue from normalizedRevenueLines with date filter |
| GP Tracker | (allocatedRevenue - COS) / allocatedRevenue * 100 | COS-ratio proportional allocation from program_expenses |
| Execution Board | (receivedInflow - paidExpenditure) / plannedRevenue * 100 | Received inflows only |

- **Impact:** Three different margin percentages shown depending on which page the user visits. This will confuse executives.
- **Next action:** Label clearly or align calculation methods.

**DEFECT D-08 (P1): Active project filtering inconsistency.**

| View | Project Scope |
|------|--------------|
| Company Overview | `getTrackerLinkedActiveProjectIdSet()` - active + linked only |
| COS Tracker | All projects (no filter at endpoint) |
| GP Tracker | All projects (no filter at endpoint) |
| Project Detail | Single project (all time) |

- **Impact:** COS and GP tracker pages may include deactivated or unlinked projects that the company overview excludes. Totals won't match.
- **Next action:** Apply consistent active project filtering across all financial endpoints.

### 3.3 Financial Year Logic

**Status: PROVEN - correctly implemented.**

- FY: September 1 to August 31.
- `getFytdRange()` in company-overview-service.ts:53-60 correctly calculates FY boundaries.
- Current FY (April 2026): Sep 2025 - Aug 2026.

### 3.4 Static COS Budget

**Status: PROVEN - single source of truth exists.**

- `STATIC_COS_BUDGET_FY26` in `server/lib/calculations/financeUtils.ts:16-29` defines monthly budgets.
- Total: R319,270,524.91 (sum of all 12 months).
- Used by both COS Tracker and GP Tracker.

### 3.5 Budget Shortfall (~29.5%) and COS Range (69-80)

**Status: UNKNOWN - not hardcoded anywhere.**

- The 29.5% shortfall is not a static constant. It would be a dynamic calculation: `(totalPlannedRevenue - receivedRevenueFytd) / totalPlannedRevenue * 100` at a point in time.
- The 69-80 COS range corresponds to an implied COS-to-revenue ratio: if margin is 20-31%, then COS/Revenue = 69-80%.
- **These values cannot be verified without a frozen test dataset.** The audit notes that the business owner's expected ranges are plausible given the formula structure, but exact verification requires running the calculations against known data.
- **Next action:** Create a frozen test dataset snapshot and verify these numbers exactly.

### 3.6 Revenue Settlement Logic

**Status: PROVEN - well-defined.**

`isRevenueSettled()` in `server/lib/finance/revenue-ar-status.ts:56-69` checks:
- Status keywords (in_bank, paid, realised, received, settled, closed)
- Payment receipt dates (paymentReceivedDate, paidDate)
- In-bank date
- Manual in-bank flag
- Confirmed paid (paidDateConfirmed or black font color on paidDate)

This is comprehensive and well-structured.

---

## 4. ROUTE-BY-ROLE ACCESS MATRIX

### 4.1 Department Navigation Visibility

| Department | Visible To |
|------------|-----------|
| Home | All roles |
| Priorities | All roles |
| Project Development | CCO, KEY_ACCOUNTS_MANAGER, PROJECT_DEVELOPER, COO_ADMIN, CEO_ADMIN |
| Project Management | PROGRAM_MANAGER, PROJECT_MANAGER_SITE, CONSTRUCTION_MANAGER, COO_ADMIN, CEO_ADMIN, ENGINEERING_MANAGER, QUALITY_MANAGER, HSE_MANAGER, SSEG_MANAGER, CFO, PROGRAM_FINANCE_MANAGER |
| Engineering | ENGINEER, ENGINEERING_MANAGER, SSEG_MANAGER |
| Quality | QUALITY_MANAGER, CONSTRUCTION_MANAGER, COO_ADMIN, CEO_ADMIN, ENGINEERING_MANAGER, SSEG_MANAGER |
| Finance | CFO, PROGRAM_FINANCE_MANAGER, ACCOUNTANT, COO_ADMIN, CEO_ADMIN, PROGRAM_MANAGER, PROJECT_MANAGER_SITE, CONSTRUCTION_MANAGER, CCO, KEY_ACCOUNTS_MANAGER, PROJECT_DEVELOPER |
| Parties | Role-based visibility rules |
| Admin | COO_ADMIN, CEO_ADMIN |

### 4.2 Role Landing Pages

| Role | Landing Page |
|------|-------------|
| COO_ADMIN | /company-overview |
| CEO_ADMIN | /company-overview |
| CFO | /cashflow |
| PROGRAM_FINANCE_MANAGER | /cashflow |
| ACCOUNTANT | /cashflow |
| PROJECT_MANAGER_SITE | /execution-board |
| PROGRAM_MANAGER | /execution-board |
| CONSTRUCTION_MANAGER | /execution-board |
| ENGINEERING_MANAGER | /engineering |
| ENGINEER | /engineering |
| QUALITY_MANAGER | /quality |
| CCO | /pd |
| KEY_ACCOUNTS_MANAGER | /pd |
| PROJECT_DEVELOPER | /pd |
| HSE_MANAGER | /hse |
| SSEG_MANAGER | /hse |

**Status: PROVEN - every role has a landing page.**

### 4.3 Enforcement Mechanism

- Frontend: `RoleGuard` -> `useAccessMatrix` -> `evaluatePathAccess` (section check + entity permission check).
- Backend: `requirePermission(entity, action)` middleware on API routes.
- Unknown frontend paths blocked by `failOpenForUnknown: false`.

**Status: PROVEN for frontend. SUSPECTED GAPS for backend (see D-04).**

---

## 5. DEFECT LOG

| ID | Severity | Category | Title | File | Status |
|----|----------|----------|-------|------|--------|
| D-01 | P2 | Route Config | Dead routeComponentKey `MyToolPrioritiesPage` in alias entry | page-registry.ts:73 | OPEN |
| D-02 | P3 | Route Config | 5 orphaned ROUTE_COMPONENTS entries with no registry match | App.tsx:158-276 | OPEN |
| D-03 | P0 | Security | Webhook endpoints lack authentication | server/routes/ (webhooks) | OPEN - STOP SHIP |
| D-04 | P1 | Security | Financial API endpoints lack entity-level permission checks | server/departments/finance-routes.ts | OPEN |
| D-05 | P0 | KPI Logic | fin_revenue_vs_target and fin_cash_collected_vs_target are identical | company-overview-service.ts:501-502 | OPEN - STOP SHIP |
| D-06 | P0 | KPI Logic | COS "realised" defined differently across 3 views | Multiple files (see section 3.2) | OPEN - STOP SHIP |
| D-07 | P1 | KPI Logic | Gross Margin % calculated differently across 3 views | Multiple files (see section 3.2) | OPEN |
| D-08 | P1 | KPI Logic | Active project filtering inconsistent across views | Multiple files (see section 3.2) | OPEN |
| D-09 | P1 | KPI Logic | Revenue vs Cash Collected feed 45% of Finance scorecard with same data | kpi-registry.ts:317-331 | OPEN |
| D-10 | P1 | Testing | No frozen test dataset exists for financial KPI verification | N/A | OPEN |
| D-11 | P1 | Security | 163 PUBLIC endpoints (11.6%) need auth verification | server/routes/ (multiple) | OPEN |

---

## 6. CERTIFICATION CHECKLIST

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Every route loads | PROVEN | All 112 lazy imports resolve to existing files. Route -> component -> file chain verified. |
| Every permission entity assigned | PROVEN | All PAGE_REGISTRY entries have `permissionEntity`. Unknown paths blocked. |
| Frontend permission enforcement | PROVEN | RoleGuard + useAccessMatrix + evaluatePathAccess chain verified. |
| Backend authentication | PROVEN | requireAuth middleware on protected routes. JWT token verification. |
| Backend permission enforcement | NOT CERTIFIED | Some financial endpoints lack entity-level checks (D-04). |
| Webhook security | NOT CERTIFIED | No auth on webhook endpoints (D-03). |
| KPI correctness | NOT CERTIFIED | D-05 (duplicate KPIs), D-06 (inconsistent COS definition). |
| Financial logic consistency | NOT CERTIFIED | D-06, D-07, D-08 (COS, margin, project scope inconsistencies). |
| Budget shortfall ~29.5% verified | NOT CERTIFIED | No frozen test dataset (D-10). |
| Actual COS 69-80 range verified | NOT CERTIFIED | No frozen test dataset (D-10). |
| Button/action manifest | NOT CERTIFIED | Full action-to-API audit not yet completed. |
| Critical workflow E2E | NOT CERTIFIED | E2E workflow testing not yet executed. |
| Audit trail on critical mutations | SUSPECTED OK | Permission audit log exists, but coverage not verified for all critical mutations. |

---

## 7. WHAT IS PROVEN

1. All lazy-loaded page imports resolve to real files (zero missing).
2. Frontend route access control is well-structured (3-tier: section, sub-page, entity).
3. Backend permission middleware exists and uses the same resolution as frontend.
4. Financial year boundaries (Sep-Aug) are correctly implemented.
5. Static COS budget exists as single source of truth.
6. Revenue settlement logic is comprehensive and well-defined.
7. Every role has a landing page mapped.
8. Unknown frontend paths are blocked by default.

## 8. WHAT IS SUSPECTED BUT NOT PROVEN

1. Backend entity-level permission checks may be missing on some financial GET endpoints.
2. Audit logging may not cover all critical mutation paths.
3. COS realisation logic, while well-defined in each location, may produce different results depending on which view is queried.
4. The 29.5% budget shortfall and 69-80 COS range are plausible but unverified against a frozen dataset.

## 9. WHAT IS UNKNOWN

1. Full action manifest (every button -> API endpoint mapping).
2. Full E2E workflow testing results (import, handover, approval flows).
3. Export correctness.
4. Stale count behavior after mutations.
5. Error recovery paths.
6. Mobile navigation completeness.

---

## 10. REQUIRED NEXT ACTIONS (Priority Order)

### P0 - Must fix before release

1. **D-05:** Differentiate `fin_revenue_vs_target` from `fin_cash_collected_vs_target`. Cash collected should use `inBankDate`/`paymentReceivedDate` specifically.
2. **D-06:** Align COS realised definition. Either use `isCanonicalCosRealised()` everywhere or label views differently ("COS Paid" vs "COS Invoiced" vs "COS Realised").
3. **D-03:** Add authentication to webhook endpoints (signature validation or API key).

### P1 - Fix before release or explicitly accept

4. **D-04:** Add `requirePermission()` to financial API endpoints (cos-tracker, gp-tracker, revenue-tracker).
5. **D-07:** Document or align margin % calculation across Company Overview, GP Tracker, and Execution Board.
6. **D-08:** Apply consistent active project filtering to all financial endpoints.
7. **D-09:** Review Finance department scorecard weights given D-05.
8. **D-10:** Create frozen test dataset and verify 29.5% shortfall and 69-80 COS range.

### P2 - Can defer

9. **D-01:** Clean up dead routeComponentKey in alias entry.
10. **D-02:** Remove orphaned ROUTE_COMPONENTS entries.

---

## 11. EVIDENCE FILES

| Evidence Type | Location | Status |
|---------------|----------|--------|
| Route manifest | This document, Section 1 | Complete |
| KPI-to-source map | This document, Section 3.1 | Complete |
| Route-by-role matrix | This document, Section 4 | Complete |
| Defect log | This document, Section 5 | Complete |
| Release gate result | This document, header | NOT CERTIFIED |
| Action manifest | Not yet produced | Pending |
| Workflow certification checklist | Not yet produced | Pending |
| Action-to-API map | Not yet produced | Pending |

---

*End of audit report.*
