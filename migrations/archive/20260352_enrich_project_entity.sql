-- Step B4: Enrich Project entity with missing fields per target architecture
-- All additive nullable columns — zero impact on existing data

-- Project identity enrichment
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS delivery_model TEXT;       -- 'turnkey', 'design_build', 'epc', 'consulting'
ALTER TABLE project_info ADD COLUMN IF NOT EXISTS project_code TEXT;

-- Execution state role assignments
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS construction_manager_user_id INTEGER REFERENCES users(id);
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS quality_lead_user_id INTEGER REFERENCES users(id);
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS engineering_lead_user_id INTEGER REFERENCES users(id);
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS program_manager_user_id INTEGER REFERENCES users(id);
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS project_finance_user_id INTEGER REFERENCES users(id);

-- Execution state milestone targets
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS matriarch_handover_target DATE;
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS practical_completion_target DATE;
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS practical_completion_actual DATE;

-- Execution state financial baselines
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS cost_baseline DECIMAL(15, 2);
ALTER TABLE project_execution_state ADD COLUMN IF NOT EXISTS margin_baseline DECIMAL(8, 4);
