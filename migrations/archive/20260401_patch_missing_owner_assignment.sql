-- Phase 5A: Patch missing OWNER assignment for personal task work_item 91184
-- This row was identified by the parity check (Query 7) as having an owner_user_id
-- but no corresponding work_item_assignments OWNER row.
INSERT INTO work_item_assignments (work_item_id, user_id, role)
VALUES (91184, 25, 'OWNER')
ON CONFLICT DO NOTHING;
