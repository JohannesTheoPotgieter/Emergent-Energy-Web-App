// ============================================================
// Finance audit-export repository
//
// Data-access layer for the auditor-prep CSV exports in
// server/routes/finance-audit-export.routes.ts. Keeps the snapshot reads
// out of the route handler (CLAUDE.md repository-layer rule) while leaving
// CSV shaping + audit logging in the route.
//
// HARD invariant (docs/AGENT_GUARDRAILS.md § 3.1): every read against the
// finance snapshot tables filters `isNull(effectiveTo)` so historical rows
// are never double-counted. Guards here are preserved verbatim from the
// original route queries — do not drop them.
// ============================================================

import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  normalizedCostLines,
  normalizedRevenueLines,
  projectInfo,
} from "@shared/schema";

export class FinanceAuditExportRepository {
  private _dbInstance?: typeof db;

  constructor(dbInstance?: typeof db) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): typeof db {
    return this._dbInstance || db;
  }

  /** AR — revenue lines invoiced within [fyStartIso, fyEndIso]. */
  async getInvoiceArLines(fyStartIso: string, fyEndIso: string) {
    return this.dbInstance
      .select({
        projectId: normalizedRevenueLines.projectId,
        projectName: projectInfo.projectName,
        invoiceNumber: normalizedRevenueLines.invoiceNumber,
        invoiceDate: normalizedRevenueLines.invoiceDate,
        paidDate: normalizedRevenueLines.paidDate,
        milestoneName: normalizedRevenueLines.milestoneName,
        description: normalizedRevenueLines.description,
        amountExVat: normalizedRevenueLines.amountExVat,
        vat: normalizedRevenueLines.vat,
        status: normalizedRevenueLines.status,
        sourceSheet: normalizedRevenueLines.sourceSheet,
      })
      .from(normalizedRevenueLines)
      .leftJoin(projectInfo, eq(normalizedRevenueLines.projectId, projectInfo.id))
      .where(
        and(
          isNull(normalizedRevenueLines.effectiveTo),
          isNull(normalizedRevenueLines.deletedAt),
          gte(normalizedRevenueLines.invoiceDate, fyStartIso),
          lte(normalizedRevenueLines.invoiceDate, fyEndIso),
        ),
      );
  }

  /** AP — cost lines invoiced within [fyStartIso, fyEndIso], with PO linkage. */
  async getInvoiceApLines(fyStartIso: string, fyEndIso: string) {
    return this.dbInstance
      .select({
        projectId: normalizedCostLines.projectId,
        projectName: projectInfo.projectName,
        invoiceNumber: normalizedCostLines.invoiceNumber,
        invoiceDate: normalizedCostLines.invoiceDate,
        paidDate: normalizedCostLines.paidDate,
        counterpartyName: normalizedCostLines.counterpartyName,
        description: normalizedCostLines.description,
        amountExVat: normalizedCostLines.amountExVat,
        poNumber: normalizedCostLines.poNumber,
        status: normalizedCostLines.status,
        sourceSheet: normalizedCostLines.sourceSheet,
      })
      .from(normalizedCostLines)
      .leftJoin(projectInfo, eq(normalizedCostLines.projectId, projectInfo.id))
      .where(
        and(
          isNull(normalizedCostLines.effectiveTo),
          isNull(normalizedCostLines.deletedAt),
          gte(normalizedCostLines.invoiceDate, fyStartIso),
          lte(normalizedCostLines.invoiceDate, fyEndIso),
        ),
      );
  }

  /**
   * Revenue milestones — lines whose invoice OR realisation (paid) date
   * falls within [fyStartIso, fyEndIso].
   */
  async getRevenueMilestoneLines(fyStartIso: string, fyEndIso: string) {
    return this.dbInstance
      .select({
        projectId: normalizedRevenueLines.projectId,
        projectName: projectInfo.projectName,
        milestoneNo: normalizedRevenueLines.milestoneNo,
        milestoneName: normalizedRevenueLines.milestoneName,
        milestonePercent: normalizedRevenueLines.milestonePercent,
        description: normalizedRevenueLines.description,
        invoiceNumber: normalizedRevenueLines.invoiceNumber,
        invoiceDate: normalizedRevenueLines.invoiceDate,
        expectedPaymentDate: normalizedRevenueLines.expectedPaymentDate,
        paidDate: normalizedRevenueLines.paidDate,
        inBankDate: normalizedRevenueLines.inBankDate,
        amountExVat: normalizedRevenueLines.amountExVat,
        vat: normalizedRevenueLines.vat,
        status: normalizedRevenueLines.status,
        writeOffAuthorisedAt: normalizedRevenueLines.writeOffAuthorisedAt,
        writeOffReason: normalizedRevenueLines.writeOffReason,
        disputeOpenedAt: normalizedRevenueLines.disputeOpenedAt,
        disputeReason: normalizedRevenueLines.disputeReason,
      })
      .from(normalizedRevenueLines)
      .leftJoin(projectInfo, eq(normalizedRevenueLines.projectId, projectInfo.id))
      .where(
        and(
          isNull(normalizedRevenueLines.effectiveTo),
          isNull(normalizedRevenueLines.deletedAt),
          // Include lines whose invoice OR realisation date falls in the FY.
          sql`(${normalizedRevenueLines.invoiceDate} BETWEEN ${fyStartIso} AND ${fyEndIso}
              OR ${normalizedRevenueLines.paidDate} BETWEEN ${fyStartIso} AND ${fyEndIso})`,
        ),
      );
  }
}
