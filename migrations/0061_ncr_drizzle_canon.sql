CREATE TYPE "public"."ncr_severity" AS ENUM('minor', 'major', 'critical');--> statement-breakpoint
CREATE TYPE "public"."ncr_status" AS ENUM('open', 'investigating', 'corrective_action', 'verification', 'closed', 'waived');--> statement-breakpoint
CREATE TABLE "ncr_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"ncr_id" integer NOT NULL,
	"file_path" text NOT NULL,
	"file_name" text NOT NULL,
	"uploaded_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ncr_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"ncr_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"comment" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ncr_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"phase_at_raise_time" text,
	"subcontractor_id" integer,
	"related_checklist_item_id" integer,
	"reported_by" integer NOT NULL,
	"assigned_to" integer,
	"closed_by_user_id" integer,
	"title" text NOT NULL,
	"description" text,
	"severity" "ncr_severity" DEFAULT 'major' NOT NULL,
	"status" "ncr_status" DEFAULT 'open' NOT NULL,
	"root_cause" text,
	"corrective_action" text,
	"preventive_action" text,
	"waiver_reason" text,
	"due_date" text,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "om_handover_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"om_handover_id" integer NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"changed_by_user_id" integer,
	"changed_by_role" text,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"reason" text,
	"details_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "project_stage_exception_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"exception_id" integer NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"changed_by_user_id" integer,
	"changed_by_role" text,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"reason" text,
	"details_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "template_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_type" text NOT NULL,
	"source_template_id" integer NOT NULL,
	"project_id" integer,
	"override_data" jsonb NOT NULL,
	"override_reason" text NOT NULL,
	"overridden_by" integer,
	"overridden_at" timestamp DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"opportunity_id" integer,
	"client_name" text,
	"counterparty_name" text,
	"contract_type" text,
	"contract_reference" text,
	"signature_status" text DEFAULT 'draft' NOT NULL,
	"signed_date" date,
	"effective_date" date,
	"expiry_date" date,
	"contract_value" integer,
	"currency" text DEFAULT 'ZAR',
	"document_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"financial_close_relevance" boolean DEFAULT false,
	"notes" text,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" integer
);
--> statement-breakpoint
CREATE TABLE "lens_simulation_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"simulated_lens_role" text NOT NULL,
	"simulated_user_id" integer,
	"mode" text DEFAULT 'read_only' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "role_homepage_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"lens_role" text NOT NULL,
	"user_id" integer,
	"snapshot_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_homepage_widgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"lens_role" text NOT NULL,
	"widget_key" text NOT NULL,
	"label" text NOT NULL,
	"widget_type" text NOT NULL,
	"data_source" text,
	"position" integer DEFAULT 0 NOT NULL,
	"span" integer DEFAULT 1 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_lens_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"lens_role" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"landing_page" text NOT NULL,
	"allowed_modules" text[] DEFAULT '{}' NOT NULL,
	"nav_priority" text[] DEFAULT '{}' NOT NULL,
	"quick_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"widget_layout" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"record_tab_emphasis" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_system" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "role_lens_profiles_lens_role_unique" UNIQUE("lens_role")
);
--> statement-breakpoint
CREATE TABLE "sseg_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"site_id" integer,
	"authority" text NOT NULL,
	"application_stage" text DEFAULT 'preparation' NOT NULL,
	"reference_number" text,
	"submission_date" date,
	"query_date" date,
	"response_due_date" date,
	"approval_date" date,
	"expiry_date" date,
	"required_documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rejection_notes" text,
	"query_notes" text,
	"owner_user_id" integer,
	"sseg_item_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "commissioning_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"source_id" integer,
	"source_etag" text,
	"source_ctag" text,
	"source_modified_at" timestamp,
	"parse_status" text DEFAULT 'pending' NOT NULL,
	"parse_message" text,
	"parsed_sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parsed_at" timestamp DEFAULT now() NOT NULL,
	"is_latest" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commissioning_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"source_type" text DEFAULT 'sharepoint' NOT NULL,
	"source_format" text DEFAULT 'commissioning_workbook' NOT NULL,
	"drive_id" text,
	"item_id" text,
	"file_path" text,
	"workbook_url" text,
	"folder_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" integer,
	CONSTRAINT "commissioning_sources_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "qb_link_proposed_cascade_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"cascade_id" integer NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"changed_by_user_id" integer,
	"changed_by_role" text,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"reason" text,
	"details_json" jsonb
);
--> statement-breakpoint
CREATE TABLE "do_next_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"item_key" text NOT NULL,
	"snoozed_until" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"snooze_count" integer DEFAULT 0 NOT NULL,
	"last_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_approval_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"pending_approval_id" integer NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"changed_by_user_id" integer,
	"changed_by_role" text,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"reason" text,
	"details_json" jsonb
);
--> statement-breakpoint
ALTER TABLE "eng_deliverable_templates" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "eng_deliverable_templates" ADD COLUMN "deleted_by" integer;--> statement-breakpoint
ALTER TABLE "eng_task_templates" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "eng_task_templates" ADD COLUMN "deleted_by" integer;--> statement-breakpoint
ALTER TABLE "ncr_attachments" ADD CONSTRAINT "ncr_attachments_ncr_id_ncr_reports_id_fk" FOREIGN KEY ("ncr_id") REFERENCES "public"."ncr_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr_attachments" ADD CONSTRAINT "ncr_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr_comments" ADD CONSTRAINT "ncr_comments_ncr_id_ncr_reports_id_fk" FOREIGN KEY ("ncr_id") REFERENCES "public"."ncr_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr_comments" ADD CONSTRAINT "ncr_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr_reports" ADD CONSTRAINT "ncr_reports_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr_reports" ADD CONSTRAINT "ncr_reports_subcontractor_id_counterparties_id_fk" FOREIGN KEY ("subcontractor_id") REFERENCES "public"."counterparties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr_reports" ADD CONSTRAINT "ncr_reports_related_checklist_item_id_qc_item_instance_id_fk" FOREIGN KEY ("related_checklist_item_id") REFERENCES "public"."qc_item_instance"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr_reports" ADD CONSTRAINT "ncr_reports_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr_reports" ADD CONSTRAINT "ncr_reports_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ncr_reports" ADD CONSTRAINT "ncr_reports_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "om_handover_history" ADD CONSTRAINT "om_handover_history_om_handover_id_om_handovers_id_fk" FOREIGN KEY ("om_handover_id") REFERENCES "public"."om_handovers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "om_handover_history" ADD CONSTRAINT "om_handover_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stage_exception_history" ADD CONSTRAINT "project_stage_exception_history_exception_id_project_stage_exceptions_id_fk" FOREIGN KEY ("exception_id") REFERENCES "public"."project_stage_exceptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stage_exception_history" ADD CONSTRAINT "project_stage_exception_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_overrides" ADD CONSTRAINT "template_overrides_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_overrides" ADD CONSTRAINT "template_overrides_overridden_by_users_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lens_simulation_sessions" ADD CONSTRAINT "lens_simulation_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lens_simulation_sessions" ADD CONSTRAINT "lens_simulation_sessions_simulated_user_id_users_id_fk" FOREIGN KEY ("simulated_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_homepage_snapshots" ADD CONSTRAINT "role_homepage_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sseg_applications" ADD CONSTRAINT "sseg_applications_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sseg_applications" ADD CONSTRAINT "sseg_applications_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissioning_snapshots" ADD CONSTRAINT "commissioning_snapshots_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissioning_snapshots" ADD CONSTRAINT "commissioning_snapshots_source_id_commissioning_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."commissioning_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissioning_sources" ADD CONSTRAINT "commissioning_sources_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissioning_sources" ADD CONSTRAINT "commissioning_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qb_link_proposed_cascade_history" ADD CONSTRAINT "qb_link_proposed_cascade_history_cascade_id_qb_link_proposed_cascades_id_fk" FOREIGN KEY ("cascade_id") REFERENCES "public"."qb_link_proposed_cascades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qb_link_proposed_cascade_history" ADD CONSTRAINT "qb_link_proposed_cascade_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_approval_history" ADD CONSTRAINT "pending_approval_history_pending_approval_id_pending_approvals_id_fk" FOREIGN KEY ("pending_approval_id") REFERENCES "public"."pending_approvals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_approval_history" ADD CONSTRAINT "pending_approval_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pseh_exception_id_idx" ON "project_stage_exception_history" USING btree ("exception_id");--> statement-breakpoint
CREATE INDEX "qlpch_cascade_id_idx" ON "qb_link_proposed_cascade_history" USING btree ("cascade_id");--> statement-breakpoint
CREATE UNIQUE INDEX "do_next_state_user_item_idx" ON "do_next_state" USING btree ("user_id","item_key");--> statement-breakpoint
CREATE INDEX "do_next_state_user_active_idx" ON "do_next_state" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pah_pending_approval_id_idx" ON "pending_approval_history" USING btree ("pending_approval_id");--> statement-breakpoint
ALTER TABLE "eng_deliverable_templates" ADD CONSTRAINT "eng_deliverable_templates_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eng_task_templates" ADD CONSTRAINT "eng_task_templates_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;