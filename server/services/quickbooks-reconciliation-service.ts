/**
 * QuickBooks ↔ App reconciliation service.
 *
 * Scope (first pass): QuickBooks `Bill` entities ↔ `normalized_cost_lines`.
 * Matches are computed on the fly from live QB data + cost lines, with
 * persistent overrides stored in the `quickbooks_invoice_links` table.
 *
 * Matching ladder:
 *   1. `linked`      — a row in quickbooks_invoice_links already exists
 *   2. `auto_exact`  — normalized invoice number matches AND amount within tolerance
 *   3. `auto_fuzzy`  — vendor + amount + same month match (invoice number
 *                      differs or is missing)
 *   4. `app_only`    — cost line has no QB counterpart
 *   5. `qb_only`     — QB bill has no cost-line counterpart
 *
 * All entry points here are pure orchestration; the HTTP shell lives in
 * server/quickbooks-routes.ts.
 */

import { and, desc, eq, ilike, isNull, inArray, or, sql } from "drizzle-orm";
import {
  normalizedCostLines,
  normalizedRevenueLines,
  projectInfo,
  quickbooksCostAllocations,
  quickbooksDocuments,
  quickbooksCustomerMappings,
  quickbooksVendorMappings,
  quickbooksInvoiceLinks,
  type NormalizedCostLine,
  type NormalizedRevenueLine,
  type QuickBooksCustomerMapping,
  type QuickBooksVendorMapping,
  type QuickBooksInvoiceLink,
} from "@shared/schema";
import { db } from "../db";
import {
  getBillById,
  getBills,
  getValidAccessToken,
  loadQuickBooksMetadata,
  queryQuickBooks,
} from "./quickbooks-service";
import {
  assertNoOverAssignment,
  computeQbDocumentStatus,
  deriveQbVatAmounts,
  QB_ASSIGNMENT_TOLERANCE_EX_VAT,
  toMoney,
} from "../lib/finance/qb-allocation";

const AMOUNT_TOLERANCE = 1; // R1 — generous enough to absorb rounding.

// ===================== TYPES =====================

export interface QuickBooksBillSummary {
  id: string;
  docNumber: string | null;
  txnDate: string | null;
  dueDate: string | null;
  totalAmount: number | null;
  qbAmountIncVat: number | null;
  qbTaxAmount: number | null;
  qbAmountExVat: number | null;
  taxUncertain: boolean;
  balance: number | null;
  vendorName: string | null;
  vendorId: string | null;
}

export interface AppCostLineSummary {
  id: number;
  projectId: number;
  projectName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  paidDate: string | null;
  amountExVat: number | null;
  counterpartyName: string | null;
  cosRealised: boolean | null;
  paidDateConfirmed: boolean | null;
  status: string | null;
  description: string | null;
  poNumber: string | null;
}

export type ReconciliationMatchType =
  | "linked"
  | "auto_exact"
  | "auto_fuzzy"
  | "app_only"
  | "qb_only";

export interface ReconciliationRow {
  matchType: ReconciliationMatchType;
  /** Present for all types except `qb_only`. */
  costLine: AppCostLineSummary | null;
  /** Present for all types except `app_only`. */
  bill: QuickBooksBillSummary | null;
  /** Absolute amount variance (QB − app). 0 or `null` when one side is missing. */
  amountVariance: number | null;
  /** True when either side has non-zero balance or variance. */
  hasWarning: boolean;
  /** Persistent link record when matchType === 'linked'. */
  link: QuickBooksInvoiceLink | null;
}

export interface ReconciliationSummary {
  linkedCount: number;
  autoExactCount: number;
  autoFuzzyCount: number;
  appOnlyCount: number;
  qbOnlyCount: number;
  totalAppAmount: number;
  totalQbAmount: number;
  amountVariance: number;
}

export interface ReconciliationResult {
  projectId: number;
  summary: ReconciliationSummary;
  rows: ReconciliationRow[];
  generatedAt: string;
}

// ===================== NORMALISATION HELPERS =====================

