import { eq, and, isNull, or, inArray, sql } from "drizzle-orm";
import { softCloseByProjectName } from "../lib/temporal-helpers";
import { logAudit } from "../audit-logger";
import {
  normalizedRevenueLines, projectInfo,
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

  async getAllProgramInflows(): Promise<any[]> {
    const { adaptRevenueToInflow, createNameResolver } = await import("../lib/data-merge");
    const [revLines, piRows] = await Promise.all([
      this.dbInstance.select().from(normalizedRevenueLines).where(and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt))),
      this.dbInstance.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo),
    ]);
    const resolve = createNameResolver(piRows.map((r: any) => r.projectName));
    return resolveRevenueRowProjectNames(revLines as any[], piRows as any[], "[getAllProgramInflows]")
      .map(({ row, name }) => adaptRevenueToInflow(row, resolve(name)));
  }

  async getAllRevenueLinesForCashflow(): Promise<any[]> {
    // Canonical read: normalized_revenue_lines only, no promoted fallback complexity.
    // Aligns cashflow inflow reads with the canonical source.
    const { adaptRevenueToInflow, createNameResolver } = await import("../lib/data-merge");
    const [revLines, piRows] = await Promise.all([
      this.dbInstance.select().from(normalizedRevenueLines).where(and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt))),
      this.dbInstance.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo),
    ]);
    const resolve = createNameResolver(piRows.map((r: any) => r.projectName));
    return resolveRevenueRowProjectNames(revLines as any[], piRows as any[], "[getAllRevenueLinesForCashflow]")
      .map(({ row, name }) => adaptRevenueToInflow(row, resolve(name)));
  }

  async getProgramInflowsByProject(projectName: string, opts?: { applyOverrides?: boolean }): Promise<any[]> {
    const { adaptRevenueToInflow } = await import("../lib/data-merge");
    // Build all name variants so "Mondi" and "Mondi_Tracker" resolve to the
    // same row set. Strip _Tracker suffix, then include both bare and suffixed
    // forms to cover rows stored under either spelling.
    const baseName = projectName.replace(/_Tracker$/i, "").trim();
    const nameVariants = Array.from(new Set([projectName, baseName, `${baseName}_Tracker`]));

    // Resolve project IDs for all variants to also catch legacy rows where
    // project_name is NULL but project_id is set.
    const projectMatches = await this.dbInstance.select({ id: projectInfo.id })
      .from(projectInfo)
      .where(inArray(projectInfo.projectName, nameVariants));
    const projectIds = projectMatches.map((p: { id: number }) => p.id);

    const projectIdFilter = projectIds.length > 0
      ? inArray(normalizedRevenueLines.projectId, projectIds)
      : sql`FALSE`;

    const matched = await this.dbInstance.select().from(normalizedRevenueLines)
      .where(and(
        isNull(normalizedRevenueLines.effectiveTo),
        isNull(normalizedRevenueLines.deletedAt),
        or(inArray(normalizedRevenueLines.projectName, nameVariants), projectIdFilter),
      ));

    // Optional read-side overlay (workstream B). When enabled, applies
    // manual_overrides on top of the live column for tracked revenue
    // fields BEFORE adaptRevenueToInflow runs, so the adapter's derived
    // fields (e.g. inBank computation) react to the operator's edits.
    let rawRows = matched as any[];
    if (opts?.applyOverrides) {
      const { applyOverridesOverlay } = await import("../lib/manual-overrides");
      const { REVENUE_TRACKED_FIELDS } = await import("@shared/excel-vs-app/contract");
      rawRows = applyOverridesOverlay(rawRows, REVENUE_TRACKED_FIELDS);
    }

    return rawRows.map((r: any) => adaptRevenueToInflow(r, projectName));
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
}
