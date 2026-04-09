CREATE TABLE "core"."departments" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "core"."role_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"department_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_definitions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN "milestone_no" text;--> statement-breakpoint
ALTER TABLE "normalized_revenue_lines" ADD COLUMN "milestone_percent" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "core"."role_definitions" ADD CONSTRAINT "role_definitions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "core"."departments"("id") ON DELETE no action ON UPDATE no action;