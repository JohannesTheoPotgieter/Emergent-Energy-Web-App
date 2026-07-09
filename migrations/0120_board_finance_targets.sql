CREATE TABLE "board_finance_targets" (
	"fy" integer PRIMARY KEY NOT NULL,
	"revenue_target" numeric,
	"target_margin_pct" numeric,
	"reason" text,
	"updated_by_user_id" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
