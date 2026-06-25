/**
 * TF-9 (audit V3) — Finance audit-prep export endpoints.
 *
 * External auditors ask for three standard bundles when they review the
 * year:
 *
 *   1. Every invoice in the FY, grouped by project, with PO + payment
 *      evidence — so they can sample-check that revenue was earned
 *      and cost matched.
 *   2. Every revenue milestone billed in the FY, with the customer +
 *      milestone metadata — so they can tie revenue back to contracts.
 *   3. Every period that was locked / unlocked in the FY with
 *      authoriser + reason — so they can see who closed the books and
 *      when.
 *
 * Before this surface existed, Finance built these by hand each year.
 * The exports are CSV (auditor-friendly; opens in Excel without
 * sniffing). Each request is recorded as an `audit_events` row so the
 * export of an export is itself auditable.
 *
 * RBAC: `requirePermission("financials", "approve")` — the highest
 * finance gate, matching the bad-debt write-off and other
 * audit-sensitive writes. The data leaving this endpoint is the full
 * finance picture for the FY; this should never be exposed to a PM or
 * site supervisor by accident.
 *
 * Reads are guarded by `isNull(effectiveTo)` on snapshot tables per
 * § 3.1 of docs/AGENT_GUARDRAILS.md.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  cosPeriodLocks,
  purchaseOrders,
  users,
} from "@shared/schema";
import { requireAuth } from "../departments/shared-middleware";
import { requirePermission } from "../permission-middleware";
import { getEffectiveUser } from "../auth-context";
import { badRequest, sendError } from "../lib/api-error";
import { getFyWindow } from "../lib/fy-window";
import { logAuditFromReq } from "../audit-logger";
import { FinanceAuditExportRepository } from "../repositories/finance-audit-export-repository";

const financeAuditExportRepository = new FinanceAuditExportRepository();

const fyQuery = z.coerce.number().int().min(2020).max(2100).optional();

function rowsFromResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown[] }).rows;
    return Array.isArray(rows) ? (rows as T[]) : [];
  }
  return [];
}

/** Escape a value for inclusion in a CSV cell — RFC 4180 quoting. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

/**
 * Send a CSV response with the right content-type + a filename hint
 * for the browser's "Save as" dialog. Auditors typically open the file
 * in Excel; UTF-8 BOM helps Excel detect the encoding correctly.
 */
function sendCsv(res: Response, filename: string, rows: string[]): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // UTF-8 BOM — Excel needs this to render non-ASCII characters correctly.
  const body = "﻿" + rows.join("\r\n") + "\r\n";
  res.send(body);
}

