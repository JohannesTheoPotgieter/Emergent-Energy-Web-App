/**
 * Board-set FY finance targets — admin-entered, audited board goals.
 *
 * A small config table (one row per fiscal year) holding the board's approved
 * FY revenue target (ex-VAT) and target GP margin %. It is NOT a finance
 * computation surface: the frozen recognition/realisation/cashflow paths never
 * read it. Finance Home reads it purely as a DISPLAY comparison — when a target
 * is set the Revenue KPI compares realised revenue against the board target
 * (and drops the "Provisional" badge); when unset it falls back to the manual
 * FY budget (current behaviour) and keeps "Provisional".
 *
 * Who/when/value history lives in `audit_events` (source = "SETTINGS"); this
 * table holds only the current value plus who/when last changed it. Writes are
 * allowlisted (COO / CEO / CFO) in the route layer.
 */
import { pgTable, integer, numeric, text, timestamp } from "drizzle-orm/pg-core";

export const boardFinanceTargets = pgTable("board_finance_targets", {
  /** Fiscal year = calendar year of the Aug close (FY26 → 2026). One row per FY. */
  fy: integer("fy").primaryKey(),
  /** Board-approved FY revenue target, ex-VAT (Rand). Null → not set for this FY. */
  revenueTarget: numeric("revenue_target"),
  /** Board target GP margin as a percentage (e.g. 15.00 = 15%). Null → not set. */
  targetMarginPct: numeric("target_margin_pct"),
  /** Free-text justification captured against the change (also copied to audit). */
  reason: text("reason"),
  /** User id who last set the target (audit trail; full history in audit_events). */
  updatedByUserId: integer("updated_by_user_id"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type BoardFinanceTarget = typeof boardFinanceTargets.$inferSelect;
export type InsertBoardFinanceTarget = typeof boardFinanceTargets.$inferInsert;
