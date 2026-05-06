-- 20260317_multischema_domain_rollout.sql
-- Final major additive schema rollout before hard cutover.
-- Safety: no legacy drops, no destructive deletes, compatibility-first with reconciliation visibility.

BEGIN;

-- =============================
-- 1) Remaining domain tables
-- =============================

-- project_management
CREATE TABLE IF NOT EXISTS project_management.pm_site_visits (
  id BIGSERIAL PRIMARY KEY,
  legacy_pm_site_visit_id INTEGER UNIQUE,
  project_id INTEGER REFERENCES core.projects(id),
  user_id INTEGER,
  visit_date DATE,
  notes TEXT,
  weather_conditions TEXT,
  safety_status TEXT,
  photo_ids JSONB,
  source_table TEXT NOT NULL DEFAULT 'public.pm_site_visits',
  source_update_request_id BIGINT REFERENCES imports.source_update_requests(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_management.pm_on_the_go_actions (
  id BIGSERIAL PRIMARY KEY,
  legacy_pm_on_the_go_action_id INTEGER UNIQUE,
  project_id INTEGER REFERENCES core.projects(id),
  user_id INTEGER,
  action_type TEXT,
  title TEXT,
  description TEXT,
  severity TEXT,
  amount NUMERIC(15,2),
  status TEXT,
  related_entity_id INTEGER,
  related_entity_type TEXT,
  metadata JSONB,
  source_update_request_id BIGINT REFERENCES imports.source_update_requests(id),
  source_table TEXT NOT NULL DEFAULT 'public.pm_on_the_go_actions',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_management.pm_compliance_tracking (
  id BIGSERIAL PRIMARY KEY,
  legacy_pm_compliance_tracking_id INTEGER UNIQUE,
  project_id INTEGER REFERENCES core.projects(id),
  user_id INTEGER,
  week_start_date DATE,
  daily_diary_done JSONB,
  weekly_progress_done BOOLEAN,
  weekly_risk_done BOOLEAN,
  source_table TEXT NOT NULL DEFAULT 'public.pm_compliance_tracking',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_management.pm_mode_preferences (
  id BIGSERIAL PRIMARY KEY,
  legacy_pm_mode_preference_id INTEGER UNIQUE,
  user_id INTEGER UNIQUE,
  preferred_mode TEXT,
  source_table TEXT NOT NULL DEFAULT 'public.pm_mode_preferences',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_management.weekly_reviews (
  id BIGSERIAL PRIMARY KEY,
  legacy_weekly_review_id INTEGER UNIQUE,
  project_id INTEGER REFERENCES core.projects(id),
  project_name_snapshot TEXT,
  week_starting DATE,
  reviewed_by INTEGER,
  status TEXT,
  snapshot_metrics JSONB,
  payload JSONB,
  source_table TEXT NOT NULL DEFAULT 'public.weekly_reviews',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_management.schedule_change_notices (
  id BIGSERIAL PRIMARY KEY,
  legacy_schedule_change_notice_id INTEGER UNIQUE,
  project_id INTEGER REFERENCES core.projects(id),
  project_name_snapshot TEXT,
  summary TEXT,
  old_finish_date TEXT,
  new_finish_date TEXT,
  changed_tasks TEXT,
  critical_path_delta TEXT,
  user_note TEXT,
  client_notified INTEGER,
  documentation_updated INTEGER,
  created_by INTEGER,
  source_table TEXT NOT NULL DEFAULT 'public.schedule_change_notice',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- project_development
CREATE TABLE IF NOT EXISTS project_development.pd_tickets (
  id BIGSERIAL PRIMARY KEY,
  legacy_pd_ticket_id INTEGER UNIQUE,
  project_id INTEGER REFERENCES core.projects(id),
  client_id INTEGER REFERENCES core.clients(id),
  request_type TEXT,
  status TEXT,
  priority TEXT,
  project_site_name TEXT,
  due_date TEXT,
  owner_user_id INTEGER,
  metadata JSONB,
  source_table TEXT NOT NULL DEFAULT 'public.pd_tickets',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_development.intake_requests (
  id BIGSERIAL PRIMARY KEY,
  legacy_intake_request_id INTEGER UNIQUE,
  project_id INTEGER REFERENCES core.projects(id),
  pd_ticket_id BIGINT REFERENCES project_development.pd_tickets(id),
  source_system TEXT NOT NULL DEFAULT 'sharepoint',
  source_record_id TEXT,
  request_type TEXT,
  status TEXT,
  payload JSONB,
  source_table TEXT NOT NULL DEFAULT 'public.intake_requests',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_development.intake_task_templates (
  id BIGSERIAL PRIMARY KEY,
  legacy_intake_task_template_id INTEGER UNIQUE,
  request_type TEXT,
  title TEXT,
  description TEXT,
  dod_items JSONB,
  sort_order INTEGER,
  is_active BOOLEAN,
  source_table TEXT NOT NULL DEFAULT 'public.intake_task_templates',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_development.intake_tasks (
  id BIGSERIAL PRIMARY KEY,
  legacy_intake_task_id INTEGER UNIQUE,
  intake_request_id BIGINT REFERENCES project_development.intake_requests(id) ON DELETE CASCADE,
  template_item_id BIGINT REFERENCES project_development.intake_task_templates(id),
  linked_work_item_id INTEGER REFERENCES core.work_items(id),
  title TEXT,
  status TEXT,
  assigned_to TEXT,
  due_date TEXT,
  payload JSONB,
  source_table TEXT NOT NULL DEFAULT 'public.intake_tasks',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- engineering
CREATE TABLE IF NOT EXISTS engineering.eng_stage_templates (
  id BIGSERIAL PRIMARY KEY,
  legacy_eng_stage_template_id INTEGER UNIQUE,
  name TEXT,
  description TEXT,
  sequence INTEGER,
  is_active BOOLEAN,
  source_table TEXT NOT NULL DEFAULT 'public.eng_stage_templates',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS engineering.eng_task_templates (
  id BIGSERIAL PRIMARY KEY,
  legacy_eng_task_template_id INTEGER UNIQUE,
  stage_template_id BIGINT REFERENCES engineering.eng_stage_templates(id) ON DELETE CASCADE,
  title TEXT,
  description TEXT,
  is_required BOOLEAN,
  sequence INTEGER,
  default_owner_role TEXT,
  source_table TEXT NOT NULL DEFAULT 'public.eng_task_templates'
);

CREATE TABLE IF NOT EXISTS engineering.eng_deliverable_templates (
  id BIGSERIAL PRIMARY KEY,
  legacy_eng_deliverable_template_id INTEGER UNIQUE,
  stage_template_id BIGINT REFERENCES engineering.eng_stage_templates(id) ON DELETE CASCADE,
  name TEXT,
  description TEXT,
  is_required BOOLEAN,
  allowed_file_types TEXT[],
  required_count INTEGER,
  source_table TEXT NOT NULL DEFAULT 'public.eng_deliverable_templates'
);

CREATE TABLE IF NOT EXISTS engineering.project_eng_stages (
  id BIGSERIAL PRIMARY KEY,
  legacy_project_eng_stage_id INTEGER UNIQUE,
  project_id INTEGER REFERENCES core.projects(id),
  stage_template_id BIGINT REFERENCES engineering.eng_stage_templates(id),
  status TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  override_reason TEXT,
  created_by INTEGER,
  source_table TEXT NOT NULL DEFAULT 'public.project_eng_stages',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS engineering.project_eng_tasks (
  id BIGSERIAL PRIMARY KEY,
  legacy_project_eng_task_id INTEGER UNIQUE,
  project_eng_stage_id BIGINT REFERENCES engineering.project_eng_stages(id) ON DELETE CASCADE,
  task_template_id BIGINT REFERENCES engineering.eng_task_templates(id),
  linked_work_item_id INTEGER REFERENCES core.work_items(id),
  status TEXT,
  owner_user_id INTEGER,
  due_date TEXT,
  notes TEXT,
  completed_at TIMESTAMP,
  completed_by INTEGER,
  has_deliverable BOOLEAN,
  source_table TEXT NOT NULL DEFAULT 'public.project_eng_tasks',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS engineering.project_eng_deliverables (
  id BIGSERIAL PRIMARY KEY,
  legacy_project_eng_deliverable_id INTEGER UNIQUE,
  project_eng_stage_id BIGINT REFERENCES engineering.project_eng_stages(id) ON DELETE CASCADE,
  deliverable_template_id BIGINT REFERENCES engineering.eng_deliverable_templates(id),
  project_eng_task_id BIGINT REFERENCES engineering.project_eng_tasks(id),
  document_version_id BIGINT REFERENCES documentation.document_versions(id),
  file_name TEXT,
  storage_ref TEXT,
  mime_type TEXT,
  uploaded_by INTEGER,
  uploaded_at TIMESTAMP,
  approval_status TEXT,
  approved_by INTEGER,
  approved_at TIMESTAMP,
  source_table TEXT NOT NULL DEFAULT 'public.project_eng_deliverables'
);

CREATE TABLE IF NOT EXISTS engineering.project_eng_approvals (
  id BIGSERIAL PRIMARY KEY,
  legacy_project_eng_approval_id INTEGER UNIQUE,
  project_eng_stage_id BIGINT REFERENCES engineering.project_eng_stages(id) ON DELETE CASCADE,
  approver_role TEXT,
  approver_user_id INTEGER,
  status TEXT,
  comments TEXT,
  source_table TEXT NOT NULL DEFAULT 'public.project_eng_approvals',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- quality
CREATE TABLE IF NOT EXISTS quality.qc_templates (
  id BIGSERIAL PRIMARY KEY,
  legacy_qc_template_id INTEGER UNIQUE,
  name TEXT,
  version INTEGER,
  is_active BOOLEAN,
  source_table TEXT NOT NULL DEFAULT 'public.qc_template',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quality.qc_template_phases (
  id BIGSERIAL PRIMARY KEY,
  legacy_qc_template_phase_id INTEGER UNIQUE,
  template_id BIGINT REFERENCES quality.qc_templates(id) ON DELETE CASCADE,
  phase_key TEXT,
  phase_name TEXT,
  sort_order INTEGER,
  source_table TEXT NOT NULL DEFAULT 'public.qc_template_phase'
);

CREATE TABLE IF NOT EXISTS quality.qc_template_groups (
  id BIGSERIAL PRIMARY KEY,
  legacy_qc_template_group_id INTEGER UNIQUE,
  template_phase_id BIGINT REFERENCES quality.qc_template_phases(id) ON DELETE CASCADE,
  group_name TEXT,
  sort_order INTEGER,
  source_table TEXT NOT NULL DEFAULT 'public.qc_template_group'
);

CREATE TABLE IF NOT EXISTS quality.qc_template_items (
  id BIGSERIAL PRIMARY KEY,
  legacy_qc_template_item_id INTEGER UNIQUE,
  template_group_id BIGINT REFERENCES quality.qc_template_groups(id) ON DELETE CASCADE,
  item_name TEXT,
  sort_order INTEGER,
  is_evidence_required BOOLEAN,
  default_severity TEXT,
  source_table TEXT NOT NULL DEFAULT 'public.qc_template_item'
);

CREATE TABLE IF NOT EXISTS quality.qc_template_risk_questions (
  id BIGSERIAL PRIMARY KEY,
  legacy_qc_template_risk_question_id INTEGER UNIQUE,
  template_phase_id BIGINT REFERENCES quality.qc_template_phases(id) ON DELETE CASCADE,
  question_text TEXT,
  sort_order INTEGER,
  response_type TEXT,
  triggers_warning BOOLEAN,
  trigger_condition TEXT,
  trigger_severity TEXT,
  source_table TEXT NOT NULL DEFAULT 'public.qc_template_risk_question'
);

CREATE TABLE IF NOT EXISTS quality.qc_checklists (
  id BIGSERIAL PRIMARY KEY,
  legacy_qc_checklist_id INTEGER UNIQUE,
  project_id INTEGER REFERENCES core.projects(id),
  project_name_snapshot TEXT,
  template_id BIGINT REFERENCES quality.qc_templates(id),
  status TEXT,
  source_table TEXT NOT NULL DEFAULT 'public.qc_checklist',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quality.qc_item_instances (
  id BIGSERIAL PRIMARY KEY,
  legacy_qc_item_instance_id INTEGER UNIQUE,
  checklist_id BIGINT REFERENCES quality.qc_checklists(id) ON DELETE CASCADE,
  template_item_id BIGINT REFERENCES quality.qc_template_items(id),
  linked_work_item_id INTEGER REFERENCES core.work_items(id),
  is_applicable BOOLEAN,
  approved BOOLEAN,
  approved_by_user_id INTEGER,
  approved_at TIMESTAMP,
  qm_status TEXT,
  assignee_user_id INTEGER,
  source_table TEXT NOT NULL DEFAULT 'public.qc_item_instance',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quality.qc_item_evidence (
  id BIGSERIAL PRIMARY KEY,
  legacy_qc_item_evidence_id INTEGER UNIQUE,
  item_instance_id BIGINT REFERENCES quality.qc_item_instances(id) ON DELETE CASCADE,
  document_version_id BIGINT REFERENCES documentation.document_versions(id),
  evidence_url TEXT,
  evidence_note TEXT,
  source_table TEXT NOT NULL DEFAULT 'public.qc_item_evidence',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quality.qc_risk_answers (
  id BIGSERIAL PRIMARY KEY,
  legacy_qc_risk_answer_id INTEGER UNIQUE,
  checklist_id BIGINT REFERENCES quality.qc_checklists(id) ON DELETE CASCADE,
  template_risk_question_id BIGINT REFERENCES quality.qc_template_risk_questions(id),
  answer_yesno BOOLEAN,
  answer_text TEXT,
  answer_number REAL,
  last_updated_by INTEGER,
  source_table TEXT NOT NULL DEFAULT 'public.qc_risk_answer',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quality.qc_plan_links (
  id BIGSERIAL PRIMARY KEY,
  legacy_qc_plan_link_id INTEGER UNIQUE,
  checklist_id BIGINT REFERENCES quality.qc_checklists(id) ON DELETE CASCADE,
  project_name_snapshot TEXT,
  plan_item_id INTEGER,
  item_instance_id BIGINT REFERENCES quality.qc_item_instances(id),
  phase_id INTEGER,
  link_type TEXT,
  source_table TEXT NOT NULL DEFAULT 'public.qc_plan_link',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quality.qc_warnings (
  id BIGSERIAL PRIMARY KEY,
  legacy_qc_warning_id INTEGER UNIQUE,
  project_id INTEGER REFERENCES core.projects(id),
  project_name_snapshot TEXT,
  severity TEXT,
  warning_type TEXT,
  title TEXT,
  description TEXT,
  related_plan_item_id INTEGER,
  related_item_instance_id BIGINT REFERENCES quality.qc_item_instances(id),
  status TEXT,
  owner_user_id INTEGER,
  due_date TEXT,
  source_table TEXT NOT NULL DEFAULT 'public.qc_warning',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quality.qc_warning_events (
  id BIGSERIAL PRIMARY KEY,
  legacy_qc_warning_event_id INTEGER UNIQUE,
  warning_id BIGINT REFERENCES quality.qc_warnings(id) ON DELETE CASCADE,
  event_type TEXT,
  actor_user_id INTEGER,
  note TEXT,
  source_table TEXT NOT NULL DEFAULT 'public.qc_warning_event',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quality.qc_postmortems (
  id BIGSERIAL PRIMARY KEY,
  legacy_qc_postmortem_id INTEGER UNIQUE,
  project_id INTEGER REFERENCES core.projects(id),
  project_name_snapshot TEXT,
  checklist_id BIGINT REFERENCES quality.qc_checklists(id),
  contractor_name TEXT,
  summary TEXT,
  source_table TEXT NOT NULL DEFAULT 'public.qc_postmortem',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quality.qc_postmortem_metric_values (
  id BIGSERIAL PRIMARY KEY,
  legacy_qc_postmortem_metric_value_id INTEGER UNIQUE,
  postmortem_id BIGINT REFERENCES quality.qc_postmortems(id) ON DELETE CASCADE,
  metric_name TEXT,
  metric_value REAL,
  notes TEXT,
  source_table TEXT NOT NULL DEFAULT 'public.qc_postmortem_metric_value'
);

CREATE TABLE IF NOT EXISTS quality.qc_postmortem_summaries (
  id BIGSERIAL PRIMARY KEY,
  legacy_qc_postmortem_summary_id INTEGER UNIQUE,
  postmortem_id BIGINT REFERENCES quality.qc_postmortems(id) ON DELETE CASCADE,
  summary_type TEXT,
  summary_text TEXT,
  source_table TEXT NOT NULL DEFAULT 'public.qc_postmortem_summary'
);

-- imports governance hardening additions
ALTER TABLE imports.source_update_requests ADD COLUMN IF NOT EXISTS obligation_source TEXT DEFAULT 'manual';
ALTER TABLE imports.source_update_requests ADD COLUMN IF NOT EXISTS enforcement_stage TEXT DEFAULT 'preview';
ALTER TABLE imports.source_update_acknowledgements ADD COLUMN IF NOT EXISTS role_scope TEXT DEFAULT 'project_update';

-- =============================
-- 2) Backfill from legacy tables
-- =============================

INSERT INTO project_management.pm_site_visits (legacy_pm_site_visit_id, project_id, user_id, visit_date, notes, weather_conditions, safety_status, photo_ids, created_at, updated_at)
SELECT psv.id, psv.project_id, psv.user_id, psv.visit_date, psv.notes, psv.weather_conditions, psv.safety_status, psv.photo_ids, COALESCE(psv.created_at, NOW()), COALESCE(psv.updated_at, NOW())
FROM public.pm_site_visits psv
ON CONFLICT (legacy_pm_site_visit_id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  user_id = EXCLUDED.user_id,
  notes = EXCLUDED.notes,
  weather_conditions = EXCLUDED.weather_conditions,
  safety_status = EXCLUDED.safety_status,
  photo_ids = EXCLUDED.photo_ids,
  updated_at = NOW();

INSERT INTO project_management.pm_on_the_go_actions (legacy_pm_on_the_go_action_id, project_id, user_id, action_type, title, description, severity, amount, status, related_entity_id, related_entity_type, metadata, created_at, updated_at)
SELECT pga.id, pga.project_id, pga.user_id, pga.action_type::TEXT, pga.title, pga.description, pga.severity, pga.amount, pga.status::TEXT, pga.related_entity_id, pga.related_entity_type, pga.metadata, COALESCE(pga.created_at, NOW()), COALESCE(pga.updated_at, NOW())
FROM public.pm_on_the_go_actions pga
ON CONFLICT (legacy_pm_on_the_go_action_id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  user_id = EXCLUDED.user_id,
  status = EXCLUDED.status,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();

UPDATE project_management.pm_on_the_go_actions a
SET source_update_request_id = r.id
FROM imports.source_update_requests r
WHERE a.source_update_request_id IS NULL
  AND a.project_id = r.project_id
  AND r.requested_at >= a.created_at - INTERVAL '1 day'
  AND r.requested_at <= a.created_at + INTERVAL '3 days';

INSERT INTO project_management.pm_compliance_tracking (legacy_pm_compliance_tracking_id, project_id, user_id, week_start_date, daily_diary_done, weekly_progress_done, weekly_risk_done, created_at, updated_at)
SELECT pct.id, pct.project_id, pct.user_id, pct.week_start_date, pct.daily_diary_done, pct.weekly_progress_done, pct.weekly_risk_done, COALESCE(pct.created_at, NOW()), COALESCE(pct.updated_at, NOW())
FROM public.pm_compliance_tracking pct
ON CONFLICT (legacy_pm_compliance_tracking_id) DO UPDATE SET
  weekly_progress_done = EXCLUDED.weekly_progress_done,
  weekly_risk_done = EXCLUDED.weekly_risk_done,
  updated_at = NOW();

INSERT INTO project_management.pm_mode_preferences (legacy_pm_mode_preference_id, user_id, preferred_mode, updated_at)
SELECT pmp.id, pmp.user_id, pmp.preferred_mode, COALESCE(pmp.updated_at, NOW())
FROM public.pm_mode_preferences pmp
ON CONFLICT (legacy_pm_mode_preference_id) DO UPDATE SET preferred_mode = EXCLUDED.preferred_mode, updated_at = NOW();

INSERT INTO project_management.weekly_reviews (legacy_weekly_review_id, project_id, project_name_snapshot, week_starting, reviewed_by, status, snapshot_metrics, payload, created_at, completed_at)
SELECT wr.id, cp.id, wr.project_name, wr.week_starting, wr.reviewed_by, wr.status, wr.snapshot_metrics,
       jsonb_build_object('step_schedule', wr.step_schedule, 'step_budget', wr.step_budget, 'step_risks', wr.step_risks, 'step_quality', wr.step_quality, 'step_actions', wr.step_actions, 'step_summary', wr.step_summary),
       COALESCE(wr.created_at, NOW()), wr.completed_at
FROM public.weekly_reviews wr
LEFT JOIN core.projects cp ON cp.project_name = wr.project_name
ON CONFLICT (legacy_weekly_review_id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  status = EXCLUDED.status,
  snapshot_metrics = EXCLUDED.snapshot_metrics,
  payload = EXCLUDED.payload,
  completed_at = EXCLUDED.completed_at;

INSERT INTO project_management.schedule_change_notices (legacy_schedule_change_notice_id, project_id, project_name_snapshot, summary, old_finish_date, new_finish_date, changed_tasks, critical_path_delta, user_note, client_notified, documentation_updated, created_by, created_at)
SELECT scn.id, cp.id, scn.project_name, scn.summary, scn.old_finish_date, scn.new_finish_date, scn.changed_tasks, scn.critical_path_delta, scn.user_note, scn.client_notified, scn.documentation_updated, scn.created_by, COALESCE(scn.created_at, NOW())
FROM public.schedule_change_notice scn
LEFT JOIN core.projects cp ON cp.project_name = scn.project_name
ON CONFLICT (legacy_schedule_change_notice_id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  summary = EXCLUDED.summary,
  new_finish_date = EXCLUDED.new_finish_date,
  changed_tasks = EXCLUDED.changed_tasks,
  critical_path_delta = EXCLUDED.critical_path_delta,
  user_note = EXCLUDED.user_note;

INSERT INTO project_development.pd_tickets (legacy_pd_ticket_id, project_id, client_id, request_type, status, priority, project_site_name, due_date, owner_user_id, metadata, created_at, updated_at)
SELECT pt.id, pt.project_id, pt.client_id, pt.request_type, pt.status, pt.priority, pt.project_site_name, pt.due_date, pt.project_developer_user_id,
       to_jsonb(pt) - 'id' - 'created_at' - 'updated_at', COALESCE(pt.created_at, NOW()), COALESCE(pt.updated_at, NOW())
FROM public.pd_tickets pt
ON CONFLICT (legacy_pd_ticket_id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  status = EXCLUDED.status,
  priority = EXCLUDED.priority,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();

INSERT INTO project_development.intake_requests (legacy_intake_request_id, project_id, request_type, status, payload, created_at, updated_at)
SELECT ir.id, ir.project_id, ir.request_type, ir.status, to_jsonb(ir) - 'id' - 'created_at' - 'updated_at', COALESCE(ir.created_at, NOW()), COALESCE(ir.updated_at, NOW())
FROM public.intake_requests ir
ON CONFLICT (legacy_intake_request_id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  status = EXCLUDED.status,
  payload = EXCLUDED.payload,
  updated_at = NOW();

INSERT INTO project_development.intake_task_templates (legacy_intake_task_template_id, request_type, title, description, dod_items, sort_order, is_active, created_at)
SELECT itt.id, itt.request_type, itt.title, itt.description, itt.dod_items, itt.sort_order, itt.is_active, COALESCE(itt.created_at, NOW())
FROM public.intake_task_templates itt
ON CONFLICT (legacy_intake_task_template_id) DO UPDATE SET
  request_type = EXCLUDED.request_type,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  dod_items = EXCLUDED.dod_items,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;

INSERT INTO project_development.intake_tasks (legacy_intake_task_id, intake_request_id, template_item_id, title, status, assigned_to, due_date, payload, created_at, updated_at)
SELECT it.id, pir.id, pitt.id, it.title, it.status, it.assigned_to, it.due_date, to_jsonb(it) - 'id' - 'created_at' - 'updated_at', COALESCE(it.created_at, NOW()), COALESCE(it.updated_at, NOW())
FROM public.intake_tasks it
LEFT JOIN project_development.intake_requests pir ON pir.legacy_intake_request_id = it.intake_request_id
LEFT JOIN project_development.intake_task_templates pitt ON pitt.legacy_intake_task_template_id = it.template_item_id
ON CONFLICT (legacy_intake_task_id) DO UPDATE SET
  intake_request_id = EXCLUDED.intake_request_id,
  template_item_id = EXCLUDED.template_item_id,
  status = EXCLUDED.status,
  payload = EXCLUDED.payload,
  updated_at = NOW();

UPDATE project_development.intake_tasks it
SET linked_work_item_id = wi.id
FROM core.work_items wi
WHERE wi.source_table = 'public.intake_tasks'
  AND wi.legacy_work_items_id = it.legacy_intake_task_id
  AND it.linked_work_item_id IS NULL;

INSERT INTO engineering.eng_stage_templates (legacy_eng_stage_template_id, name, description, sequence, is_active, created_at, updated_at)
SELECT id, name, description, sequence, is_active, COALESCE(created_at, NOW()), COALESCE(updated_at, NOW())
FROM public.eng_stage_templates
ON CONFLICT (legacy_eng_stage_template_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  sequence = EXCLUDED.sequence,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

INSERT INTO engineering.eng_task_templates (legacy_eng_task_template_id, stage_template_id, title, description, is_required, sequence, default_owner_role)
SELECT ett.id, est.id, ett.title, ett.description, ett.is_required, ett.sequence, ett.default_owner_role
FROM public.eng_task_templates ett
LEFT JOIN engineering.eng_stage_templates est ON est.legacy_eng_stage_template_id = ett.stage_template_id
ON CONFLICT (legacy_eng_task_template_id) DO UPDATE SET
  stage_template_id = EXCLUDED.stage_template_id,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  sequence = EXCLUDED.sequence;

INSERT INTO engineering.eng_deliverable_templates (legacy_eng_deliverable_template_id, stage_template_id, name, description, is_required, allowed_file_types, required_count)
SELECT edt.id, est.id, edt.name, edt.description, edt.is_required, edt.allowed_file_types, edt.required_count
FROM public.eng_deliverable_templates edt
LEFT JOIN engineering.eng_stage_templates est ON est.legacy_eng_stage_template_id = edt.stage_template_id
ON CONFLICT (legacy_eng_deliverable_template_id) DO UPDATE SET
  stage_template_id = EXCLUDED.stage_template_id,
  name = EXCLUDED.name,
  required_count = EXCLUDED.required_count;

INSERT INTO engineering.project_eng_stages (legacy_project_eng_stage_id, project_id, stage_template_id, status, started_at, completed_at, override_reason, created_by, created_at)
SELECT pes.id, pes.project_id, est.id, pes.status, pes.started_at, pes.completed_at, pes.override_reason, pes.created_by, COALESCE(pes.created_at, NOW())
FROM public.project_eng_stages pes
LEFT JOIN engineering.eng_stage_templates est ON est.legacy_eng_stage_template_id = pes.stage_template_id
ON CONFLICT (legacy_project_eng_stage_id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  status = EXCLUDED.status,
  started_at = EXCLUDED.started_at,
  completed_at = EXCLUDED.completed_at,
  override_reason = EXCLUDED.override_reason;

INSERT INTO engineering.project_eng_tasks (legacy_project_eng_task_id, project_eng_stage_id, task_template_id, status, owner_user_id, due_date, notes, completed_at, completed_by, has_deliverable, created_at)
SELECT pet.id, epes.id, ett.id, pet.status, pet.owner_user_id, pet.due_date, pet.notes, pet.completed_at, pet.completed_by, pet.has_deliverable, COALESCE(pet.created_at, NOW())
FROM public.project_eng_tasks pet
LEFT JOIN engineering.project_eng_stages epes ON epes.legacy_project_eng_stage_id = pet.project_eng_stage_id
LEFT JOIN engineering.eng_task_templates ett ON ett.legacy_eng_task_template_id = pet.task_template_id
ON CONFLICT (legacy_project_eng_task_id) DO UPDATE SET
  project_eng_stage_id = EXCLUDED.project_eng_stage_id,
  status = EXCLUDED.status,
  owner_user_id = EXCLUDED.owner_user_id,
  due_date = EXCLUDED.due_date,
  completed_at = EXCLUDED.completed_at,
  has_deliverable = EXCLUDED.has_deliverable;

UPDATE engineering.project_eng_tasks pet
SET linked_work_item_id = wi.id
FROM core.work_items wi
WHERE wi.source_table = 'public.project_eng_tasks'
  AND wi.legacy_work_items_id = pet.legacy_project_eng_task_id
  AND pet.linked_work_item_id IS NULL;

INSERT INTO engineering.project_eng_deliverables (legacy_project_eng_deliverable_id, project_eng_stage_id, deliverable_template_id, project_eng_task_id, file_name, storage_ref, mime_type, uploaded_by, uploaded_at, approval_status, approved_by, approved_at)
SELECT ped.id, epes.id, eedt.id, ept.id, ped.file_name, ped.storage_ref, ped.mime_type, ped.uploaded_by, ped.uploaded_at, ped.approval_status, ped.approved_by, ped.approved_at
FROM public.project_eng_deliverables ped
LEFT JOIN engineering.project_eng_stages epes ON epes.legacy_project_eng_stage_id = ped.project_eng_stage_id
LEFT JOIN engineering.eng_deliverable_templates eedt ON eedt.legacy_eng_deliverable_template_id = ped.deliverable_template_id
LEFT JOIN engineering.project_eng_tasks ept ON ept.legacy_project_eng_task_id = ped.project_eng_task_id
ON CONFLICT (legacy_project_eng_deliverable_id) DO UPDATE SET
  project_eng_stage_id = EXCLUDED.project_eng_stage_id,
  project_eng_task_id = EXCLUDED.project_eng_task_id,
  file_name = EXCLUDED.file_name,
  storage_ref = EXCLUDED.storage_ref,
  approval_status = EXCLUDED.approval_status,
  approved_by = EXCLUDED.approved_by,
  approved_at = EXCLUDED.approved_at;

INSERT INTO engineering.project_eng_approvals (legacy_project_eng_approval_id, project_eng_stage_id, approver_role, approver_user_id, status, comments, created_at, updated_at)
SELECT pea.id, epes.id, pea.approver_role, pea.approver_user_id, pea.status, pea.comments, COALESCE(pea.created_at, NOW()), COALESCE(pea.updated_at, NOW())
FROM public.project_eng_approvals pea
LEFT JOIN engineering.project_eng_stages epes ON epes.legacy_project_eng_stage_id = pea.project_eng_stage_id
ON CONFLICT (legacy_project_eng_approval_id) DO UPDATE SET
  project_eng_stage_id = EXCLUDED.project_eng_stage_id,
  status = EXCLUDED.status,
  comments = EXCLUDED.comments,
  updated_at = NOW();

INSERT INTO quality.qc_templates (legacy_qc_template_id, name, version, is_active, created_at)
SELECT id, name, version, is_active, COALESCE(created_at, NOW()) FROM public.qc_template
ON CONFLICT (legacy_qc_template_id) DO UPDATE SET
  name = EXCLUDED.name,
  version = EXCLUDED.version,
  is_active = EXCLUDED.is_active;

INSERT INTO quality.qc_template_phases (legacy_qc_template_phase_id, template_id, phase_key, phase_name, sort_order)
SELECT qtp.id, qt.id, qtp.phase_key, qtp.phase_name, qtp.sort_order
FROM public.qc_template_phase qtp
LEFT JOIN quality.qc_templates qt ON qt.legacy_qc_template_id = qtp.template_id
ON CONFLICT (legacy_qc_template_phase_id) DO UPDATE SET
  template_id = EXCLUDED.template_id,
  phase_key = EXCLUDED.phase_key,
  phase_name = EXCLUDED.phase_name,
  sort_order = EXCLUDED.sort_order;

INSERT INTO quality.qc_template_groups (legacy_qc_template_group_id, template_phase_id, group_name, sort_order)
SELECT qtg.id, qtp.id, qtg.group_name, qtg.sort_order
FROM public.qc_template_group qtg
LEFT JOIN quality.qc_template_phases qtp ON qtp.legacy_qc_template_phase_id = qtg.template_phase_id
ON CONFLICT (legacy_qc_template_group_id) DO UPDATE SET
  template_phase_id = EXCLUDED.template_phase_id,
  group_name = EXCLUDED.group_name,
  sort_order = EXCLUDED.sort_order;

INSERT INTO quality.qc_template_items (legacy_qc_template_item_id, template_group_id, item_name, sort_order, is_evidence_required, default_severity)
SELECT qti.id, qtg.id, qti.item_name, qti.sort_order, qti.is_evidence_required, qti.default_severity
FROM public.qc_template_item qti
LEFT JOIN quality.qc_template_groups qtg ON qtg.legacy_qc_template_group_id = qti.template_group_id
ON CONFLICT (legacy_qc_template_item_id) DO UPDATE SET
  template_group_id = EXCLUDED.template_group_id,
  item_name = EXCLUDED.item_name,
  sort_order = EXCLUDED.sort_order,
  is_evidence_required = EXCLUDED.is_evidence_required,
  default_severity = EXCLUDED.default_severity;

INSERT INTO quality.qc_template_risk_questions (legacy_qc_template_risk_question_id, template_phase_id, question_text, sort_order, response_type, triggers_warning, trigger_condition, trigger_severity)
SELECT qtrq.id, qtp.id, qtrq.question_text, qtrq.sort_order, qtrq.response_type, qtrq.triggers_warning, qtrq.trigger_condition, qtrq.trigger_severity
FROM public.qc_template_risk_question qtrq
LEFT JOIN quality.qc_template_phases qtp ON qtp.legacy_qc_template_phase_id = qtrq.template_phase_id
ON CONFLICT (legacy_qc_template_risk_question_id) DO UPDATE SET
  template_phase_id = EXCLUDED.template_phase_id,
  question_text = EXCLUDED.question_text,
  sort_order = EXCLUDED.sort_order,
  trigger_severity = EXCLUDED.trigger_severity;

INSERT INTO quality.qc_checklists (legacy_qc_checklist_id, project_id, project_name_snapshot, template_id, status, created_at)
SELECT qc.id, qc.project_id, qc.project_name, qt.id, qc.status, COALESCE(qc.created_at, NOW())
FROM public.qc_checklist qc
LEFT JOIN quality.qc_templates qt ON qt.legacy_qc_template_id = qc.template_id
ON CONFLICT (legacy_qc_checklist_id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  status = EXCLUDED.status,
  template_id = EXCLUDED.template_id;

INSERT INTO quality.qc_item_instances (legacy_qc_item_instance_id, checklist_id, template_item_id, is_applicable, approved, approved_by_user_id, approved_at, qm_status, assignee_user_id, created_at, updated_at)
SELECT qii.id, qqc.id, qqti.id, qii.is_applicable, qii.approved, qii.approved_by_user_id, qii.approved_at, qii.qm_status, qii.assignee_user_id, COALESCE(qii.last_updated_at, NOW()), COALESCE(qii.last_updated_at, NOW())
FROM public.qc_item_instance qii
LEFT JOIN quality.qc_checklists qqc ON qqc.legacy_qc_checklist_id = qii.checklist_id
LEFT JOIN quality.qc_template_items qqti ON qqti.legacy_qc_template_item_id = qii.template_item_id
ON CONFLICT (legacy_qc_item_instance_id) DO UPDATE SET
  checklist_id = EXCLUDED.checklist_id,
  template_item_id = EXCLUDED.template_item_id,
  approved = EXCLUDED.approved,
  qm_status = EXCLUDED.qm_status,
  assignee_user_id = EXCLUDED.assignee_user_id,
  updated_at = NOW();

INSERT INTO quality.qc_item_evidence (legacy_qc_item_evidence_id, item_instance_id, evidence_url, evidence_note, created_at)
SELECT qie.id, qqii.id, qie.evidence_url, qie.evidence_note, COALESCE(qie.created_at, NOW())
FROM public.qc_item_evidence qie
LEFT JOIN quality.qc_item_instances qqii ON qqii.legacy_qc_item_instance_id = qie.item_instance_id
ON CONFLICT (legacy_qc_item_evidence_id) DO UPDATE SET
  item_instance_id = EXCLUDED.item_instance_id,
  evidence_url = EXCLUDED.evidence_url,
  evidence_note = EXCLUDED.evidence_note;

INSERT INTO quality.qc_risk_answers (legacy_qc_risk_answer_id, checklist_id, template_risk_question_id, answer_yesno, answer_text, answer_number, last_updated_by, updated_at)
SELECT qra.id, qqc.id, qqrq.id, qra.answer_yesno, qra.answer_text, qra.answer_number, qra.last_updated_by, COALESCE(qra.last_updated_at, NOW())
FROM public.qc_risk_answer qra
LEFT JOIN quality.qc_checklists qqc ON qqc.legacy_qc_checklist_id = qra.checklist_id
LEFT JOIN quality.qc_template_risk_questions qqrq ON qqrq.legacy_qc_template_risk_question_id = qra.template_risk_question_id
ON CONFLICT (legacy_qc_risk_answer_id) DO UPDATE SET
  checklist_id = EXCLUDED.checklist_id,
  answer_yesno = EXCLUDED.answer_yesno,
  answer_text = EXCLUDED.answer_text,
  updated_at = NOW();

INSERT INTO quality.qc_plan_links (legacy_qc_plan_link_id, project_name_snapshot, plan_item_id, item_instance_id, phase_id, link_type, created_at)
SELECT qpl.id, qpl.project_name, qpl.plan_item_id, qqii.id, qpl.phase_id, qpl.link_type, COALESCE(qpl.created_at, NOW())
FROM public.qc_plan_link qpl
LEFT JOIN quality.qc_item_instances qqii ON qqii.legacy_qc_item_instance_id = qpl.item_instance_id
ON CONFLICT (legacy_qc_plan_link_id) DO UPDATE SET
  item_instance_id = EXCLUDED.item_instance_id,
  link_type = EXCLUDED.link_type;

UPDATE quality.qc_plan_links qpl
SET checklist_id = qqii.checklist_id
FROM quality.qc_item_instances qqii
WHERE qqii.id = qpl.item_instance_id
  AND qpl.checklist_id IS NULL;

INSERT INTO quality.qc_warnings (legacy_qc_warning_id, project_id, project_name_snapshot, severity, warning_type, title, description, related_plan_item_id, related_item_instance_id, status, owner_user_id, due_date, created_at, updated_at)
SELECT qw.id, cp.id, qw.project_name, qw.severity, qw.warning_type, qw.title, qw.description, qw.related_plan_item_id, qqii.id, qw.status, qw.owner_user_id, qw.due_date, COALESCE(qw.created_at, NOW()), COALESCE(qw.updated_at, NOW())
FROM public.qc_warning qw
LEFT JOIN core.projects cp ON cp.project_name = qw.project_name
LEFT JOIN quality.qc_item_instances qqii ON qqii.legacy_qc_item_instance_id = qw.related_item_instance_id
ON CONFLICT (legacy_qc_warning_id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  status = EXCLUDED.status,
  related_item_instance_id = EXCLUDED.related_item_instance_id,
  updated_at = NOW();

INSERT INTO quality.qc_warning_events (legacy_qc_warning_event_id, warning_id, event_type, actor_user_id, note, created_at)
SELECT qwe.id, qqw.id, qwe.event_type, qwe.actor_user_id, qwe.note, COALESCE(qwe.created_at, NOW())
FROM public.qc_warning_event qwe
LEFT JOIN quality.qc_warnings qqw ON qqw.legacy_qc_warning_id = qwe.warning_id
ON CONFLICT (legacy_qc_warning_event_id) DO UPDATE SET
  warning_id = EXCLUDED.warning_id,
  event_type = EXCLUDED.event_type,
  actor_user_id = EXCLUDED.actor_user_id,
  note = EXCLUDED.note;

INSERT INTO quality.qc_postmortems (legacy_qc_postmortem_id, project_id, project_name_snapshot, checklist_id, contractor_name, summary, created_at)
SELECT qp.id, cp.id, qp.project_name, qqc.id, qp.contractor_name, qp.summary, COALESCE(qp.created_at, NOW())
FROM public.qc_postmortem qp
LEFT JOIN core.projects cp ON cp.project_name = qp.project_name
LEFT JOIN quality.qc_checklists qqc ON qqc.legacy_qc_checklist_id = qp.checklist_id
ON CONFLICT (legacy_qc_postmortem_id) DO UPDATE SET
  project_id = EXCLUDED.project_id,
  summary = EXCLUDED.summary,
  checklist_id = EXCLUDED.checklist_id;

INSERT INTO quality.qc_postmortem_metric_values (legacy_qc_postmortem_metric_value_id, postmortem_id, metric_name, metric_value, notes)
SELECT qpmv.id, qqpm.id, qpmv.metric_name, qpmv.metric_value, qpmv.notes
FROM public.qc_postmortem_metric_value qpmv
LEFT JOIN quality.qc_postmortems qqpm ON qqpm.legacy_qc_postmortem_id = qpmv.postmortem_id
ON CONFLICT (legacy_qc_postmortem_metric_value_id) DO UPDATE SET
  postmortem_id = EXCLUDED.postmortem_id,
  metric_value = EXCLUDED.metric_value,
  notes = EXCLUDED.notes;

INSERT INTO quality.qc_postmortem_summaries (legacy_qc_postmortem_summary_id, postmortem_id, summary_type, summary_text)
SELECT qps.id, qqpm.id, qps.summary_type, qps.summary_text
FROM public.qc_postmortem_summary qps
LEFT JOIN quality.qc_postmortems qqpm ON qqpm.legacy_qc_postmortem_id = qps.postmortem_id
ON CONFLICT (legacy_qc_postmortem_summary_id) DO UPDATE SET
  postmortem_id = EXCLUDED.postmortem_id,
  summary_type = EXCLUDED.summary_type,
  summary_text = EXCLUDED.summary_text;

-- =============================
-- 3) Documentation + finance + imports hardening views
-- =============================

CREATE OR REPLACE VIEW documentation.v_document_lifecycle_integrity AS
SELECT
  d.id AS document_id,
  d.project_id,
  d.linked_work_item_id,
  COUNT(DISTINCT dv.id) AS version_count,
  COUNT(DISTINCT de.id) AS event_count,
  COUNT(DISTINCT da.id) AS approval_count,
  COUNT(DISTINCT dt.id) AS transmission_count,
  COUNT(DISTINCT CASE WHEN dvw.view_type IN ('view', 'download') THEN dvw.id END) AS view_or_download_count,
  COUNT(DISTINCT CASE WHEN dvw.view_type = 'download' THEN dvw.id END) AS download_count,
  COUNT(DISTINCT CASE WHEN de.event_type = 'uploaded' THEN de.id END) AS upload_event_count,
  COUNT(DISTINCT CASE WHEN de.event_type = 'approved' THEN de.id END) AS approval_event_count,
  COUNT(DISTINCT CASE WHEN de.event_type = 'sent' THEN de.id END) AS sent_event_count
FROM documentation.documents d
LEFT JOIN documentation.document_versions dv ON dv.document_id = d.id
LEFT JOIN documentation.document_events de ON de.document_id = d.id
LEFT JOIN documentation.document_approvals da ON da.document_id = d.id
LEFT JOIN documentation.document_transmissions dt ON dt.document_id = d.id
LEFT JOIN documentation.document_views dvw ON dvw.document_id = d.id
GROUP BY d.id, d.project_id, d.linked_work_item_id;

CREATE OR REPLACE VIEW finance.v_line_collision_classification AS
WITH rev AS (
  SELECT
    'revenue'::TEXT AS line_type,
    id,
    project_id,
    project_name_snapshot,
    amount_ex_vat,
    invoice_number,
    invoice_date,
    source_table,
    legacy_program_inflow_id::TEXT AS legacy_primary,
    legacy_normalized_revenue_line_id::TEXT AS legacy_secondary
  FROM finance.revenue_lines
), cost AS (
  SELECT
    'cost'::TEXT AS line_type,
    id,
    project_id,
    project_name_snapshot,
    amount_ex_vat,
    invoice_number,
    invoice_date,
    source_table,
    legacy_program_expense_id::TEXT AS legacy_primary,
    legacy_normalized_cost_line_id::TEXT AS legacy_secondary
  FROM finance.cost_lines
), all_lines AS (
  SELECT * FROM rev
  UNION ALL
  SELECT * FROM cost
)
SELECT
  line_type,
  id,
  project_id,
  project_name_snapshot,
  amount_ex_vat,
  invoice_number,
  invoice_date,
  source_table,
  CASE
    WHEN legacy_primary IS NOT NULL AND legacy_secondary IS NOT NULL THEN 'dual_lineage_overlap'
    WHEN COUNT(*) OVER (PARTITION BY line_type, COALESCE(project_id::TEXT, project_name_snapshot, 'NO_PROJECT'), COALESCE(invoice_number, 'NO_INVOICE'), COALESCE(invoice_date, 'NO_DATE'), COALESCE(amount_ex_vat, 0)) > 1 THEN 'duplicate_business_key'
    WHEN project_id IS NULL AND COALESCE(project_name_snapshot, '') = '' THEN 'orphan_missing_project'
    ELSE 'clean'
  END AS collision_classification
FROM all_lines;

CREATE OR REPLACE VIEW imports.v_source_update_ack_gaps AS
SELECT
  r.id AS source_update_request_id,
  r.project_id,
  r.status,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN COUNT(*) FILTER (WHERE a.acknowledged_role = 'CONSTRUCTION_MANAGER') = 0 THEN 'CONSTRUCTION_MANAGER' END,
    CASE WHEN COUNT(*) FILTER (WHERE a.acknowledged_role = 'PROGRAM_MANAGER') = 0 THEN 'PROGRAM_MANAGER' END,
    CASE WHEN COUNT(*) FILTER (WHERE a.acknowledged_role = 'PROGRAM_FINANCE_MANAGER') = 0 THEN 'PROGRAM_FINANCE_MANAGER' END
  ], NULL) AS missing_roles,
  COUNT(*) FILTER (WHERE a.id IS NOT NULL) AS acknowledgement_count
FROM imports.source_update_requests r
LEFT JOIN imports.source_update_acknowledgements a ON a.source_update_request_id = r.id
WHERE r.status IN ('pending', 'open', 'in_review')
GROUP BY r.id, r.project_id, r.status;

-- =============================
-- 4) Domain readiness/reconciliation views
-- =============================

CREATE OR REPLACE VIEW core.v_domain_rollout_readiness AS
WITH pm AS (
  SELECT
    'project_management'::TEXT AS domain,
    COUNT(*) FILTER (WHERE p.id IS NULL AND t.project_id IS NOT NULL) AS orphan_links,
    COUNT(*) FILTER (WHERE t.source_update_request_id IS NULL AND t.action_type IN ('log_delay', 'raise_variation', 'escalate')) AS governance_link_gaps,
    (ARRAY_AGG(t.id ORDER BY t.id) FILTER (WHERE p.id IS NULL AND t.project_id IS NOT NULL))[1:10] AS sample_ids
  FROM project_management.pm_on_the_go_actions t
  LEFT JOIN core.projects p ON p.id = t.project_id
),
pd AS (
  SELECT
    'project_development'::TEXT AS domain,
    COUNT(*) FILTER (WHERE r.id IS NULL) AS intake_task_orphans,
    COUNT(*) FILTER (WHERE t.project_id IS NULL) AS pd_ticket_project_gaps,
    (ARRAY_AGG(it.id ORDER BY it.id) FILTER (WHERE r.id IS NULL))[1:10] AS sample_ids
  FROM project_development.intake_tasks it
  LEFT JOIN project_development.intake_requests r ON r.id = it.intake_request_id
  LEFT JOIN project_development.pd_tickets t ON t.id = r.pd_ticket_id
),
doc AS (
  SELECT
    'documentation'::TEXT AS domain,
    COUNT(*) FILTER (WHERE l.version_count = 0) AS missing_versions,
    COUNT(*) FILTER (WHERE d.linked_work_item_id IS NOT NULL AND wi.id IS NULL) AS missing_work_item_lineage,
    COUNT(*) FILTER (WHERE d.project_id IS NOT NULL AND p.id IS NULL) AS missing_project_lineage,
    (ARRAY_AGG(d.id ORDER BY d.id) FILTER (WHERE l.version_count = 0))[1:10] AS sample_ids
  FROM documentation.documents d
  LEFT JOIN documentation.v_document_lifecycle_integrity l ON l.document_id = d.id
  LEFT JOIN core.work_items wi ON wi.id = d.linked_work_item_id
  LEFT JOIN core.projects p ON p.id = d.project_id
),
fin AS (
  SELECT
    'finance'::TEXT AS domain,
    COUNT(*) FILTER (WHERE collision_classification = 'duplicate_business_key') AS duplicates,
    COUNT(*) FILTER (WHERE collision_classification = 'dual_lineage_overlap') AS dual_lineage_overlap,
    COUNT(*) FILTER (WHERE collision_classification = 'orphan_missing_project') AS orphan_gaps,
    (ARRAY_AGG(id ORDER BY id) FILTER (WHERE collision_classification <> 'clean'))[1:10] AS sample_ids
  FROM finance.v_line_collision_classification
),
imp AS (
  SELECT
    'imports'::TEXT AS domain,
    COUNT(*) FILTER (WHERE CARDINALITY(missing_roles) > 0) AS acknowledgement_gaps,
    (SELECT COUNT(*) FROM imports.data_conflicts WHERE status <> 'resolved') AS unresolved_conflicts,
    (ARRAY_AGG(source_update_request_id ORDER BY source_update_request_id) FILTER (WHERE CARDINALITY(missing_roles) > 0))[1:10] AS sample_ids
  FROM imports.v_source_update_ack_gaps
),
eng AS (
  SELECT
    'engineering'::TEXT AS domain,
    COUNT(*) FILTER (WHERE s.id IS NULL) AS task_stage_orphans,
    COUNT(*) FILTER (WHERE t.linked_work_item_id IS NULL) AS unlinked_execution_tasks,
    (ARRAY_AGG(t.id ORDER BY t.id) FILTER (WHERE s.id IS NULL))[1:10] AS sample_ids
  FROM engineering.project_eng_tasks t
  LEFT JOIN engineering.project_eng_stages s ON s.id = t.project_eng_stage_id
),
qual AS (
  SELECT
    'quality'::TEXT AS domain,
    (SELECT COUNT(*)
      FROM quality.qc_item_instances i
      LEFT JOIN quality.qc_checklists c ON c.id = i.checklist_id
      WHERE c.id IS NULL) AS item_checklist_orphans,
    (SELECT COUNT(*)
      FROM quality.qc_item_evidence e
      LEFT JOIN quality.qc_item_instances i ON i.id = e.item_instance_id
      WHERE i.id IS NULL) AS evidence_orphans,
    (SELECT COUNT(*)
      FROM quality.qc_warnings w
      WHERE w.project_id IS NULL AND COALESCE(w.project_name_snapshot, '') <> '') AS warning_project_gaps,
    (SELECT (ARRAY_AGG(i.id ORDER BY i.id))[1:10]
      FROM quality.qc_item_instances i
      LEFT JOIN quality.qc_checklists c ON c.id = i.checklist_id
      WHERE c.id IS NULL) AS sample_ids
)
SELECT domain,
       CASE
         WHEN blocker_count = 0 AND mismatch_count = 0 THEN 'ready'
         WHEN blocker_count > 0 THEN 'blocked'
         ELSE 'partial'
       END AS readiness,
       blocker_count,
       mismatch_count,
       mismatch_categories,
       sample_ids,
       safe_read_only_promoted_use,
       safe_dual_write_preview,
       safe_full_cutover_later,
       blocker_summary
FROM (
  SELECT pm.domain,
         pm.orphan_links AS blocker_count,
         pm.governance_link_gaps AS mismatch_count,
         ARRAY['orphan_project_links','imports_governance_link_gaps']::TEXT[] AS mismatch_categories,
         pm.sample_ids,
         TRUE AS safe_read_only_promoted_use,
         FALSE AS safe_dual_write_preview,
         FALSE AS safe_full_cutover_later,
         'PM promoted reads can be piloted; PM writes remain legacy-primary and governance linkage is still partially inferred.'::TEXT AS blocker_summary
  FROM pm
  UNION ALL
  SELECT pd.domain,
         pd.intake_task_orphans,
         pd.pd_ticket_project_gaps,
         ARRAY['intake_task_orphans','pd_ticket_project_link_gaps']::TEXT[],
         pd.sample_ids,
         TRUE,
         FALSE,
         FALSE,
         'PD SharePoint/sync ownership kept in project_development; legacy intake sync remains active until parity proof.'
  FROM pd
  UNION ALL
  SELECT doc.domain,
         doc.missing_project_lineage + doc.missing_work_item_lineage,
         doc.missing_versions,
         ARRAY['document_lineage_gaps','missing_document_versions']::TEXT[],
         doc.sample_ids,
         TRUE,
         FALSE,
         FALSE,
         'Documentation lifecycle is promoted and reconciled; deliverable requirement logic still compatibility-backed.'
  FROM doc
  UNION ALL
  SELECT fin.domain,
         fin.orphan_gaps,
         fin.duplicates + fin.dual_lineage_overlap,
         ARRAY['orphan_project_linkage','duplicate_or_overlap_finance_facts']::TEXT[],
         fin.sample_ids,
         TRUE,
         FALSE,
         FALSE,
         'Finance promoted reads are safe for reporting-only cohorts; write cutover remains blocked pending duplicate governance.'
  FROM fin
  UNION ALL
  SELECT imp.domain,
         imp.unresolved_conflicts,
         imp.acknowledgement_gaps,
         ARRAY['unresolved_import_conflicts','acknowledgement_gaps']::TEXT[],
         imp.sample_ids,
         TRUE,
         TRUE,
         FALSE,
         'Imports governance enforcement remains feature-flagged; no auto-resolution allowed.'
  FROM imp
  UNION ALL
  SELECT eng.domain,
         eng.task_stage_orphans,
         eng.unlinked_execution_tasks,
         ARRAY['engineering_task_stage_orphans','engineering_tasks_without_core_work_item_links']::TEXT[],
         eng.sample_ids,
         TRUE,
         TRUE,
         FALSE,
         'Engineering metadata is promoted; shared execution remains in core.work_items and legacy service path is retained.'
  FROM eng
  UNION ALL
  SELECT qual.domain,
         qual.item_checklist_orphans + qual.evidence_orphans,
         qual.warning_project_gaps,
         ARRAY['quality_lifecycle_orphans','quality_warning_project_gaps']::TEXT[],
         qual.sample_ids,
         TRUE,
         FALSE,
         FALSE,
         'Quality schema rollout is additive with compatibility-first APIs; broad endpoint cutover remains blocked pending parity.'
  FROM qual
) final;

COMMIT;
