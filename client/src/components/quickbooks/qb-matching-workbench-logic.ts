/**
 * Pure logic for QB Matching Workbench — types, constants, lane classification,
 * CSV building, and display helpers. No React, no DOM, fully unit-testable.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Scope = "cost" | "revenue";
export type RowLane = "safe" | "review" | "exception";
export type RowStatus = "idle" | "searching" | "found" | "approved" | "rejected" | "error";

export interface ScoredCandidate {
  qbEntityId: string;
  qbEntityType: "bill" | "invoice";
  qbDocNumber: string | null;
  qbTxnDate: string | null;
  qbCounterpartyName: string | null;
  qbCounterpartyId: string | null;
  qbAmountExVat: number | null;
  qbBalance: number | null;
  qbPaymentStatus: string | null;
  /** QB doc memo / PrivateNote — shown in the proof drawer for context. */
  qbDescription: string | null;
  confidence: number;
  reasons: string[];
  warnings: string[];
  qbAlreadyLinkedElsewhere: boolean;
  /**
   * Task #142 sibling-allocation snapshot. Present on every candidate
   * returned by `/api/quickbooks/invoice-matches/find` — describes the
   * existing allocation state of this QB doc so the drawer can render
   * sibling rows + remaining capacity without a second round-trip.
   */
  qbAllocation?: {
    siblingCount: number;
    totalAllocatedExVat: number;
    remainingExVat: number | null;
    siblings: Array<{
      linkId: number;
      appEntityType: "cost_line" | "revenue_line";
      appEntityId: number;
      allocatedAmountExVat: number;
    }>;
  };
}

export interface FindResponse {
  suggestionId: number;
  scope: Scope;
  app: {
    id: number;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    amountExVat: number | null;
    counterpartyName: string | null;
    poNumber: string | null;
    projectId: number | null;
    description: string | null;
  };
  warnings: { no_po: boolean; already_linked: boolean };
  candidates: ScoredCandidate[];
}

export interface WorkbenchRow {
  id: number;
  appLine: {
    id: number;
    projectId: number;
    projectName: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    amountExVat: number | null;
    counterpartyName: string | null;
    description: string | null;
  };
  findResult: FindResponse | null;
  status: RowStatus;
  lane: RowLane | null;
  errorMessage: string | null;
}

// ─── Lane Classification ──────────────────────────────────────────────────────

export const EXCEPTION_CANDIDATE_WARNINGS = new Set([
  "amount_mismatch",
  "vendor_mismatch",
  "qb_already_linked_elsewhere",
  "qb_payment_inconsistent",
]);

export function classifyLane(result: FindResponse): RowLane {
  if (result.warnings.no_po || result.warnings.already_linked) return "exception";
  const best = result.candidates[0];
  if (!best) return "exception";
  if (best.qbAlreadyLinkedElsewhere) return "exception";
  if (best.warnings.some((w) => EXCEPTION_CANDIDATE_WARNINGS.has(w))) return "exception";
  if (best.confidence >= 90 && best.warnings.length === 0) return "safe";
  if (best.confidence >= 70) return "review";
  return "exception";
}

// ─── Display Helpers ──────────────────────────────────────────────────────────

export const WARNING_LABEL: Record<string, string> = {
  no_po: "No PO number — cannot bulk-approve",
  already_linked: "App line already linked to QB",
  amount_mismatch: "Amount mismatch",
  vendor_mismatch: "Vendor/customer mismatch",
  vendor_not_matched: "Vendor/customer not matched",
  date_mismatch: "Invoice dates differ",
  qb_already_linked_elsewhere: "QB doc already linked to another row",
  qb_payment_inconsistent: "QB shows paid but balance is non-zero",
  qb_amount_unknown: "QB doc has no amount",
};

