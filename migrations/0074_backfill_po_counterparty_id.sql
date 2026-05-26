-- Wave-4 audit (2026-05-26) — Backfill purchase_orders.counterparty_id.
--
-- Wave 1 added purchase_orders.counterparty_id as a nullable FK (PR #944,
-- migration 0069). New POs that pass counterpartyId on /api/po/generate
-- populate it; historical POs created before that change have NULL.
--
-- This migration matches legacy POs to canonical counterparties by
-- normalised supplier_name (lower-cased, trimmed, whitespace-collapsed)
-- against counterparties.name_canonical. Ambiguous cases (two
-- counterparties whose canonical names normalise to the same value)
-- are skipped — the row stays NULL and the audit log surfaces it later.
--
-- Per § 6 the operation is additive: NULL → matched ID, no overwrites.
-- The whole UPDATE is wrapped in a DO block so a partial environment
-- (e.g. dev) without populated counterparties doesn't error.

DO $$
DECLARE
  matched_count INTEGER := 0;
BEGIN
  WITH normalised AS (
    SELECT
      po.id AS po_id,
      LOWER(REGEXP_REPLACE(TRIM(po.supplier_name), '\s+', ' ', 'g')) AS po_norm
    FROM purchase_orders po
    WHERE po.counterparty_id IS NULL
      AND po.supplier_name IS NOT NULL
      AND TRIM(po.supplier_name) <> ''
  ),
  candidates AS (
    SELECT
      n.po_id,
      c.id AS counterparty_id,
      COUNT(*) OVER (PARTITION BY n.po_id) AS match_count
    FROM normalised n
    JOIN counterparties c
      ON LOWER(REGEXP_REPLACE(TRIM(c.name_canonical), '\s+', ' ', 'g')) = n.po_norm
    WHERE c.deleted_at IS NULL
  ),
  unique_matches AS (
    SELECT po_id, counterparty_id
    FROM candidates
    WHERE match_count = 1
  )
  UPDATE purchase_orders po
  SET counterparty_id = um.counterparty_id,
      updated_at = NOW()
  FROM unique_matches um
  WHERE po.id = um.po_id
    AND po.counterparty_id IS NULL;

  GET DIAGNOSTICS matched_count = ROW_COUNT;
  RAISE NOTICE '[backfill_po_counterparty_id] matched % purchase order(s) to a unique counterparty', matched_count;
END $$;
