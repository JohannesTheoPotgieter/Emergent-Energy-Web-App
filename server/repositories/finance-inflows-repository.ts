import { eq, and, desc, ilike, isNull, or, inArray, sql } from "drizzle-orm";
import { softCloseByProjectName } from "../lib/temporal-helpers";
import { logAudit } from "../audit-logger";
import {
  normalizedRevenueLines, projectInfo, smartImportRuns,
  type ProgramInflows, type InsertProgramInflows,
} from "@shared/schema";
import { db } from "../db";

interface AuditCtx {
  userId?: number;
  userName?: string;
  actorRole?: string;
}

/**
 * Resolve a project name for every revenue-line row, falling back from the
 * row's own project_name TEXT column to a project_id → project_info lookup.
 *
 * Background: the database has a large population of legacy NRL rows
 * imported before normalized_revenue_lines.project_name was tightened to
 * NOT NULL. Those rows carry a valid project_id FK but a NULL project_name
 * text value. The previous filter dropped them entirely, which made the
 * cashflow Total Inflows card show only ~5% of the real value.
 *
 * This helper:
 *   1. Builds a Map<id, name> from project_info
 *   2. For each NRL row: prefer row.projectName, fall back to map lookup by
 *      row.projectId
 *   3. Skips only the rows that are TRULY orphan (no name AND no id match)
 *   4. Logs both the orphan count and the count of rows resolved via the
 *      project_id fallback so we can monitor the legacy-data footprint
 *
 * Returns an array of { row, name } pairs ready for adaptRevenueToInflow.
 */
function resolveRevenueRowProjectNames(
  revLines: any[],
  piRows: Array<{ id: number; projectName: string | null }>,
  logTag: string,
): Array<{ row: any; name: string }> {
  const idToName = new Map<number, string>();
  for (const p of piRows) {
    if (p.id != null && typeof p.projectName === "string" && p.projectName.length > 0) {
      idToName.set(p.id, p.projectName);
    }
  }

  const out: Array<{ row: any; name: string }> = [];
  let resolvedFromId = 0;
  let trulyOrphan = 0;
  for (const r of revLines) {
    let name: string | null = null;
    if (typeof r.projectName === "string" && r.projectName.length > 0) {
      name = r.projectName;
    } else if (r.projectId != null) {
      const fallback = idToName.get(r.projectId);
      if (fallback) {
        name = fallback;
        resolvedFromId++;
      }
    }
    if (!name) {
      trulyOrphan++;
      continue;
    }
    out.push({ row: r, name });
  }

  if (trulyOrphan > 0 || resolvedFromId > 0) {
    console.warn(
      `${logTag} processed ${revLines.length} rev rows: ${out.length} attributed (${resolvedFromId} resolved via project_id fallback), ${trulyOrphan} truly orphan (no project_name and no project_id match)`,
    );
  }

  return out;
}

