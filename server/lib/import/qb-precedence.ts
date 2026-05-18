/**
 * Smart Import × QuickBooks precedence gate.
 *
 * Architectural rule (confirmed with finance, April 2026):
 *   - For rows that have an active QuickBooks link, QuickBooks is the
 *     source of truth on amount, VAT, invoice number, invoice date,
 *     paid date and in-bank date. The workbook can NEVER overwrite
 *     these fields on a linked row; only unlinking the QB row releases
 *     the lock.
 *   - When QuickBooks shows the document as Paid (balance = 0 OR
 *     status = 'Paid'), the row is auto-realised on commit, regardless
 *     of the workbook's cosRealised flag.
 *   - Disagreements are logged to import_qb_variances for the audit
 *     trail; the workbook value is silently dropped.
 *
 * The merge logic is a pure function (mergeQbValues) so it is fully
 * testable without a database. applyQbPrecedence is the DB-aware
 * wrapper used by commit-executor.
 */

import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type QbAppEntityType = "cost_line" | "revenue_line";

/** Subset of quickbooks_invoice_links columns the gate needs. */
export interface QbLinkSnapshot {
  id: number;
  qbEntityType: string;
  qbEntityId: string;
  qbRealmId: string;
  qbDocNumber: string | null;
  qbTxnDate: string | null;
  qbAmount: string | number | null;
  qbCounterpartyName: string | null;
}

/** Subset of quickbooks_documents columns the gate needs. */
export interface QbDocSnapshot {
  id: number;
  qbEntityType: string;
  qbEntityId: string;
  qbRealmId: string;
  qbDocNumber: string | null;
  qbTxnDate: string | null;
  qbAmountExVat: string | number | null;
  qbTaxAmount: string | number | null;
  qbAmountIncVat: string | number | null;
  qbBalance: string | number | null;
  qbPaymentStatus: string | null;
}

export interface QbVariance {
  field: string;
  workbookValue: unknown;
  qbValue: unknown;
  resolution: "qb_locked" | "auto_realised" | "missing_preserved";
  notes?: string;
  // Stamped by applyQbPrecedence() for the audit-log writer.
  qbLinkId?: number | null;
  qbDocId?: number | null;
  qbRealmId?: string | null;
}

/**
 * Minimal structural surface of the Drizzle transaction used by the
 * DB-touching helpers below. The real handle is typed `any` at its source
 * (`server/db.ts`, dual pg / dev-SQLite driver); this narrows it without
 * widening back to `any`.
 */
interface QbTx {
  select(): {
    from(table: unknown): {
      where(condition: unknown): { limit(n: number): Promise<Record<string, unknown>[]> };
    };
  };
  update(table: unknown): {
    set(values: Record<string, unknown>): {
      where(condition: unknown): Promise<unknown> & {
        returning(columns: Record<string, unknown>): Promise<unknown[]>;
      };
    };
  };
  execute(query: import("drizzle-orm").SQL): Promise<unknown>;
}

export interface QbPrecedenceResult {
  finalValues: Record<string, unknown>;
  isLinked: boolean;
  lockedFields: string[];
  autoRealised: boolean;
  variances: QbVariance[];
}

/**
 * Fields locked to QB values on linked rows.
 *
 * Confirmed scope (sprint 1):
 *   - amountExVat: bank-of-record on amount
 *   - vat:         derived from QB tax decomposition
 *   - invoiceNumber: QB DocNumber stays canonical
 *   - invoiceDate:   QB TxnDate
 *   - paidDate:      derived from QB payment events
 *   - inBankDate:    derived from QB deposit events
 *
 * NOT locked (workbook still wins):
 *   - description, counterpartyName, costCategory, poNumber
 *   - admin overrides (third layer, applied on top of QB-locked values)
 */
export const QB_LOCKED_COST_FIELDS = [
  "amountExVat",
  "vat",
  "invoiceNumber",
  "invoiceDate",
  "paidDate",
  "inBankDate",
] as const;

export const QB_LOCKED_REVENUE_FIELDS = [
  "amountExVat",
  "vat",
  "invoiceNumber",
  "invoiceDate",
  "paidDate",
  "inBankDate",
] as const;

// ---------------------------------------------------------------------------
// Pure merge logic (no DB)
// ---------------------------------------------------------------------------

function toNumberOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function isQbPaid(doc: QbDocSnapshot): boolean {
  if (doc.qbPaymentStatus && doc.qbPaymentStatus.toLowerCase() === "paid") return true;
  const balance = toNumberOrNull(doc.qbBalance);
  if (balance != null && balance === 0) return true;
  return false;
}

function valuesDiffer(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return false;
  if (a == null || b == null) return true;
  // Number-aware comparison for monetary fields
  const aNum = toNumberOrNull(a);
  const bNum = toNumberOrNull(b);
  if (aNum != null && bNum != null) return Math.abs(aNum - bNum) > 0.005;
  // String comparison: trim + case-insensitive (matches row-matcher.norm)
  return String(a).trim().toLowerCase() !== String(b).trim().toLowerCase();
}

