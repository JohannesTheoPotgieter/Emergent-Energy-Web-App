/**
 * "Find QB Matches" — fuzzy invoice-level linking flow.
 *
 * Lets finance run a fuzzy match between a single app cost or revenue
 * line and the live QuickBooks bill / invoice population, review the
 * candidates with confidence + reasons + warnings, and approve / reject
 * / manually link the result.
 *
 * Endpoints (all under /api/quickbooks/invoice-matches):
 *   POST   /find                         — produce candidates for one app row
 *   POST   /:suggestionId/approve        — accept a candidate, create the link
 *   POST   /:suggestionId/reject         — record rejection (audit only)
 *   POST   /manual-link                  — admin-style manual override link
 *   GET    /payment-status/:linkId       — refresh QB payment fields for one link
 *
 * Permissions
 *   - find / payment-status              → financials:view
 *   - approve / reject                   → financials:edit
 *   - manual-link                        → financials:override
 *
 * Safety contract
 *   - Suggestions are NEVER auto-approved. Even high-confidence matches
 *     require an explicit POST /approve.
 *   - Approve calls confirmCostLineLink / confirmRevenueLineLink which
 *     enforce the existing 1:1 active-link partial-unique indexes — a
 *     409 is returned if the QB doc is already linked to a different
 *     app row, or vice versa.
 *   - Vendor / customer mappings are only upserted when the caller
 *     explicitly opts in (`mapVendor` / `mapCustomer` body flags).
 *   - Every approve / reject / manual-link writes both an audit_event
 *     row (logAuditFromReq) AND updates quickbooks_match_suggestions
 *     so the decision is reproducible.
 */

import type { Express, Request, Response } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { requireAuth, getEffectiveUser } from "../auth-context";
import { requirePermission } from "../permission-middleware";
import { validateBody } from "../middleware/validateBody";
import { logAuditFromReq } from "../audit-logger";
import {
  ApiError,
  badRequest,
  conflict,
  notFound,
  sendError,
  serverError,
  logApiError,
} from "../lib/api-error";
import {
  normalizedCostLines,
  normalizedRevenueLines,
  quickbooksDocuments,
  quickbooksInvoiceLinks,
  quickbooksMatchSuggestions,
} from "@shared/schema";
import {
  rankInvoiceMatches,
  appSideWarnings,
  type AppInvoiceLike,
  type QbCandidateLike,
  type ScoredCandidate,
} from "../services/quickbooks-invoice-match-service";
import {
  confirmCostLineLink,
  confirmRevenueLineLink,
  billRawToSummary,
  invoiceRawToSummary,
  QuickBooksLinkConflictError,
} from "../services/quickbooks-reconciliation-service";
import {
  getBillById,
  getBills,
  getInvoices,
  getQuickBooksConnectionStatus,
  queryQuickBooks,
} from "../services/quickbooks-service";

const SCOPES = ["cost", "revenue"] as const;
type Scope = (typeof SCOPES)[number];

const findBodySchema = z
  .object({
    scope: z.enum(SCOPES),
    costLineId: z.number().int().positive().optional(),
    revenueLineId: z.number().int().positive().optional(),
    /** When ±N days are passed, only QB docs within that window are pulled. */
    dateWindowDays: z.number().int().min(7).max(365).optional(),
  })
  .refine((b) => (b.scope === "cost" ? !!b.costLineId : !!b.revenueLineId), {
    message: "scope=cost requires costLineId; scope=revenue requires revenueLineId",
  });

const approveBodySchema = z.object({
  candidateIndex: z.number().int().min(0),
  /** Reason free-text (≤ 500 chars), surfaced in audit log. */
  notes: z.string().max(500).optional(),
  /** Upsert vendor mapping (cost scope only). Defaults to false. */
  mapVendor: z.boolean().optional(),
  /** Upsert customer mapping (revenue scope only). Defaults to false. */
  mapCustomer: z.boolean().optional(),
});

const rejectBodySchema = z.object({
  reason: z.string().max(500),
});

