-- Migration: Align role_permissions.sections with the current 10-section navigation model
-- Old keys: COCKPIT, EXCO, MY_TOOL, MY_WORK, PROJECTS, OPERATIONS, PROJECT_MANAGEMENT,
--           GOVERNANCE, COLLABORATION, MONEY, INFORMATION, FEEDBACK
-- New keys: HOME, PORTFOLIO, PROJECT_DEVELOPMENT, PROJECT_DELIVERY, HSE, ENGINEERING,
--           QUALITY, FINANCE, REPORTS, ADMIN

UPDATE role_permissions
SET sections = (
  SELECT array_agg(DISTINCT new_key ORDER BY new_key)
  FROM unnest(sections) AS old_key
  CROSS JOIN LATERAL (
    SELECT unnest(CASE old_key
      WHEN 'COCKPIT'             THEN ARRAY['HOME']
      WHEN 'EXCO'                THEN ARRAY['HOME']
      WHEN 'MY_TOOL'             THEN ARRAY['HOME']
      WHEN 'MY_WORK'             THEN ARRAY['HOME']
      WHEN 'OPERATIONS'          THEN ARRAY['PROJECT_DELIVERY']
      WHEN 'PROJECTS'            THEN ARRAY['PROJECT_DELIVERY']
      WHEN 'PROJECT_MANAGEMENT'  THEN ARRAY['PROJECT_DELIVERY']
      WHEN 'GOVERNANCE'          THEN ARRAY['PROJECT_DELIVERY']
      WHEN 'COLLABORATION'       THEN ARRAY['PROJECT_DELIVERY']
      WHEN 'MONEY'               THEN ARRAY['FINANCE']
      WHEN 'INFORMATION'         THEN ARRAY['REPORTS']
      WHEN 'FEEDBACK'            THEN ARRAY['REPORTS']
      -- Keys that are already in the new 10-section format pass through
      WHEN 'HOME'                THEN ARRAY['HOME']
      WHEN 'PORTFOLIO'           THEN ARRAY['PORTFOLIO']
      WHEN 'PROJECT_DEVELOPMENT' THEN ARRAY['PROJECT_DEVELOPMENT']
      WHEN 'PROJECT_DELIVERY'    THEN ARRAY['PROJECT_DELIVERY']
      WHEN 'HSE'                 THEN ARRAY['HSE']
      WHEN 'ENGINEERING'         THEN ARRAY['ENGINEERING']
      WHEN 'QUALITY'             THEN ARRAY['QUALITY']
      WHEN 'FINANCE'             THEN ARRAY['FINANCE']
      WHEN 'REPORTS'             THEN ARRAY['REPORTS']
      WHEN 'ADMIN'               THEN ARRAY['ADMIN']
      ELSE ARRAY[old_key]
    END) AS new_key
  ) expanded
)
WHERE sections IS NOT NULL;
