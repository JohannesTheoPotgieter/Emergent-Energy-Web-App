/**
 * Per-project QuickBooks attribution bridge (G2 auto-matcher).
 *
 * QuickBooks carries NO reliable project code; the project TRACKERS do. This
 * table is the legitimate bridge: each QB document (Bill = COS, Invoice = REV)
 * is matched to a tracker line on (normalised invoice number AND ex-VAT amount
 * within tolerance). A 1:1 match lets the QB document INHERIT that tracker
 * line's project_id — the ONLY correct way to attribute QB per project.
 *
 * Read/compare only — the app never writes back to QuickBooks (§ 3.4) and never
 * force-assigns: a QB doc that matches zero tracker lines is `unmatched`, one
 * that matches more than one is `ambiguous`, and BOTH stay project-less (rolled
 * to the company "unattributed" bucket and surfaced on the resolve worklist).
 *
 * Current-state derived cache: the matcher full-replaces the row set on every
 * run (idempotent, re-runnable). `matched_at` + `match_type` + `confidence`
 * per row are the audit trail of what attributed where and when. NOT a temporal
 * snapshot table — there is no `effective_to`, so reads need no § 3.1 guard.
 *
 * Distinct from `qb_recon_line` (qb-recon.ts), which is COMPANY-grain and
 * aggregates tracker lines by invoice number — that path deliberately discards
 * the per-line project_id this table exists to preserve.
 */
import { pgTable, text, integer, decimal, timestamp, serial, date, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { projectInfo } from "./projects";

export const qbProjectMatch = pgTable("qb_project_match", {
  id: serial("id").primaryKey(),
  /** 'COS' (QB Bill ↔ cost line) | 'REV' (QB Invoice ↔ revenue line). */
  stream: text("stream").notNull(),
  /** QuickBooks document Id (Bill.Id / Invoice.Id). */
  qbDocId: text("qb_doc_id").notNull(),
  /** Raw QB DocNumber, kept for the worklist display. */
  qbDocNumber: text("qb_doc_number"),
  /** Normalised invoice number — the match key (same normalizer as qb-recon). */
  invoiceNoNorm: text("invoice_no_norm"),
  /** QB document ex-VAT amount (TotalAmt − TxnTaxDetail.TotalTax). */
  qbExVatAmount: decimal("qb_ex_vat_amount", { precision: 15, scale: 2 }),
  /** Matched tracker line's ex-VAT amount (null unless match_type = 'matched'). */
  trackerExVatAmount: decimal("tracker_ex_vat_amount", { precision: 15, scale: 2 }),
  /** QB document date (TxnDate), for the worklist. */
  qbDate: date("qb_date"),
  /** Matched tracker line id — null for ambiguous / unmatched (never forced). */
  trackerLineId: integer("tracker_line_id"),
  /** Inherited project — null for ambiguous / unmatched (company-unattributed). */
  projectId: integer("project_id").references(() => projectInfo.id, { onDelete: "set null" }),
  /** 'matched' (1:1) | 'ambiguous' (>1 tracker line) | 'unmatched' (0). */
  matchType: text("match_type").notNull(),
  /** Number of tracker candidates within tolerance (1 matched, >1 ambiguous, 0 unmatched). */
  candidateCount: integer("candidate_count").notNull().default(0),
  /** 0..1 — amount closeness for a match; 0 for ambiguous / unmatched. */
  confidence: decimal("confidence", { precision: 5, scale: 4 }),
  /** Run timestamp — the audit anchor for "when did this attribute". */
  matchedAt: timestamp("matched_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  projectStreamIdx: index("qb_project_match_project_stream_idx").on(table.projectId, table.stream),
  matchTypeIdx: index("qb_project_match_type_idx").on(table.matchType, table.stream),
  qbDocIdx: index("qb_project_match_qb_doc_idx").on(table.qbDocId, table.stream),
}));

export const insertQbProjectMatchSchema = createInsertSchema(qbProjectMatch).omit({
  id: true,
  matchedAt: true,
} as never);
export type InsertQbProjectMatch = z.infer<typeof insertQbProjectMatchSchema>;
export type QbProjectMatch = typeof qbProjectMatch.$inferSelect;
