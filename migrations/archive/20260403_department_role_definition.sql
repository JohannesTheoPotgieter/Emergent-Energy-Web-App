-- Phase A.1: Create core.departments and core.role_definitions
-- Additive only — no existing tables are altered.
-- Idempotent — safe to re-run.

CREATE SCHEMA IF NOT EXISTS core;

-- 1. Departments
CREATE TABLE IF NOT EXISTS core.departments (
  id    SERIAL PRIMARY KEY,
  code  TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO core.departments (code, name) VALUES
  ('ADMIN',              'Admin'),
  ('LEADERSHIP',         'Leadership'),
  ('ENGINEERING',        'Engineering'),
  ('PROJECT_DEVELOPMENT','Project Development'),
  ('PROJECT_MANAGEMENT', 'Project Management'),
  ('FINANCE',            'Finance')
ON CONFLICT (code) DO NOTHING;

-- 2. Role definitions
CREATE TABLE IF NOT EXISTS core.role_definitions (
  id            SERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  department_id INTEGER NOT NULL REFERENCES core.departments(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO core.role_definitions (code, name, department_id) VALUES
  ('COO_ADMIN',              'COO',                     (SELECT id FROM core.departments WHERE code = 'ADMIN')),
  ('CEO_ADMIN',              'CEO',                     (SELECT id FROM core.departments WHERE code = 'ADMIN')),
  ('CCO',                    'CCO',                     (SELECT id FROM core.departments WHERE code = 'LEADERSHIP')),
  ('PROGRAM_MANAGER',        'Program Manager',         (SELECT id FROM core.departments WHERE code = 'LEADERSHIP')),
  ('ENGINEER',               'Engineer',                (SELECT id FROM core.departments WHERE code = 'ENGINEERING')),
  ('ENGINEERING_MANAGER',    'Engineering Manager',     (SELECT id FROM core.departments WHERE code = 'ENGINEERING')),
  ('QUALITY_MANAGER',        'Quality Manager',         (SELECT id FROM core.departments WHERE code = 'ENGINEERING')),
  ('SSEG_MANAGER',           'SSEG Manager',            (SELECT id FROM core.departments WHERE code = 'ENGINEERING')),
  ('PROJECT_DEVELOPER',      'Project Developer',       (SELECT id FROM core.departments WHERE code = 'PROJECT_DEVELOPMENT')),
  ('KEY_ACCOUNTS_MANAGER',   'Key Accounts Manager',    (SELECT id FROM core.departments WHERE code = 'PROJECT_DEVELOPMENT')),
  ('CONSTRUCTION_MANAGER',   'Construction Manager',    (SELECT id FROM core.departments WHERE code = 'PROJECT_MANAGEMENT')),
  ('PROJECT_MANAGER_SITE',   'Project Manager',         (SELECT id FROM core.departments WHERE code = 'PROJECT_MANAGEMENT')),
  ('HSE_MANAGER',            'HSE Manager',             (SELECT id FROM core.departments WHERE code = 'PROJECT_MANAGEMENT')),
  ('CFO',                    'CFO',                     (SELECT id FROM core.departments WHERE code = 'FINANCE')),
  ('PROGRAM_FINANCE_MANAGER','Program Finance Manager', (SELECT id FROM core.departments WHERE code = 'FINANCE')),
  ('ACCOUNTANT',             'Accountant',              (SELECT id FROM core.departments WHERE code = 'FINANCE'))
ON CONFLICT (code) DO NOTHING;
