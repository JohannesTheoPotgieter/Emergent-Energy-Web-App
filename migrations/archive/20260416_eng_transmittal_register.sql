-- Engineering transmittal register — formal issue event log.
-- Each row records "document X was issued to person Y for purpose Z".
-- Additive, idempotent (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS eng_transmittals (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
  transmittal_number text NOT NULL,
  title text NOT NULL,
  purpose text NOT NULL,
  recipient_name text NOT NULL,
  recipient_org text,
  recipient_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  issued_by_user_id integer NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  issued_at timestamp NOT NULL DEFAULT now(),
  notes text,
  project_eng_stage_id integer REFERENCES project_eng_stages(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eng_transmittals_project ON eng_transmittals (project_id);
CREATE INDEX IF NOT EXISTS idx_eng_transmittals_number ON eng_transmittals (transmittal_number);

CREATE TABLE IF NOT EXISTS eng_transmittal_items (
  id serial PRIMARY KEY,
  transmittal_id integer NOT NULL REFERENCES eng_transmittals(id) ON DELETE CASCADE,
  deliverable_id integer REFERENCES project_eng_deliverables(id) ON DELETE SET NULL,
  drawing_id integer REFERENCES drawing_register(id) ON DELETE SET NULL,
  revision text,
  released_for_at_issue text,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_eng_transmittal_items_transmittal ON eng_transmittal_items (transmittal_id);
