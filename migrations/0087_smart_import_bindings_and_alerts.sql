CREATE TABLE "smart_import_project_bindings" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_key" text NOT NULL,
	"match_type" text DEFAULT 'filename' NOT NULL,
	"project_id" integer NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"confirmed_by_user_id" integer,
	"last_used_at" timestamp,
	"times_used" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "smart_import_project_bindings_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
ALTER TABLE "sp_settings" ADD COLUMN "alerts_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sp_settings" ADD COLUMN "alert_team_id" text;--> statement-breakpoint
ALTER TABLE "sp_settings" ADD COLUMN "alert_channel_id" text;--> statement-breakpoint
ALTER TABLE "sp_settings" ADD COLUMN "alert_sender_user_id" integer;--> statement-breakpoint
ALTER TABLE "sp_settings" ADD COLUMN "alert_on_failure" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sp_settings" ADD COLUMN "alert_on_review" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sp_settings" ADD COLUMN "last_alert_state" text;--> statement-breakpoint
ALTER TABLE "smart_import_project_bindings" ADD CONSTRAINT "smart_import_project_bindings_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_import_project_bindings" ADD CONSTRAINT "smart_import_project_bindings_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sp_settings" ADD CONSTRAINT "sp_settings_alert_sender_user_id_users_id_fk" FOREIGN KEY ("alert_sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;