function normalizeInvoiceNumber(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function normalizeName(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function amountToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function sameMonth(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.slice(0, 7) === b.slice(0, 7); // YYYY-MM
}

function amountsWithinTolerance(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= AMOUNT_TOLERANCE;
}

// ===================== RAW → SUMMARY ADAPTERS =====================

export function billRawToSummary(raw: any): QuickBooksBillSummary {
  const vendorName = raw?.VendorRef?.name ?? null;
  const vendorId = raw?.VendorRef?.value ?? null;
  // QB `TotalAmt` is tax-inclusive. App cost lines store ex-VAT. Prefer the
  // ex-tax subtotal when QB provides it (TxnTaxDetail.TotalTax) so variance
  // against `normalized_cost_lines.amount_ex_vat` is apples-to-apples.
  const vat = deriveQbVatAmounts({
    totalAmt: raw?.TotalAmt,
    totalTax: raw?.TxnTaxDetail?.TotalTax,
  });
  return {
    id: String(raw?.Id ?? ""),
    docNumber: raw?.DocNumber ?? null,
    txnDate: raw?.TxnDate ?? null,
    dueDate: raw?.DueDate ?? null,
    totalAmount: vat.qbAmountExVat,
    qbAmountIncVat: vat.qbAmountIncVat,
    qbTaxAmount: vat.qbTaxAmount,
    qbAmountExVat: vat.qbAmountExVat,
    taxUncertain: vat.taxUncertain,
    balance: amountToNumber(raw?.Balance),
    vendorName,
    vendorId,
  };
}

/**
 * One row per QuickBooks Bill line. Used by the COS Tracker reconciliation
 * report to surface QB bills that exist in the GL but were never captured
 * in the project Excel trackers (the source of truth). READ-ONLY — this
 * helper never writes to `normalized_cost_lines` or any other table.
 *
 * The project key on a QB bill line lives on either the line-level
 * `ClassRef` (preferred — finance tags every project line with the project
 * Class) or the bill-level `CustomerRef` (fallback — older bills booked
 * via Customer instead of Class).
 */
export interface QuickBooksBillLineRow {
  billId: string;
  docNumber: string | null;
  txnDate: string | null;
  vendorName: string | null;
  vendorId: string | null;
  lineId: string | null;
  lineNum: number | null;
  /**
   * The line subtotal in QB. QB Bill lines are typically stored ex-tax in
   * `Amount` for AccountBasedExpenseLineDetail; we treat it as ex-VAT for
   * comparison against `normalized_cost_lines.amount_ex_vat`. If the bill
   * carries no `TxnTaxDetail`, this is the safest assumption.
   */
  lineAmountExVat: number | null;
  classRefName: string | null;
  classRefId: string | null;
  customerRefName: string | null;
  customerRefId: string | null;
  accountRefName: string | null;
  accountRefId: string | null;
  description: string | null;
}

/**
 * Extract one row per Bill line from a raw QB Bill payload. Skips lines
 * that aren't `AccountBasedExpenseLineDetail` (e.g. SubTotal lines emitted
 * by some QB UIs) and lines with a non-numeric Amount. Returns at least
 * one synthetic header row when the bill has no usable Line[] so the
 * caller can still see the bill in the unmapped bucket.
 */
export function billRawToLineRows(raw: any): QuickBooksBillLineRow[] {
  const billId = String(raw?.Id ?? "");
  const docNumber = raw?.DocNumber ?? null;
  const txnDate = raw?.TxnDate ?? null;
  const vendorName = raw?.VendorRef?.name ?? null;
  const vendorId = raw?.VendorRef?.value ?? null;
  const billLevelCustomer = raw?.CustomerRef ?? null;

  const lines: any[] = Array.isArray(raw?.Line) ? raw.Line : [];
  const out: QuickBooksBillLineRow[] = [];

  for (const line of lines) {
    const detailType = String(line?.DetailType ?? "");
    if (detailType !== "AccountBasedExpenseLineDetail" && detailType !== "ItemBasedExpenseLineDetail") {
      // Skip SubTotal / Description lines.
      continue;
    }
    const detail =
      line?.AccountBasedExpenseLineDetail ?? line?.ItemBasedExpenseLineDetail ?? {};
    const amount = amountToNumber(line?.Amount);
    out.push({
      billId,
      docNumber,
      txnDate,
      vendorName,
      vendorId,
      lineId: line?.Id ? String(line.Id) : null,
      lineNum: typeof line?.LineNum === "number" ? line.LineNum : null,
      lineAmountExVat: amount,
      classRefName: detail?.ClassRef?.name ?? null,
      classRefId: detail?.ClassRef?.value ?? null,
      customerRefName: detail?.CustomerRef?.name ?? billLevelCustomer?.name ?? null,
      customerRefId: detail?.CustomerRef?.value ?? billLevelCustomer?.value ?? null,
      accountRefName: detail?.AccountRef?.name ?? null,
      accountRefId: detail?.AccountRef?.value ?? null,
      description: line?.Description ?? null,
    });
  }

  // Header-only fallback so the bill still appears in the report even if
  // we couldn't parse any usable lines (e.g. tax-only adjustment).
  if (out.length === 0) {
    out.push({
      billId,
      docNumber,
      txnDate,
      vendorName,
      vendorId,
      lineId: null,
      lineNum: null,
      lineAmountExVat: amountToNumber(raw?.TotalAmt),
      classRefName: null,
      classRefId: null,
      customerRefName: billLevelCustomer?.name ?? null,
      customerRefId: billLevelCustomer?.value ?? null,
      accountRefName: null,
      accountRefId: null,
      description: raw?.PrivateNote ?? "(synthetic header — bill has no usable expense lines)",
    });
  }

  return out;
}

// ===================== PROJECT RESOLVER =====================

/**
 * Normalise a project-name candidate (from QB Class/Customer or the app's
 * project list) into a comparable key. Strips whitespace, lowercases,
 * removes a trailing `_Tracker` / ` Tracker` suffix, and collapses to
 * alphanumerics so " Mondi (Tracker)" and "mondi" match.
 */
export function normalizeProjectKey(value: string | null | undefined): string {
  if (!value) return "";
  return String(value)
    .replace(/[\s_\-]*tracker\b/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export type QbProjectResolutionStrategy =
  | "class_exact"
  | "customer_exact"
  | "class_substring"
  | "customer_substring"
  | "unmapped_class"
  | "unmapped_no_class"
  | "customer_override"
  | "unmapped_customer"
  | "unmapped_no_customer";

export interface QbProjectResolution {
  projectName: string | null;
  strategy: QbProjectResolutionStrategy;
  /** The raw QB tag we used to resolve (or attempted to). */
  matchedFrom: string | null;
}

/**
 * Build an in-memory resolver bound to a known project-name universe.
 * The returned function is cheap to call per bill line.
 *
 * Strategy ladder:
 *   1. `class_exact`    — normalised `classRefName` exactly equals a normalised project name
 *   2. `customer_exact` — same, against `customerRefName`
 *   3. `class_substring` — exactly one project name's normalised key is a
 *                          substring of the normalised classRefName (or vice
 *                          versa for short class tags). Flagged as fuzzy.
 *   4. `customer_substring` — same against customerRefName
 *   5. `unmapped_class` — has a class but nothing matched
 *   6. `unmapped_no_class` — no class and customer didn't match either
 */
export function buildQbProjectResolver(projectNames: string[]): (input: {
  classRefName: string | null;
  customerRefName: string | null;
}) => QbProjectResolution {
  // Pre-compute normalised → canonical project name lookup. When two source
  // names normalise to the same key (e.g. "Mondi" and "Mondi_Tracker"), we
  // keep the longer/canonical form as the value.
  const exactMap = new Map<string, string>();
  for (const name of projectNames) {
    const key = normalizeProjectKey(name);
    if (!key) continue;
    const existing = exactMap.get(key);
    if (!existing || name.length > existing.length) exactMap.set(key, name);
  }

  // For substring strategy we need a stable list of (key, name) pairs.
  const allKeys: { key: string; name: string }[] = [];
  for (const [key, name] of exactMap.entries()) {
    if (key.length >= 4) allKeys.push({ key, name }); // ignore 1-3 char keys
  }
  // Longest key first so "MEGA PARK P2" wins over "MEGA PARK".
  allKeys.sort((a, b) => b.key.length - a.key.length);

  function tryExact(raw: string | null): string | null {
    const key = normalizeProjectKey(raw);
    if (!key) return null;
    return exactMap.get(key) ?? null;
  }

  function trySubstring(raw: string | null): string | null {
    const key = normalizeProjectKey(raw);
    // Conservative: only allow when the QB tag is at least 6 chars AND
    // contains a project key as a substring (i.e. QB tag is *more specific*
    // than the project name, e.g. QB="MondiPhase2" → "Mondi"). Reject the
    // reverse direction (project name being a substring of the QB tag is
    // inherently ambiguous when sibling projects share a prefix — e.g. QB
    // tag "Mondi" must NOT silently resolve to "Mondi Park 2"). Always
    // surfaced as `class_substring`/`customer_substring` so finance can
    // confirm before the row is treated as a real tracker_gap.
    if (!key || key.length < 6) return null;
    const hits = allKeys.filter(({ key: pk }) => pk.length >= 5 && key.includes(pk));
    if (hits.length === 0) return null;
    const top = hits[0]!; // longest first by sort
    const tieCount = hits.filter((h) => h.key.length === top.key.length).length;
    return tieCount === 1 ? top.name : null;
  }

  return ({ classRefName, customerRefName }) => {
    const classExact = tryExact(classRefName);
    if (classExact) {
      return { projectName: classExact, strategy: "class_exact", matchedFrom: classRefName };
    }
    const customerExact = tryExact(customerRefName);
    if (customerExact) {
      return {
        projectName: customerExact,
        strategy: "customer_exact",
        matchedFrom: customerRefName,
      };
    }
    const classSub = trySubstring(classRefName);
    if (classSub) {
      return { projectName: classSub, strategy: "class_substring", matchedFrom: classRefName };
    }
    const customerSub = trySubstring(customerRefName);
    if (customerSub) {
      return {
        projectName: customerSub,
        strategy: "customer_substring",
        matchedFrom: customerRefName,
      };
    }
    if (classRefName && classRefName.trim()) {
      return { projectName: null, strategy: "unmapped_class", matchedFrom: classRefName };
    }
    return {
      projectName: null,
      strategy: "unmapped_no_class",
      matchedFrom: customerRefName ?? null,
    };
  };
}

/**
 * Revenue-side resolver — mirrors `buildQbProjectResolver` but inverts the
 * priority: CUSTOMER first, CLASS as fallback. This matches how invoices are
 * captured in QB (customer is primary; class is optional metadata).
 *
 * Strategy ladder for revenue:
 *   1. `customer_exact`     — normalised customer == project name
 *   2. `class_exact`        — fallback when customer didn't match
 *   3. `customer_substring` — fuzzy customer match
 *   4. `class_substring`    — fuzzy class fallback
 *   5. `unmapped_customer`  — customer present but no resolution
 *   6. `unmapped_no_customer` — no customer at all
 */
export function buildRevenueProjectResolver(projectNames: string[]): (input: {
  classRefName: string | null;
  customerRefName: string | null;
}) => QbProjectResolution {
  const exactMap = new Map<string, string>();
  for (const name of projectNames) {
    const key = normalizeProjectKey(name);
    if (!key) continue;
    const existing = exactMap.get(key);
    if (!existing || name.length > existing.length) exactMap.set(key, name);
  }
  const allKeys: { key: string; name: string }[] = [];
  for (const [key, name] of exactMap.entries()) {
    if (key.length >= 4) allKeys.push({ key, name });
  }
  allKeys.sort((a, b) => b.key.length - a.key.length);

  function tryExact(raw: string | null): string | null {
    const key = normalizeProjectKey(raw);
    if (!key) return null;
    return exactMap.get(key) ?? null;
  }
  function trySubstring(raw: string | null): string | null {
    const key = normalizeProjectKey(raw);
    if (!key || key.length < 6) return null;
    const hits = allKeys.filter(({ key: pk }) => pk.length >= 5 && key.includes(pk));
    if (hits.length === 0) return null;
    const top = hits[0]!;
    const tieCount = hits.filter((h) => h.key.length === top.key.length).length;
    return tieCount === 1 ? top.name : null;
  }

  return ({ classRefName, customerRefName }) => {
    const customerExact = tryExact(customerRefName);
    if (customerExact) {
      return { projectName: customerExact, strategy: "customer_exact", matchedFrom: customerRefName };
    }
    const classExact = tryExact(classRefName);
    if (classExact) {
      return { projectName: classExact, strategy: "class_exact", matchedFrom: classRefName };
    }
    const customerSub = trySubstring(customerRefName);
    if (customerSub) {
      return { projectName: customerSub, strategy: "customer_substring", matchedFrom: customerRefName };
    }
    const classSub = trySubstring(classRefName);
    if (classSub) {
      return { projectName: classSub, strategy: "class_substring", matchedFrom: classRefName };
    }
    if (customerRefName && customerRefName.trim()) {
      return { projectName: null, strategy: "unmapped_customer", matchedFrom: customerRefName };
    }
    return { projectName: null, strategy: "unmapped_no_customer", matchedFrom: classRefName ?? null };
  };
}

/**
 * Rank candidate project mappings for an unmapped QB customer using:
 *  - normalised name distance (longest common substring ratio)
 *  - amount-window co-occurrence with existing revenue lines
 *  - history of prior overrides for the same customer
 */
export interface RevenueProjectSuggestion {
  projectName: string;
  score: number;
  reasons: string[];
}

export function rankRevenueProjectSuggestions(args: {
  customerName: string;
  customerAmounts: number[];
  projectNames: string[];
  revenueLinesByProjectKey: Map<string, { amountExVat: number | string | null }[]>;
  priorOverridesForCustomer: { projectName: string }[];
}): RevenueProjectSuggestion[] {
  const candidates = new Map<string, { score: number; reasons: string[] }>();
  const custKey = normalizeProjectKey(args.customerName);

  function bump(project: string, delta: number, reason: string) {
    const slot = candidates.get(project) ?? { score: 0, reasons: [] };
    slot.score += delta;
    slot.reasons.push(reason);
    candidates.set(project, slot);
  }

  for (const o of args.priorOverridesForCustomer) bump(o.projectName, 100, "prior override for this customer");

  for (const p of args.projectNames) {
    const pKey = normalizeProjectKey(p);
    if (!pKey) continue;
    if (custKey === pKey) bump(p, 80, "exact name match");
    else if (custKey.includes(pKey) || pKey.includes(custKey)) {
      const overlap = Math.min(custKey.length, pKey.length) / Math.max(custKey.length, pKey.length);
      bump(p, Math.round(40 * overlap), `name overlap ${(overlap * 100).toFixed(0)}%`);
    }
    const lines = args.revenueLinesByProjectKey.get(pKey) ?? [];
    let amountHits = 0;
    for (const a of args.customerAmounts) {
      if (lines.some((l) => Math.abs(Number(l.amountExVat ?? 0) - a) <= 1)) amountHits += 1;
    }
    if (amountHits > 0) bump(p, 10 * amountHits, `${amountHits} amount(s) match within R1`);
  }

  return [...candidates.entries()]
    .map(([projectName, s]) => ({ projectName, score: s.score, reasons: s.reasons }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

/**
 * Parse a QB P&L report (with summarize_column_by=Month) and extract the
 * "Cost of Goods Sold" (COGS) section totals per month.
 * Returns a Map of monthKey ("YYYY-MM") → COS amount (number).
 */
export function parsePnLCosMonthly(report: any): Map<string, number> {
  const result = new Map<string, number>();
  if (!report?.Rows?.Row) return result;

  // Build month-key array from column headers
  const columns: any[] = report.Columns?.Column ?? [];
  const monthKeys: (string | null)[] = [];
  for (let i = 1; i < columns.length; i++) {
    const col = columns[i];
    // Try MetaData StartDate first
    const startDate = col.MetaData?.find?.((m: any) => m.Name === "StartDate")?.Value;
    if (startDate) {
      const m = String(startDate).match(/^(\d{4})-(\d{2})/);
      monthKeys.push(m ? `${m[1]}-${m[2]}` : null);
    } else {
      // Parse ColTitle like "Sep 2025"
      const title = String(col.ColTitle || "");
      const parsed = parseColTitleToMonthKey(title);
      monthKeys.push(parsed);
    }
  }

  // Find COGS section
  const cogsSection = (report.Rows.Row as any[]).find(
    (r: any) =>
      r.group === "COGS" ||
      r.group === "CostOfGoodsSold" ||
      (r.Header?.ColData?.[0]?.value || "").toLowerCase().includes("cost of goods sold") ||
      (r.Header?.ColData?.[0]?.value || "").toLowerCase().includes("cost of sales"),
  );
  if (!cogsSection?.Summary?.ColData) return result;

  const colData: any[] = cogsSection.Summary.ColData;
  for (let i = 1; i < colData.length && i - 1 < monthKeys.length; i++) {
    const mk = monthKeys[i - 1];
    if (!mk) continue;
    const value = parseFloat(String(colData[i]?.value || "0"));
    if (Number.isFinite(value) && value !== 0) result.set(mk, value);
  }

  return result;
}

const MONTH_ABBREVS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function parseColTitleToMonthKey(title: string): string | null {
  // "Sep 2025" or "September 2025"
  const m = title.match(/([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const abbr = m[1].slice(0, 3).toLowerCase();
  const moNum = MONTH_ABBREVS[abbr];
  return moNum ? `${m[2]}-${moNum}` : null;
}

export function costLineToSummary(row: NormalizedCostLine): AppCostLineSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName ?? null,
    invoiceNumber: row.invoiceNumber ?? null,
    invoiceDate: row.invoiceDate ? String(row.invoiceDate) : null,
    paidDate: row.paidDate ? String(row.paidDate) : null,
    amountExVat: amountToNumber(row.amountExVat),
    counterpartyName: row.counterpartyName ?? null,
    cosRealised: row.cosRealised ?? null,
    paidDateConfirmed: row.paidDateConfirmed ?? null,
    status: row.status ?? null,
    description: row.description ?? null,
    poNumber: row.poNumber ?? null,
  };
}

// ===================== DB ACCESS =====================

async function fetchProjectCostLines(projectId: number): Promise<NormalizedCostLine[]> {
  return db
    .select()
    .from(normalizedCostLines)
    .where(
      and(
        eq(normalizedCostLines.projectId, projectId),
        and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt)),
      ),
    );
}

async function fetchLinksForCostLines(
  costLineIds: number[],
): Promise<QuickBooksInvoiceLink[]> {
  if (costLineIds.length === 0) return [];
  return db
    .select()
    .from(quickbooksInvoiceLinks)
    .where(
      and(
        eq(quickbooksInvoiceLinks.appEntityType, "cost_line"),
        eq(quickbooksInvoiceLinks.qbEntityType, "bill"),
        isNull(quickbooksInvoiceLinks.deletedAt),
        inArray(quickbooksInvoiceLinks.appEntityId, costLineIds),
      ),
    );
}

export async function fetchProjectLinks(projectId: number): Promise<QuickBooksInvoiceLink[]> {
  return db
    .select()
    .from(quickbooksInvoiceLinks)
    .where(
      and(
        eq(quickbooksInvoiceLinks.projectId, projectId),
        isNull(quickbooksInvoiceLinks.deletedAt),
      ),
    );
}

export async function listAllLinks(limit = 500): Promise<QuickBooksInvoiceLink[]> {
  return db
    .select()
    .from(quickbooksInvoiceLinks)
    .where(isNull(quickbooksInvoiceLinks.deletedAt))
    .orderBy(desc(quickbooksInvoiceLinks.confirmedAt))
    .limit(limit);
}

export async function searchCostLines(
  query: string,
  limit = 50,
): Promise<AppCostLineSummary[]> {
  const trimmed = query.trim();
  const where = trimmed
    ? and(
        and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt)),
        or(
          ilike(normalizedCostLines.invoiceNumber, `%${trimmed}%`),
          ilike(normalizedCostLines.counterpartyName, `%${trimmed}%`),
          ilike(normalizedCostLines.description, `%${trimmed}%`),
          ilike(normalizedCostLines.projectName, `%${trimmed}%`),
        ),
      )
    : and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt));

  const rows = await db
    .select()
    .from(normalizedCostLines)
    .where(where)
    .orderBy(desc(normalizedCostLines.invoiceDate))
    .limit(limit);

  return rows.map(costLineToSummary);
}

// `searchRevenueLines` uses the canonical AppRevenueLineSummary and
// revenueLineToSummary helper defined later in this file (revenue
// reconciliation section). Those are hoisted via function declaration so the
// circular reference here is safe.

export async function searchRevenueLines(
  query: string,
  limit = 50,
): Promise<AppRevenueLineSummary[]> {
  const trimmed = query.trim();
  const where = trimmed
    ? and(
        and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt)),
        or(
          ilike(normalizedRevenueLines.invoiceNumber, `%${trimmed}%`),
          ilike(normalizedRevenueLines.description, `%${trimmed}%`),
          ilike(normalizedRevenueLines.projectName, `%${trimmed}%`),
        ),
      )
    : and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt));

  const rows: NormalizedRevenueLine[] = await db
    .select()
    .from(normalizedRevenueLines)
    .where(where)
    .orderBy(desc(normalizedRevenueLines.invoiceDate))
    .limit(limit);

  return rows.map(revenueLineToSummary);
}

