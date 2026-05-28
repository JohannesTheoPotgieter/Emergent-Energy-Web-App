/**
 * TF-20 (audit V3) — Material finance edit gate.
 *
 * Before this gate existed, `PATCH /api/finance/cost-lines/:id` and
 * `PATCH /api/finance/revenue-lines/:id` accepted any change a user
 * with `financials:edit` cared to make. A finance editor could flip
 * the `paid_date` on a R 10M invoice — which moves it between
 * "outstanding" and "realised" in cashflow, COS, GP and the FY tile —
 * without any manager sign-off.
 *
 * The gate runs at the start of the PATCH handler. It inspects the
 * incoming payload, classifies each changed field as MATERIAL (changes
 * realisation bucketing) or COSMETIC, and:
 *
 *   - All-cosmetic patch              → write directly, as before.
 *   - Material patch under threshold  → write directly + audit emits
 *                                       a "material_edit_below_threshold"
 *                                       flag so reviewers can sample.
 *   - Material patch above threshold  → DOES NOT write. Instead a
 *                                       pending_approvals row is
 *                                       created (kind=cost_line_material_edit
 *                                       or revenue_line_material_edit).
 *                                       The route returns 202 + the
 *                                       approval id; the eventual
 *                                       reviewer's "approve" applies the
 *                                       patch through the same write
 *                                       service.
 *
 * Material fields (initial set; configurable):
 *   - paid_date          (flips realisation under § 3.2 / § 3.4)
 *   - invoice_date       (changes COS month + cashflow bucket)
 *   - amount_ex_vat      (re-allocates revenue under § 3.3)
 *   - po_number          (re-anchors procurement linkage)
 *
 * Threshold: R 50 000 absolute change OR ±5% of amount_ex_vat,
 * configurable via FINANCE_MATERIAL_EDIT_THRESHOLD_ZAR env var.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  normalizedCostLines,
  normalizedRevenueLines,
  pendingApprovals,
} from "@shared/schema";

const DEFAULT_THRESHOLD_ZAR = 50_000;
const PCT_THRESHOLD = 0.05;

const MATERIAL_COST_LINE_FIELDS = new Set([
  "paidDate",
  "paid_date",
  "invoiceDate",
  "invoice_date",
  "amountExVat",
  "amount_ex_vat",
  "poNumber",
  "po_number",
]);

const MATERIAL_REVENUE_LINE_FIELDS = new Set([
  "paidDate",
  "paid_date",
  "invoiceDate",
  "invoice_date",
  "amountExVat",
  "amount_ex_vat",
  "expectedPaymentDate",
  "expected_payment_date",
]);

export type MaterialEditDomain = "cost_line" | "revenue_line";

export interface MaterialEditOutcome {
  /** What the gate decided. */
  decision: "write_direct" | "below_threshold" | "queued_for_approval";
  /** Pending-approval id when decision === "queued_for_approval". */
  pendingApprovalId?: number;
  /** Material fields that changed in this patch. */
  materialFieldsChanged: string[];
  /** Cosmetic fields that changed in this patch. */
  cosmeticFieldsChanged: string[];
  /** Absolute amount delta when amount_ex_vat changed. */
  amountDeltaZar: number | null;
}

function thresholdZar(): number {
  const raw = process.env.FINANCE_MATERIAL_EDIT_THRESHOLD_ZAR;
  if (!raw) return DEFAULT_THRESHOLD_ZAR;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_THRESHOLD_ZAR;
}

/**
 * Classify a patch into material vs. cosmetic field sets.
 *
 * Exported separately so callers can dry-run the classification (e.g.
 * to show a "this will need approval" hint in the UI before submit).
 */
export function classifyMaterialEdit(
  domain: MaterialEditDomain,
  patch: Record<string, unknown>,
): { materialFields: string[]; cosmeticFields: string[] } {
  const materialSet = domain === "cost_line"
    ? MATERIAL_COST_LINE_FIELDS
    : MATERIAL_REVENUE_LINE_FIELDS;
  const materialFields: string[] = [];
  const cosmeticFields: string[] = [];
  for (const key of Object.keys(patch)) {
    if (key === "updatedAt") continue;
    if (materialSet.has(key)) materialFields.push(key);
    else cosmeticFields.push(key);
  }
  return { materialFields, cosmeticFields };
}

