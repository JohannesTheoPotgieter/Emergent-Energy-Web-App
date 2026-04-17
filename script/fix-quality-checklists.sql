-- Fix Quality Dashboard checklists:
--   1. Delete the invalid "PROJECT SIZE (kWp)" checklist (NULL project_id)
--   2. Backfill missing qc_item_instance rows for every existing checklist
--   3. Backfill missing qc_risk_answer rows for every existing checklist
--
-- Safe to run multiple times — only inserts what's missing.

BEGIN;

-- 1. Delete the invalid "PROJECT SIZE (kWp)" checklist (it has no real project link).
DELETE FROM qc_item_evidence
WHERE item_instance_id IN (
  SELECT i.id FROM qc_item_instance i
  JOIN qc_checklist c ON c.id = i.checklist_id
  WHERE c.project_id IS NULL AND c.project_name = 'PROJECT SIZE (kWp)'
);
DELETE FROM qc_risk_answer
WHERE checklist_id IN (
  SELECT id FROM qc_checklist WHERE project_id IS NULL AND project_name = 'PROJECT SIZE (kWp)'
);
DELETE FROM qc_item_instance
WHERE checklist_id IN (
  SELECT id FROM qc_checklist WHERE project_id IS NULL AND project_name = 'PROJECT SIZE (kWp)'
);
DELETE FROM qc_checklist
WHERE project_id IS NULL AND project_name = 'PROJECT SIZE (kWp)';

-- 2. Backfill qc_item_instance: insert one row per template item that the
--    checklist's template defines, but which doesn't yet exist for that checklist.
INSERT INTO qc_item_instance (checklist_id, template_item_id)
SELECT c.id, ti.id
FROM qc_checklist c
JOIN qc_template_phase tp ON tp.template_id = c.template_id
JOIN qc_template_group  tg ON tg.template_phase_id = tp.id
JOIN qc_template_item   ti ON ti.template_group_id = tg.id
WHERE NOT EXISTS (
  SELECT 1 FROM qc_item_instance i
  WHERE i.checklist_id = c.id AND i.template_item_id = ti.id
);

-- 3. Backfill qc_risk_answer the same way.
INSERT INTO qc_risk_answer (checklist_id, template_risk_question_id)
SELECT c.id, rq.id
FROM qc_checklist c
JOIN qc_template_phase tp ON tp.template_id = c.template_id
JOIN qc_template_risk_question rq ON rq.template_phase_id = tp.id
WHERE NOT EXISTS (
  SELECT 1 FROM qc_risk_answer a
  WHERE a.checklist_id = c.id AND a.template_risk_question_id = rq.id
);

-- Show the result
SELECT c.id, c.project_name, COUNT(i.id) AS items
FROM qc_checklist c
LEFT JOIN qc_item_instance i ON i.checklist_id = c.id
GROUP BY c.id, c.project_name
ORDER BY c.id;

COMMIT;