// Export `sql` tag through to keep the drizzle import used if we grow.
void sql;

// ===================== LINK CRUD =====================

export interface CreateLinkInput {
  projectId: number | null;
  appEntityType: "cost_line" | "revenue_line";
  appEntityId: number;
  qbEntityType: "bill" | "invoice";
  qbEntityId: string;
  qbRealmId?: string;
  qbDocNumber?: string | null;
  qbTxnDate?: string | null;
  qbAmount?: number | null;
  qbCounterpartyName?: string | null;
  matchType?: "manual" | "auto_exact" | "auto_fuzzy";
  notes?: string | null;
  confirmedBy?: number | null;
  /**
   * Per-link Rand allocation against the QB doc total (ex-VAT). When
   * omitted, defaults to `qbAmount` so the legacy single-link callers
   * (recon UI, `confirmCostLineLink`, `confirmRevenueLineLink`) keep
   * behaving as before — one link == 100% of the QB doc.
   * Many-to-many callers (Task #142 transactional writer) supply this
   * explicitly so the sum-tolerance invariant can be enforced.
   */
  allocatedAmountExVat?: number | null;
  /** Set true by the many-to-many writer when sum drift was within tolerance. */
  allocationToleranceApplied?: boolean;
}

/**
 * Raised by `createOrUpdateLink` when the requested link would violate the
 * 1:1 invariant enforced by the partial unique indexes on
 * `quickbooks_invoice_links`. The HTTP layer maps this to a 409 Conflict
 * with the full set of conflicting rows so the caller can decide whether
 * to unlink the existing link first.
 */
/**
 * Raised when the QuickBooks realm is not available (connector offline or
 * not yet linked). Callers should surface this as 503 so operators know to
 * re-connect before retrying the write.
 */
export class QuickBooksUnavailableError extends Error {
  readonly code = "quickbooks_unavailable";
  constructor(message = "QuickBooks connection is not configured. Connect QuickBooks and retry.") {
    super(message);
    this.name = "QuickBooksUnavailableError";
  }
}

/**
 * Raised when the client references a Bill Id that QB doesn't return. Avoids
 * writing evidence snapshots against a non-existent document.
 */
export class QuickBooksBillNotFoundError extends Error {
  readonly code = "quickbooks_bill_not_found";
  constructor(public readonly billId: string) {
    super(`QuickBooks Bill ${billId} not found in the connected realm.`);
    this.name = "QuickBooksBillNotFoundError";
  }
}

/**
 * Thrown by the confirm*Link helpers when an approve attempt fails for a
 * caller-meaningful reason (missing referenced row, invalid QB payload, etc.)
 * — distinct from a 1:1 link conflict (QuickBooksLinkConflictError) and from
 * a generic database/runtime fault.
 *
 * The route layer catches this and returns a 4xx with `message` so the
 * end-user toast can show the actual cause instead of a hard-coded generic
 * "Approve failed."
 */
export class QuickBooksApproveValidationError extends Error {
  readonly code = "quickbooks_approve_validation";
  readonly reason: string;
  readonly statusCode: number;

  constructor(params: { reason: string; message: string; statusCode?: number }) {
    super(params.message);
    this.name = "QuickBooksApproveValidationError";
    this.reason = params.reason;
    this.statusCode = params.statusCode ?? 400;
  }
}

export class QuickBooksLinkConflictError extends Error {
  readonly code = "quickbooks_link_conflict";
  readonly conflicts: QuickBooksInvoiceLink[];
  readonly reason: "app_entity_already_linked" | "qb_entity_already_linked" | "both";

  constructor(params: {
    reason: QuickBooksLinkConflictError["reason"];
    conflicts: QuickBooksInvoiceLink[];
    message?: string;
  }) {
    super(
      params.message ??
        (params.reason === "app_entity_already_linked"
          ? "This app line is already linked to a different QuickBooks document. Unlink the existing link first."
          : params.reason === "qb_entity_already_linked"
            ? "This QuickBooks document is already linked to a different app line. Unlink the existing link first."
            : "This app line and QuickBooks document are both already linked elsewhere. Unlink the existing links first."),
    );
    this.name = "QuickBooksLinkConflictError";
    this.conflicts = params.conflicts;
    this.reason = params.reason;
  }
}

/**
 * Create or refresh a link row between an app finance line and a QuickBooks
 * document. Many-to-many semantics (Task #142):
 *
 *   - The same app line MAY now be linked to multiple QB docs at the same
 *     time (e.g. one large invoice paid off by two QB receipts).
 *   - The same QB doc MAY now be linked to multiple app lines at the same
 *     time (e.g. one bank deposit settling ten invoices).
 *   - Each link carries an explicit `allocated_amount_ex_vat` — the Rand
 *     value it consumes from the QB doc total.
 *   - The base 5-tuple uniqueness (app+qb+realm) still prevents duplicate
 *     links between the *same* pair — re-confirming that pair is the
 *     idempotent refresh path.
 *
 * `QuickBooksLinkConflictError` is no longer raised by this writer for
 * many-to-many situations; it remains in the type system for legacy
 * callers that may still hit a base 5-tuple collision via the underlying
 * unique index (e.g. concurrent inserts from two browser tabs).
 *
 * Default allocation behavior: when `allocatedAmountExVat` is omitted, the
 * link inherits the QB doc total (`qbAmount`) so legacy single-link
 * callers (`confirmCostLineLink`, `confirmRevenueLineLink`, `/api/quickbooks/links`)
 * preserve their previous "one link == 100%" semantics.
 */
export async function createOrUpdateLink(
  input: CreateLinkInput,
): Promise<QuickBooksInvoiceLink> {
  const realmId =
    input.qbRealmId ?? ((await loadQuickBooksMetadata()).realmId ?? "unknown");

  const now = new Date();
  const allocated =
    input.allocatedAmountExVat !== null && input.allocatedAmountExVat !== undefined
      ? Number(input.allocatedAmountExVat)
      : input.qbAmount !== null && input.qbAmount !== undefined
        ? Number(input.qbAmount)
        : 0;

  const values = {
    projectId: input.projectId ?? null,
    appEntityType: input.appEntityType,
    appEntityId: input.appEntityId,
    qbEntityType: input.qbEntityType,
    qbEntityId: String(input.qbEntityId),
    qbRealmId: realmId,
    qbDocNumber: input.qbDocNumber ?? null,
    qbTxnDate: input.qbTxnDate ?? null,
    qbAmount:
      input.qbAmount !== null && input.qbAmount !== undefined
        ? Number(input.qbAmount).toFixed(2)
        : null,
    qbCounterpartyName: input.qbCounterpartyName ?? null,
    matchType: input.matchType ?? "manual",
    allocatedAmountExVat: Number.isFinite(allocated) ? allocated.toFixed(2) : "0",
    allocationToleranceApplied: !!input.allocationToleranceApplied,
    notes: input.notes ?? null,
    confirmedBy: input.confirmedBy ?? null,
    confirmedAt: now,
    updatedAt: now,
  };

  // Idempotent / revive path — the base 5-tuple unique index would otherwise
  // raise. We refresh the snapshot fields and the allocation amount.
  const exact = await db
    .select()
    .from(quickbooksInvoiceLinks)
    .where(
      and(
        eq(quickbooksInvoiceLinks.appEntityType, values.appEntityType),
        eq(quickbooksInvoiceLinks.appEntityId, values.appEntityId),
        eq(quickbooksInvoiceLinks.qbEntityType, values.qbEntityType),
        eq(quickbooksInvoiceLinks.qbEntityId, values.qbEntityId),
        eq(quickbooksInvoiceLinks.qbRealmId, values.qbRealmId),
      ),
    )
    .limit(1);

  if (exact.length > 0) {
    const row = exact[0]!;
    const updated = await db
      .update(quickbooksInvoiceLinks)
      .set({ ...values, deletedAt: null } as any)
      .where(eq(quickbooksInvoiceLinks.id, row.id))
      .returning();
    return updated[0]!;
  }

  const inserted = await db
    .insert(quickbooksInvoiceLinks)
    .values(values as any)
    .returning();
  return inserted[0]!;
}

