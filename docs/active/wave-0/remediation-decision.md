# EXPENDITURE paidDate fallback — remediation decision

**Date:** 2026-05-08
**Phase:** Plan v3 § 1.4 (Finance trust restoration — pick remediation option)
**Bug:** § 3.7 / § 3.4 violation in `server/lib/import/normalizer.ts` where `paidDate` / `paidDateConfirmed` could fall back to `forecastPaymentDate` colour. Fixed by PR #841 (commit `465f325`, merged 2026-05-07).
**Inputs:** `docs/active/wave-0/blast-radius-paiddate-2026-05-07.md` (read-only diagnostic, generated 2026-05-07T17:43:41Z)
**Audience:** Johannes (COO), Programme Finance Manager, CFO, future agents

---

## Decision

**Option 1 — fix-forward only.** No code change, no migration, no backfill.

Existing `normalized_cost_lines` rows are unaffected; the fix in PR #841 prevents any future imports from triggering the bug.

## Rationale

The blast-radius diagnostic returned **zero suspect rows** across the full dataset:

| Metric | Value |
|---|---|
| Total suspect rows | 0 |
| Strict suspects (paid_date NULL, bug fingerprint) | 0 |
| Loose suspects (paid_date present, colour ≠ black) | 0 |
| Suspect rows with `cashflow_confirmed = true` | 0 |
| Inflated cashflow total | R 0.00 |
| Projects affected | 0 |

Per the v3 § 1.4 threshold table:

| Strict suspects | Recommended option |
|---|---|
| **< 50 rows** | **Option 1 — fix-forward only** |
| 50–500 rows | Option 2 — targeted backfill |
| 500+ rows | Option 3 — force re-import |

Zero is comfortably below the Option 1 threshold. There is nothing to remediate.

## Why "no rows" doesn't mean "no bug"

The fallback existed in code from before commit `465f325`. The diagnostic shows the *dataset* never carried a row that exhibited the bug fingerprint by the time we ran the script. Possible reasons:

1. The buggy code path required a specific cell-format combination (forecast date present + black forecast font + actual paid date blank) that simply did not occur in any imported workbook.
2. Affected rows may have been re-imported under correct cell formatting before this diagnostic ran (workbooks evolve as PMs update them).
3. The bug surfaced in synthetic/test data only and never reached production tables.

Whichever cause applies, **the empirical state of `normalized_cost_lines` as of 2026-05-07 is clean**. The fix-forward posture is justified by data, not by hope.

## What stays in place

- **PR #841** — the code fix prevents any future imports from re-introducing the inflation.
- **`scripts/blast-radius-paiddate.ts`** — kept as a permanent diagnostic. Re-runnable any time. Useful as a regression check after any future change to `normalizer.ts:1601-1671`.
- **`qa/tests/unit/smart-import-paid-date-actual-only.test.ts`** — 5 unit tests pinning the § 3.7 invariant against future regressions.

## What does NOT happen

- No new migration in `migrations/`.
- No `audit_events` rows for "remediation" (there is nothing to audit).
- No batched re-import of active projects.

## Communication plan

- **CFO + Programme Finance Manager brief** (v3 § 1.5): one-line message — bug existed, fix shipped, dataset was clean, no numbers move. Message text below.
- **Closes Plan v3 § 1.4–1.6** as a single decision; no code-PR follow-up under Track A.

## Suggested CFO + PM Finance brief (paste-ready)

> Heads-up — Smart Import had a § 3.7 bug where the actual paid-date column could silently inherit from the forecast paid-date column when blank, which would have flipped some cost lines to "cashflow confirmed" without an actual payment. The bug was fixed in PR #841 last week. I ran a read-only diagnostic against the live data and it found **zero affected rows** — no inflated cashflow, no projects affected, no remediation needed. New imports going forward respect the rule. The diagnostic script is committed (`scripts/blast-radius-paiddate.ts`) and we'll re-run it any time the import normalizer changes. No action on your end; cashflow numbers will not move.

## Revisit triggers

- If `normalizer.ts` is touched in the import pipeline again, re-run `tsx scripts/blast-radius-paiddate.ts` as part of the verification.
- If a user reports cost-line cashflow numbers that don't match QuickBooks, check whether the row pre-dates PR #841's merge (2026-05-07) and re-run the diagnostic.

## Status

- [x] Blast-radius script run
- [x] Output reviewed
- [x] Option chosen (1 — fix-forward)
- [ ] CFO + Programme Finance brief sent (v3 § 1.5 — owner: COO)
- [x] No remediation migration needed (Option 1 closes Track A)
