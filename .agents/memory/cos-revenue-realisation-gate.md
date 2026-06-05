---
name: COS/revenue realisation gate
description: How "Realised" is decided for cost & revenue lines, and why the future guard is month-granular
---

# Canonical realisation gate

`server/lib/finance/cos-realisation.ts` → `isCanonicalCosRealised()` is the
**single source of truth** for whether a line is "Realised". Revenue realisation
routes through the same gate (`revenue-recognition.ts` →
`isEffectivelyRealised()` → `isCanonicalCosRealised()`), so cost and revenue
lanes stay consistent. Many surfaces depend on it (COS Tracker, Revenue Tracker,
GP recon grid, dashboards, portfolio/project KPIs). Change it once, everywhere
moves.

Precedence order inside the gate:
1. Admin override (`cosStatusOverride` REALISED / not-realised) wins absolutely.
2. QuickBooks evidence (`lineAssignedQbExVat` > 0) → realised.
3. Future-MONTH guard (see below).
4. Invoice present + non-placeholder + invoice-date **confirmed (black font /
   `invoiceDateConfirmed`)** + non-zero amount → realised. Red/unconfirmed → not.

## Future-MONTH guard is month-granular, NOT day-granular

**Rule:** a line is excluded from Realised only if its invoice date lands in a
month **after** the as-at (`today`) month. Current-month lines clear the guard;
the confirmation gate (step 4) then decides.

**Why:** the tracker books each month's cost/revenue at the **month-END date**
(e.g. 30 June), not spread across days. A day-granular "after today" check
therefore held the *current* month at R0 until its final day even after finance
had confirmed the lines — e.g. on 5 June, every June line dated 30 June showed
R0 Realised, which read as "no June data". Owner (COO) decision **2026-06-05**:
once the as-at date reaches a month, that month's confirmed lines may realise;
only later months stay Committed/Planned.

**Why it does NOT re-introduce the earlier over-count:** the original guard
(owner decision 2026-06) was added to stop FUTURE-dated lines inflating
Realised. Future *months* are still excluded, so the cross-month over-count
stays fixed. Only the current month's treatment changed, and the confirmation
(black) gate still filters out unconfirmed current-month lines.

**How to apply:** boundary math uses `Date.UTC(year, month + 1, 1)` (handles
Dec→Jan rollover) and excludes `invoiceEpoch >= nextMonthStart`. `today` falls
back to wall-clock when a caller omits it — callers should pass an ISO `today`
for reproducible as-at/backfill reads. `isEffectivelyRealised` keeps a second
`monthKey <= currentMonthKey` boundary; the two must stay consistent.

Tests: `qa/tests/unit/cos-realisation-consistency.test.ts` (run with
`npx vitest run -c qa/vitest.config.ts <file>`; the root `npm test` uses
`qa/vitest.config.ts`, the client vitest config will NOT find these).
