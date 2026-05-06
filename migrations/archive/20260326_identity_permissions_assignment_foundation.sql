ALTER TABLE IF EXISTS public.counterparties
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE IF EXISTS public.counterparties
  ADD COLUMN IF NOT EXISTS role_tags TEXT[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE IF EXISTS public.counterparties
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.counterparty_contacts (
  id SERIAL PRIMARY KEY,
  counterparty_id INTEGER NOT NULL REFERENCES public.counterparties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  title TEXT,
  role_tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_by_user_id INTEGER REFERENCES public.users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS counterparty_contacts_counterparty_idx
  ON public.counterparty_contacts(counterparty_id);

CREATE INDEX IF NOT EXISTS counterparty_contacts_active_idx
  ON public.counterparty_contacts(counterparty_id, is_active);

CREATE TABLE IF NOT EXISTS public.entity_assignments (
  id SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  project_id INTEGER REFERENCES public.project_info(id),
  assignment_role TEXT NOT NULL DEFAULT 'ASSIGNEE',
  assignee_type TEXT NOT NULL,
  assignee_id INTEGER NOT NULL,
  display_label_snapshot TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_by_user_id INTEGER REFERENCES public.users(id),
  cleared_by_user_id INTEGER REFERENCES public.users(id),
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  cleared_at TIMESTAMP,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS entity_assignments_entity_idx
  ON public.entity_assignments(entity_type, entity_id, active);

CREATE INDEX IF NOT EXISTS entity_assignments_project_idx
  ON public.entity_assignments(project_id, active);

CREATE UNIQUE INDEX IF NOT EXISTS entity_assignments_active_unique
  ON public.entity_assignments(entity_type, entity_id, assignment_role, assignee_type, assignee_id)
  WHERE active = TRUE;
