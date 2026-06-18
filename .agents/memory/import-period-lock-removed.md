---
name: Import tool period-lock removed
description: Why the Smart Import commit paths no longer enforce COS period locks, and what NOT to "restore"
---

# Smart Import no longer enforces COS period locks

**Decision (owner/COO, 2026-06-18):** The Smart Import tool must NOT block or park
an import because a row lands in a locked COS period. This applies to BOTH import
commit paths:
- Manual HTTP commit (`server/smart-import-routes.ts`) — the `guardCosPeriodLock`
  call + `commitLockDates` builder were removed.
- Scheduled auto-commit (`server/services/scheduled-import-v2.ts` →
  `server/lib/import/auto-commit-gate.ts`) — the `enforceCosPeriodLock` lookup,
  the `lockedPeriods` gate signal, and the park-on-locked-period branch were removed.

**Why:** Owner judged the period lock an obstruction to legitimate imports. The
other audited finance overrides exist for the rest of the system; the import path
itself is now exempt.

**How to apply / do NOT regress:**
- The remaining finance period-lock controls are INTENTIONALLY kept and must stay
  intact: COS tracker toggle-realised, COS line review, QuickBooks accept cascade,
  and the `/api/cos-periods/:yyyyMm/lock|unlock` endpoints. `enforceCosPeriodLock`
  / `guardCosPeriodLock` still exist and are used by those paths.
- Do NOT "re-add" `guardCosPeriodLock` to the import commit path or a
  `lockedPeriods` check to the auto-commit gate thinking it's a missing-control
  regression. Two source-invariant tests now assert its ABSENCE via negative
  assertions (`import-commit-gate.test.ts`, `auto-import-actor-and-allowlist.test.ts`).
- The auto-commit gate still parks on the other signals (blockers, ERROR-on-REV,
  missing allocation, over-wipe, net-delta, resurrections, conflict policy).
