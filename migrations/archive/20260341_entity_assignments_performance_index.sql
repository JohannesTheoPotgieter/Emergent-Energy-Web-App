-- Performance index for entity_assignments: used by getAssignmentsForEntities batch queries
-- Covers the most common query pattern: WHERE entity_type = ? AND entity_id IN (...) AND active = true
CREATE INDEX IF NOT EXISTS idx_entity_assignments_type_id_active
  ON entity_assignments(entity_type, entity_id, active);
