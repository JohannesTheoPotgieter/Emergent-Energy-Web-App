-- Migration: Normalize legacy Smart Import external_ref suffixes on work_items.
--
-- Smart Import v2 used to disambiguate duplicate-business-key plan rows by
-- appending `#idx<N>` to `work_items.external_ref`, where `<N>` was the row's
-- position in the uploaded file at commit time. File row positions shifted
-- between commits, so on subsequent imports the matcher would reassign the
-- same `#idxN` slot to a different row and the UPDATE that normalized the
-- external_ref would collide with a surviving legacy row holding the same
-- suffix (PostgreSQL 23505 on the `work_items_external_ref_*` unique index).
--
-- The long-term fix (see server/lib/import/row-matcher.ts) switches identity
-- to `#pk<id>` — the row's own primary key — which is stable for the row's
-- lifetime and can never collide with another row. This migration rewrites
-- every active work_items row whose external_ref uses the legacy `#idxN`
-- suffix to the new `#pk<id>` form, leaving the pre-suffix base untouched.
--
-- Safe to run repeatedly. Only touches active (deleted_at IS NULL) rows so
-- historical audit trails are preserved as-is.
--
-- Date: 2026-04-14

BEGIN;

-- Match legacy `#idx<N>` or `#dup<N>` suffixes, optionally followed by a
-- chain of `#<N>` fallbacks produced by the old uniquifyRef tiebreaker.
UPDATE work_items
SET
  external_ref = regexp_replace(
    external_ref,
    '#(?:idx|dup)[0-9]+(?:#[0-9]+)*$',
    '#pk' || id::text
  ),
  updated_at = NOW()
WHERE deleted_at IS NULL
  AND external_ref ~ '#(?:idx|dup)[0-9]+(?:#[0-9]+)*$';

COMMIT;