const manualLinkBodySchema = z.object({
  scope: z.enum(SCOPES),
  appEntityId: z.number().int().positive(),
  qbEntityId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  notes: z.string().max(500).optional(),
});

interface FindResponseShape {
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
  };
  warnings: ReturnType<typeof appSideWarnings>;
  candidates: (ScoredCandidate & { qbAlreadyLinkedElsewhere: boolean })[];
}

// ============================================================================
// Helpers
// ============================================================================

function amountToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function widenDateRange(centerIso: string | null, days: number): { start: string; end: string } {
  // If we have no anchor date, fall back to the last 12 months — same default
  // as /api/quickbooks/sync-now so users get a coherent population.
  const center = centerIso ? new Date(centerIso) : new Date();
  if (Number.isNaN(center.getTime())) {
    const fallbackEnd = new Date();
    const fallbackStart = new Date(fallbackEnd.getFullYear(), fallbackEnd.getMonth() - 11, 1);
    return { start: fallbackStart.toISOString().slice(0, 10), end: fallbackEnd.toISOString().slice(0, 10) };
  }
  const start = new Date(center);
  start.setDate(start.getDate() - days);
  const end = new Date(center);
  end.setDate(end.getDate() + days);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

async function loadCostLine(
  costLineId: number,
): Promise<AppInvoiceLike & { projectId: number | null } | null> {
  const [row] = await db
    .select({
      id: normalizedCostLines.id,
      projectId: normalizedCostLines.projectId,
      invoiceNumber: normalizedCostLines.invoiceNumber,
      invoiceDate: normalizedCostLines.invoiceDate,
      amountExVat: normalizedCostLines.amountExVat,
      counterpartyName: normalizedCostLines.counterpartyName,
      poNumber: normalizedCostLines.poNumber,
    })
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
    id: row.id,
    projectId: row.projectId ?? null,
    invoiceNumber: row.invoiceNumber ?? null,
    invoiceDate: row.invoiceDate ? String(row.invoiceDate) : null,
    amountExVat: amountToNumber(row.amountExVat),
    counterpartyName: row.counterpartyName ?? null,
    poNumber: row.poNumber ?? null,
  };
}

async function loadRevenueLine(
  revenueLineId: number,
): Promise<AppInvoiceLike & { projectId: number | null } | null> {
  const [row] = await db
    .select({
      id: normalizedRevenueLines.id,
      projectId: normalizedRevenueLines.projectId,
      invoiceNumber: normalizedRevenueLines.invoiceNumber,
      invoiceDate: normalizedRevenueLines.invoiceDate,
      amountExVat: normalizedRevenueLines.amountExVat,
      // Revenue doesn't carry counterparty on the row — derive from project's
      // QB customer mapping when available, else null. The matcher uses
      // counterparty similarity as a tier-3+ signal so this is acceptable.
      projectName: normalizedRevenueLines.projectName,
    })
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
    id: row.id,
    projectId: row.projectId ?? null,
    invoiceNumber: row.invoiceNumber ?? null,
    invoiceDate: row.invoiceDate ? String(row.invoiceDate) : null,
    amountExVat: amountToNumber(row.amountExVat),
    counterpartyName: row.projectName ?? null,
    poNumber: null,
  };
}

async function hasActiveLink(
  appEntityType: "cost_line" | "revenue_line",
  appEntityId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: quickbooksInvoiceLinks.id })
    .from(quickbooksInvoiceLinks)
    .where(
      and(
        eq(quickbooksInvoiceLinks.appEntityType, appEntityType),
        eq(quickbooksInvoiceLinks.appEntityId, appEntityId),
        isNull(quickbooksInvoiceLinks.deletedAt),
      ),
    )
    .limit(1);
  return !!row;
}