// ===================== TASK #142: many-to-many allocations =====================

import {
  checkQbAllocationSum,
  effectiveAllocatedAmountExVat,
} from "@shared/config/qb-allocations";

/**
 * Raised when a many-to-many allocation request fails the sum-tolerance
 * invariant. Routes translate this to HTTP 422 so the drawer can render
 * the failing reason inline (the Approve button is also pre-gated on the
 * client side).
 */
export type QuickBooksAllocationFailureReason =
  | "out_of_tolerance"
  | "duplicate_app_entity"
  | "non_positive_allocation";

export class QuickBooksAllocationToleranceError extends Error {
  readonly code = "quickbooks_allocation_out_of_tolerance";
  constructor(
    public readonly details: {
      qbEntityId: string;
      qbDocTotalExVat: number | null;
      sum: number;
      delta: number | null;
      tolerance: number;
      /**
       * Why this allocation request failed. Defaults to `out_of_tolerance`
       * for backward compat with the original sum-tolerance gate; the
       * writer also raises `duplicate_app_entity` (two entries for the
       * same app line) and `non_positive_allocation` (allocation <= 0)
       * with this same error type so the route layer can map them all
       * to a single 422 response shape.
       */
      reason?: QuickBooksAllocationFailureReason;
      /**
       * Set when `reason === "duplicate_app_entity"` — the
       * `appEntityType:appEntityId` key that appeared twice.
       */
      duplicateKey?: string;
    },
  ) {
    const fmt = (n: number | null) =>
      n === null ? "(unknown)" : `R${n.toFixed(2)}`;
    const reason = details.reason ?? "out_of_tolerance";
    let msg: string;
    if (reason === "duplicate_app_entity") {
      msg =
        `QuickBooks doc ${details.qbEntityId} allocation rejected: ` +
        `duplicate app entity entry "${details.duplicateKey ?? "?"}".`;
    } else if (reason === "non_positive_allocation") {
      msg =
        `QuickBooks doc ${details.qbEntityId} allocation rejected: ` +
        `allocations must be > 0.`;
    } else {
      msg =
        `QuickBooks doc ${details.qbEntityId} allocations sum to ${fmt(details.sum)} ` +
        `vs total ${fmt(details.qbDocTotalExVat)} (delta ${fmt(details.delta)}, ` +
        `tolerance ±R${details.tolerance.toFixed(2)}).`;
    }
    super(msg);
    this.name = "QuickBooksAllocationToleranceError";
  }
}

export interface QbDocAllocation {
  appEntityId: number;
  appEntityType: "cost_line" | "revenue_line";
  projectId: number | null;
  allocatedAmountExVat: number;
}

export interface ConfirmAllocationsInput {
  qbEntityType: "bill" | "invoice";
  qbEntityId: string;
  qbRealmId: string;
  qbDocSnapshot: {
    qbDocNumber: string | null;
    qbTxnDate: string | null;
    qbAmount: number | null;
    qbCounterpartyName: string | null;
  };
  /** QB doc total ex-VAT used for the sum-tolerance check. */
  qbDocTotalExVat: number | null;
  /** New allocations the caller wants ACTIVE for this QB doc after the call. */
  allocations: QbDocAllocation[];
  matchType?: "manual" | "auto_exact" | "auto_fuzzy";
  notes?: string | null;
  confirmedBy?: number | null;
  /** When true, skip the sum-tolerance enforcement (manual override path). */
  allowOutOfTolerance?: boolean;
}

export interface SiblingLinkSummary {
  qbEntityType: "bill" | "invoice";
  qbEntityId: string;
  qbRealmId: string;
  links: QuickBooksInvoiceLink[];
  totalAllocatedExVat: number;
  qbDocTotalExVat: number | null;
  remainingExVat: number | null;
}

/**
 * Read all ACTIVE sibling links for a single QB doc + realm and return the
 * canonical aggregate (sum of allocated amounts + remaining unallocated).
 * Used by the find endpoint, the unlink endpoint and the drawer to show
 * "QB doc has R X already allocated, R Y remaining".
 */
export async function getSiblingLinksForQbEntity(
  qbEntityType: "bill" | "invoice",
  qbEntityId: string,
  qbRealmId: string,
  qbDocTotalExVat: number | null = null,
): Promise<SiblingLinkSummary> {
  const links = await db
    .select()
    .from(quickbooksInvoiceLinks)
    .where(
      and(
        eq(quickbooksInvoiceLinks.qbEntityType, qbEntityType),
        eq(quickbooksInvoiceLinks.qbEntityId, qbEntityId),
        eq(quickbooksInvoiceLinks.qbRealmId, qbRealmId),
        isNull(quickbooksInvoiceLinks.deletedAt),
      ),
    );

  const total = links.reduce((acc: number, l: QuickBooksInvoiceLink) => {
    const v = effectiveAllocatedAmountExVat({
      allocatedAmountExVat: l.allocatedAmountExVat as unknown as string | null,
      qbAmount: l.qbAmount as unknown as string | null,
    });
    return acc + (v ?? 0);
  }, 0);

  // Resolve a doc-total fallback from the snapshot fields if the caller
  // didn't pass one in. Prefer caller > first link's qbAmount.
  const fallback =
    qbDocTotalExVat ??
    (links.length > 0 && links[0]!.qbAmount !== null
      ? Number(links[0]!.qbAmount)
      : null);

  return {
    qbEntityType,
    qbEntityId,
    qbRealmId,
    links,
    totalAllocatedExVat: Number(total.toFixed(2)),
    qbDocTotalExVat: fallback,
    remainingExVat:
      fallback === null ? null : Number((fallback - total).toFixed(2)),
  };
}

/**
 * Transactional many-to-many writer for QB doc → app lines.
 *
 * The caller declares the COMPLETE set of allocations they want active for
 * this QB doc after the call. The writer:
 *   1. Loads existing active siblings.
 *   2. Validates `sum(new allocations) == qbDocTotalExVat ± tolerance`
 *      (unless `allowOutOfTolerance`).
 *   3. Soft-deletes any existing sibling whose `appEntityId` is NOT in the
 *      new set (the user removed those lines from the group).
 *   4. Upserts each new allocation via `createOrUpdateLink` (idempotent on
 *      the base 5-tuple).
 *
 * Returns the resulting active link rows + tolerance result so the route
 * layer can audit-log the drift and the UI can show the new balance.
 */
/**
 * Task #142 — Pure validation step extracted so callers (single-QB route
 * or multi-QB route) can run the full preflight up front before opening
 * any DB transaction. Throws `QuickBooksAllocationToleranceError` with a
 * typed `reason` on failure (no DB writes).
 */
export function validateConfirmAllocationsInput(
  input: ConfirmAllocationsInput,
): ReturnType<typeof checkQbAllocationSum> {
  const seen = new Set<string>();
  for (const a of input.allocations) {
    const key = `${a.appEntityType}:${a.appEntityId}`;
    if (seen.has(key)) {
      throw new QuickBooksAllocationToleranceError({
        qbEntityId: input.qbEntityId,
        qbDocTotalExVat: input.qbDocTotalExVat,
        sum: 0,
        delta: null,
        tolerance: 0,
        reason: "duplicate_app_entity",
        duplicateKey: key,
      });
    }
    seen.add(key);
    if (!Number.isFinite(a.allocatedAmountExVat) || a.allocatedAmountExVat <= 0) {
      throw new QuickBooksAllocationToleranceError({
        qbEntityId: input.qbEntityId,
        qbDocTotalExVat: input.qbDocTotalExVat,
        sum: 0,
        delta: null,
        tolerance: 0,
        reason: "non_positive_allocation",
        duplicateKey: key,
      });
    }
  }
  const tolerance = checkQbAllocationSum(input.qbDocTotalExVat, input.allocations);
  if (!tolerance.ok && !input.allowOutOfTolerance) {
    throw new QuickBooksAllocationToleranceError({
      qbEntityId: input.qbEntityId,
      qbDocTotalExVat: input.qbDocTotalExVat,
      sum: tolerance.sum,
      delta: tolerance.delta,
      tolerance: tolerance.tolerance,
    });
  }
  return tolerance;
}

/**
 * Task #142 — Inner write step. Operates inside an existing tx (so the
 * multi-QB route can wrap N calls in one outer transaction for true
 * all-or-nothing semantics). Assumes `validateConfirmAllocationsInput`
 * has already passed.
 */
export async function confirmLinksWithAllocationsTx(
  tx: any,
  input: ConfirmAllocationsInput,
  tolerance: ReturnType<typeof checkQbAllocationSum>,
): Promise<{
  links: QuickBooksInvoiceLink[];
  tolerance: ReturnType<typeof checkQbAllocationSum>;
  removedLinkIds: number[];
}> {
  return runConfirmLinksWithAllocationsInTx(tx, input, tolerance);
}

export async function confirmLinksWithAllocations(
  input: ConfirmAllocationsInput,
): Promise<{
  links: QuickBooksInvoiceLink[];
  tolerance: ReturnType<typeof checkQbAllocationSum>;
  removedLinkIds: number[];
}> {
  const tolerance = validateConfirmAllocationsInput(input);
  return await db.transaction(async (tx: any) => {
    return runConfirmLinksWithAllocationsInTx(tx, input, tolerance);
  });
}