export class FinanceInflowsRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  /**
   * Misleading-name alias kept for the ~15 existing call sites that still
   * read inflows via the legacy "ProgramInflows" identifier. The actual
   * source is `normalized_revenue_lines` with the snapshot guard applied —
   * identical to {@link getAllRevenueLinesForCashflow}. New call sites
   * should use that method instead so the source is obvious at the call.
   * @deprecated Use {@link getAllRevenueLinesForCashflow} instead.
   */
  async getAllProgramInflows(): Promise<any[]> {
    return this.getAllRevenueLinesForCashflow();
  }

  async getAllRevenueLinesForCashflow(): Promise<any[]> {
    // Canonical read: normalized_revenue_lines only, no promoted fallback complexity.
    // Aligns cashflow inflow reads with the canonical source.
    const { adaptRevenueToInflow, createNameResolver } = await import("../lib/data-merge");
    const [revLines, piRows] = await Promise.all([
      this.dbInstance.select().from(normalizedRevenueLines).where(and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt))),
      this.dbInstance.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo),
    ]);

    // Resolve snapshotRunId → committedAt so the per-row Stale badge uses the
    // actual import run timestamp, not createdAt (which never changes for stable rows).
    const runIds = [...new Set(
      (revLines as any[]).map((r: any) => r.snapshotRunId).filter((id: any) => id != null) as number[],
    )];
    const committedAtByRunId = new Map<number, string | null>();
    if (runIds.length > 0) {
      const runRows = await this.dbInstance
        .select({ id: smartImportRuns.id, committedAt: smartImportRuns.committedAt })
        .from(smartImportRuns)
        .where(inArray(smartImportRuns.id, runIds));
      for (const r of runRows) {
        committedAtByRunId.set(r.id, r.committedAt ? new Date(r.committedAt).toISOString() : null);
      }
    }
    const revLinesWithTs = (revLines as any[]).map((r: any) => ({
      ...r,
      snapshotRunCommittedAt: committedAtByRunId.get(r.snapshotRunId) ?? null,
    }));

    const resolve = createNameResolver(piRows.map((r: any) => r.projectName));
    return resolveRevenueRowProjectNames(revLinesWithTs, piRows as any[], "[getAllRevenueLinesForCashflow]")
      .map(({ row, name }) => adaptRevenueToInflow(row, resolve(name)));
  }

  async getProgramInflowsByProject(projectName: string, opts?: { applyOverrides?: boolean }): Promise<any[]> {
    const byName = await this.listProgramInflowsByProjectNames([projectName], opts);
    return byName.get(projectName) ?? [];
  }

  /**
   * Finance PR 3 (Tier 3) — batched cousin of `getProgramInflowsByProject`.
   *
   * Loads the inflow rows for many project names in a fixed 2 queries
   * (project_info name-variant lookup + normalized_revenue_lines fetch),
   * vs. the N×2 round-trips the per-project caller does inside a `for`
   * loop. Used by `POST /api/revenue-tracking/overrides` (5887 + 5973
   * paths) and the legacy fallback in
   * `server/routes/finance-legacy-extracted-routes.ts`.
   *
   * The returned map is keyed by the CALLER-SUPPLIED projectName so
   * baseline-diff handlers can look up by input key without re-resolving
   * variants.
   */
  async listProgramInflowsByProjectNames(
    projectNames: string[],
    opts?: { applyOverrides?: boolean },
  ): Promise<Map<string, any[]>> {
    const result = new Map<string, any[]>();
    const uniqueNames = Array.from(new Set(projectNames.filter((n): n is string => typeof n === "string" && n.length > 0)));
    if (uniqueNames.length === 0) return result;

    const { adaptRevenueToInflow } = await import("../lib/data-merge");

    // Build all name variants and a reverse-map so we can group results back
    // to the caller's input names.
    const variantToInput = new Map<string, string[]>();
    const allVariants: string[] = [];
    for (const inputName of uniqueNames) {
      const baseName = inputName.replace(/_Tracker$/i, "").trim();
      const variants = Array.from(new Set([inputName, baseName, `${baseName}_Tracker`]));
      for (const v of variants) {
        if (!variantToInput.has(v)) variantToInput.set(v, []);
        variantToInput.get(v)!.push(inputName);
        allVariants.push(v);
      }
    }
    const uniqueVariants = Array.from(new Set(allVariants));

    // 1. Resolve project IDs once.
    const projectMatches = await this.dbInstance.select({
      id: projectInfo.id,
      projectName: projectInfo.projectName,
    })
      .from(projectInfo)
      .where(inArray(projectInfo.projectName, uniqueVariants));
    const projectIdToVariant = new Map<number, string>();
    for (const p of projectMatches) {
      if (p.projectName) projectIdToVariant.set(p.id, p.projectName);
    }
    const projectIds = projectMatches.map((p: { id: number }) => p.id);

    // 2. One fetch for all matching revenue lines.
    const projectIdFilter = projectIds.length > 0
      ? inArray(normalizedRevenueLines.projectId, projectIds)
      : sql`FALSE`;
    const matched = await this.dbInstance.select().from(normalizedRevenueLines)
      .where(and(
        isNull(normalizedRevenueLines.effectiveTo),
        isNull(normalizedRevenueLines.deletedAt),
        or(inArray(normalizedRevenueLines.projectName, uniqueVariants), projectIdFilter),
      ));

    // Optional read-side overlay (workstream B).
    let rawRows = matched as any[];
    if (opts?.applyOverrides) {
      const { applyOverridesOverlay } = await import("../lib/manual-overrides");
      const { REVENUE_TRACKED_FIELDS } = await import("@shared/excel-vs-app/contract");
      rawRows = applyOverridesOverlay(rawRows, REVENUE_TRACKED_FIELDS);
    }

    // 3. Group by caller-supplied input name. A row may belong to multiple
    // input names if the caller passed both "Mondi" and "Mondi_Tracker";
    // emit once per matched input, with `adaptRevenueToInflow` invoked with
    // the input name so downstream readers see a stable key.
    for (const inputName of uniqueNames) result.set(inputName, []);
    for (const row of rawRows) {
      const owningVariant = (typeof row.projectName === "string" && row.projectName)
        ? row.projectName
        : (row.projectId != null ? projectIdToVariant.get(row.projectId) : undefined);
      const inputs = owningVariant ? (variantToInput.get(owningVariant) ?? []) : [];
      for (const inputName of inputs) {
        result.get(inputName)!.push(adaptRevenueToInflow(row, inputName));
      }
    }
    return result;
  }

  async updateProgramInflowFields(id: number, fields: Record<string, any>, audit?: AuditCtx): Promise<any | undefined> {
    const fieldMap: Record<string, string> = {
      milestoneInvoiceNumber: 'invoiceNumber',
      invoiceRaisedDate: 'invoiceDate',
      paymentReceivedDate: 'paidDate',
      plannedPaymentDate: 'expectedPaymentDate',
      milestoneAmount: 'amountExVat',
      milestoneName: 'milestoneName',
      milestoneNotes: 'description',
      invoiceDateFontColor: 'invoiceDateFontColor',
      invoiceDateConfirmed: 'invoiceDateConfirmed',
      paidDateFontColor: 'paidDateFontColor',
      paidDateConfirmed: 'paidDateConfirmed',
      inBankDate: 'inBankDate',
    };
    const mappedFields: Record<string, any> = {};
    for (const [key, value] of Object.entries(fields)) {
      const mapped = fieldMap[key] || key;
      mappedFields[mapped] = value;
    }
    if (Object.keys(mappedFields).length === 0) return undefined;
    const canonicalId = id < 0 ? -id : (id >= 900000 ? id - 900000 : id);
    const result = await this.dbInstance
      .update(normalizedRevenueLines)
      .set(mappedFields)
      .where(and(
        eq(normalizedRevenueLines.id, canonicalId),
        isNull(normalizedRevenueLines.effectiveTo),
      ))
      .returning();
    if (!result[0]) return undefined;
    logAudit({
      ...audit,
      entityType: "revenue_line",
      entityId: String(canonicalId),
      action: "update",
      source: "UI",
      changesJson: { fields: mappedFields, projectName: result[0].projectName ?? null },
    }).catch(() => {});
    const { adaptRevenueToInflow } = await import("../lib/data-merge");
    return adaptRevenueToInflow(result[0], result[0].projectName);
  }

  async createManyProgramInflows(inflowList: InsertProgramInflows[], audit?: AuditCtx): Promise<ProgramInflows[]> {
    if (inflowList.length === 0) return [];
    const mapped = inflowList.map((i: any) => ({
      projectName: i.projectName,
      milestoneName: i.milestoneName || null,
      description: i.milestoneName || null,
      amountExVat: i.milestoneAmount?.toString() || null,
      invoiceNumber: i.milestoneInvoiceNumber || null,
      invoiceDate: i.invoiceRaisedDate || null,
      expectedPaymentDate: i.plannedPaymentDate || null,
      paidDate: i.paymentReceivedDate || null,
      sourceRow: i.rowNumber || null,
      importRunId: 0,
    }));
    const results = await this.dbInstance.insert(normalizedRevenueLines).values(mapped).returning();
    logAudit({
      ...audit,
      entityType: "revenue_line",
      action: "bulk_import",
      source: "IMPORT",
      changesJson: { count: results.length, projectName: (inflowList[0] as any)?.projectName ?? null },
    }).catch(() => {});
    const { adaptRevenueToInflow } = await import("../lib/data-merge");
    return results.map((r: any) => adaptRevenueToInflow(r, r.projectName)) as any;
  }

  async deleteProgramInflowsByProject(projectName: string): Promise<void> {
    // Temporal: soft-close instead of hard delete (Prompt 10)
    await softCloseByProjectName(this.dbInstance, "normalized_revenue_lines", projectName);
  }

  /**
   * All current revenue-line rows. Filters historical snapshots
   * (`isNull(effectiveTo)`) and soft-deletes. Used by report builders
   * that need the full active population (raw row shape).
   */
  async listAllActiveRevenueLines(): Promise<Array<typeof normalizedRevenueLines.$inferSelect>> {
    return this.dbInstance
      .select()
      .from(normalizedRevenueLines)
      .where(and(
        isNull(normalizedRevenueLines.effectiveTo),
        isNull(normalizedRevenueLines.deletedAt),
      ));
  }

  // ── QB invoice-matching reads (active rows only) ──

  async getRevenueLineForMatching(id: number): Promise<{
    id: number;
    projectId: number | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    amountExVat: string | null;
    projectName: string | null;
    description: string | null;
    milestoneName: string | null;
  } | null> {
    const [row] = await this.dbInstance
      .select({
        id: normalizedRevenueLines.id,
        projectId: normalizedRevenueLines.projectId,
        invoiceNumber: normalizedRevenueLines.invoiceNumber,
        invoiceDate: normalizedRevenueLines.invoiceDate,
        amountExVat: normalizedRevenueLines.amountExVat,
        projectName: normalizedRevenueLines.projectName,
        description: normalizedRevenueLines.description,
        milestoneName: normalizedRevenueLines.milestoneName,
      })
      .from(normalizedRevenueLines)
      .where(
        and(
          eq(normalizedRevenueLines.id, id),
          isNull(normalizedRevenueLines.effectiveTo),
          isNull(normalizedRevenueLines.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async getRevenueLineProjectId(id: number): Promise<number | null> {
    const [row] = await this.dbInstance
      .select({ projectId: normalizedRevenueLines.projectId })
      .from(normalizedRevenueLines)
      .where(
        and(
          eq(normalizedRevenueLines.id, id),
          isNull(normalizedRevenueLines.effectiveTo),
        ),
      )
      .limit(1);
    return row?.projectId ?? null;
  }

  async searchRevenueLinesByText(
    query: string,
    projectId: number | null,
    limit: number,
  ): Promise<Array<{
    id: number;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    amountExVat: string | null;
    projectId: number | null;
    projectName: string | null;
  }>> {
    const like = `%${query}%`;
    return this.dbInstance
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
  }

  async listActiveRevenueLineProjectNames(): Promise<Array<{ name: string | null }>> {
    return this.dbInstance
      .select({ name: normalizedRevenueLines.projectName })
      .from(normalizedRevenueLines)
      .where(and(
        isNull(normalizedRevenueLines.effectiveTo),
        isNull(normalizedRevenueLines.deletedAt),
      ));
  }

  async listActiveRevenueLinesForTrackerGap(): Promise<Array<{
    id: number;
    projectName: string | null;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    amountExVat: string | null;
  }>> {
    return this.dbInstance
      .select({
        id: normalizedRevenueLines.id,
        projectName: normalizedRevenueLines.projectName,
        invoiceNumber: normalizedRevenueLines.invoiceNumber,
        invoiceDate: normalizedRevenueLines.invoiceDate,
        amountExVat: normalizedRevenueLines.amountExVat,
      })
      .from(normalizedRevenueLines)
      .where(and(
        isNull(normalizedRevenueLines.effectiveTo),
        isNull(normalizedRevenueLines.deletedAt),
      ));
  }

  async updateRevenueLineAdminDateOverride(
    inflowId: number,
    fields: {
      adminDateOverride: string | null;
      adminDateOverrideReason: string | null;
      adminDateOverrideBy: number | null;
      adminDateOverrideAt: Date | null;
    },
  ): Promise<typeof normalizedRevenueLines.$inferSelect | null> {
    const [updated] = await this.dbInstance
      .update(normalizedRevenueLines)
      .set(fields)
      .where(and(
        eq(normalizedRevenueLines.id, inflowId),
        isNull(normalizedRevenueLines.effectiveTo),
        isNull(normalizedRevenueLines.deletedAt),
      ))
      .returning();
    return updated ?? null;
  }

  /**
   * Snapshot of date columns + project context a period-lock check needs
   * before a write. Returns null when the row is historical or deleted.
   * Effective date = adminDateOverride ?? paidDate ?? inBankDate ?? invoiceDate.
   */
  async getRevenueLineForLockCheck(id: number): Promise<{
    id: number;
    projectId: number | null;
    projectName: string | null;
    invoiceDate: string | null;
    paidDate: string | null;
    inBankDate: string | null;
    adminDateOverride: string | null;
  } | null> {
    const [row] = await this.dbInstance
      .select({
        id: normalizedRevenueLines.id,
        projectId: normalizedRevenueLines.projectId,
        projectName: normalizedRevenueLines.projectName,
        invoiceDate: normalizedRevenueLines.invoiceDate,
        paidDate: normalizedRevenueLines.paidDate,
        inBankDate: normalizedRevenueLines.inBankDate,
        adminDateOverride: normalizedRevenueLines.adminDateOverride,
      })
      .from(normalizedRevenueLines)
      .where(and(
        eq(normalizedRevenueLines.id, id),
        isNull(normalizedRevenueLines.effectiveTo),
        isNull(normalizedRevenueLines.deletedAt),
      ))
      .limit(1);
    return row ?? null;
  }

  /**
   * Sync inBank state by (projectName, sourceRow). Used when finance
   * tracker overrides flip a milestone's paid state and the canonical
   * column needs to mirror the new state.
   */
  async updateInBankByProjectAndRow(args: {
    projectName: string;
    sourceRow: number;
    paidDateConfirmed: boolean;
    paidDateFontColor: string;
    paidDate: string | null;
    inBankDate: string | null;
  }): Promise<void> {
    await this.dbInstance
      .update(normalizedRevenueLines)
      .set({
        paidDateConfirmed: args.paidDateConfirmed,
        paidDateFontColor: args.paidDateFontColor,
        paidDate: args.paidDate,
        inBankDate: args.inBankDate,
      })
      .where(and(
        eq(normalizedRevenueLines.projectName, args.projectName),
        eq(normalizedRevenueLines.sourceRow, args.sourceRow),
        isNull(normalizedRevenueLines.effectiveTo),
      ));
  }

  async updatePaidDateFontColorById(id: number, paidDateFontColor: string): Promise<void> {
    await this.dbInstance
      .update(normalizedRevenueLines)
      .set({ paidDateFontColor })
      .where(and(
        eq(normalizedRevenueLines.id, id),
        isNull(normalizedRevenueLines.effectiveTo),
      ));
  }
}
