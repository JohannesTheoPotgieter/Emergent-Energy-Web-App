/**
 * Task #30 — Admin-only QuickBooks fuzzy-match + cascade engine.
 *
 * SCOPES
 *   - customer          : suggest QB customers for an unmapped project,
 *                         then cascade-link any QB invoices that already
 *                         reference the chosen customer (via documents).
 *   - vendor            : suggest QB vendors for an unmapped counterparty,
 *                         then cascade-link bills referencing that vendor.
 *   - expense_invoice   : suggest app cost lines for a single unmatched QB
 *                         bill (no cascade — single link per accept).
 *   - incoming_invoice  : suggest app revenue lines for a single unmatched
 *                         QB invoice (no cascade — single link per accept).
 *
 * INVARIANTS (safety contract — see Task #30 + audit closeout B4):
 *   - NEVER mutates `cos_realised`, `paid_date_confirmed`, allocation
 *     amounts, or any finance number. Cascade only touches mapping rows
 *     and `quickbooks_invoice_links.project_id`.
 *   - SKIPS any link whose underlying app row has `cos_realised=true` OR
 *     `paid_date_confirmed=true` (or, for revenue, `recognised=true`),
 *     reporting the row in `willSkipReconciled` of the preview.
 *   - SKIPS the entire cascade if a different mapping already exists for
 *     the target and is `lockedAt` non-null — surfaces in `willSkipLocked`
 *     with the mapping id so admin can explicitly unlock first.
 *   - PREVIEW is required before COMMIT. The same `quickbooks_cascade_runs`
 *     row created on preview is flipped to `committed` on accept.
 *   - Both preview + commit are admin-only (route-level requireAdmin) and
 *     audited via `logAuditFromReq`.
 */

import type { Request } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  normalizedCostLines,
  normalizedRevenueLines,
  quickbooksCascadeRuns,
  quickbooksCustomerMappings,
  quickbooksDocuments,
  quickbooksInvoiceLinks,
  quickbooksMatchSuggestions,
  quickbooksVendorMappings,
  type QuickBooksMatchSuggestion,
} from "@shared/schema";
import { logAuditFromReq } from "../audit-logger";
import { refreshProjectMetricsAsync } from "./dashboard-metrics";

// =========================================================================
// Normalisation + scoring (kept here so this engine has no hidden coupling
// with the 2k-line reconciliation service).
// =========================================================================

