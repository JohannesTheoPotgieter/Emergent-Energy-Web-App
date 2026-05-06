-- Backfill migration: parse <!--deps:[...]--&gt; HTML comments from
-- work_items.description and insert proper rows into work_item_dependencies.
-- Then strip the HTML comments from descriptions.
--
-- Safe to re-run: skips rows that already exist in work_item_dependencies
-- (deduplication via NOT EXISTS on predecessor_id + successor_id pair).
--
-- This migration uses a PL/pgSQL DO block because it requires JSON parsing
-- that raw SQL cannot do portably. It's additive and idempotent.

DO $$
DECLARE
  r RECORD;
  dep RECORD;
  dep_json jsonb;
  pred_id int;
  succ_id int;
  inserted int := 0;
  cleaned int := 0;
BEGIN
  FOR r IN
    SELECT id, description
    FROM work_items
    WHERE description LIKE '%<!--deps:%'
      AND description LIKE '%-->%'
  LOOP
    BEGIN
      -- Extract the JSON array from <!--deps:{json}-->
      dep_json := (regexp_match(r.description, '<!--deps:(.*?)-->'))[1]::jsonb;

      IF dep_json IS NOT NULL AND jsonb_typeof(dep_json) = 'array' THEN
        FOR dep IN SELECT * FROM jsonb_array_elements(dep_json)
        LOOP
          -- Each element: {"id": <number>, "type": "blocked_by"|"blocks", "title": "..."}
          IF dep.value->>'type' = 'blocked_by' THEN
            pred_id := (dep.value->>'id')::int;
            succ_id := r.id;
          ELSE
            pred_id := r.id;
            succ_id := (dep.value->>'id')::int;
          END IF;

          -- Skip self-references and already-existing rows
          IF pred_id != succ_id THEN
            INSERT INTO work_item_dependencies (predecessor_id, successor_id, dep_type, lag_days)
            SELECT pred_id, succ_id, 'FS', 0
            WHERE NOT EXISTS (
              SELECT 1 FROM work_item_dependencies wd
              WHERE wd.predecessor_id = pred_id
                AND wd.successor_id = succ_id
                AND wd.deleted_at IS NULL
            )
            AND EXISTS (SELECT 1 FROM work_items WHERE id = pred_id)
            AND EXISTS (SELECT 1 FROM work_items WHERE id = succ_id);

            IF FOUND THEN
              inserted := inserted + 1;
            END IF;
          END IF;
        END LOOP;
      END IF;

      -- Strip the HTML comment from the description
      UPDATE work_items
      SET description = regexp_replace(
        trim(regexp_replace(description, '<!--deps:.*?-->', '', 'g')),
        '\n+$', '', 'g'
      )
      WHERE id = r.id;
      cleaned := cleaned + 1;

    EXCEPTION WHEN OTHERS THEN
      -- Log but don't abort on individual row parse failures
      RAISE NOTICE 'Failed to parse deps for work_item %: %', r.id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'Backfill complete: % dependency rows inserted, % descriptions cleaned', inserted, cleaned;
END $$;
