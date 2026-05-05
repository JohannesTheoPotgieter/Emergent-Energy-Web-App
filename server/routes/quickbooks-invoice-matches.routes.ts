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
import { and, desc, eq, inArray, isNull, ilike, or, sql } from "drizzle-orm";
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
  invoiceDescriptionPatterns,
  invoicePatternRules,
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
  type LearnedPatternMatch,
  type ScoredCandidate,
} from "../services/quickbooks-invoice-match-service";
import {
  detectAndPersistProposals,
  loadCostLineContext,
  loadRevenueLineContext,
  acceptProposal,
  declineProposal,
  listPendingProposalsForLink,
  ProposalApplyError,
  type AppRowContext,
  type QbDocSnapshot,
} from "../services/quickbooks-cascade-proposals-service";
import { refreshProjectMetricsAsync } from "../services/dashboard-metrics";
import {
  confirmCostLineLink,
  confirmRevenueLineLink,
  confirmLinksWithAllocations,
  confirmLinksWithAllocationsTx,
  validateConfirmAllocationsInput,
  getSiblingLinksForQbEntity,
  billRawToSummary,
  invoiceRawToSummary,
  QuickBooksApproveValidationError,
  QuickBooksLinkConflictError,
  QuickBooksAllocationToleranceError,
} from "../services/quickbooks-reconciliation-service";
import { effectiveAllocatedAmountExVat } from "@shared/config/qb-allocations";
import {
  getBillById,
  getBills,
  getInvoices,
  getQuickBooksConnectionStatus,
  queryQuickBooks,
} from "../services/quickbooks-service";

const SCOPES = ["cost", "revenue"] as const;
type Scope = (typeof SCOPES)[number];

/**
 * Maps an arbitrary error thrown from the approve / bulk-approve helpers to
 * the actual HTTP envelope. Keeps the conflict-error handling untouched
 * (those are intercepted earlier with their own audit log entry) and turns
 * every other failure mode into a user-meaningful message instead of the
 * legacy hard-coded "Failed to approve match." toast.
 */
function classifyApproveError(err: unknown): {
  statusCode: number;
  code: string;
  reason: string;
  message: string;
  errorName: string;
  errorMessage: string;
  stack?: string;
} {
  // Validation faults raised by the confirm*Link helpers.
  if (err instanceof QuickBooksApproveValidationError) {
    return {
      statusCode: err.statusCode,
      code: err.code,
      reason: err.reason,
      message: err.message,
      errorName: err.name,
      errorMessage: err.message,
      stack: err.stack,
    };
  }

  // Conflicts in places that re-throw past their dedicated 409 branch.
  if (err instanceof QuickBooksLinkConflictError) {
    return {
      statusCode: 409,
      code: err.code,
      reason: err.reason,
      message: err.message,
      errorName: err.name,
      errorMessage: err.message,
      stack: err.stack,
    };
  }

  // ApiError thrown earlier in the route (badRequest / notFound / etc.) —
  // honour its status and message so the toast stays specific.
  if (err instanceof ApiError) {
    return {
      statusCode: err.statusCode,
      code: err.code,
      reason: err.code,
      message: err.message,
      errorName: err.name,
      errorMessage: err.message,
      stack: err.stack,
    };
  }

  // Postgres / Drizzle constraint violations — surface the constraint name
  // (or message) so the operator can act, but use a 500 because this is
  // unexpected territory we should fix in code.
  const anyErr = err as { code?: string; constraint?: string; message?: string; stack?: string; name?: string };
  if (anyErr && typeof anyErr === "object" && typeof anyErr.code === "string" && /^\d{5}$/.test(anyErr.code)) {
    const constraint = anyErr.constraint ? ` (${anyErr.constraint})` : "";
    return {
      statusCode: 500,
      code: "database_error",
      reason: `pg_${anyErr.code}`,
      message: `Database error${constraint}: ${anyErr.message ?? "unknown"}`,
      errorName: anyErr.name ?? "DatabaseError",
      errorMessage: anyErr.message ?? "unknown",
      stack: anyErr.stack,
    };
  }

  if (err instanceof Error) {
    return {
      statusCode: 500,
      code: "approve_failed",
      reason: "unexpected_error",
      message: err.message || "Failed to approve match.",
      errorName: err.name,
      errorMessage: err.message,
      stack: err.stack,
    };
  }

  return {
    statusCode: 500,
    code: "approve_failed",
    reason: "unexpected_error",
    message: "Failed to approve match.",
    errorName: "Unknown",
    errorMessage: String(err),
  };
}

const findBodySchema = z
  .object({
    scope: z.enum(SCOPES),
    costLineId: z.number().int().positive().optional(),
    revenueLineId: z.number().int().positive().optional(),
    /** @deprecated No longer used — all QB docs are fetched and date differences are surfaced as warnings. */
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
  /**
   * Task #142 many-to-many: when present, the chosen QB doc is allocated
   * across N app lines transactionally via `confirmLinksWithAllocations`.
   * The CURRENT app line (suggestion.appEntityId) MUST appear in the
   * array; sibling app lines may be added/removed in the same call.
   * The sum of `allocatedAmountExVat` is validated against the QB doc
   * total within the configured tolerance — a 422 with `details` is
   * returned on failure.
   *
   * Omit for the legacy "single link == 100% of QB doc" path.
   */
  lineAllocations: z
    .array(
      z.object({
        appEntityType: z.enum(["cost_line", "revenue_line"]),
        appEntityId: z.number().int().positive(),
        allocatedAmountExVat: z.number().positive(),
      }),
    )
    .min(1)
    .max(50)
    .optional(),
});

/**
 * Task #142 — multi-QB approve payload. Allocates the same suggestion's
 * app line across N QB docs in one call, each with its own sibling
 * line-allocations. Each entry is validated against its QB doc total via
 * `confirmLinksWithAllocations`; the route validates ALL entries up-front
 * before persisting any to keep partial-failure surface area minimal.
 *
 * `lineAllocations` for each entry MUST include the suggestion's own
 * app line (same rule as the single-QB path).
 */
const approveMultiBodySchema = z.object({
  notes: z.string().max(500).optional(),
  mapVendor: z.boolean().optional(),
  mapCustomer: z.boolean().optional(),
  allocations: z
    .array(
      z.object({
        candidateIndex: z.number().int().min(0),
        lineAllocations: z
          .array(
            z.object({
              appEntityType: z.enum(["cost_line", "revenue_line"]),
              appEntityId: z.number().int().positive(),
              allocatedAmountExVat: z.number().positive(),
            }),
          )
          .min(1)
          .max(50),
      }),
    )
    .min(1)
    .max(20),
});

const rejectBodySchema = z.object({
  reason: z.string().max(500),
});

const manualLinkBodySchema = z.object({
  scope: z.enum(SCOPES),
  appEntityId: z.number().int().positive(),
  qbEntityId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  notes: z.string().max(500).optional(),
  /**
   * Optional Task #142 allocation. When omitted the link is created with
   * the legacy "100% of QB doc total" semantic. When provided, the value
   * is used as the per-link allocation and the writer SKIPS the sum
   * tolerance check (manual override path — operator accepts the drift).
   */
  // Task #142 — DB CHECK requires `> 0`. Reject zero/negative allocations
  // up-front so the API returns a structured 400/422 instead of a 500 at
  // INSERT time. Optional because legacy callers may omit it (single 1:1
  // link path) and the writer falls back to qb_amount.
  allocatedAmountExVat: z.number().positive().optional(),
});