export function laneBadge(lane: RowLane | null): { label: string; cls: string } {
  switch (lane) {
    case "safe":
      return { label: "Safe", cls: "bg-emerald-100 text-emerald-800 border-emerald-300" };
    case "review":
      return { label: "Review", cls: "bg-amber-100 text-amber-800 border-amber-300" };
    case "exception":
      return { label: "Exception", cls: "bg-rose-100 text-rose-800 border-rose-300" };
    default:
      return { label: "—", cls: "bg-slate-100 text-slate-500 border-slate-200" };
  }
}

export function confidenceBadge(confidence: number): { label: string; cls: string } {
  if (confidence >= 90)
    return { label: `${confidence}%`, cls: "bg-emerald-100 text-emerald-700 border-emerald-200" };
  if (confidence >= 70)
    return { label: `${confidence}%`, cls: "bg-amber-100 text-amber-700 border-amber-200" };
  return { label: `${confidence}%`, cls: "bg-rose-100 text-rose-700 border-rose-200" };
}

// ─── Counterparty Name Similarity ─────────────────────────────────────────────

function normTokens(s: string | null | undefined): Set<string> {
  if (!s) return new Set();
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

/**
 * Normalised Jaccard token similarity — mirrors server-side nameSimilarity.
 * Returns true when similarity >= 0.3, false when clearly different,
 * undefined when either name is blank or has no usable tokens.
 */
export function counterpartyNameMatch(
  appName: string | null | undefined,
  qbName: string | null | undefined,
): boolean | undefined {
  if (!appName || !qbName) return undefined;
  const aTok = normTokens(appName);
  const bTok = normTokens(qbName);
  if (aTok.size === 0 || bTok.size === 0) return undefined;
  let inter = 0;
  for (const t of aTok) if (bTok.has(t)) inter++;
  const union = aTok.size + bTok.size - inter;
  return union > 0 && inter / union >= 0.3;
}

// ─── Bulk Approve ─────────────────────────────────────────────────────────────

export function buildBulkApproveItems(
  safeRows: WorkbenchRow[],
): Array<{ suggestionId: number; candidateIndex: number }> {
  return safeRows
    .filter((r) => r.findResult !== null)
    .map((r) => ({
      suggestionId: r.findResult!.suggestionId,
      candidateIndex: 0,
    }));
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

function csvEscape(v: unknown): string {
  return `"${String(v === null || v === undefined ? "" : v).replace(/"/g, '""')}"`;
}

/**
 * Build a CSV string from exception-lane rows.
 * Returns "" when there are no exceptions (caller should skip download).
 * No DOM side-effects — download triggering is the caller's responsibility.
 */
export function buildExceptionsCSV(rows: WorkbenchRow[], scope: Scope): string {
  const exceptions = rows.filter((r) => r.lane === "exception" && r.findResult);
  if (exceptions.length === 0) return "";

  const headers = [
    "App Line ID",
    "Project",
    "Invoice #",
    "Date",
    scope === "cost" ? "Supplier" : "Milestone",
    "App Amount",
    "Best QB Doc #",
    "QB Amount",
    "Score",
    "App Warnings",
    "Candidate Warnings",
  ];

  const dataRows = exceptions.map((r) => {
    const best = r.findResult!.candidates[0] ?? null;
    const appW: string[] = [];
    if (r.findResult!.warnings.no_po) appW.push("no_po");
    if (r.findResult!.warnings.already_linked) appW.push("already_linked");
    return [
      r.appLine.id,
      r.appLine.projectName ?? r.appLine.projectId,
      r.appLine.invoiceNumber ?? "",
      r.appLine.invoiceDate ?? "",
      r.appLine.counterpartyName ?? "",
      r.appLine.amountExVat ?? "",
      best?.qbDocNumber ?? "",
      best?.qbAmountExVat ?? "",
      best?.confidence ?? "",
      appW.join("|"),
      best?.warnings.join("|") ?? "",
    ];
  });

  return [headers, ...dataRows].map((r) => r.map(csvEscape).join(",")).join("\n");
}
