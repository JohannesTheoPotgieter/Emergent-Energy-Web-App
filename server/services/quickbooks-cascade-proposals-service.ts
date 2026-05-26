/**
 * Per-link cascade proposal service.
 *
 * The QuickBooks linking flow follows a strict "never silently mutate
 * app data" contract: when an approve / bulk-approve / cascade-commit
 * creates a `quickbooks_invoice_links` row, the link itself is the only
 * thing that's persisted automatically. Every downstream change the
 * detector spots — vendor mapping, counterpartyId backfill, paid_date
 * overwrite, name-alias append, recon-ignore clear, etc. — is recorded
 * here as a `qb_link_proposed_cascades` row in `pending` status.
 *
 * The reviewer goes through the proposals one at a time and either
 * Accepts (the writer applies the mutation) or Declines (the proposal
 * is closed without effect). `import_qb_variances` is written for any
 * accepted field-level overwrite so the next Smart Import doesn't
 * re-flag the divergence as a workbook-vs-QB conflict.
 *
 * This module is the single entry point for both the detector and the
 * accept/decline writer. It deliberately does NOT call `confirmCostLineLink`
 * or any other link-creation helper — those run before this and pass us
 * the freshly-created link id.
 */

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "../db";
import { recordAudit } from "../api/v2/services/audit-service";
import {
  counterparties,
  importQbVariances,
  invoiceDescriptionPatterns,
  invoicePatternRules,
  normalizedCostLines,
  normalizedRevenueLines,
  qbLinkProposedCascades,
  qbLinkProposedCascadeHistory,
  qbReconIgnores,
  qbRevenueReconIgnores,
  quickbooksCustomerMappings,
  quickbooksDocuments,
  quickbooksInvoiceLinks,
  quickbooksVendorMappings,
  type NormalizedCostLine,
  type NormalizedRevenueLine,
  type QbLinkProposedCascade,
  type QuickBooksInvoiceLink,
} from "@shared/schema";
import {
  generateRuleFromInvoice,
  normalizeInvoiceNumber as normInvoiceNumberV2,
} from "../lib/import/invoice-classifier";

// =========================================================================
// Types
// =========================================================================

export type AppEntityType = "cost_line" | "revenue_line";
export type QbEntityType = "bill" | "invoice";

/** Snapshot of the QB document (or in-memory candidate) the link points at. */
export interface QbDocSnapshot {
  qbEntityType: QbEntityType;
  qbEntityId: string;
  qbRealmId: string;
  qbDocNumber: string | null;
  qbTxnDate: string | null;
  qbDueDate?: string | null;
  qbAmountExVat: number | null;
  qbAmountIncVat?: number | null;
  qbTaxAmount?: number | null;
  qbPaymentStatus?: string | null;
  qbBalance?: number | null;
  /** QB VendorRef.value (cost) or CustomerRef.value (revenue) */
  qbCounterpartyId: string | null;
  qbCounterpartyName: string | null;
  /** ClassRef.value when present — used by class→project override proposal. */
  qbClassRefName?: string | null;
  /** QB PrivateNote / memo. Used by Phase 2 description-token learning. */
  qbDescription?: string | null;
}

/** Per-app-row context the detector needs alongside the QB doc. */
export interface AppRowContext {
  appEntityType: AppEntityType;
  appEntityId: number;
  projectId: number | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  paidDate: string | null;
  amountExVat: number | null;
  vatAmount: number | null;
  counterpartyId: number | null;
  counterpartyName: string | null;
  costCategory?: string | null;
  /** Free-text app description — vendor description for cost lines, milestone
   *  name / description for revenue lines. Used by Phase 2 description-token
   *  learning. */
  description?: string | null;
}

export interface DetectorInput {
  link: QuickBooksInvoiceLink;
  app: AppRowContext;
  qb: QbDocSnapshot;
  createdBy: number | null;
}

// =========================================================================
// Constants
// =========================================================================

/** Two amounts within R0.01 are considered equal — same threshold the
 *  scoring engine uses for tier-2 / tier-3 matches. */
const AMOUNT_EQ_TOL = 0.01;

/** Counterparty-name token-set Jaccard floor for an alias proposal. */
const ALIAS_NAME_SIM_FLOOR = 0.6;

/** Stop words excluded from description-token fingerprints. Kept short and
 *  South-Africa-finance-shaped — extend as we see more memo language. */
const DESCRIPTION_STOP_WORDS = new Set<string>([
  "the", "and", "for", "from", "with", "this", "that", "your", "our",
  "vat", "inc", "incl", "incl.", "ex", "excl", "excluding", "including",
  "invoice", "inv", "bill", "no", "ref", "reference", "po", "tax", "rsa",
  "pty", "ltd", "cc", "trust", "trading", "as", "of", "to", "in", "on",
  "at", "by", "via", "per", "due", "paid", "amount", "total", "net",
]);

const DESCRIPTION_MIN_TOKENS = 3;
const DESCRIPTION_MAX_TOKENS = 12;

export function extractDescriptionTokens(...sources: Array<string | null | undefined>): string[] {
  const merged = sources.filter(Boolean).join(" ");
  if (!merged) return [];
  const cleaned = merged
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of cleaned.split(" ")) {
    if (raw.length < 3) continue;
    if (DESCRIPTION_STOP_WORDS.has(raw)) continue;
    if (/^\d+$/.test(raw)) continue; // pure numbers — usually invoice IDs
    if (seen.has(raw)) continue;
    seen.add(raw);
    tokens.push(raw);
    if (tokens.length >= DESCRIPTION_MAX_TOKENS) break;
  }
  return tokens.length >= DESCRIPTION_MIN_TOKENS ? tokens.sort() : [];
}

// =========================================================================
// Pure helpers
// =========================================================================

