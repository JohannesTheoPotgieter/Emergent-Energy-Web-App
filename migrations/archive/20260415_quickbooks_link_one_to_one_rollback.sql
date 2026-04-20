-- Rollback: 20260415_quickbooks_link_one_to_one.sql
--
-- Drops the two partial unique indexes that enforce 1:1 QB ↔ app links.
-- Does NOT revive the rows that were soft-deleted during the forward
-- migration — those are kept as deleted_at-stamped rows so their audit
-- trail (notes column with the supersede tag) remains intact.

BEGIN;

DROP INDEX IF EXISTS uq_qb_links_app_entity_active;
DROP INDEX IF EXISTS uq_qb_links_qb_entity_active;

COMMIT;
