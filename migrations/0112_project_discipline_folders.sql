CREATE TABLE "project_discipline_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"discipline" text NOT NULL,
	"drive_id" text,
	"item_id" text,
	"sharepoint_path" text,
	"web_url" text,
	"bound_by_user_id" integer,
	"bound_at" timestamp,
	"last_verified_at" timestamp,
	"verify_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "project_discipline_folders" ADD CONSTRAINT "project_discipline_folders_project_id_project_info_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_info"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_discipline_folders" ADD CONSTRAINT "project_discipline_folders_bound_by_user_id_users_id_fk" FOREIGN KEY ("bound_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_discipline_folders_project_discipline_uq" ON "project_discipline_folders" USING btree ("project_id","discipline");--> statement-breakpoint
CREATE INDEX "project_discipline_folders_project_idx" ON "project_discipline_folders" USING btree ("project_id");