/**
 * Apply the gate. Caller is responsible for the actual write — this
 * function only decides whether the write should happen now or be
 * queued for approval.
 */
export async function applyMaterialEditGate(args: {
  domain: MaterialEditDomain;
  lineId: number;
  patch: Record<string, unknown>;
  actorUserId: number | null;
  actorRole: string | null;
}): Promise<MaterialEditOutcome> {
  const { domain, lineId, patch, actorUserId, actorRole } = args;
  const { materialFields, cosmeticFields } = classifyMaterialEdit(domain, patch);

  if (materialFields.length === 0) {
    return {
      decision: "write_direct",
      materialFieldsChanged: [],
      cosmeticFieldsChanged: cosmeticFields,
      amountDeltaZar: null,
    };
  }

  // Material change present — look up the current row to compute the
  // amount delta against the proposed new amount_ex_vat (if any).
  const table = domain === "cost_line" ? normalizedCostLines : normalizedRevenueLines;
  const [current] = await db
    .select({
      id: table.id,
      amountExVat: table.amountExVat,
      projectId: table.projectId,
    })
    .from(table)
    .where(eq(table.id, lineId))
    .limit(1);

  // Compute the amount delta (if amount_ex_vat is part of the patch).
  let amountDeltaZar: number | null = null;
  const newAmountRaw = patch.amountExVat ?? patch.amount_ex_vat;
  if (newAmountRaw !== undefined && newAmountRaw !== null) {
    const oldAmount = current?.amountExVat ? Number(current.amountExVat) : 0;
    const newAmount = Number(newAmountRaw);
    if (Number.isFinite(oldAmount) && Number.isFinite(newAmount)) {
      amountDeltaZar = newAmount - oldAmount;
    }
  }

  const threshold = thresholdZar();
  const absDelta = amountDeltaZar !== null ? Math.abs(amountDeltaZar) : 0;
  const baseAmount = current?.amountExVat ? Math.abs(Number(current.amountExVat)) : 0;
  const exceedsAbsolute = absDelta >= threshold;
  const exceedsPct = baseAmount > 0 && absDelta / baseAmount >= PCT_THRESHOLD;

  // Pure-date-only material changes (no amount_ex_vat in the patch)
  // always queue for approval — they flip realisation regardless of size.
  const isPureAmountChange =
    materialFields.length === 1 &&
    (materialFields[0] === "amountExVat" || materialFields[0] === "amount_ex_vat");
  const queueForApproval = !isPureAmountChange || exceedsAbsolute || exceedsPct;

  if (!queueForApproval) {
    return {
      decision: "below_threshold",
      materialFieldsChanged: materialFields,
      cosmeticFieldsChanged: cosmeticFields,
      amountDeltaZar,
    };
  }

  // Queue a pending_approvals row. The patch payload is captured verbatim
  // so the approver applies exactly what was proposed.
  const kind = domain === "cost_line"
    ? "cost_line_material_edit"
    : "revenue_line_material_edit";
  const summary = describeMaterialEdit(domain, lineId, materialFields, amountDeltaZar);
  const [created] = await db
    .insert(pendingApprovals)
    .values({
      kind,
      targetTable:
        domain === "cost_line" ? "normalized_cost_lines" : "normalized_revenue_lines",
      summary,
      payload: {
        lineId,
        patch,
        materialFields,
        cosmeticFields,
        amountDeltaZar,
        projectId: current?.projectId ?? null,
        proposedByUserId: actorUserId,
        proposedByRole: actorRole,
        proposedAt: new Date().toISOString(),
      },
      sourceLabel: "finance:material-edit-gate",
      sourceRef: `${domain}:${lineId}`,
    })
    .returning({ id: pendingApprovals.id });

  return {
    decision: "queued_for_approval",
    pendingApprovalId: created?.id,
    materialFieldsChanged: materialFields,
    cosmeticFieldsChanged: cosmeticFields,
    amountDeltaZar,
  };
}

function describeMaterialEdit(
  domain: MaterialEditDomain,
  lineId: number,
  materialFields: string[],
  amountDelta: number | null,
): string {
  const fieldList = materialFields.join(", ");
  const amountClause =
    amountDelta !== null
      ? ` (amount Δ R ${amountDelta.toFixed(2)})`
      : "";
  return `${domain.replace("_", " ")} #${lineId} — material edit pending approval: ${fieldList}${amountClause}`;
}
