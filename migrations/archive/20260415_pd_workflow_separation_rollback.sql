-- Rollback for 20260415_pd_workflow_separation.sql
--
-- Safe to run: drops only the columns and index added by the forward
-- migration. Data in those columns is lost on rollback, which is fine
-- because the columns were additive and no other code branches depend
-- on them outside the PD workflow separation change set.

BEGIN;

DROP INDEX IF EXISTS ix_pd_tickets_opportunity_id;

ALTER TABLE pd_tickets
  DROP COLUMN IF EXISTS opportunity_id;

ALTER TABLE opportunities
  DROP COLUMN IF EXISTS source;

COMMIT;
