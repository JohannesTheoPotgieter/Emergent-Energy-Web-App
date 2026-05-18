/**
 * C2 — Dashboard snapshot cache.
 *
 * Materialized cache of dashboard payloads so the read path is a
 * single row lookup instead of a multi-table aggregate. A background
 * refresh job writes a new snapshot on its cadence; the read API
 * serves the latest snapshot and surfaces a freshness indicator.
 */

import { pgTable, text, integer, timestamp, serial, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const DASHBOARD_SNAPSHOT_STATUSES = ["ok", "failed"] as const;
export type DashboardSnapshotStatus = (typeof DASHBOARD_SNAPSHOT_STATUSES)[number];

/** Derived from snapshot age. Computed on read, never stored. */
export const DASHBOARD_FRESHNESS_STATES = ["fresh", "warn", "stale", "unknown"] as const;
export type DashboardFreshnessState = (typeof DASHBOARD_FRESHNESS_STATES)[number];

/**
 * One row per (dashboardKey, scopeKey) pair. Overwritten on every
 * successful refresh — we don't keep history here, the individual
 * dashboard services are the source of truth if an auditor needs it.
 */
export const dashboardSnapshots = pgTable("dashboard_snapshots", {
  id: serial("id").primaryKey(),
  /** Machine key: 'company_overview', 'integration_health', 'om_handover', … */
  dashboardKey: text("dashboard_key").notNull(),
  /** Optional narrower scope, e.g. 'user:42' or 'project:17'. 'global' for org-wide dashboards. */
  scopeKey: text("scope_key").notNull().default("global"),
  /** Full cached payload. */
  payloadJson: jsonb("payload_json"),
  /** ok | failed */
  status: text("status").notNull().default("ok"),
  /** Error detail if status=failed. Previous successful payload kept in payloadJson. */
  errorDetail: text("error_detail"),
  /** Wall-clock time of the most recent refresh attempt. */
  computedAt: timestamp("computed_at").notNull().defaultNow(),
  /** Wall-clock time of the most recent SUCCESSFUL refresh. */
  lastSuccessAt: timestamp("last_success_at"),
  /** Duration of the most recent refresh attempt in ms. */
  computeMs: integer("compute_ms"),
  /** C3: last freshness state we dispatched an alert for. Drives transition detection. */
  lastAlertState: text("last_alert_state"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertDashboardSnapshotSchema = createInsertSchema(dashboardSnapshots).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDashboardSnapshot = z.infer<typeof insertDashboardSnapshotSchema>;
export type DashboardSnapshot = typeof dashboardSnapshots.$inferSelect;
