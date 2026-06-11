CREATE TABLE IF NOT EXISTS "finance_integrity_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_type" text DEFAULT 'scheduled' NOT NULL,
	"started_at" timestamp NOT NULL,
	"finished_at" timestamp,
	"status" text NOT NULL,
	"golden_status" text,
	"cross_surface_status" text,
	"reconciliation_status" text,
	"drift_count" integer DEFAULT 0 NOT NULL,
	"summary" text,
	"detail" jsonb,
	"duration_ms" integer,
	"triggered_by" text,
	"alert_dispatched" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_job_heartbeats" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_key" text NOT NULL,
	"last_started_at" timestamp,
	"last_success_at" timestamp,
	"last_failure_at" timestamp,
	"last_status" text,
	"last_duration_ms" integer,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_alert_state" text,
	"last_alert_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "finance_job_heartbeats_job_key_unique" UNIQUE("job_key")
);
