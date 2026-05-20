/**
 * QuickBooks Bill account-name whitelist for Cost-of-Sales attribution.
 *
 * Problem: QB Bills are pulled into project COS by document type (Bill) +
 * project linkage (ClassRef / CustomerRef). The Bill's underlying GL
 * account (overhead, rent, COGS, etc.) is never inspected, so a Bill
 * tagged to a project class will inflate that project's COS regardless
 * of whether the line actually represents cost-of-sale.
 *
 * This module lets an operator narrow QB ingestion to Bills whose lines
 * reference specific GL accounts. Case-insensitive substring match
 * against `AccountRef.name` (no regex — bookkeepers will configure this).
 *
 * Pure module — no DB / network. Symmetric for server filtering and any
 * future client preview / dry-run.
 *
 * Activation: server reads `QB_COS_ACCOUNT_NAME_PATTERNS` (comma-separated)
 * and passes the parsed list into the reconciliation service. When the
 * env var is unset OR parses to an empty list, NO filtering is applied
 * and behaviour is identical to before this module existed.
 */

export function parseAccountNamePatterns(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export function accountNameMatchesAnyPattern(
  accountName: string | null | undefined,
  patterns: string[],
): boolean {
  if (!accountName) return false;
  if (patterns.length === 0) return false;
  const hay = accountName.toLowerCase();
  return patterns.some((p) => hay.includes(p));
}

export interface BillAccountClassificationInput {
  accountNames: string[];
}

export interface BillAccountClassificationResult {
  isCos: boolean;
  matchedAccountNames: string[];
  unmatchedAccountNames: string[];
}

/**
 * Classify a QB Bill against the COS account-name whitelist.
 *
 * Decision:
 *   - patterns is empty       → isCos=true (filter inactive)
 *   - accountNames is empty   → isCos=true (synthetic / header-only bill;
 *                                we cannot know the account so we keep
 *                                it and let it match by amount/invoice
 *                                rather than silently dropping evidence)
 *   - any account matches     → isCos=true
 *   - no account matches      → isCos=false (excluded from COS matching)
 *
 * Caller is responsible for surfacing excluded bills to the UI so the
 * operator can investigate misclassified Bills or extend the whitelist.
 */
export function classifyBillAccounts(
  bill: BillAccountClassificationInput,
  patterns: string[],
): BillAccountClassificationResult {
  if (patterns.length === 0) {
    return { isCos: true, matchedAccountNames: [], unmatchedAccountNames: [] };
  }
  if (bill.accountNames.length === 0) {
    return { isCos: true, matchedAccountNames: [], unmatchedAccountNames: [] };
  }
  const matched: string[] = [];
  const unmatched: string[] = [];
  for (const name of bill.accountNames) {
    if (accountNameMatchesAnyPattern(name, patterns)) {
      matched.push(name);
    } else {
      unmatched.push(name);
    }
  }
  return {
    isCos: matched.length > 0,
    matchedAccountNames: matched,
    unmatchedAccountNames: unmatched,
  };
}
