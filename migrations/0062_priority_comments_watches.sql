CREATE TABLE "priority_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"priority_id" integer NOT NULL,
	"author_user_id" integer,
	"author_name" text,
	"body" text NOT NULL,
	"edited_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "priority_watches" (
	"user_id" integer NOT NULL,
	"priority_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "priority_watches_unique" UNIQUE("user_id","priority_id")
);
--> statement-breakpoint
ALTER TABLE "priority_comments" ADD CONSTRAINT "priority_comments_priority_id_mytool_company_priorities_id_fk" FOREIGN KEY ("priority_id") REFERENCES "public"."mytool_company_priorities"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "priority_comments" ADD CONSTRAINT "priority_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "priority_watches" ADD CONSTRAINT "priority_watches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "priority_watches" ADD CONSTRAINT "priority_watches_priority_id_mytool_company_priorities_id_fk" FOREIGN KEY ("priority_id") REFERENCES "public"."mytool_company_priorities"("id") ON DELETE cascade ON UPDATE no action;
