export const QB_ASSIGNMENT_TOLERANCE_EX_VAT = 0.01;

export type QbDocumentStatus =
  | "UNASSIGNED"
  | "PARTIALLY_ASSIGNED"
  | "FULLY_ASSIGNED"
  | "OVER_ASSIGNED_BLOCKED"
  | "TAX_UNCERTAIN";

export type CostEvidenceStatus =
  | "UNASSIGNED_EVIDENCE"
  | "PARTIALLY_EVIDENCED"
  | "FULLY_EVIDENCED";

export interface QbVatAmounts {
  qbAmountIncVat: number | null;
  qbTaxAmount: number | null;
  qbAmountExVat: number | null;
  taxUncertain: boolean;
}

export function toMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(2));
}

export function deriveQbVatAmounts(input: { totalAmt?: unknown; totalTax?: unknown }): QbVatAmounts {
  const incVat = toMoney(input.totalAmt);
  const tax = toMoney(input.totalTax);
  if (incVat === null) {
    return { qbAmountIncVat: null, qbTaxAmount: null, qbAmountExVat: null, taxUncertain: true };
  }
  if (tax === null) {
    // DF-5 (audit V2): when QB returns inc-VAT without tax, REFUSE to guess
    // ex-VAT. Returning incVat as ex-VAT inflated the cost by ~15% (ZA VAT
    // standard rate) — only the `taxUncertain` badge surfaced the doubt,
    // but the wrong number still propagated through every aggregate.
    // Returning null + taxUncertain=true is honest: downstream callers
    // already special-case taxUncertain (see computeQbDocumentStatus →
    // TAX_UNCERTAIN status, UI badges).
    return { qbAmountIncVat: incVat, qbTaxAmount: null, qbAmountExVat: null, taxUncertain: true };
  }
  return {
    qbAmountIncVat: incVat,
    qbTaxAmount: tax,
    qbAmountExVat: Number((incVat - tax).toFixed(2)),
    taxUncertain: false,
  };
}

export function computeQbDocumentStatus(qbAmountExVat: number | null, assignedExVat: number, taxUncertain: boolean): QbDocumentStatus {
  if (taxUncertain || qbAmountExVat === null) return "TAX_UNCERTAIN";
  if (assignedExVat <= QB_ASSIGNMENT_TOLERANCE_EX_VAT) return "UNASSIGNED";
  const delta = qbAmountExVat - assignedExVat;
  if (delta < -QB_ASSIGNMENT_TOLERANCE_EX_VAT) return "OVER_ASSIGNED_BLOCKED";
  if (Math.abs(delta) <= QB_ASSIGNMENT_TOLERANCE_EX_VAT) return "FULLY_ASSIGNED";
  return "PARTIALLY_ASSIGNED";
}

export function computeCostEvidence(lineAmountExVat: number, assignedQbExVat: number): {
  lineRealisedAmountExVat: number;
  lineUnrealisedRemainderExVat: number;
  status: CostEvidenceStatus;
} {
  const realised = Math.min(lineAmountExVat, assignedQbExVat);
  const remainder = Math.max(0, lineAmountExVat - assignedQbExVat);
  let status: CostEvidenceStatus = "UNASSIGNED_EVIDENCE";
  if (assignedQbExVat > QB_ASSIGNMENT_TOLERANCE_EX_VAT) {
    status = assignedQbExVat + QB_ASSIGNMENT_TOLERANCE_EX_VAT >= lineAmountExVat
      ? "FULLY_EVIDENCED"
      : "PARTIALLY_EVIDENCED";
  }

  return {
    lineRealisedAmountExVat: Number(realised.toFixed(2)),
    lineUnrealisedRemainderExVat: Number(remainder.toFixed(2)),
    status,
  };
}

export function assertNoOverAssignment(qbAmountExVat: number | null, assignedExVat: number): void {
  if (qbAmountExVat === null) return;
  if (assignedExVat - qbAmountExVat > QB_ASSIGNMENT_TOLERANCE_EX_VAT) {
    throw new Error(
      `Over-assignment blocked: assigned ex-VAT ${assignedExVat.toFixed(2)} exceeds QB ex-VAT ${qbAmountExVat.toFixed(2)}.`,
    );
  }
}
