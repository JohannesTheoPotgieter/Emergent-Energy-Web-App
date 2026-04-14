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

import { pgTable, text, integer, timestamp, serial, jsonb, decimal, uniqueIndex, index } from "drizzle-orm/pg-core";
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
  /** Machine key: 'pipedrive', 'microsoft_365', 'clickup', 'xero', 'iauditor', 'sseg', 'quickbooks'. */
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

// ===================== QUICKBOOKS INVOICE LINKS =====================

/**
 * Link table between app financial rows (normalized cost lines / revenue
 * lines) and QuickBooks entities (Bill / Invoice). One row = one
 * confirmed link. Used by the COS reconciliation tab on project detail
 * and by the global QuickBooks invoice linking page under Finance.
 *
 * Snapshot columns (qb_*) store the QB values at link time so the
 * reconciliation view still renders if QuickBooks is briefly
 * unreachable.
 */
export const QUICKBOOKS_APP_ENTITY_TYPES = ["cost_line", "revenue_line"] as const;
export type QuickBooksAppEntityType = (typeof QUICKBOOKS_APP_ENTITY_TYPES)[number];

export const QUICKBOOKS_QB_ENTITY_TYPES = ["bill", "invoice"] as const;
export type QuickBooksQbEntityType = (typeof QUICKBOOKS_QB_ENTITY_TYPES)[number];

export const QUICKBOOKS_LINK_MATCH_TYPES = [
  "manual",
  "auto_exact",
  "auto_fuzzy",
] as const;
export type QuickBooksLinkMatchType = (typeof QUICKBOOKS_LINK_MATCH_TYPES)[number];

export const quickbooksInvoiceLinks = pgTable(
  "quickbooks_invoice_links",
  {
    id: serial("id").primaryKey(),
    /** Optional project scope — denormalised for fast per-project lookup. */
    projectId: integer("project_id"),
    /** 'cost_line' | 'revenue_line' */
    appEntityType: text("app_entity_type").notNull(),
    /** FK to normalized_cost_lines.id or normalized_revenue_lines.id */
    appEntityId: integer("app_entity_id").notNull(),
    /** 'bill' | 'invoice' */
    qbEntityType: text("qb_entity_type").notNull(),
    /** QuickBooks entity ID (e.g. Bill.Id or Invoice.Id). */
    qbEntityId: text("qb_entity_id").notNull(),
    /** QuickBooks realmId this link belongs to. */
    qbRealmId: text("qb_realm_id").notNull(),
    /** Denormalised snapshot — QB doc number at link time. */
    qbDocNumber: text("qb_doc_number"),
    /** Denormalised snapshot — QB transaction date at link time. */
    qbTxnDate: text("qb_txn_date"),
    /** Denormalised snapshot — QB total amount at link time. */
    qbAmount: decimal("qb_amount", { precision: 15, scale: 2 }),
    /** Denormalised snapshot — QB counterparty (vendor / customer) name. */
    qbCounterpartyName: text("qb_counterparty_name"),
    /** 'manual' | 'auto_exact' | 'auto_fuzzy' */
    matchType: text("match_type").notNull().default("manual"),
    /** Free-form note the confirming user can leave. */
    notes: text("notes"),
    /** User who confirmed / created the link. */
    confirmedBy: integer("confirmed_by"),
    confirmedAt: timestamp("confirmed_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => ({
    // Prevent duplicate links between the same app row and the same QB entity.
    uniqueLink: uniqueIndex("quickbooks_invoice_links_unique_idx").on(
      table.appEntityType,
      table.appEntityId,
      table.qbEntityType,
      table.qbEntityId,
      table.qbRealmId,
    ),
    projectIdx: index("quickbooks_invoice_links_project_idx").on(table.projectId),
    appEntityIdx: index("quickbooks_invoice_links_app_entity_idx").on(
      table.appEntityType,
      table.appEntityId,
    ),
  }),
);

export const insertQuickBooksInvoiceLinkSchema = createInsertSchema(
  quickbooksInvoiceLinks,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as any);
export type InsertQuickBooksInvoiceLink = z.infer<typeof insertQuickBooksInvoiceLinkSchema>;
export type QuickBooksInvoiceLink = typeof quickbooksInvoiceLinks.$inferSelect;

// ===================== QUICKBOOKS CUSTOMER MAPPINGS =====================

/**
 * Project ↔ QuickBooks customer mapping. One row per app project that is
 * linked to a QB customer. Multiple projects can share a QB customer when
 * a client is billed as a single entity across several engagements.
 *
 * Used by the revenue-side reconciliation (QB `Invoice` ↔ app revenue
 * lines): once a project is mapped, we can filter QB invoices by
 * `CustomerRef.value = qbCustomerId` so the per-project view only
 * shows invoices that belong to that project's client.
 */
export const quickbooksCustomerMappings = pgTable(
  "quickbooks_customer_mappings",
  {
    id: serial("id").primaryKey(),
    /** FK to project_info.id. One mapping per project. */
    projectId: integer("project_id").notNull(),
    /** Optional FK to clients.id for client-level audit / lookup. */
    clientId: integer("client_id"),
    /** QuickBooks customer id (CustomerRef.value). */
    qbCustomerId: text("qb_customer_id").notNull(),
    /** Snapshot of the QB display name at mapping time. */
    qbCustomerName: text("qb_customer_name"),
    /** QuickBooks realmId this mapping belongs to. */
    qbRealmId: text("qb_realm_id").notNull(),
    /** Free-form note. */
    notes: text("notes"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => ({
    // One active mapping per (project, realm).
    uniqueProject: uniqueIndex("quickbooks_customer_mappings_project_idx").on(
      table.projectId,
      table.qbRealmId,
    ),
    customerIdx: index("quickbooks_customer_mappings_customer_idx").on(
      table.qbCustomerId,
    ),
  }),
);

export const insertQuickBooksCustomerMappingSchema = createInsertSchema(
  quickbooksCustomerMappings,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as any);
export type InsertQuickBooksCustomerMapping = z.infer<typeof insertQuickBooksCustomerMappingSchema>;
export type QuickBooksCustomerMapping = typeof quickbooksCustomerMappings.$inferSelect;

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
  {
    name: "quickbooks",
    displayName: "QuickBooks Online",
    description:
      "OAuth2 integration with QuickBooks Online Accounting. Syncs invoices, customers, and financial data for COS tracking and invoice reconciliation.",
    authType: "oauth2",
    ownerProcess: "quickbooks-sync-service",
    fallbackDescription:
      "Financial data can still be managed manually. QuickBooks data will sync on the next successful connection.",
    alertTarget: "COO_ADMIN",
  },
];