async function findQbIdsAlreadyLinked(
  qbEntityType: "bill" | "invoice",
  qbRealmId: string,
  qbEntityIds: string[],
): Promise<Set<string>> {
  if (qbEntityIds.length === 0) return new Set();
  const rows = await db
    .select({ qbEntityId: quickbooksInvoiceLinks.qbEntityId })
    .from(quickbooksInvoiceLinks)
    .where(
      and(
        eq(quickbooksInvoiceLinks.qbEntityType, qbEntityType),
        eq(quickbooksInvoiceLinks.qbRealmId, qbRealmId),
        isNull(quickbooksInvoiceLinks.deletedAt),
        inArray(quickbooksInvoiceLinks.qbEntityId, qbEntityIds),
      ),
    );
  return new Set((rows as Array<{ qbEntityId: string }>).map((r) => r.qbEntityId));
}

function billsToCandidates(
  rawBills: unknown,
): QbCandidateLike[] {
  const list = Array.isArray((rawBills as { QueryResponse?: { Bill?: unknown[] } })?.QueryResponse?.Bill)
    ? ((rawBills as { QueryResponse: { Bill: unknown[] } }).QueryResponse.Bill as unknown[])
    : [];
  return list.map((raw) => {
    const summary = billRawToSummary(raw);
    const totalAmt = (raw as { TotalAmt?: unknown })?.TotalAmt;
    const balance = summary.balance;
    let status: string | null = null;
    if (balance !== null && totalAmt !== null && balance !== undefined) {
      const total = amountToNumber(totalAmt);
      if (total !== null) {
        if (balance <= 0.01) status = "paid";
        else if (balance < total) status = "partial";
        else status = "unpaid";
      }
    }
    return {
      qbEntityId: summary.id,
      qbEntityType: "bill" as const,
      qbDocNumber: summary.docNumber,
      qbTxnDate: summary.txnDate,
      qbCounterpartyName: summary.vendorName,
      qbAmountExVat: summary.qbAmountExVat,
      qbBalance: balance,
      qbPaymentStatus: status,
    };
  });
}

function invoicesToCandidates(
  rawInvoices: unknown,
): QbCandidateLike[] {
  const list = Array.isArray((rawInvoices as { QueryResponse?: { Invoice?: unknown[] } })?.QueryResponse?.Invoice)
    ? ((rawInvoices as { QueryResponse: { Invoice: unknown[] } }).QueryResponse.Invoice as unknown[])
    : [];
  return list.map((raw) => {
    const summary = invoiceRawToSummary(raw);
    const totalRaw = (raw as { TotalAmt?: unknown })?.TotalAmt;
    const total = amountToNumber(totalRaw);
    const balance = summary.balance;
    let status: string | null = null;
    if (balance !== null && total !== null) {
      if (balance <= 0.01) status = "paid";
      else if (balance < total) status = "partial";
      else status = "unpaid";
    }
    return {
      qbEntityId: summary.id,
      qbEntityType: "invoice" as const,
      qbDocNumber: summary.docNumber,
      qbTxnDate: summary.txnDate,
      qbCounterpartyName: summary.customerName,
      qbAmountExVat: summary.totalAmount, // already ex-VAT after invoiceRawToSummary
      qbBalance: balance,
      qbPaymentStatus: status,
    };
  });
}

// ============================================================================
// Route registration
// ============================================================================