function normName(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenSet(value: string | null | undefined): Set<string> {
  return new Set(
    normName(value)
      .split(" ")
      .filter((t) => t.length >= 2),
  );
}

function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const aTok = tokenSet(a);
  const bTok = tokenSet(b);
  if (aTok.size === 0 || bTok.size === 0) return 0;
  let inter = 0;
  for (const t of aTok) if (bTok.has(t)) inter++;
  const union = aTok.size + bTok.size - inter;
  return union === 0 ? 0 : inter / union;
}

function dec(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateStr(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  try {
    return new Date(value as string).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function normalizeInvoiceNumber(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

// =========================================================================
// Insert builder — dedupes against the partial unique index in-memory
// before hitting the DB.
// =========================================================================

interface ProposalDraft {
  linkId: number;
  projectId: number | null;
  targetTable: string;
  targetId: number | null;
  proposalType: string;
  fieldName: string | null;
  appValue: string | null;
  qbValue: string | null;
  reason: string;
  createdBy: number | null;
}

function pushUnique(drafts: ProposalDraft[], draft: ProposalDraft): void {
  const dup = drafts.some(
    (d) =>
      d.linkId === draft.linkId &&
      d.proposalType === draft.proposalType &&
      d.fieldName === draft.fieldName,
  );
  if (!dup) drafts.push(draft);
}

// =========================================================================
// Detector
// =========================================================================

/**
 * Inspect (link, app row, QB doc) and return zero or more proposed
 * cascades. The returned list is NOT persisted — call
 * `persistProposals(drafts)` to insert them. (Split so callers can
 * preview without writing during a transaction.)
 */
export async function detectProposals(input: DetectorInput): Promise<ProposalDraft[]> {
  const drafts: ProposalDraft[] = [];
  const { link, app, qb, createdBy } = input;
  const linkId = link.id;
  const projectId = app.projectId;
  const targetTable =
    app.appEntityType === "cost_line" ? "normalized_cost_lines" : "normalized_revenue_lines";

  // ---- Field-level divergences (paid_date, invoice_date, invoice_number,
  // amount_ex_vat, vat_amount) ---------------------------------------------

  const qbInvDate = qb.qbTxnDate;
  if (qbInvDate && app.invoiceDate !== qbInvDate) {
    pushUnique(drafts, {
      linkId,
      projectId,
      targetTable,
      targetId: app.appEntityId,
      proposalType: "invoice_date",
      fieldName: "invoice_date",
      appValue: app.invoiceDate,
      qbValue: qbInvDate,
      reason: app.invoiceDate
        ? `App: ${app.invoiceDate} · QB: ${qbInvDate}`
        : `App is empty · QB: ${qbInvDate}`,
      createdBy,
    });
  }

  // QB doesn't carry a `paid_date` field directly; we derive it from
  // payment status + balance: when QB shows the doc fully paid, propose
  // today's date OR the QB txn date as the app paid_date. We deliberately
  // do NOT propose flipping `paid_date_confirmed` / `cos_realised` —
  // realisation must stay on the canonical control path.
  if (qb.qbPaymentStatus === "paid" && (qb.qbBalance ?? 0) <= AMOUNT_EQ_TOL) {
    const proposed = qbInvDate ?? new Date().toISOString().slice(0, 10);
    if (app.paidDate !== proposed) {
      pushUnique(drafts, {
        linkId,
        projectId,
        targetTable,
        targetId: app.appEntityId,
        proposalType: "paid_date",
        fieldName: "paid_date",
        appValue: app.paidDate,
        qbValue: proposed,
        reason: app.paidDate
          ? `App: ${app.paidDate} · QB shows fully paid (txn ${qbInvDate ?? "n/a"})`
          : `App has no paid date · QB shows fully paid (txn ${qbInvDate ?? "n/a"})`,
        createdBy,
      });
    }
  }

  if (
    qb.qbDocNumber &&
    normalizeInvoiceNumber(qb.qbDocNumber) !== normalizeInvoiceNumber(app.invoiceNumber)
  ) {
    pushUnique(drafts, {
      linkId,
      projectId,
      targetTable,
      targetId: app.appEntityId,
      proposalType: "invoice_number",
      fieldName: "invoice_number",
      appValue: app.invoiceNumber,
      qbValue: qb.qbDocNumber,
      reason: app.invoiceNumber
        ? `App: ${app.invoiceNumber} · QB: ${qb.qbDocNumber}`
        : `App is empty · QB: ${qb.qbDocNumber}`,
      createdBy,
    });
  }

  if (
    qb.qbAmountExVat !== null &&
    (app.amountExVat === null ||
      Math.abs((app.amountExVat ?? 0) - (qb.qbAmountExVat ?? 0)) > AMOUNT_EQ_TOL)
  ) {
    pushUnique(drafts, {
      linkId,
      projectId,
      targetTable,
      targetId: app.appEntityId,
      proposalType: "amount_ex_vat",
      fieldName: "amount_ex_vat",
      appValue: app.amountExVat === null ? null : String(app.amountExVat),
      qbValue: String(qb.qbAmountExVat),
      reason:
        app.amountExVat === null
          ? `App is empty · QB: R${qb.qbAmountExVat?.toFixed(2)}`
          : `App: R${app.amountExVat.toFixed(2)} · QB: R${qb.qbAmountExVat.toFixed(2)}`,
      createdBy,
    });
  }

  // VAT divergence — only meaningful for revenue lines today (cost lines
  // have no separate VAT amount column). Cost-line VAT is implicit in
  // `amount_ex_vat` by convention.
  if (app.appEntityType === "revenue_line" && qb.qbTaxAmount !== null && qb.qbTaxAmount !== undefined) {
    if (
      app.vatAmount === null ||
      Math.abs((app.vatAmount ?? 0) - qb.qbTaxAmount) > AMOUNT_EQ_TOL
    ) {
      pushUnique(drafts, {
        linkId,
        projectId,
        targetTable,
        targetId: app.appEntityId,
        proposalType: "vat_amount",
        fieldName: "vat",
        appValue: app.vatAmount === null ? null : String(app.vatAmount),
        qbValue: String(qb.qbTaxAmount),
        reason:
          app.vatAmount === null
            ? `App is empty · QB: R${qb.qbTaxAmount.toFixed(2)}`
            : `App: R${app.vatAmount.toFixed(2)} · QB: R${qb.qbTaxAmount.toFixed(2)}`,
        createdBy,
      });
    }
  }

  // ---- Mapping proposals (vendor/customer + counterpartyId backfill) -----

  if (app.appEntityType === "cost_line" && qb.qbCounterpartyId) {
    const [existingMap] = await db
      .select()
      .from(quickbooksVendorMappings)
      .where(
        and(
          eq(quickbooksVendorMappings.qbVendorId, qb.qbCounterpartyId),
          eq(quickbooksVendorMappings.qbRealmId, qb.qbRealmId),
          isNull(quickbooksVendorMappings.deletedAt),
        ),
      )
      .limit(1);

    const wantsMapping = !existingMap || existingMap.counterpartyId !== app.counterpartyId;
    if (wantsMapping && app.counterpartyId !== null) {
      pushUnique(drafts, {
        linkId,
        projectId,
        targetTable: "quickbooks_vendor_mappings",
        targetId: existingMap?.id ?? null,
        proposalType: "vendor_mapping",
        fieldName: null,
        appValue: existingMap
          ? `vendor #${qb.qbCounterpartyId} → counterparty #${existingMap.counterpartyId}`
          : null,
        qbValue: `vendor #${qb.qbCounterpartyId} (${qb.qbCounterpartyName ?? "?"}) → counterparty #${app.counterpartyId}`,
        reason: existingMap
          ? `Re-point vendor mapping from counterparty #${existingMap.counterpartyId} to #${app.counterpartyId}`
          : `Create vendor mapping linking QB vendor "${qb.qbCounterpartyName ?? qb.qbCounterpartyId}" to counterparty #${app.counterpartyId}`,
        createdBy,
      });
    }

    // counterpartyId backfill on the cost line itself
    if (app.counterpartyId === null && existingMap?.counterpartyId) {
      pushUnique(drafts, {
        linkId,
        projectId,
        targetTable,
        targetId: app.appEntityId,
        proposalType: "counterparty_id",
        fieldName: "counterparty_id",
        appValue: null,
        qbValue: String(existingMap.counterpartyId),
        reason: `Cost line has no counterparty; QB vendor maps to counterparty #${existingMap.counterpartyId}`,
        createdBy,
      });
    }
  }

  if (app.appEntityType === "revenue_line" && qb.qbCounterpartyId && projectId) {
    const [existingMap] = await db
      .select()
      .from(quickbooksCustomerMappings)
      .where(
        and(
          eq(quickbooksCustomerMappings.qbCustomerId, qb.qbCounterpartyId),
          eq(quickbooksCustomerMappings.qbRealmId, qb.qbRealmId),
          isNull(quickbooksCustomerMappings.deletedAt),
        ),
      )
      .limit(1);

    if (!existingMap || existingMap.projectId !== projectId) {
      pushUnique(drafts, {
        linkId,
        projectId,
        targetTable: "quickbooks_customer_mappings",
        targetId: existingMap?.id ?? null,
        proposalType: "customer_mapping",
        fieldName: null,
        appValue: existingMap
          ? `customer #${qb.qbCounterpartyId} → project #${existingMap.projectId}`
          : null,
        qbValue: `customer #${qb.qbCounterpartyId} (${qb.qbCounterpartyName ?? "?"}) → project #${projectId}`,
        reason: existingMap
          ? `Re-point customer mapping from project #${existingMap.projectId} to #${projectId}`
          : `Create customer mapping linking QB customer "${qb.qbCounterpartyName ?? qb.qbCounterpartyId}" to project #${projectId}`,
        createdBy,
      });
    }
  }

  // ---- Counterparty alias learning ---------------------------------------

  if (app.counterpartyId !== null && qb.qbCounterpartyName) {
    const [cp] = await db
      .select()
      .from(counterparties)
      .where(eq(counterparties.id, app.counterpartyId))
      .limit(1);
    if (cp) {
      const aliases = Array.isArray(cp.nameAliases) ? (cp.nameAliases as string[]) : [];
      const alreadyKnown =
        normName(cp.nameCanonical) === normName(qb.qbCounterpartyName) ||
        aliases.some((a) => normName(a) === normName(qb.qbCounterpartyName));
      const sim = nameSimilarity(cp.nameCanonical, qb.qbCounterpartyName);
      if (!alreadyKnown && sim >= ALIAS_NAME_SIM_FLOOR) {
        pushUnique(drafts, {
          linkId,
          projectId,
          targetTable: "counterparties",
          targetId: cp.id,
          proposalType: "name_alias",
          fieldName: "name_aliases",
          appValue: cp.nameCanonical,
          qbValue: qb.qbCounterpartyName,
          reason: `QB calls this vendor "${qb.qbCounterpartyName}" (${Math.round(sim * 100)}% match) — add as alias on counterparty #${cp.id}?`,
          createdBy,
        });
      }
    }
  }

  // ---- Pattern learning (cost-line scope only — revenue lines have no
  //      counterpartyId, so they're skipped for now) ---------------------

  if (
    app.appEntityType === "cost_line" &&
    app.counterpartyId !== null &&
    app.counterpartyName
  ) {
    // Invoice-number pattern (PREFIX or TOKEN_SHAPE).
    const norm = normInvoiceNumberV2(app.invoiceNumber ?? qb.qbDocNumber);
    if (norm) {
      const generated = generateRuleFromInvoice(
        norm,
        "SUPPLIER",
        app.counterpartyId,
        app.counterpartyName,
      );
      const [existingRule] = await db
        .select({ id: invoicePatternRules.id })
        .from(invoicePatternRules)
        .where(
          and(
            eq(invoicePatternRules.counterpartyId, app.counterpartyId),
            eq(invoicePatternRules.patternType, generated.patternType),
            eq(invoicePatternRules.patternValue, generated.patternValue),
            eq(invoicePatternRules.isActive, true),
          ),
        )
        .limit(1);
      if (!existingRule) {
        // Encode patternType + patternValue + sample so the apply step can
        // write the rule without re-deriving from the link snapshot.
        const payload = JSON.stringify({
          patternType: generated.patternType,
          patternValue: generated.patternValue,
          normalizedExample: norm,
          counterpartyId: app.counterpartyId,
          counterpartyName: app.counterpartyName,
          inferredType: "SUPPLIER" as const,
        });
        pushUnique(drafts, {
          linkId,
          projectId,
          targetTable: "invoice_pattern_rules",
          targetId: null,
          proposalType: "pattern_rule_create",
          fieldName: generated.patternType,
          appValue: null,
          qbValue: payload,
          reason: `Learn invoice-number pattern (${generated.patternType}: "${generated.patternValue}") for counterparty "${app.counterpartyName}" — future bills matching this shape will get a confidence boost.`,
          createdBy,
        });
      }
    }

    // Description-token fingerprint.
    const tokens = extractDescriptionTokens(app.description, qb.qbDescription);
    if (tokens.length >= DESCRIPTION_MIN_TOKENS) {
      const tokenKey = tokens.join("|");
      const activeForCp = await db
        .select({
          id: invoiceDescriptionPatterns.id,
          tokenSet: invoiceDescriptionPatterns.tokenSet,
        })
        .from(invoiceDescriptionPatterns)
        .where(
          and(
            eq(invoiceDescriptionPatterns.counterpartyId, app.counterpartyId),
            eq(invoiceDescriptionPatterns.isActive, true),
            isNull(invoiceDescriptionPatterns.deletedAt),
          ),
        );
      const alreadyKnown = activeForCp.some(
        (r: { id: number; tokenSet: unknown }) =>
          Array.isArray(r.tokenSet) && (r.tokenSet as string[]).join("|") === tokenKey,
      );
      if (!alreadyKnown) {
        const payload = JSON.stringify({
          counterpartyId: app.counterpartyId,
          counterpartyName: app.counterpartyName,
          tokens,
          normalizedExample: [app.description ?? "", qb.qbDescription ?? ""]
            .filter(Boolean)
            .join(" — ")
            .slice(0, 240),
        });
        pushUnique(drafts, {
          linkId,
          projectId,
          targetTable: "invoice_description_patterns",
          targetId: null,
          proposalType: "description_pattern_create",
          fieldName: "token_set",
          appValue: null,
          qbValue: payload,
          reason: `Learn memo fingerprint (${tokens.length} tokens: ${tokens.slice(0, 5).join(", ")}${tokens.length > 5 ? ", …" : ""}) for counterparty "${app.counterpartyName}".`,
          createdBy,
        });
      }
    }
  }

  // ---- Recon-ignore clear -------------------------------------------------

  if (app.appEntityType === "cost_line") {
    const [ignored] = await db
      .select({ id: qbReconIgnores.id })
      .from(qbReconIgnores)
      .where(
        and(
          eq(qbReconIgnores.qbBillId, qb.qbEntityId),
          isNull(qbReconIgnores.deletedAt),
        ),
      )
      .limit(1);
    if (ignored) {
      pushUnique(drafts, {
        linkId,
        projectId,
        targetTable: "qb_recon_ignores",
        targetId: ignored.id,
        proposalType: "recon_ignore_clear",
        fieldName: null,
        appValue: "ignored",
        qbValue: "linked",
        reason:
          "This QB bill was previously marked Ignore in the COS gap report — clear the ignore now that it's linked?",
        createdBy,
      });
    }
  } else {
    const [ignored] = await db
      .select({ id: qbRevenueReconIgnores.id })
      .from(qbRevenueReconIgnores)
      .where(
        and(
          eq(qbRevenueReconIgnores.qbInvoiceId, qb.qbEntityId),
          isNull(qbRevenueReconIgnores.deletedAt),
        ),
      )
      .limit(1);
    if (ignored) {
      pushUnique(drafts, {
        linkId,
        projectId,
        targetTable: "qb_revenue_recon_ignores",
        targetId: ignored.id,
        proposalType: "recon_ignore_clear",
        fieldName: null,
        appValue: "ignored",
        qbValue: "linked",
        reason:
          "This QB invoice was previously marked Ignore in the revenue gap report — clear the ignore now that it's linked?",
        createdBy,
      });
    }
  }

  return drafts;
}

/**
 * Persist the drafts produced by `detectProposals`. Uses the partial
 * unique index `qb_link_proposed_cascades_unique_pending_idx` to dedupe
 * — re-detecting the same link doesn't stack new pending rows.
 */
export async function persistProposals(drafts: ProposalDraft[]): Promise<QbLinkProposedCascade[]> {
  if (drafts.length === 0) return [];
  const inserted: QbLinkProposedCascade[] = [];
  for (const draft of drafts) {
    try {
      const [row] = await db
        .insert(qbLinkProposedCascades)
        .values({
          linkId: draft.linkId,
          projectId: draft.projectId,
          targetTable: draft.targetTable,
          targetId: draft.targetId,
          proposalType: draft.proposalType,
          fieldName: draft.fieldName,
          appValue: draft.appValue,
          qbValue: draft.qbValue,
          reason: draft.reason,
          createdBy: draft.createdBy,
        })
        .returning();
      if (row) inserted.push(row);
    } catch (err) {
      // The partial-unique index may reject duplicates from concurrent
      // detect/persist passes. Swallow the conflict — the existing
      // pending row is the correct one.
      const code = (err as { code?: string })?.code;
      if (code !== "23505") throw err;
    }
  }
  return inserted;
}

/** Convenience: detect + persist in one call. */
export async function detectAndPersistProposals(
  input: DetectorInput,
): Promise<QbLinkProposedCascade[]> {
  const drafts = await detectProposals(input);
  return persistProposals(drafts);
}

// =========================================================================
// Loaders
// =========================================================================

export async function listPendingProposalsForLink(
  linkId: number,
): Promise<QbLinkProposedCascade[]> {
  return db
    .select()
    .from(qbLinkProposedCascades)
    .where(
      and(
        eq(qbLinkProposedCascades.linkId, linkId),
        eq(qbLinkProposedCascades.status, "pending"),
        isNull(qbLinkProposedCascades.deletedAt),
      ),
    );
}

export async function listPendingProposalsForProject(
  projectId: number,
): Promise<QbLinkProposedCascade[]> {
  return db
    .select()
    .from(qbLinkProposedCascades)
    .where(
      and(
        eq(qbLinkProposedCascades.projectId, projectId),
        eq(qbLinkProposedCascades.status, "pending"),
        isNull(qbLinkProposedCascades.deletedAt),
      ),
    );
}

/**
 * Aggregate counts for the QB Cascade Proposals inbox. Surfaces "pending" load
 * and how long the oldest unresolved proposal has been waiting — used by the
 * admin-quickbooks page to flag proposal-age drift between QB and the app.
 *
 * Per § 3.4 / F-4 in audit/FINANCE_AUDIT_2026-05-26.md: proposals are not
 * auto-applied (correct, per § 0A), but operators need a visible escalation
 * signal so a stale pending paid_date proposal doesn't quietly leave the COS
 * Tracker showing "Committed" while QB has the bill at balance = 0.
 */
export interface QbProposalAgeSummary {
  pending: number;
  agedOver7Days: number;
  agedOver14Days: number;
  agedOver30Days: number;
  oldestAgeDays: number | null;
  oldestCreatedAt: string | null;
}

/**
 * DF-27 — Pure aggregator extracted from `getProposalAgeSummary` so the
 * bucket-counting logic can be unit-tested in isolation (without the DB).
 * Takes the createdAt timestamps + an "as-of" instant; returns the same
 * summary shape.
 */
export function summariseProposalAges(
  createdAts: Array<Date | string | number | null | undefined>,
  asOfMs: number = Date.now(),
): QbProposalAgeSummary {
  let agedOver7 = 0;
  let agedOver14 = 0;
  let agedOver30 = 0;
  let oldestMs: number | null = null;
  let validRowCount = 0;
  for (const c of createdAts) {
    const createdMs = c instanceof Date
      ? c.getTime()
      : typeof c === "number"
        ? c
        : c
          ? new Date(c).getTime()
          : NaN;
    if (!Number.isFinite(createdMs)) continue;
    validRowCount += 1;
    const ageDays = (asOfMs - createdMs) / (1000 * 60 * 60 * 24);
    if (ageDays > 30) agedOver30 += 1;
    if (ageDays > 14) agedOver14 += 1;
    if (ageDays > 7) agedOver7 += 1;
    if (oldestMs === null || createdMs < oldestMs) oldestMs = createdMs;
  }
  return {
    pending: validRowCount,
    agedOver7Days: agedOver7,
    agedOver14Days: agedOver14,
    agedOver30Days: agedOver30,
    oldestAgeDays: oldestMs !== null ? Math.floor((asOfMs - oldestMs) / (1000 * 60 * 60 * 24)) : null,
    oldestCreatedAt: oldestMs !== null ? new Date(oldestMs).toISOString() : null,
  };
}

export async function getProposalAgeSummary(): Promise<QbProposalAgeSummary> {
  const rows = await db
    .select({ createdAt: qbLinkProposedCascades.createdAt })
    .from(qbLinkProposedCascades)
    .where(
      and(
        eq(qbLinkProposedCascades.status, "pending"),
        isNull(qbLinkProposedCascades.deletedAt),
      ),
    );
  return summariseProposalAges(rows.map((r: { createdAt: Date | null }) => r.createdAt));
}

export async function getProposalById(id: number): Promise<QbLinkProposedCascade | null> {
  const [row] = await db
    .select()
    .from(qbLinkProposedCascades)
    .where(eq(qbLinkProposedCascades.id, id))
    .limit(1);
  return row ?? null;
}

// =========================================================================
// Accept / Decline writers
// =========================================================================

export class ProposalApplyError extends Error {
  constructor(
    message: string,
    public readonly code: string = "proposal_apply_failed",
  ) {
    super(message);
    this.name = "ProposalApplyError";
  }
}

interface AcceptArgs {
  proposalId: number;
  userId: number | null;
  note: string | null;
  importRunId?: number | null;
}

/**
 * Apply a `pending` proposal. Writes the underlying mutation, marks the
 * proposal `accepted`, and (for field-level overwrites) records an
 * `import_qb_variances` row so the next Smart Import doesn't re-flag the
 * same divergence as a workbook-vs-QB conflict.
 *
 * Returns the updated proposal row. Throws `ProposalApplyError` if the
 * proposal is missing, already resolved, or its target row no longer
 * satisfies the temporal-active guard (`effective_to IS NULL`).
 */
export async function acceptProposal(args: AcceptArgs): Promise<QbLinkProposedCascade> {
  const proposal = await getProposalById(args.proposalId);
  if (!proposal) throw new ProposalApplyError("Proposal not found", "not_found");
  if (proposal.deletedAt) throw new ProposalApplyError("Proposal was deleted", "deleted");
  if (proposal.status !== "pending") {
    throw new ProposalApplyError(
      `Proposal is already ${proposal.status}`,
      "already_resolved",
    );
  }

  const [link] = await db
    .select()
    .from(quickbooksInvoiceLinks)
    .where(eq(quickbooksInvoiceLinks.id, proposal.linkId))
    .limit(1);
  if (!link || link.deletedAt) {
    throw new ProposalApplyError(
      "Underlying QB link no longer exists — decline this proposal instead",
      "link_missing",
    );
  }

  // Apply the mutation in a transaction together with the proposal status
  // flip and any audit-trail row, so a partial failure can never leave the
  // proposal accepted but the change unwritten.
  const updated = await db.transaction(async (tx: typeof db) => {
    await applyMutation(tx, proposal, link, args.importRunId ?? null);
    const [row] = await tx
      .update(qbLinkProposedCascades)
      .set({
        status: "accepted",
        resolvedBy: args.userId,
        resolvedAt: new Date(),
        resolutionNote: args.note,
        updatedAt: new Date(),
      })
      .where(eq(qbLinkProposedCascades.id, proposal.id))
      .returning();
    // Plan v3 § 2.3 / D.5 (β): canonical transition history.
    await tx.insert(qbLinkProposedCascadeHistory).values({
      cascadeId: proposal.id,
      fromStatus: proposal.status,
      toStatus: "accepted",
      changedByUserId: args.userId,
      reason: args.note ?? null,
      detailsJson: {
        proposalType: proposal.proposalType,
        linkId: proposal.linkId,
        importRunId: args.importRunId ?? null,
      },
    });
    await recordAudit({
      userId: args.userId ?? undefined,
      entityType: "qb_cascade_proposal",
      entityId: String(proposal.id),
      action: "ACCEPT_QB_CASCADE",
      changesJson: {
        proposalType: proposal.proposalType,
        linkId: proposal.linkId,
        fromStatus: proposal.status,
        toStatus: "accepted",
        importRunId: args.importRunId ?? null,
        note: args.note ?? null,
      },
    });
    return row!;
  });

  return updated;
}

export async function declineProposal(args: AcceptArgs): Promise<QbLinkProposedCascade> {
  const proposal = await getProposalById(args.proposalId);
  if (!proposal) throw new ProposalApplyError("Proposal not found", "not_found");
  if (proposal.status !== "pending") {
    throw new ProposalApplyError(
      `Proposal is already ${proposal.status}`,
      "already_resolved",
    );
  }
  return db.transaction(async (tx: typeof db) => {
    const [row] = await tx
      .update(qbLinkProposedCascades)
      .set({
        status: "declined",
        resolvedBy: args.userId,
        resolvedAt: new Date(),
        resolutionNote: args.note,
        updatedAt: new Date(),
      })
      .where(eq(qbLinkProposedCascades.id, proposal.id))
      .returning();
    // Plan v3 § 2.3 / D.5 (β): canonical transition history.
    await tx.insert(qbLinkProposedCascadeHistory).values({
      cascadeId: proposal.id,
      fromStatus: proposal.status,
      toStatus: "declined",
      changedByUserId: args.userId,
      reason: args.note ?? null,
      detailsJson: {
        proposalType: proposal.proposalType,
        linkId: proposal.linkId,
      },
    });
    return row!;
  });
}

// =========================================================================
// Mutation dispatcher (private)
// =========================================================================

async function applyMutation(
  tx: typeof db,
  proposal: QbLinkProposedCascade,
  link: QuickBooksInvoiceLink,
  importRunId: number | null,
): Promise<void> {
  const projectId = proposal.projectId;
  const linkRealmId = link.qbRealmId;

  switch (proposal.proposalType) {
    case "invoice_date":
    case "paid_date":
    case "invoice_number":
    case "amount_ex_vat":
    case "vat_amount": {
      await applyFieldOverwrite(tx, proposal, link, importRunId);
      return;
    }
    case "vendor_mapping": {
      // The QB vendor id isn't denormalised onto the link row; look it up
      // via `quickbooks_documents` (which the QB sync writes alongside).
      const [doc] = await tx
        .select()
        .from(quickbooksDocuments)
        .where(
          and(
            eq(quickbooksDocuments.qbEntityType, "bill"),
            eq(quickbooksDocuments.qbEntityId, link.qbEntityId),
            eq(quickbooksDocuments.qbRealmId, linkRealmId),
            isNull(quickbooksDocuments.deletedAt),
          ),
        )
        .limit(1);
      const vendorId = doc?.qbCounterpartyId;
      const vendorName = doc?.qbCounterpartyName ?? link.qbCounterpartyName;
      if (!vendorId) {
        throw new ProposalApplyError(
          "QB vendor id not on file — refresh QB documents and retry",
          "missing_vendor_id",
        );
      }
      // Resolve the cost line's counterpartyId
      const [costLine] = await tx
        .select({ counterpartyId: normalizedCostLines.counterpartyId })
        .from(normalizedCostLines)
        .where(
          and(
            eq(normalizedCostLines.id, link.appEntityId),
            isNull(normalizedCostLines.effectiveTo),
            isNull(normalizedCostLines.deletedAt),
          ),
        )
        .limit(1);
      const counterpartyId = costLine?.counterpartyId;
      if (!counterpartyId) {
        throw new ProposalApplyError(
          "Cost line has no counterparty — accept the counterparty proposal first",
          "missing_counterparty",
        );
      }
      await tx
        .insert(quickbooksVendorMappings)
        .values({
          qbVendorId: vendorId,
          qbVendorName: vendorName,
          qbRealmId: linkRealmId,
          counterpartyId,
          counterpartyName: null,
          source: "suggestion",
          createdBy: proposal.createdBy,
        })
        .onConflictDoUpdate({
          target: [quickbooksVendorMappings.qbVendorId, quickbooksVendorMappings.qbRealmId],
          set: {
            counterpartyId,
            qbVendorName: vendorName,
            updatedAt: new Date(),
            deletedAt: null,
          },
        });
      return;
    }
    case "customer_mapping": {
      const [doc] = await tx
        .select()
        .from(quickbooksDocuments)
        .where(
          and(
            eq(quickbooksDocuments.qbEntityType, "invoice"),
            eq(quickbooksDocuments.qbEntityId, link.qbEntityId),
            eq(quickbooksDocuments.qbRealmId, linkRealmId),
            isNull(quickbooksDocuments.deletedAt),
          ),
        )
        .limit(1);
      const customerId = doc?.qbCounterpartyId;
      const customerName = doc?.qbCounterpartyName ?? link.qbCounterpartyName;
      if (!customerId || !projectId) {
        throw new ProposalApplyError(
          "QB customer id or project id missing — cannot upsert mapping",
          "missing_id",
        );
      }
      await tx
        .insert(quickbooksCustomerMappings)
        .values({
          projectId,
          qbCustomerId: customerId,
          qbCustomerName: customerName,
          qbRealmId: linkRealmId,
          source: "suggestion",
          createdBy: proposal.createdBy,
        })
        .onConflictDoUpdate({
          target: [
            quickbooksCustomerMappings.projectId,
            quickbooksCustomerMappings.qbRealmId,
          ],
          set: {
            qbCustomerId: customerId,
            qbCustomerName: customerName,
            updatedAt: new Date(),
            deletedAt: null,
          },
        });
      return;
    }
    case "counterparty_id": {
      if (!proposal.qbValue) return;
      const newCounterpartyId = Number(proposal.qbValue);
      if (!Number.isFinite(newCounterpartyId)) return;
      await tx
        .update(normalizedCostLines)
        .set({ counterpartyId: newCounterpartyId, updatedAt: new Date() })
        .where(
          and(
            eq(normalizedCostLines.id, link.appEntityId),
            isNull(normalizedCostLines.effectiveTo),
            isNull(normalizedCostLines.deletedAt),
          ),
        );
      return;
    }
    case "name_alias": {
      if (!proposal.targetId || !proposal.qbValue) return;
      const [cp] = await tx
        .select()
        .from(counterparties)
        .where(eq(counterparties.id, proposal.targetId))
        .limit(1);
      if (!cp) return;
      const aliases = Array.isArray(cp.nameAliases) ? (cp.nameAliases as string[]) : [];
      if (!aliases.includes(proposal.qbValue)) {
        await tx
          .update(counterparties)
          .set({ nameAliases: [...aliases, proposal.qbValue], updatedAt: new Date() })
          .where(eq(counterparties.id, cp.id));
      }
      return;
    }
    case "pattern_rule_create": {
      if (!proposal.qbValue) return;
      let payload: {
        patternType: "PREFIX" | "REGEX" | "TOKEN_SHAPE";
        patternValue: string;
        normalizedExample: string | null;
        counterpartyId: number;
        counterpartyName: string | null;
        inferredType: "INSTALLER" | "SUPPLIER" | "OTHER";
      };
      try {
        payload = JSON.parse(proposal.qbValue);
      } catch {
        throw new ProposalApplyError("Pattern proposal payload is malformed", "bad_payload");
      }
      // Upsert: re-activate a soft-disabled rule with the same shape, or
      // insert fresh. The existing classifier reads `is_active = true`
      // rules only, so flipping that is enough to make it live.
      const [existing] = await tx
        .select({ id: invoicePatternRules.id })
        .from(invoicePatternRules)
        .where(
          and(
            eq(invoicePatternRules.counterpartyId, payload.counterpartyId),
            eq(invoicePatternRules.patternType, payload.patternType),
            eq(invoicePatternRules.patternValue, payload.patternValue),
          ),
        )
        .limit(1);
      if (existing) {
        await tx
          .update(invoicePatternRules)
          .set({
            isActive: true,
            timesConfirmed: sql`${invoicePatternRules.timesConfirmed} + 1`,
            lastConfirmedAt: new Date(),
          })
          .where(eq(invoicePatternRules.id, existing.id));
      } else {
        await tx.insert(invoicePatternRules).values({
          patternType: payload.patternType,
          patternValue: payload.patternValue,
          normalizedExample: payload.normalizedExample,
          counterpartyId: payload.counterpartyId,
          counterpartyName: payload.counterpartyName,
          inferredType: payload.inferredType,
          confidenceWeight: 50,
          createdBy: proposal.createdBy,
          lastConfirmedAt: new Date(),
        });
      }
      return;
    }
    case "description_pattern_create": {
      if (!proposal.qbValue) return;
      let payload: {
        counterpartyId: number;
        counterpartyName: string | null;
        tokens: string[];
        normalizedExample: string | null;
      };
      try {
        payload = JSON.parse(proposal.qbValue);
      } catch {
        throw new ProposalApplyError(
          "Description-pattern payload is malformed",
          "bad_payload",
        );
      }
      if (!Array.isArray(payload.tokens) || payload.tokens.length === 0) return;
      // Compare against active rows for this counterparty. Identical token
      // sets are reactivated; otherwise insert fresh.
      const tokenKey = payload.tokens.slice().sort().join("|");
      const existing = await tx
        .select({
          id: invoiceDescriptionPatterns.id,
          tokenSet: invoiceDescriptionPatterns.tokenSet,
        })
        .from(invoiceDescriptionPatterns)
        .where(
          and(
            eq(invoiceDescriptionPatterns.counterpartyId, payload.counterpartyId),
            isNull(invoiceDescriptionPatterns.deletedAt),
          ),
        );
      const match = existing.find(
        (r: { id: number; tokenSet: unknown }) =>
          Array.isArray(r.tokenSet) &&
          (r.tokenSet as string[]).slice().sort().join("|") === tokenKey,
      );
      if (match) {
        await tx
          .update(invoiceDescriptionPatterns)
          .set({
            isActive: true,
            timesConfirmed: sql`${invoiceDescriptionPatterns.timesConfirmed} + 1`,
            lastConfirmedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(invoiceDescriptionPatterns.id, match.id));
      } else {
        await tx.insert(invoiceDescriptionPatterns).values({
          counterpartyId: payload.counterpartyId,
          counterpartyName: payload.counterpartyName,
          tokenSet: payload.tokens.slice().sort(),
          normalizedExample: payload.normalizedExample,
          confidenceWeight: 50,
          isActive: true,
          createdBy: proposal.createdBy,
          lastConfirmedAt: new Date(),
        });
      }
      return;
    }
    case "recon_ignore_clear": {
      if (!proposal.targetId) return;
      if (proposal.targetTable === "qb_recon_ignores") {
        await tx
          .update(qbReconIgnores)
          .set({ deletedAt: new Date() })
          .where(eq(qbReconIgnores.id, proposal.targetId));
      } else if (proposal.targetTable === "qb_revenue_recon_ignores") {
        await tx
          .update(qbRevenueReconIgnores)
          .set({ deletedAt: new Date() })
          .where(eq(qbRevenueReconIgnores.id, proposal.targetId));
      }
      return;
    }
    default:
      throw new ProposalApplyError(
        `Unknown proposal type: ${proposal.proposalType}`,
        "unknown_type",
      );
  }
}

async function applyFieldOverwrite(
  tx: typeof db,
  proposal: QbLinkProposedCascade,
  link: QuickBooksInvoiceLink,
  importRunId: number | null,
): Promise<void> {
  const isCost = link.appEntityType === "cost_line";
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  switch (proposal.proposalType) {
    case "invoice_date":
      updates.invoiceDate = proposal.qbValue;
      break;
    case "paid_date":
      // Only set the date — never flip paid_date_confirmed or cos_realised.
      updates.paidDate = proposal.qbValue;
      break;
    case "invoice_number":
      updates.invoiceNumber = proposal.qbValue;
      break;
    case "amount_ex_vat":
      updates.amountExVat = proposal.qbValue;
      break;
    case "vat_amount":
      // Only revenue lines have a separate VAT column today.
      if (isCost) return;
      updates.vat = proposal.qbValue;
      break;
    default:
      return;
  }

  if (isCost) {
    await tx
      .update(normalizedCostLines)
      .set(updates as Partial<NormalizedCostLine>)
      .where(
        and(
          eq(normalizedCostLines.id, link.appEntityId),
          isNull(normalizedCostLines.effectiveTo),
          isNull(normalizedCostLines.deletedAt),
        ),
      );
  } else {
    await tx
      .update(normalizedRevenueLines)
      .set(updates as Partial<NormalizedRevenueLine>)
      .where(
        and(
          eq(normalizedRevenueLines.id, link.appEntityId),
          isNull(normalizedRevenueLines.effectiveTo),
          isNull(normalizedRevenueLines.deletedAt),
        ),
      );
  }

  // Variance audit row so Smart Import doesn't re-flag this divergence.
  if (importRunId !== null) {
    await tx.insert(importQbVariances).values({
      importRunId,
      projectId: proposal.projectId,
      appEntityType: link.appEntityType,
      appEntityId: link.appEntityId,
      qbLinkId: link.id,
      qbRealmId: link.qbRealmId,
      fieldName: proposal.fieldName ?? proposal.proposalType,
      workbookValue: proposal.appValue,
      qbValue: proposal.qbValue,
      resolution: "qb_locked",
      notes: proposal.resolutionNote ?? null,
    });
  }
}

// =========================================================================
// Backfill loaders for the detector
// =========================================================================

/** Build an `AppRowContext` for a cost line by id. Returns null if the row
 *  isn't an active temporal row. */
export async function loadCostLineContext(
  costLineId: number,
): Promise<AppRowContext | null> {
  const [row] = await db
    .select()
    .from(normalizedCostLines)
    .where(
      and(
        eq(normalizedCostLines.id, costLineId),
        isNull(normalizedCostLines.effectiveTo),
        isNull(normalizedCostLines.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    appEntityType: "cost_line",
    appEntityId: row.id,
    projectId: row.projectId,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: dateStr(row.invoiceDate),
    paidDate: dateStr(row.paidDate),
    amountExVat: dec(row.amountExVat),
    vatAmount: null,
    counterpartyId: row.counterpartyId,
    counterpartyName: row.counterpartyName,
    costCategory: row.costCategory,
    description: row.description,
  };
}

export async function loadRevenueLineContext(
  revenueLineId: number,
): Promise<AppRowContext | null> {
  const [row] = await db
    .select()
    .from(normalizedRevenueLines)
    .where(
      and(
        eq(normalizedRevenueLines.id, revenueLineId),
        isNull(normalizedRevenueLines.effectiveTo),
        isNull(normalizedRevenueLines.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    appEntityType: "revenue_line",
    appEntityId: row.id,
    projectId: row.projectId,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: dateStr(row.invoiceDate),
    paidDate: dateStr(row.paidDate),
    amountExVat: dec(row.amountExVat),
    vatAmount: dec(row.vat),
    counterpartyId: null,
    counterpartyName: row.projectName,
    costCategory: null,
    description: row.milestoneName ?? row.description,
  };
}
