-- =========================================================================
-- Persistent token revocation store.
--
-- Previously, bearer-token and session revocations were held only in
-- process memory and were lost on every server restart / deployment. This
-- migration adds two tables so revocations survive restarts.
--
-- revoked_tokens  — stores SHA-256 digests of revoked bearer JWTs.
-- revoked_sessions — stores revoked express-session IDs.
--
-- Both tables carry an expires_at timestamp; rows are pruned automatically
-- by the application after expiry. The auth-context module loads all
-- unexpired rows into memory on startup and writes new revocations to both
-- memory and DB.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS is safe to re-run.
-- =========================================================================

CREATE TABLE IF NOT EXISTS "revoked_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  "token_digest" text NOT NULL,
  "revoked_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_revoked_tokens_digest"
  ON "revoked_tokens" ("token_digest");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_revoked_tokens_expires"
  ON "revoked_tokens" ("expires_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "revoked_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL,
  "revoked_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_revoked_sessions_sid"
  ON "revoked_sessions" ("session_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_revoked_sessions_expires"
  ON "revoked_sessions" ("expires_at");