async function runConfirmLinksWithAllocationsInTx(
  tx: any,
  input: ConfirmAllocationsInput,
  tolerance: ReturnType<typeof checkQbAllocationSum>,
): Promise<{
  links: QuickBooksInvoiceLink[];
  tolerance: ReturnType<typeof checkQbAllocationSum>;
  removedLinkIds: number[];
}> {
    const existing = await tx
      .select()
      .from(quickbooksInvoiceLinks)
      .where(
        and(
          eq(quickbooksInvoiceLinks.qbEntityType, input.qbEntityType),
          eq(quickbooksInvoiceLinks.qbEntityId, input.qbEntityId),
          eq(quickbooksInvoiceLinks.qbRealmId, input.qbRealmId),
          isNull(quickbooksInvoiceLinks.deletedAt),
        ),
      );

    const newKeys = new Set(
      input.allocations.map((a) => `${a.appEntityType}:${a.appEntityId}`),
    );
    const toRemove = existing.filter(
      (l: QuickBooksInvoiceLink) => !newKeys.has(`${l.appEntityType}:${l.appEntityId}`),
    );
    const removedLinkIds: number[] = [];
    for (const l of toRemove) {
      await tx
        .update(quickbooksInvoiceLinks)
        .set({ deletedAt: new Date(), updatedAt: new Date() } as any)
        .where(eq(quickbooksInvoiceLinks.id, l.id));
      removedLinkIds.push(l.id);
    }

    const upserted: QuickBooksInvoiceLink[] = [];
    for (const a of input.allocations) {
      const exact = await tx
        .select()
        .from(quickbooksInvoiceLinks)
        .where(
          and(
            eq(quickbooksInvoiceLinks.appEntityType, a.appEntityType),
            eq(quickbooksInvoiceLinks.appEntityId, a.appEntityId),
            eq(quickbooksInvoiceLinks.qbEntityType, input.qbEntityType),
            eq(quickbooksInvoiceLinks.qbEntityId, input.qbEntityId),
            eq(quickbooksInvoiceLinks.qbRealmId, input.qbRealmId),
          ),
        )
        .limit(1);

      const values = {
        projectId: a.projectId ?? null,
        appEntityType: a.appEntityType,
        appEntityId: a.appEntityId,
        qbEntityType: input.qbEntityType,
        qbEntityId: input.qbEntityId,
        qbRealmId: input.qbRealmId,
        qbDocNumber: input.qbDocSnapshot.qbDocNumber ?? null,
        qbTxnDate: input.qbDocSnapshot.qbTxnDate ?? null,
        qbAmount:
          input.qbDocSnapshot.qbAmount !== null && input.qbDocSnapshot.qbAmount !== undefined
            ? Number(input.qbDocSnapshot.qbAmount).toFixed(2)
            : null,
        qbCounterpartyName: input.qbDocSnapshot.qbCounterpartyName ?? null,
        matchType: input.matchType ?? "manual",
        allocatedAmountExVat: Number(a.allocatedAmountExVat).toFixed(2),
        allocationToleranceApplied: tolerance.toleranceApplied,
        notes: input.notes ?? null,
        confirmedBy: input.confirmedBy ?? null,
        confirmedAt: new Date(),
        updatedAt: new Date(),
      };

      if (exact.length > 0) {
        const row = exact[0]!;
        const [updated] = await tx
          .update(quickbooksInvoiceLinks)
          .set({ ...values, deletedAt: null } as any)
          .where(eq(quickbooksInvoiceLinks.id, row.id))
          .returning();
        upserted.push(updated!);
      } else {
        const [inserted] = await tx
          .insert(quickbooksInvoiceLinks)
          .values(values as any)
          .returning();
        upserted.push(inserted!);
      }
    }

    return { links: upserted, tolerance, removedLinkIds };
}

/**
 * Soft-delete a link. Returns the previous row so callers can log exactly
 * what was unlinked in the audit trail. Returns null if the link was
 * already deleted or does not exist.
 */
export async function softDeleteLink(
  linkId: number,
): Promise<QuickBooksInvoiceLink | null> {
  const existing = await db
    .select()
    .from(quickbooksInvoiceLinks)
    .where(eq(quickbooksInvoiceLinks.id, linkId))
    .limit(1);
  if (existing.length === 0) return null;
  const row = existing[0]!;
  if (row.deletedAt) return row;
  await db
    .update(quickbooksInvoiceLinks)
    .set({ deletedAt: new Date(), updatedAt: new Date() } as any)
    .where(eq(quickbooksInvoiceLinks.id, linkId));
  return row;
}

export interface QuickBooksCostAllocationInput {
  projectId: number | null;
  costLineId: number;
  amountExVat: number;
}

export interface BulkAssignPreviewRow {
  qbEntityId: string;
  qbDocNumber: string | null;
  qbAmountExVat: number | null;
  assignedExVat: number;
  remainingExVat: number | null;
  status: string;
  taxUncertain: boolean;
}

type QuickBooksDocumentInsert = typeof quickbooksDocuments.$inferInsert;
type QuickBooksCostAllocationInsert = typeof quickbooksCostAllocations.$inferInsert;

function derivePaymentStatus(balance: number | null, totalAmount: number | null): "paid" | "partial" | "unpaid" | null {
  if (balance === null) return null;
  if (balance <= 0) return "paid";
  if (totalAmount !== null && balance < totalAmount) return "partial";
  return "unpaid";
}

async function upsertQuickBooksDocumentFromBill(
  projectId: number | null,
  bill: QuickBooksBillSummary,
  qbRealmId: string,
  actorId: number | null,
) {
  const existing = await db
    .select()
    .from(quickbooksDocuments)
    .where(
      and(
        eq(quickbooksDocuments.qbEntityType, "bill"),
        eq(quickbooksDocuments.qbEntityId, bill.id),
        eq(quickbooksDocuments.qbRealmId, qbRealmId),
        isNull(quickbooksDocuments.deletedAt),
      ),
    )
    .limit(1);

  const incVat = toMoney(bill.qbAmountIncVat);
  const taxAmount = toMoney(bill.qbTaxAmount);
  const exVat = toMoney(bill.qbAmountExVat);
  const snapshot: QuickBooksDocumentInsert = {
    projectId,
    qbEntityType: "bill",
    qbEntityId: bill.id,
    qbRealmId,
    qbDocNumber: bill.docNumber,
    qbTxnDate: bill.txnDate,
    qbCounterpartyName: bill.vendorName,
    qbCounterpartyId: bill.vendorId,
    qbAmountIncVat: incVat === null ? null : incVat.toFixed(2),
    qbTaxAmount: taxAmount === null ? null : taxAmount.toFixed(2),
    qbAmountExVat: exVat === null ? null : exVat.toFixed(2),
    taxStatus: bill.taxUncertain ? "TAX_UNCERTAIN" : "KNOWN",
    qbBalance: bill.balance !== null ? bill.balance.toFixed(2) : null,
    qbPaymentStatus: derivePaymentStatus(bill.balance, toMoney(bill.qbAmountIncVat)),
    createdBy: actorId,
    updatedAt: new Date(),
  };

  if (existing.length > 0) {
    const updated = await db
      .update(quickbooksDocuments)
      .set(snapshot)
      .where(eq(quickbooksDocuments.id, existing[0]!.id))
      .returning();
    return updated[0]!;
  }

  const inserted = await db.insert(quickbooksDocuments).values(snapshot).returning();
  return inserted[0]!;
}

async function upsertQuickBooksDocumentFromInvoice(
  projectId: number | null,
  invoice: QuickBooksInvoiceSummary,
  qbRealmId: string,
  actorId: number | null,
) {
  const existing = await db
    .select()
    .from(quickbooksDocuments)
    .where(
      and(
        eq(quickbooksDocuments.qbEntityType, "invoice"),
        eq(quickbooksDocuments.qbEntityId, invoice.id),
        eq(quickbooksDocuments.qbRealmId, qbRealmId),
        isNull(quickbooksDocuments.deletedAt),
      ),
    )
    .limit(1);

  const totalAmount = invoice.totalAmount;
  const snapshot: QuickBooksDocumentInsert = {
    projectId,
    qbEntityType: "invoice",
    qbEntityId: invoice.id,
    qbRealmId,
    qbDocNumber: invoice.docNumber,
    qbTxnDate: invoice.txnDate,
    qbCounterpartyName: invoice.customerName,
    qbCounterpartyId: invoice.customerId,
    qbAmountIncVat: totalAmount !== null ? totalAmount.toFixed(2) : null,
    qbTaxAmount: null,
    qbAmountExVat: totalAmount !== null ? totalAmount.toFixed(2) : null,
    taxStatus: "KNOWN",
    qbBalance: invoice.balance !== null ? invoice.balance.toFixed(2) : null,
    qbPaymentStatus: derivePaymentStatus(invoice.balance, totalAmount),
    createdBy: actorId,
    updatedAt: new Date(),
  };

  if (existing.length > 0) {
    const updated = await db
      .update(quickbooksDocuments)
      .set(snapshot)
      .where(eq(quickbooksDocuments.id, existing[0]!.id))
      .returning();
    return updated[0]!;
  }

  const inserted = await db.insert(quickbooksDocuments).values(snapshot).returning();
  return inserted[0]!;
}

/**
 * Persist an allocation set against a QuickBooks Bill.
 *
 * Takes the Bill `id` only — the VAT / amount / vendor snapshot is re-derived
 * on the server via `getBillById` so the client cannot influence the stored
 * evidence amounts. Throws:
 *
 *   - `QuickBooksUnavailableError` if the realm is not configured.
 *   - `QuickBooksBillNotFoundError` if QB returns no Bill for the given Id.
 *   - An over-assignment `Error` when the allocation sum exceeds the
 *     ex-VAT amount plus tolerance (surface as 409 at the route boundary).
 */
