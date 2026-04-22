-- =========================================================================
-- Email / Teams project linking — metadata-only attribution tables.
--
-- Foundation for the email-linking feature: given an inbound Outlook
-- email or a Teams mention, we attribute it to a project (and often
-- a client) using a layered signal approach (domain match, known
-- contact, subject tag, thread inheritance, Pipedrive, manual).
-- Never stores email bodies — only Graph API handles + minimal
-- metadata (sender, subject snapshot, received-at).
--
-- Idempotent + additive: safe to re-run.
-- =========================================================================

-- Enum: email_link_signal_enum -------------------------------------------
DO $$ BEGIN
  CREATE TYPE "email_link_signal_enum" AS ENUM (
    'client_domain', 'client_contact', 'subject_tag',
    'thread_inheritance', 'pipedrive', 'manual'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Enum: teams_link_signal_enum -------------------------------------------
DO $$ BEGIN
  CREATE TYPE "teams_link_signal_enum" AS ENUM (
    'project_channel', 'user_mention', 'manual'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Table: email_project_links ---------------------------------------------
CREATE TABLE IF NOT EXISTS "email_project_links" (
  "id" serial PRIMARY KEY NOT NULL,
  "graph_message_id" text NOT NULL,
  "graph_conversation_id" text,
  "project_id" integer,
  "client_id" integer,
  "signal" "email_link_signal_enum" NOT NULL,
  "sender_email" text,
  "subject_snapshot" text,
  "phase_at_link_time" text,
  "linked_by_user_id" integer,
  "link_note" text,
  "received_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "email_project_links" ADD CONSTRAINT "email_project_links_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "email_project_links" ADD CONSTRAINT "email_project_links_client_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "email_project_links" ADD CONSTRAINT "email_project_links_user_fk"
    FOREIGN KEY ("linked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "epl_project_id_idx" ON "email_project_links" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "epl_client_id_idx" ON "email_project_links" ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "epl_conversation_idx" ON "email_project_links" ("graph_conversation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "epl_message_project_unique_idx"
  ON "email_project_links" ("graph_message_id", "project_id");
--> statement-breakpoint

-- Table: teams_project_links ---------------------------------------------
CREATE TABLE IF NOT EXISTS "teams_project_links" (
  "id" serial PRIMARY KEY NOT NULL,
  "graph_message_id" text NOT NULL,
  "graph_channel_id" text,
  "graph_team_id" text,
  "graph_thread_id" text,
  "project_id" integer NOT NULL,
  "signal" "teams_link_signal_enum" NOT NULL,
  "sender_email" text,
  "body_preview" text,
  "phase_at_link_time" text,
  "linked_by_user_id" integer,
  "link_note" text,
  "posted_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "teams_project_links" ADD CONSTRAINT "teams_project_links_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "teams_project_links" ADD CONSTRAINT "teams_project_links_user_fk"
    FOREIGN KEY ("linked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "tpl_project_id_idx" ON "teams_project_links" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tpl_channel_idx" ON "teams_project_links" ("graph_channel_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tpl_thread_idx" ON "teams_project_links" ("graph_thread_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tpl_message_project_unique_idx"
  ON "teams_project_links" ("graph_message_id", "project_id");
