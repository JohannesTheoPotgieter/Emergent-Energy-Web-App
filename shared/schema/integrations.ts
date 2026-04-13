/**
 * C1 — Integration health registry.
 *
 * Central connector registry + per-run audit log so the integration
 * health dashboard can render a tile per integration (Pipedrive,
 * Microsoft 365, ClickUp, Xero, iAuditor, …) with a derived
 * healthy / stale / failing / unknown status.
 *
 * Read-only surface for now. C3 will wire alerting on status
 * transitions (healthy -> failing) to the notification engine.
 */

import { pgTable, text, integer, timestamp, serial, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const INTEGRATION_AUTH_TYPES = ["api_key", "oauth2", "basic", "none"] as const;
export type IntegrationAuthType = (typeof INTEGRATION_AUTH_TYPES)[number];

export const INTEGRATION_RUN_STATUSES = ["success", "failure", "partial"] as const;
export type IntegrationRunStatus = (typeof INTEGRATION_RUN_STATUSES)[number];

/**
 * Derived health categories surfaced on the dashboard. Stored
 * nowhere — computed from integration_run_events on read.
 */
export const INTEGRATION_HEALTH_STATES = ["healthy", "stale", "failing", "unknown"] as const;
export type IntegrationHealthState = (typeof INTEGRATION_HEALTH_STATES)[number];

// ===================== CONNECTOR REGISTRY =====================

export const integrations = pgTable("integrations", {
  id: serial("id").primaryKey(),
  /** Machine key: 'pipedrive', 'microsoft_365', 'clickup', 'xero', 'iauditor', 'sseg'. */
  name: text("name").notNull().unique(),
  /** Human-readable display name for the dashboard tile. */
  displayName: text("display_name").notNull(),
  /** Short description of what the connector does / which records it touches. */
  description: text("description"),
  /** api_key | oauth2 | basic | none */
  authType: text("auth_type").notNull().default("api_key"),
  /** Which internal process owns / schedules this integration. */
  ownerProcess: text("owner_process"),
  /** What happens when this integration is down (plain-English fallback). */
  fallbackDescription: text("fallback_description"),
  /** Role / team to alert when the integration starts failing (C3 wires this). */
  alertTarget: text("alert_target"),
  /** Free-form config / mapping metadata. */
  metadata: jsonb("metadata"),
  /** C3: last health state we dispatched an alert for. Drives transition detection. */
  lastAlertState: text("last_alert_state"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export const insertIntegrationSchema = createInsertSchema(integrations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as any);
export type InsertIntegration = z.infer<typeof insertIntegrationSchema>;
export type Integration = typeof integrations.$inferSelect;

// ===================== RUN EVENTS =====================

export const integrationRunEvents = pgTable("integration_run_events", {
  id: serial("id").primaryKey(),
  integrationId: integer("integration_id")
    .notNull()
    .references(() => integrations.id, { onDelete: "cascade" }),
  /** Caller-supplied label, e.g. 'nightly_full_sync', 'webhook_delta'. */
  runType: text("run_type"),
  startedAt: timestamp("started_at").notNull(),
  finishedAt: timestamp("finished_at"),
  /** success | failure | partial */
  status: text("status").notNull(),
  recordsProcessed: integer("records_processed"),
  errorCode: text("error_code"),
  errorDetail: text("error_detail"),
  /** Full payload for debugging — counts, IDs, etc. */
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertIntegrationRunEventSchema = createInsertSchema(integrationRunEvents).omit({
  id: true,
  createdAt: true,
} as any);
export type InsertIntegrationRunEvent = z.infer<typeof insertIntegrationRunEventSchema>;
export type IntegrationRunEvent = typeof integrationRunEvents.$inferSelect;

// ===================== SEED LIST =====================

/**
 * Known integrations, backfilled on boot so the dashboard has something
 * to render from day 1 even before a run has been logged. Adding a new
 * connector here is all it takes for it to appear on the dashboard.
 */
export const INTEGRATION_SEED: Array<{
  name: string;
  displayName: string;
  description: string;
  authType: IntegrationAuthType;
  ownerProcess: string;
  fallbackDescription: string;
  alertTarget: string;
}> = [
  {
    name: "pipedrive",
    displayName: "Pipedrive CRM",
    description:
      "Read-only sync of Pipedrive deals into the opportunities table. Pipedrive is the source of truth for the sales pipeline.",
    authType: "api_key",
    ownerProcess: "pipedrive-sync-service (nightly + manual)",
    fallbackDescription:
      "Opportunities can be created manually in the app. New Pipedrive deals will back-fill on the next successful sync.",
    alertTarget: "PROGRAM_MANAGER",
  },
  {
    name: "microsoft_365",
    displayName: "Microsoft 365 (SSO + Graph)",
    description:
      "Azure AD single sign-on, Outlook mail send, and SharePoint document links. Also delivers user profile data at login.",
    authType: "oauth2",
    ownerProcess: "microsoft-auth + ms-sync-service",
    fallbackDescription:
      "Users fall back to local password login if SSO is down. Outbound email queues up and retries when Graph recovers.",
    alertTarget: "COO_ADMIN",
  },
  {
    name: "clickup",
    displayName: "ClickUp",
    description:
      "Task mirror + comment bridge for the legacy ClickUp workspace. Kept read-only while the internal task module is the source of truth.",
    authType: "api_key",
    ownerProcess: "manual webhook ingest",
    fallbackDescription:
      "Tasks continue to work inside the app. ClickUp mirror gets stale and back-fills on the next successful ingest.",
    alertTarget: "PROGRAM_MANAGER",
  },
];
