-- Migration: 20260403_a03_create_departments_role_definitions.sql
-- Phase A.1: Create core.departments and core.role_definitions reference tables.
-- Additive only. No app code changes. Seeds from hardcoded constants in shared/schema/users.ts.
BEGIN;

-- -------------------------------------------------------
-- 1. core.departments — 6 department clusters
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.departments (
  id     SERIAL PRIMARY KEY,
  code   TEXT NOT NULL UNIQUE,
  name   TEXT NOT NULL
);

COMMENT ON TABLE core.departments IS
  'Phase A.1: department reference table seeded from DepartmentCluster type in shared/schema/users.ts.';

INSERT INTO core.departments (code, name) VALUES
  ('ADMIN',              'Exco'),
  ('LEADERSHIP',         'Management'),
  ('ENGINEERING',        'Engineering'),
  ('PROJECT_DEVELOPMENT','Project Development'),
  ('PROJECT_MANAGEMENT', 'Project Management'),
  ('FINANCE',            'Finance')
ON CONFLICT (code) DO NOTHING;

-- -------------------------------------------------------
-- 2. core.role_definitions — 16 system roles
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS core.role_definitions (
  id            SERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT,
  department_id INTEGER NOT NULL REFERENCES core.departments(id)
);

CREATE INDEX IF NOT EXISTS idx_role_definitions_department_id
  ON core.role_definitions (department_id);

COMMENT ON TABLE core.role_definitions IS
  'Phase A.1: role definition reference table seeded from COMPANY_ROLES and DEFAULT_ROLE_PERMISSIONS in shared/schema/users.ts.';

INSERT INTO core.role_definitions (code, name, description, department_id)
SELECT v.code, v.name, v.description, d.id
FROM (VALUES
  ('COO_ADMIN',              'COO',                      'Full executive access, settings, user management',                          'ADMIN'),
  ('CEO_ADMIN',              'CEO',                      'Full executive access, strategic oversight',                                'ADMIN'),
  ('CCO',                    'CCO',                      'Head of Project Development — commercial, pipeline, client relations',      'LEADERSHIP'),
  ('PROGRAM_MANAGER',        'Program Manager',          'Cross-project delivery — portfolio, gates, escalations',                    'LEADERSHIP'),
  ('ENGINEER',               'Engineer',                 'Engineering team — tasks, deliverables, reviews, stage checklists',          'ENGINEERING'),
  ('ENGINEERING_MANAGER',    'Engineering Manager',      'Engineering lead — design, approvals, deliverables',                        'ENGINEERING'),
  ('QUALITY_MANAGER',        'Quality Manager',          'Quality workspace — NCRs, inspections, checklists, corrective actions',     'ENGINEERING'),
  ('SSEG_MANAGER',           'SSEG Manager',             'SSEG applications — authority tracking, queries, compliance',               'ENGINEERING'),
  ('PROJECT_DEVELOPER',      'Project Developer',        'Project development — pipeline, cost proposals, client relations',          'PROJECT_DEVELOPMENT'),
  ('KEY_ACCOUNTS_MANAGER',   'Key Accounts Manager',     'Client relations, account management, pipeline',                           'PROJECT_DEVELOPMENT'),
  ('CONSTRUCTION_MANAGER',   'Construction Manager',     'Construction delivery — sites, milestones, inflow planning, procurement',   'PROJECT_MANAGEMENT'),
  ('PROJECT_MANAGER_SITE',   'Project Manager',          'Project delivery — assigned projects, tasks, approvals, milestones',        'PROJECT_MANAGEMENT'),
  ('HSE_MANAGER',            'HSE Manager',              'HSE compliance — incidents, audits, corrective actions, safety files',       'PROJECT_MANAGEMENT'),
  ('CFO',                    'CFO',                      'Financial oversight — cashflow, budgets, margin, billing',                  'FINANCE'),
  ('PROGRAM_FINANCE_MANAGER','Program Finance Manager',  'Program finance — invoicing, forecasting, collections',                     'FINANCE'),
  ('ACCOUNTANT',             'Accountant',               'Finance team — cashflow, COS tracking, invoice management',                'FINANCE')
) AS v(code, name, description, dept_code)
JOIN core.departments d ON d.code = v.dept_code
ON CONFLICT (code) DO NOTHING;

COMMIT;
