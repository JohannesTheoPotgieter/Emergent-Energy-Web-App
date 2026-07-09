-- Deploy-safe dedupe: drop any pre-existing duplicate project-document links
-- (keeping the earliest row per work_item + project_document_link) so the new
-- unique index can be created cleanly on data that predates the Done-gate fix.
DELETE FROM "work_item_document_links"
WHERE "project_document_link_id" IS NOT NULL
  AND "id" NOT IN (
    SELECT MIN("id") FROM "work_item_document_links"
    WHERE "project_document_link_id" IS NOT NULL
    GROUP BY "work_item_id", "project_document_link_id"
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_work_item_project_doc_link" ON "work_item_document_links" USING btree ("work_item_id","project_document_link_id") WHERE "work_item_document_links"."project_document_link_id" IS NOT NULL;
