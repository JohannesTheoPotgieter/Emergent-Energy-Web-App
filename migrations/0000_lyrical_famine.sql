DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'change_request_status') THEN CREATE TYPE "public"."change_request_status" AS ENUM('draft', 'submitted', 'under_review', 'approved', 'rejected', 'implemented', 'closed'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'change_request_type') THEN CREATE TYPE "public"."change_request_type" AS ENUM('scope', 'cost', 'schedule', 'technical', 'commercial'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'phase_source') THEN CREATE TYPE "public"."phase_source" AS ENUM('EXCEL_IMPORT', 'MANUAL'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'raid_priority') THEN CREATE TYPE "public"."raid_priority" AS ENUM('low', 'medium', 'high', 'critical'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'raid_status') THEN CREATE TYPE "public"."raid_status" AS ENUM('open', 'mitigating', 'resolved', 'closed', 'accepted'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'raid_type') THEN CREATE TYPE "public"."raid_type" AS ENUM('risk', 'assumption', 'issue', 'decision'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subcontractor_assignment_status') THEN CREATE TYPE "public"."subcontractor_assignment_status" AS ENUM('active', 'completed', 'suspended', 'terminated'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cost_line_status') THEN CREATE TYPE "public"."cost_line_status" AS ENUM('PLANNED', 'INVOICED', 'APPROVED', 'PAID'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'counterparty_type') THEN CREATE TYPE "public"."counterparty_type" AS ENUM('SUPPLIER', 'INSTALLER', 'OTHER'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_capture_status') THEN CREATE TYPE "public"."invoice_capture_status" AS ENUM('captured', 'submitted', 'verified', 'approved', 'rejected'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pattern_match_outcome') THEN CREATE TYPE "public"."pattern_match_outcome" AS ENUM('AUTO_APPLIED', 'USER_CONFIRMED', 'USER_OVERRIDDEN', 'UNRESOLVED'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pattern_type') THEN CREATE TYPE "public"."pattern_type" AS ENUM('PREFIX', 'REGEX', 'TOKEN_SHAPE'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_batch_status') THEN CREATE TYPE "public"."payment_batch_status" AS ENUM('preparing', 'submitted', 'approved', 'released', 'confirmed'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_request_status') THEN CREATE TYPE "public"."payment_request_status" AS ENUM('new', 'in_review', 'loaded_for_payment', 'proof_attached', 'complete', 'requires_info', 'blocked'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'po_review_decision') THEN CREATE TYPE "public"."po_review_decision" AS ENUM('pending', 'approved', 'requires_info', 'blocked'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'po_status') THEN CREATE TYPE "public"."po_status" AS ENUM('draft', 'submitted', 'in_review', 'requires_info', 'blocked', 'approved', 'cancelled'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'procurement_category') THEN CREATE TYPE "public"."procurement_category" AS ENUM('material', 'equipment', 'service', 'subcontract', 'other'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'procurement_payment_status') THEN CREATE TYPE "public"."procurement_payment_status" AS ENUM('not_applicable', 'pending_approval', 'approved', 'scheduled', 'paid', 'on_hold'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'procurement_status') THEN CREATE TYPE "public"."procurement_status" AS ENUM('requested', 'quoted', 'approved', 'ordered', 'partially_received', 'received', 'invoiced', 'closed'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'revenue_line_status') THEN CREATE TYPE "public"."revenue_line_status" AS ENUM('PLANNED', 'INVOICED', 'PAID', 'IN_BANK', 'REALISED'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'row_source') THEN CREATE TYPE "public"."row_source" AS ENUM('imported', 'manual', 'imported_edited'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tr_link_status') THEN CREATE TYPE "public"."tr_link_status" AS ENUM('Linked', 'TaskCreated', 'Done'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tr_rag_status') THEN CREATE TYPE "public"."tr_rag_status" AS ENUM('Red', 'Amber', 'Green'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tr_status') THEN CREATE TYPE "public"."tr_status" AS ENUM('Active', 'Completed'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tr_suggestion_decision') THEN CREATE TYPE "public"."tr_suggestion_decision" AS ENUM('Suggested', 'Accepted', 'Rejected', 'Suppressed'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'eng_approval_status') THEN CREATE TYPE "public"."eng_approval_status" AS ENUM('pending', 'approved', 'rejected'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'eng_stage_status') THEN CREATE TYPE "public"."eng_stage_status" AS ENUM('not_started', 'in_progress', 'blocked', 'ready_for_review', 'complete'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'eng_task_instance_status') THEN CREATE TYPE "public"."eng_task_instance_status" AS ENUM('pending', 'in_progress', 'complete', 'skipped'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_tag_category') THEN CREATE TYPE "public"."task_tag_category" AS ENUM('BUG', 'IMPROVEMENT', 'FEATURE', 'CUSTOM'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_item_assignment_role') THEN CREATE TYPE "public"."work_item_assignment_role" AS ENUM('OWNER', 'ASSIGNEE', 'REVIEWER', 'VIEWER'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_item_dep_type') THEN CREATE TYPE "public"."work_item_dep_type" AS ENUM('FS', 'SS', 'FF', 'SF'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_item_source') THEN CREATE TYPE "public"."work_item_source" AS ENUM('SMART_IMPORT', 'UI', 'INTEGRATION', 'SYSTEM'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_item_workstream') THEN CREATE TYPE "public"."work_item_workstream" AS ENUM('PD', 'ENG', 'QUALITY', 'PM', 'FINANCE', 'PERSONAL', 'GOVERNANCE', 'HANDOVER'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'commissioning_status') THEN CREATE TYPE "public"."commissioning_status" AS ENUM('not_started', 'in_progress', 'ready_for_review', 'approved', 'closed'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'evidence_type') THEN CREATE TYPE "public"."evidence_type" AS ENUM('document', 'photo', 'form', 'structured_field', 'sign_off', 'linked_record'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mytool_dependency_type') THEN CREATE TYPE "public"."mytool_dependency_type" AS ENUM('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mytool_priority_horizon') THEN CREATE TYPE "public"."mytool_priority_horizon" AS ENUM('today', 'week', 'month', 'quarter'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mytool_priority_scope') THEN CREATE TYPE "public"."mytool_priority_scope" AS ENUM('company', 'department', 'role'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mytool_priority_severity') THEN CREATE TYPE "public"."mytool_priority_severity" AS ENUM('normal', 'important', 'critical'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mytool_priority_status') THEN CREATE TYPE "public"."mytool_priority_status" AS ENUM('active', 'monitoring', 'closed', 'not_started', 'in_progress', 'complete'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mytool_recurrence_frequency') THEN CREATE TYPE "public"."mytool_recurrence_frequency" AS ENUM('daily', 'weekly', 'monthly'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mytool_task_bucket') THEN CREATE TYPE "public"."mytool_task_bucket" AS ENUM('project', 'company_ops', 'personal'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mytool_task_priority') THEN CREATE TYPE "public"."mytool_task_priority" AS ENUM('low', 'normal', 'high', 'critical'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mytool_task_status') THEN CREATE TYPE "public"."mytool_task_status" AS ENUM('inbox', 'planned', 'in_progress', 'blocked', 'waiting', 'done', 'cancelled'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mytool_task_type') THEN CREATE TYPE "public"."mytool_task_type" AS ENUM('task', 'milestone'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'triage_rule_type') THEN CREATE TYPE "public"."triage_rule_type" AS ENUM('keyword', 'sender', 'domain'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'change_event_type') THEN CREATE TYPE "public"."change_event_type" AS ENUM('created', 'modified', 'deleted', 'renamed'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'change_set_source') THEN CREATE TYPE "public"."change_set_source" AS ENUM('IMPORT', 'MANUAL_EDIT', 'OVERRIDE', 'CONFLICT_RESOLUTION', 'PATTERN_LEARNING', 'COUNTERPARTY_UPDATE', 'SYSTEM'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_issue_severity') THEN CREATE TYPE "public"."import_issue_severity" AS ENUM('INFO', 'WARNING', 'BLOCKER'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_run_status') THEN CREATE TYPE "public"."import_run_status" AS ENUM('running', 'success', 'partial', 'fail'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_section') THEN CREATE TYPE "public"."import_section" AS ENUM('PLAN', 'REVENUE', 'EXPENDITURE', 'CASHFLOW', 'GENERAL'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_status_type') THEN CREATE TYPE "public"."import_status_type" AS ENUM('pending', 'imported', 'failed', 'skipped'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_trigger_type') THEN CREATE TYPE "public"."import_trigger_type" AS ENUM('schedule', 'manual', 'webhook'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'smart_import_status') THEN CREATE TYPE "public"."smart_import_status" AS ENUM('PREVIEW', 'AWAITING_REVIEW', 'COMMITTED', 'ROLLED_BACK', 'FAILED', 'SUPERSEDED'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'approval_status') THEN CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_source') THEN CREATE TYPE "public"."audit_source" AS ENUM('UI', 'IMPORT', 'SETTINGS', 'DOCS', 'SYSTEM'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'communication_follow_up_status') THEN CREATE TYPE "public"."communication_follow_up_status" AS ENUM('pending', 'completed', 'dismissed'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meeting_action_item_status') THEN CREATE TYPE "public"."meeting_action_item_status" AS ENUM('pending', 'converted', 'dismissed'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ms_account_status') THEN CREATE TYPE "public"."ms_account_status" AS ENUM('active', 'disconnected', 'expired'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ms_object_type') THEN CREATE TYPE "public"."ms_object_type" AS ENUM('email', 'event', 'teams', 'sharepoint_file'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pm_action_status') THEN CREATE TYPE "public"."pm_action_status" AS ENUM('pending', 'approved', 'rejected', 'completed'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pm_action_type') THEN CREATE TYPE "public"."pm_action_type" AS ENUM('site_visit', 'generate_po', 'link_invoice', 'raise_variation', 'log_delay', 'log_risk', 'upload_photo', 'update_progress', 'escalate'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pm_safety_status') THEN CREATE TYPE "public"."pm_safety_status" AS ENUM('clear', 'issue_open'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'standup_cadence') THEN CREATE TYPE "public"."standup_cadence" AS ENUM('DAILY', 'EVERY_2_DAYS', 'EVERY_3_DAYS', 'WEEKLY'); END IF; END $$;--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'standup_mood') THEN CREATE TYPE "public"."standup_mood" AS ENUM('great', 'good', 'okay', 'struggling', 'blocked'); END IF; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "error_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"route" text,
	"action" text,
	"correlation_id" text NOT NULL,
	"error_message" text NOT NULL,
	"error_stack" text,
	"payload_shape" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pd_visibility_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" text,
	"user_id" integer,
	"ticket_types" text[] DEFAULT '{"pd","engineering"}' NOT NULL,
	"scope" text DEFAULT 'all' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permission_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"target_role" text,
	"target_user_id" integer,
	"changed_by_user_id" integer,
	"changed_by_role" text,
	"change_detail" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"password_hash" text NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "role_credentials_role_unique" UNIQUE("role")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"sections" text[] DEFAULT '{}' NOT NULL,
	"can_manage_users" boolean DEFAULT false NOT NULL,
	"can_manage_roles" boolean DEFAULT false NOT NULL,
	"can_edit_data" boolean DEFAULT true NOT NULL,
	"entity_permissions" jsonb,
	"authority_model" jsonb,
	"is_system" boolean DEFAULT false NOT NULL,
	"permission_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_unique" UNIQUE("role")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_permission_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"entity" text NOT NULL,
	"action" text NOT NULL,
	"allowed" boolean DEFAULT true NOT NULL,
	"scope" text,
	"granted_by" integer,
	"reason" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"department" text,
	"microsoft_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_microsoft_id_unique" UNIQUE("microsoft_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workstream_visibility_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" text,
	"user_id" integer,
	"workstreams" text[] DEFAULT '{"ENG","PD","PM","QUALITY","FINANCE","GOVERNANCE","PERSONAL"}' NOT NULL,
	"ticket_types" text[] DEFAULT '{"pd","engineering"}' NOT NULL,
	"scope" text DEFAULT 'all' NOT NULL,
	"sections" text[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calendar_holiday" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"name" text NOT NULL,
	"country_code" text DEFAULT 'ZA' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "change_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"change_type" "change_request_type" NOT NULL,
	"requested_by_user_id" integer,
	"owner_user_id" integer,
	"impact_summary" text,
	"cost_impact" real,
	"schedule_impact_days" integer,
	"status" "change_request_status" DEFAULT 'draft' NOT NULL,
	"approval_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"cause" text,
	"client_linked" boolean DEFAULT false,
	"revenue_impact" numeric(15, 2),
	"cos_impact" numeric(15, 2),
	"margin_impact" numeric(15, 2),
	"evidence_link" text,
	"final_decision" text,
	"deleted_at" timestamp,
	"deleted_by" integer,
	"delete_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"legal_entity_name" text,
	"trading_name" text,
	"client_type" text,
	"billing_entity" text,
	"primary_contact_name" text,
	"primary_contact_email" text,
	"primary_contact_phone" text,
	"secondary_contact_name" text,
	"secondary_contact_email" text,
	"industry" text,
	"pipedrive_org_id" text,
	"status" text DEFAULT 'active',
	CONSTRAINT "clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dashboard_program_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"total_projects" integer DEFAULT 0 NOT NULL,
	"active_projects" integer DEFAULT 0 NOT NULL,
	"total_program_revenue" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total_program_cost" numeric(15, 2) DEFAULT '0' NOT NULL,
	"received_revenue" numeric(15, 2) DEFAULT '0' NOT NULL,
	"paid_cost" numeric(15, 2) DEFAULT '0' NOT NULL,
	"avg_margin" numeric(8, 4),
	"projects_at_risk" integer DEFAULT 0 NOT NULL,
	"total_tasks_overdue" integer DEFAULT 0 NOT NULL,
	"total_open_warnings" integer DEFAULT 0 NOT NULL,
	"last_refreshed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dashboard_project_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"total_revenue" numeric(15, 2) DEFAULT '0' NOT NULL,
	"received_revenue" numeric(15, 2) DEFAULT '0' NOT NULL,
	"outstanding_revenue" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(15, 2) DEFAULT '0' NOT NULL,
	"paid_cost" numeric(15, 2) DEFAULT '0' NOT NULL,
	"outstanding_cost" numeric(15, 2) DEFAULT '0' NOT NULL,
	"margin_pct" numeric(8, 4),
	"task_count" integer DEFAULT 0 NOT NULL,
	"tasks_completed" integer DEFAULT 0 NOT NULL,
	"tasks_in_progress" integer DEFAULT 0 NOT NULL,
	"tasks_overdue" integer DEFAULT 0 NOT NULL,
	"tasks_active" integer DEFAULT 0 NOT NULL,
	"open_warnings" integer DEFAULT 0 NOT NULL,
	"qc_progress_pct" numeric(8, 4),
	"health_score" numeric(5, 2),
	"phase" text,
	"rag_status" text,
	"contract_value" numeric(15, 2),
	"project_name" text,
	"pm" text,
	"pd" text,
	"last_refreshed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_project_metrics_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "derived_project_kpis" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_key" text NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer,
	"phase" text,
	"size_kwp" numeric(12, 2),
	"contract_value" numeric(15, 2),
	"rag_status" text,
	"pm" text,
	"pd" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"total_planned_revenue" numeric(15, 2),
	"total_actual_revenue" numeric(15, 2),
	"revenue_realised" numeric(15, 2),
	"revenue_outstanding" numeric(15, 2),
	"total_planned_expenses" numeric(15, 2),
	"total_actual_expenses" numeric(15, 2),
	"cos_realised" numeric(15, 2),
	"expenses_outstanding" numeric(15, 2),
	"gross_profit" numeric(15, 2),
	"gross_margin_pct" numeric(8, 4),
	"avg_actual_pct_complete" numeric(8, 4),
	"avg_expected_pct_complete" numeric(8, 4),
	"schedule_delta" numeric(8, 4),
	"task_count" integer DEFAULT 0 NOT NULL,
	"expense_line_count" integer DEFAULT 0 NOT NULL,
	"revenue_line_count" integer DEFAULT 0 NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"needs_review_reason" text,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "derived_project_kpis_project_key_unique" UNIQUE("project_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "execution_gate_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"action" text NOT NULL,
	"previous_status" text,
	"new_status" text,
	"reason" text,
	"changed_by_user_id" integer,
	"changed_by_role" text,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "home_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_date" text NOT NULL,
	"prepared_by" text,
	"highlights_notes" text,
	"construction_notes" text,
	"finance_notes" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "key_date_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer,
	"key_date_name" text NOT NULL,
	"source_task_id" integer,
	"source_task_code" text,
	"source_task_name_match" text,
	"date_field" text DEFAULT 'dueDate' NOT NULL,
	"precedence_rule" text DEFAULT 'actual_over_planned' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merge_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"primary_project_id" integer NOT NULL,
	"secondary_project_id" integer NOT NULL,
	"primary_project_name" text NOT NULL,
	"secondary_project_name" text NOT NULL,
	"merged_by_user_id" integer,
	"merged_by_role" text,
	"reason" text,
	"conflicts_json" text,
	"moved_task_count" integer DEFAULT 0 NOT NULL,
	"moved_plan_count" integer DEFAULT 0 NOT NULL,
	"merged_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "monthly_report_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_type" varchar(20) NOT NULL,
	"report_month" varchar(7) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"data" jsonb NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"regenerated_at" timestamp,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"published_by" integer,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_report_snapshots_type_month_unique" UNIQUE("report_type","report_month")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "normalized_execution_phases" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"project_name" text NOT NULL,
	"phase_name" text NOT NULL,
	"phase_date" text,
	"source" "phase_source" DEFAULT 'EXCEL_IMPORT' NOT NULL,
	"import_run_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"pipedrive_deal_id" text,
	"client_id" integer,
	"site_id" integer,
	"deal_owner_user_id" integer,
	"stage" text DEFAULT 'prospect',
	"contract_type" text,
	"funding_type" text,
	"estimated_value" numeric(15, 2),
	"estimated_kwp" numeric(12, 2),
	"estimated_kwh" numeric(15, 2),
	"proposal_issued_date" date,
	"expected_close_date" date,
	"signed_date" date,
	"handover_readiness" text DEFAULT 'not_ready',
	"commercial_risks" text,
	"notes" text,
	"status" text DEFAULT 'active',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pd_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer,
	"client_name_snapshot" text,
	"project_id" integer,
	"project_site_name" text NOT NULL,
	"due_date" text,
	"request_type" text NOT NULL,
	"priority" text DEFAULT 'Medium' NOT NULL,
	"status" text DEFAULT 'Draft' NOT NULL,
	"number_of_reworks" integer DEFAULT 0 NOT NULL,
	"project_developer_user_id" integer,
	"designer_user_id" integer,
	"funding_type" text,
	"size_kwp" numeric(12, 2),
	"province" text,
	"gps_coordinates" text,
	"bills_or_tariff_data" boolean DEFAULT false,
	"metering_data_available" boolean DEFAULT false,
	"site_inspection_form" boolean DEFAULT false,
	"site_inspection_link" text,
	"working_schedule" text,
	"batteries_needed" boolean DEFAULT false,
	"battery_size" numeric(12, 2),
	"diesel_gen_integration" boolean DEFAULT false,
	"roof_replacement_needed" boolean DEFAULT false,
	"hse_discussed" boolean DEFAULT false,
	"comments" text,
	"estimated_project_value" numeric(14, 2),
	"estimated_cost" numeric(14, 2),
	"estimated_margin" numeric(14, 2),
	"estimated_margin_percent" numeric(6, 2),
	"financial_notes" text,
	"clickup_synced" boolean DEFAULT false,
	"tasks_spawned_at" timestamp,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "phase_template" (
	"id" serial PRIMARY KEY NOT NULL,
	"phase" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "phase_template_application" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"phase" text NOT NULL,
	"template_id" integer NOT NULL,
	"template_version" integer NOT NULL,
	"applied_by_user_id" integer,
	"applied_at" timestamp DEFAULT now() NOT NULL,
	"application_key" text NOT NULL,
	"result_summary_json" jsonb,
	CONSTRAINT "phase_template_application_application_key_unique" UNIQUE("application_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "phase_template_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"item_key" text NOT NULL,
	"item_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"primary_workstream" text,
	"default_status" text,
	"default_priority" text,
	"offset_days_from_phase_start" integer,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"approver_role" text,
	"link_target_type" text DEFAULT 'NONE' NOT NULL,
	"link_target_key" text,
	"deliverable_type_key" text,
	"requires_qc_approval" boolean DEFAULT false NOT NULL,
	"requires_operational_approval" boolean DEFAULT false NOT NULL,
	"quality_item_key" text,
	"evidence_required" boolean DEFAULT false NOT NULL,
	"view_key" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "phase_template_item_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_item_id" integer NOT NULL,
	"changed_by_user_id" integer,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"change_json" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolio_rollout_phases" (
	"id" serial PRIMARY KEY NOT NULL,
	"rollout_plan_id" integer NOT NULL,
	"phase_name" text NOT NULL,
	"start_date" text,
	"end_date" text,
	"target_kwp" numeric(12, 2),
	"target_revenue" numeric(15, 2),
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolio_rollout_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"portfolio_id" integer NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolios" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"client_name" text,
	"status" text DEFAULT 'Active' NOT NULL,
	"description" text,
	"owner_user_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_client_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"old_client_id" integer,
	"new_client_id" integer,
	"moved_by_user_id" integer NOT NULL,
	"moved_at" timestamp DEFAULT now() NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_editable_fields" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer,
	"cost_proposal_signed" text,
	"funding_signed" text,
	"epc_contract_signed" text,
	"cost_proposal_type" text,
	"cost_proposal_link" text,
	"cost_proposal_na_reason" text,
	"funding_type" text,
	"funding_link" text,
	"funding_na_reason" text,
	"epc_contract_type" text,
	"epc_contract_link" text,
	"epc_contract_na_reason" text,
	"province" text,
	"current_vo_total" numeric(15, 2),
	"comments" text,
	"latest_update" text,
	"latest_update_at" timestamp,
	"latest_update_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_editable_fields_project_name_unique" UNIQUE("project_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"event_timestamp" timestamp DEFAULT now() NOT NULL,
	"actor_user_id" integer,
	"actor_role" text,
	"source_entity_type" text NOT NULL,
	"source_entity_id" text NOT NULL,
	"summary" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb,
	"visibility" jsonb DEFAULT '{"scope":"project"}'::jsonb,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_project_events_idempotency" UNIQUE("project_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_execution_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"phase" text,
	"phase_updated_at" timestamp,
	"phase_updated_by_user_id" integer,
	"phase_notes" text,
	"pd_handover_date" date,
	"construction_start_date" date,
	"commissioning_date" date,
	"om_handover_date" date,
	"client_handover_date" date,
	"construction_start_actual" date,
	"pd_handover_actual" date,
	"commissioning_actual" date,
	"client_handover_actual" date,
	"escalation_level" text,
	"rag_status" text,
	"rag_comment" text,
	"rag_updated_at" timestamp,
	"rag_updated_by_user_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"archived_status" text DEFAULT 'ACTIVE' NOT NULL,
	"execution_enabled" boolean DEFAULT false NOT NULL,
	"execution_gate_status" text DEFAULT 'NOT_ELIGIBLE' NOT NULL,
	"execution_gate_reason" text,
	"execution_phase" text,
	"signed_status" text DEFAULT 'NONE' NOT NULL,
	"signed_date" date,
	"signed_document_link" text,
	"cp_signed" boolean DEFAULT false NOT NULL,
	"cp_signed_date" date,
	"cp_signed_by_user_id" integer,
	"cp_evidence_type" text,
	"cp_evidence_ref" text,
	"pm_task_pack_created" boolean DEFAULT false NOT NULL,
	"eng_post_cp_task_pack_created" boolean DEFAULT false NOT NULL,
	"construction_manager_user_id" integer,
	"quality_lead_user_id" integer,
	"engineering_lead_user_id" integer,
	"program_manager_user_id" integer,
	"project_finance_user_id" integer,
	"matriarch_handover_target" date,
	"practical_completion_target" date,
	"practical_completion_actual" date,
	"cost_baseline" numeric(15, 2),
	"margin_baseline" numeric(8, 4),
	"current_stage_code" text,
	"gate_status" text,
	"gate_readiness_pct" integer,
	"waiting_on_department" text,
	"waiting_on_user_id" integer,
	"next_required_action" text,
	"stage_owner_user_id" integer,
	"stage_approver_user_id" integer,
	"kam_user_id" integer,
	"site_establishment_date" date,
	"site_establishment_actual" date,
	"financial_review_status" text DEFAULT 'NOT_STARTED' NOT NULL,
	"financial_review_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_execution_state_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_financial_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"budget_baseline_id" integer,
	"snapshot_budget_total" numeric(15, 2),
	"snapshot_actual_total" numeric(15, 2),
	"snapshot_variance" numeric(15, 2),
	"snapshot_variance_pct" numeric(8, 4),
	"snapshot_margin" numeric(8, 4),
	"snapshot_contingency_remaining" numeric(15, 2),
	"snapshot_procurement_readiness" real,
	"snapshot_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"snapshot_captured_at" timestamp,
	"review_date" date,
	"review_meeting_ref" text,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"budget_review" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"procurement_review" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scope_review" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"logistics_review" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hse_review" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outcome" text,
	"outcome_conditions" text,
	"outcome_notes" text,
	"requested_by_user_id" integer,
	"reviewed_by_user_id" integer,
	"approved_by_user_id" integer,
	"approved_at" timestamp,
	"approval_id" integer,
	"gate_evaluation_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_gate_evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"gate_name" text NOT NULL,
	"from_stage" text,
	"target_stage" text NOT NULL,
	"status" text NOT NULL,
	"missing_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"has_override" boolean DEFAULT false NOT NULL,
	"override_id" integer,
	"evaluated_by_user_id" integer,
	"evaluated_by_role" text,
	"evaluated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_handover_gates" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"gate_id" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"checked_items" jsonb DEFAULT '[]'::jsonb,
	"completed_at" timestamp,
	"completed_by_user_id" integer,
	"completed_by_name" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_handover_gates_project_gate_unique" UNIQUE("project_id","gate_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_handover_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"gate_id" text NOT NULL,
	"action" text NOT NULL,
	"performed_by_user_id" integer,
	"performed_by_name" text,
	"performed_by_role" text,
	"details" jsonb,
	"performed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_info" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"size_kwp" numeric(12, 2),
	"pd" text,
	"pm" text,
	"contract_value" numeric(15, 2),
	"canonical_project_id" integer,
	"client_id" integer,
	"pm_user_id" integer,
	"pd_user_id" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"site_id" integer,
	"opportunity_id" integer,
	"delivery_model" text,
	"project_code" text,
	CONSTRAINT "project_info_project_name_unique" UNIQUE("project_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_linkage_review_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"record_id" integer NOT NULL,
	"reason" text NOT NULL,
	"context_json" jsonb,
	"resolved_at" timestamp,
	"resolved_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_linkage_review_queue_table_record_unique" UNIQUE("table_name","record_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_pd_pm_handover" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"handover_status_text" text,
	"pd_owner" text,
	"pm_owner" text,
	"summary" text,
	"risks" text,
	"assumptions" text,
	"engineering_status" text,
	"quality_status" text,
	"notes_to_pm" text,
	"handover_summary" text,
	"deliverables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp,
	"accepted_by" text,
	"accepted_at" timestamp,
	"rejected_by" text,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"feasibility_status" text,
	"feasibility_notes" text,
	"dependency_summary" text,
	"handover_readiness_status" text,
	"handover_readiness_notes" text,
	"handover_form_data" jsonb DEFAULT '{}'::jsonb,
	"readiness_checklist" jsonb DEFAULT '{}'::jsonb,
	"readiness_score" integer DEFAULT 0,
	"pd_sign_off_at" timestamp,
	"pd_sign_off_by" text,
	"pm_sign_off_at" timestamp,
	"pm_sign_off_by" text,
	"kickoff_date" date,
	"lessons_reviewed" boolean DEFAULT false,
	"version" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_pd_pm_handover_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_phase_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"from_phase" text,
	"to_phase" text NOT NULL,
	"changed_by_user_id" integer NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_portfolio_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"portfolio_id" integer NOT NULL,
	"assigned_by" integer,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"moved_by" integer,
	"moved_at" timestamp,
	CONSTRAINT "project_portfolio_assignments_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_rag_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"from_rag" text,
	"to_rag" text NOT NULL,
	"comment" text NOT NULL,
	"changed_by_user_id" integer NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_revenue_summary" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"planned_revenue" numeric(15, 2),
	"planned_expenditure" numeric(15, 2),
	"planned_profit" numeric(15, 2),
	"planned_margin" numeric(6, 4),
	"actual_revenue" numeric(15, 2),
	"actual_expenditure" numeric(15, 2),
	"actual_profit" numeric(15, 2),
	"actual_margin" numeric(6, 4),
	"vo_pm_limit" numeric(15, 2),
	"current_vo_total" numeric(15, 2),
	"project_id" integer NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"snapshot_run_id" integer,
	CONSTRAINT "project_revenue_summary_project_name_unique" UNIQUE("project_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"excel_tracker_link" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_settings_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_subcontractor_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"counterparty_id" integer NOT NULL,
	"work_package" text,
	"scope_description" text,
	"owner_user_id" integer,
	"status" "subcontractor_assignment_status" DEFAULT 'active' NOT NULL,
	"key_dates" jsonb,
	"performance_notes" text,
	"linked_approval_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_team_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer,
	"user_id" integer NOT NULL,
	"role_on_project" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "raid_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"type" "raid_type" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"owner_user_id" integer,
	"status" "raid_status" DEFAULT 'open' NOT NULL,
	"priority" "raid_priority" DEFAULT 'medium' NOT NULL,
	"due_date" text,
	"mitigation_response" text,
	"linked_task_id" integer,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"deleted_at" timestamp,
	"deleted_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scenarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer,
	"site_name" text NOT NULL,
	"address" text,
	"gps_lat" numeric(10, 7),
	"gps_lng" numeric(10, 7),
	"municipality" text,
	"utility_authority" text,
	"landlord" text,
	"tenant" text,
	"roof_type" text,
	"site_constraints" text,
	"hse_constraints" text,
	"access_rules" text,
	"status" text DEFAULT 'active',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stage_gate_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"gate_name" text NOT NULL,
	"from_stage" text NOT NULL,
	"target_stage" text NOT NULL,
	"requirement_type" text NOT NULL,
	"requirement_key" text NOT NULL,
	"requirement_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stage_gate_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"gate_name" text NOT NULL,
	"target_stage" text NOT NULL,
	"override_reason" text NOT NULL,
	"overridden_by" integer,
	"overridden_by_role" text NOT NULL,
	"note" text,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_project_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer,
	"folder_name" text NOT NULL,
	"folder_path" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "available_payment_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_start_date" date NOT NULL,
	"previous_value" numeric(15, 2),
	"new_value" numeric(15, 2) NOT NULL,
	"computed_value" numeric(15, 2),
	"reason" text,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"changed_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "available_payment_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_start_date" date NOT NULL,
	"override_value" numeric(15, 2) NOT NULL,
	"reason" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "available_payment_overrides_week_start_date_unique" UNIQUE("week_start_date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_baselines" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"revenue_baseline" numeric(15, 2),
	"cos_baseline" numeric(15, 2),
	"margin_baseline" numeric(15, 2),
	"contingency" numeric(15, 2),
	"approved_by_user_id" integer,
	"approved_date" timestamp,
	"change_locked" boolean DEFAULT false,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "budget_baselines_project_version_unique" UNIQUE("project_id","version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cashflow_balance_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_start_date" date NOT NULL,
	"previous_value" numeric(15, 2),
	"new_value" numeric(15, 2) NOT NULL,
	"computed_value" numeric(15, 2),
	"delta" numeric(15, 2),
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"changed_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cashflow_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"series_name" text NOT NULL,
	"point_date" date NOT NULL,
	"value" numeric(15, 2),
	"project_id" integer NOT NULL,
	"source" "row_source" DEFAULT 'imported' NOT NULL,
	"import_snapshot" jsonb,
	"last_edited_by" integer,
	"last_edited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"snapshot_run_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cashflow_weekly_manual" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_start_date" date NOT NULL,
	"opening_balance" numeric(15, 2),
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cashflow_weekly_manual_week_start_date_unique" UNIQUE("week_start_date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "counterparties" (
	"id" serial PRIMARY KEY NOT NULL,
	"name_canonical" text NOT NULL,
	"name_aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"type_default" "counterparty_type" DEFAULT 'OTHER' NOT NULL,
	"is_core" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"role_tags" text[] DEFAULT '{}' NOT NULL,
	"vat_number" text,
	"registration_number" text,
	"address" text,
	"contact_person" text,
	"contact_phone" text,
	"contact_email" text,
	"bank_name" text,
	"bank_account_number" text,
	"bank_branch_code" text,
	"payment_terms" text,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "counterparty_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"counterparty_id" integer NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"title" text,
	"role_tags" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"notes" text,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expense_task_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer,
	"expense_id" integer NOT NULL,
	"task_id" integer NOT NULL,
	"date_override" date,
	"date_override_reason" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_cos_monthly" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer NOT NULL,
	"category" text NOT NULL,
	"month_end_date" date NOT NULL,
	"value" numeric(15, 2),
	"source" "row_source" DEFAULT 'imported' NOT NULL,
	"import_snapshot" jsonb,
	"last_edited_by" integer,
	"last_edited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"snapshot_run_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_revenue_monthly" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer NOT NULL,
	"category" text NOT NULL,
	"month_end_date" date NOT NULL,
	"value" numeric(15, 2),
	"source" "row_source" DEFAULT 'imported' NOT NULL,
	"import_snapshot" jsonb,
	"last_edited_by" integer,
	"last_edited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"snapshot_run_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_edit_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer,
	"requested_by_user_id" integer NOT NULL,
	"edit_type" text NOT NULL,
	"edit_target" text NOT NULL,
	"edit_payload" text NOT NULL,
	"edit_summary" text NOT NULL,
	"is_critical_path" boolean DEFAULT false NOT NULL,
	"affects_revenue" boolean DEFAULT false NOT NULL,
	"affects_expenditure" boolean DEFAULT false NOT NULL,
	"affects_quality" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" integer,
	"review_comment" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "financial_integration_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer,
	"rule_type" text NOT NULL,
	"rule_config" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"created_by_user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fiscal_periods" (
	"id" serial PRIMARY KEY NOT NULL,
	"fiscal_year_id" integer NOT NULL,
	"period_name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fiscal_years" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_years_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forecast_pipeline" (
	"id" serial PRIMARY KEY NOT NULL,
	"fye_year" integer DEFAULT 2026 NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer,
	"project_developer" text,
	"location" text,
	"size_kwp" numeric(12, 2),
	"deal_probability_pct" integer DEFAULT 75 NOT NULL,
	"forecast_signature_date" date,
	"solar_revenue" numeric(15, 2) DEFAULT '0',
	"bess_revenue" numeric(15, 2) DEFAULT '0',
	"forecast_gp_pct" numeric(6, 4),
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fye_budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"project_name" text NOT NULL,
	"fye" text NOT NULL,
	"month_key" text NOT NULL,
	"budget_type" text NOT NULL,
	"amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fye_kpi_counters" (
	"id" serial PRIMARY KEY NOT NULL,
	"fye_year" integer NOT NULL,
	"brought_in" integer DEFAULT 0 NOT NULL,
	"signed" integer DEFAULT 0 NOT NULL,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fye_kpi_counters_fye_year_unique" UNIQUE("fye_year")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fye_report_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"fye_year" integer NOT NULL,
	"snapshot_month" integer NOT NULL,
	"snapshot_date" date NOT NULL,
	"snapshot_label" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"snapshot_data" text NOT NULL,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"submitted_by" integer,
	"submitted_at" timestamp,
	"approved_by" integer,
	"approved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_captures" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"supplier_id" integer,
	"invoice_number" text,
	"invoice_date" date,
	"amount" real,
	"vat_amount" real,
	"linked_po_id" integer,
	"linked_procurement_item_id" integer,
	"status" "invoice_capture_status" DEFAULT 'captured' NOT NULL,
	"captured_by_user_id" integer,
	"document_path" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"qb_sync_status" text DEFAULT 'not_synced',
	"document_drive_id" text,
	"document_item_id" text,
	"deleted_at" timestamp,
	"deleted_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_pattern_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_run_id" integer,
	"project_id" integer,
	"invoice_number_raw" text,
	"invoice_number_norm" text,
	"matched_rule_id" integer,
	"inferred_type" "counterparty_type" DEFAULT 'OTHER' NOT NULL,
	"inferred_counterparty_id" integer,
	"confidence_score" integer DEFAULT 0 NOT NULL,
	"outcome" "pattern_match_outcome" DEFAULT 'UNRESOLVED' NOT NULL,
	"source_row" integer,
	"override_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoice_pattern_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"pattern_type" "pattern_type" NOT NULL,
	"pattern_value" text NOT NULL,
	"normalized_example" text,
	"counterparty_id" integer,
	"counterparty_name" text,
	"inferred_type" "counterparty_type" NOT NULL,
	"confidence_weight" integer DEFAULT 50 NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_confirmed_at" timestamp,
	"times_matched" integer DEFAULT 0 NOT NULL,
	"times_confirmed" integer DEFAULT 0 NOT NULL,
	"times_overridden" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lost_deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"fye_year" integer DEFAULT 2026 NOT NULL,
	"deal_name" text NOT NULL,
	"deal_value" numeric(15, 2),
	"business_developer" text,
	"lost_reason" text,
	"lost_date" date,
	"notes" text,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "milestone_task_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer,
	"milestone_row_number" integer NOT NULL,
	"task_id" integer NOT NULL,
	"date_override" date,
	"date_override_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "normalized_cost_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"project_name" text NOT NULL,
	"cost_category" text,
	"counterparty_id" integer,
	"counterparty_name" text,
	"counterparty_type" "counterparty_type",
	"description" text,
	"amount_ex_vat" numeric(15, 2),
	"amount_ex_vat_legacy" text,
	"invoice_number" text,
	"invoice_date" date,
	"invoice_date_font_color" text,
	"invoice_date_confirmed" boolean,
	"approved_date" date,
	"paid_date" date,
	"paid_date_font_color" text,
	"paid_date_confirmed" boolean,
	"po_number" text,
	"cos_realised" boolean,
	"cashflow_confirmed" boolean,
	"cost_line_status" "cost_line_status" DEFAULT 'PLANNED' NOT NULL,
	"source_sheet" text,
	"source_row" integer,
	"import_run_id" integer NOT NULL,
	"turnaround_days" integer,
	"pattern_rule_id" integer,
	"pattern_classified_at" timestamp,
	"pattern_inferred_type" text,
	"no_revenue_linked" boolean DEFAULT false,
	"budget_qty" text,
	"budget_rate" text,
	"budget_total" text,
	"budget_cos" text,
	"revenue_recognition_amount" text,
	"forecast_payment_date" date,
	"admin_date_override" date,
	"admin_date_override_reason" text,
	"admin_date_override_by" integer,
	"admin_date_override_at" timestamp,
	"sub_project_name" text,
	"cos_status_override" text,
	"cos_status_override_by" integer,
	"cos_status_override_at" timestamp,
	"cos_status_override_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"snapshot_run_id" integer,
	"idempotency_key" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "normalized_revenue_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"project_name" text NOT NULL,
	"description" text,
	"milestone_name" text,
	"amount_ex_vat" numeric(15, 2),
	"vat" numeric(15, 2),
	"amount_ex_vat_legacy" text,
	"vat_legacy" text,
	"invoice_number" text,
	"invoice_date" date,
	"invoice_date_font_color" text,
	"invoice_date_confirmed" boolean,
	"expected_payment_date" date,
	"paid_date" date,
	"paid_date_font_color" text,
	"paid_date_confirmed" boolean,
	"in_bank_date" date,
	"status" "revenue_line_status" DEFAULT 'PLANNED' NOT NULL,
	"source_sheet" text,
	"source_row" integer,
	"import_run_id" integer NOT NULL,
	"turnaround_days" integer,
	"admin_date_override" date,
	"admin_date_override_reason" text,
	"admin_date_override_by" integer,
	"admin_date_override_at" timestamp,
	"sub_project_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"snapshot_run_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opex_budget_monthly" (
	"id" serial PRIMARY KEY NOT NULL,
	"month_key" text NOT NULL,
	"amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "opex_budget_monthly_month_key_unique" UNIQUE("month_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opex_weekly_manual" (
	"id" serial PRIMARY KEY NOT NULL,
	"week_start_date" date NOT NULL,
	"opex_amount" numeric(15, 2) NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "opex_weekly_manual_week_start_date_unique" UNIQUE("week_start_date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_batch_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_batch_id" integer NOT NULL,
	"payment_request_id" integer NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_number" text NOT NULL,
	"cutoff_date" date NOT NULL,
	"total_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"status" "payment_batch_status" DEFAULT 'preparing' NOT NULL,
	"prepared_by_user_id" integer NOT NULL,
	"approved_by_user_id" integer,
	"released_by_user_id" integer,
	"approval_id" integer,
	"approved_at" timestamp,
	"released_at" timestamp,
	"confirmed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_batches_batch_number_unique" UNIQUE("batch_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"purchase_order_id" integer,
	"invoice_capture_id" integer,
	"counterparty_id" integer,
	"procurement_item_id" integer,
	"amount" numeric(15, 2) NOT NULL,
	"due_date" date,
	"status" "payment_request_status" DEFAULT 'new' NOT NULL,
	"submitted_by_user_id" integer NOT NULL,
	"cutoff_date" date,
	"evidence_evaluation_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_terms" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_name" text NOT NULL,
	"terms_days" integer NOT NULL,
	"scenario" text DEFAULT 'base' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "po_review_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"purchase_order_id" integer NOT NULL,
	"reviewer_user_id" integer NOT NULL,
	"reviewer_role" text NOT NULL,
	"decision" "po_review_decision" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "procurement_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" "procurement_category" DEFAULT 'other' NOT NULL,
	"quantity" real,
	"unit" text,
	"expected_cost" real,
	"actual_cost" real,
	"supplier_id" integer,
	"requested_by_user_id" integer,
	"owner_user_id" integer,
	"status" "procurement_status" DEFAULT 'requested' NOT NULL,
	"required_date" date,
	"po_id" integer,
	"invoice_ref" text,
	"linked_invoice_capture_id" integer,
	"budget_line" text,
	"linked_deliverable_id" integer,
	"linked_milestone" text,
	"progress_percent" real,
	"receipt_ref" text,
	"payment_status" "procurement_payment_status" DEFAULT 'not_applicable' NOT NULL,
	"linked_task_id" integer,
	"approval_id" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"requisition_status" text DEFAULT 'none',
	"rfq_sent_date" date,
	"quote_received_date" date,
	"quote_amount" numeric(15, 2),
	"boq_reference" text,
	"delivery_expected_date" date,
	"delivery_actual_date" date,
	"delivery_status" text DEFAULT 'not_ordered',
	"is_long_lead" boolean DEFAULT false,
	"deleted_at" timestamp,
	"deleted_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "program_expense" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"row_number" integer,
	"row_type" text DEFAULT 'item',
	"expense_category" text,
	"expense_line_item" text,
	"budget_qty" numeric(12, 4),
	"budget_rate_unit" numeric(15, 2),
	"budget_total" numeric(15, 2),
	"forecast_payment_date" date,
	"budget_cos_total" numeric(15, 2),
	"expense_qty" numeric(12, 4),
	"expense_rate_unit" numeric(15, 2),
	"expense_actual_total" numeric(15, 2),
	"expense_po_number" text,
	"expense_invoice_number" text,
	"expense_invoiced_date" date,
	"invoice_date_confirmed" boolean DEFAULT false,
	"invoice_date_font_color" text,
	"expense_payment_date" date,
	"payment_date_confirmed" boolean DEFAULT false,
	"payment_date_font_color" text,
	"revenue_amount" numeric(15, 2),
	"actual_cos_total" numeric(15, 2),
	"line_status" text,
	"expense_line_hash" text,
	"computed_state" text,
	"computed_forecast_payment_date" date,
	"admin_date_override" date,
	"admin_date_override_reason" text,
	"admin_date_override_by" integer,
	"admin_date_override_at" timestamp,
	"supplier_name" text,
	"is_manual" boolean DEFAULT false,
	"sub_project_name" text,
	"cos_status_override" text,
	"cos_status_override_by" integer,
	"cos_status_override_at" timestamp,
	"cos_status_override_reason" text,
	"data_source" text DEFAULT 'SMART_IMPORT',
	"project_id" integer NOT NULL,
	"import_run_id" integer,
	"source" "row_source" DEFAULT 'imported' NOT NULL,
	"import_snapshot" jsonb,
	"last_edited_by" integer,
	"last_edited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"snapshot_run_id" integer,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "program_inflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"row_number" integer,
	"milestone_no" text,
	"milestone_name" text,
	"milestone_percent" numeric(6, 4),
	"milestone_amount" numeric(15, 2),
	"planned_payment_date" date,
	"milestone_invoice_number" text,
	"invoice_raised_date" date,
	"payment_received_date" date,
	"milestone_notes" text,
	"documents_received" text,
	"in_bank" integer DEFAULT 0,
	"inflow_line_hash" text,
	"computed_forecast_receipt_date" date,
	"admin_date_override" date,
	"admin_date_override_reason" text,
	"admin_date_override_by" integer,
	"admin_date_override_at" timestamp,
	"sub_project_name" text,
	"data_source" text DEFAULT 'SMART_IMPORT',
	"project_id" integer NOT NULL,
	"import_run_id" integer,
	"source" "row_source" DEFAULT 'imported' NOT NULL,
	"import_snapshot" jsonb,
	"last_edited_by" integer,
	"last_edited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"effective_from" timestamp DEFAULT now() NOT NULL,
	"effective_to" timestamp,
	"snapshot_run_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_plan" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer NOT NULL,
	"row_number" integer,
	"task_no" text,
	"high_level_programme" text,
	"actual_start" date,
	"duration_days" integer,
	"actual_end" date,
	"actual_pct_complete" real,
	"expected_pct_complete" real,
	"source" "row_source" DEFAULT 'imported' NOT NULL,
	"import_snapshot" jsonb,
	"last_edited_by" integer,
	"last_edited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_plan_dependency" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer,
	"predecessor_task_id" integer NOT NULL,
	"successor_task_id" integer NOT NULL,
	"dependency_type" text DEFAULT 'FS' NOT NULL,
	"lag_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proof_of_payment" (
	"id" serial PRIMARY KEY NOT NULL,
	"payment_request_id" integer,
	"payment_batch_id" integer,
	"bank_reference" text,
	"document_drive_id" text,
	"document_item_id" text,
	"document_url" text,
	"uploaded_by_user_id" integer NOT NULL,
	"confirmed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"po_ref" text NOT NULL,
	"po_number" integer NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer,
	"supplier_name" text NOT NULL,
	"supplier_vat" text,
	"supplier_address" text,
	"supplier_contact" text,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal" numeric(15, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total" numeric(15, 2) DEFAULT '0' NOT NULL,
	"payment_terms" text,
	"delivery_date" text,
	"delivery_address" text,
	"site_contact" text,
	"comments" text,
	"project_manager" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"pdf_data" text,
	"idempotency_key" text,
	CONSTRAINT "purchase_orders_po_ref_unique" UNIQUE("po_ref")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "schedule_change_notice" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer,
	"summary" text NOT NULL,
	"old_finish_date" date,
	"new_finish_date" date,
	"changed_tasks" text,
	"critical_path_delta" text,
	"user_note" text,
	"client_notified" boolean DEFAULT false NOT NULL,
	"documentation_updated" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tr_item_project_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"tr_item_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"auto_created_pm_task_id" integer,
	"link_status" "tr_link_status" DEFAULT 'Linked' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tr_item_suggestion_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tr_item_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"decision" "tr_suggestion_decision" DEFAULT 'Suggested' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"rationale" text,
	"decided_at" timestamp,
	"decided_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tr_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"tr_id" text NOT NULL,
	"department" text NOT NULL,
	"action_description" text NOT NULL,
	"rag_status" "tr_rag_status" DEFAULT 'Green' NOT NULL,
	"owners" text[] DEFAULT '{}' NOT NULL,
	"owner_user_ids" integer[],
	"support" text[] DEFAULT '{}' NOT NULL,
	"date_raised" timestamp,
	"due_date" timestamp,
	"status" "tr_status" DEFAULT 'Active' NOT NULL,
	"date_completed" timestamp,
	"outcome_comments" text,
	"supporting_info" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	"scheduled_date" date,
	"scheduled_start_time" text,
	"scheduled_end_time" text,
	CONSTRAINT "tr_items_tr_id_unique" UNIQUE("tr_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tracker_monthly_manual" (
	"id" serial PRIMARY KEY NOT NULL,
	"tracker_type" text NOT NULL,
	"month_key" text NOT NULL,
	"realised" numeric(15, 2),
	"outstanding" numeric(15, 2),
	"budget" numeric(15, 2),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "weekly_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer,
	"week_starting" date NOT NULL,
	"reviewed_by" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"step_schedule" jsonb,
	"step_budget" jsonb,
	"step_risks" jsonb,
	"step_quality" jsonb,
	"step_actions" jsonb,
	"step_summary" jsonb,
	"snapshot_metrics" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "working_plan_dependency_override" (
	"id" serial PRIMARY KEY NOT NULL,
	"scenario_id" integer NOT NULL,
	"imported_dependency_id" integer,
	"predecessor_task_id" integer NOT NULL,
	"successor_task_id" integer NOT NULL,
	"dependency_type" text DEFAULT 'FS' NOT NULL,
	"lag_days" integer DEFAULT 0 NOT NULL,
	"deleted_flag" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "working_plan_scenario" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer,
	"name" text DEFAULT 'Working Plan' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "writeback_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"mapping_id" integer,
	"workbook_path" text NOT NULL,
	"sheet_name" text NOT NULL,
	"cell_address" text NOT NULL,
	"previous_value" text,
	"new_value" text NOT NULL,
	"status" text DEFAULT 'applied' NOT NULL,
	"project_id" text,
	"actor_id" integer,
	"error_message" text,
	"applied_at" timestamp DEFAULT now() NOT NULL,
	"rolled_back_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "writeback_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"project_name" text,
	"project_id" integer,
	"workbook_path" text NOT NULL,
	"sheet_name" text NOT NULL,
	"cell_address" text NOT NULL,
	"source_field" text NOT NULL,
	"entity_type" text NOT NULL,
	"data_transform" text,
	"validation_rule" text,
	"allowed_roles" text[],
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deliverable_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"deliverable_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"feedback_text" text,
	"actor_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deliverable_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"deliverable_id" integer NOT NULL,
	"version_id" integer,
	"site_id" text,
	"drive_id" text,
	"file_item_id" text,
	"file_name" text NOT NULL,
	"web_url" text,
	"is_approved" boolean DEFAULT false NOT NULL,
	"uploaded_by_user_id" integer,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deliverable_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"deliverable_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"change_reason" text,
	"impact_json" jsonb,
	"status" text DEFAULT 'IN PROGRESS' NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deliverables" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"project_name" text NOT NULL,
	"deliverable_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"phase" text,
	"owner_user_id" integer,
	"reviewer_user_id" integer,
	"qc_reviewer_user_id" integer,
	"status" text DEFAULT 'TO DO' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"sharepoint_folder_site_id" text,
	"sharepoint_folder_drive_id" text,
	"sharepoint_folder_item_id" text,
	"linked_plan_item_id" integer,
	"linked_quality_item_instance_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"scheduled_date" text,
	"scheduled_start_time" text,
	"scheduled_end_time" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drawing_register" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"drawing_number" text NOT NULL,
	"title" text NOT NULL,
	"discipline" text,
	"current_revision" text DEFAULT 'A',
	"revision_date" date,
	"status" text DEFAULT 'draft',
	"author_user_id" integer,
	"reviewer_user_id" integer,
	"approver_user_id" integer,
	"sharepoint_link" text,
	"sheet_size" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drawing_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"drawing_id" integer NOT NULL,
	"revision" text NOT NULL,
	"revision_date" date NOT NULL,
	"description" text,
	"revised_by_user_id" integer,
	"sharepoint_link" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eng_deliverable_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"stage_template_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_required" boolean DEFAULT true NOT NULL,
	"allowed_file_types" text[],
	"required_count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eng_stage_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"purpose" text,
	"inputs" text[],
	"raci_responsible" text,
	"raci_accountable" text,
	"raci_consulted" text,
	"raci_informed" text,
	"failure_modes" text[],
	"stage_gate_rules" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eng_task_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"stage_template_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"is_required" boolean DEFAULT true NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"default_owner_role" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_eng_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_eng_stage_id" integer NOT NULL,
	"approver_role" text NOT NULL,
	"approver_user_id" integer,
	"status" "eng_approval_status" DEFAULT 'pending' NOT NULL,
	"comments" text,
	"scheduled_date" date,
	"scheduled_start_time" text,
	"scheduled_end_time" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_eng_deliverables" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_eng_stage_id" integer NOT NULL,
	"deliverable_template_id" integer,
	"project_eng_task_id" integer,
	"file_name" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"storage_ref" text NOT NULL,
	"uploaded_by" integer,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"version_tag" text,
	"notes" text,
	"sharepoint_folder_path" text,
	"approval_status" text DEFAULT 'pending',
	"approved_by" integer,
	"approved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_eng_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"stage_template_id" integer NOT NULL,
	"status" "eng_stage_status" DEFAULT 'not_started' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"override_reason" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_eng_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_eng_stage_id" integer NOT NULL,
	"task_template_id" integer NOT NULL,
	"status" "eng_task_instance_status" DEFAULT 'pending' NOT NULL,
	"owner_user_id" integer,
	"notes" text,
	"due_date" text,
	"completed_at" timestamp,
	"completed_by" integer,
	"has_deliverable" boolean DEFAULT false NOT NULL,
	"work_item_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_item_id" integer NOT NULL,
	"actor_id" integer,
	"action_type" text NOT NULL,
	"field_name" text,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_item_id" integer NOT NULL,
	"filename" text NOT NULL,
	"url" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"uploaded_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_checklist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"checklist_id" integer NOT NULL,
	"content" text NOT NULL,
	"is_done" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_checklists" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_item_id" integer NOT NULL,
	"title" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_item_id" integer NOT NULL,
	"author_id" integer,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_deliverables" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_item_id" integer NOT NULL,
	"filename" text NOT NULL,
	"original_name" text NOT NULL,
	"file_size" integer,
	"note" text,
	"sent_by_user_id" integer NOT NULL,
	"recipient_user_id" integer NOT NULL,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledged_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#6366f1' NOT NULL,
	"category" "task_tag_category" DEFAULT 'CUSTOM' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" integer,
	CONSTRAINT "task_tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_time_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_item_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"duration_minutes" integer NOT NULL,
	"description" text,
	"date" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task_watchers" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_item_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_item_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_item_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" "work_item_assignment_role" DEFAULT 'ASSIGNEE' NOT NULL,
	"allocation_pct" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_work_item_user_role" UNIQUE("work_item_id","user_id","role")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_item_dependencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"predecessor_id" integer NOT NULL,
	"successor_id" integer NOT NULL,
	"dep_type" "work_item_dep_type" DEFAULT 'FS' NOT NULL,
	"lag_days" integer DEFAULT 0,
	"deleted_at" timestamp,
	"deleted_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_item_engineering" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_item_id" integer NOT NULL,
	"wbs_code" text,
	"outline_number" text,
	"legacy_table" text,
	"legacy_id" integer,
	"source_row" integer,
	"source_sheet" text,
	"import_run_id" integer,
	CONSTRAINT "work_item_engineering_work_item_id_unique" UNIQUE("work_item_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_item_pm" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_item_id" integer NOT NULL,
	"duration" integer,
	"percent_complete" real DEFAULT 0,
	"expected_pct_complete" real,
	"phase" text,
	"is_milestone" boolean DEFAULT false,
	"indent_level" integer DEFAULT 0,
	"owner_name" text,
	"is_shared" boolean DEFAULT false NOT NULL,
	"hold_reason" text,
	"blocked_type" text,
	"blocker_reason" text,
	"approval_required" boolean DEFAULT false NOT NULL,
	"tracking_rag" text,
	"task_type_tag" text,
	"sub_project_name" text,
	"completed_at" timestamp,
	"linked_plan_item_id" integer,
	"linked_deliverable_id" integer,
	"linked_quality_item_instance_id" integer,
	CONSTRAINT "work_item_pm_work_item_id_unique" UNIQUE("work_item_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_item_scheduling" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_item_id" integer NOT NULL,
	"scheduled_date" date,
	"scheduled_start_time" text,
	"scheduled_end_time" text,
	"estimate_minutes" integer,
	"task_category" text,
	"baseline_start" date,
	"baseline_end" date,
	"baseline_duration" integer,
	"task_mode" text DEFAULT 'auto',
	"actual_start" date,
	"actual_end" date,
	"actual_duration" integer,
	"is_recurring" boolean DEFAULT false,
	"recurrence_frequency" text,
	"recurrence_interval" integer DEFAULT 1,
	"recurrence_days_of_week" text,
	"recurrence_end_date" date,
	"recurrence_parent_id" integer,
	CONSTRAINT "work_item_scheduling_work_item_id_unique" UNIQUE("work_item_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_item_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_item_id" integer NOT NULL,
	"old_status" text,
	"new_status" text NOT NULL,
	"changed_by" integer,
	"changed_at" timestamp DEFAULT now() NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_item_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_item_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_tags_unique" UNIQUE("work_item_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer,
	"project_id" integer,
	"workstream" "work_item_workstream" NOT NULL,
	"type" text,
	"source" "work_item_source" DEFAULT 'UI' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'Not Started' NOT NULL,
	"priority" text,
	"start_date" date,
	"end_date" date,
	"duration" integer,
	"percent_complete" real DEFAULT 0,
	"expected_pct_complete" real,
	"wbs_code" text,
	"outline_number" text,
	"indent_level" integer DEFAULT 0,
	"parent_id" integer,
	"is_milestone" boolean DEFAULT false,
	"phase" text,
	"owner_user_id" integer,
	"owner_name" text,
	"is_shared" boolean DEFAULT false NOT NULL,
	"external_ref" text,
	"legacy_table" text,
	"legacy_id" integer,
	"source_row" integer,
	"source_sheet" text,
	"import_run_id" integer,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"scheduled_date" date,
	"scheduled_start_time" text,
	"scheduled_end_time" text,
	"baseline_start" date,
	"baseline_end" date,
	"baseline_duration" integer,
	"task_mode" text DEFAULT 'auto',
	"actual_start" date,
	"actual_end" date,
	"actual_duration" integer,
	"sort_order" integer DEFAULT 0,
	"estimate_minutes" integer,
	"task_category" text,
	"is_recurring" boolean DEFAULT false,
	"recurrence_frequency" text,
	"recurrence_interval" integer DEFAULT 1,
	"recurrence_days_of_week" text,
	"recurrence_end_date" date,
	"recurrence_parent_id" integer,
	"sub_project_name" text,
	"hold_reason" text,
	"blocked_type" text,
	"approval_required" boolean DEFAULT false NOT NULL,
	"linked_plan_item_id" integer,
	"linked_deliverable_id" integer,
	"linked_quality_item_instance_id" integer,
	"completed_at" timestamp,
	"tracking_rag" text,
	"task_type_tag" text,
	"blocker_reason" text,
	"pd_ticket_id" integer,
	"bucket" text,
	"pinned_today" boolean DEFAULT false,
	"pinned_week" boolean DEFAULT false,
	"source_email_id" text,
	"source_email_subject" text,
	"next_step" text,
	"definition_of_done" text,
	"completion_note" text,
	CONSTRAINT "work_items_external_ref_unique" UNIQUE("external_ref")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commissioning_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"item_type" text DEFAULT 'commissioning' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"owner_user_id" integer,
	"due_date" text,
	"status" "commissioning_status" DEFAULT 'not_started' NOT NULL,
	"evidence_notes" text,
	"approval_id" integer,
	"gate_id" text,
	"category" text,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"deleted_at" timestamp,
	"deleted_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evidence_collected_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"completion_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text NOT NULL,
	"requirement_key" text,
	"evidence_type" "evidence_type" NOT NULL,
	"title" text,
	"value_ref" text,
	"value_json" jsonb,
	"uploaded_by_user_id" integer,
	"uploaded_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evidence_evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"completion_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text NOT NULL,
	"threshold_percent" real NOT NULL,
	"score_percent" real NOT NULL,
	"total_required" integer NOT NULL,
	"total_present" integer NOT NULL,
	"missing_items_json" jsonb,
	"pass" boolean NOT NULL,
	"evaluated_by_user_id" integer,
	"evaluated_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evidence_override_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"completion_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text NOT NULL,
	"score_percent" real NOT NULL,
	"threshold_percent" real NOT NULL,
	"reason" text NOT NULL,
	"authorized_by_user_id" integer NOT NULL,
	"authorized_by_name" text,
	"authorized_by_role" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evidence_requirement_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"completion_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_ref" text,
	"requirement_key" text NOT NULL,
	"label" text NOT NULL,
	"evidence_type" "evidence_type" NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"min_count" integer DEFAULT 1 NOT NULL,
	"threshold_percent" real,
	"config_json" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_access_challenge" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"role" text NOT NULL,
	"last_success_at" timestamp,
	"failed_attempts_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_checklist" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"project_name" text NOT NULL,
	"template_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_item_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"item_instance_id" integer NOT NULL,
	"evidence_url" text NOT NULL,
	"evidence_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_item_instance" (
	"id" serial PRIMARY KEY NOT NULL,
	"checklist_id" integer NOT NULL,
	"template_item_id" integer NOT NULL,
	"is_applicable" boolean DEFAULT true NOT NULL,
	"start_date" text,
	"end_date" text,
	"approved" boolean DEFAULT false NOT NULL,
	"approved_by_user_id" integer,
	"approved_at" timestamp,
	"approval_comment" text,
	"not_applicable_reason" text,
	"working_days" integer,
	"allowed_working_days" integer,
	"qm_status" text DEFAULT 'not_started' NOT NULL,
	"assignee_user_id" integer,
	"last_updated_at" timestamp DEFAULT now() NOT NULL,
	"scheduled_date" text,
	"scheduled_start_time" text,
	"scheduled_end_time" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_plan_link" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer,
	"plan_item_id" integer NOT NULL,
	"item_instance_id" integer,
	"phase_id" integer,
	"link_type" text DEFAULT 'phase_task' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_postmortem" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer,
	"completed_at" timestamp,
	"completed_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_postmortem_metric_value" (
	"id" serial PRIMARY KEY NOT NULL,
	"postmortem_id" integer NOT NULL,
	"template_metric_id" integer NOT NULL,
	"input_value_number" real,
	"input_value_choice" text,
	"score" real
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_postmortem_summary" (
	"id" serial PRIMARY KEY NOT NULL,
	"postmortem_id" integer NOT NULL,
	"contractor_quality_score" real,
	"engineering_quality_score" real,
	"red_flag" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_risk_answer" (
	"id" serial PRIMARY KEY NOT NULL,
	"checklist_id" integer NOT NULL,
	"template_risk_question_id" integer NOT NULL,
	"answer_yesno" boolean,
	"answer_text" text,
	"answer_number" real,
	"last_updated_by" integer,
	"last_updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_template" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_template_group" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_phase_id" integer NOT NULL,
	"group_name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_template_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_group_id" integer NOT NULL,
	"item_name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_evidence_required" boolean DEFAULT false NOT NULL,
	"default_severity" text DEFAULT 'Medium' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_template_phase" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"phase_key" text NOT NULL,
	"phase_name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_template_postmortem_metric" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"input_type" text DEFAULT 'count' NOT NULL,
	"scoring_rule_json" jsonb,
	"metric_group" text DEFAULT 'contractor_quality' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_template_risk_question" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_phase_id" integer NOT NULL,
	"question_text" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"response_type" text DEFAULT 'yesno' NOT NULL,
	"triggers_warning" boolean DEFAULT false NOT NULL,
	"trigger_condition" text DEFAULT 'yes',
	"trigger_severity" text DEFAULT 'Medium'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_warning" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer,
	"severity" text DEFAULT 'Medium' NOT NULL,
	"warning_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"related_plan_item_id" integer,
	"related_item_instance_id" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"owner_user_id" integer,
	"due_date" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qc_warning_event" (
	"id" serial PRIMARY KEY NOT NULL,
	"warning_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"note" text,
	"actor_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mytool_company_priorities" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"department" text,
	"horizon" "mytool_priority_horizon" DEFAULT 'week' NOT NULL,
	"owner_role" text,
	"linked_project_name" text,
	"linked_project_id" integer,
	"severity" "mytool_priority_severity" DEFAULT 'normal' NOT NULL,
	"status" "mytool_priority_status" DEFAULT 'active' NOT NULL,
	"priority_rank" integer,
	"assigned_to" text,
	"next_action" text,
	"support" text[],
	"definition_of_done" text,
	"due_date" text,
	"linked_task_id" integer,
	"linked_task_type" text,
	"accountable_exec_id" integer,
	"owner_user_id" integer,
	"target_start_date" text,
	"target_outcome" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"manual_health" text,
	"manual_progress" integer,
	"scope" "mytool_priority_scope" DEFAULT 'company' NOT NULL,
	"parent_id" integer,
	"department_key" text,
	"assigned_user_id" integer,
	"escalated" boolean DEFAULT false NOT NULL,
	"escalated_at" timestamp,
	"escalation_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mytool_daily_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" integer NOT NULL,
	"date" text NOT NULL,
	"top_outcomes" text,
	"what_moved" text,
	"blocked" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mytool_dod_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"department" text,
	"content" text NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mytool_email_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"sender" text,
	"email_date" text,
	"snippet" text,
	"outlook_message_id" text,
	"web_link" text,
	"linked_task_id" integer,
	"linked_operational_task_id" integer,
	"linked_priority_id" integer,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mytool_recurrence_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"project_name" text,
	"project_id" integer,
	"default_assignee_role" text,
	"checklist_items" jsonb,
	"frequency" "mytool_recurrence_frequency" NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"days_of_week" text,
	"start_date" text NOT NULL,
	"end_date" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mytool_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"allowed_roles" text DEFAULT 'admin' NOT NULL,
	"default_priority_horizon" text DEFAULT 'week' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mytool_timeblocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" integer NOT NULL,
	"date" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"label" text NOT NULL,
	"linked_task_id" integer,
	"outlook_event_id" text,
	"outlook_calendar_id" text,
	"idempotency_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mytool_user_preferences" (
	"owner_user_id" integer PRIMARY KEY NOT NULL,
	"today_layout" text,
	"default_view" text DEFAULT 'today' NOT NULL,
	"workday_start_time" text DEFAULT '08:00' NOT NULL,
	"workday_end_time" text DEFAULT '17:00' NOT NULL,
	"show_company_priorities" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "priority_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"priority_id" integer NOT NULL,
	"link_type" text NOT NULL,
	"project_name" text,
	"project_id" integer,
	"task_id" integer,
	"task_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "priority_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"priority_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"linked_by" integer,
	"linked_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "priority_projects_unique" UNIQUE("priority_id","project_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "triage_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" integer NOT NULL,
	"rule_type" "triage_rule_type" NOT NULL,
	"value" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "change_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"file_id" integer NOT NULL,
	"event_type" "change_event_type" NOT NULL,
	"old_etag" text,
	"new_etag" text,
	"sp_modified_at" timestamp,
	"sp_modified_by_name" text,
	"sp_modified_by_email" text,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"import_status" "import_status_type" DEFAULT 'pending' NOT NULL,
	"snapshot_id" integer,
	"error_code" text,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "change_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_role" text,
	"actor_user_id" integer,
	"source" "change_set_source" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"project_id" integer,
	"project_name" text,
	"import_run_id" integer,
	"smart_import_run_id" integer,
	"action" text NOT NULL,
	"summary" text,
	"override_category" text,
	"override_comment" text,
	"correlation_id" text,
	"file_metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conflict_resolution_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_run_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"field_name" text NOT NULL,
	"manual_value" text,
	"import_value" text,
	"decision" text NOT NULL,
	"decided_by_user_id" integer,
	"decided_by_name" text,
	"decided_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "field_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"change_set_id" integer NOT NULL,
	"field_name" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"data_type" text DEFAULT 'text'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_run_id" integer NOT NULL,
	"severity" "import_issue_severity" NOT NULL,
	"section" "import_section" NOT NULL,
	"message" text NOT NULL,
	"suggested_action" text,
	"issue_type" text,
	"issue_fingerprint" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolution" text,
	"resolution_note" text,
	"resolved_by" integer,
	"resolved_at" timestamp,
	"auto_resolved" boolean DEFAULT false NOT NULL,
	"matched_rule_id" integer,
	"override_data" jsonb,
	"payload_json" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"import_run_id" integer,
	"file_name" text NOT NULL,
	"imported_by_user_id" integer,
	"imported_by_name" text,
	"project_name" text,
	"project_id" integer,
	"status" text NOT NULL,
	"rows_attempted" integer DEFAULT 0,
	"rows_written" integer DEFAULT 0,
	"rows_skipped" integer DEFAULT 0,
	"rows_rejected" integer DEFAULT 0,
	"conflicts_detected" integer DEFAULT 0,
	"conflicts_resolved" integer DEFAULT 0,
	"error_message" text,
	"summary_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger_type" "import_trigger_type" NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"status" "import_run_status" DEFAULT 'running' NOT NULL,
	"delta_token_used" text,
	"triggered_by" text DEFAULT 'system' NOT NULL,
	"summary_json" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intake_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"sp_item_id" text NOT NULL,
	"project_id" integer,
	"client_key" text NOT NULL,
	"client_name" text NOT NULL,
	"request_type" text,
	"status" text,
	"priority" text,
	"due_date" text,
	"days_in_progress" integer,
	"project_developer" text,
	"designer" text,
	"size_kwp" text,
	"province" text,
	"gps_coordinates" text,
	"funding_type" text,
	"bills_tariff_data" text,
	"metering_data" text,
	"site_inspection_form" text,
	"comments" text,
	"working_schedule" text,
	"batteries_needed" text,
	"battery_size" text,
	"diesel_gen_needed" text,
	"roof_replacement_needed" text,
	"hse_discussed" text,
	"number_of_reworks" integer,
	"clickup_synced" text,
	"item_type" text,
	"sp_path" text,
	"sp_etag" text,
	"sp_raw_json" jsonb,
	"app_notes" text,
	"app_internal_blockers" text,
	"cp_signed" boolean DEFAULT false NOT NULL,
	"cp_signed_date" text,
	"cp_signed_by" text,
	"cp_evidence_type" text,
	"cp_evidence_ref" text,
	"pm_created" boolean DEFAULT false NOT NULL,
	"tasks_generated" boolean DEFAULT false NOT NULL,
	"last_pulled_at" timestamp,
	"last_pushed_at" timestamp,
	"last_pulled_hash" text,
	"last_app_edit_at" timestamp,
	"sync_conflict" boolean DEFAULT false NOT NULL,
	"conflict_fields_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "intake_requests_sp_item_id_unique" UNIQUE("sp_item_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intake_task_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"dod_items" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intake_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"intake_request_id" integer NOT NULL,
	"template_item_id" integer,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'NOT_STARTED' NOT NULL,
	"dod_items" jsonb,
	"dod_completed_json" jsonb,
	"assigned_to" text,
	"due_date" text,
	"completed_at" timestamp,
	"completed_by" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "issue_resolution_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text,
	"project_id" integer,
	"issue_type" text NOT NULL,
	"fingerprint" text NOT NULL,
	"section" "import_section" NOT NULL,
	"resolution" text NOT NULL,
	"resolution_note" text,
	"override_data" jsonb,
	"apply_always" boolean DEFAULT false NOT NULL,
	"times_applied" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_applied_at" timestamp,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "manual_edit_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"field_name" text NOT NULL,
	"edited_by_user_id" integer,
	"edited_by_name" text,
	"edited_at" timestamp DEFAULT now() NOT NULL,
	"is_protected" boolean DEFAULT false NOT NULL,
	"protected_at" timestamp,
	"protected_by_user_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mapping_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_profile_id" integer NOT NULL,
	"section" "import_section" NOT NULL,
	"source_header" text NOT NULL,
	"canonical_field" text NOT NULL,
	"confidence_weight" real DEFAULT 1 NOT NULL,
	"examples_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mock_sp_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"mock_item_id" text NOT NULL,
	"fields" jsonb NOT NULL,
	"etag" text,
	"created_date_time" text,
	"last_modified_date_time" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mock_sp_items_mock_item_id_unique" UNIQUE("mock_item_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "normalized_plan_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"project_name" text NOT NULL,
	"task_name" text NOT NULL,
	"task_no" text,
	"phase" text,
	"start_date" text,
	"end_date" text,
	"duration_days" integer,
	"actual_start_date" text,
	"actual_end_date" text,
	"actual_duration_days" integer,
	"owner" text,
	"assignee_user_id" integer,
	"status" text,
	"pct_complete" real,
	"expected_pct_complete" real,
	"comment" text,
	"is_milestone" boolean DEFAULT false,
	"parent_task_no" text,
	"indent_level" integer DEFAULT 0,
	"source_sheet" text,
	"source_row" integer,
	"import_run_id" integer NOT NULL,
	"scheduled_date" text,
	"scheduled_start_time" text,
	"scheduled_end_time" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_edit_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_name" text NOT NULL,
	"project_id" integer,
	"task_id" integer,
	"task_name" text,
	"edit_type" text NOT NULL,
	"field_name" text,
	"old_value" text,
	"new_value" text,
	"edited_by_user_id" integer,
	"edited_by_name" text,
	"resolved_by_user_id" integer,
	"resolved_by_name" text,
	"resolved_at" timestamp,
	"resolution" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "smart_import_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"project_name" text NOT NULL,
	"uploaded_by" integer,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"source_file_name" text NOT NULL,
	"source_file_hash" text,
	"status" "smart_import_status" DEFAULT 'PREVIEW' NOT NULL,
	"template_profile_id" integer,
	"summary_json" jsonb,
	"committed_at" timestamp,
	"committed_by" integer,
	"records_attempted" integer,
	"records_succeeded" integer,
	"records_failed" integer,
	"import_type" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "snapshot_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" integer NOT NULL,
	"table_name" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"checksum" text,
	"min_date" text,
	"max_date" text,
	"totals_json" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_id" integer NOT NULL,
	"imported_at" timestamp DEFAULT now() NOT NULL,
	"source_etag" text,
	"content_hash" text NOT NULL,
	"row_count_total" integer,
	"parser_version" text DEFAULT '1.0' NOT NULL,
	"storage_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sp_file_pointers" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"site_id" text NOT NULL,
	"drive_id" text NOT NULL,
	"folder_item_id" text,
	"file_item_id" text NOT NULL,
	"file_name" text NOT NULL,
	"web_url" text,
	"uploaded_by_user_id" integer,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sp_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"drive_id" text NOT NULL,
	"item_id" text NOT NULL,
	"path" text,
	"file_name" text NOT NULL,
	"last_seen_etag" text,
	"last_seen_ctag" text,
	"sp_last_modified_at" timestamp,
	"sp_last_modified_by_name" text,
	"sp_last_modified_by_email" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sp_list_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"list_id" text NOT NULL,
	"site_name" text,
	"list_name" text,
	"site_url" text,
	"column_mapping_json" jsonb,
	"field_ownership_json" jsonb,
	"last_pulled_at" timestamp,
	"last_pushed_at" timestamp,
	"last_delta_token" text,
	"sync_view_filter" text DEFAULT 'IN PROGRESS',
	"configured_by_role" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sp_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"drive_id" text NOT NULL,
	"folder_item_id" text,
	"folder_path" text,
	"interval_minutes" integer DEFAULT 30 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor_role" text NOT NULL,
	"direction" text NOT NULL,
	"summary" jsonb,
	"errors_json" jsonb,
	"conflicts_json" jsonb,
	"item_count" integer DEFAULT 0 NOT NULL,
	"new_projects_count" integer DEFAULT 0 NOT NULL,
	"new_requests_count" integer DEFAULT 0 NOT NULL,
	"updated_requests_count" integer DEFAULT 0 NOT NULL,
	"conflicts_count" integer DEFAULT 0 NOT NULL,
	"errors_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "template_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"signature_json" jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "refresh_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"refreshed_at" timestamp DEFAULT now() NOT NULL,
	"triggered_by" integer,
	"status" text DEFAULT 'success' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "upload_metadata" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text,
	"uploaded_by" integer,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"records_processed" integer DEFAULT 0 NOT NULL,
	"validation_errors" text,
	"status" text DEFAULT 'success' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"requested_by" integer NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"decided_by" integer,
	"decided_at" timestamp,
	"decision_note" text,
	"token" text,
	"expires_at" timestamp,
	"related_entity_type" text,
	"related_entity_id" integer,
	"assigned_approver" integer,
	"due_date" timestamp,
	"project_id" integer NOT NULL,
	"approval_category" text,
	"approval_type" text,
	"urgency" text DEFAULT 'normal',
	"evidence_links" text,
	"scheduled_date" date,
	"scheduled_start_time" text,
	"scheduled_end_time" text,
	"deleted_at" timestamp,
	"deleted_by" integer,
	"delete_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_role" text NOT NULL,
	"user_id" integer,
	"user_name" text,
	"source" "audit_source" DEFAULT 'UI' NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"action" text NOT NULL,
	"changes_json" jsonb,
	"project_name" text,
	"project_id" integer,
	"correlation_id" text,
	"ip_address" text,
	"request_path" text,
	"request_method" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "communication_follow_ups" (
	"id" serial PRIMARY KEY NOT NULL,
	"ms_object_id" integer NOT NULL,
	"project_id" integer,
	"task_id" integer NOT NULL,
	"task_type" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"due_at" timestamp,
	"reminder_at" timestamp,
	"reminder_sent_at" timestamp,
	"status" "communication_follow_up_status" DEFAULT 'pending' NOT NULL,
	"created_by" integer NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "communication_follow_ups_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dashboard_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"layout" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dashboard_widget_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"widget_order" jsonb NOT NULL,
	"hidden_widgets" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ee_info_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"node_id" text,
	"filename" text NOT NULL,
	"mime_type" text,
	"storage_path" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now(),
	"uploaded_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ee_info_edges" (
	"id" text PRIMARY KEY NOT NULL,
	"from_node_id" text NOT NULL,
	"to_node_id" text NOT NULL,
	"edge_type" text DEFAULT 'link' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ee_info_node_details" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_id" text NOT NULL,
	"purpose" text,
	"inputs" text,
	"steps" text,
	"outputs" text,
	"raci" jsonb,
	"tools_docs" jsonb,
	"risks_failure_modes" text,
	"updated_at" timestamp DEFAULT now(),
	"updated_by" text,
	CONSTRAINT "ee_info_node_details_node_id_unique" UNIQUE("node_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ee_info_node_editors" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"can_edit" boolean DEFAULT true NOT NULL,
	"can_manage_children" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ee_info_node_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_id" text NOT NULL,
	"metric_key" text NOT NULL,
	"metric_query_type" text DEFAULT 'project_count' NOT NULL,
	"config" jsonb,
	"display_format" text DEFAULT 'number' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ee_info_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"content_markdown" text,
	"status" text DEFAULT 'stub' NOT NULL,
	"category" text DEFAULT 'unknown' NOT NULL,
	"node_type" text DEFAULT 'content' NOT NULL,
	"department_slug" text,
	"lifecycle_stages" jsonb DEFAULT '[]'::jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"sop_data" jsonb,
	"parent_node_id" text,
	"external_url" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"flow_enabled" boolean DEFAULT false,
	"flow_lane" text,
	"flow_step_code" text,
	"next_slugs" jsonb DEFAULT '[]'::jsonb,
	"prev_slugs" jsonb DEFAULT '[]'::jsonb,
	"gate_conditions" jsonb DEFAULT '[]'::jsonb,
	"blocking_conditions" jsonb DEFAULT '[]'::jsonb,
	"responsible_role" text,
	"escalation_role" text,
	"primary_instruction" text,
	"stage_code" text,
	"definition_of_done" text,
	"owner_role_id" text,
	"approver_role_id" text,
	"required_links" jsonb,
	"example_artifacts" jsonb,
	"example_notes" text,
	"common_pitfalls" jsonb,
	"next_node_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"created_by" text,
	"updated_by" text,
	CONSTRAINT "ee_info_nodes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ee_info_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"seed_import_completed" boolean DEFAULT false,
	"seed_import_hash" text,
	"seed_imported_at" timestamp,
	"seed_imported_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ee_info_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"node_id" text NOT NULL,
	"content_markdown" text,
	"changed_by" text,
	"changed_at" timestamp DEFAULT now(),
	"change_note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"project_id" integer,
	"assignment_role" text DEFAULT 'ASSIGNEE' NOT NULL,
	"assignee_type" text NOT NULL,
	"assignee_id" integer NOT NULL,
	"display_label_snapshot" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"assigned_by_user_id" integer,
	"cleared_by_user_id" integer,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	"cleared_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feedback_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text DEFAULT 'bug' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"submitted_by" integer NOT NULL,
	"submitted_by_name" text NOT NULL,
	"admin_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer,
	"started_by_user_id" integer,
	"source_type" text NOT NULL,
	"status" text NOT NULL,
	"records_processed" integer,
	"error_count" integer DEFAULT 0 NOT NULL,
	"error_summary" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meeting_action_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_id" integer NOT NULL,
	"text" text NOT NULL,
	"owner" text,
	"due_date" text,
	"status" "meeting_action_item_status" DEFAULT 'pending' NOT NULL,
	"converted_to_type" text,
	"converted_to_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meeting_summaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_meeting_id" text,
	"title" text NOT NULL,
	"start_time" timestamp,
	"end_time" timestamp,
	"participants" text[],
	"summary" text,
	"report_url" text,
	"source" text DEFAULT 'read_ai' NOT NULL,
	"raw_payload" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ms_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"tenant_id" text NOT NULL,
	"ms_user_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"refresh_token_encrypted" text,
	"sso_access_token" text,
	"sso_token_expires_at" timestamp,
	"connected_at" timestamp DEFAULT now(),
	"status" "ms_account_status" DEFAULT 'active'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ms_objects" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" "ms_object_type" NOT NULL,
	"ms_id" text NOT NULL,
	"subject_or_title" text,
	"preview" text,
	"web_link" text,
	"sender_or_organizer" text,
	"received_or_start_datetime" timestamp,
	"end_datetime" timestamp,
	"last_synced_at" timestamp DEFAULT now(),
	"action_required" boolean DEFAULT false,
	"is_read" boolean DEFAULT true,
	"importance" text,
	"linked_project_id" integer,
	"linked_task_id" integer,
	"metadata" jsonb,
	"dismissed" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_throttle" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_user_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"last_sent_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_throttle_recipient_event_entity" UNIQUE("recipient_user_id","event_type","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_user_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"project_name" text,
	"project_id" integer,
	"linked_task_id" integer,
	"linked_deliverable_id" integer,
	"linked_warning_id" integer,
	"linked_plan_item_id" integer,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp,
	"requires_confirmation" boolean DEFAULT false NOT NULL,
	"confirmed_by_user_id" integer,
	"confirmed_at" timestamp,
	"change_details" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pm_compliance_tracking" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"week_start_date" date NOT NULL,
	"daily_diary_done" jsonb DEFAULT '[]'::jsonb,
	"weekly_progress_done" boolean DEFAULT false,
	"weekly_risk_done" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "pm_compliance_tracking_unique" UNIQUE("project_id","user_id","week_start_date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pm_mode_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"preferred_mode" text DEFAULT 'full_detail',
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "pm_mode_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pm_on_the_go_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"action_type" "pm_action_type" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"severity" text,
	"amount" numeric(15, 2),
	"status" "pm_action_status" DEFAULT 'pending',
	"related_entity_id" integer,
	"related_entity_type" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	"created_by" text,
	"updated_at" timestamp DEFAULT now(),
	"updated_by" text,
	"source" text DEFAULT 'on_the_go'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pm_site_visits" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"visit_date" date NOT NULL,
	"notes" text,
	"weather_conditions" text,
	"safety_status" "pm_safety_status" DEFAULT 'clear',
	"photo_ids" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"created_by" text,
	"updated_at" timestamp DEFAULT now(),
	"updated_by" text,
	"source" text DEFAULT 'on_the_go'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_communication_timeline_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"ms_object_id" integer,
	"event_type" text NOT NULL,
	"event_title" text NOT NULL,
	"event_detail" text,
	"related_task_id" integer,
	"actor_user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"ms_object_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"linked_by_user_id" integer NOT NULL,
	"linked_at" timestamp DEFAULT now(),
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_milestones" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"due_date" date,
	"completed_at" timestamp,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "standup_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"standup_date" text NOT NULL,
	"what_i_did" text,
	"what_im_doing" text,
	"blockers" text,
	"mood" "standup_mood",
	"is_late" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "standup_entries_unique_schedule_user_date" UNIQUE("schedule_id","user_id","standup_date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "standup_participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "standup_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"team_label" text,
	"project_id" integer,
	"cadence" "standup_cadence" DEFAULT 'EVERY_2_DAYS' NOT NULL,
	"cadence_days" integer DEFAULT 2 NOT NULL,
	"anchor_date" text NOT NULL,
	"deadline_time" text DEFAULT '10:00',
	"deadline_timezone" text DEFAULT 'Africa/Johannesburg' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" integer,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"summary" text NOT NULL,
	"steps_to_reproduce" text NOT NULL,
	"current_route" text,
	"user_agent" text,
	"correlation_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams_chat_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"group_type" text DEFAULT 'department' NOT NULL,
	"department" text,
	"project_name" text,
	"project_id" integer,
	"teams_chat_id" text,
	"description" text,
	"created_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams_chat_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"added_by" integer,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams_chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"sender_user_id" integer,
	"sender_name" text,
	"content" text NOT NULL,
	"teams_message_id" text,
	"is_from_teams" boolean DEFAULT false NOT NULL,
	"file_name" text,
	"file_path" text,
	"file_size" integer,
	"file_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_badges" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"badge_key" text NOT NULL,
	"awarded_at" timestamp DEFAULT now() NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"awarded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contractor_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"counterparty_id" integer,
	"scope" text,
	"start_date" date,
	"end_date" date,
	"performance_rating" integer,
	"notes" text,
	"status" text DEFAULT 'active',
	"created_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"site_id" integer,
	"activity_date" date NOT NULL,
	"activity_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"reported_by_user_id" integer,
	"status" text DEFAULT 'open',
	"weather" text,
	"crew_count" integer,
	"photos" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_inspections" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"site_id" integer,
	"inspection_type" text NOT NULL,
	"inspector_user_id" integer,
	"inspection_date" date,
	"result" text,
	"notes" text,
	"evidence_link" text,
	"linked_snag_ids" text,
	"status" text DEFAULT 'scheduled',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "snags" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"site_id" integer,
	"title" text NOT NULL,
	"description" text,
	"severity" text DEFAULT 'minor',
	"location" text,
	"reported_by_user_id" integer,
	"assigned_to_user_id" integer,
	"due_date" date,
	"status" text DEFAULT 'open',
	"resolution" text,
	"evidence_link" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "corrective_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_id" integer NOT NULL,
	"project_id" integer,
	"title" text NOT NULL,
	"description" text,
	"assigned_to_user_id" integer,
	"due_date" date,
	"status" text DEFAULT 'open',
	"completion_date" date,
	"evidence_link" text,
	"verified_by_user_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hse_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"site_id" integer,
	"incident_date" date NOT NULL,
	"incident_type" text NOT NULL,
	"severity" text NOT NULL,
	"description" text NOT NULL,
	"reported_by_user_id" integer,
	"location" text,
	"root_cause" text,
	"immediate_actions" text,
	"status" text DEFAULT 'open',
	"evidence_link" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "handover_checklist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"handover_pack_id" integer NOT NULL,
	"item_name" text NOT NULL,
	"category" text,
	"required" boolean DEFAULT true,
	"status" text DEFAULT 'pending',
	"evidence_link" text,
	"completed_by_user_id" integer,
	"completed_date" timestamp,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "handover_packs" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"pack_type" text NOT NULL,
	"checklist_status" text DEFAULT 'not_started',
	"document_completeness_pct" integer DEFAULT 0,
	"open_snags_count" integer DEFAULT 0,
	"final_reviewer_user_id" integer,
	"client_submission_date" date,
	"client_acceptance_date" date,
	"matriarch_acceptance_date" date,
	"notes" text,
	"status" text DEFAULT 'draft',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "handover_stakeholders" (
	"id" serial PRIMARY KEY NOT NULL,
	"handover_id" integer NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"company" text,
	"phone" text,
	"email" text,
	"notes" text,
	"counterparty_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lessons_learnt" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"project_type" text,
	"technology_tags" jsonb DEFAULT '[]'::jsonb,
	"added_by_user_id" integer,
	"added_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sseg_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"item_type" text NOT NULL,
	"authority" text,
	"reference_number" text,
	"submitted_date" date,
	"expected_date" date,
	"actual_date" date,
	"status" text DEFAULT 'pending',
	"notes" text,
	"techsitter_confirmed" boolean DEFAULT false,
	"metering_confirmed" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"access_level" text DEFAULT 'viewer' NOT NULL,
	"role_on_project" text,
	"stages_visible" text[] DEFAULT '{}' NOT NULL,
	"can_edit" boolean DEFAULT false NOT NULL,
	"can_approve" boolean DEFAULT false NOT NULL,
	"granted_by_user_id" integer,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"notes" text,
	"deleted_at" timestamp,
	"deleted_by" integer,
	CONSTRAINT "project_access_project_user_uq" UNIQUE("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_stage_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"stage_code" text NOT NULL,
	"decision_type" text NOT NULL,
	"decision_summary" text NOT NULL,
	"decided_by_user_id" integer,
	"decided_date" timestamp DEFAULT now() NOT NULL,
	"rationale" text,
	"impacted_departments" jsonb DEFAULT '[]'::jsonb,
	"impacted_downstream_stages" jsonb DEFAULT '[]'::jsonb,
	"evidence_url" text,
	"related_exception_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_stage_dependencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"stage_code" text NOT NULL,
	"from_department" text NOT NULL,
	"from_user_id" integer,
	"to_department" text NOT NULL,
	"to_user_id" integer,
	"description" text NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'WAITING' NOT NULL,
	"escalated" boolean DEFAULT false NOT NULL,
	"escalation_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_stage_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"stage_instance_id" integer NOT NULL,
	"stage_code" text NOT NULL,
	"evidence_type" text,
	"title" text NOT NULL,
	"file_url" text NOT NULL,
	"uploaded_by_user_id" integer,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"inherited_from_stage" text,
	"review_status" text DEFAULT 'pending',
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_stage_exceptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"stage_code" text NOT NULL,
	"requirement_code" text,
	"reason_text" text NOT NULL,
	"risk_level" text DEFAULT 'MEDIUM' NOT NULL,
	"mitigation_text" text,
	"owner_user_id" integer,
	"approver_user_id" integer,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"conditions_text" text,
	"closeout_due_date" date,
	"downstream_blocking_stage" text,
	"approved_at" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_stage_instances" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"stage_code" text NOT NULL,
	"stage_status" text DEFAULT 'NOT_STARTED' NOT NULL,
	"stage_owner_user_id" integer,
	"approver_user_id" integer,
	"readiness_pct" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"target_exit_date" date,
	"waiting_on_department" text,
	"waiting_on_user_id" integer,
	"next_required_action" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_stage_instances_project_stage_uq" UNIQUE("project_id","stage_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_stage_requirements" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"stage_instance_id" integer NOT NULL,
	"stage_code" text NOT NULL,
	"department" text NOT NULL,
	"item_name" text NOT NULL,
	"item_code" text NOT NULL,
	"owner_user_id" integer,
	"due_date" date,
	"status" text DEFAULT 'NOT_STARTED' NOT NULL,
	"blocks_gate" boolean DEFAULT false NOT NULL,
	"evidence_url" text,
	"evidence_attached" boolean DEFAULT false NOT NULL,
	"completed_by_user_id" integer,
	"completed_date" timestamp,
	"contributors" jsonb DEFAULT '[]'::jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stage_checklist_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"stage_code" text NOT NULL,
	"department" text NOT NULL,
	"item_name" text NOT NULL,
	"item_code" text NOT NULL,
	"blocks_gate" boolean DEFAULT false NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"is_current_version" boolean DEFAULT true NOT NULL,
	"is_system_default" boolean DEFAULT false NOT NULL,
	"edited_by" integer,
	"edited_at" timestamp,
	"edit_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stage_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"stage_code" text NOT NULL,
	"stage_name" text NOT NULL,
	"stage_sequence" integer NOT NULL,
	"description" text,
	"default_owner_role" text,
	"default_approver_role" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" integer,
	CONSTRAINT "stage_definitions_stage_code_unique" UNIQUE("stage_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_charters" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"charter_project_name" text,
	"charter_site_name" text,
	"charter_site_address" text,
	"charter_gps_coordinates" text,
	"charter_facility_type" text,
	"charter_utility_supplier" text,
	"charter_existing_infrastructure" text,
	"charter_roof_type" text,
	"charter_access_method" text,
	"charter_special_site_notes" text,
	"charter_structural_assessment_done" boolean DEFAULT false,
	"charter_structural_assessment_notes" text,
	"charter_client_name" text,
	"charter_client_type" text,
	"charter_primary_contact_name" text,
	"charter_primary_contact_email" text,
	"charter_primary_contact_phone" text,
	"charter_client_relationship_notes" text,
	"charter_pd_user_id" integer,
	"charter_programme_manager_user_id" integer,
	"charter_project_manager_user_id" integer,
	"charter_procurement_manager_user_id" integer,
	"charter_om_manager_user_id" integer,
	"charter_asset_manager_user_id" integer,
	"charter_compliance_officer_user_id" integer,
	"charter_safety_officer_user_id" integer,
	"charter_designer_user_id" integer,
	"charter_preferred_installer" text,
	"charter_system_type" text,
	"charter_system_size_kwp" real,
	"charter_inverter_capacity_kva" real,
	"charter_battery_capacity_kwh" real,
	"charter_module_spec" text,
	"charter_inverter_spec" text,
	"charter_mounting_type" text,
	"charter_monitoring_system" text,
	"charter_metering" text,
	"charter_diesel_gen_integration" boolean DEFAULT false,
	"charter_dedicated_feeder" boolean DEFAULT false,
	"charter_transformer_details" text,
	"charter_tie_in_points" text,
	"charter_main_breaker_details" text,
	"charter_internet_provision" text,
	"charter_hse_contact_established" boolean DEFAULT false,
	"charter_lifelines_required" boolean DEFAULT false,
	"charter_additional_security_required" boolean DEFAULT false,
	"charter_hse_notes" text,
	"charter_sseg_application_status" text,
	"charter_grid_study_status" text,
	"charter_notification_number" text,
	"charter_om_contract_type" text,
	"charter_waterpoints_available" boolean DEFAULT false,
	"charter_metering_billing_required" boolean DEFAULT false,
	"charter_om_special_notes" text,
	"charter_alignment_meeting_date" date,
	"charter_installer_walkthrough_date" date,
	"charter_external_intro_meeting_date" date,
	"charter_internal_review_date" date,
	"charter_client_kickoff_date" date,
	"charter_site_establishment_date" date,
	"charter_expected_completion_date" date,
	"charter_handover_date_target" date,
	"charter_funding_model" text,
	"charter_payment_terms_text" text,
	"charter_invoice_conditions_text" text,
	"charter_funding_partner" text,
	"charter_deposit_status" text,
	"charter_bdp_commission" text,
	"charter_budget_notes" text,
	"charter_overview_risk_summary" text,
	"charter_stakeholder_risk_summary" text,
	"charter_scope_risk_summary" text,
	"charter_schedule_risk_summary" text,
	"charter_budget_risk_summary" text,
	"charter_triage_level" text,
	"charter_opportunities_text" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_user_id" integer,
	"updated_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_charters_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_stage_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"stage_code" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_stage_data_project_stage_uq" UNIQUE("project_id","stage_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_client_commitments" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"stage_code_created" text,
	"commitment_text" text NOT NULL,
	"committed_by_user_id" integer,
	"committed_date" timestamp DEFAULT now() NOT NULL,
	"delivery_stage_code" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"delivered_date" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"migrated_from_legacy" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_client_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"update_number" integer NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"progress_summary_text" text,
	"completed_this_period_text" text,
	"next_7_days_text" text,
	"blockers_text" text,
	"client_actions_required_text" text,
	"attachment_urls" jsonb DEFAULT '[]'::jsonb,
	"sent_by_user_id" integer,
	"reviewer_user_id" integer,
	"sent_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"migrated_from_legacy" boolean DEFAULT false NOT NULL,
	CONSTRAINT "pcu_project_update_uq" UNIQUE("project_id","update_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_queries" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"stage_code" text,
	"query_type" text NOT NULL,
	"raised_by_user_id" integer,
	"raised_by_department" text,
	"assigned_to_user_id" integer,
	"assigned_to_department" text,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"priority" text DEFAULT 'NORMAL' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"response_text" text,
	"responded_by_user_id" integer,
	"responded_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_stage_financial_close_tracks" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"stage_instance_id" integer,
	"track_code" text NOT NULL,
	"track_label" text NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"signed" boolean DEFAULT false NOT NULL,
	"signed_date" date,
	"document_url" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "psfct_project_track_uq" UNIQUE("project_id","track_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "acceptance_reservations" (
	"id" serial PRIMARY KEY NOT NULL,
	"acceptance_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"stage_code" text NOT NULL,
	"description" text NOT NULL,
	"owner_user_id" integer,
	"deadline" date,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_date" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_commitments" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"stage_code_created" text NOT NULL,
	"commitment_text" text NOT NULL,
	"committed_by_user_id" integer,
	"committed_date" timestamp DEFAULT now() NOT NULL,
	"delivery_stage_code" text,
	"status" text DEFAULT 'open' NOT NULL,
	"delivered_date" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"update_number" integer DEFAULT 1 NOT NULL,
	"last_client_update_date" timestamp,
	"next_client_update_due_date" timestamp,
	"client_update_status" text DEFAULT 'draft' NOT NULL,
	"progress_summary_text" text,
	"completed_this_period_text" text,
	"next_7_days_text" text,
	"blockers_text" text,
	"client_actions_required_text" text,
	"attachment_urls" jsonb DEFAULT '[]'::jsonb,
	"client_update_sent_by" integer,
	"reviewer_user_id" integer,
	"sent_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "evidence_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"stage_code" text NOT NULL,
	"requested_by_user_id" integer,
	"requested_from_department" text NOT NULL,
	"requested_from_user_id" integer,
	"description" text NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'requested' NOT NULL,
	"evidence_url" text,
	"fulfilled_date" timestamp,
	"linked_dependency_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stage_acceptances" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"stage_code" text NOT NULL,
	"outcome" text NOT NULL,
	"decided_by_user_id" integer,
	"decided_date" timestamp DEFAULT now() NOT NULL,
	"rejection_reason" text,
	"admin_override" boolean DEFAULT false NOT NULL,
	"admin_override_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "pd_visibility_config" ADD CONSTRAINT "pd_visibility_config_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "pd_visibility_config" ADD CONSTRAINT "pd_visibility_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "permission_audit_log" ADD CONSTRAINT "permission_audit_log_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "workstream_visibility_config" ADD CONSTRAINT "workstream_visibility_config_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "workstream_visibility_config" ADD CONSTRAINT "workstream_visibility_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "clients" ADD CONSTRAINT "clients_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "dashboard_project_metrics" ADD CONSTRAINT "dashboard_project_metrics_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "derived_project_kpis" ADD CONSTRAINT "derived_project_kpis_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "execution_gate_log" ADD CONSTRAINT "execution_gate_log_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "execution_gate_log" ADD CONSTRAINT "execution_gate_log_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "key_date_mappings" ADD CONSTRAINT "key_date_mappings_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "key_date_mappings" ADD CONSTRAINT "key_date_mappings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "merge_audit_log" ADD CONSTRAINT "merge_audit_log_primary_project_id_project_info_id_fk" FOREIGN KEY ("primary_project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "merge_audit_log" ADD CONSTRAINT "merge_audit_log_secondary_project_id_project_info_id_fk" FOREIGN KEY ("secondary_project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "merge_audit_log" ADD CONSTRAINT "merge_audit_log_merged_by_user_id_users_id_fk" FOREIGN KEY ("merged_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "monthly_report_snapshots" ADD CONSTRAINT "monthly_report_snapshots_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "monthly_report_snapshots" ADD CONSTRAINT "monthly_report_snapshots_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "normalized_execution_phases" ADD CONSTRAINT "normalized_execution_phases_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "normalized_execution_phases" ADD CONSTRAINT "normalized_execution_phases_import_run_id_smart_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_deal_owner_user_id_users_id_fk" FOREIGN KEY ("deal_owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "pd_tickets" ADD CONSTRAINT "pd_tickets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "pd_tickets" ADD CONSTRAINT "pd_tickets_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "pd_tickets" ADD CONSTRAINT "pd_tickets_project_developer_user_id_users_id_fk" FOREIGN KEY ("project_developer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "pd_tickets" ADD CONSTRAINT "pd_tickets_designer_user_id_users_id_fk" FOREIGN KEY ("designer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "pd_tickets" ADD CONSTRAINT "pd_tickets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "phase_template" ADD CONSTRAINT "phase_template_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "phase_template_application" ADD CONSTRAINT "phase_template_application_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "phase_template_application" ADD CONSTRAINT "phase_template_application_template_id_phase_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."phase_template"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "phase_template_application" ADD CONSTRAINT "phase_template_application_applied_by_user_id_users_id_fk" FOREIGN KEY ("applied_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "phase_template_item" ADD CONSTRAINT "phase_template_item_template_id_phase_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."phase_template"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "phase_template_item_history" ADD CONSTRAINT "phase_template_item_history_template_item_id_phase_template_item_id_fk" FOREIGN KEY ("template_item_id") REFERENCES "public"."phase_template_item"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "phase_template_item_history" ADD CONSTRAINT "phase_template_item_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "portfolio_rollout_phases" ADD CONSTRAINT "portfolio_rollout_phases_rollout_plan_id_portfolio_rollout_plans_id_fk" FOREIGN KEY ("rollout_plan_id") REFERENCES "public"."portfolio_rollout_plans"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "portfolio_rollout_plans" ADD CONSTRAINT "portfolio_rollout_plans_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "portfolio_rollout_plans" ADD CONSTRAINT "portfolio_rollout_plans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "portfolio_rollout_plans" ADD CONSTRAINT "portfolio_rollout_plans_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_client_history" ADD CONSTRAINT "project_client_history_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_client_history" ADD CONSTRAINT "project_client_history_old_client_id_clients_id_fk" FOREIGN KEY ("old_client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_client_history" ADD CONSTRAINT "project_client_history_new_client_id_clients_id_fk" FOREIGN KEY ("new_client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_client_history" ADD CONSTRAINT "project_client_history_moved_by_user_id_users_id_fk" FOREIGN KEY ("moved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_editable_fields" ADD CONSTRAINT "project_editable_fields_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_execution_state" ADD CONSTRAINT "project_execution_state_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_execution_state" ADD CONSTRAINT "project_execution_state_phase_updated_by_user_id_users_id_fk" FOREIGN KEY ("phase_updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_execution_state" ADD CONSTRAINT "project_execution_state_rag_updated_by_user_id_users_id_fk" FOREIGN KEY ("rag_updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_execution_state" ADD CONSTRAINT "project_execution_state_cp_signed_by_user_id_users_id_fk" FOREIGN KEY ("cp_signed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_execution_state" ADD CONSTRAINT "project_execution_state_construction_manager_user_id_users_id_fk" FOREIGN KEY ("construction_manager_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_execution_state" ADD CONSTRAINT "project_execution_state_quality_lead_user_id_users_id_fk" FOREIGN KEY ("quality_lead_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_execution_state" ADD CONSTRAINT "project_execution_state_engineering_lead_user_id_users_id_fk" FOREIGN KEY ("engineering_lead_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_execution_state" ADD CONSTRAINT "project_execution_state_program_manager_user_id_users_id_fk" FOREIGN KEY ("program_manager_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_execution_state" ADD CONSTRAINT "project_execution_state_project_finance_user_id_users_id_fk" FOREIGN KEY ("project_finance_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_execution_state" ADD CONSTRAINT "project_execution_state_waiting_on_user_id_users_id_fk" FOREIGN KEY ("waiting_on_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_execution_state" ADD CONSTRAINT "project_execution_state_stage_owner_user_id_users_id_fk" FOREIGN KEY ("stage_owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_execution_state" ADD CONSTRAINT "project_execution_state_stage_approver_user_id_users_id_fk" FOREIGN KEY ("stage_approver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_execution_state" ADD CONSTRAINT "project_execution_state_kam_user_id_users_id_fk" FOREIGN KEY ("kam_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_financial_reviews" ADD CONSTRAINT "project_financial_reviews_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_financial_reviews" ADD CONSTRAINT "project_financial_reviews_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_financial_reviews" ADD CONSTRAINT "project_financial_reviews_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_financial_reviews" ADD CONSTRAINT "project_financial_reviews_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_gate_evaluations" ADD CONSTRAINT "project_gate_evaluations_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_gate_evaluations" ADD CONSTRAINT "project_gate_evaluations_override_id_stage_gate_overrides_id_fk" FOREIGN KEY ("override_id") REFERENCES "public"."stage_gate_overrides"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_gate_evaluations" ADD CONSTRAINT "project_gate_evaluations_evaluated_by_user_id_users_id_fk" FOREIGN KEY ("evaluated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_handover_gates" ADD CONSTRAINT "project_handover_gates_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_handover_gates" ADD CONSTRAINT "project_handover_gates_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_handover_history" ADD CONSTRAINT "project_handover_history_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_handover_history" ADD CONSTRAINT "project_handover_history_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_info" ADD CONSTRAINT "project_info_canonical_project_id_project_info_id_fk" FOREIGN KEY ("canonical_project_id") REFERENCES "public"."project_info"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_info" ADD CONSTRAINT "project_info_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_info" ADD CONSTRAINT "project_info_pm_user_id_users_id_fk" FOREIGN KEY ("pm_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_info" ADD CONSTRAINT "project_info_pd_user_id_users_id_fk" FOREIGN KEY ("pd_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_info" ADD CONSTRAINT "project_info_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_info" ADD CONSTRAINT "project_info_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_linkage_review_queue" ADD CONSTRAINT "project_linkage_review_queue_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_pd_pm_handover" ADD CONSTRAINT "project_pd_pm_handover_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_phase_history" ADD CONSTRAINT "project_phase_history_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_phase_history" ADD CONSTRAINT "project_phase_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_portfolio_assignments" ADD CONSTRAINT "project_portfolio_assignments_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_portfolio_assignments" ADD CONSTRAINT "project_portfolio_assignments_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_portfolio_assignments" ADD CONSTRAINT "project_portfolio_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_portfolio_assignments" ADD CONSTRAINT "project_portfolio_assignments_moved_by_users_id_fk" FOREIGN KEY ("moved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_rag_audit" ADD CONSTRAINT "project_rag_audit_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_rag_audit" ADD CONSTRAINT "project_rag_audit_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_revenue_summary" ADD CONSTRAINT "project_revenue_summary_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_revenue_summary" ADD CONSTRAINT "project_revenue_summary_snapshot_run_id_smart_import_runs_id_fk" FOREIGN KEY ("snapshot_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_settings" ADD CONSTRAINT "project_settings_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_subcontractor_assignments" ADD CONSTRAINT "project_subcontractor_assignments_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_subcontractor_assignments" ADD CONSTRAINT "project_subcontractor_assignments_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_team_members" ADD CONSTRAINT "project_team_members_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_team_members" ADD CONSTRAINT "project_team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "raid_items" ADD CONSTRAINT "raid_items_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "raid_items" ADD CONSTRAINT "raid_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "raid_items" ADD CONSTRAINT "raid_items_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "sites" ADD CONSTRAINT "sites_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "stage_gate_overrides" ADD CONSTRAINT "stage_gate_overrides_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "stage_gate_overrides" ADD CONSTRAINT "stage_gate_overrides_overridden_by_users_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "user_project_folders" ADD CONSTRAINT "user_project_folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "user_project_folders" ADD CONSTRAINT "user_project_folders_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "budget_baselines" ADD CONSTRAINT "budget_baselines_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "budget_baselines" ADD CONSTRAINT "budget_baselines_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "cashflow_points" ADD CONSTRAINT "cashflow_points_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "cashflow_points" ADD CONSTRAINT "cashflow_points_last_edited_by_users_id_fk" FOREIGN KEY ("last_edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "cashflow_points" ADD CONSTRAINT "cashflow_points_snapshot_run_id_smart_import_runs_id_fk" FOREIGN KEY ("snapshot_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "counterparties" ADD CONSTRAINT "counterparties_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "counterparty_contacts" ADD CONSTRAINT "counterparty_contacts_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "counterparty_contacts" ADD CONSTRAINT "counterparty_contacts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "expense_task_links" ADD CONSTRAINT "expense_task_links_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "expense_task_links" ADD CONSTRAINT "expense_task_links_expense_id_program_expense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."program_expense"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "expense_task_links" ADD CONSTRAINT "expense_task_links_task_id_project_plan_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."project_plan"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "finance_cos_monthly" ADD CONSTRAINT "finance_cos_monthly_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "finance_cos_monthly" ADD CONSTRAINT "finance_cos_monthly_last_edited_by_users_id_fk" FOREIGN KEY ("last_edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "finance_cos_monthly" ADD CONSTRAINT "finance_cos_monthly_snapshot_run_id_smart_import_runs_id_fk" FOREIGN KEY ("snapshot_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "finance_revenue_monthly" ADD CONSTRAINT "finance_revenue_monthly_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "finance_revenue_monthly" ADD CONSTRAINT "finance_revenue_monthly_last_edited_by_users_id_fk" FOREIGN KEY ("last_edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "finance_revenue_monthly" ADD CONSTRAINT "finance_revenue_monthly_snapshot_run_id_smart_import_runs_id_fk" FOREIGN KEY ("snapshot_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "financial_edit_requests" ADD CONSTRAINT "financial_edit_requests_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "financial_edit_requests" ADD CONSTRAINT "financial_edit_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "financial_edit_requests" ADD CONSTRAINT "financial_edit_requests_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "financial_integration_rules" ADD CONSTRAINT "financial_integration_rules_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "financial_integration_rules" ADD CONSTRAINT "financial_integration_rules_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "forecast_pipeline" ADD CONSTRAINT "forecast_pipeline_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "forecast_pipeline" ADD CONSTRAINT "forecast_pipeline_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "forecast_pipeline" ADD CONSTRAINT "forecast_pipeline_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "fye_budgets" ADD CONSTRAINT "fye_budgets_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "fye_budgets" ADD CONSTRAINT "fye_budgets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "fye_kpi_counters" ADD CONSTRAINT "fye_kpi_counters_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "fye_report_snapshots" ADD CONSTRAINT "fye_report_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "fye_report_snapshots" ADD CONSTRAINT "fye_report_snapshots_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "fye_report_snapshots" ADD CONSTRAINT "fye_report_snapshots_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invoice_captures" ADD CONSTRAINT "invoice_captures_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invoice_captures" ADD CONSTRAINT "invoice_captures_supplier_id_counterparties_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invoice_captures" ADD CONSTRAINT "invoice_captures_captured_by_user_id_users_id_fk" FOREIGN KEY ("captured_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invoice_pattern_matches" ADD CONSTRAINT "invoice_pattern_matches_import_run_id_smart_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invoice_pattern_matches" ADD CONSTRAINT "invoice_pattern_matches_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invoice_pattern_matches" ADD CONSTRAINT "invoice_pattern_matches_matched_rule_id_invoice_pattern_rules_id_fk" FOREIGN KEY ("matched_rule_id") REFERENCES "public"."invoice_pattern_rules"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invoice_pattern_matches" ADD CONSTRAINT "invoice_pattern_matches_inferred_counterparty_id_counterparties_id_fk" FOREIGN KEY ("inferred_counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invoice_pattern_rules" ADD CONSTRAINT "invoice_pattern_rules_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invoice_pattern_rules" ADD CONSTRAINT "invoice_pattern_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "lost_deals" ADD CONSTRAINT "lost_deals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "lost_deals" ADD CONSTRAINT "lost_deals_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "milestone_task_links" ADD CONSTRAINT "milestone_task_links_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "milestone_task_links" ADD CONSTRAINT "milestone_task_links_task_id_project_plan_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."project_plan"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "normalized_cost_lines" ADD CONSTRAINT "normalized_cost_lines_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "normalized_cost_lines" ADD CONSTRAINT "normalized_cost_lines_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "normalized_cost_lines" ADD CONSTRAINT "normalized_cost_lines_import_run_id_smart_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "normalized_cost_lines" ADD CONSTRAINT "normalized_cost_lines_admin_date_override_by_users_id_fk" FOREIGN KEY ("admin_date_override_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "normalized_cost_lines" ADD CONSTRAINT "normalized_cost_lines_cos_status_override_by_users_id_fk" FOREIGN KEY ("cos_status_override_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "normalized_cost_lines" ADD CONSTRAINT "normalized_cost_lines_snapshot_run_id_smart_import_runs_id_fk" FOREIGN KEY ("snapshot_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "normalized_revenue_lines" ADD CONSTRAINT "normalized_revenue_lines_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "normalized_revenue_lines" ADD CONSTRAINT "normalized_revenue_lines_import_run_id_smart_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "normalized_revenue_lines" ADD CONSTRAINT "normalized_revenue_lines_admin_date_override_by_users_id_fk" FOREIGN KEY ("admin_date_override_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "normalized_revenue_lines" ADD CONSTRAINT "normalized_revenue_lines_snapshot_run_id_smart_import_runs_id_fk" FOREIGN KEY ("snapshot_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "payment_batch_items" ADD CONSTRAINT "payment_batch_items_payment_batch_id_payment_batches_id_fk" FOREIGN KEY ("payment_batch_id") REFERENCES "public"."payment_batches"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "payment_batch_items" ADD CONSTRAINT "payment_batch_items_payment_request_id_payment_requests_id_fk" FOREIGN KEY ("payment_request_id") REFERENCES "public"."payment_requests"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "payment_batches" ADD CONSTRAINT "payment_batches_prepared_by_user_id_users_id_fk" FOREIGN KEY ("prepared_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "payment_batches" ADD CONSTRAINT "payment_batches_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "payment_batches" ADD CONSTRAINT "payment_batches_released_by_user_id_users_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_invoice_capture_id_invoice_captures_id_fk" FOREIGN KEY ("invoice_capture_id") REFERENCES "public"."invoice_captures"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_procurement_item_id_procurement_items_id_fk" FOREIGN KEY ("procurement_item_id") REFERENCES "public"."procurement_items"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "po_review_assignments" ADD CONSTRAINT "po_review_assignments_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "po_review_assignments" ADD CONSTRAINT "po_review_assignments_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "procurement_items" ADD CONSTRAINT "procurement_items_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "procurement_items" ADD CONSTRAINT "procurement_items_supplier_id_counterparties_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "procurement_items" ADD CONSTRAINT "procurement_items_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "procurement_items" ADD CONSTRAINT "procurement_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "procurement_items" ADD CONSTRAINT "procurement_items_linked_task_id_project_plan_id_fk" FOREIGN KEY ("linked_task_id") REFERENCES "public"."project_plan"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "program_expense" ADD CONSTRAINT "program_expense_admin_date_override_by_users_id_fk" FOREIGN KEY ("admin_date_override_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "program_expense" ADD CONSTRAINT "program_expense_cos_status_override_by_users_id_fk" FOREIGN KEY ("cos_status_override_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "program_expense" ADD CONSTRAINT "program_expense_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "program_expense" ADD CONSTRAINT "program_expense_import_run_id_smart_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "program_expense" ADD CONSTRAINT "program_expense_last_edited_by_users_id_fk" FOREIGN KEY ("last_edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "program_expense" ADD CONSTRAINT "program_expense_snapshot_run_id_smart_import_runs_id_fk" FOREIGN KEY ("snapshot_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "program_inflows" ADD CONSTRAINT "program_inflows_admin_date_override_by_users_id_fk" FOREIGN KEY ("admin_date_override_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "program_inflows" ADD CONSTRAINT "program_inflows_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "program_inflows" ADD CONSTRAINT "program_inflows_import_run_id_smart_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "program_inflows" ADD CONSTRAINT "program_inflows_last_edited_by_users_id_fk" FOREIGN KEY ("last_edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "program_inflows" ADD CONSTRAINT "program_inflows_snapshot_run_id_smart_import_runs_id_fk" FOREIGN KEY ("snapshot_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_plan" ADD CONSTRAINT "project_plan_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_plan" ADD CONSTRAINT "project_plan_last_edited_by_users_id_fk" FOREIGN KEY ("last_edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_plan_dependency" ADD CONSTRAINT "project_plan_dependency_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_plan_dependency" ADD CONSTRAINT "project_plan_dependency_predecessor_task_id_project_plan_id_fk" FOREIGN KEY ("predecessor_task_id") REFERENCES "public"."project_plan"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_plan_dependency" ADD CONSTRAINT "project_plan_dependency_successor_task_id_project_plan_id_fk" FOREIGN KEY ("successor_task_id") REFERENCES "public"."project_plan"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "proof_of_payment" ADD CONSTRAINT "proof_of_payment_payment_request_id_payment_requests_id_fk" FOREIGN KEY ("payment_request_id") REFERENCES "public"."payment_requests"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "proof_of_payment" ADD CONSTRAINT "proof_of_payment_payment_batch_id_payment_batches_id_fk" FOREIGN KEY ("payment_batch_id") REFERENCES "public"."payment_batches"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "proof_of_payment" ADD CONSTRAINT "proof_of_payment_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "schedule_change_notice" ADD CONSTRAINT "schedule_change_notice_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "schedule_change_notice" ADD CONSTRAINT "schedule_change_notice_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "tr_item_project_links" ADD CONSTRAINT "tr_item_project_links_tr_item_id_tr_items_id_fk" FOREIGN KEY ("tr_item_id") REFERENCES "public"."tr_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "tr_item_project_links" ADD CONSTRAINT "tr_item_project_links_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "tr_item_project_links" ADD CONSTRAINT "tr_item_project_links_auto_created_pm_task_id_project_plan_id_fk" FOREIGN KEY ("auto_created_pm_task_id") REFERENCES "public"."project_plan"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "tr_item_suggestion_decisions" ADD CONSTRAINT "tr_item_suggestion_decisions_tr_item_id_tr_items_id_fk" FOREIGN KEY ("tr_item_id") REFERENCES "public"."tr_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "tr_item_suggestion_decisions" ADD CONSTRAINT "tr_item_suggestion_decisions_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "weekly_reviews" ADD CONSTRAINT "weekly_reviews_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "weekly_reviews" ADD CONSTRAINT "weekly_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "working_plan_dependency_override" ADD CONSTRAINT "working_plan_dependency_override_scenario_id_working_plan_scenario_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."working_plan_scenario"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "working_plan_dependency_override" ADD CONSTRAINT "working_plan_dependency_override_imported_dependency_id_project_plan_dependency_id_fk" FOREIGN KEY ("imported_dependency_id") REFERENCES "public"."project_plan_dependency"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "working_plan_dependency_override" ADD CONSTRAINT "working_plan_dependency_override_predecessor_task_id_project_plan_id_fk" FOREIGN KEY ("predecessor_task_id") REFERENCES "public"."project_plan"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "working_plan_dependency_override" ADD CONSTRAINT "working_plan_dependency_override_successor_task_id_project_plan_id_fk" FOREIGN KEY ("successor_task_id") REFERENCES "public"."project_plan"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "working_plan_scenario" ADD CONSTRAINT "working_plan_scenario_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "writeback_audit_log" ADD CONSTRAINT "writeback_audit_log_mapping_id_writeback_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."writeback_mappings"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "writeback_audit_log" ADD CONSTRAINT "writeback_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "writeback_mappings" ADD CONSTRAINT "writeback_mappings_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "writeback_mappings" ADD CONSTRAINT "writeback_mappings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "deliverable_events" ADD CONSTRAINT "deliverable_events_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "deliverable_events" ADD CONSTRAINT "deliverable_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "deliverable_files" ADD CONSTRAINT "deliverable_files_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "deliverable_files" ADD CONSTRAINT "deliverable_files_version_id_deliverable_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."deliverable_versions"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "deliverable_files" ADD CONSTRAINT "deliverable_files_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "deliverable_versions" ADD CONSTRAINT "deliverable_versions_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "deliverable_versions" ADD CONSTRAINT "deliverable_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_qc_reviewer_user_id_users_id_fk" FOREIGN KEY ("qc_reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "drawing_register" ADD CONSTRAINT "drawing_register_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "drawing_register" ADD CONSTRAINT "drawing_register_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "drawing_register" ADD CONSTRAINT "drawing_register_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "drawing_register" ADD CONSTRAINT "drawing_register_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "drawing_revisions" ADD CONSTRAINT "drawing_revisions_drawing_id_drawing_register_id_fk" FOREIGN KEY ("drawing_id") REFERENCES "public"."drawing_register"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "drawing_revisions" ADD CONSTRAINT "drawing_revisions_revised_by_user_id_users_id_fk" FOREIGN KEY ("revised_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "eng_deliverable_templates" ADD CONSTRAINT "eng_deliverable_templates_stage_template_id_eng_stage_templates_id_fk" FOREIGN KEY ("stage_template_id") REFERENCES "public"."eng_stage_templates"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "eng_stage_templates" ADD CONSTRAINT "eng_stage_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "eng_task_templates" ADD CONSTRAINT "eng_task_templates_stage_template_id_eng_stage_templates_id_fk" FOREIGN KEY ("stage_template_id") REFERENCES "public"."eng_stage_templates"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_eng_approvals" ADD CONSTRAINT "project_eng_approvals_project_eng_stage_id_project_eng_stages_id_fk" FOREIGN KEY ("project_eng_stage_id") REFERENCES "public"."project_eng_stages"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_eng_approvals" ADD CONSTRAINT "project_eng_approvals_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_eng_deliverables" ADD CONSTRAINT "project_eng_deliverables_project_eng_stage_id_project_eng_stages_id_fk" FOREIGN KEY ("project_eng_stage_id") REFERENCES "public"."project_eng_stages"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_eng_deliverables" ADD CONSTRAINT "project_eng_deliverables_deliverable_template_id_eng_deliverable_templates_id_fk" FOREIGN KEY ("deliverable_template_id") REFERENCES "public"."eng_deliverable_templates"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_eng_deliverables" ADD CONSTRAINT "project_eng_deliverables_project_eng_task_id_project_eng_tasks_id_fk" FOREIGN KEY ("project_eng_task_id") REFERENCES "public"."project_eng_tasks"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_eng_deliverables" ADD CONSTRAINT "project_eng_deliverables_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_eng_deliverables" ADD CONSTRAINT "project_eng_deliverables_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_eng_stages" ADD CONSTRAINT "project_eng_stages_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_eng_stages" ADD CONSTRAINT "project_eng_stages_stage_template_id_eng_stage_templates_id_fk" FOREIGN KEY ("stage_template_id") REFERENCES "public"."eng_stage_templates"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_eng_stages" ADD CONSTRAINT "project_eng_stages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_eng_tasks" ADD CONSTRAINT "project_eng_tasks_project_eng_stage_id_project_eng_stages_id_fk" FOREIGN KEY ("project_eng_stage_id") REFERENCES "public"."project_eng_stages"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_eng_tasks" ADD CONSTRAINT "project_eng_tasks_task_template_id_eng_task_templates_id_fk" FOREIGN KEY ("task_template_id") REFERENCES "public"."eng_task_templates"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_eng_tasks" ADD CONSTRAINT "project_eng_tasks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_eng_tasks" ADD CONSTRAINT "project_eng_tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_eng_tasks" ADD CONSTRAINT "project_eng_tasks_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "task_activity_log" ADD CONSTRAINT "task_activity_log_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "task_activity_log" ADD CONSTRAINT "task_activity_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_checklist_id_task_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."task_checklists"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "task_checklists" ADD CONSTRAINT "task_checklists_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "task_deliverables" ADD CONSTRAINT "task_deliverables_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "task_deliverables" ADD CONSTRAINT "task_deliverables_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "task_deliverables" ADD CONSTRAINT "task_deliverables_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_item_assignments" ADD CONSTRAINT "work_item_assignments_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_item_assignments" ADD CONSTRAINT "work_item_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_item_dependencies" ADD CONSTRAINT "work_item_dependencies_predecessor_id_work_items_id_fk" FOREIGN KEY ("predecessor_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_item_dependencies" ADD CONSTRAINT "work_item_dependencies_successor_id_work_items_id_fk" FOREIGN KEY ("successor_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_item_engineering" ADD CONSTRAINT "work_item_engineering_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_item_pm" ADD CONSTRAINT "work_item_pm_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_item_scheduling" ADD CONSTRAINT "work_item_scheduling_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_item_status_history" ADD CONSTRAINT "work_item_status_history_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_item_status_history" ADD CONSTRAINT "work_item_status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_item_tags" ADD CONSTRAINT "work_item_tags_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_item_tags" ADD CONSTRAINT "work_item_tags_tag_id_task_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."task_tags"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_items" ADD CONSTRAINT "work_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_items" ADD CONSTRAINT "work_items_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_items" ADD CONSTRAINT "work_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "work_items" ADD CONSTRAINT "work_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "commissioning_items" ADD CONSTRAINT "commissioning_items_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "commissioning_items" ADD CONSTRAINT "commissioning_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "evidence_collected_items" ADD CONSTRAINT "evidence_collected_items_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "evidence_collected_items" ADD CONSTRAINT "evidence_collected_items_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "evidence_evaluations" ADD CONSTRAINT "evidence_evaluations_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "evidence_evaluations" ADD CONSTRAINT "evidence_evaluations_evaluated_by_user_id_users_id_fk" FOREIGN KEY ("evaluated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "evidence_override_records" ADD CONSTRAINT "evidence_override_records_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "evidence_override_records" ADD CONSTRAINT "evidence_override_records_authorized_by_user_id_users_id_fk" FOREIGN KEY ("authorized_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "evidence_requirement_definitions" ADD CONSTRAINT "evidence_requirement_definitions_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "qc_checklist" ADD CONSTRAINT "qc_checklist_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "qc_checklist" ADD CONSTRAINT "qc_checklist_template_id_qc_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."qc_template"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "qc_item_evidence" ADD CONSTRAINT "qc_item_evidence_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "qc_item_evidence" ADD CONSTRAINT "qc_item_evidence_item_instance_id_qc_item_instance_id_fk" FOREIGN KEY ("item_instance_id") REFERENCES "public"."qc_item_instance"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "qc_item_instance" ADD CONSTRAINT "qc_item_instance_checklist_id_qc_checklist_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."qc_checklist"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "qc_item_instance" ADD CONSTRAINT "qc_item_instance_template_item_id_qc_template_item_id_fk" FOREIGN KEY ("template_item_id") REFERENCES "public"."qc_template_item"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "qc_item_instance" ADD CONSTRAINT "qc_item_instance_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "qc_plan_link" ADD CONSTRAINT "qc_plan_link_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "qc_postmortem" ADD CONSTRAINT "qc_postmortem_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "qc_postmortem_metric_value" ADD CONSTRAINT "qc_postmortem_metric_value_postmortem_id_qc_postmortem_id_fk" FOREIGN KEY ("postmortem_id") REFERENCES "public"."qc_postmortem"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "qc_postmortem_metric_value" ADD CONSTRAINT "qc_postmortem_metric_value_template_metric_id_qc_template_postmortem_metric_id_fk" FOREIGN KEY ("template_metric_id") REFERENCES "public"."qc_template_postmortem_metric"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "qc_postmortem_summary" ADD CONSTRAINT "qc_postmortem_summary_postmortem_id_qc_postmortem_id_fk" FOREIGN KEY ("postmortem_id") REFERENCES "public"."qc_postmortem"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "qc_risk_answer" ADD CONSTRAINT "qc_risk_answer_checklist_id_qc_checklist_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."qc_checklist"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "qc_risk_answer" ADD CONSTRAINT "qc_risk_answer_template_risk_question_id_qc_template_risk_question_id_fk" FOREIGN KEY ("template_risk_question_id") REFERENCES "public"."qc_template_risk_question"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "qc_template_group" ADD CONSTRAINT "qc_template_group_template_phase_id_qc_template_phase_id_fk" FOREIGN KEY ("template_phase_id") REFERENCES "public"."qc_template_phase"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "qc_template_item" ADD CONSTRAINT "qc_template_item_template_group_id_qc_template_group_id_fk" FOREIGN KEY ("template_group_id") REFERENCES "public"."qc_template_group"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "qc_template_phase" ADD CONSTRAINT "qc_template_phase_template_id_qc_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."qc_template"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "qc_template_risk_question" ADD CONSTRAINT "qc_template_risk_question_template_phase_id_qc_template_phase_id_fk" FOREIGN KEY ("template_phase_id") REFERENCES "public"."qc_template_phase"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "qc_warning" ADD CONSTRAINT "qc_warning_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "qc_warning_event" ADD CONSTRAINT "qc_warning_event_warning_id_qc_warning_id_fk" FOREIGN KEY ("warning_id") REFERENCES "public"."qc_warning"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "mytool_company_priorities" ADD CONSTRAINT "mytool_company_priorities_linked_project_id_project_info_id_fk" FOREIGN KEY ("linked_project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "mytool_company_priorities" ADD CONSTRAINT "mytool_company_priorities_accountable_exec_id_users_id_fk" FOREIGN KEY ("accountable_exec_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "mytool_company_priorities" ADD CONSTRAINT "mytool_company_priorities_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "mytool_company_priorities" ADD CONSTRAINT "mytool_company_priorities_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "mytool_daily_reviews" ADD CONSTRAINT "mytool_daily_reviews_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "mytool_dod_templates" ADD CONSTRAINT "mytool_dod_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "mytool_email_links" ADD CONSTRAINT "mytool_email_links_linked_task_id_work_items_id_fk" FOREIGN KEY ("linked_task_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "mytool_email_links" ADD CONSTRAINT "mytool_email_links_linked_operational_task_id_work_items_id_fk" FOREIGN KEY ("linked_operational_task_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "mytool_email_links" ADD CONSTRAINT "mytool_email_links_linked_priority_id_mytool_company_priorities_id_fk" FOREIGN KEY ("linked_priority_id") REFERENCES "public"."mytool_company_priorities"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "mytool_email_links" ADD CONSTRAINT "mytool_email_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "mytool_recurrence_templates" ADD CONSTRAINT "mytool_recurrence_templates_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "mytool_recurrence_templates" ADD CONSTRAINT "mytool_recurrence_templates_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "mytool_timeblocks" ADD CONSTRAINT "mytool_timeblocks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "mytool_timeblocks" ADD CONSTRAINT "mytool_timeblocks_linked_task_id_work_items_id_fk" FOREIGN KEY ("linked_task_id") REFERENCES "public"."work_items"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "mytool_user_preferences" ADD CONSTRAINT "mytool_user_preferences_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "priority_links" ADD CONSTRAINT "priority_links_priority_id_mytool_company_priorities_id_fk" FOREIGN KEY ("priority_id") REFERENCES "public"."mytool_company_priorities"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "priority_links" ADD CONSTRAINT "priority_links_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "priority_projects" ADD CONSTRAINT "priority_projects_priority_id_mytool_company_priorities_id_fk" FOREIGN KEY ("priority_id") REFERENCES "public"."mytool_company_priorities"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "priority_projects" ADD CONSTRAINT "priority_projects_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "priority_projects" ADD CONSTRAINT "priority_projects_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "triage_rules" ADD CONSTRAINT "triage_rules_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "change_ledger" ADD CONSTRAINT "change_ledger_run_id_import_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "change_ledger" ADD CONSTRAINT "change_ledger_file_id_sp_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."sp_files"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "change_ledger" ADD CONSTRAINT "change_ledger_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "conflict_resolution_log" ADD CONSTRAINT "conflict_resolution_log_import_run_id_smart_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "conflict_resolution_log" ADD CONSTRAINT "conflict_resolution_log_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "field_changes" ADD CONSTRAINT "field_changes_change_set_id_change_sets_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."change_sets"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "import_issues" ADD CONSTRAINT "import_issues_import_run_id_smart_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "import_issues" ADD CONSTRAINT "import_issues_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "import_logs" ADD CONSTRAINT "import_logs_import_run_id_smart_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "import_logs" ADD CONSTRAINT "import_logs_imported_by_user_id_users_id_fk" FOREIGN KEY ("imported_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "import_logs" ADD CONSTRAINT "import_logs_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "intake_requests" ADD CONSTRAINT "intake_requests_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "intake_tasks" ADD CONSTRAINT "intake_tasks_intake_request_id_intake_requests_id_fk" FOREIGN KEY ("intake_request_id") REFERENCES "public"."intake_requests"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "intake_tasks" ADD CONSTRAINT "intake_tasks_template_item_id_intake_task_templates_id_fk" FOREIGN KEY ("template_item_id") REFERENCES "public"."intake_task_templates"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "issue_resolution_rules" ADD CONSTRAINT "issue_resolution_rules_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "issue_resolution_rules" ADD CONSTRAINT "issue_resolution_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "manual_edit_flags" ADD CONSTRAINT "manual_edit_flags_edited_by_user_id_users_id_fk" FOREIGN KEY ("edited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "manual_edit_flags" ADD CONSTRAINT "manual_edit_flags_protected_by_user_id_users_id_fk" FOREIGN KEY ("protected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "mapping_rules" ADD CONSTRAINT "mapping_rules_template_profile_id_template_profiles_id_fk" FOREIGN KEY ("template_profile_id") REFERENCES "public"."template_profiles"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "normalized_plan_tasks" ADD CONSTRAINT "normalized_plan_tasks_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "normalized_plan_tasks" ADD CONSTRAINT "normalized_plan_tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "normalized_plan_tasks" ADD CONSTRAINT "normalized_plan_tasks_import_run_id_smart_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."smart_import_runs"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "plan_edit_notifications" ADD CONSTRAINT "plan_edit_notifications_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "plan_edit_notifications" ADD CONSTRAINT "plan_edit_notifications_edited_by_user_id_users_id_fk" FOREIGN KEY ("edited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "plan_edit_notifications" ADD CONSTRAINT "plan_edit_notifications_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "smart_import_runs" ADD CONSTRAINT "smart_import_runs_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "smart_import_runs" ADD CONSTRAINT "smart_import_runs_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "smart_import_runs" ADD CONSTRAINT "smart_import_runs_committed_by_users_id_fk" FOREIGN KEY ("committed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "snapshot_metrics" ADD CONSTRAINT "snapshot_metrics_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_file_id_sp_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."sp_files"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "sp_file_pointers" ADD CONSTRAINT "sp_file_pointers_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "sp_settings" ADD CONSTRAINT "sp_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "template_profiles" ADD CONSTRAINT "template_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "refresh_logs" ADD CONSTRAINT "refresh_logs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "upload_metadata" ADD CONSTRAINT "upload_metadata_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "approvals" ADD CONSTRAINT "approvals_assigned_approver_users_id_fk" FOREIGN KEY ("assigned_approver") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "approvals" ADD CONSTRAINT "approvals_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "dashboard_preferences" ADD CONSTRAINT "dashboard_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "dashboard_widget_config" ADD CONSTRAINT "dashboard_widget_config_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ee_info_assets" ADD CONSTRAINT "ee_info_assets_node_id_ee_info_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."ee_info_nodes"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ee_info_edges" ADD CONSTRAINT "ee_info_edges_from_node_id_ee_info_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."ee_info_nodes"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ee_info_edges" ADD CONSTRAINT "ee_info_edges_to_node_id_ee_info_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."ee_info_nodes"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ee_info_node_details" ADD CONSTRAINT "ee_info_node_details_node_id_ee_info_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."ee_info_nodes"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ee_info_node_editors" ADD CONSTRAINT "ee_info_node_editors_node_id_ee_info_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."ee_info_nodes"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ee_info_node_metrics" ADD CONSTRAINT "ee_info_node_metrics_node_id_ee_info_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."ee_info_nodes"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "ee_info_versions" ADD CONSTRAINT "ee_info_versions_node_id_ee_info_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."ee_info_nodes"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "entity_assignments" ADD CONSTRAINT "entity_assignments_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "entity_assignments" ADD CONSTRAINT "entity_assignments_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "entity_assignments" ADD CONSTRAINT "entity_assignments_cleared_by_user_id_users_id_fk" FOREIGN KEY ("cleared_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "import_history" ADD CONSTRAINT "import_history_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "import_history" ADD CONSTRAINT "import_history_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "meeting_action_items" ADD CONSTRAINT "meeting_action_items_meeting_id_meeting_summaries_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting_summaries"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "notification_throttle" ADD CONSTRAINT "notification_throttle_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "standup_entries" ADD CONSTRAINT "standup_entries_schedule_id_standup_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."standup_schedules"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "standup_entries" ADD CONSTRAINT "standup_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "standup_participants" ADD CONSTRAINT "standup_participants_schedule_id_standup_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."standup_schedules"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "standup_participants" ADD CONSTRAINT "standup_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "standup_schedules" ADD CONSTRAINT "standup_schedules_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "standup_schedules" ADD CONSTRAINT "standup_schedules_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "standup_schedules" ADD CONSTRAINT "standup_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "teams_chat_groups" ADD CONSTRAINT "teams_chat_groups_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "teams_chat_groups" ADD CONSTRAINT "teams_chat_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "teams_chat_members" ADD CONSTRAINT "teams_chat_members_group_id_teams_chat_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."teams_chat_groups"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "teams_chat_members" ADD CONSTRAINT "teams_chat_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "teams_chat_members" ADD CONSTRAINT "teams_chat_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "teams_chat_messages" ADD CONSTRAINT "teams_chat_messages_group_id_teams_chat_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."teams_chat_groups"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "teams_chat_messages" ADD CONSTRAINT "teams_chat_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "user_points" ADD CONSTRAINT "user_points_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "contractor_assignments" ADD CONSTRAINT "contractor_assignments_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "site_activities" ADD CONSTRAINT "site_activities_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "site_activities" ADD CONSTRAINT "site_activities_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "site_activities" ADD CONSTRAINT "site_activities_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "site_inspections" ADD CONSTRAINT "site_inspections_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "site_inspections" ADD CONSTRAINT "site_inspections_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "site_inspections" ADD CONSTRAINT "site_inspections_inspector_user_id_users_id_fk" FOREIGN KEY ("inspector_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "snags" ADD CONSTRAINT "snags_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "snags" ADD CONSTRAINT "snags_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "snags" ADD CONSTRAINT "snags_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "snags" ADD CONSTRAINT "snags_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "corrective_actions" ADD CONSTRAINT "corrective_actions_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "hse_incidents" ADD CONSTRAINT "hse_incidents_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "hse_incidents" ADD CONSTRAINT "hse_incidents_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "hse_incidents" ADD CONSTRAINT "hse_incidents_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "handover_checklist_items" ADD CONSTRAINT "handover_checklist_items_handover_pack_id_handover_packs_id_fk" FOREIGN KEY ("handover_pack_id") REFERENCES "public"."handover_packs"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "handover_checklist_items" ADD CONSTRAINT "handover_checklist_items_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "handover_packs" ADD CONSTRAINT "handover_packs_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "handover_packs" ADD CONSTRAINT "handover_packs_final_reviewer_user_id_users_id_fk" FOREIGN KEY ("final_reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "handover_stakeholders" ADD CONSTRAINT "handover_stakeholders_handover_id_project_pd_pm_handover_id_fk" FOREIGN KEY ("handover_id") REFERENCES "public"."project_pd_pm_handover"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "handover_stakeholders" ADD CONSTRAINT "handover_stakeholders_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "lessons_learnt" ADD CONSTRAINT "lessons_learnt_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "sseg_items" ADD CONSTRAINT "sseg_items_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_access" ADD CONSTRAINT "project_access_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_access" ADD CONSTRAINT "project_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_access" ADD CONSTRAINT "project_access_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_decisions" ADD CONSTRAINT "project_stage_decisions_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_decisions" ADD CONSTRAINT "project_stage_decisions_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_dependencies" ADD CONSTRAINT "project_stage_dependencies_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_dependencies" ADD CONSTRAINT "project_stage_dependencies_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_dependencies" ADD CONSTRAINT "project_stage_dependencies_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_evidence" ADD CONSTRAINT "project_stage_evidence_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_evidence" ADD CONSTRAINT "project_stage_evidence_stage_instance_id_project_stage_instances_id_fk" FOREIGN KEY ("stage_instance_id") REFERENCES "public"."project_stage_instances"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_evidence" ADD CONSTRAINT "project_stage_evidence_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_evidence" ADD CONSTRAINT "project_stage_evidence_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_exceptions" ADD CONSTRAINT "project_stage_exceptions_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_exceptions" ADD CONSTRAINT "project_stage_exceptions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_exceptions" ADD CONSTRAINT "project_stage_exceptions_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_instances" ADD CONSTRAINT "project_stage_instances_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_instances" ADD CONSTRAINT "project_stage_instances_stage_owner_user_id_users_id_fk" FOREIGN KEY ("stage_owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_instances" ADD CONSTRAINT "project_stage_instances_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_instances" ADD CONSTRAINT "project_stage_instances_waiting_on_user_id_users_id_fk" FOREIGN KEY ("waiting_on_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_requirements" ADD CONSTRAINT "project_stage_requirements_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_requirements" ADD CONSTRAINT "project_stage_requirements_stage_instance_id_project_stage_instances_id_fk" FOREIGN KEY ("stage_instance_id") REFERENCES "public"."project_stage_instances"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_requirements" ADD CONSTRAINT "project_stage_requirements_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_requirements" ADD CONSTRAINT "project_stage_requirements_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_charters" ADD CONSTRAINT "project_charters_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_charters" ADD CONSTRAINT "project_charters_charter_pd_user_id_users_id_fk" FOREIGN KEY ("charter_pd_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_charters" ADD CONSTRAINT "project_charters_charter_programme_manager_user_id_users_id_fk" FOREIGN KEY ("charter_programme_manager_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_charters" ADD CONSTRAINT "project_charters_charter_project_manager_user_id_users_id_fk" FOREIGN KEY ("charter_project_manager_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_charters" ADD CONSTRAINT "project_charters_charter_procurement_manager_user_id_users_id_fk" FOREIGN KEY ("charter_procurement_manager_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_charters" ADD CONSTRAINT "project_charters_charter_om_manager_user_id_users_id_fk" FOREIGN KEY ("charter_om_manager_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_charters" ADD CONSTRAINT "project_charters_charter_asset_manager_user_id_users_id_fk" FOREIGN KEY ("charter_asset_manager_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_charters" ADD CONSTRAINT "project_charters_charter_compliance_officer_user_id_users_id_fk" FOREIGN KEY ("charter_compliance_officer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_charters" ADD CONSTRAINT "project_charters_charter_safety_officer_user_id_users_id_fk" FOREIGN KEY ("charter_safety_officer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_charters" ADD CONSTRAINT "project_charters_charter_designer_user_id_users_id_fk" FOREIGN KEY ("charter_designer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_charters" ADD CONSTRAINT "project_charters_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_charters" ADD CONSTRAINT "project_charters_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_data" ADD CONSTRAINT "project_stage_data_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_data" ADD CONSTRAINT "project_stage_data_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_client_commitments" ADD CONSTRAINT "project_client_commitments_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_client_commitments" ADD CONSTRAINT "project_client_commitments_committed_by_user_id_users_id_fk" FOREIGN KEY ("committed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_client_updates" ADD CONSTRAINT "project_client_updates_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_client_updates" ADD CONSTRAINT "project_client_updates_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_client_updates" ADD CONSTRAINT "project_client_updates_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_queries" ADD CONSTRAINT "project_queries_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_queries" ADD CONSTRAINT "project_queries_raised_by_user_id_users_id_fk" FOREIGN KEY ("raised_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_queries" ADD CONSTRAINT "project_queries_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_queries" ADD CONSTRAINT "project_queries_responded_by_user_id_users_id_fk" FOREIGN KEY ("responded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_financial_close_tracks" ADD CONSTRAINT "project_stage_financial_close_tracks_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_stage_financial_close_tracks" ADD CONSTRAINT "project_stage_financial_close_tracks_stage_instance_id_project_stage_instances_id_fk" FOREIGN KEY ("stage_instance_id") REFERENCES "public"."project_stage_instances"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "acceptance_reservations" ADD CONSTRAINT "acceptance_reservations_acceptance_id_stage_acceptances_id_fk" FOREIGN KEY ("acceptance_id") REFERENCES "public"."stage_acceptances"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "acceptance_reservations" ADD CONSTRAINT "acceptance_reservations_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "acceptance_reservations" ADD CONSTRAINT "acceptance_reservations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "client_commitments" ADD CONSTRAINT "client_commitments_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "client_commitments" ADD CONSTRAINT "client_commitments_committed_by_user_id_users_id_fk" FOREIGN KEY ("committed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "client_updates" ADD CONSTRAINT "client_updates_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "client_updates" ADD CONSTRAINT "client_updates_client_update_sent_by_users_id_fk" FOREIGN KEY ("client_update_sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "client_updates" ADD CONSTRAINT "client_updates_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "evidence_requests" ADD CONSTRAINT "evidence_requests_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "evidence_requests" ADD CONSTRAINT "evidence_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "evidence_requests" ADD CONSTRAINT "evidence_requests_requested_from_user_id_users_id_fk" FOREIGN KEY ("requested_from_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "stage_acceptances" ADD CONSTRAINT "stage_acceptances_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "stage_acceptances" ADD CONSTRAINT "stage_acceptances_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_execution_state_phase_idx" ON "project_execution_state" USING btree ("phase");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_execution_state_archived_status_idx" ON "project_execution_state" USING btree ("archived_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_financial_reviews_project_status" ON "project_financial_reviews" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finance_cos_monthly_project_month_idx" ON "finance_cos_monthly" USING btree ("project_id","month_end_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fiscal_periods_fiscal_year_sort_idx" ON "fiscal_periods" USING btree ("fiscal_year_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_batch_item_batch" ON "payment_batch_items" USING btree ("payment_batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_batch_item_request" ON "payment_batch_items" USING btree ("payment_request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payment_batch_status" ON "payment_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payment_batch_cutoff" ON "payment_batches" USING btree ("cutoff_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payment_req_project" ON "payment_requests" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payment_req_status" ON "payment_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_payment_req_cutoff" ON "payment_requests" USING btree ("cutoff_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_po_review_po_id" ON "po_review_assignments" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_po_review_reviewer" ON "po_review_assignments" USING btree ("reviewer_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "program_expense_project_forecast_payment_idx" ON "program_expense" USING btree ("project_id","forecast_payment_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pop_request" ON "proof_of_payment" USING btree ("payment_request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pop_batch" ON "proof_of_payment" USING btree ("payment_batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_po_project" ON "purchase_orders" USING btree ("project_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_po_status" ON "purchase_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_items_project_id_idx" ON "work_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_items_owner_user_id_idx" ON "work_items" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_items_status_idx" ON "work_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_items_end_date_idx" ON "work_items" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_items_parent_id_idx" ON "work_items" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_created_at_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_user_id_idx" ON "audit_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_history_project_started_at_idx" ON "import_history" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_recipient_read_idx" ON "notifications" USING btree ("recipient_user_id","is_read");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_created_at_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pa_project_id_idx" ON "project_access" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pa_user_id_idx" ON "project_access" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "psd_project_id_idx" ON "project_stage_dependencies" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "psd_status_idx" ON "project_stage_dependencies" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pse_project_id_idx" ON "project_stage_exceptions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pse_status_idx" ON "project_stage_exceptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "psi_project_id_idx" ON "project_stage_instances" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "psi_stage_status_idx" ON "project_stage_instances" USING btree ("stage_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "psr_stage_instance_idx" ON "project_stage_requirements" USING btree ("stage_instance_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "psr_department_idx" ON "project_stage_requirements" USING btree ("department");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "psr_status_idx" ON "project_stage_requirements" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "psd_data_project_id_idx" ON "project_stage_data" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pcc_project_id_idx" ON "project_client_commitments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pcc_status_idx" ON "project_client_commitments" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pcu_project_id_idx" ON "project_client_updates" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pcu_status_idx" ON "project_client_updates" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pq_project_id_idx" ON "project_queries" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pq_status_idx" ON "project_queries" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pq_assigned_to_idx" ON "project_queries" USING btree ("assigned_to_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "psfct_project_id_idx" ON "project_stage_financial_close_tracks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "psfct_stage_instance_idx" ON "project_stage_financial_close_tracks" USING btree ("stage_instance_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ar_project_id_idx" ON "acceptance_reservations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ar_acceptance_id_idx" ON "acceptance_reservations" USING btree ("acceptance_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ar_status_idx" ON "acceptance_reservations" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cc_project_id_idx" ON "client_commitments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cc_status_idx" ON "client_commitments" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cu_project_id_idx" ON "client_updates" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cu_status_idx" ON "client_updates" USING btree ("client_update_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "er_project_id_idx" ON "evidence_requests" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "er_status_idx" ON "evidence_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "er_stage_code_idx" ON "evidence_requests" USING btree ("stage_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sa_project_id_idx" ON "stage_acceptances" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sa_stage_code_idx" ON "stage_acceptances" USING btree ("stage_code");