export async function saveCostAllocationsForBill(params: {
  projectId: number | null;
  billId: string;
  allocations: QuickBooksCostAllocationInput[];
  actorId?: number | null;
}) {
  const realmId = (await loadQuickBooksMetadata()).realmId;
  if (!realmId) {
    throw new QuickBooksUnavailableError();
  }

  const rawBill = await getBillById(params.billId);
  if (!rawBill) {
    throw new QuickBooksBillNotFoundError(params.billId);
  }
  const bill = billRawToSummary(rawBill);

  const document = await upsertQuickBooksDocumentFromBill(
    params.projectId,
    bill,
    realmId,
    params.actorId ?? null,
  );

  const activeRows = await db
    .select()
    .from(quickbooksCostAllocations)
    .where(
      and(
        eq(quickbooksCostAllocations.quickbooksDocumentId, document.id),
        isNull(quickbooksCostAllocations.deletedAt),
      ),
    );

  let assignedExVat = 0;
  for (const row of params.allocations) assignedExVat += Math.max(0, Number(row.amountExVat || 0));
  assertNoOverAssignment(toMoney(document.qbAmountExVat), assignedExVat);

  // Soft-delete previous active rows for this document then insert fresh set.
  if (activeRows.length > 0) {
    await db
      .update(quickbooksCostAllocations)
      .set({ deletedAt: new Date(), status: "replaced", updatedAt: new Date() })
      .where(
        and(
          eq(quickbooksCostAllocations.quickbooksDocumentId, document.id),
          isNull(quickbooksCostAllocations.deletedAt),
        ),
      );
  }

  if (params.allocations.length > 0) {
    const inserts: QuickBooksCostAllocationInsert[] = params.allocations.map((a) => ({
      quickbooksDocumentId: document.id,
      projectId: params.projectId,
      costLineId: a.costLineId,
      amountExVat: Number(a.amountExVat).toFixed(2),
      matchType: "manual",
      status: "active",
      createdBy: params.actorId ?? null,
      approvedBy: params.actorId ?? null,
      approvedAt: new Date(),
    }));
    await db.insert(quickbooksCostAllocations).values(inserts);
  }

  const qbAmountExVat = toMoney(document.qbAmountExVat);
  const status = computeQbDocumentStatus(qbAmountExVat, assignedExVat, document.taxStatus === "TAX_UNCERTAIN");
  const remaining = qbAmountExVat === null ? null : Number(Math.max(0, qbAmountExVat - assignedExVat).toFixed(2));
  await db
    .update(quickbooksDocuments)
    .set({ assignmentStatus: status, updatedAt: new Date() })
    .where(eq(quickbooksDocuments.id, document.id));

  return {
    documentId: document.id,
    bill,
    assignedExVat: Number(assignedExVat.toFixed(2)),
    qbAmountExVat,
    remainingExVat: remaining,
    status,
    underAssigned: remaining !== null && remaining > QB_ASSIGNMENT_TOLERANCE_EX_VAT,
    taxUncertain: document.taxStatus === "TAX_UNCERTAIN",
  };
}

// ===================== MATCHING CORE =====================

export function matchCostLinesToBills(
  costLines: AppCostLineSummary[],
  bills: QuickBooksBillSummary[],
  links: QuickBooksInvoiceLink[],
): ReconciliationRow[] {
  const rows: ReconciliationRow[] = [];

  const billsById = new Map<string, QuickBooksBillSummary>();
  for (const b of bills) billsById.set(b.id, b);

  const costLinesById = new Map<number, AppCostLineSummary>();
  for (const c of costLines) costLinesById.set(c.id, c);

  const usedCostLineIds = new Set<number>();
  const usedBillIds = new Set<string>();

  // 1. Persistent links first (highest trust).
  for (const link of links) {
    if (link.appEntityType !== "cost_line" || link.qbEntityType !== "bill") continue;
    const cost = costLinesById.get(link.appEntityId) ?? null;
    const bill = billsById.get(link.qbEntityId) ?? null;
    if (!cost && !bill) continue;

    const variance =
      cost?.amountExVat !== null && cost?.amountExVat !== undefined &&
      bill?.totalAmount !== null && bill?.totalAmount !== undefined
        ? Number((bill!.totalAmount! - cost!.amountExVat!).toFixed(2))
        : null;

    rows.push({
      matchType: "linked",
      costLine: cost,
      bill,
      amountVariance: variance,
      hasWarning: variance !== null && Math.abs(variance) > AMOUNT_TOLERANCE,
      link,
    });
    if (cost) usedCostLineIds.add(cost.id);
    if (bill) usedBillIds.add(bill.id);
  }

  // 2. Exact invoice number + amount.
  for (const cost of costLines) {
    if (usedCostLineIds.has(cost.id)) continue;
    const normCost = normalizeInvoiceNumber(cost.invoiceNumber);
    if (!normCost) continue;

    const match = bills.find((b) => {
      if (usedBillIds.has(b.id)) return false;
      const normBill = normalizeInvoiceNumber(b.docNumber);
      if (!normBill || normBill !== normCost) return false;
      return amountsWithinTolerance(cost.amountExVat, b.totalAmount);
    });

    if (match) {
      const variance =
        cost.amountExVat !== null && match.totalAmount !== null
          ? Number((match.totalAmount - cost.amountExVat).toFixed(2))
          : null;
      rows.push({
        matchType: "auto_exact",
        costLine: cost,
        bill: match,
        amountVariance: variance,
        hasWarning: false,
        link: null,
      });
      usedCostLineIds.add(cost.id);
      usedBillIds.add(match.id);
    }
  }

  // 3. Fuzzy: vendor + amount tolerance + same month.
  for (const cost of costLines) {
    if (usedCostLineIds.has(cost.id)) continue;
    const normVendor = normalizeName(cost.counterpartyName);
    if (!normVendor) continue;

    const match = bills.find((b) => {
      if (usedBillIds.has(b.id)) return false;
      if (normalizeName(b.vendorName) !== normVendor) return false;
      if (!amountsWithinTolerance(cost.amountExVat, b.totalAmount)) return false;
      return sameMonth(cost.invoiceDate, b.txnDate);
    });

    if (match) {
      const variance =
        cost.amountExVat !== null && match.totalAmount !== null
          ? Number((match.totalAmount - cost.amountExVat).toFixed(2))
          : null;
      rows.push({
        matchType: "auto_fuzzy",
        costLine: cost,
        bill: match,
        amountVariance: variance,
        hasWarning: true,
        link: null,
      });
      usedCostLineIds.add(cost.id);
      usedBillIds.add(match.id);
    }
  }

  // 4. App-only.
  for (const cost of costLines) {
    if (usedCostLineIds.has(cost.id)) continue;
    rows.push({
      matchType: "app_only",
      costLine: cost,
      bill: null,
      amountVariance: null,
      hasWarning: true,
      link: null,
    });
  }

  // 5. QB-only.
  for (const bill of bills) {
    if (usedBillIds.has(bill.id)) continue;
    rows.push({
      matchType: "qb_only",
      costLine: null,
      bill,
      amountVariance: null,
      hasWarning: true,
      link: null,
    });
  }

  return rows;
}

export function buildSummary(rows: ReconciliationRow[]): ReconciliationSummary {
  let linked = 0;
  let exact = 0;
  let fuzzy = 0;
  let appOnly = 0;
  let qbOnly = 0;
  let totalApp = 0;
  let totalQb = 0;

  for (const row of rows) {
    switch (row.matchType) {
      case "linked":
        linked++;
        break;
      case "auto_exact":
        exact++;
        break;
      case "auto_fuzzy":
        fuzzy++;
        break;
      case "app_only":
        appOnly++;
        break;
      case "qb_only":
        qbOnly++;
        break;
    }
    if (row.costLine?.amountExVat !== null && row.costLine?.amountExVat !== undefined) {
      totalApp += row.costLine.amountExVat;
    }
    if (row.bill?.totalAmount !== null && row.bill?.totalAmount !== undefined) {
      totalQb += row.bill.totalAmount;
    }
  }

  return {
    linkedCount: linked,
    autoExactCount: exact,
    autoFuzzyCount: fuzzy,
    appOnlyCount: appOnly,
    qbOnlyCount: qbOnly,
    totalAppAmount: Number(totalApp.toFixed(2)),
    totalQbAmount: Number(totalQb.toFixed(2)),
    amountVariance: Number((totalQb - totalApp).toFixed(2)),
  };
}

// ===================== HIGH-LEVEL ORCHESTRATION =====================

