-- =========================================================================
-- D4 live-meeting capture on stage_acceptances.
--
-- When a PD->PM (or later) handover meeting is run through the D4 live
-- interface at /handover/:projectId/live, the app records the room
-- attendees and per-section notes alongside the acceptance outcome.
-- This captures richer context than the previous acceptance record
-- (which only stored outcome + rejection reason) and lets downstream
-- views show "who was in the room when this decision was made".
--
-- Idempotent + additive: safe to re-run.
-- =========================================================================

ALTER TABLE "stage_acceptances"
  ADD COLUMN IF NOT EXISTS "attendees" jsonb;
--> statement-breakpoint

ALTER TABLE "stage_acceptances"
  ADD COLUMN IF NOT EXISTS "section_notes" jsonb;
