CREATE TABLE "task_comment_mentions" (
	"comment_id" integer NOT NULL,
	"mentioned_user_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_comment_mentions" ADD CONSTRAINT "task_comment_mentions_comment_id_task_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."task_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comment_mentions" ADD CONSTRAINT "task_comment_mentions_mentioned_user_id_users_id_fk" FOREIGN KEY ("mentioned_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_comment_mentions_pk" ON "task_comment_mentions" USING btree ("comment_id","mentioned_user_id");--> statement-breakpoint
CREATE INDEX "task_comment_mentions_user_idx" ON "task_comment_mentions" USING btree ("mentioned_user_id");