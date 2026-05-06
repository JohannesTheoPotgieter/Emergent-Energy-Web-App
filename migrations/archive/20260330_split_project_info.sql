-- ============================================================
-- Migration: Split project_info god object
-- Date: 2026-03-30
-- Purpose: Extract execution-state columns into a dedicated
--          project_execution_state table. project_settings is
--          skipped (only 1 candidate column: excel_tracker_link).
--          Original columns in project_info are NOT dropped yet.
-- ============================================================

-- 1. Create project_execution_state table
CREATE TABLE IF NOT EXISTS project_execution_state (
  id SERIAL PRIMARY KEY,
  project_id INTEGER UNIQUE NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,

  -- Phase lifecycle
  phase TEXT,
  phase_updated_at TIMESTAMPTZ,
  phase_updated_by_user_id INTEGER REFERENCES users(id),
  phase_notes TEXT,

  -- Key dates (planned)
  pd_handover_date TEXT,
  construction_start_date TEXT,
  commissioning_date TEXT,
  om_handover_date TEXT,
  client_handover_date TEXT,

  -- Key dates (actual)
  construction_start_actual TEXT,
  pd_handover_actual TEXT,
  commissioning_actual TEXT,
  client_handover_actual TEXT,

  -- Escalation
  escalation_level TEXT,

  -- RAG status
  rag_status TEXT,
  rag_comment TEXT,
  rag_updated_at TIMESTAMPTZ,
  rag_updated_by_user_id INTEGER,

  -- Active / archived
  is_active BOOLEAN NOT NULL DEFAULT true,
  archived_status TEXT NOT NULL DEFAULT 'ACTIVE',

  -- Execution gate
  execution_enabled BOOLEAN NOT NULL DEFAULT false,
  execution_gate_status TEXT NOT NULL DEFAULT 'NOT_ELIGIBLE',
  execution_gate_reason TEXT,
  execution_phase TEXT,

  -- Signing
  signed_status TEXT NOT NULL DEFAULT 'NONE',
  signed_date TEXT,
  signed_document_link TEXT,

  -- CP signed gate
  cp_signed BOOLEAN NOT NULL DEFAULT false,
  cp_signed_date TEXT,
  cp_signed_by_user_id INTEGER REFERENCES users(id),
  cp_evidence_type TEXT,
  cp_evidence_ref TEXT,

  -- Task pack flags
  pm_task_pack_created BOOLEAN NOT NULL DEFAULT false,
  eng_post_cp_task_pack_created BOOLEAN NOT NULL DEFAULT false,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create project_settings table
CREATE TABLE IF NOT EXISTS project_settings (
  id SERIAL PRIMARY KEY,
  project_id INTEGER UNIQUE NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,

  -- Excel / SharePoint links
  excel_tracker_link TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create indexes for FK lookups
CREATE INDEX IF NOT EXISTS idx_project_execution_state_project_id
  ON project_execution_state(project_id);

CREATE INDEX IF NOT EXISTS idx_project_settings_project_id
  ON project_settings(project_id);
