DO $$ BEGIN
  CREATE TYPE mytool_task_type AS ENUM ('task', 'milestone');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE mytool_dependency_type AS ENUM ('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE mytool_tasks
  ADD COLUMN IF NOT EXISTS task_type mytool_task_type NOT NULL DEFAULT 'task',
  ADD COLUMN IF NOT EXISTS milestone_id integer REFERENCES mytool_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS blocked_by_dependencies boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurrence_template_id integer,
  ADD COLUMN IF NOT EXISTS auto_generated boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS mytool_task_dependencies (
  id serial PRIMARY KEY,
  predecessor_task_id integer NOT NULL REFERENCES mytool_tasks(id) ON DELETE CASCADE,
  successor_task_id integer NOT NULL REFERENCES mytool_tasks(id) ON DELETE CASCADE,
  dependency_type mytool_dependency_type NOT NULL DEFAULT 'finish_to_start',
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT mytool_task_dependencies_unique_link UNIQUE (predecessor_task_id, successor_task_id),
  CONSTRAINT mytool_task_dependencies_no_self CHECK (predecessor_task_id <> successor_task_id)
);

CREATE TABLE IF NOT EXISTS mytool_recurrence_templates (
  id serial PRIMARY KEY,
  owner_user_id integer NOT NULL REFERENCES users(id),
  title text NOT NULL,
  description text,
  project_name text,
  default_assignee_role text,
  checklist_items jsonb,
  frequency mytool_recurrence_frequency NOT NULL,
  interval integer NOT NULL DEFAULT 1,
  days_of_week text,
  start_date text NOT NULL,
  end_date text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mytool_recurrence_instances (
  id serial PRIMARY KEY,
  template_id integer NOT NULL REFERENCES mytool_recurrence_templates(id) ON DELETE CASCADE,
  task_id integer NOT NULL REFERENCES mytool_tasks(id) ON DELETE CASCADE,
  instance_date text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT mytool_recurrence_instances_unique_template_date UNIQUE (template_id, instance_date)
);

CREATE INDEX IF NOT EXISTS idx_mytool_tasks_milestone_id ON mytool_tasks (milestone_id);
CREATE INDEX IF NOT EXISTS idx_mytool_tasks_recurrence_parent_date ON mytool_tasks (owner_user_id, recurrence_parent_id, planned_for_date);
CREATE INDEX IF NOT EXISTS idx_mytool_task_dependencies_successor ON mytool_task_dependencies (successor_task_id);
