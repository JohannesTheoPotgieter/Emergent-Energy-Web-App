/**
 * Company-wide tracker-vs-QuickBooks reconciliation snapshot tables (R2).
 *
 * Two-way reconciliation of the project trackers vs QuickBooks DETAIL, matched
 * on invoice number + ex-VAT amount, at the COMPANY grain — NO project
 * dimension (QB cost bills aren't project-tagged; see
 * docs/finance-reconciliation.md). Distinct from `financial_reconciliation`
 * (project × period app-vs-tracker). Snapshot-guarded (§ 3.1) — reads MUST
 * filter `effective_to IS NULL`. The app compares + flags; it never adjusts a
 * tracker (§ 3.4). Written by server/services/qb-tracker-reconcile.ts.
 *
 * Kept in its own file (not finance.ts) to keep that already-large module from
 * growing — these tables stand alone and only FK to fiscal_periods.
 */
import { sql } from "drizzle-orm";
import { pgTable, text, integer, decimal, timestamp, serial, boolean, date, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { fiscalPeriods } from "./finance";

export const qbReconLine = pgTable("qb_recon_line", {
  id: serial("id").primaryKey(),
  stream: text("stream").notNull(), // 'COS' | 'REV'
  invoiceNoRaw: text("invoice_no_raw"),
  invoiceNoNorm: text("invoice_no_norm").notNull(),
  trackerAmountExVat: decimal("tracker_amount_ex_vat", { precision: 15, scale: 2 }),
  qbAmountExVat: decimal("qb_amount_ex_vat", { precision: 15, scale: 2 }),
  delta: decimal("delta", { precision: 15, scale: 2 }), // tracker − qb
  status: text("status").notNull(), // matched | amount_variance | tracker_only | qb_only
  trackerDate: date("tracker_date"),
  qbDate: date("qb_date"),
  fiscalPeriodId: integer("fiscal_period_id").references(() => fiscalPeriods.id, { onDelete: "set null" }),
  timingFlag: boolean("timing_flag").notNull().default(false),
  computedAt: timestamp("computed_at", { withTimezone: true }),
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  effectiveTo: timestamp("effective_to"),
}, (table) => ({
  activeIdx: index("qb_recon_line_active_idx")
    .on(table.stream, table.status)
    .where(sql`${table.effectiveTo} IS NULL`),
  periodActiveIdx: index("qb_recon_line_period_active_idx")
    .on(table.fiscalPeriodId)
    .where(sql`${table.effectiveTo} IS NULL`),
}));
export const insertQbReconLineSchema = createInsertSchema(qbReconLine).omit({ id: true, effectiveFrom: true, effectiveTo: true } as any);
export type InsertQbReconLine = z.infer<typeof insertQbReconLineSchema>;
export type QbReconLine = typeof qbReconLine.$inferSelect;

export const qbReconSummary = pgTable("qb_recon_summary", {
  id: serial("id").primaryKey(),
  periodGrain: text("period_grain").notNull(), // 'day' | 'week' | 'month'
  periodKey: text("period_key").notNull(),
  fiscalPeriodId: integer("fiscal_period_id").references(() => fiscalPeriods.id, { onDelete: "set null" }),
  stream: text("stream").notNull(), // 'COS' | 'REV' (GP per period = REV − COS each side, derived)
  trackerTotal: decimal("tracker_total", { precision: 15, scale: 2 }),
  qbTotal: decimal("qb_total", { precision: 15, scale: 2 }),
  matchedTotal: decimal("matched_total", { precision: 15, scale: 2 }),
  varianceTotal: decimal("variance_total", { precision: 15, scale: 2 }),
  trackerOnlyTotal: decimal("tracker_only_total", { precision: 15, scale: 2 }),
  qbOnlyTotal: decimal("qb_only_total", { precision: 15, scale: 2 }),
  computedAt: timestamp("computed_at", { withTimezone: true }),
  effectiveFrom: timestamp("effective_from").notNull().defaultNow(),
  effectiveTo: timestamp("effective_to"),
}, (table) => ({
  activeIdx: index("qb_recon_summary_active_idx")
    .on(table.periodGrain, table.stream)
    .where(sql`${table.effectiveTo} IS NULL`),
}));
export const insertQbReconSummarySchema = createInsertSchema(qbReconSummary).omit({ id: true, effectiveFrom: true, effectiveTo: true } as any);
export type InsertQbReconSummary = z.infer<typeof insertQbReconSummarySchema>;
export type QbReconSummary = typeof qbReconSummary.$inferSelect;

/**
 * Recon-ignore annotations for the COMPANY-wide worklist (G4 — accepted
 * difference suppression). Keyed on the recon line's stable identity
 * (`stream` + normalized invoice number) because a company recon line has no
 * single QB entity id to hang off (a normalized number can fold several raw
 * docs). Distinct from `qb_recon_ignores` / `qb_revenue_recon_ignores` in
 * integrations.ts, which suppress a single QB Bill/Invoice on the per-project
 * tracker-gap surface.
 *
 * Annotation table (NOT a snapshot table): soft-deleted via `deleted_at`, no
 * `effective_to`. An active row (deleted_at IS NULL) means "this difference is
 * accepted — drop it out of the actionable worklist, but keep it visible and
 * audited." The engine + amounts are never mutated; the snapshot the recon
 * line came from is untouched. Every create/restore writes an `audit_events`
 * row (actor + reason + timestamp) via `logAuditFromReq`.
 */
export const qbReconLineIgnores = pgTable("qb_recon_line_ignores", {
  id: serial("id").primaryKey(),
  stream: text("stream").notNull(), // 'COS' | 'REV'
  invoiceNoNorm: text("invoice_no_norm").notNull(),
  invoiceNoRaw: text("invoice_no_raw"),
  trackerAmountExVat: decimal("tracker_amount_ex_vat", { precision: 15, scale: 2 }),
  qbAmountExVat: decimal("qb_amount_ex_vat", { precision: 15, scale: 2 }),
  reason: text("reason").notNull(),
  ignoredByUserId: integer("ignored_by_user_id"),
  ignoredByName: text("ignored_by_name"),
  ignoredAt: timestamp("ignored_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => ({
  activeIdx: index("qb_recon_line_ignores_active_idx")
    .on(table.stream, table.invoiceNoNorm)
    .where(sql`${table.deletedAt} IS NULL`),
}));
export const insertQbReconLineIgnoreSchema = createInsertSchema(qbReconLineIgnores).omit({ id: true, ignoredAt: true, deletedAt: true } as any);
export type InsertQbReconLineIgnore = z.infer<typeof insertQbReconLineIgnoreSchema>;
export type QbReconLineIgnore = typeof qbReconLineIgnores.$inferSelect;
