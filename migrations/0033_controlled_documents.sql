-- =========================================================================
-- Document control (D3.1) — controlled documents with SharePoint-backed
-- Drafts/Approved/History promotion workflow driven from the app.
--
-- See shared/schema/documents.ts for the model. Approval workflow reuses
-- the existing public.approvals table (collaboration.ts) with
-- approvalType='controlled_document'.
--
-- Idempotent + additive: safe to re-run.
-- =========================================================================

-- Enum: controlled_document_state_enum ------------------------------------
DO $$ BEGIN
  CREATE TYPE "controlled_document_state_enum" AS ENUM (
    'draft', 'submitted', 'approved', 'rejected', 'superseded', 'recalled'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Table: controlled_document_types ----------------------------------------
CREATE TABLE IF NOT EXISTS "controlled_document_types" (
  "id" serial PRIMARY KEY NOT NULL,
  "type_key" text NOT NULL,
  "display_name" text NOT NULL,
  "description" text,
  "folder_sub_path" text NOT NULL,
  "default_approver_roles" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "requires_all_approvers" boolean NOT NULL DEFAULT false,
  "extract_spec" jsonb,
  "active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "controlled_document_types_type_key_idx"
  ON "controlled_document_types" ("type_key");
--> statement-breakpoint

-- PostgreSQL requires the referenced column of a foreign key to be backed by
-- a UNIQUE CONSTRAINT (or PRIMARY KEY) — a plain unique index is not enough
-- to satisfy `controlled_documents_type_fk` below. Add it explicitly so a
-- fresh production database can build the FK. The CREATE UNIQUE INDEX above
-- is retained for backward compatibility with dev databases that already
-- have it; PostgreSQL keeps both happily.
DO $$ BEGIN
  ALTER TABLE "controlled_document_types"
    ADD CONSTRAINT "controlled_document_types_type_key_unique" UNIQUE ("type_key");
EXCEPTION WHEN duplicate_object THEN null; WHEN duplicate_table THEN null; END $$;
--> statement-breakpoint

-- Table: controlled_documents ---------------------------------------------
CREATE TABLE IF NOT EXISTS "controlled_documents" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL,
  "type_key" text NOT NULL,
  "state" "controlled_document_state_enum" NOT NULL DEFAULT 'draft',
  "sharepoint_drive_id" text,
  "sharepoint_item_id" text,
  "sharepoint_path" text NOT NULL,
  "file_name" text NOT NULL,
  "file_size_bytes" integer,
  "version_number" integer NOT NULL DEFAULT 0,
  "submitted_by_user_id" integer,
  "submitted_at" timestamp,
  "submit_comment" text,
  "superseded_by_document_id" integer,
  "recalled_by_user_id" integer,
  "recalled_at" timestamp,
  "recall_reason" text,
  "extracted_values" jsonb,
  "extracted_at" timestamp,
  "extracted_error" text,
  "deleted_at" timestamp,
  "deleted_by_user_id" integer,
  "delete_reason" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "controlled_documents" ADD CONSTRAINT "controlled_documents_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "controlled_documents" ADD CONSTRAINT "controlled_documents_type_fk"
    FOREIGN KEY ("type_key") REFERENCES "public"."controlled_document_types"("type_key") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "controlled_documents" ADD CONSTRAINT "controlled_documents_submitted_by_fk"
    FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "controlled_documents" ADD CONSTRAINT "controlled_documents_recalled_by_fk"
    FOREIGN KEY ("recalled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "controlled_documents" ADD CONSTRAINT "controlled_documents_deleted_by_fk"
    FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- Self-referencing FK for the supersede chain. Deferred to the end so the
-- parent table is known to exist.
DO $$ BEGIN
  ALTER TABLE "controlled_documents" ADD CONSTRAINT "controlled_documents_superseded_by_fk"
    FOREIGN KEY ("superseded_by_document_id") REFERENCES "public"."controlled_documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "controlled_documents_project_type_idx"
  ON "controlled_documents" ("project_id", "type_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "controlled_documents_state_idx"
  ON "controlled_documents" ("state");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "controlled_documents_project_type_state_idx"
  ON "controlled_documents" ("project_id", "type_key", "state");
--> statement-breakpoint

-- Partial unique — at most ONE approved row per (project, type). Optional
-- belt-and-braces on top of repository-layer enforcement; PostgreSQL
-- supports this. SQLite dev fallback ignores the WHERE clause gracefully.
CREATE UNIQUE INDEX IF NOT EXISTS "controlled_documents_one_approved_per_project_type"
  ON "controlled_documents" ("project_id", "type_key")
  WHERE "state" = 'approved';
--> statement-breakpoint

-- Table: project_sharepoint_roots -----------------------------------------
CREATE TABLE IF NOT EXISTS "project_sharepoint_roots" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL,
  "drive_id" text,
  "root_item_id" text,
  "root_path" text NOT NULL,
  "configured_by_user_id" integer,
  "configured_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "project_sharepoint_roots" ADD CONSTRAINT "project_sharepoint_roots_project_unique"
    UNIQUE ("project_id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "project_sharepoint_roots" ADD CONSTRAINT "project_sharepoint_roots_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "project_sharepoint_roots" ADD CONSTRAINT "project_sharepoint_roots_user_fk"
    FOREIGN KEY ("configured_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- =========================================================================
-- Seed: 13 controlled document types matching the locked approval matrix.
-- Uses ON CONFLICT DO NOTHING — safe to re-run. Super users can edit/add
-- via the Settings UI (D5).
-- =========================================================================

INSERT INTO "controlled_document_types"
  ("type_key", "display_name", "description", "folder_sub_path",
   "default_approver_roles", "requires_all_approvers", "extract_spec", "sort_order")
VALUES
  ('costing_excel', 'Costing Excel', 'Official cost + revenue workbook per deal. Headline numbers are extracted for the CEO home.', 'BD/Cost Proposal/Costing',
    '["CEO_ADMIN"]'::jsonb, false, NULL, 10),
  ('design_pack', 'Design Pack', 'Engineering design package (drawings, bill of materials, SLDs).', 'BD/Cost Proposal/Design',
    '["ENGINEERING_MANAGER"]'::jsonb, false, NULL, 20),
  ('feasibility_study', 'Feasibility Study', 'Pre-design technical and commercial feasibility report.', 'BD/First Assessment/Feasibility',
    '["ENGINEERING_MANAGER"]'::jsonb, false, NULL, 30),
  ('yield_study', 'Yield Study', 'Energy yield and performance ratio study.', 'BD/First Assessment/Yield',
    '["ENGINEERING_MANAGER"]'::jsonb, false, NULL, 40),
  ('client_proposal', 'Client-facing Proposal', 'Proposal document sent to the client.', 'BD/Cost Proposal/Proposal',
    '["CEO_ADMIN"]'::jsonb, false, NULL, 50),
  ('epc_contract', 'EPC Contract', 'Executed Engineering, Procurement and Construction contract.', 'Legal/EPC Contract',
    '["COO_ADMIN"]'::jsonb, false, NULL, 60),
  ('financial_close_pack', 'Financial Close Pack', 'Signed financial close bundle.', 'Legal/Financial Close',
    '["CFO", "COO_ADMIN"]'::jsonb, true, NULL, 70),
  ('project_charter', 'Project Charter', 'Signed project charter produced at PD->PM handover.', 'Handover/Charter',
    '["PROGRAM_MANAGER", "COO_ADMIN"]'::jsonb, true, NULL, 80),
  ('invoice', 'Invoice', 'Issued client invoice.', 'Finance/Invoices',
    '["CFO"]'::jsonb, false, NULL, 90),
  ('purchase_order', 'Purchase Order', 'Issued purchase order to supplier/subcontractor.', 'Finance/Purchase Orders',
    '["PROGRAM_MANAGER", "CFO"]'::jsonb, true, NULL, 100),
  ('project_introduction', 'Project Introduction', 'Client-facing intro document sent at start of execution.', 'Handover/Client Intro',
    '["PROGRAM_MANAGER"]'::jsonb, false, NULL, 110),
  ('handover_om', 'Handover Document — O&M', 'Operations & Maintenance handover pack.', 'Handover/O&M',
    '["CONSTRUCTION_MANAGER", "COO_ADMIN"]'::jsonb, true, NULL, 120),
  ('handover_client', 'Handover Document — Client', 'Client handover pack at project closeout.', 'Handover/Client',
    '["PROGRAM_MANAGER", "COO_ADMIN"]'::jsonb, true, NULL, 130)
ON CONFLICT ("type_key") DO NOTHING;