/**
 * Pure merge: given the proposed write values, the QB link, and the QB
 * document snapshot, return the final values to write plus the audit
 * trail. Used directly in unit tests.
 */
export function mergeQbValues(opts: {
  appEntityType: QbAppEntityType;
  proposedValues: Record<string, unknown>;
  link: QbLinkSnapshot | null;
  doc: QbDocSnapshot | null;
}): QbPrecedenceResult {
  const { appEntityType, proposedValues, link, doc } = opts;

  // Unlinked rows: pass-through. This is the existing behaviour.
  if (!link) {
    return {
      finalValues: proposedValues,
      isLinked: false,
      lockedFields: [],
      autoRealised: false,
      variances: [],
    };
  }

  const lockedFields = appEntityType === "cost_line" ? QB_LOCKED_COST_FIELDS : QB_LOCKED_REVENUE_FIELDS;
  const finalValues: Record<string, unknown> = { ...proposedValues };
  const variances: QbVariance[] = [];

  // Resolve QB authoritative values for the locked fields. Prefer the
  // doc snapshot (richer, has VAT decomposition) and fall back to the
  // link snapshot (always present).
  const qbAuthoritative: Record<string, unknown> = {
    amountExVat: doc?.qbAmountExVat ?? link.qbAmount ?? null,
    vat: doc?.qbTaxAmount ?? null,
    invoiceNumber: doc?.qbDocNumber ?? link.qbDocNumber ?? null,
    invoiceDate: doc?.qbTxnDate ?? link.qbTxnDate ?? null,
    // QB doesn't expose paidDate / inBankDate as flat columns yet;
    // these are inferred from payment events. When unavailable we
    // leave the workbook value alone (no override).
    paidDate: undefined,
    inBankDate: undefined,
  };

  for (const field of lockedFields) {
    const qbVal = qbAuthoritative[field];
    if (qbVal === undefined) continue; // QB has no opinion → workbook wins
    const wbVal = proposedValues[field];
    if (valuesDiffer(wbVal, qbVal)) {
      variances.push({
        field,
        workbookValue: wbVal,
        qbValue: qbVal,
        resolution: "qb_locked",
      });
    }
    finalValues[field] = qbVal;
  }

  // Auto-realisation: if QB shows the document as Paid, force cosRealised.
  // Only meaningful for cost lines.
  let autoRealised = false;
  if (appEntityType === "cost_line" && doc && isQbPaid(doc)) {
    if (!finalValues.cosRealised) {
      autoRealised = true;
      variances.push({
        field: "cosRealised",
        workbookValue: !!proposedValues.cosRealised,
        qbValue: true,
        resolution: "auto_realised",
        notes: `QB balance=${doc.qbBalance ?? "null"}, status=${doc.qbPaymentStatus ?? "null"}`,
      });
    }
    finalValues.cosRealised = true;
  }

  return {
    finalValues,
    isLinked: true,
    lockedFields: [...lockedFields],
    autoRealised,
    variances,
  };
}

// ---------------------------------------------------------------------------
// DB-aware wrapper
// ---------------------------------------------------------------------------

/**
 * Look up the QB link + doc snapshot for an existing app row and apply
 * the precedence rules. For NEW rows (no existingId), this is a no-op
 * because the link cannot exist yet — links reference an
 * already-inserted normalized_*_lines.id.
 */
export async function applyQbPrecedence(opts: {
  tx: QbTx;
  appEntityType: QbAppEntityType;
  appEntityId: number | null;
  proposedValues: Record<string, unknown>;
}): Promise<QbPrecedenceResult> {
  const { tx, appEntityType, appEntityId, proposedValues } = opts;

  if (appEntityId == null) {
    return {
      finalValues: proposedValues,
      isLinked: false,
      lockedFields: [],
      autoRealised: false,
      variances: [],
    };
  }

  const { quickbooksInvoiceLinks, quickbooksDocuments } = await import("@shared/schema");
  const { and, eq, isNull } = await import("drizzle-orm");

  const linkRows = await tx
    .select()
    .from(quickbooksInvoiceLinks)
    .where(and(
      eq(quickbooksInvoiceLinks.appEntityType, appEntityType),
      eq(quickbooksInvoiceLinks.appEntityId, appEntityId),
      isNull(quickbooksInvoiceLinks.deletedAt),
    ))
    .limit(1);

  if (linkRows.length === 0) {
    return mergeQbValues({ appEntityType, proposedValues, link: null, doc: null });
  }

  const link = linkRows[0] as unknown as QbLinkSnapshot & { deletedAt: unknown };

  const docRows = await tx
    .select()
    .from(quickbooksDocuments)
    .where(and(
      eq(quickbooksDocuments.qbEntityType, link.qbEntityType),
      eq(quickbooksDocuments.qbEntityId, link.qbEntityId),
      eq(quickbooksDocuments.qbRealmId, link.qbRealmId),
      isNull(quickbooksDocuments.deletedAt),
    ))
    .limit(1);

  const doc = (docRows[0] ?? null) as unknown as QbDocSnapshot | null;
  const result = mergeQbValues({ appEntityType, proposedValues, link, doc });

  // Stamp the link/doc IDs into each variance for the audit log writer.
  for (const v of result.variances) {
    v.qbLinkId = link.id;
    v.qbDocId = doc?.id ?? null;
    v.qbRealmId = link.qbRealmId;
  }

  return result;
}

