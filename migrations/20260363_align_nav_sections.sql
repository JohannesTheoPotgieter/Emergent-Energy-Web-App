-- Migration: Align role_permissions.sections with the current 6-section navigation model
-- Old keys: COCKPIT, PROJECTS, PROJECT_DEVELOPMENT, PROJECT_MANAGEMENT, ENGINEERING,
--           GOVERNANCE, MONEY, INFORMATION, COLLABORATION, ADMIN
-- New keys: HOME, MY_WORK, PROJECTS, FINANCE, REPORTS, ADMIN

UPDATE role_permissions
SET sections = (
  SELECT array_agg(DISTINCT new_key ORDER BY new_key)
  FROM unnest(sections) AS old_key
  CROSS JOIN LATERAL (
    SELECT unnest(CASE old_key
      WHEN 'COCKPIT'             THEN ARRAY['HOME','MY_WORK']
      WHEN 'PROJECTS'            THEN ARRAY['PROJECTS']
      WHEN 'PROJECT_DEVELOPMENT' THEN ARRAY['PROJECTS']
      WHEN 'PROJECT_MANAGEMENT'  THEN ARRAY['PROJECTS']
      WHEN 'ENGINEERING'         THEN ARRAY['PROJECTS']
      WHEN 'GOVERNANCE'          THEN ARRAY['PROJECTS']
      WHEN 'COLLABORATION'       THEN ARRAY['PROJECTS']
      WHEN 'MONEY'               THEN ARRAY['FINANCE']
      WHEN 'INFORMATION'         THEN ARRAY['REPORTS']
      -- Keys that are already in the new format pass through
      WHEN 'HOME'                THEN ARRAY['HOME']
      WHEN 'MY_WORK'             THEN ARRAY['MY_WORK']
      WHEN 'FINANCE'             THEN ARRAY['FINANCE']
      WHEN 'REPORTS'             THEN ARRAY['REPORTS']
      WHEN 'ADMIN'               THEN ARRAY['ADMIN']
      -- Legacy keys that predate the 10-section model
      WHEN 'EXCO'                THEN ARRAY['HOME','MY_WORK']
      WHEN 'MY_TOOL'             THEN ARRAY['HOME','MY_WORK']
      WHEN 'OPERATIONS'          THEN ARRAY['PROJECTS']
      WHEN 'QUALITY'             THEN ARRAY['PROJECTS']
      WHEN 'FEEDBACK'            THEN ARRAY['REPORTS']
      ELSE ARRAY[old_key]
    END) AS new_key
  ) expanded
)
WHERE sections IS NOT NULL;
