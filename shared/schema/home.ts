import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const doNextState = pgTable(
  "do_next_state",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    itemKey: text("item_key").notNull(),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    snoozeCount: integer("snooze_count").notNull().default(0),
    lastReason: text("last_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userItemUq: uniqueIndex("do_next_state_user_item_idx").on(t.userId, t.itemKey),
    userActiveIdx: index("do_next_state_user_active_idx").on(t.userId),
  }),
);

export const insertDoNextStateSchema = createInsertSchema(doNextState).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDoNextState = z.infer<typeof insertDoNextStateSchema>;
export type DoNextState = typeof doNextState.$inferSelect;

/**
 * Categories surfaced on the home "Do Next" strip.
 * Used both for ranking weights and for the chip icon/colour mapping on the client.
 */
export const DO_NEXT_KINDS = [
  "approval",        // pending gate / exception / handover / engineering / quality / general approval
  "rag",             // a project flipped or stayed Red
  "behind_plan",     // milestone or project behind plan
  "overdue_task",    // assigned task past its due date
  "eng_blocker",     // engineering bottleneck / blocker
  "quality_issue",   // open NCR / quality warning
  "hse_incident",    // open HSE incident
  "blocked_priority",// company priority blocked
  "import_drift",    // tracker re-import variance vs prior snapshot
  "qb_sync_failed",  // QuickBooks sync failure
] as const;

export type DoNextKind = typeof DO_NEXT_KINDS[number];

export interface DoNextItem {
  /** Stable identity used for snooze/dismiss persistence. */
  key: string;
  kind: DoNextKind;
  /** Short verb-led label e.g. "Approve invoice INV-2014". */
  title: string;
  /** Optional supporting context (project name, owner, due date). */
  subtitle?: string | null;
  /** Severity hint — drives chip colour. */
  severity: "high" | "medium" | "low";
  /** Numeric ranking score; higher = more urgent. */
  score: number;
  /** Where to send the user when they click the chip. */
  href: string;
  /** ISO timestamp the item became actionable, when known. */
  since?: string | null;
  /** ISO timestamp it is snoozed until, if currently snoozed. */
  snoozedUntil?: string | null;
}