const bulkApproveBodySchema = z.object({
  items: z
    .array(
      z.object({
        suggestionId: z.number().int().positive(),
        candidateIndex: z.number().int().min(0),
        notes: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(50),
});

const bulkRejectBodySchema = z.object({
  items: z
    .array(
      z.object({
        suggestionId: z.number().int().positive(),
        reason: z.string().min(1).max(500),
      }),
    )
    .min(1)
    .max(50),
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
    description: string | null;
  };
  warnings: ReturnType<typeof appSideWarnings>;
  candidates: (ScoredCandidate & {
    qbAlreadyLinkedElsewhere: boolean;
    /**
     * Task #142 — sibling allocation snapshot for this QB doc, taken at
     * find time. The drawer uses this to render the "R X allocated of
     * R Y total · R Z remaining" badge so the user knows whether the
     * doc has room for another partial allocation.
     */
    qbAllocation: {
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
  })[];
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
      description: normalizedCostLines.description,
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
    description: row.description ?? null,
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
      description: normalizedRevenueLines.description,
      milestoneName: normalizedRevenueLines.milestoneName,
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
    // Revenue lines don't carry a free-text "description" the way cost
    // lines do — the milestoneName is the most user-meaningful label
    // (e.g. "Practical Completion"), so prefer it and fall back to the
    // raw description column for legacy rows that have one.
    description: row.milestoneName ?? row.description ?? null,
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

/**
 * Phase 2 — load active per-counterparty pattern rules and check each QB
 * candidate's invoice number / memo against them. Returns a `Map<qbEntityId,
 * LearnedPatternMatch[]>` so the scorer can lift candidates that match a
 * known fingerprint into a higher tier ("learned: PREFIX SOL-" etc.).
 *
 * Cheap on the hot path — one query for the invoice-number rules, one for
 * the description token rules. Both indexed on counterpartyId.
 */
async function loadLearnedMatchesForCounterparty(
  counterpartyId: number | null | undefined,
  candidates: QbCandidateLike[],
): Promise<Map<string, LearnedPatternMatch[]>> {
  const out = new Map<string, LearnedPatternMatch[]>();
  if (!counterpartyId || candidates.length === 0) return out;

  const [numberRules, descriptionRules] = await Promise.all([
    db
      .select({
        id: invoicePatternRules.id,
        patternType: invoicePatternRules.patternType,
        patternValue: invoicePatternRules.patternValue,
        confidenceWeight: invoicePatternRules.confidenceWeight,
      })
      .from(invoicePatternRules)
      .where(
        and(
          eq(invoicePatternRules.counterpartyId, counterpartyId),
          eq(invoicePatternRules.isActive, true),
          isNull(invoicePatternRules.deletedAt),
        ),
      ),
    db
      .select({
        id: invoiceDescriptionPatterns.id,
        tokenSet: invoiceDescriptionPatterns.tokenSet,
        confidenceWeight: invoiceDescriptionPatterns.confidenceWeight,
      })
      .from(invoiceDescriptionPatterns)
      .where(
        and(
          eq(invoiceDescriptionPatterns.counterpartyId, counterpartyId),
          eq(invoiceDescriptionPatterns.isActive, true),
          isNull(invoiceDescriptionPatterns.deletedAt),
        ),
      ),
  ]);

  if (numberRules.length === 0 && descriptionRules.length === 0) return out;

  const normNum = (s: string | null | undefined) =>
    (s ?? "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const tokensFor = (s: string | null | undefined) => {
    if (!s) return new Set<string>();
    return new Set(
      s
        .replace(/[^a-zA-Z0-9 ]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
        .split(" ")
        .filter((t) => t.length >= 3),
    );
  };
  const jaccard = (a: Set<string>, b: Set<string>) => {
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
  };

  for (const c of candidates) {
    const matches: LearnedPatternMatch[] = [];

    // Invoice-number rules
    const docNum = normNum(c.qbDocNumber);
    for (const rule of numberRules) {
      if (!docNum) break;
      const ruleNum = normNum(rule.patternValue);
      if (rule.patternType === "PREFIX" && ruleNum && docNum.startsWith(ruleNum)) {
        matches.push({
          source: "invoice_number",
          ruleId: rule.id,
          similarity: 1,
          label: `${rule.patternType} ${rule.patternValue}`,
        });
        break; // one invoice-number match is enough — avoid double-counting
      }
      if (rule.patternType === "REGEX") {
        try {
          if (new RegExp(rule.patternValue, "i").test(c.qbDocNumber ?? "")) {
            matches.push({
              source: "invoice_number",
              ruleId: rule.id,
              similarity: 1,
              label: `regex /${rule.patternValue}/`,
            });
            break;
          }
        } catch {
          /* malformed regex — skip */
        }
      }
    }

    // Description-token rules
    const candTokens = tokensFor(c.qbDescription);
    if (candTokens.size > 0) {
      for (const rule of descriptionRules) {
        const ruleTokens = new Set(
          (Array.isArray(rule.tokenSet) ? (rule.tokenSet as string[]) : []) as string[],
        );
        const sim = jaccard(candTokens, ruleTokens);
        if (sim >= 0.6) {
          matches.push({
            source: "description",
            ruleId: rule.id,
            similarity: sim,
            label: `memo ${Math.round(sim * 100)}% match`,
          });
          break; // one description match is enough
        }
      }
    }

    if (matches.length > 0) out.set(c.qbEntityId, matches);
  }

  return out;
}

/**
 * Phase 2 — bump per-rule counters when a learned-pattern-boosted candidate
 * is approved or rejected. Splits the matches by source so the right table
 * is updated. Idempotent on re-run within a single approve.
 */
async function bumpLearnedPatternCounters(
  matches: LearnedPatternMatch[] | undefined,
  outcome: "approved" | "rejected",
): Promise<void> {
  if (!matches || matches.length === 0) return;
  const numberRuleIds = matches
    .filter((m) => m.source === "invoice_number")
    .map((m) => m.ruleId);
  const descriptionRuleIds = matches
    .filter((m) => m.source === "description")
    .map((m) => m.ruleId);

  if (numberRuleIds.length > 0) {
    if (outcome === "approved") {
      await db
        .update(invoicePatternRules)
        .set({
          timesConfirmed: sql`${invoicePatternRules.timesConfirmed} + 1`,
          timesMatched: sql`${invoicePatternRules.timesMatched} + 1`,
          lastConfirmedAt: new Date(),
        })
        .where(inArray(invoicePatternRules.id, numberRuleIds));
    } else {
      await db
        .update(invoicePatternRules)
        .set({
          timesOverridden: sql`${invoicePatternRules.timesOverridden} + 1`,
          timesMatched: sql`${invoicePatternRules.timesMatched} + 1`,
        })
        .where(inArray(invoicePatternRules.id, numberRuleIds));
    }
  }
  if (descriptionRuleIds.length > 0) {
    if (outcome === "approved") {
      await db
        .update(invoiceDescriptionPatterns)
        .set({
          timesConfirmed: sql`${invoiceDescriptionPatterns.timesConfirmed} + 1`,
          timesMatched: sql`${invoiceDescriptionPatterns.timesMatched} + 1`,
          lastConfirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(inArray(invoiceDescriptionPatterns.id, descriptionRuleIds));
    } else {
      await db
        .update(invoiceDescriptionPatterns)
        .set({
          timesOverridden: sql`${invoiceDescriptionPatterns.timesOverridden} + 1`,
          timesMatched: sql`${invoiceDescriptionPatterns.timesMatched} + 1`,
          updatedAt: new Date(),
        })
        .where(inArray(invoiceDescriptionPatterns.id, descriptionRuleIds));
    }
  }
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
      qbCounterpartyId: summary.vendorId ?? null,
      qbAmountExVat: summary.qbAmountExVat,
      qbBalance: balance,
      qbPaymentStatus: status,
      qbDescription:
        ((raw as { PrivateNote?: unknown })?.PrivateNote as string | undefined) ?? null,
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
    const qbCustomerId = (raw as { CustomerRef?: { value?: string } })?.CustomerRef?.value ?? null;
    return {
      qbEntityId: summary.id,
      qbEntityType: "invoice" as const,
      qbDocNumber: summary.docNumber,
      qbTxnDate: summary.txnDate,
      qbCounterpartyName: summary.customerName,
      qbCounterpartyId: qbCustomerId,
      qbAmountExVat: summary.totalAmount, // already ex-VAT after invoiceRawToSummary
      qbBalance: balance,
      qbPaymentStatus: status,
      qbDescription:
        ((raw as { PrivateNote?: unknown })?.PrivateNote as string | undefined) ?? null,
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

        // Already-linked rows are not candidates for re-matching. Once
        // linked, the only way to repoint the link is the admin-only
        // POST /api/quickbooks/links/:id/force-relink endpoint. Returning
        // an empty candidate list here keeps the auto-suggest path
        // idempotent — no stacking suggestions, no "approve same link
        // twice" footgun.
        const appAlreadyLinked = await hasActiveLink(
          body.scope === "cost" ? "cost_line" : "revenue_line",
          app.id,
        );
        if (appAlreadyLinked) {
          return res.json({
            suggestionId: null,
            scope: body.scope,
            app: {
              id: app.id,
              invoiceNumber: app.invoiceNumber,
              invoiceDate: app.invoiceDate,
              amountExVat: app.amountExVat,
              counterpartyName: app.counterpartyName,
              poNumber: app.poNumber ?? null,
              projectId: app.projectId,
              description: app.description ?? null,
            },
            warnings: { no_po: false, already_linked: true },
            candidates: [],
            alreadyLinked: true,
          });
        }

        // 2. Load candidate population — fetch ALL QB docs so invoice-number
        //    and amount matches aren't silently excluded by a date window.
        //    Date differences are surfaced as warnings instead of filters.
        let candidates: QbCandidateLike[];
        if (body.scope === "cost") {
          const billsRaw = await getBills();
          candidates = billsToCandidates(billsRaw);
        } else {
          const invoicesRaw = await getInvoices();
          candidates = invoicesToCandidates(invoicesRaw);
        }

        // 2b. Phase 2 — annotate candidates with learned-pattern matches for
        //     the app row's counterparty so tier-2.5 fires in the scorer.
        //     Cost-line scope only — revenue lines don't carry a
        //     counterpartyId on the row itself.
        if (body.scope === "cost") {
          const [cpRow] = await db
            .select({ counterpartyId: normalizedCostLines.counterpartyId })
            .from(normalizedCostLines)
            .where(
              and(
                eq(normalizedCostLines.id, app.id),
                isNull(normalizedCostLines.effectiveTo),
                isNull(normalizedCostLines.deletedAt),
              ),
            )
            .limit(1);
          if (cpRow?.counterpartyId) {
            const learned = await loadLearnedMatchesForCounterparty(
              cpRow.counterpartyId,
              candidates,
            );
            if (learned.size > 0) {
              candidates = candidates.map((c) =>
                learned.has(c.qbEntityId)
                  ? { ...c, learnedPatternMatches: learned.get(c.qbEntityId) }
                  : c,
              );
            }
          }
        }

        // 3. Score
        const ranked = rankInvoiceMatches(app, candidates, 10);

        // 4. Mark candidates already linked elsewhere AND attach the
        //    Task #142 sibling-allocation snapshot for each candidate.
        //    `qbAlreadyLinkedElsewhere` becomes "all existing links for
        //    this QB doc are for OTHER app lines" — siblings that include
        //    the current app row are NOT a conflict (re-confirm path).
        const qbIds = ranked.map((c) => c.qbEntityId);
        const qbEntityType = body.scope === "cost" ? "bill" : "invoice";
        const appEntityType: "cost_line" | "revenue_line" =
          body.scope === "cost" ? "cost_line" : "revenue_line";

        const siblingByQbId = new Map<
          string,
          Awaited<ReturnType<typeof getSiblingLinksForQbEntity>>
        >();
        await Promise.all(
          qbIds.map(async (qbId) => {
            const candidate = ranked.find((c) => c.qbEntityId === qbId);
            const total = candidate?.qbAmountExVat ?? null;
            const summary = await getSiblingLinksForQbEntity(
              qbEntityType,
              qbId,
              qbRealmId,
              total,
            );
            siblingByQbId.set(qbId, summary);
          }),
        );
        const annotatedAll = ranked.map((c) => {
          const sib = siblingByQbId.get(c.qbEntityId)!;
          const otherAppLinkedElsewhere = sib.links.some(
            (l) =>
              !(l.appEntityType === appEntityType && l.appEntityId === app.id),
          );
          const siblings = sib.links.map((l) => ({
            linkId: l.id,
            appEntityType: l.appEntityType as "cost_line" | "revenue_line",
            appEntityId: l.appEntityId,
            allocatedAmountExVat:
              effectiveAllocatedAmountExVat({
                allocatedAmountExVat: l.allocatedAmountExVat as unknown as string | null,
                qbAmount: l.qbAmount as unknown as string | null,
              }) ?? 0,
          }));
          return {
            ...c,
            qbAlreadyLinkedElsewhere: otherAppLinkedElsewhere,
            warnings: otherAppLinkedElsewhere
              ? [...c.warnings, "qb_already_linked_elsewhere"]
              : c.warnings,
            qbAllocation: {
              siblingCount: sib.links.length,
              totalAllocatedExVat: sib.totalAllocatedExVat,
              remainingExVat: sib.remainingExVat,
              siblings,
            },
          };
        });
        // Drop candidates whose QB doc is already fully linked to other app
        // rows. The user explicitly asked that already-linked items not be
        // re-tried for matching — reviewers must use the admin force-relink
        // path to repoint an existing link.
        const annotated = annotatedAll.filter(
          (c) => !c.qbAlreadyLinkedElsewhere,
        );

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
            description: app.description ?? null,
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

        // Build the QB summary expected by confirm*Link helpers.
        // Task #142 — when the caller supplies `lineAllocations`, route via
        // the transactional many-to-many writer instead so the sum-tolerance
        // invariant is enforced atomically across all sibling links.
        try {
          let createdLinkId: number;
          let allocationToleranceMeta: {
            sum: number;
            delta: number | null;
            tolerance: number;
            toleranceApplied: boolean;
          } | null = null;
          if (body.lineAllocations && body.lineAllocations.length > 0) {
            const appEntityType: "cost_line" | "revenue_line" = isCost
              ? "cost_line"
              : "revenue_line";
            const includesCurrent = body.lineAllocations.some(
              (a) =>
                a.appEntityType === appEntityType && a.appEntityId === appEntityId,
            );
            if (!includesCurrent) {
              return sendError(
                res,
                badRequest(
                  "lineAllocations must include the current app line (the suggestion's appEntityId).",
                ),
              );
            }

            const allocations = await Promise.all(
              body.lineAllocations.map(async (a) => {
                if (a.appEntityType === "cost_line") {
                  const [r] = await db
                    .select({ projectId: normalizedCostLines.projectId })
                    .from(normalizedCostLines)
                    .where(eq(normalizedCostLines.id, a.appEntityId))
                    .limit(1);
                  return {
                    appEntityType: "cost_line" as const,
                    appEntityId: a.appEntityId,
                    projectId: r?.projectId ?? null,
                    allocatedAmountExVat: a.allocatedAmountExVat,
                  };
                } else {
                  const [r] = await db
                    .select({ projectId: normalizedRevenueLines.projectId })
                    .from(normalizedRevenueLines)
                    .where(eq(normalizedRevenueLines.id, a.appEntityId))
                    .limit(1);
                  return {
                    appEntityType: "revenue_line" as const,
                    appEntityId: a.appEntityId,
                    projectId: r?.projectId ?? null,
                    allocatedAmountExVat: a.allocatedAmountExVat,
                  };
                }
              }),
            );

            const writerResult = await confirmLinksWithAllocations({
              qbEntityType: isCost ? "bill" : "invoice",
              qbEntityId: chosen.qbEntityId,
              qbRealmId: suggestion.qbRealmId,
              qbDocSnapshot: {
                qbDocNumber: chosen.qbDocNumber,
                qbTxnDate: chosen.qbTxnDate,
                qbAmount: chosen.qbAmountExVat,
                qbCounterpartyName: chosen.qbCounterpartyName,
              },
              qbDocTotalExVat: chosen.qbAmountExVat,
              allocations,
              matchType: chosen.confidence >= 90 ? "auto_exact" : "auto_fuzzy",
              notes: body.notes ?? null,
              confirmedBy: userId,
            });
            const ownLink = writerResult.links.find(
              (l) =>
                l.appEntityType === appEntityType && l.appEntityId === appEntityId,
            );
            createdLinkId = ownLink?.id ?? writerResult.links[0]!.id;
            allocationToleranceMeta = {
              sum: writerResult.tolerance.sum,
              delta: writerResult.tolerance.delta,
              tolerance: writerResult.tolerance.tolerance,
              toleranceApplied: writerResult.tolerance.toleranceApplied,
            };
          } else if (isCost) {
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
                vendorId: chosen.qbCounterpartyId ?? null,
              },
              matchType: chosen.confidence >= 90 ? "auto_exact" : "auto_fuzzy",
              notes: body.notes ?? null,
              confirmedBy: userId,
              qbRealmId: suggestion.qbRealmId,
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
                customerId: chosen.qbCounterpartyId ?? null,
              },
              matchType: chosen.confidence >= 90 ? "auto_exact" : "auto_fuzzy",
              notes: body.notes ?? null,
              confirmedBy: userId,
              qbRealmId: suggestion.qbRealmId,
            });
            createdLinkId = link.id;
          }

          // The link itself is now persisted. Every downstream cascade
          // (vendor / customer mapping, counterpartyId backfill, paid_date
          // overwrite, recon-ignore clear, name-alias learn, etc.) is
          // recorded as a `qb_link_proposed_cascades` row in `pending`
          // status. The reviewer accepts/declines each from the drawer.
          // The legacy `mapVendor` / `mapCustomer` body flags remain
          // accepted for backward compatibility but no longer trigger
          // immediate writes — they're informational only.
          const [createdLink] = await db
            .select()
            .from(quickbooksInvoiceLinks)
            .where(eq(quickbooksInvoiceLinks.id, createdLinkId))
            .limit(1);
          let proposals: Awaited<ReturnType<typeof listPendingProposalsForLink>> = [];
          if (createdLink) {
            const appCtx: AppRowContext | null = isCost
              ? await loadCostLineContext(appEntityId)
              : await loadRevenueLineContext(appEntityId);
            if (appCtx) {
              const qbSnapshot: QbDocSnapshot = {
                qbEntityType: isCost ? "bill" : "invoice",
                qbEntityId: chosen.qbEntityId,
                qbRealmId: suggestion.qbRealmId,
                qbDocNumber: chosen.qbDocNumber,
                qbTxnDate: chosen.qbTxnDate,
                qbAmountExVat: chosen.qbAmountExVat,
                qbPaymentStatus: chosen.qbPaymentStatus,
                qbBalance: chosen.qbBalance,
                qbCounterpartyId: chosen.qbCounterpartyId,
                qbCounterpartyName: chosen.qbCounterpartyName,
              };
              proposals = await detectAndPersistProposals({
                link: createdLink,
                app: appCtx,
                qb: qbSnapshot,
                createdBy: userId,
              });
            }
          }

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

          if (projectId) {
            refreshProjectMetricsAsync(projectId);
          }

          // Phase 2 — bump learned-pattern rule counters when the chosen
          // candidate was lifted by a per-counterparty fingerprint. Approval
          // = positive feedback (timesConfirmed++), so future bills matching
          // the same shape get progressively stronger boosts.
          await bumpLearnedPatternCounters(
            (chosen as ScoredCandidate).learnedPatternMatches,
            "approved",
          );

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
              proposalCount: proposals.length,
              proposalTypes: proposals.map((p) => p.proposalType),
              lineAllocations: body.lineAllocations ?? null,
              allocationTolerance: allocationToleranceMeta,
            },
          });

          return res.status(201).json({
            ok: true,
            linkId: createdLinkId,
            proposals,
            allocationTolerance: allocationToleranceMeta,
          });
        } catch (inner) {
          if (inner instanceof QuickBooksAllocationToleranceError) {
            logAuditFromReq(req, {
              entityType: "qb_invoice_match_suggestion",
              entityId: String(suggestionId),
              action: "qb.invoice_match.allocation_tolerance_violation",
              source: "UI",
              changesJson: {
                ...inner.details,
                qbEntityId: chosen.qbEntityId,
              },
            });
            return res.status(422).json({
              error: "allocation_tolerance",
              code: inner.code,
              message: inner.message,
              details: inner.details,
            });
          }
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
          // Log structured context for the next operator. The outer catch
          // will translate the error into the HTTP envelope.
          const cls = classifyApproveError(inner);
          logApiError("qb.invoice_match.approve", {
            name: cls.errorName,
            message: cls.errorMessage,
            stack: cls.stack,
            suggestionId,
            scope: isCost ? "cost" : "revenue",
            appEntityId,
            chosenQbEntityId: chosen.qbEntityId,
            qbRealmId: suggestion.qbRealmId,
          });
          throw inner;
        }
      } catch (err) {
        const cls = classifyApproveError(err);
        // Log a fallback entry only for errors that didn't pass through the
        // inner catch's structured log call (i.e. failures BEFORE the
        // confirm*Link try block).
        if (
          !(err instanceof QuickBooksApproveValidationError) &&
          !(err instanceof QuickBooksLinkConflictError) &&
          !(err instanceof ApiError)
        ) {
          logApiError("qb.invoice_match.approve.outer", {
            name: cls.errorName,
            message: cls.errorMessage,
            stack: cls.stack,
            suggestionId: Number(req.params.suggestionId),
          });
        }
        return res.status(cls.statusCode).json({
          error: cls.code,
          code: cls.code,
          reason: cls.reason,
          message: cls.message,
        });
      }
    },
  );

  // -------- GET /app-lines/search ----------------------------------------
  // Task #142 — typeahead search for sibling app lines in the drawer's
  // "Add another app line to this QB doc" combobox. Searches by invoice
  // number / counterparty / project name, optionally scoped to a
  // projectId, returns up to `limit` matches.
  app.get(
    "/api/quickbooks/invoice-matches/app-lines/search",
    requireAuth,
    requirePermission("financials", "view"),
    async (req: Request, res: Response) => {
      try {
        const scope = req.query.scope === "cost" ? "cost" : "revenue";
        const q = String(req.query.q ?? "").trim();
        const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 10));
        const projectId = req.query.projectId ? Number(req.query.projectId) : null;
        if (!q || q.length < 2) return res.json({ items: [] });
        const like = `%${q}%`;
        if (scope === "cost") {
          const rows = await db
            .select({
              id: normalizedCostLines.id,
              invoiceNumber: normalizedCostLines.invoiceNumber,
              invoiceDate: normalizedCostLines.invoiceDate,
              amountExVat: normalizedCostLines.amountExVat,
              counterpartyName: normalizedCostLines.counterpartyName,
              projectId: normalizedCostLines.projectId,
              projectName: normalizedCostLines.projectName,
            })
            .from(normalizedCostLines)
            .where(
              and(
                isNull(normalizedCostLines.effectiveTo),
                isNull(normalizedCostLines.deletedAt),
                projectId ? eq(normalizedCostLines.projectId, projectId) : sql`true`,
                or(
                  ilike(normalizedCostLines.invoiceNumber, like),
                  ilike(normalizedCostLines.counterpartyName, like),
                  ilike(normalizedCostLines.projectName, like),
                ),
              ),
            )
            .orderBy(desc(normalizedCostLines.invoiceDate))
            .limit(limit);
          return res.json({
            items: (rows as Array<typeof rows[number]>).map((r) => ({
              appEntityType: "cost_line" as const,
              appEntityId: r.id,
              invoiceNumber: r.invoiceNumber,
              invoiceDate: r.invoiceDate ? String(r.invoiceDate) : null,
              amountExVat: amountToNumber(r.amountExVat),
              counterpartyName: r.counterpartyName,
              projectId: r.projectId,
              projectName: r.projectName,
            })),
          });
        } else {
          const rows = await db
            .select({
              id: normalizedRevenueLines.id,
              invoiceNumber: normalizedRevenueLines.invoiceNumber,
              invoiceDate: normalizedRevenueLines.invoiceDate,
              amountExVat: normalizedRevenueLines.amountExVat,
              projectId: normalizedRevenueLines.projectId,
              projectName: normalizedRevenueLines.projectName,
            })
            .from(normalizedRevenueLines)
            .where(
              and(
                isNull(normalizedRevenueLines.effectiveTo),
                isNull(normalizedRevenueLines.deletedAt),
                projectId ? eq(normalizedRevenueLines.projectId, projectId) : sql`true`,
                or(
                  ilike(normalizedRevenueLines.invoiceNumber, like),
                  ilike(normalizedRevenueLines.projectName, like),
                ),
              ),
            )
            .orderBy(desc(normalizedRevenueLines.invoiceDate))
            .limit(limit);
          return res.json({
            items: (rows as Array<typeof rows[number]>).map((r) => ({
              appEntityType: "revenue_line" as const,
              appEntityId: r.id,
              invoiceNumber: r.invoiceNumber,
              invoiceDate: r.invoiceDate ? String(r.invoiceDate) : null,
              amountExVat: amountToNumber(r.amountExVat),
              counterpartyName: r.projectName,
              projectId: r.projectId,
              projectName: r.projectName,
            })),
          });
        }
      } catch (err) {
        logApiError("qb.invoice_match.app_line_search", {
          name: (err as Error)?.name,
          message: (err as Error)?.message,
        });
        return sendError(res, serverError("App-line search failed"));
      }
    },
  );

  // -------- POST /:suggestionId/approve-multi ----------------------------
  // Task #142 — approves the suggestion across N QB docs. Validates every
  // allocation block up-front (sum tolerance, duplicates, non-positive)
  // BEFORE any DB writes, then persists every block + the suggestion-accept
  // update inside a single outer DB transaction so the operation is truly
  // atomic across all selected QB candidates. A failure on any block (or
  // the suggestion update) rolls back every block.
  app.post(
    "/api/quickbooks/invoice-matches/:suggestionId/approve-multi",
    requireAuth,
    requirePermission("financials", "edit"),
    validateBody(approveMultiBodySchema),
    async (req: Request, res: Response) => {
      try {
        const suggestionId = Number(req.params.suggestionId);
        if (!Number.isFinite(suggestionId) || suggestionId <= 0) {
          return sendError(res, badRequest("Invalid suggestionId"));
        }
        const body = req.body as z.infer<typeof approveMultiBodySchema>;
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
        const isCost = suggestion.scope === "expense_invoice";
        const isRevenue = suggestion.scope === "incoming_invoice";
        if (!isCost && !isRevenue) {
          return sendError(res, badRequest("This suggestion is not an invoice-match suggestion."));
        }
        const candidates = (suggestion.candidates as unknown as ScoredCandidate[]) ?? [];
        const appEntityId = suggestion.appEntityId;
        if (!appEntityId) return sendError(res, badRequest("Suggestion has no app entity reference"));
        const appEntityType: "cost_line" | "revenue_line" = isCost ? "cost_line" : "revenue_line";

        // Validate every block up-front.
        const seenCandidates = new Set<number>();
        for (const block of body.allocations) {
          if (seenCandidates.has(block.candidateIndex)) {
            return sendError(res, badRequest(
              `Duplicate candidateIndex ${block.candidateIndex} in allocations.`,
            ));
          }
          seenCandidates.add(block.candidateIndex);
          const cand = candidates[block.candidateIndex];
          if (!cand) {
            return sendError(res, badRequest(
              `candidateIndex ${block.candidateIndex} out of range.`,
            ));
          }
          const includesCurrent = block.lineAllocations.some(
            (a) => a.appEntityType === appEntityType && a.appEntityId === appEntityId,
          );
          if (!includesCurrent) {
            return sendError(res, badRequest(
              `Allocation block for candidate ${block.candidateIndex} must include the suggestion's app line.`,
            ));
          }
        }

        // ---- Phase 1: build normalised inputs for every block (read-only).
        type WriterInput = Parameters<typeof validateConfirmAllocationsInput>[0];
        const blockInputs: Array<{
          qbEntityId: string;
          input: WriterInput;
          tolerance: ReturnType<typeof validateConfirmAllocationsInput>;
        }> = [];
        try {
          for (const block of body.allocations) {
            const chosen = candidates[block.candidateIndex]!;
            const allocations = await Promise.all(
              block.lineAllocations.map(async (a) => {
                if (a.appEntityType === "cost_line") {
                  const [r] = await db
                    .select({ projectId: normalizedCostLines.projectId })
                    .from(normalizedCostLines)
                    .where(eq(normalizedCostLines.id, a.appEntityId))
                    .limit(1);
                  return {
                    appEntityType: "cost_line" as const,
                    appEntityId: a.appEntityId,
                    projectId: r?.projectId ?? null,
                    allocatedAmountExVat: a.allocatedAmountExVat,
                  };
                } else {
                  const [r] = await db
                    .select({ projectId: normalizedRevenueLines.projectId })
                    .from(normalizedRevenueLines)
                    .where(eq(normalizedRevenueLines.id, a.appEntityId))
                    .limit(1);
                  return {
                    appEntityType: "revenue_line" as const,
                    appEntityId: a.appEntityId,
                    projectId: r?.projectId ?? null,
                    allocatedAmountExVat: a.allocatedAmountExVat,
                  };
                }
              }),
            );
            const input: WriterInput = {
              qbEntityType: isCost ? "bill" : "invoice",
              qbEntityId: chosen.qbEntityId,
              qbRealmId: suggestion.qbRealmId,
              qbDocSnapshot: {
                qbDocNumber: chosen.qbDocNumber,
                qbTxnDate: chosen.qbTxnDate,
                qbAmount: chosen.qbAmountExVat,
                qbCounterpartyName: chosen.qbCounterpartyName,
              },
              qbDocTotalExVat: chosen.qbAmountExVat,
              allocations,
              matchType: chosen.confidence >= 90 ? "auto_exact" : "auto_fuzzy",
              notes: body.notes ?? null,
              confirmedBy: userId,
            };
            // Validation only — throws on tolerance / duplicate / non-positive.
            const tolerance = validateConfirmAllocationsInput(input);
            blockInputs.push({ qbEntityId: chosen.qbEntityId, input, tolerance });
          }
        } catch (inner) {
          if (inner instanceof QuickBooksAllocationToleranceError) {
            logAuditFromReq(req, {
              entityType: "qb_invoice_match_suggestion",
              entityId: String(suggestionId),
              action: "qb.invoice_match.allocation_tolerance_violation",
              source: "UI",
              changesJson: { ...inner.details, multiQb: true },
            });
            return res.status(422).json({
              error: "allocation_tolerance",
              code: inner.code,
              message: inner.message,
              details: inner.details,
              partialResults: [],
            });
          }
          throw inner;
        }

        // ---- Phase 2: write every block + suggestion-accept in ONE outer tx.
        const firstChosen = candidates[body.allocations[0]!.candidateIndex]!;
        const txOutcome = await db.transaction(async (tx: any) => {
          const results: Array<{
            qbEntityId: string;
            linkId: number;
            tolerance: {
              sum: number;
              delta: number | null;
              tolerance: number;
              toleranceApplied: boolean;
            };
          }> = [];
          let primaryLinkId: number | null = null;
          for (const blk of blockInputs) {
            const writerResult = await confirmLinksWithAllocationsTx(
              tx,
              blk.input,
              blk.tolerance,
            );
            const ownLink = writerResult.links.find(
              (l) => l.appEntityType === appEntityType && l.appEntityId === appEntityId,
            );
            const linkId = ownLink?.id ?? writerResult.links[0]!.id;
            if (primaryLinkId === null) primaryLinkId = linkId;
            results.push({
              qbEntityId: blk.qbEntityId,
              linkId,
              tolerance: {
                sum: writerResult.tolerance.sum,
                delta: writerResult.tolerance.delta,
                tolerance: writerResult.tolerance.tolerance,
                toleranceApplied: writerResult.tolerance.toleranceApplied,
              },
            });
          }
          // Task #142 — compare-and-swap: only accept if still pending. If a
          // concurrent request already accepted/rejected this suggestion, the
          // update affects 0 rows and we throw to roll back the entire tx
          // (link writes included). This guarantees one-winner approval
          // semantics under concurrency.
          const claimed = await tx
            .update(quickbooksMatchSuggestions)
            .set({
              acceptedAt: new Date(),
              acceptedBy: userId,
              acceptedQbId: firstChosen.qbEntityId,
              acceptedConfidence: String(firstChosen.confidence) as unknown as never,
            })
            .where(
              and(
                eq(quickbooksMatchSuggestions.id, suggestionId),
                isNull(quickbooksMatchSuggestions.acceptedAt),
                isNull(quickbooksMatchSuggestions.rejectedAt),
              ),
            )
            .returning({ id: quickbooksMatchSuggestions.id });
          if (claimed.length !== 1) {
            const err = new Error("Suggestion was already accepted or rejected by another request.");
            (err as Error & { __code?: string }).__code = "suggestion_already_resolved";
            throw err;
          }
          return { results, primaryLinkId };
        });
        const { results, primaryLinkId } = txOutcome;

        logAuditFromReq(req, {
          entityType: "qb_invoice_match_suggestion",
          entityId: String(suggestionId),
          action: "qb.invoice_match.approve_multi",
          source: "UI",
          changesJson: {
            scope: isCost ? "cost" : "revenue",
            appEntityId,
            allocationCount: results.length,
            results,
            notes: body.notes ?? null,
          },
        });

        return res.status(201).json({
          ok: true,
          linkId: primaryLinkId,
          results,
        });
      } catch (err) {
        const code = (err as Error & { __code?: string })?.__code;
        if (code === "suggestion_already_resolved") {
          return res.status(409).json({
            error: "conflict",
            code,
            message: (err as Error).message,
          });
        }
        const cls = classifyApproveError(err);
        logApiError("qb.invoice_match.approve_multi", {
          name: cls.errorName,
          message: cls.errorMessage,
          stack: cls.stack,
          suggestionId: Number(req.params.suggestionId),
        });
        return res.status(cls.statusCode).json({
          error: cls.code,
          code: cls.code,
          reason: cls.reason,
          message: cls.message,
        });
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

        // Phase 2 — decay any rules that contributed to this suggestion's
        // top-ranked candidate. Reject = timesOverridden++ across all
        // matched rules; if the override ratio crosses 30% the matcher
        // will eventually stop boosting the same shape.
        const candidatesInSuggestion =
          (suggestion.candidates as unknown as ScoredCandidate[]) ?? [];
        const top = candidatesInSuggestion[0];
        if (top) {
          await bumpLearnedPatternCounters(top.learnedPatternMatches, "rejected");
        }

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
              allocatedAmountExVat: body.allocatedAmountExVat ?? null,
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
              allocatedAmountExVat: body.allocatedAmountExVat ?? null,
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
              allocatedAmountExVat: body.allocatedAmountExVat ?? null,
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

  // -------- POST /bulk-approve -------------------------------------------
  // Safely approves multiple pending suggestions in one request.
  // Each row is independently validated against the "safe bulk" criteria:
  //   - confidence >= 90
  //   - candidate has no warnings
  //   - app line not already linked
  //   - cost lines must have a PO number
  // Rows that fail safety checks are SKIPPED (not failed). Only rows where
  // the DB confirm* call throws are counted as failed. The batch never aborts
  // on a single-row failure — partial success is returned.
  // Counter-party mappings are intentionally omitted from bulk approve;
  // use the single-approve flow for rows requiring mapping decisions.
  app.post(
    "/api/quickbooks/invoice-matches/bulk-approve",
    requireAuth,
    requirePermission("financials", "edit"),
    validateBody(bulkApproveBodySchema),
    async (req: Request, res: Response) => {
      try {
        const body = req.body as z.infer<typeof bulkApproveBodySchema>;
        const userId = getEffectiveUser(req)?.id ?? null;

        type RowOutcome = "approved" | "skipped" | "failed";
        const results: Array<{
          suggestionId: number;
          outcome: RowOutcome;
          linkId?: number;
          reason?: string;
          proposalCount?: number;
        }> = [];
        let approvedCount = 0;
        let skippedCount = 0;
        let failedCount = 0;

        for (const item of body.items) {
          try {
            const [suggestion] = await db
              .select()
              .from(quickbooksMatchSuggestions)
              .where(eq(quickbooksMatchSuggestions.id, item.suggestionId))
              .limit(1);

            if (!suggestion) {
              results.push({ suggestionId: item.suggestionId, outcome: "skipped", reason: "suggestion_not_found" });
              skippedCount++;
              continue;
            }
            if (suggestion.acceptedAt) {
              results.push({ suggestionId: item.suggestionId, outcome: "skipped", reason: "already_accepted" });
              skippedCount++;
              continue;
            }
            if (suggestion.rejectedAt) {
              results.push({ suggestionId: item.suggestionId, outcome: "skipped", reason: "already_rejected" });
              skippedCount++;
              continue;
            }

            const isCost = suggestion.scope === "expense_invoice";
            const isRevenue = suggestion.scope === "incoming_invoice";
            if (!isCost && !isRevenue) {
              results.push({ suggestionId: item.suggestionId, outcome: "skipped", reason: "invalid_scope" });
              skippedCount++;
              continue;
            }

            const candidates = (
              suggestion.candidates as unknown as (ScoredCandidate & { qbAlreadyLinkedElsewhere: boolean })[]
            ) ?? [];
            const chosen = candidates[item.candidateIndex];
            if (!chosen) {
              results.push({ suggestionId: item.suggestionId, outcome: "skipped", reason: "candidate_index_out_of_range" });
              skippedCount++;
              continue;
            }

            // Safety gate 1: score must be >= 90
            if (chosen.confidence < 90) {
              results.push({ suggestionId: item.suggestionId, outcome: "skipped", reason: "score_below_threshold" });
              skippedCount++;
              continue;
            }

            // Safety gate 2: no warnings on the candidate (includes qb_already_linked_elsewhere)
            if (chosen.warnings.length > 0) {
              results.push({
                suggestionId: item.suggestionId,
                outcome: "skipped",
                reason: `has_warnings:${chosen.warnings.join(",")}`,
              });
              skippedCount++;
              continue;
            }

            const appEntityId = suggestion.appEntityId;
            if (!appEntityId) {
              results.push({ suggestionId: item.suggestionId, outcome: "skipped", reason: "no_app_entity" });
              skippedCount++;
              continue;
            }

            // Safety gate 3: re-check active link (state may have changed since find)
            const appEntityType = isCost ? "cost_line" as const : "revenue_line" as const;
            const alreadyLinked = await hasActiveLink(appEntityType, appEntityId);
            if (alreadyLinked) {
              results.push({ suggestionId: item.suggestionId, outcome: "skipped", reason: "app_already_linked" });
              skippedCount++;
              continue;
            }

            // Safety gate 4: cost lines must have a PO number
            if (isCost) {
              const [clRow] = await db
                .select({ poNumber: normalizedCostLines.poNumber })
                .from(normalizedCostLines)
                .where(and(eq(normalizedCostLines.id, appEntityId), isNull(normalizedCostLines.effectiveTo)))
                .limit(1);
              if (!clRow?.poNumber || !String(clRow.poNumber).trim()) {
                results.push({ suggestionId: item.suggestionId, outcome: "skipped", reason: "no_po" });
                skippedCount++;
                continue;
              }
            }

            // Resolve project
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

            // Attempt to create the link — this is the final atomic guard
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
                    vendorId: (chosen as ScoredCandidate & { qbCounterpartyId?: string | null }).qbCounterpartyId ?? null,
                  },
                  matchType: "auto_exact",
                  notes: item.notes ?? null,
                  confirmedBy: userId,
                  qbRealmId: suggestion.qbRealmId,
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
                    customerId: (chosen as ScoredCandidate & { qbCounterpartyId?: string | null }).qbCounterpartyId ?? null,
                  },
                  matchType: "auto_exact",
                  notes: item.notes ?? null,
                  confirmedBy: userId,
                  qbRealmId: suggestion.qbRealmId,
                });
                createdLinkId = link.id;
              }

              // Persist cascade proposals so the bulk path matches the
              // single-approve UX — every downstream change goes through
              // the proposals inbox and never silently mutates app data.
              const [createdLink] = await db
                .select()
                .from(quickbooksInvoiceLinks)
                .where(eq(quickbooksInvoiceLinks.id, createdLinkId))
                .limit(1);
              let proposalCount = 0;
              if (createdLink) {
                const appCtx = isCost
                  ? await loadCostLineContext(appEntityId)
                  : await loadRevenueLineContext(appEntityId);
                if (appCtx) {
                  const candidateAny = chosen as ScoredCandidate & {
                    qbCounterpartyId?: string | null;
                    qbPaymentStatus?: string | null;
                    qbBalance?: number | null;
                  };
                  const proposals = await detectAndPersistProposals({
                    link: createdLink,
                    app: appCtx,
                    qb: {
                      qbEntityType: isCost ? "bill" : "invoice",
                      qbEntityId: chosen.qbEntityId,
                      qbRealmId: suggestion.qbRealmId,
                      qbDocNumber: chosen.qbDocNumber,
                      qbTxnDate: chosen.qbTxnDate,
                      qbAmountExVat: chosen.qbAmountExVat,
                      qbPaymentStatus: candidateAny.qbPaymentStatus ?? null,
                      qbBalance: candidateAny.qbBalance ?? null,
                      qbCounterpartyId: candidateAny.qbCounterpartyId ?? null,
                      qbCounterpartyName: chosen.qbCounterpartyName,
                    },
                    createdBy: userId,
                  });
                  proposalCount = proposals.length;
                }
              }

              await db
                .update(quickbooksMatchSuggestions)
                .set({
                  acceptedAt: new Date(),
                  acceptedBy: userId,
                  acceptedQbId: chosen.qbEntityId,
                  acceptedConfidence: String(chosen.confidence) as unknown as never,
                })
                .where(eq(quickbooksMatchSuggestions.id, item.suggestionId));

              if (projectId) {
                refreshProjectMetricsAsync(projectId);
              }

              await bumpLearnedPatternCounters(
                (chosen as ScoredCandidate).learnedPatternMatches,
                "approved",
              );

              logAuditFromReq(req, {
                entityType: "qb_invoice_match_suggestion",
                entityId: String(item.suggestionId),
                action: "qb.invoice_match.bulk_approve",
                source: "UI",
                changesJson: {
                  scope: isCost ? "cost" : "revenue",
                  appEntityId,
                  qbEntityId: chosen.qbEntityId,
                  qbDocNumber: chosen.qbDocNumber,
                  confidence: chosen.confidence,
                  linkId: createdLinkId,
                  notes: item.notes ?? null,
                  proposalCount,
                },
              });

              results.push({ suggestionId: item.suggestionId, outcome: "approved", linkId: createdLinkId, proposalCount });
              approvedCount++;
            } catch (inner) {
              if (inner instanceof QuickBooksLinkConflictError) {
                logAuditFromReq(req, {
                  entityType: "qb_invoice_match_suggestion",
                  entityId: String(item.suggestionId),
                  action: "qb.invoice_match.conflict",
                  source: "UI",
                  changesJson: { qbEntityId: chosen.qbEntityId, reason: inner.reason },
                });
                results.push({
                  suggestionId: item.suggestionId,
                  outcome: "failed",
                  reason: `conflict:${inner.reason}`,
                });
                failedCount++;
              } else {
                const cls = classifyApproveError(inner);
                logApiError("qb.invoice_match.bulk_approve.row", {
                  name: cls.errorName,
                  message: cls.errorMessage,
                  stack: cls.stack,
                  suggestionId: item.suggestionId,
                  scope: isCost ? "cost" : "revenue",
                  appEntityId,
                  chosenQbEntityId: chosen.qbEntityId,
                  qbRealmId: suggestion.qbRealmId,
                });
                results.push({
                  suggestionId: item.suggestionId,
                  outcome: "failed",
                  reason: cls.message,
                });
                failedCount++;
              }
            }
          } catch (outerErr) {
            logApiError("qb.invoice_match.bulk_approve.outer", outerErr);
            results.push({ suggestionId: item.suggestionId, outcome: "failed", reason: "unexpected_error" });
            failedCount++;
          }
        }

        return res.json({ approved: approvedCount, skipped: skippedCount, failed: failedCount, results });
      } catch (err) {
        logApiError("qb.invoice_match.bulk_approve", err);
        return sendError(res, serverError("Failed to bulk approve matches."));
      }
    },
  );

  // -------- POST /bulk-reject --------------------------------------------
  // Rejects multiple pending suggestions in one request. Suggestions that
  // are already accepted/rejected are silently skipped (not failed).
  app.post(
    "/api/quickbooks/invoice-matches/bulk-reject",
    requireAuth,
    requirePermission("financials", "edit"),
    validateBody(bulkRejectBodySchema),
    async (req: Request, res: Response) => {
      try {
        const body = req.body as z.infer<typeof bulkRejectBodySchema>;
        const userId = getEffectiveUser(req)?.id ?? null;

        type RowOutcome = "rejected" | "skipped" | "failed";
        const results: Array<{
          suggestionId: number;
          outcome: RowOutcome;
          reason?: string;
        }> = [];
        let rejectedCount = 0;
        let skippedCount = 0;
        let failedCount = 0;

        for (const item of body.items) {
          try {
            const [suggestion] = await db
              .select({
                id: quickbooksMatchSuggestions.id,
                scope: quickbooksMatchSuggestions.scope,
                appEntityId: quickbooksMatchSuggestions.appEntityId,
                acceptedAt: quickbooksMatchSuggestions.acceptedAt,
                rejectedAt: quickbooksMatchSuggestions.rejectedAt,
              })
              .from(quickbooksMatchSuggestions)
              .where(eq(quickbooksMatchSuggestions.id, item.suggestionId))
              .limit(1);

            if (!suggestion) {
              results.push({ suggestionId: item.suggestionId, outcome: "skipped", reason: "suggestion_not_found" });
              skippedCount++;
              continue;
            }
            if (suggestion.acceptedAt) {
              results.push({ suggestionId: item.suggestionId, outcome: "skipped", reason: "already_accepted" });
              skippedCount++;
              continue;
            }
            if (suggestion.rejectedAt) {
              results.push({ suggestionId: item.suggestionId, outcome: "skipped", reason: "already_rejected" });
              skippedCount++;
              continue;
            }

            await db
              .update(quickbooksMatchSuggestions)
              .set({
                rejectedAt: new Date(),
                rejectedBy: userId,
                rejectionReason: item.reason,
              })
              .where(eq(quickbooksMatchSuggestions.id, item.suggestionId));

            logAuditFromReq(req, {
              entityType: "qb_invoice_match_suggestion",
              entityId: String(item.suggestionId),
              action: "qb.invoice_match.bulk_reject",
              source: "UI",
              changesJson: {
                scope: suggestion.scope,
                appEntityId: suggestion.appEntityId,
                reason: item.reason,
              },
            });

            results.push({ suggestionId: item.suggestionId, outcome: "rejected" });
            rejectedCount++;
          } catch (rowErr) {
            logApiError("qb.invoice_match.bulk_reject.row", rowErr);
            results.push({ suggestionId: item.suggestionId, outcome: "failed", reason: "unexpected_error" });
            failedCount++;
          }
        }

        return res.json({ rejected: rejectedCount, skipped: skippedCount, failed: failedCount, results });
      } catch (err) {
        logApiError("qb.invoice_match.bulk_reject", err);
        return sendError(res, serverError("Failed to bulk reject matches."));
      }
    },
  );

  // ========================================================================
  // Cascade proposal endpoints
  // ========================================================================
  //
  // After approve / bulk-approve / cascade-commit creates a link, the
  // detector emits one `qb_link_proposed_cascades` row per app-side
  // mutation it would propose (vendor mapping, paid_date overwrite, etc.).
  // The reviewer accepts each from the drawer; nothing on the app side is
  // mutated without an explicit accept. Decline records the reviewer's
  // choice so the inbox stops nagging.

  // GET /api/quickbooks/invoice-matches/links/:linkId/proposals
  //    — return all pending proposals for a given link.
  app.get(
    "/api/quickbooks/invoice-matches/links/:linkId/proposals",
    requireAuth,
    requirePermission("financials", "view"),
    async (req: Request, res: Response) => {
      try {
        const linkId = Number(req.params.linkId);
        if (!Number.isFinite(linkId) || linkId <= 0) {
          return sendError(res, badRequest("Invalid linkId"));
        }
        const proposals = await listPendingProposalsForLink(linkId);
        return res.json({ linkId, proposals });
      } catch (err) {
        logApiError("qb.cascade_proposals.list", err);
        return sendError(res, serverError("Failed to load proposals."));
      }
    },
  );

  // POST /api/quickbooks/invoice-matches/proposals/:id/accept
  //    body: { note?: string }
  // POST /api/quickbooks/invoice-matches/proposals/:id/decline
  //    body: { note?: string }
  const proposalActionBody = z.object({
    note: z.string().max(500).optional(),
  });

  app.post(
    "/api/quickbooks/invoice-matches/proposals/:id/accept",
    requireAuth,
    requirePermission("financials", "edit"),
    validateBody(proposalActionBody),
    async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
          return sendError(res, badRequest("Invalid proposal id"));
        }
        const body = req.body as z.infer<typeof proposalActionBody>;
        const userId = getEffectiveUser(req)?.id ?? null;
        try {
          const updated = await acceptProposal({
            proposalId: id,
            userId,
            note: body.note ?? null,
          });
          if (updated.projectId) {
            refreshProjectMetricsAsync(updated.projectId);
          }
          logAuditFromReq(req, {
            entityType: "qb_link_proposed_cascade",
            entityId: String(id),
            action: "qb.cascade_proposal.accept",
            source: "UI",
            changesJson: {
              proposalType: updated.proposalType,
              fieldName: updated.fieldName,
              targetTable: updated.targetTable,
              targetId: updated.targetId,
              linkId: updated.linkId,
              appValue: updated.appValue,
              qbValue: updated.qbValue,
              note: body.note ?? null,
            },
          });
          return res.json({ ok: true, proposal: updated });
        } catch (inner) {
          if (inner instanceof ProposalApplyError) {
            return res.status(409).json({
              error: "proposal_apply_failed",
              code: inner.code,
              message: inner.message,
            });
          }
          throw inner;
        }
      } catch (err) {
        logApiError("qb.cascade_proposals.accept", err);
        return sendError(res, serverError("Failed to accept proposal."));
      }
    },
  );

  app.post(
    "/api/quickbooks/invoice-matches/proposals/:id/decline",
    requireAuth,
    requirePermission("financials", "edit"),
    validateBody(proposalActionBody),
    async (req: Request, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
          return sendError(res, badRequest("Invalid proposal id"));
        }
        const body = req.body as z.infer<typeof proposalActionBody>;
        const userId = getEffectiveUser(req)?.id ?? null;
        try {
          const updated = await declineProposal({
            proposalId: id,
            userId,
            note: body.note ?? null,
          });
          logAuditFromReq(req, {
            entityType: "qb_link_proposed_cascade",
            entityId: String(id),
            action: "qb.cascade_proposal.decline",
            source: "UI",
            changesJson: {
              proposalType: updated.proposalType,
              fieldName: updated.fieldName,
              linkId: updated.linkId,
              note: body.note ?? null,
            },
          });
          return res.json({ ok: true, proposal: updated });
        } catch (inner) {
          if (inner instanceof ProposalApplyError) {
            return res.status(409).json({
              error: "proposal_apply_failed",
              code: inner.code,
              message: inner.message,
            });
          }
          throw inner;
        }
      } catch (err) {
        logApiError("qb.cascade_proposals.decline", err);
        return sendError(res, serverError("Failed to decline proposal."));
      }
    },
  );

}
