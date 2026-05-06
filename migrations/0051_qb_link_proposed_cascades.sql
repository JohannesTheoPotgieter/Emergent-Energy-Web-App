-- Per-link cascade proposals.
--
-- When a `quickbooks_invoice_links` row is created (manual approve, bulk
-- approve, force-relink, or admin cascade), the QB-vs-app divergence
-- detector records one row here per app-side mutation it would propose.
-- The link itself is created immediately, but every downstream change
-- (vendor mapping, counterpartyId backfill, paid_date overwrite, etc.)
-- stays `pending` until the reviewer clicks Accept or Decline. Nothing on
-- the app side is mutated silently.
--
-- All statements are guarded with IF NOT EXISTS so re-applying is a no-op
-- per CLAUDE.md migration policy. Snapshot drift unrelated to this feature
-- (allocated_amount_ex_vat etc. picked up by drizzle from
-- 0050_qb_invoice_links_allocations.sql which lives outside the journal)
-- has been intentionally stripped — those columns / indexes are managed by
-- their own hand-written migration and don't belong here.

CREATE TABLE IF NOT EXISTS "qb_link_proposed_cascades" (
  "id" serial PRIMARY KEY NOT NULL,
  "link_id" integer NOT NULL,
  "project_id" integer,
  "target_table" text NOT NULL,
  "target_id" integer,
  "proposal_type" text NOT NULL,
  "field_name" text,
  "app_value" text,
  "qb_value" text,
  "reason" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_by" integer,
  "resolved_by" integer,
  "resolved_at" timestamp,
  "resolution_note" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "qb_link_proposed_cascades_unique_pending_idx"
  ON "qb_link_proposed_cascades" ("link_id", "proposal_type", "field_name")
  WHERE "status" = 'pending' AND "deleted_at" IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "qb_link_proposed_cascades_link_idx"
  ON "qb_link_proposed_cascades" ("link_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "qb_link_proposed_cascades_status_idx"
  ON "qb_link_proposed_cascades" ("status");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "qb_link_proposed_cascades_project_idx"
  ON "qb_link_proposed_cascades" ("project_id");
