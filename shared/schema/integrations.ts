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

import { pgTable, text, integer, timestamp, serial, jsonb, decimal, uniqueIndex, index, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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

export const QUICKBOOKS_DOCUMENT_TYPES = ["bill", "invoice"] as const;
export type QuickBooksDocumentType = (typeof QUICKBOOKS_DOCUMENT_TYPES)[number];

export const QUICKBOOKS_DOCUMENT_ASSIGNMENT_STATUS = [
  "UNASSIGNED",
  "PARTIALLY_ASSIGNED",
  "FULLY_ASSIGNED",
  "OVER_ASSIGNED_BLOCKED",
  "TAX_UNCERTAIN",
] as const;
export type QuickBooksDocumentAssignmentStatus = (typeof QUICKBOOKS_DOCUMENT_ASSIGNMENT_STATUS)[number];

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
    /**
     * Rand value this link consumes from the QB doc total (ex-VAT).
     * Many-to-many: the SUM of `allocated_amount_ex_vat` across all active
     * sibling links sharing the same (qbEntityType, qbEntityId, qbRealmId)
     * must equal the QB doc total within the tolerance defined in
     * `shared/config/qb-allocations.ts`. Legacy single-link rows pre-dating
     * Task #142 are stored with their original `qbAmount` here (full 100%)
     * so reads continue to balance.
     */
    allocatedAmountExVat: decimal("allocated_amount_ex_vat", {
      precision: 15,
      scale: 2,
    }).notNull(),
    /**
     * True when the sibling group was approved with a sum that differed
     * from the QB doc total by less than the configured tolerance (small
     * rounding / bank fee). Surfaced in the audit log so finance can
     * inspect the cumulative drift later.
     */
    allocationToleranceApplied: boolean("allocation_tolerance_applied")
      .notNull()
      .default(false),
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
    // This is the base 5-tuple uniqueness — it still allows the same app row
    // to be linked to multiple different QB docs (and vice versa). The two
    // partial unique indexes below enforce the 1:1 invariant on top of it.
    uniqueLink: uniqueIndex("quickbooks_invoice_links_unique_idx").on(
      table.appEntityType,
      table.appEntityId,
      table.qbEntityType,
      table.qbEntityId,
      table.qbRealmId,
    ),
    // Many-to-many sibling-group lookup: all active links pointing at the
    // same QB doc. Replaces the now-removed `uq_qb_links_qb_entity_active`
    // unique index — the 1:1 invariant has been deliberately relaxed in
    // favour of explicit per-link `allocated_amount_ex_vat`.
    qbEntityIdx: index("quickbooks_invoice_links_qb_entity_idx")
      .on(table.qbEntityType, table.qbEntityId, table.qbRealmId)
      .where(sql`${table.deletedAt} IS NULL`),
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

/**
 * Canonical QuickBooks evidence document snapshot.
 * One row per QB source document (Bill/Invoice) per realm.
 *
 * Amount fields are always stored with explicit VAT decomposition:
 *  - qb_amount_inc_vat: TotalAmt from QB
 *  - qb_tax_amount: TxnTaxDetail.TotalTax when provided
 *  - qb_amount_ex_vat: qb_amount_inc_vat - qb_tax_amount when tax is available
 *
 * If tax decomposition is missing, mark TAX_UNCERTAIN and block bulk
 * auto-approval in API flows.
 */
export const quickbooksDocuments = pgTable(
  "quickbooks_documents",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id"),
    qbEntityType: text("qb_entity_type").notNull().default("bill"),
    qbEntityId: text("qb_entity_id").notNull(),
    qbRealmId: text("qb_realm_id").notNull(),
    qbDocNumber: text("qb_doc_number"),
    qbTxnDate: text("qb_txn_date"),
    qbCounterpartyName: text("qb_counterparty_name"),
    qbCounterpartyId: text("qb_counterparty_id"),
    qbAmountIncVat: decimal("qb_amount_inc_vat", { precision: 15, scale: 2 }),
    qbTaxAmount: decimal("qb_tax_amount", { precision: 15, scale: 2 }),
    qbAmountExVat: decimal("qb_amount_ex_vat", { precision: 15, scale: 2 }),
    amountTolerance: decimal("amount_tolerance", { precision: 15, scale: 4 }).notNull().default("0.01"),
    taxStatus: text("tax_status").notNull().default("KNOWN"),
    assignmentStatus: text("assignment_status").notNull().default("UNASSIGNED"),
    /** Remaining unpaid balance from QB (TotalAmt - sum of payments). 0 = fully settled. */
    qbBalance: decimal("qb_balance", { precision: 15, scale: 2 }),
    /** Derived settlement status: 'paid' | 'partial' | 'unpaid' | null (unknown) */
    qbPaymentStatus: text("qb_payment_status"),
    sourcePayload: jsonb("source_payload"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => ({
    uniqueDocPerRealm: uniqueIndex("uq_qb_documents_doc_realm_active")
      .on(table.qbEntityType, table.qbEntityId, table.qbRealmId)
      .where(sql`${table.deletedAt} IS NULL`),
    projectIdx: index("quickbooks_documents_project_idx").on(table.projectId),
    docNumIdx: index("quickbooks_documents_doc_num_idx").on(table.qbDocNumber),
    counterpartyIdx: index("quickbooks_documents_counterparty_idx").on(table.qbCounterpartyName),
  }),
);

export const insertQuickBooksDocumentSchema = createInsertSchema(
  quickbooksDocuments,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as any);
export type InsertQuickBooksDocument = z.infer<typeof insertQuickBooksDocumentSchema>;
export type QuickBooksDocument = typeof quickbooksDocuments.$inferSelect;

/**
 * Smart Import × QuickBooks precedence: per-field variance audit trail.
 *
 * Whenever a cost/revenue line is QB-linked AND the workbook value disagrees
 * with the QB-canonical value on a locked field (amount, VAT, invoice number,
 * invoice date, paid date, in-bank date), the workbook value is silently
 * dropped and a row is inserted here so finance can reconcile the difference.
 *
 * Resolution values:
 *   - 'qb_locked'         — workbook value differed; QB value was used
 *   - 'auto_realised'     — QB showed Paid; cosRealised forced to true
 *   - 'missing_preserved' — workbook omitted this row but QB link exists;
 *                           the soft-close was suppressed
 */
export const importQbVariances = pgTable(
  "import_qb_variances",
  {
    id: serial("id").primaryKey(),
    importRunId: integer("import_run_id").notNull(),
    projectId: integer("project_id"),
    appEntityType: text("app_entity_type").notNull(),
    appEntityId: integer("app_entity_id").notNull(),
    qbLinkId: integer("qb_link_id"),
    qbDocId: integer("qb_doc_id"),
    qbRealmId: text("qb_realm_id"),
    fieldName: text("field_name").notNull(),
    workbookValue: text("workbook_value"),
    qbValue: text("qb_value"),
    resolution: text("resolution").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    runIdx: index("import_qb_variances_run_idx").on(table.importRunId),
    projectIdx: index("import_qb_variances_project_idx").on(table.projectId),
    appEntityIdx: index("import_qb_variances_app_entity_idx").on(
      table.appEntityType,
      table.appEntityId,
    ),
  }),
);

export type ImportQbVariance = typeof importQbVariances.$inferSelect;

/**
 * Allocation rows from QuickBooks evidence document -> app cost line.
 * Many-to-many, amount-aware, ex-VAT only.
 *
 * Governance:
 *  - No hard deletes.
 *  - Over-assignment is blocked in service-layer validations.
 */
export const quickbooksCostAllocations = pgTable(
  "quickbooks_cost_allocations",
  {
    id: serial("id").primaryKey(),
    quickbooksDocumentId: integer("quickbooks_document_id")
      .notNull()
      .references(() => quickbooksDocuments.id, { onDelete: "restrict" }),
    projectId: integer("project_id"),
    /**
     * Reference to normalized_cost_lines.id. Intentionally NOT an FK — the
     * cost-lines table is temporally snapshotted (effective_to IS NULL gates
     * current rows) and soft-closed rows would break a hard FK. Readers must
     * join through the current-row guard (`isNull(effectiveTo)`) when
     * reconciling back to a live cost line.
     */
    costLineId: integer("cost_line_id")
      .notNull(),
    amountExVat: decimal("amount_ex_vat", { precision: 15, scale: 2 }).notNull(),
    matchType: text("match_type").notNull().default("manual"),
    status: text("status").notNull().default("active"),
    reason: text("reason"),
    createdBy: integer("created_by"),
    approvedBy: integer("approved_by"),
    approvedAt: timestamp("approved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => ({
    uniqueActiveDocCostLine: uniqueIndex("uq_qb_cost_alloc_doc_line_active")
      .on(table.quickbooksDocumentId, table.costLineId)
      .where(sql`${table.deletedAt} IS NULL`),
    documentIdx: index("quickbooks_cost_alloc_document_idx").on(table.quickbooksDocumentId),
    costLineIdx: index("quickbooks_cost_alloc_cost_line_idx").on(table.costLineId),
    projectIdx: index("quickbooks_cost_alloc_project_idx").on(table.projectId),
  }),
);

export const insertQuickBooksCostAllocationSchema = createInsertSchema(
  quickbooksCostAllocations,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as any);
export type InsertQuickBooksCostAllocation = z.infer<typeof insertQuickBooksCostAllocationSchema>;
export type QuickBooksCostAllocation = typeof quickbooksCostAllocations.$inferSelect;

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
export const QUICKBOOKS_MAPPING_SOURCES = ["manual", "suggestion", "cascade", "import"] as const;
export type QuickBooksMappingSource = (typeof QUICKBOOKS_MAPPING_SOURCES)[number];

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
    /** How this mapping was created: manual | suggestion | cascade | import */
    source: text("source").notNull().default("manual"),
    /** When created via fuzzy suggestion: 0–100 confidence score from the matcher. */
    confidence: decimal("confidence", { precision: 5, scale: 2 }),
    /** When set, only admin can change/clear this mapping. */
    lockedAt: timestamp("locked_at"),
    lockedBy: integer("locked_by"),
    /** Audit pointer to the suggestion run that produced this mapping (if any). */
    suggestionRunId: integer("suggestion_run_id"),
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

/**
 * QuickBooks Vendor ↔ App Counterparty mapping.
 *
 * A QB vendor (e.g. "ABB Electric (Pty) Ltd") maps to exactly one app
 * counterparty / supplier. The same supplier typically appears on many
 * projects, so no projectId is stored here — project attribution on a
 * bill is derived downstream via cost-line linking.
 *
 * Mapping a vendor enables automatic classification of QB bills: every
 * bill for a mapped vendor is attributable to the canonical supplier
 * record without running the invoice-pattern regex heuristics.
 */
export const quickbooksVendorMappings = pgTable(
  "quickbooks_vendor_mappings",
  {
    id: serial("id").primaryKey(),
    /** QuickBooks vendor id (VendorRef.value). */
    qbVendorId: text("qb_vendor_id").notNull(),
    /** Snapshot of the QB vendor display name at mapping time. */
    qbVendorName: text("qb_vendor_name"),
    /** QuickBooks realmId this mapping belongs to. */
    qbRealmId: text("qb_realm_id").notNull(),
    /** FK to counterparties.id — the canonical supplier record. */
    counterpartyId: integer("counterparty_id").notNull(),
    /** Snapshot of the counterparty name at mapping time (audit). */
    counterpartyName: text("counterparty_name"),
    notes: text("notes"),
    /** How this mapping was created: manual | suggestion | cascade | import */
    source: text("source").notNull().default("manual"),
    /** When created via fuzzy suggestion: 0–100 confidence score. */
    confidence: decimal("confidence", { precision: 5, scale: 2 }),
    /** When set, only admin can change/clear this mapping. */
    lockedAt: timestamp("locked_at"),
    lockedBy: integer("locked_by"),
    /** Audit pointer to the suggestion run that produced this mapping (if any). */
    suggestionRunId: integer("suggestion_run_id"),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => ({
    // One active mapping per (QB vendor, realm).
    uniqueVendor: uniqueIndex("quickbooks_vendor_mappings_vendor_idx").on(
      table.qbVendorId,
      table.qbRealmId,
    ),
    counterpartyIdx: index("quickbooks_vendor_mappings_counterparty_idx").on(
      table.counterpartyId,
    ),
  }),
);

export const insertQuickBooksVendorMappingSchema = createInsertSchema(
  quickbooksVendorMappings,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as any);
export type InsertQuickBooksVendorMapping = z.infer<typeof insertQuickBooksVendorMappingSchema>;
export type QuickBooksVendorMapping = typeof quickbooksVendorMappings.$inferSelect;

// ===================== QUICKBOOKS MATCH SUGGESTIONS + CASCADE RUNS =====================

/**
 * Admin-only fuzzy match suggestions. One row per "Suggest matches" run on a
 * given scope (customer | vendor | expense_invoice | incoming_invoice). The
 * candidate list is denormalised into JSONB so the UI can replay the run
 * without re-running the matcher; the accept flow records which candidate was
 * accepted and links the resulting cascade_run for full traceability.
 */
export const QUICKBOOKS_SUGGEST_SCOPES = [
  "customer",
  "vendor",
  "expense_invoice",
  "incoming_invoice",
] as const;
export type QuickBooksSuggestScope = (typeof QUICKBOOKS_SUGGEST_SCOPES)[number];

export const quickbooksMatchSuggestions = pgTable(
  "quickbooks_match_suggestions",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(),
    qbRealmId: text("qb_realm_id").notNull(),
    /** App-side anchor (project id, counterparty id, cost line id, revenue line id) */
    appEntityId: integer("app_entity_id"),
    appEntityLabel: text("app_entity_label"),
    candidates: jsonb("candidates").notNull(),
    requestedBy: integer("requested_by"),
    requestedAt: timestamp("requested_at").notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at"),
    acceptedBy: integer("accepted_by"),
    acceptedQbId: text("accepted_qb_id"),
    acceptedConfidence: decimal("accepted_confidence", { precision: 5, scale: 2 }),
    /** Set when the user dismissed the entire suggestion run without picking a candidate. */
    rejectedAt: timestamp("rejected_at"),
    rejectedBy: integer("rejected_by"),
    rejectionReason: text("rejection_reason"),
    /** True when accepted candidate was hand-entered rather than picked from suggestions. */
    manualOverride: boolean("manual_override").notNull().default(false),
    /** Phase 3 — true when produced by the auto-suggest engine (POST
     *  /auto-suggest/run). Lets the inbox UI filter to engine output and
     *  hide unresolved manual /find suggestions. */
    autoGenerated: boolean("auto_generated").notNull().default(false),
  },
  (table) => ({
    scopeIdx: index("quickbooks_match_suggestions_scope_idx").on(table.scope, table.qbRealmId),
  }),
);
export type QuickBooksMatchSuggestion = typeof quickbooksMatchSuggestions.$inferSelect;

export const QUICKBOOKS_CASCADE_STATUSES = ["preview", "committed", "aborted"] as const;
export type QuickBooksCascadeStatus = (typeof QUICKBOOKS_CASCADE_STATUSES)[number];

/**
 * Admin-only cascade preview/commit log. Created with status='preview' when
 * admin previews a cascade; status flips to 'committed' on accept, or
 * 'aborted' on cancel. The preview/commit JSONB carries the per-row
 * willUpdate / willSkipLocked / willSkipReconciled lists with reasons.
 */
export const quickbooksCascadeRuns = pgTable(
  "quickbooks_cascade_runs",
  {
    id: serial("id").primaryKey(),
    suggestionId: integer("suggestion_id"),
    scope: text("scope").notNull(),
    qbRealmId: text("qb_realm_id").notNull(),
    /** The mapping/link being changed: customer mapping id, vendor mapping id, etc. */
    sourceEntityType: text("source_entity_type").notNull(),
    sourceEntityId: integer("source_entity_id"),
    preview: jsonb("preview").notNull(),
    commit: jsonb("commit"),
    status: text("status").notNull().default("preview"),
    triggeredBy: integer("triggered_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    committedAt: timestamp("committed_at"),
  },
  (table) => ({
    suggestionIdx: index("quickbooks_cascade_runs_suggestion_idx").on(table.suggestionId),
    scopeIdx: index("quickbooks_cascade_runs_scope_idx").on(table.scope),
  }),
);
export type QuickBooksCascadeRun = typeof quickbooksCascadeRuns.$inferSelect;

// ===================== QUICKBOOKS LINK PROPOSED CASCADES =====================

/**
 * Per-link cascade proposals surfaced to the reviewer.
 *
 * When a `quickbooks_invoice_links` row is created (manual approve, bulk
 * approve, force-relink, or admin cascade), the QB-vs-app divergence
 * detector records one row here per app-side mutation it would *propose*
 * to make. The link itself is created immediately, but every downstream
 * change (vendor mapping, counterpartyId backfill, paid_date overwrite,
 * VAT decomposition, ignore-row clear, etc.) stays `pending` until the
 * reviewer clicks Accept or Decline. Nothing on the app side is mutated
 * silently — that's the contract the user explicitly asked for.
 *
 * Lifecycle:
 *   - status='pending'  : created at link time, awaiting review
 *   - status='accepted' : reviewer approved, the proposed mutation was
 *                         applied (resolvedBy + resolvedAt populated)
 *   - status='declined' : reviewer rejected, no mutation applied
 *
 * Two proposals for the same (linkId, proposalType, fieldName) are
 * deduplicated at insert time — re-running the detector for the same link
 * does not produce stacking pending rows.
 */
export const QB_PROPOSAL_TYPES = [
  "vendor_mapping",
  "customer_mapping",
  "counterparty_id",
  "paid_date",
  "invoice_date",
  "invoice_number",
  "amount_ex_vat",
  "vat_amount",
  "name_alias",
  "recon_ignore_clear",
  /** Phase 2 — learn an invoice-number pattern (PREFIX / TOKEN_SHAPE) for the
   *  cost line's counterparty. The proposal carries patternType +
   *  patternValue in fieldName/qbValue so the apply step can write
   *  `invoice_pattern_rules` directly without re-deriving. */
  "pattern_rule_create",
  /** Phase 2 — learn a description-token fingerprint for the counterparty.
   *  qbValue holds the JSON-encoded token set that will be written to
   *  `invoice_description_patterns.token_set`. */
  "description_pattern_create",
] as const;
export type QbProposalType = (typeof QB_PROPOSAL_TYPES)[number];

export const QB_PROPOSAL_STATUSES = ["pending", "accepted", "declined"] as const;
export type QbProposalStatus = (typeof QB_PROPOSAL_STATUSES)[number];

export const qbLinkProposedCascades = pgTable(
  "qb_link_proposed_cascades",
  {
    id: serial("id").primaryKey(),
    /** FK to quickbooks_invoice_links.id (no hard FK — links are soft-deleted) */
    linkId: integer("link_id").notNull(),
    /** Convenience pointer for per-project filtering on the inbox */
    projectId: integer("project_id"),
    /** Logical target — 'normalized_cost_lines' | 'normalized_revenue_lines' |
     *  'counterparties' | 'qb_recon_ignores' | 'qb_revenue_recon_ignores' |
     *  'quickbooks_vendor_mappings' | 'quickbooks_customer_mappings' */
    targetTable: text("target_table").notNull(),
    /** Row id on `targetTable`. Null when the proposal isn't a row-level
     *  update (e.g. a name-alias append where the target is the whole row). */
    targetId: integer("target_id"),
    proposalType: text("proposal_type").notNull(),
    /** Field name on the target row (e.g. 'paid_date'). Null for
     *  whole-row proposals like `recon_ignore_clear`. */
    fieldName: text("field_name"),
    /** Current value on the app side, stringified. Null when the app
     *  had no value (i.e. the proposal is a fill, not an overwrite). */
    appValue: text("app_value"),
    /** Proposed value from QB, stringified. */
    qbValue: text("qb_value"),
    /** Human-readable reason — e.g. "QB shows R110.00, app shows R100.00". */
    reason: text("reason"),
    status: text("status").notNull().default("pending"),
    createdBy: integer("created_by"),
    resolvedBy: integer("resolved_by"),
    resolvedAt: timestamp("resolved_at"),
    /** Free-text note left by the reviewer at accept/decline time. */
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => ({
    // De-duplicate pending proposals for the same (link, type, field).
    uniquePending: uniqueIndex("qb_link_proposed_cascades_unique_pending_idx")
      .on(table.linkId, table.proposalType, table.fieldName)
      .where(sql`${table.status} = 'pending' AND ${table.deletedAt} IS NULL`),
    linkIdx: index("qb_link_proposed_cascades_link_idx").on(table.linkId),
    statusIdx: index("qb_link_proposed_cascades_status_idx").on(table.status),
    projectIdx: index("qb_link_proposed_cascades_project_idx").on(table.projectId),
  }),
);

export const insertQbLinkProposedCascadeSchema = createInsertSchema(
  qbLinkProposedCascades,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as any);
export type InsertQbLinkProposedCascade = z.infer<typeof insertQbLinkProposedCascadeSchema>;
export type QbLinkProposedCascade = typeof qbLinkProposedCascades.$inferSelect;

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
    name: "sharepoint",
    displayName: "SharePoint Proposals Pipeline",
    description:
      "Bidirectional sync of the Engineering/Proposals Pipeline SharePoint list into the intake_requests table. SharePoint is the document truth for proposals and intake metadata.",
    authType: "oauth2",
    ownerProcess: "sync-routes (COO manual pull/push)",
    fallbackDescription:
      "Intake requests remain in the app with their last-known state. The next SharePoint pull will re-sync any updates.",
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

/**
 * QB Reconciliation — Tracker Gap support tables (C004).
 *
 * Backed by migrations/0008_qb_recon_tables.sql. Pure annotation tables —
 * trackers stay the source of truth; these only record finance's
 * disposition of QB bills surfaced by the gap report.
 */
export const qbReconIgnores = pgTable("qb_recon_ignores", {
  id: serial("id").primaryKey(),
  qbBillId: text("qb_bill_id").notNull(),
  qbLineId: text("qb_line_id"),
  qbDocNumber: text("qb_doc_number"),
  vendorName: text("vendor_name"),
  lineAmountExVat: decimal("line_amount_ex_vat", { precision: 14, scale: 2 }),
  resolvedProjectName: text("resolved_project_name"),
  reason: text("reason").notNull(),
  ignoredByUserId: integer("ignored_by_user_id"),
  ignoredByName: text("ignored_by_name"),
  ignoredAt: timestamp("ignored_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});
export type QbReconIgnore = typeof qbReconIgnores.$inferSelect;

export const qbClassProjectOverrides = pgTable("qb_class_project_overrides", {
  id: serial("id").primaryKey(),
  classRefName: text("class_ref_name").notNull(),
  projectName: text("project_name").notNull(),
  note: text("note"),
  createdByUserId: integer("created_by_user_id"),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});
export type QbClassProjectOverride = typeof qbClassProjectOverrides.$inferSelect;

/**
 * QB Reconciliation — Revenue Tracker Gap support tables (Task #18).
 *
 * Parallel to qb_recon_ignores / qb_class_project_overrides but keyed on
 * QB Invoices + Customers (revenue side) rather than Bills + Classes
 * (cost side). Two separate tables instead of polymorphising the existing
 * ones, to avoid touching live COS data.
 *
 * Pure annotation tables — `normalized_revenue_lines` stays the source
 * of truth; these only record finance's disposition of QB invoices
 * surfaced by the revenue gap report.
 */
export const qbRevenueReconIgnores = pgTable("qb_revenue_recon_ignores", {
  id: serial("id").primaryKey(),
  qbInvoiceId: text("qb_invoice_id").notNull(),
  qbLineId: text("qb_line_id"),
  qbDocNumber: text("qb_doc_number"),
  customerName: text("customer_name"),
  lineAmountExVat: decimal("line_amount_ex_vat", { precision: 14, scale: 2 }),
  resolvedProjectName: text("resolved_project_name"),
  reason: text("reason").notNull(),
  ignoredByUserId: integer("ignored_by_user_id"),
  ignoredByName: text("ignored_by_name"),
  ignoredAt: timestamp("ignored_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});
export type QbRevenueReconIgnore = typeof qbRevenueReconIgnores.$inferSelect;

export const qbCustomerProjectOverrides = pgTable("qb_customer_project_overrides", {
  id: serial("id").primaryKey(),
  customerRefName: text("customer_ref_name").notNull(),
  projectName: text("project_name").notNull(),
  note: text("note"),
  createdByUserId: integer("created_by_user_id"),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});
export type QbCustomerProjectOverride = typeof qbCustomerProjectOverrides.$inferSelect;
