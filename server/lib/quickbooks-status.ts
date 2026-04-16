export type QbMatchType =
  | "linked_txn_id"
  | "invoice_counterparty_amount"
  | "invoice_amount"
  | "unmatched";

export type QbMatchConfidence = "high" | "medium" | "low";

export type InflowQbStatus = "Received" | "Partially received" | "Not received" | "Unknown";
export type OutflowQbStatus = "Paid" | "Partially paid" | "Not paid" | "Unknown";

export interface QbTxnCandidate {
  id: string;
  docNumber: string | null;
  totalAmount: number | null;
  balance: number | null;
  counterpartyName: string | null;
  txnDate: string | null;
  statusDate: string | null;
}

export interface QbStatusResolutionInput {
  linkedTransactionId?: string | null;
  invoiceNumber?: string | null;
  projectName?: string | null;
  counterpartyName?: string | null;
  amount?: number | null;
  candidates: QbTxnCandidate[];
}

export interface QbStatusResolutionResult {
  qbTransactionId: string | null;
  qbMatchType: QbMatchType;
  qbMatchConfidence: QbMatchConfidence;
  matched: QbTxnCandidate | null;
}

const AMOUNT_TOLERANCE = 0.01;

function norm(v: string | null | undefined): string {
  return (v || "").trim().toLowerCase();
}

function amountMatches(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return Math.abs(a - b) <= AMOUNT_TOLERANCE;
}

export function resolveQbMatch(input: QbStatusResolutionInput): QbStatusResolutionResult {
  const byId = input.linkedTransactionId
    ? input.candidates.find((c) => c.id === String(input.linkedTransactionId))
    : null;
  if (byId) {
    return {
      qbTransactionId: byId.id,
      qbMatchType: "linked_txn_id",
      qbMatchConfidence: "high",
      matched: byId,
    };
  }

  const invoice = norm(input.invoiceNumber);
  const counterparty = norm(input.counterpartyName);
  const amount = input.amount ?? null;

  if (invoice) {
    if (counterparty) {
      const tier2 = input.candidates.find((c) => {
        if (norm(c.docNumber) !== invoice) return false;
        if (!amountMatches(c.totalAmount, amount)) return false;
        return norm(c.counterpartyName) === counterparty;
      });

      if (tier2) {
        return {
          qbTransactionId: tier2.id,
          qbMatchType: "invoice_counterparty_amount",
          qbMatchConfidence: "high",
          matched: tier2,
        };
      }
    }

    const tier3 = input.candidates.find(
      (c) => norm(c.docNumber) === invoice && amountMatches(c.totalAmount, amount),
    );
    if (tier3) {
      return {
        qbTransactionId: tier3.id,
        qbMatchType: "invoice_amount",
        qbMatchConfidence: "medium",
        matched: tier3,
      };
    }
  }

  return {
    qbTransactionId: null,
    qbMatchType: "unmatched",
    qbMatchConfidence: "low",
    matched: null,
  };
}

export function deriveInflowsQbStatus(
  balance: number | null,
  matched: boolean,
  amount: number | null,
): InflowQbStatus {
  if (!matched) return "Unknown";
  if (balance === null || balance === undefined) return "Unknown";
  if (balance <= AMOUNT_TOLERANCE) return "Received";
  if (amount !== null && amount !== undefined && amountMatches(balance, amount)) return "Not received";
  return "Partially received";
}

export function deriveOutflowsQbStatus(
  balance: number | null,
  matched: boolean,
  amount: number | null,
): OutflowQbStatus {
  if (!matched) return "Unknown";
  if (balance === null || balance === undefined) return "Unknown";
  if (balance <= AMOUNT_TOLERANCE) return "Paid";
  if (amount !== null && amount !== undefined && amountMatches(balance, amount)) return "Not paid";
  return "Partially paid";
}