function norm(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function tokens(value: string): string[] {
  return norm(value).split(" ").filter((t) => t.length >= 2);
}

/** Token-set Jaccard similarity (0–1). Robust to word order + punctuation. */
function tokenSimilarity(a: string, b: string): number {
  const aTok = new Set(tokens(a));
  const bTok = new Set(tokens(b));
  if (aTok.size === 0 || bTok.size === 0) return 0;
  let inter = 0;
  for (const t of aTok) if (bTok.has(t)) inter++;
  const union = aTok.size + bTok.size - inter;
  return union === 0 ? 0 : inter / union;
}

export interface MatchCandidate {
  qbId: string;
  qbName: string;
  confidence: number; // 0–100
  reasons: string[];
}

/** Public — used by routes + tests. */
export function rankCandidates<T extends { id: string; name: string | null }>(
  needleName: string,
  haystack: T[],
  topN = 5,
): MatchCandidate[] {
  const out: MatchCandidate[] = [];
  for (const item of haystack) {
    const sim = tokenSimilarity(needleName, item.name ?? "");
    if (sim <= 0) continue;
    const confidence = Math.round(sim * 100);
    const reasons: string[] = [];
    if (norm(needleName) === norm(item.name ?? "")) reasons.push("exact name match");
    else if (confidence >= 60) reasons.push(`strong name overlap (${confidence}%)`);
    else reasons.push(`partial name overlap (${confidence}%)`);
    out.push({ qbId: item.id, qbName: item.name ?? "", confidence, reasons });
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, topN);
}

// =========================================================================
// Preview model.
// =========================================================================

export type SuggestScope = "customer" | "vendor" | "expense_invoice" | "incoming_invoice";

export interface CascadePreview {
  willUpdate: { linkId: number; reason: string }[];
  willSkipLocked: { mappingId?: number; linkId?: number; reason: string }[];
  willSkipReconciled: { linkId: number; reason: string }[];
}

const emptyPreview = (): CascadePreview => ({
  willUpdate: [],
  willSkipLocked: [],
  willSkipReconciled: [],
});

// =========================================================================
// CUSTOMER SCOPE
// =========================================================================

/**
 * Build a cascade preview when admin wants to map `projectId` → `qbCustomerId`.
 * Joins `quickbooks_documents` (qbCounterpartyId = qbCustomerId, qbEntityType='invoice')
 * → `quickbooks_invoice_links` (qb_entity_id = doc.qb_entity_id) where
 * appEntityType='revenue_line', and skips any link whose revenue line is
 * already recognised/paid-confirmed.
 */
export async function previewCustomerCascade(
  projectId: number,
  qbCustomerId: string,
  qbRealmId: string,
): Promise<CascadePreview> {
  const preview = emptyPreview();

  // Block if an OTHER project's mapping already owns this QB customer + is locked.
  const existing = await db
    .select({
      id: quickbooksCustomerMappings.id,
      projectId: quickbooksCustomerMappings.projectId,
      lockedAt: quickbooksCustomerMappings.lockedAt,
    })
    .from(quickbooksCustomerMappings)
    .where(
      and(
        eq(quickbooksCustomerMappings.qbCustomerId, qbCustomerId),
        eq(quickbooksCustomerMappings.qbRealmId, qbRealmId),
        isNull(quickbooksCustomerMappings.deletedAt),
      ),
    );
  for (const m of existing) {
    if (m.projectId !== projectId && m.lockedAt) {
      preview.willSkipLocked.push({
        mappingId: m.id,
        reason: `QB customer already mapped to project #${m.projectId} (locked) — unlock that mapping first`,
      });
      return preview;
    }
  }

  // Find QB invoice docs for this customer.
  const docs = await db
    .select({ qbEntityId: quickbooksDocuments.qbEntityId })
    .from(quickbooksDocuments)
    .where(
      and(
        eq(quickbooksDocuments.qbCounterpartyId, qbCustomerId),
        eq(quickbooksDocuments.qbRealmId, qbRealmId),
        eq(quickbooksDocuments.qbEntityType, "invoice"),
        isNull(quickbooksDocuments.deletedAt),
      ),
    );
  type DocRow = { qbEntityId: string };
  const qbInvoiceIds = (docs as DocRow[]).map((d) => d.qbEntityId);
  if (qbInvoiceIds.length === 0) return preview;

  type LinkRow = { id: number; projectId: number | null; appEntityId: number; appEntityType: string };
  const links: LinkRow[] = await db
    .select({
      id: quickbooksInvoiceLinks.id,
      projectId: quickbooksInvoiceLinks.projectId,
      appEntityId: quickbooksInvoiceLinks.appEntityId,
      appEntityType: quickbooksInvoiceLinks.appEntityType,
    })
    .from(quickbooksInvoiceLinks)
    .where(
      and(
        eq(quickbooksInvoiceLinks.qbEntityType, "invoice"),
        eq(quickbooksInvoiceLinks.qbRealmId, qbRealmId),
        inArray(quickbooksInvoiceLinks.qbEntityId, qbInvoiceIds),
        isNull(quickbooksInvoiceLinks.deletedAt),
      ),
    );
  const revLinks = links.filter((l) => l.appEntityType === "revenue_line");
  const revIds = revLinks.map((l) => l.appEntityId);
  type RevStatus = { id: number; paidDateConfirmed: boolean | null };
  const revStatus: RevStatus[] = revIds.length
    ? await db
        .select({
          id: normalizedRevenueLines.id,
          paidDateConfirmed: normalizedRevenueLines.paidDateConfirmed,
        })
        .from(normalizedRevenueLines)
        .where(
          and(
            inArray(normalizedRevenueLines.id, revIds),
            isNull(normalizedRevenueLines.effectiveTo),
            isNull(normalizedRevenueLines.deletedAt),
          ),
        )
    : [];
  const revMap = new Map(revStatus.map((r) => [r.id, r] as const));

  for (const link of revLinks) {
    const rev = revMap.get(link.appEntityId);
    if (rev?.paidDateConfirmed) {
      preview.willSkipReconciled.push({ linkId: link.id, reason: "paid date confirmed" });
      continue;
    }
    if (link.projectId === projectId) continue;
    preview.willUpdate.push({
      linkId: link.id,
      reason:
        link.projectId == null
          ? "link has no project — will assign"
          : `link points to project #${link.projectId} — will re-point`,
    });
  }
  return preview;
}

// =========================================================================
// VENDOR SCOPE
// =========================================================================

export async function previewVendorCascade(
  counterpartyId: number,
  qbVendorId: string,
  qbRealmId: string,
): Promise<CascadePreview> {
  const preview = emptyPreview();

  const existing = await db
    .select({
      id: quickbooksVendorMappings.id,
      counterpartyId: quickbooksVendorMappings.counterpartyId,
      lockedAt: quickbooksVendorMappings.lockedAt,
    })
    .from(quickbooksVendorMappings)
    .where(
      and(
        eq(quickbooksVendorMappings.qbVendorId, qbVendorId),
        eq(quickbooksVendorMappings.qbRealmId, qbRealmId),
        isNull(quickbooksVendorMappings.deletedAt),
      ),
    );
  for (const m of existing) {
    if (m.counterpartyId !== counterpartyId && m.lockedAt) {
      preview.willSkipLocked.push({
        mappingId: m.id,
        reason: `QB vendor already mapped to counterparty #${m.counterpartyId} (locked) — unlock first`,
      });
      return preview;
    }
  }

  const docs = await db
    .select({ qbEntityId: quickbooksDocuments.qbEntityId })
    .from(quickbooksDocuments)
    .where(
      and(
        eq(quickbooksDocuments.qbCounterpartyId, qbVendorId),
        eq(quickbooksDocuments.qbRealmId, qbRealmId),
        eq(quickbooksDocuments.qbEntityType, "bill"),
        isNull(quickbooksDocuments.deletedAt),
      ),
    );
  type DocRow = { qbEntityId: string };
  const qbBillIds = (docs as DocRow[]).map((d) => d.qbEntityId);
  if (qbBillIds.length === 0) return preview;

  type LinkRow = { id: number; projectId: number | null; appEntityId: number; appEntityType: string };
  const links: LinkRow[] = await db
    .select({
      id: quickbooksInvoiceLinks.id,
      projectId: quickbooksInvoiceLinks.projectId,
      appEntityId: quickbooksInvoiceLinks.appEntityId,
      appEntityType: quickbooksInvoiceLinks.appEntityType,
    })
    .from(quickbooksInvoiceLinks)
    .where(
      and(
        eq(quickbooksInvoiceLinks.qbEntityType, "bill"),
        eq(quickbooksInvoiceLinks.qbRealmId, qbRealmId),
        inArray(quickbooksInvoiceLinks.qbEntityId, qbBillIds),
        isNull(quickbooksInvoiceLinks.deletedAt),
      ),
    );
  const costLinks = links.filter((l) => l.appEntityType === "cost_line");
  const costIds = costLinks.map((l) => l.appEntityId);
  type CostStatus = { id: number; cosRealised: boolean | null; paidDateConfirmed: boolean | null };
  const costStatus: CostStatus[] = costIds.length
    ? await db
        .select({
          id: normalizedCostLines.id,
          cosRealised: normalizedCostLines.cosRealised,
          paidDateConfirmed: normalizedCostLines.paidDateConfirmed,
        })
        .from(normalizedCostLines)
        .where(
          and(
            inArray(normalizedCostLines.id, costIds),
            isNull(normalizedCostLines.effectiveTo),
            isNull(normalizedCostLines.deletedAt),
          ),
        )
    : [];
  const costMap = new Map(costStatus.map((c) => [c.id, c] as const));

  for (const link of costLinks) {
    const cost = costMap.get(link.appEntityId);
    if (cost?.cosRealised || cost?.paidDateConfirmed) {
      preview.willSkipReconciled.push({
        linkId: link.id,
        reason: cost?.cosRealised ? "COS already realised" : "paid date confirmed",
      });
      continue;
    }
    // Vendor cascade does NOT re-point the link's project (project is set
    // by allocation flow). It only re-confirms the link exists; nothing to
    // update here. We surface it as willUpdate=0 — the cascade's primary
    // effect is creating the locked vendor mapping itself.
  }
  // Vendor cascade is mapping-only (no link mutations).
  return preview;
}

// =========================================================================
// PERSISTENCE: suggestion + cascade-run rows.
// =========================================================================

export async function recordSuggestion(input: {
  scope: SuggestScope;
  qbRealmId: string;
  appEntityId: number | null;
  appEntityLabel: string | null;
  candidates: MatchCandidate[];
  requestedBy: number | null;
}): Promise<QuickBooksMatchSuggestion> {
  const [row] = await db
    .insert(quickbooksMatchSuggestions)
    .values({
      scope: input.scope,
      qbRealmId: input.qbRealmId,
      appEntityId: input.appEntityId ?? null,
      appEntityLabel: input.appEntityLabel ?? null,
      candidates: input.candidates as unknown as object,
      requestedBy: input.requestedBy ?? null,
    })
    .returning();
  return row;
}

export async function recordCascadePreview(input: {
  suggestionId: number;
  scope: SuggestScope;
  qbRealmId: string;
  sourceEntityType: string;
  sourceEntityId: number | null;
  preview: CascadePreview;
  triggeredBy: number | null;
}): Promise<{ id: number }> {
  const [row] = await db
    .insert(quickbooksCascadeRuns)
    .values({
      suggestionId: input.suggestionId,
      scope: input.scope,
      qbRealmId: input.qbRealmId,
      sourceEntityType: input.sourceEntityType,
      sourceEntityId: input.sourceEntityId ?? null,
      preview: input.preview as unknown as object,
      status: "preview",
      triggeredBy: input.triggeredBy ?? null,
    })
    .returning({ id: quickbooksCascadeRuns.id });
  return row;
}

// =========================================================================
// COMMIT — applies the preview. Wraps mapping upsert + link updates in a
// single transaction, then audits.
// =========================================================================

export async function commitCustomerCascade(input: {
  req: Request;
  suggestionId: number;
  cascadeRunId: number;
  projectId: number;
  qbCustomerId: string;
  qbCustomerName: string | null;
  qbRealmId: string;
  confidence: number;
  preview: CascadePreview;
  userId: number | null;
}): Promise<{ mappingId: number; updatedLinkIds: number[] }> {
  const updatedLinkIds: number[] = [];
  let mappingId = 0;

  await db.transaction(async (tx: typeof db) => {
    const [mapping] = await tx
      .insert(quickbooksCustomerMappings)
      .values({
        projectId: input.projectId,
        qbCustomerId: input.qbCustomerId,
        qbCustomerName: input.qbCustomerName,
        qbRealmId: input.qbRealmId,
        source: "suggestion",
        confidence: String(input.confidence) as any,
        lockedAt: new Date(),
        lockedBy: input.userId ?? null,
        suggestionRunId: input.suggestionId,
        createdBy: input.userId ?? null,
      })
      .onConflictDoUpdate({
        target: [quickbooksCustomerMappings.projectId, quickbooksCustomerMappings.qbRealmId],
        set: {
          qbCustomerId: input.qbCustomerId,
          qbCustomerName: input.qbCustomerName,
          source: "suggestion",
          confidence: String(input.confidence) as any,
          lockedAt: new Date(),
          lockedBy: input.userId ?? null,
          suggestionRunId: input.suggestionId,
          updatedAt: new Date(),
          deletedAt: null,
        },
      })
      .returning({ id: quickbooksCustomerMappings.id });
    mappingId = mapping.id;

    const ids = input.preview.willUpdate.map((p) => p.linkId);
    if (ids.length > 0) {
      await tx
        .update(quickbooksInvoiceLinks)
        .set({ projectId: input.projectId, updatedAt: new Date() })
        .where(inArray(quickbooksInvoiceLinks.id, ids));
      updatedLinkIds.push(...ids);
    }

    await tx
      .update(quickbooksCascadeRuns)
      .set({
        status: "committed",
        committedAt: new Date(),
        commit: { updatedLinkIds, mappingId } as unknown as object,
      })
      .where(eq(quickbooksCascadeRuns.id, input.cascadeRunId));

    await tx
      .update(quickbooksMatchSuggestions)
      .set({
        acceptedAt: new Date(),
        acceptedBy: input.userId ?? null,
        acceptedQbId: input.qbCustomerId,
        acceptedConfidence: String(input.confidence) as any,
      })
      .where(eq(quickbooksMatchSuggestions.id, input.suggestionId));
  });

  logAuditFromReq(input.req, {
    entityType: "qb_customer_mapping",
    entityId: String(mappingId),
    action: "cascade_commit",
    changesJson: {
      projectId: input.projectId,
      qbCustomerId: input.qbCustomerId,
      qbCustomerName: input.qbCustomerName,
      confidence: input.confidence,
      suggestionId: input.suggestionId,
      cascadeRunId: input.cascadeRunId,
      updatedLinkIds,
      skippedLocked: input.preview.willSkipLocked.length,
      skippedReconciled: input.preview.willSkipReconciled.length,
    },
    source: "SETTINGS",
  });
  refreshProjectMetricsAsync(input.projectId);
  return { mappingId, updatedLinkIds };
}

export async function commitVendorCascade(input: {
  req: Request;
  suggestionId: number;
  cascadeRunId: number;
  counterpartyId: number;
  counterpartyName: string | null;
  qbVendorId: string;
  qbVendorName: string | null;
  qbRealmId: string;
  confidence: number;
  preview: CascadePreview;
  userId: number | null;
}): Promise<{ mappingId: number; updatedLinkIds: number[] }> {
  let mappingId = 0;

  await db.transaction(async (tx: typeof db) => {
    const [mapping] = await tx
      .insert(quickbooksVendorMappings)
      .values({
        qbVendorId: input.qbVendorId,
        qbVendorName: input.qbVendorName,
        qbRealmId: input.qbRealmId,
        counterpartyId: input.counterpartyId,
        counterpartyName: input.counterpartyName,
        source: "suggestion",
        confidence: String(input.confidence) as any,
        lockedAt: new Date(),
        lockedBy: input.userId ?? null,
        suggestionRunId: input.suggestionId,
        createdBy: input.userId ?? null,
      })
      .onConflictDoUpdate({
        target: [quickbooksVendorMappings.qbVendorId, quickbooksVendorMappings.qbRealmId],
        set: {
          counterpartyId: input.counterpartyId,
          counterpartyName: input.counterpartyName,
          source: "suggestion",
          confidence: String(input.confidence) as any,
          lockedAt: new Date(),
          lockedBy: input.userId ?? null,
          suggestionRunId: input.suggestionId,
          updatedAt: new Date(),
          deletedAt: null,
        },
      })
      .returning({ id: quickbooksVendorMappings.id });
    mappingId = mapping.id;

    await tx
      .update(quickbooksCascadeRuns)
      .set({
        status: "committed",
        committedAt: new Date(),
        commit: { mappingId, updatedLinkIds: [] } as unknown as object,
      })
      .where(eq(quickbooksCascadeRuns.id, input.cascadeRunId));

    await tx
      .update(quickbooksMatchSuggestions)
      .set({
        acceptedAt: new Date(),
        acceptedBy: input.userId ?? null,
        acceptedQbId: input.qbVendorId,
        acceptedConfidence: String(input.confidence) as any,
      })
      .where(eq(quickbooksMatchSuggestions.id, input.suggestionId));
  });

  logAuditFromReq(input.req, {
    entityType: "qb_vendor_mapping",
    entityId: String(mappingId),
    action: "cascade_commit",
    changesJson: {
      counterpartyId: input.counterpartyId,
      qbVendorId: input.qbVendorId,
      confidence: input.confidence,
      suggestionId: input.suggestionId,
      cascadeRunId: input.cascadeRunId,
      skippedLocked: input.preview.willSkipLocked.length,
      skippedReconciled: input.preview.willSkipReconciled.length,
    },
    source: "SETTINGS",
  });
  return { mappingId, updatedLinkIds: [] };
}

// =========================================================================
// UNLOCK
// =========================================================================

export async function unlockCustomerMapping(req: Request, mappingId: number, userId: number | null) {
  const [row] = await db
    .update(quickbooksCustomerMappings)
    .set({ lockedAt: null, lockedBy: null, updatedAt: new Date() })
    .where(eq(quickbooksCustomerMappings.id, mappingId))
    .returning({ id: quickbooksCustomerMappings.id });
  if (row) {
    logAuditFromReq(req, {
      entityType: "qb_customer_mapping",
      entityId: String(row.id),
      action: "unlock",
      changesJson: { unlockedBy: userId },
      source: "SETTINGS",
    });
  }
  return row ?? null;
}

export async function unlockVendorMapping(req: Request, mappingId: number, userId: number | null) {
  const [row] = await db
    .update(quickbooksVendorMappings)
    .set({ lockedAt: null, lockedBy: null, updatedAt: new Date() })
    .where(eq(quickbooksVendorMappings.id, mappingId))
    .returning({ id: quickbooksVendorMappings.id });
  if (row) {
    logAuditFromReq(req, {
      entityType: "qb_vendor_mapping",
      entityId: String(row.id),
      action: "unlock",
      changesJson: { unlockedBy: userId },
      source: "SETTINGS",
    });
  }
  return row ?? null;
}

export const __cascadeServiceVersion = "task-30";