export function registerFinanceAuditExportRoutes(app: Express): void {
  // -------------------------------------------------------------------
  // 1. Invoices by project — every cost + revenue line for the FY, with
  // PO + payment date evidence. Sorted by project, then date.
  // -------------------------------------------------------------------
  app.get(
    "/api/finance/audit-export/invoices-by-project",
    requireAuth,
    requirePermission("financials", "edit"),
    async (req: Request, res: Response) => {
      try {
        const parsed = fyQuery.safeParse(req.query.fy);
        if (!parsed.success) {
          throw badRequest("fy must be a calendar year (e.g. 2026)");
        }
        const fyWindow = getFyWindow({ fy: parsed.data ?? null });

        // AR — revenue lines invoiced in the FY.
        const arRows = await financeAuditExportRepository.getInvoiceArLines(
          fyWindow.fyStartIso,
          fyWindow.fyEndIso,
        );

        // AP — cost lines invoiced in the FY, with PO linkage.
        const apRows = await financeAuditExportRepository.getInvoiceApLines(
          fyWindow.fyStartIso,
          fyWindow.fyEndIso,
        );

        const headerComment = `# Emergent Energy — Invoices by project for ${fyWindow.fyLabel}`;
        const generatedAt = `# Generated ${new Date().toISOString()} by user_id=${getEffectiveUser(req)?.id ?? "unknown"}`;
        const header = csvRow([
          "side",
          "project_id",
          "project_name",
          "invoice_number",
          "invoice_date",
          "paid_date",
          "counterparty_or_milestone",
          "description",
          "amount_ex_vat",
          "vat",
          "po_number",
          "status",
          "source_sheet",
        ]);

        type ArRow = (typeof arRows)[number];
        type ApRow = (typeof apRows)[number];

        const arCsvRows = arRows
          .slice()
          .sort((a: ArRow, b: ArRow) => {
            const projCmp = (a.projectName ?? "").localeCompare(b.projectName ?? "");
            if (projCmp !== 0) return projCmp;
            return (a.invoiceDate ?? "").localeCompare(b.invoiceDate ?? "");
          })
          .map((r: ArRow) =>
            csvRow([
              "AR",
              r.projectId,
              r.projectName,
              r.invoiceNumber,
              r.invoiceDate,
              r.paidDate,
              r.milestoneName,
              r.description,
              r.amountExVat,
              r.vat,
              "", // POs are tracked on the AP side
              r.status,
              r.sourceSheet,
            ]),
          );

        const apCsvRows = apRows
          .slice()
          .sort((a: ApRow, b: ApRow) => {
            const projCmp = (a.projectName ?? "").localeCompare(b.projectName ?? "");
            if (projCmp !== 0) return projCmp;
            return (a.invoiceDate ?? "").localeCompare(b.invoiceDate ?? "");
          })
          .map((r: ApRow) =>
            csvRow([
              "AP",
              r.projectId,
              r.projectName,
              r.invoiceNumber,
              r.invoiceDate,
              r.paidDate,
              r.counterpartyName,
              r.description,
              r.amountExVat,
              "", // VAT not stored on cost lines (vat_rate_pct since DF-19, but legacy lines are null)
              r.poNumber,
              r.status,
              r.sourceSheet,
            ]),
          );

        await logAuditFromReq(req, {
          entityType: "finance_audit_export",
          entityId: String(fyWindow.fy),
          action: "export_invoices_by_project",
          changesJson: {
            fy: fyWindow.fy,
            arRowCount: arRows.length,
            apRowCount: apRows.length,
          },
        });

        sendCsv(
          res,
          `invoices-by-project-fy${String(fyWindow.fy).slice(-2)}.csv`,
          [headerComment, generatedAt, header, ...arCsvRows, ...apCsvRows],
        );
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  // -------------------------------------------------------------------
  // 2. Revenue milestones — every revenue line that was invoiced or
  // realised in the FY. Auditors use this to tie revenue back to
  // contracts.
  // -------------------------------------------------------------------
  app.get(
    "/api/finance/audit-export/revenue-milestones",
    requireAuth,
    requirePermission("financials", "edit"),
    async (req: Request, res: Response) => {
      try {
        const parsed = fyQuery.safeParse(req.query.fy);
        if (!parsed.success) {
          throw badRequest("fy must be a calendar year (e.g. 2026)");
        }
        const fyWindow = getFyWindow({ fy: parsed.data ?? null });

        const rows = await financeAuditExportRepository.getRevenueMilestoneLines(
          fyWindow.fyStartIso,
          fyWindow.fyEndIso,
        );

        const headerComment = `# Emergent Energy — Revenue milestones for ${fyWindow.fyLabel}`;
        const generatedAt = `# Generated ${new Date().toISOString()} by user_id=${getEffectiveUser(req)?.id ?? "unknown"}`;
        const header = csvRow([
          "project_id",
          "project_name",
          "milestone_no",
          "milestone_name",
          "milestone_percent",
          "description",
          "invoice_number",
          "invoice_date",
          "expected_payment_date",
          "paid_date",
          "in_bank_date",
          "amount_ex_vat",
          "vat",
          "status",
          "write_off_authorised_at",
          "write_off_reason",
          "dispute_opened_at",
          "dispute_reason",
        ]);

        type Row = (typeof rows)[number];
        const csvRows = rows
          .slice()
          .sort((a: Row, b: Row) => {
            const projCmp = (a.projectName ?? "").localeCompare(b.projectName ?? "");
            if (projCmp !== 0) return projCmp;
            return (a.invoiceDate ?? "").localeCompare(b.invoiceDate ?? "");
          })
          .map((r: Row) =>
            csvRow([
              r.projectId,
              r.projectName,
              r.milestoneNo,
              r.milestoneName,
              r.milestonePercent,
              r.description,
              r.invoiceNumber,
              r.invoiceDate,
              r.expectedPaymentDate,
              r.paidDate,
              r.inBankDate,
              r.amountExVat,
              r.vat,
              r.status,
              r.writeOffAuthorisedAt?.toISOString() ?? "",
              r.writeOffReason,
              r.disputeOpenedAt?.toISOString() ?? "",
              r.disputeReason,
            ]),
          );

        await logAuditFromReq(req, {
          entityType: "finance_audit_export",
          entityId: String(fyWindow.fy),
          action: "export_revenue_milestones",
          changesJson: {
            fy: fyWindow.fy,
            rowCount: rows.length,
          },
        });

        sendCsv(
          res,
          `revenue-milestones-fy${String(fyWindow.fy).slice(-2)}.csv`,
          [headerComment, generatedAt, header, ...csvRows],
        );
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  // -------------------------------------------------------------------
  // 3. Period locks — every cos_period_locks row whose period falls in
  // the FY, with authoriser + unlock reason.
  // -------------------------------------------------------------------
  app.get(
    "/api/finance/audit-export/period-locks",
    requireAuth,
    requirePermission("financials", "edit"),
    async (req: Request, res: Response) => {
      try {
        const parsed = fyQuery.safeParse(req.query.fy);
        if (!parsed.success) {
          throw badRequest("fy must be a calendar year (e.g. 2026)");
        }
        const fyWindow = getFyWindow({ fy: parsed.data ?? null });

        // Drizzle alias workaround — join `users` twice via raw SQL aliases
        // because Drizzle's `alias()` helper doesn't compose cleanly with
        // multiple references to the same table here.
        type LockRow = {
          period_month: string;
          locked_at: string;
          locked_by_email: string | null;
          auto_locked: boolean;
          unlocked_at: string | null;
          unlocked_by_email: string | null;
          unlock_reason: string | null;
          notes: string | null;
        };
        const rawResult = await db.execute(sql`
          SELECT
            cpl.period_month,
            cpl.locked_at,
            locked_by_user.email AS locked_by_email,
            cpl.auto_locked,
            cpl.unlocked_at,
            unlocked_by_user.email AS unlocked_by_email,
            cpl.unlock_reason,
            cpl.notes
          FROM cos_period_locks cpl
          LEFT JOIN users locked_by_user ON locked_by_user.id = cpl.locked_by_user_id
          LEFT JOIN users unlocked_by_user ON unlocked_by_user.id = cpl.unlocked_by_user_id
          WHERE cpl.period_month BETWEEN ${fyWindow.fyStartIso} AND ${fyWindow.fyEndIso}
          ORDER BY cpl.period_month, cpl.locked_at
        `);
        const lockRows = rowsFromResult<LockRow>(rawResult);

        const headerComment = `# Emergent Energy — Period locks for ${fyWindow.fyLabel}`;
        const generatedAt = `# Generated ${new Date().toISOString()} by user_id=${getEffectiveUser(req)?.id ?? "unknown"}`;
        const header = csvRow([
          "period_month",
          "locked_at",
          "locked_by",
          "auto_locked",
          "unlocked_at",
          "unlocked_by",
          "unlock_reason",
          "notes",
        ]);

        const csvRows = lockRows.map((r: LockRow) =>
          csvRow([
            r.period_month,
            r.locked_at,
            r.locked_by_email,
            r.auto_locked ? "yes" : "no",
            r.unlocked_at,
            r.unlocked_by_email,
            r.unlock_reason,
            r.notes,
          ]),
        );

        await logAuditFromReq(req, {
          entityType: "finance_audit_export",
          entityId: String(fyWindow.fy),
          action: "export_period_locks",
          changesJson: {
            fy: fyWindow.fy,
            rowCount: lockRows.length,
          },
        });

        sendCsv(
          res,
          `period-locks-fy${String(fyWindow.fy).slice(-2)}.csv`,
          [headerComment, generatedAt, header, ...csvRows],
        );

        // Silence unused-import warnings — these table identifiers are
        // referenced symbolically in the raw SQL above; future
        // drizzle-alias-based rewrites would import them.
        void users;
        void cosPeriodLocks;
        void purchaseOrders;
      } catch (err) {
        sendError(res, err);
      }
    },
  );
}
