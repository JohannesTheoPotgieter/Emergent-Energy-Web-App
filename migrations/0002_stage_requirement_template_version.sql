ALTER TABLE "project_stage_requirements"
  ADD COLUMN IF NOT EXISTS "source_template_id" integer;
--> statement-breakpoint
ALTER TABLE "project_stage_requirements"
  ADD COLUMN IF NOT EXISTS "template_version_at_hydrate" integer;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_stage_requirements_source_template_id_stage_checklist_templates_id_fk'
  ) THEN
    ALTER TABLE "project_stage_requirements"
      ADD CONSTRAINT "project_stage_requirements_source_template_id_stage_checklist_templates_id_fk"
      FOREIGN KEY ("source_template_id")
      REFERENCES "public"."stage_checklist_templates"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END$$;
