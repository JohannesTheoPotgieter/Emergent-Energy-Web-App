import { eq, and, isNull } from "drizzle-orm";
import { softCloseByProjectName } from "../lib/temporal-helpers";
import {
  normalizedRevenueLines, projectInfo,
  type ProgramInflows, type InsertProgramInflows,
} from "@shared/schema";
import { db } from "../db";

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
      this.dbInstance.select().from(normalizedRevenueLines).where(isNull(normalizedRevenueLines.effectiveTo)),
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
      this.dbInstance.select().from(normalizedRevenueLines).where(isNull(normalizedRevenueLines.effectiveTo)),
      this.dbInstance.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo),
    ]);
    const resolve = createNameResolver(piRows.map((r: any) => r.projectName));
    return resolveRevenueRowProjectNames(revLines as any[], piRows as any[], "[getAllRevenueLinesForCashflow]")
      .map(({ row, name }) => adaptRevenueToInflow(row, resolve(name)));
  }

  async getProgramInflowsByProject(projectName: string): Promise<any[]> {
    const { adaptRevenueToInflow } = await import("../lib/data-merge");
    // Resolve project_id for the requested name so we also catch legacy rows
    // where project_name is NULL but project_id is set.
    const projectMatches = await this.dbInstance.select({ id: projectInfo.id })
      .from(projectInfo)
      .where(eq(projectInfo.projectName, projectName));
    const projectIds = projectMatches.map((p: { id: number }) => p.id);

    const allActive = await this.dbInstance.select().from(normalizedRevenueLines)
      .where(isNull(normalizedRevenueLines.effectiveTo));

    const matched = (allActive as any[]).filter((r: any) => {
      if (typeof r.projectName === "string" && r.projectName.length > 0 && r.projectName === projectName) {
        return true;
      }
      if (r.projectId != null && projectIds.includes(r.projectId)) {
        return true;
      }
      return false;
    });

    return matched.map((r: any) => adaptRevenueToInflow(r, projectName));
  }

  async updateProgramInflowFields(id: number, fields: Record<string, any>): Promise<any | undefined> {
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
      .where(eq(normalizedRevenueLines.id, canonicalId))
      .returning();
    if (!result[0]) return undefined;
    const { adaptRevenueToInflow } = await import("../lib/data-merge");
    return adaptRevenueToInflow(result[0], result[0].projectName);
  }

  async createManyProgramInflows(inflowList: InsertProgramInflows[]): Promise<ProgramInflows[]> {
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
    const { adaptRevenueToInflow } = await import("../lib/data-merge");
    return results.map((r: any) => adaptRevenueToInflow(r, r.projectName)) as any;
  }

  async deleteProgramInflowsByProject(projectName: string): Promise<void> {
    // Temporal: soft-close instead of hard delete (Prompt 10)
    await softCloseByProjectName(this.dbInstance, "normalized_revenue_lines", projectName);
  }
}