export async function runProjectCostReconciliation(
  projectId: number,
  options: { startDate?: string; endDate?: string } = {},
): Promise<ReconciliationResult> {
  // Touch getValidAccessToken early so we fail fast with "not connected".
  await getValidAccessToken();

  const [rawBills, costLineRows] = await Promise.all([
    getBills(options.startDate, options.endDate),
    fetchProjectCostLines(projectId),
  ]);

  const bills: QuickBooksBillSummary[] = (
    rawBills?.QueryResponse?.Bill ?? []
  ).map(billRawToSummary);

  const costLines = costLineRows.map(costLineToSummary);
  const links = await fetchLinksForCostLines(costLines.map((c) => c.id));

  const rows = matchCostLinesToBills(costLines, bills, links);
  const summary = buildSummary(rows);

  return {
    projectId,
    summary,
    rows,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Snapshot a bill + cost line into a manual link. Used by the "Link" button
 * in the recon tab and by the global linking page.
 */
export async function confirmCostLineLink(params: {
  projectId: number | null;
  costLineId: number;
  bill: QuickBooksBillSummary;
  matchType?: "manual" | "auto_exact" | "auto_fuzzy";
  confirmedBy?: number | null;
  notes?: string | null;
  /** Realm to associate the link with. When omitted, falls back to current connection metadata. */
  qbRealmId?: string | null;
  /**
   * Per-link Rand allocation for Task #142 many-to-many. When omitted the
   * legacy 100%-of-bill behaviour is preserved (allocation defaults to
   * `bill.totalAmount`). Callers who supply this MUST also reconcile the
   * sibling group sum themselves (use `confirmLinksWithAllocations` for
   * the transactional path).
   */
  allocatedAmountExVat?: number | null;
}): Promise<QuickBooksInvoiceLink> {
  if (!params.bill?.id) {
    throw new QuickBooksApproveValidationError({
      reason: "qb_bill_id_missing",
      message: "QuickBooks bill is missing an Id — refresh QB data and try again.",
    });
  }
  return createOrUpdateLink({
    projectId: params.projectId,
    appEntityType: "cost_line",
    appEntityId: params.costLineId,
    qbEntityType: "bill",
    qbEntityId: params.bill.id,
    qbRealmId: params.qbRealmId ?? undefined,
    qbDocNumber: params.bill.docNumber ?? null,
    qbTxnDate: params.bill.txnDate ?? null,
    qbAmount: params.bill.totalAmount ?? null,
    qbCounterpartyName: params.bill.vendorName ?? null,
    matchType: params.matchType ?? "manual",
    notes: params.notes ?? null,
    confirmedBy: params.confirmedBy ?? null,
    allocatedAmountExVat: params.allocatedAmountExVat ?? null,
  });
}

/**
 * REMOVED: markCostLineRealised()
 *
 * This helper previously wrote `cos_realised = true` and
 * `paid_date_confirmed = true` directly on normalized_cost_lines from the
 * QuickBooks reconciliation view. It bypassed every canonical finance
 * control (period lock, invoice-number presence check, placeholder check,
 * invoice-date check, admin gate, audit trail, metric refresh).
 *
 * Marking a cost line as realised is now ONLY permitted through the
 * canonical finance control path:
 *   PATCH /api/cos-tracker/toggle-realised/:id
 * which is defined in server/departments/finance-routes.ts and enforces the
 * full realisation policy documented in
 * server/lib/finance/cos-realisation.ts (invoice + invoice-date confirmed).
 *
 * Do NOT reintroduce a QB-side realisation write. Reconciliation should
 * surface discrepancies, not mutate recognition state.
 */

// ===================== CUSTOMER MAPPING =====================

export interface ProjectWithMapping {
  projectId: number;
  projectName: string;
  clientId: number | null;
  mapping: QuickBooksCustomerMapping | null;
}

export async function listProjectsWithMappings(): Promise<ProjectWithMapping[]> {
  const [projects, mappings] = await Promise.all([
    db
      .select({
        id: projectInfo.id,
        projectName: projectInfo.projectName,
        clientId: projectInfo.clientId,
      })
      .from(projectInfo)
      .where(isNull(projectInfo.deletedAt)),
    db
      .select()
      .from(quickbooksCustomerMappings)
      .where(isNull(quickbooksCustomerMappings.deletedAt)),
  ]);

  const mappingByProject = new Map<number, QuickBooksCustomerMapping>();
  for (const m of mappings) mappingByProject.set(m.projectId, m);

  return (projects as Array<{ id: number; projectName: string; clientId: number | null }>).map(
    (p) => ({
      projectId: p.id,
      projectName: p.projectName,
      clientId: p.clientId ?? null,
      mapping: mappingByProject.get(p.id) ?? null,
    }),
  );
}

export async function getCustomerMappingForProject(
  projectId: number,
): Promise<QuickBooksCustomerMapping | null> {
  const rows = await db
    .select()
    .from(quickbooksCustomerMappings)
    .where(
      and(
        eq(quickbooksCustomerMappings.projectId, projectId),
        isNull(quickbooksCustomerMappings.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export interface UpsertCustomerMappingInput {
  projectId: number;
  clientId?: number | null;
  qbCustomerId: string;
  qbCustomerName?: string | null;
  qbRealmId?: string;
  notes?: string | null;
  createdBy?: number | null;
}

export async function upsertCustomerMapping(
  input: UpsertCustomerMappingInput,
): Promise<QuickBooksCustomerMapping> {
  const realmId =
    input.qbRealmId ?? ((await loadQuickBooksMetadata()).realmId ?? "unknown");

  const now = new Date();
  const values = {
    projectId: input.projectId,
    clientId: input.clientId ?? null,
    qbCustomerId: String(input.qbCustomerId),
    qbCustomerName: input.qbCustomerName ?? null,
    qbRealmId: realmId,
    notes: input.notes ?? null,
    createdBy: input.createdBy ?? null,
    updatedAt: now,
  };

  const existing = await db
    .select()
    .from(quickbooksCustomerMappings)
    .where(
      and(
        eq(quickbooksCustomerMappings.projectId, values.projectId),
        eq(quickbooksCustomerMappings.qbRealmId, values.qbRealmId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0]!;
    const updated = await db
      .update(quickbooksCustomerMappings)
      .set({ ...values, deletedAt: null } as any)
      .where(eq(quickbooksCustomerMappings.id, row.id))
      .returning();
    return updated[0]!;
  }

  const inserted = await db
    .insert(quickbooksCustomerMappings)
    .values(values as any)
    .returning();
  return inserted[0]!;
}

/**
 * Soft-delete a project ↔ customer mapping. Returns the previous row so
 * callers can log exactly what was unmapped in the audit trail. Returns
 * null if the mapping was already deleted or does not exist.
 */
export async function softDeleteCustomerMapping(
  id: number,
): Promise<QuickBooksCustomerMapping | null> {
  const existing = await db
    .select()
    .from(quickbooksCustomerMappings)
    .where(eq(quickbooksCustomerMappings.id, id))
    .limit(1);
  if (existing.length === 0) return null;
  const row = existing[0]!;
  if (row.deletedAt) return row;
  await db
    .update(quickbooksCustomerMappings)
    .set({ deletedAt: new Date(), updatedAt: new Date() } as any)
    .where(eq(quickbooksCustomerMappings.id, id));
  return row;
}

export interface UpsertVendorMappingInput {
  qbVendorId: string;
  qbVendorName?: string | null;
  qbRealmId: string;
  counterpartyId: number;
  counterpartyName?: string | null;
  notes?: string | null;
  createdBy?: number | null;
}

export interface UpsertVendorMappingResult {
  mapping: QuickBooksVendorMapping;
  /** True when an existing unlocked mapping was updated. */
  updated: boolean;
  /** True when the existing mapping has lockedAt set — caller must check before calling. */
  wasLocked: boolean;
}

/**
 * Upsert a QB vendor → counterparty mapping.
 *
 * Returns `wasLocked=true` without writing if the existing mapping is locked —
 * the caller is responsible for enforcing the admin-only override gate before
 * calling this function.
 */
export async function upsertVendorMapping(
  input: UpsertVendorMappingInput,
): Promise<UpsertVendorMappingResult> {
  const [existing] = await db
    .select()
    .from(quickbooksVendorMappings)
    .where(
      and(
        eq(quickbooksVendorMappings.qbVendorId, input.qbVendorId),
        eq(quickbooksVendorMappings.qbRealmId, input.qbRealmId),
        isNull(quickbooksVendorMappings.deletedAt),
      ),
    )
    .limit(1);

  if (existing?.lockedAt) {
    return { mapping: existing, updated: false, wasLocked: true };
  }

  if (existing) {
    const [updated] = await db
      .update(quickbooksVendorMappings)
      .set({
        counterpartyId: input.counterpartyId,
        counterpartyName: input.counterpartyName ?? null,
        qbVendorName: input.qbVendorName ?? null,
        notes: input.notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(quickbooksVendorMappings.id, existing.id))
      .returning();
    return { mapping: updated!, updated: true, wasLocked: false };
  }

  const [created] = await db
    .insert(quickbooksVendorMappings)
    .values({
      qbVendorId: input.qbVendorId,
      qbVendorName: input.qbVendorName ?? null,
      qbRealmId: input.qbRealmId,
      counterpartyId: input.counterpartyId,
      counterpartyName: input.counterpartyName ?? null,
      notes: input.notes ?? null,
      source: "suggestion",
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return { mapping: created!, updated: false, wasLocked: false };
}

// ===================== REVENUE (INVOICES) RECONCILIATION =====================

export interface QuickBooksInvoiceSummary {
  id: string;
  docNumber: string | null;
  txnDate: string | null;
  dueDate: string | null;
  totalAmount: number | null;
  balance: number | null;
  customerName: string | null;
  customerId: string | null;
}

export interface AppRevenueLineSummary {
  id: number;
  projectId: number;
  projectName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  paidDate: string | null;
  amountExVat: number | null;
  status: string | null;
  milestoneName: string | null;
  description: string | null;
}

export interface RevenueReconciliationRow {
  matchType: ReconciliationMatchType;
  revenueLine: AppRevenueLineSummary | null;
  invoice: QuickBooksInvoiceSummary | null;
  amountVariance: number | null;
  hasWarning: boolean;
  link: QuickBooksInvoiceLink | null;
}

export interface RevenueReconciliationResult {
  projectId: number;
  mapping: QuickBooksCustomerMapping | null;
  summary: ReconciliationSummary;
  rows: RevenueReconciliationRow[];
  generatedAt: string;
}

export function invoiceRawToSummary(raw: any): QuickBooksInvoiceSummary {
  const totalAmount = amountToNumber(raw?.TotalAmt);
  const totalTax = amountToNumber(raw?.TxnTaxDetail?.TotalTax);
  const totalExTax =
    totalAmount !== null && totalTax !== null
      ? Number((totalAmount - totalTax).toFixed(2))
      : totalAmount;
  return {
    id: String(raw?.Id ?? ""),
    docNumber: raw?.DocNumber ?? null,
    txnDate: raw?.TxnDate ?? null,
    dueDate: raw?.DueDate ?? null,
    totalAmount: totalExTax,
    balance: amountToNumber(raw?.Balance),
    customerName: raw?.CustomerRef?.name ?? null,
    customerId: raw?.CustomerRef?.value ?? null,
  };
}

/**
 * One row per QuickBooks Invoice line. Mirrors `billRawToLineRows` for the
 * revenue side — used by the Revenue Tracker Gap report to surface QB
 * invoices that exist in the GL but were never captured in the project
 * trackers (the source of truth). READ-ONLY — this never mutates QB or app
 * state and never modifies `normalized_revenue_lines`.
 *
 * Returns one synthetic header row when the invoice has no usable Line[] so
 * the caller can still see the invoice in the unmapped bucket.
 */
export interface QuickBooksInvoiceLineRow {
  invoiceId: string;
  docNumber: string | null;
  txnDate: string | null;
  customerName: string | null;
  customerId: string | null;
  lineId: string | null;
  lineNum: number | null;
  lineAmountExVat: number | null;
  classRefName: string | null;
  classRefId: string | null;
  itemRefName: string | null;
  itemRefId: string | null;
  description: string | null;
  balance: number | null;
}

export function invoiceRawToLineRows(raw: any): QuickBooksInvoiceLineRow[] {
  const invoiceId = String(raw?.Id ?? "");
  const docNumber = raw?.DocNumber ?? null;
  const txnDate = raw?.TxnDate ?? null;
  const customerName = raw?.CustomerRef?.name ?? null;
  const customerId = raw?.CustomerRef?.value ?? null;
  const balance = amountToNumber(raw?.Balance);

  const lines: any[] = Array.isArray(raw?.Line) ? raw.Line : [];
  const out: QuickBooksInvoiceLineRow[] = [];

  for (const line of lines) {
    const detailType = String(line?.DetailType ?? "");
    if (detailType !== "SalesItemLineDetail" && detailType !== "GroupLineDetail") {
      continue;
    }
    const detail = line?.SalesItemLineDetail ?? line?.GroupLineDetail ?? {};
    const amount = amountToNumber(line?.Amount);
    out.push({
      invoiceId,
      docNumber,
      txnDate,
      customerName,
      customerId,
      lineId: line?.Id ? String(line.Id) : null,
      lineNum: typeof line?.LineNum === "number" ? line.LineNum : null,
      lineAmountExVat: amount,
      classRefName: detail?.ClassRef?.name ?? null,
      classRefId: detail?.ClassRef?.value ?? null,
      itemRefName: detail?.ItemRef?.name ?? null,
      itemRefId: detail?.ItemRef?.value ?? null,
      description: line?.Description ?? null,
      balance,
    });
  }

  if (out.length === 0) {
    out.push({
      invoiceId,
      docNumber,
      txnDate,
      customerName,
      customerId,
      lineId: null,
      lineNum: null,
      lineAmountExVat: amountToNumber(raw?.TotalAmt),
      classRefName: null,
      classRefId: null,
      itemRefName: null,
      itemRefId: null,
      description: raw?.PrivateNote ?? "(synthetic header — invoice has no usable sales lines)",
      balance,
    });
  }

  return out;
}

export function revenueLineToSummary(row: NormalizedRevenueLine): AppRevenueLineSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName ?? null,
    invoiceNumber: row.invoiceNumber ?? null,
    invoiceDate: row.invoiceDate ? String(row.invoiceDate) : null,
    paidDate: row.paidDate ? String(row.paidDate) : null,
    amountExVat: amountToNumber(row.amountExVat),
    status: row.status ?? null,
    milestoneName: row.milestoneName ?? null,
    description: row.description ?? null,
  };
}

async function fetchProjectRevenueLines(projectId: number): Promise<NormalizedRevenueLine[]> {
  return db
    .select()
    .from(normalizedRevenueLines)
    .where(
      and(
        eq(normalizedRevenueLines.projectId, projectId),
        and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt)),
      ),
    );
}

async function fetchLinksForRevenueLines(
  revenueLineIds: number[],
): Promise<QuickBooksInvoiceLink[]> {
  if (revenueLineIds.length === 0) return [];
  return db
    .select()
    .from(quickbooksInvoiceLinks)
    .where(
      and(
        eq(quickbooksInvoiceLinks.appEntityType, "revenue_line"),
        eq(quickbooksInvoiceLinks.qbEntityType, "invoice"),
        isNull(quickbooksInvoiceLinks.deletedAt),
        inArray(quickbooksInvoiceLinks.appEntityId, revenueLineIds),
      ),
    );
}

async function queryInvoicesForCustomer(
  qbCustomerId: string,
  options: { startDate?: string; endDate?: string } = {},
): Promise<QuickBooksInvoiceSummary[]> {
  // Escape single quotes for the QB query language.
  const safeId = String(qbCustomerId).replace(/'/g, "''");
  const parts: string[] = [`SELECT * FROM Invoice WHERE CustomerRef = '${safeId}'`];
  if (options.startDate) parts.push(`AND TxnDate >= '${options.startDate}'`);
  if (options.endDate) parts.push(`AND TxnDate <= '${options.endDate}'`);
  parts.push("ORDERBY TxnDate DESC MAXRESULTS 500");
  const query = parts.join(" ");
  const result = await queryQuickBooks<any>("Invoice", query);
  const invoices: any[] = result?.QueryResponse?.Invoice ?? [];
  return invoices.map(invoiceRawToSummary);
}

function matchRevenueLinesToInvoices(
  revenueLines: AppRevenueLineSummary[],
  invoices: QuickBooksInvoiceSummary[],
  links: QuickBooksInvoiceLink[],
): RevenueReconciliationRow[] {
  const rows: RevenueReconciliationRow[] = [];
  const invoicesById = new Map<string, QuickBooksInvoiceSummary>();
  for (const inv of invoices) invoicesById.set(inv.id, inv);
  const revLinesById = new Map<number, AppRevenueLineSummary>();
  for (const r of revenueLines) revLinesById.set(r.id, r);

  const usedRevIds = new Set<number>();
  const usedInvoiceIds = new Set<string>();

  for (const link of links) {
    if (link.appEntityType !== "revenue_line" || link.qbEntityType !== "invoice") continue;
    const revLine = revLinesById.get(link.appEntityId) ?? null;
    const invoice = invoicesById.get(link.qbEntityId) ?? null;
    if (!revLine && !invoice) continue;

    const variance =
      revLine?.amountExVat !== null && revLine?.amountExVat !== undefined &&
      invoice?.totalAmount !== null && invoice?.totalAmount !== undefined
        ? Number((invoice!.totalAmount! - revLine!.amountExVat!).toFixed(2))
        : null;

    rows.push({
      matchType: "linked",
      revenueLine: revLine,
      invoice,
      amountVariance: variance,
      hasWarning: variance !== null && Math.abs(variance) > AMOUNT_TOLERANCE,
      link,
    });
    if (revLine) usedRevIds.add(revLine.id);
    if (invoice) usedInvoiceIds.add(invoice.id);
  }

  // Exact: invoice number + amount tolerance
  for (const rev of revenueLines) {
    if (usedRevIds.has(rev.id)) continue;
    const normRev = normalizeInvoiceNumber(rev.invoiceNumber);
    if (!normRev) continue;
    const match = invoices.find((inv) => {
      if (usedInvoiceIds.has(inv.id)) return false;
      const normInv = normalizeInvoiceNumber(inv.docNumber);
      if (!normInv || normInv !== normRev) return false;
      return amountsWithinTolerance(rev.amountExVat, inv.totalAmount);
    });
    if (match) {
      const variance =
        rev.amountExVat !== null && match.totalAmount !== null
          ? Number((match.totalAmount - rev.amountExVat).toFixed(2))
          : null;
      rows.push({
        matchType: "auto_exact",
        revenueLine: rev,
        invoice: match,
        amountVariance: variance,
        hasWarning: false,
        link: null,
      });
      usedRevIds.add(rev.id);
      usedInvoiceIds.add(match.id);
    }
  }

  // Fuzzy: amount tolerance + same month (customer is already scoped by mapping)
  for (const rev of revenueLines) {
    if (usedRevIds.has(rev.id)) continue;
    const match = invoices.find((inv) => {
      if (usedInvoiceIds.has(inv.id)) return false;
      if (!amountsWithinTolerance(rev.amountExVat, inv.totalAmount)) return false;
      return sameMonth(rev.invoiceDate, inv.txnDate);
    });
    if (match) {
      const variance =
        rev.amountExVat !== null && match.totalAmount !== null
          ? Number((match.totalAmount - rev.amountExVat).toFixed(2))
          : null;
      rows.push({
        matchType: "auto_fuzzy",
        revenueLine: rev,
        invoice: match,
        amountVariance: variance,
        hasWarning: true,
        link: null,
      });
      usedRevIds.add(rev.id);
      usedInvoiceIds.add(match.id);
    }
  }

  for (const rev of revenueLines) {
    if (usedRevIds.has(rev.id)) continue;
    rows.push({
      matchType: "app_only",
      revenueLine: rev,
      invoice: null,
      amountVariance: null,
      hasWarning: true,
      link: null,
    });
  }
  for (const inv of invoices) {
    if (usedInvoiceIds.has(inv.id)) continue;
    rows.push({
      matchType: "qb_only",
      revenueLine: null,
      invoice: inv,
      amountVariance: null,
      hasWarning: true,
      link: null,
    });
  }
  return rows;
}

function buildRevenueSummary(rows: RevenueReconciliationRow[]): ReconciliationSummary {
  let linked = 0;
  let exact = 0;
  let fuzzy = 0;
  let appOnly = 0;
  let qbOnly = 0;
  let totalApp = 0;
  let totalQb = 0;
  for (const row of rows) {
    switch (row.matchType) {
      case "linked": linked++; break;
      case "auto_exact": exact++; break;
      case "auto_fuzzy": fuzzy++; break;
      case "app_only": appOnly++; break;
      case "qb_only": qbOnly++; break;
    }
    if (row.revenueLine?.amountExVat !== null && row.revenueLine?.amountExVat !== undefined) {
      totalApp += row.revenueLine.amountExVat;
    }
    if (row.invoice?.totalAmount !== null && row.invoice?.totalAmount !== undefined) {
      totalQb += row.invoice.totalAmount;
    }
  }
  return {
    linkedCount: linked,
    autoExactCount: exact,
    autoFuzzyCount: fuzzy,
    appOnlyCount: appOnly,
    qbOnlyCount: qbOnly,
    totalAppAmount: Number(totalApp.toFixed(2)),
    totalQbAmount: Number(totalQb.toFixed(2)),
    amountVariance: Number((totalQb - totalApp).toFixed(2)),
  };
}

export async function runProjectRevenueReconciliation(
  projectId: number,
  options: { startDate?: string; endDate?: string } = {},
): Promise<RevenueReconciliationResult> {
  await getValidAccessToken();

  const mapping = await getCustomerMappingForProject(projectId);

  // No mapping → empty result with the mapping field null so the UI can
  // surface a "Map a customer to reconcile invoices" CTA.
  if (!mapping) {
    const revLineRows = await fetchProjectRevenueLines(projectId);
    const revenueLines = revLineRows.map(revenueLineToSummary);
    const appOnlyRows: RevenueReconciliationRow[] = revenueLines.map((rev) => ({
      matchType: "app_only",
      revenueLine: rev,
      invoice: null,
      amountVariance: null,
      hasWarning: true,
      link: null,
    }));
    return {
      projectId,
      mapping: null,
      summary: buildRevenueSummary(appOnlyRows),
      rows: appOnlyRows,
      generatedAt: new Date().toISOString(),
    };
  }

  const [invoices, revLineRows] = await Promise.all([
    queryInvoicesForCustomer(mapping.qbCustomerId, options),
    fetchProjectRevenueLines(projectId),
  ]);

  const revenueLines = revLineRows.map(revenueLineToSummary);
  const links = await fetchLinksForRevenueLines(revenueLines.map((r) => r.id));
  const rows = matchRevenueLinesToInvoices(revenueLines, invoices, links);
  const summary = buildRevenueSummary(rows);

  return {
    projectId,
    mapping,
    summary,
    rows,
    generatedAt: new Date().toISOString(),
  };
}

export async function confirmRevenueLineLink(params: {
  projectId: number | null;
  revenueLineId: number;
  invoice: QuickBooksInvoiceSummary;
  matchType?: "manual" | "auto_exact" | "auto_fuzzy";
  confirmedBy?: number | null;
  notes?: string | null;
  /** Realm to associate the link with. When omitted, falls back to current connection metadata. */
  qbRealmId?: string | null;
  /** Per-link Rand allocation for Task #142 many-to-many. See confirmCostLineLink. */
  allocatedAmountExVat?: number | null;
}): Promise<QuickBooksInvoiceLink> {
  if (!params.invoice?.id) {
    throw new QuickBooksApproveValidationError({
      reason: "qb_invoice_id_missing",
      message: "QuickBooks invoice is missing an Id — refresh QB data and try again.",
    });
  }

  // Prefer the realmId carried on the suggestion so the link and the
  // mirrored quickbooks_documents row are stored under the SAME realm even
  // if the active connection metadata flips mid-request. Falling back to
  // metadata keeps the legacy callers (manual link, recon UI) working.
  const realmId =
    params.qbRealmId ?? (await loadQuickBooksMetadata()).realmId ?? null;

  const link = await createOrUpdateLink({
    projectId: params.projectId,
    appEntityType: "revenue_line",
    appEntityId: params.revenueLineId,
    qbEntityType: "invoice",
    qbEntityId: params.invoice.id,
    qbRealmId: realmId ?? undefined,
    qbDocNumber: params.invoice.docNumber ?? null,
    qbTxnDate: params.invoice.txnDate ?? null,
    qbAmount: params.invoice.totalAmount ?? null,
    qbCounterpartyName: params.invoice.customerName ?? null,
    matchType: params.matchType ?? "manual",
    notes: params.notes ?? null,
    confirmedBy: params.confirmedBy ?? null,
    allocatedAmountExVat: params.allocatedAmountExVat ?? null,
  });

  if (realmId) {
    await upsertQuickBooksDocumentFromInvoice(
      params.projectId,
      params.invoice,
      realmId,
      params.confirmedBy ?? null,
    );
  }

  return link;
}
