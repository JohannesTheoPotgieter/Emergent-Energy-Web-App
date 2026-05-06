-- Per-counterparty memo / description fingerprint table.
--
-- Companion to `invoice_pattern_rules` (which keys on invoice numbers) —
-- this table stores the canonical token set extracted from a counterparty's
-- bill descriptions / QuickBooks PrivateNote / app cost-line description.
-- The matcher consults active rows here when scoring QB candidates so
-- vendors with consistent memo language ("Monthly diesel — Site A", etc.)
-- get a +12 confidence boost on subsequent bills.
--
-- All statements use IF NOT EXISTS guards per the project migrations
-- policy (additive only, idempotent on re-run).

CREATE TABLE IF NOT EXISTS "invoice_description_patterns" (
  "id" serial PRIMARY KEY NOT NULL,
  "counterparty_id" integer NOT NULL,
  "counterparty_name" text,
  "token_set" jsonb NOT NULL,
  "normalized_example" text,
  "confidence_weight" integer DEFAULT 50 NOT NULL,
  "times_matched" integer DEFAULT 0 NOT NULL,
  "times_confirmed" integer DEFAULT 0 NOT NULL,
  "times_overridden" integer DEFAULT 0 NOT NULL,
  "last_confirmed_at" timestamp,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoice_description_patterns_counterparty_id_counterparties_id_fk'
  ) THEN
    ALTER TABLE "invoice_description_patterns"
      ADD CONSTRAINT "invoice_description_patterns_counterparty_id_counterparties_id_fk"
      FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoice_description_patterns_created_by_users_id_fk'
  ) THEN
    ALTER TABLE "invoice_description_patterns"
      ADD CONSTRAINT "invoice_description_patterns_created_by_users_id_fk"
      FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END$$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "invoice_description_patterns_counterparty_idx"
  ON "invoice_description_patterns" ("counterparty_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "invoice_description_patterns_active_idx"
  ON "invoice_description_patterns" ("counterparty_id", "is_active")
  WHERE "deleted_at" IS NULL;