export function registerQuickBooksInvoiceMatchRoutes(app: Express): void {
  // -------- POST /find ----------------------------------------------------
  app.post(
    "/api/quickbooks/invoice-matches/find",
    requireAuth,
    requirePermission("financials", "view"),
    validateBody(findBodySchema),
    async (req: Request, res: Response) => {
      try {
        const body = req.body as z.infer<typeof findBodySchema>;
        const status = await getQuickBooksConnectionStatus();
        if (!status.connected || !status.realmId) {
          return sendError(
            res,
            new ApiError(409, "quickbooks_not_connected", "QuickBooks is not connected"),
          );
        }
        const qbRealmId = status.realmId;
        const userId = getEffectiveUser(req)?.id ?? null;

        // 1. Load app row
        const app = body.scope === "cost"
          ? await loadCostLine(body.costLineId!)
          : await loadRevenueLine(body.revenueLineId!);
        if (!app) {
          return sendError(res, notFound(body.scope === "cost" ? "Cost line" : "Revenue line"));
        }

        // 2. Load candidate population (date-windowed if anchor date present)
        const window = widenDateRange(app.invoiceDate, body.dateWindowDays ?? 90);
        let candidates: QbCandidateLike[];
        if (body.scope === "cost") {
          const billsRaw = await getBills(window.start, window.end);
          candidates = billsToCandidates(billsRaw);
        } else {
          const invoicesRaw = await getInvoices(window.start, window.end);
          candidates = invoicesToCandidates(invoicesRaw);
        }

        // 3. Score
        const ranked = rankInvoiceMatches(app, candidates, 10);

        // 4. Mark candidates already linked elsewhere
        const qbIds = ranked.map((c) => c.qbEntityId);
        const qbEntityType = body.scope === "cost" ? "bill" : "invoice";
        const linkedSet = await findQbIdsAlreadyLinked(qbEntityType, qbRealmId, qbIds);
        const annotated = ranked.map((c) => {
          const already = linkedSet.has(c.qbEntityId);
          return {
            ...c,
            qbAlreadyLinkedElsewhere: already,
            warnings: already ? [...c.warnings, "qb_already_linked_elsewhere"] : c.warnings,
          };
        });

        // 5. App-side warnings (per row, not per candidate)
        const appActiveLink = await hasActiveLink(
          body.scope === "cost" ? "cost_line" : "revenue_line",
          app.id,
        );
        const warnings = appSideWarnings(app, body.scope, appActiveLink);

        // 6. Persist suggestion run for audit + replay
        const [suggestion] = await db
          .insert(quickbooksMatchSuggestions)
          .values({
            scope: body.scope === "cost" ? "expense_invoice" : "incoming_invoice",
            qbRealmId,
            appEntityId: app.id,
            appEntityLabel: `${app.invoiceNumber ?? "(no invoice #)"} · ${app.counterpartyName ?? "—"}`,
            candidates: annotated as unknown as object,
            requestedBy: userId,
          })
          .returning({ id: quickbooksMatchSuggestions.id });

        logAuditFromReq(req, {
          entityType: "qb_invoice_match_suggestion",
          entityId: String(suggestion.id),
          action: "qb.invoice_match.find",
          source: "UI",
          changesJson: {
            scope: body.scope,
            appEntityId: app.id,
            candidateCount: annotated.length,
            highCount: annotated.filter((c) => c.confidence >= 90).length,
            mediumCount: annotated.filter((c) => c.confidence >= 70 && c.confidence < 90).length,
            warnings: Object.entries(warnings).filter(([, v]) => v).map(([k]) => k),
          },
        });

        const response: FindResponseShape = {
          suggestionId: suggestion.id,
          scope: body.scope,
          app: {
            id: app.id,
            invoiceNumber: app.invoiceNumber,
            invoiceDate: app.invoiceDate,
            amountExVat: app.amountExVat,
            counterpartyName: app.counterpartyName,
            poNumber: app.poNumber ?? null,
            projectId: app.projectId,
          },
          warnings,
          candidates: annotated,
        };
        return res.json(response);
      } catch (err) {
        logApiError("qb.invoice_match.find", err);
        return sendError(res, serverError("Failed to find QuickBooks matches."));
      }
    },
  );

  // -------- POST /:suggestionId/approve ----------------------------------
  app.post(
    "/api/quickbooks/invoice-matches/:suggestionId/approve",
    requireAuth,
    requirePermission("financials", "edit"),
    validateBody(approveBodySchema),
    async (req: Request, res: Response) => {
      try {
        const suggestionId = Number(req.params.suggestionId);
        if (!Number.isFinite(suggestionId) || suggestionId <= 0) {
          return sendError(res, badRequest("Invalid suggestionId"));
        }
        const body = req.body as z.infer<typeof approveBodySchema>;
        const userId = getEffectiveUser(req)?.id ?? null;

        const [suggestion] = await db
          .select()
          .from(quickbooksMatchSuggestions)
          .where(eq(quickbooksMatchSuggestions.id, suggestionId))
          .limit(1);
        if (!suggestion) return sendError(res, notFound("Suggestion"));
        if (suggestion.acceptedAt) {
          return sendError(res, conflict("Suggestion already accepted."));
        }
        if (suggestion.rejectedAt) {
          return sendError(res, conflict("Suggestion was already rejected."));
        }

        // Re-derive scope (we stored expense_invoice / incoming_invoice)
        const isCost = suggestion.scope === "expense_invoice";
        const isRevenue = suggestion.scope === "incoming_invoice";
        if (!isCost && !isRevenue) {
          return sendError(res, badRequest("This suggestion is not an invoice-match suggestion."));
        }

        const candidates = (suggestion.candidates as unknown as ScoredCandidate[]) ?? [];
        const chosen = candidates[body.candidateIndex];
        if (!chosen) return sendError(res, badRequest("candidateIndex out of range"));

        const appEntityId = suggestion.appEntityId;
        if (!appEntityId) return sendError(res, badRequest("Suggestion has no app entity reference"));

        // Resolve project — needed by confirm*Link helpers
        let projectId: number | null = null;
        if (isCost) {
          const [row] = await db
            .select({ projectId: normalizedCostLines.projectId })
            .from(normalizedCostLines)
            .where(eq(normalizedCostLines.id, appEntityId))
            .limit(1);
          projectId = row?.projectId ?? null;
        } else {
          const [row] = await db
            .select({ projectId: normalizedRevenueLines.projectId })
            .from(normalizedRevenueLines)
            .where(eq(normalizedRevenueLines.id, appEntityId))
            .limit(1);
          projectId = row?.projectId ?? null;
        }

        // Build the QB summary expected by confirm*Link helpers
        try {
          let createdLinkId: number;
          if (isCost) {
            const link = await confirmCostLineLink({
              projectId,
              costLineId: appEntityId,
              bill: {
                id: chosen.qbEntityId,
                docNumber: chosen.qbDocNumber,
                txnDate: chosen.qbTxnDate,
                dueDate: null,
                totalAmount: chosen.qbAmountExVat,
                qbAmountIncVat: null,
                qbTaxAmount: null,
                qbAmountExVat: chosen.qbAmountExVat,
                taxUncertain: false,
                balance: chosen.qbBalance,
                vendorName: chosen.qbCounterpartyName,
                vendorId: null,
              },
              matchType: chosen.confidence >= 90 ? "auto_exact" : "auto_fuzzy",
              notes: body.notes ?? null,
              confirmedBy: userId,
            });
            createdLinkId = link.id;
          } else {
            const link = await confirmRevenueLineLink({
              projectId,
              revenueLineId: appEntityId,
              invoice: {
                id: chosen.qbEntityId,
                docNumber: chosen.qbDocNumber,
                txnDate: chosen.qbTxnDate,
                dueDate: null,
                totalAmount: chosen.qbAmountExVat,
                balance: chosen.qbBalance,
                customerName: chosen.qbCounterpartyName,
                customerId: null,
              },
              matchType: chosen.confidence >= 90 ? "auto_exact" : "auto_fuzzy",
              notes: body.notes ?? null,
              confirmedBy: userId,
            });
            createdLinkId = link.id;
          }

          // Vendor / customer mapping is intentionally NOT upserted here.
          // The chosen candidate carries the QB doc Id, not the QB
          // CustomerRef / VendorRef Id — those live on the doc payload and
          // require the dedicated /customer-mappings or /vendor-mappings
          // endpoint (which also enforces lock policy). We surface the
          // request flag in the audit log so finance can follow up via the
          // dedicated mapping flow.
          const mappingRequested = {
            mapVendor: !!body.mapVendor,
            mapCustomer: !!body.mapCustomer,
          };

          // Mark suggestion accepted
          await db
            .update(quickbooksMatchSuggestions)
            .set({
              acceptedAt: new Date(),
              acceptedBy: userId,
              acceptedQbId: chosen.qbEntityId,
              acceptedConfidence: String(chosen.confidence) as unknown as never,
            })
            .where(eq(quickbooksMatchSuggestions.id, suggestionId));

          logAuditFromReq(req, {
            entityType: "qb_invoice_match_suggestion",
            entityId: String(suggestionId),
            action: "qb.invoice_match.approve",
            source: "UI",
            changesJson: {
              scope: isCost ? "cost" : "revenue",
              appEntityId,
              qbEntityId: chosen.qbEntityId,
              qbDocNumber: chosen.qbDocNumber,
              confidence: chosen.confidence,
              reasons: chosen.reasons,
              warnings: chosen.warnings,
              linkId: createdLinkId,
              notes: body.notes ?? null,
              mappingRequested,
            },
          });

          return res.status(201).json({
            ok: true,
            linkId: createdLinkId,
            mappingRequested,
          });
        } catch (inner) {
          if (inner instanceof QuickBooksLinkConflictError) {
            logAuditFromReq(req, {
              entityType: "qb_invoice_match_suggestion",
              entityId: String(suggestionId),
              action: "qb.invoice_match.conflict",
              source: "UI",
              changesJson: {
                qbEntityId: chosen.qbEntityId,
                reason: inner.reason,
              },
            });
            return res.status(409).json({
              error: "conflict",
              code: inner.code,
              reason: inner.reason,
              message: inner.message,
            });
          }
          throw inner;
        }
      } catch (err) {
        logApiError("qb.invoice_match.approve", err);
        return sendError(res, serverError("Failed to approve match."));
      }
    },
  );

  // -------- POST /:suggestionId/reject -----------------------------------
  app.post(
    "/api/quickbooks/invoice-matches/:suggestionId/reject",
    requireAuth,
    requirePermission("financials", "edit"),
    validateBody(rejectBodySchema),
    async (req: Request, res: Response) => {
      try {
        const suggestionId = Number(req.params.suggestionId);
        if (!Number.isFinite(suggestionId) || suggestionId <= 0) {
          return sendError(res, badRequest("Invalid suggestionId"));
        }
        const body = req.body as z.infer<typeof rejectBodySchema>;
        const userId = getEffectiveUser(req)?.id ?? null;

        const [suggestion] = await db
          .select()
          .from(quickbooksMatchSuggestions)
          .where(eq(quickbooksMatchSuggestions.id, suggestionId))
          .limit(1);
        if (!suggestion) return sendError(res, notFound("Suggestion"));
        if (suggestion.acceptedAt) {
          return sendError(res, conflict("Suggestion was already accepted; cannot reject."));
        }
        if (suggestion.rejectedAt) {
          return sendError(res, conflict("Suggestion already rejected."));
        }

        await db
          .update(quickbooksMatchSuggestions)
          .set({
            rejectedAt: new Date(),
            rejectedBy: userId,
            rejectionReason: body.reason,
          })
          .where(eq(quickbooksMatchSuggestions.id, suggestionId));

        logAuditFromReq(req, {
          entityType: "qb_invoice_match_suggestion",
          entityId: String(suggestionId),
          action: "qb.invoice_match.reject",
          source: "UI",
          changesJson: {
            scope: suggestion.scope,
            appEntityId: suggestion.appEntityId,
            reason: body.reason,
          },
        });

        return res.json({ ok: true });
      } catch (err) {
        logApiError("qb.invoice_match.reject", err);
        return sendError(res, serverError("Failed to reject match."));
      }
    },
  );

  // -------- POST /manual-link --------------------------------------------
  app.post(
    "/api/quickbooks/invoice-matches/manual-link",
    requireAuth,
    requirePermission("financials", "override"),
    validateBody(manualLinkBodySchema),
    async (req: Request, res: Response) => {
      try {
        const body = req.body as z.infer<typeof manualLinkBodySchema>;
        const userId = getEffectiveUser(req)?.id ?? null;
        const status = await getQuickBooksConnectionStatus();
        if (!status.connected || !status.realmId) {
          return sendError(
            res,
            new ApiError(409, "quickbooks_not_connected", "QuickBooks is not connected"),
          );
        }

        // Re-fetch the QB document so the link snapshot uses authoritative
        // QB data (not user-supplied). zod already restricted qbEntityId to
        // the QB Id alphabet so the inline SQL fragment is safe.
        const isCost = body.scope === "cost";
        let qbDoc: Record<string, unknown> | undefined;
        if (isCost) {
          qbDoc = (await getBillById(body.qbEntityId)) ?? undefined;
        } else {
          const raw = (await queryQuickBooks<{
            QueryResponse?: { Invoice?: unknown[] };
          }>("Invoice", `SELECT * FROM Invoice WHERE Id = '${body.qbEntityId}'`)) ?? null;
          qbDoc = raw?.QueryResponse?.Invoice?.[0] as Record<string, unknown> | undefined;
        }
        if (!qbDoc) return sendError(res, notFound(isCost ? "QB bill" : "QB invoice"));

        // Resolve project
        let projectId: number | null = null;
        if (isCost) {
          const [row] = await db
            .select({ projectId: normalizedCostLines.projectId })
            .from(normalizedCostLines)
            .where(eq(normalizedCostLines.id, body.appEntityId))
            .limit(1);
          if (!row) return sendError(res, notFound("Cost line"));
          projectId = row.projectId ?? null;
        } else {
          const [row] = await db
            .select({ projectId: normalizedRevenueLines.projectId })
            .from(normalizedRevenueLines)
            .where(eq(normalizedRevenueLines.id, body.appEntityId))
            .limit(1);
          if (!row) return sendError(res, notFound("Revenue line"));
          projectId = row.projectId ?? null;
        }

        try {
          let linkId: number;
          if (isCost) {
            const link = await confirmCostLineLink({
              projectId,
              costLineId: body.appEntityId,
              bill: billRawToSummary(qbDoc),
              matchType: "manual",
              notes: body.notes ?? "manual_override",
              confirmedBy: userId,
            });
            linkId = link.id;
          } else {
            const link = await confirmRevenueLineLink({
              projectId,
              revenueLineId: body.appEntityId,
              invoice: invoiceRawToSummary(qbDoc),
              matchType: "manual",
              notes: body.notes ?? "manual_override",
              confirmedBy: userId,
            });
            linkId = link.id;
          }

          // Persist as an accepted suggestion with manualOverride=true so the
          // override is reproducible from the audit trail.
          const [persisted] = await db
            .insert(quickbooksMatchSuggestions)
            .values({
              scope: isCost ? "expense_invoice" : "incoming_invoice",
              qbRealmId: status.realmId,
              appEntityId: body.appEntityId,
              appEntityLabel: "manual override",
              candidates: [] as unknown as object,
              requestedBy: userId,
              acceptedAt: new Date(),
              acceptedBy: userId,
              acceptedQbId: body.qbEntityId,
              manualOverride: true,
            })
            .returning({ id: quickbooksMatchSuggestions.id });

          logAuditFromReq(req, {
            entityType: "qb_invoice_match_suggestion",
            entityId: String(persisted.id),
            action: "qb.invoice_match.manual_link",
            source: "UI",
            changesJson: {
              scope: body.scope,
              appEntityId: body.appEntityId,
              qbEntityId: body.qbEntityId,
              linkId,
              notes: body.notes ?? null,
            },
          });

          return res.status(201).json({ ok: true, linkId, suggestionId: persisted.id });
        } catch (inner) {
          if (inner instanceof QuickBooksLinkConflictError) {
            return res.status(409).json({
              error: "conflict",
              code: inner.code,
              reason: inner.reason,
              message: inner.message,
            });
          }
          throw inner;
        }
      } catch (err) {
        logApiError("qb.invoice_match.manual_link", err);
        return sendError(res, serverError("Failed to create manual link."));
      }
    },
  );

  // -------- GET /payment-status/:linkId ----------------------------------
  app.get(
    "/api/quickbooks/invoice-matches/payment-status/:linkId",
    requireAuth,
    requirePermission("financials", "view"),
    async (req: Request, res: Response) => {
      try {
        const linkId = Number(req.params.linkId);
        if (!Number.isFinite(linkId) || linkId <= 0) {
          return sendError(res, badRequest("Invalid linkId"));
        }

        const [link] = await db
          .select()
          .from(quickbooksInvoiceLinks)
          .where(
            and(
              eq(quickbooksInvoiceLinks.id, linkId),
              isNull(quickbooksInvoiceLinks.deletedAt),
            ),
          )
          .limit(1);
        if (!link) return sendError(res, notFound("Link"));

        const isBill = link.qbEntityType === "bill";
        // qbEntityId for an existing link was previously validated; still
        // restrict to the QB Id alphabet before splicing into a query.
        if (!/^[A-Za-z0-9_-]+$/.test(link.qbEntityId)) {
          return sendError(res, badRequest("Invalid QB entity id on link"));
        }
        let qbDoc: Record<string, unknown> | undefined;
        if (isBill) {
          qbDoc = (await getBillById(link.qbEntityId)) ?? undefined;
        } else {
          const raw = (await queryQuickBooks<{
            QueryResponse?: { Invoice?: unknown[] };
          }>("Invoice", `SELECT * FROM Invoice WHERE Id = '${link.qbEntityId}'`)) ?? null;
          qbDoc = raw?.QueryResponse?.Invoice?.[0] as Record<string, unknown> | undefined;
        }
        if (!qbDoc) return sendError(res, notFound(isBill ? "QB bill" : "QB invoice"));

        const total = amountToNumber((qbDoc as { TotalAmt?: unknown }).TotalAmt);
        const balance = amountToNumber((qbDoc as { Balance?: unknown }).Balance);
        let paymentStatus: "paid" | "partial" | "unpaid" | "unknown" = "unknown";
        if (balance !== null && total !== null) {
          if (balance <= 0.01) paymentStatus = "paid";
          else if (balance < total) paymentStatus = "partial";
          else paymentStatus = "unpaid";
        }
        const amountPaid = balance !== null && total !== null
          ? Number((total - balance).toFixed(2))
          : null;

        // Update / upsert the QB document snapshot so the cached payment
        // fields are kept fresh across requests. Best-effort.
        try {
          const [doc] = await db
            .select({ id: quickbooksDocuments.id })
            .from(quickbooksDocuments)
            .where(
              and(
                eq(quickbooksDocuments.qbEntityId, link.qbEntityId),
                eq(quickbooksDocuments.qbRealmId, link.qbRealmId),
                eq(quickbooksDocuments.qbEntityType, link.qbEntityType),
                isNull(quickbooksDocuments.deletedAt),
              ),
            )
            .limit(1);
          if (doc) {
            await db
              .update(quickbooksDocuments)
              .set({
                qbBalance: balance !== null ? (String(balance) as unknown as never) : null,
                qbPaymentStatus: paymentStatus === "unknown" ? null : paymentStatus,
                updatedAt: new Date(),
              })
              .where(eq(quickbooksDocuments.id, doc.id));
          }
        } catch (e) {
          // Non-fatal — the response below is still useful.
          void e;
        }

        return res.json({
          linkId: link.id,
          qbEntityId: link.qbEntityId,
          qbEntityType: link.qbEntityType,
          qbDocNumber: link.qbDocNumber,
          paymentStatus,
          totalAmount: total,
          amountPaid,
          balance,
          paymentDate: (qbDoc as { TxnDate?: string }).TxnDate ?? null,
          lastSyncedAt: new Date().toISOString(),
        });
      } catch (err) {
        logApiError("qb.invoice_match.payment_status", err);
        return sendError(res, serverError("Failed to fetch QB payment status."));
      }
    },
  );

}