/**
 * For MISSING_FROM_UPLOAD rows: check whether the row is QB-linked. If so,
 * the soft-close should be SUPPRESSED — QB still considers this document
 * to exist, so the workbook's silence on it doesn't justify removal.
 *
 * Returns the active link if any (for variance logging), otherwise null.
 */
export async function lookupQbLink(opts: {
  tx: QbTx;
  appEntityType: QbAppEntityType;
  appEntityId: number;
}): Promise<QbLinkSnapshot | null> {
  const { tx, appEntityType, appEntityId } = opts;
  const { quickbooksInvoiceLinks } = await import("@shared/schema");
  const { and, eq, isNull } = await import("drizzle-orm");

  const linkRows = await tx
    .select()
    .from(quickbooksInvoiceLinks)
    .where(and(
      eq(quickbooksInvoiceLinks.appEntityType, appEntityType),
      eq(quickbooksInvoiceLinks.appEntityId, appEntityId),
      isNull(quickbooksInvoiceLinks.deletedAt),
    ))
    .limit(1);

  return (linkRows[0] ?? null) as unknown as QbLinkSnapshot | null;
}

/**
 * Persist variances + auto-realisation events to the audit table. Failure
 * to log MUST NOT fail the import — wrap in try/catch at call site.
 */
export async function writeQbVariances(opts: {
  tx: QbTx;
  importRunId: number;
  projectId: number;
  appEntityType: QbAppEntityType;
  appEntityId: number;
  variances: QbVariance[];
}): Promise<void> {
  const { tx, importRunId, projectId, appEntityType, appEntityId, variances } = opts;
  if (variances.length === 0) return;

  await tx.execute(sql`
    INSERT INTO public.import_qb_variances
      (import_run_id, project_id, app_entity_type, app_entity_id,
       qb_link_id, qb_doc_id, qb_realm_id,
       field_name, workbook_value, qb_value, resolution, notes)
    VALUES ${sql.join(
      variances.map((v) => {
        const link = v.qbLinkId ?? null;
        const doc = v.qbDocId ?? null;
        const realm = v.qbRealmId ?? null;
        return sql`(
          ${importRunId}, ${projectId}, ${appEntityType}, ${appEntityId},
          ${link}, ${doc}, ${realm},
          ${v.field},
          ${v.workbookValue == null ? null : String(v.workbookValue)},
          ${v.qbValue == null ? null : String(v.qbValue)},
          ${v.resolution},
          ${v.notes ?? null}
        )`;
      }),
      sql`, `,
    )}
  `);
}

/**
 * Re-point any active QB links from `oldAppEntityId` to `newAppEntityId`
 * after a temporal soft-close + insert. Without this, the link stays
 * pinned to the soft-closed predecessor and `applyQbPrecedence` becomes
 * a permanent no-op on the very next import — breaking the entire gate.
 *
 * Returns the number of links re-pointed (0 if none — the row wasn't
 * QB-linked).
 */
export async function repointQbLinks(opts: {
  tx: QbTx;
  appEntityType: QbAppEntityType;
  oldAppEntityId: number;
  newAppEntityId: number;
}): Promise<number> {
  const { tx, appEntityType, oldAppEntityId, newAppEntityId } = opts;
  if (oldAppEntityId === newAppEntityId) return 0;
  const { quickbooksInvoiceLinks } = await import("@shared/schema");
  const { and, eq, isNull } = await import("drizzle-orm");
  const updated = await tx
    .update(quickbooksInvoiceLinks)
    .set({ appEntityId: newAppEntityId, updatedAt: new Date() })
    .where(and(
      eq(quickbooksInvoiceLinks.appEntityType, appEntityType),
      eq(quickbooksInvoiceLinks.appEntityId, oldAppEntityId),
      isNull(quickbooksInvoiceLinks.deletedAt),
    ))
    .returning({ id: quickbooksInvoiceLinks.id });
  return updated.length;
}

/**
 * Lightweight gate check used by commit-executor before applying the
 * precedence rules. Reads the feature flag from app_settings (cached
 * for the duration of the import via the caller).
 */
export async function isQbPrecedenceEnabled(): Promise<boolean> {
  try {
    const { getFeatureFlag } = await import("../feature-flags");
    return await getFeatureFlag("smart_import_qb_precedence");
  } catch {
    return false;
  }
}
