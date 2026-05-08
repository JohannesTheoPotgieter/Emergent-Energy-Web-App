-- Plan v3 Track D / T2-1 — eng_task_templates + eng_deliverable_templates
-- soft-delete columns. The route handlers in server/eng-stage-routes.ts
-- already write deletedAt + deletedBy on COO-only DELETE, but the columns
-- did not exist on the tables, so the handler crashed at runtime. Additive
-- migration: nullable columns, no backfill needed.

ALTER TABLE eng_task_templates
  ADD COLUMN IF NOT EXISTS deleted_at timestamp,
  ADD COLUMN IF NOT EXISTS deleted_by integer REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE eng_deliverable_templates
  ADD COLUMN IF NOT EXISTS deleted_at timestamp,
  ADD COLUMN IF NOT EXISTS deleted_by integer REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS eng_task_templates_active_idx
  ON eng_task_templates (stage_template_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS eng_deliverable_templates_active_idx
  ON eng_deliverable_templates (stage_template_id) WHERE deleted_at IS NULL;
