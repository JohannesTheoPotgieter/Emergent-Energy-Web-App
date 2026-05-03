-- 0021: Reject work_items linkage to soft-deleted pd_tickets at the DB layer.
-- Additive, idempotent. Hand-authored. Task #34.
--
-- The 0019 FK prevents work_items.pd_ticket_id from referencing a non-existent
-- pd_tickets row, but cannot, by itself, prevent referencing a row that is
-- present-but-soft-deleted (deleted_at IS NOT NULL). This trigger closes that
-- gap on every INSERT/UPDATE.

CREATE OR REPLACE FUNCTION work_items_reject_softdeleted_pd_ticket()
RETURNS TRIGGER AS $$
DECLARE
  v_deleted_at timestamp;
BEGIN
  IF NEW.pd_ticket_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT deleted_at INTO v_deleted_at
    FROM pd_tickets
   WHERE id = NEW.pd_ticket_id;
  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'work_items.pd_ticket_id % refers to a soft-deleted pd_ticket', NEW.pd_ticket_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS work_items_reject_softdeleted_pd_ticket_trg ON work_items;
CREATE TRIGGER work_items_reject_softdeleted_pd_ticket_trg
  BEFORE INSERT OR UPDATE OF pd_ticket_id ON work_items
  FOR EACH ROW
  EXECUTE FUNCTION work_items_reject_softdeleted_pd_ticket();
