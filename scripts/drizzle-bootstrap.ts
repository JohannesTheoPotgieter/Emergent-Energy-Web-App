/**
 * Drizzle bootstrap — seeds (and repairs) `drizzle.__drizzle_migrations`
 * so that `drizzle-kit migrate` is safe to run against an existing
 * schema that was historically managed by `drizzle-kit push`.
 *
 * Background. This project used `drizzle-kit push` + startup schema
 * repair to keep prod aligned with `shared/schema/*.ts`. The deploy
 * build was changed to `npm run build && npm run db:migrate`. The
 * migrator records applied entries in `drizzle.__drizzle_migrations`,
 * but on a push-managed DB that table is empty, so the migrator would
 * try to apply ALL historical migrations (including the non-idempotent
 * baseline `0000_baseline_*.sql` whose own header explicitly says
 * "DO NOT re-apply this baseline to prod") and crash.
 *
 * What this script does — schema-aware backfill.
 *  1. Connects with DATABASE_URL.
 *  2. Detects whether the DB already has the application schema by
 *     probing for core tables (project_info, users). If neither
 *     exists this is a fresh DB and we bail out — `drizzle-kit
 *     migrate` will run the baseline normally.
 *  3. Ensures `drizzle.__drizzle_migrations` exists.
 *  4. Walks every journal entry. For each entry whose tag has a
 *     "canary probe" defined in MODERN_MIGRATION_PROBES, the entry is
 *     marked applied ONLY when the probe confirms the DDL artifact
 *     (table / column) actually exists. Entries without a probe are
 *     "presumed applied" — they belong to the baseline rebuild and
 *     prod has been running them via push for months.
 *  5. Repair pass. If a row for a probed tag already exists in
 *     `__drizzle_migrations` but the canary is missing, the row is
 *     DELETED so `drizzle-kit migrate` will re-apply it. This recovers
 *     from the previous (over-eager) bootstrap that backfilled every
 *     tag unconditionally and caused 0050+ migrations to be skipped.
 *
 * To register a new modern migration, add an entry to
 * MODERN_MIGRATION_PROBES with the tag and a probe function. Probes
 * MUST be cheap, idempotent, and SELECT-only.
 *
 * Run via `tsx scripts/drizzle-bootstrap.ts`. The deploy build chains
 * it before `drizzle-kit migrate` (see package.json `db:migrate`).
 *
 * Idempotent: safe to run repeatedly.
 */

import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta", "_journal.json");

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

/**
 * Probes for migrations added AFTER the journal rebuild. Each probe
 * returns true iff the migration's signature DDL artifact already
 * exists in the live DB.
 *
 * Tags NOT listed here are treated as "presumed applied" (baseline +
 * pre-rebuild history). Add an entry whenever a new migration ships.
 *
 * Always-applied migrations (pure `DROP IF EXISTS` etc. that are safe
 * to run repeatedly and have no schema artifact to probe) can use
 * `() => Promise.resolve(true)` so they get backfilled normally.
 */
const MODERN_MIGRATION_PROBES: Record<
  string,
  (client: Client) => Promise<boolean>
> = {
  "0050_qb_invoice_links_allocations": (c) =>
    columnExists(c, "quickbooks_invoice_links", "allocated_amount_ex_vat"),
  // Pure DROP VIEW IF EXISTS — always safe to (re-)run, but also safe
  // to mark applied unconditionally so the migrator never bothers.
  "0051_drop_legacy_claude_view_on_app_db": () => Promise.resolve(true),
  "0051_qb_link_proposed_cascades": (c) =>
    tableExists(c, "qb_link_proposed_cascades"),
  "0052_invoice_description_patterns": (c) =>
    tableExists(c, "invoice_description_patterns"),
  "0053_qb_match_suggestions_auto_generated": (c) =>
    columnExists(c, "quickbooks_match_suggestions", "auto_generated"),
  "0054_role_upgrade_tables": (c) => tableExists(c, "role_lens_profiles"),
  "0055_qb_documents_payment_status": (c) =>
    columnExists(c, "quickbooks_documents", "qb_balance"),
  "0068_project_document_links": (c) =>
    tableExists(c, "project_document_links"),
  // 0079 backfills the three migration sets that previously had no probe
  // (0067_sp_settings_error_columns, 0069_priorities_phase3,
  // 0076_finance_dispute_writeoff_columns). All three artifact families
  // must be present for the migration to count as applied — any one
  // missing means a drifted dev DB that needs the repair.
  "0079_dev_drift_repair": async (c) => {
    if (!(await columnExists(c, "sp_settings", "last_success_at"))) return false;
    if (!(await tableExists(c, "priority_saved_views"))) return false;
    return columnExists(c, "normalized_revenue_lines", "dispute_opened_at");
  },
  // 0080 adds a composite unique constraint on deliverable_versions
  // (deliverable_id, version_number). Probe the constraint directly — the
  // table already exists, so a column/table probe would false-positive and
  // skip the migration.
  "0080_deliverable_versions_unique": (c) =>
    constraintExists(c, "deliverable_versions_deliverable_version_unique"),
  // 0081 adds invoice_date_font_color + invoice_date_confirmed to actuals.
  "0081_actuals_invoice_colour": (c) =>
    columnExists(c, "normalized_cost_line_actuals", "invoice_date_font_color"),
  // 0082 adds the provenance source column to work_item_dependencies so
  // Smart Import can distinguish importer-owned vs hand-made edges.
  "0082_dep_source": (c) =>
    columnExists(c, "work_item_dependencies", "source"),
  // 0083 adds project_info_id to tracker_monthly_manual so per-project
  // Revenue / COS tracker rows are scoped separately from program-wide rows.
  "0083_tracker_monthly_per_project": (c) =>
    columnExists(c, "tracker_monthly_manual", "project_info_id"),
  // 0084 restores the finance tracker support tables (category revenue
  // allocations + manual tracker rows). Multi-artifact canary so a partial
  // apply (table present but the cost-line FK column missing) still replays.
  "0084_restore_finance_tracker_support_tables": async (c) =>
    (await tableExists(c, "category_revenue_allocations")) &&
    (await columnExists(c, "normalized_cost_lines", "category_allocation_id")) &&
    (await tableExists(c, "tracker_monthly_manual")),
  // 0085 creates the FYE revised-budget monthly table that the FYE
  // revenue-tracking tab reads from. Require table + FK + unique index so a
  // partial apply replays rather than being presumed complete.
  "0085_fye_revised_budget_monthly": async (c) =>
    (await tableExists(c, "fye_revised_budget_monthly")) &&
    (await constraintExists(
      c,
      "fye_revised_budget_monthly_updated_by_users_id_fk",
    )) &&
    (await indexExists(c, "fye_revised_budget_monthly_fye_metric_month_idx")),
};

async function tableExists(client: Client, table: string): Promise<boolean> {
  const res = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists;`,
    [table],
  );
  return res.rows[0]?.exists === true;
}

async function columnExists(
  client: Client,
  table: string,
  column: string,
): Promise<boolean> {
  const res = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS exists;`,
    [table, column],
  );
  return res.rows[0]?.exists === true;
}

async function indexExists(
  client: Client,
  index: string,
): Promise<boolean> {
  const res = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'i' AND n.nspname = 'public' AND c.relname = $1
     ) AS exists;`,
    [index],
  );
  return res.rows[0]?.exists === true;
}

async function constraintExists(
  client: Client,
  constraint: string,
): Promise<boolean> {
  const res = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = $1
     ) AS exists;`,
    [constraint],
  );
  return res.rows[0]?.exists === true;
}

async function hashForEntry(entry: JournalEntry): Promise<string> {
  const sqlPath = path.join(MIGRATIONS_DIR, `${entry.tag}.sql`);
  const sql = await readFile(sqlPath, "utf-8");
  return createHash("sha256").update(sql).digest("hex");
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[drizzle-bootstrap] DATABASE_URL is not set; skipping.");
    process.exit(0);
  }

  const journalRaw = await readFile(JOURNAL_PATH, "utf-8");
  const journal = JSON.parse(journalRaw) as Journal;
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    console.log("[drizzle-bootstrap] No entries in journal; nothing to do.");
    return;
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // Step 1 — Detect existing app schema. If neither core table
    // exists this is a fresh DB; let drizzle-kit migrate run the
    // baseline as designed.
    const probe = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name IN ('project_info', 'users')
       ) AS exists;`,
    );
    const schemaExists = probe.rows[0]?.exists === true;
    if (!schemaExists) {
      console.log(
        "[drizzle-bootstrap] No existing app schema detected (no public.project_info or public.users). " +
          "Skipping backfill so drizzle-kit migrate can apply the baseline normally.",
      );
      return;
    }

    // Step 2 — Ensure drizzle bookkeeping table exists (same shape
    // drizzle-kit creates internally).
    await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle";`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
         id SERIAL PRIMARY KEY,
         hash text NOT NULL,
         created_at bigint
       );`,
    );

    // Step 3 — Pre-compute hashes + probe results for every journal
    // entry so we can decide insert / delete / leave-alone per row.
    const planned: Array<{
      entry: JournalEntry;
      hash: string;
      shouldBeApplied: boolean;
      probed: boolean;
    }> = [];
    for (const entry of journal.entries) {
      const hash = await hashForEntry(entry);
      const probeFn = MODERN_MIGRATION_PROBES[entry.tag];
      let shouldBeApplied: boolean;
      let probed = false;
      if (probeFn) {
        shouldBeApplied = await probeFn(client);
        probed = true;
      } else {
        // Presumed applied (pre-rebuild history baked into 0000 baseline).
        shouldBeApplied = true;
      }
      planned.push({ entry, hash, shouldBeApplied, probed });
    }

    // Step 4 — Read current __drizzle_migrations state.
    const existingRes = await client.query<{ id: number; hash: string }>(
      `SELECT id, hash FROM "drizzle"."__drizzle_migrations";`,
    );
    const existingByHash = new Map<string, number>();
    for (const row of existingRes.rows) {
      existingByHash.set(row.hash, row.id);
    }

    // Step 5 — Compute the watermark.
    //
    // The pg dialect's migrate() helper applies any journal entry whose
    // `when` is strictly greater than `MAX(created_at)` from the
    // bookkeeping table (see node_modules/drizzle-orm/pg-core/dialect.js
    // — `select ... order by created_at desc limit 1`). So per-row
    // hash-matching is irrelevant: only the watermark matters.
    //
    // Strategy: find the EARLIEST `when` among probed-as-missing
    // entries. The watermark must end up strictly less than that value
    // so drizzle replays it (and every later journal entry, in order).
    // All modern migrations are required to be idempotent (IF NOT
    // EXISTS / DO blocks) per CLAUDE.md, so re-applying entries whose
    // canary already passed is a safe no-op.
    const missingProbed = planned.filter((p) => p.probed && !p.shouldBeApplied);
    const cutoffWhen =
      missingProbed.length > 0
        ? Math.min(...missingProbed.map((p) => p.entry.when))
        : Number.POSITIVE_INFINITY;

    // Step 6 — Apply plan inside a transaction.
    //   * DELETE every existing row with created_at >= cutoffWhen so
    //     the watermark drops below the earliest pending migration.
    //   * INSERT entries with when < cutoffWhen that aren't already
    //     recorded (presumed-applied baseline + any probed-and-present
    //     entries that happen to predate the cutoff).
    let inserted = 0;
    let deleted = 0;
    let alreadyOk = 0;

    await client.query("BEGIN");
    try {
      if (Number.isFinite(cutoffWhen)) {
        const delRes = await client.query(
          `DELETE FROM "drizzle"."__drizzle_migrations" WHERE created_at >= $1;`,
          [cutoffWhen],
        );
        deleted = delRes.rowCount ?? 0;
        // Refresh local view of what's still recorded.
        for (const [hash, _id] of existingByHash) {
          const row = planned.find((p) => p.hash === hash);
          if (row && row.entry.when >= cutoffWhen) {
            existingByHash.delete(hash);
          }
        }
      }

      for (const item of planned) {
        if (item.entry.when >= cutoffWhen) {
          // Will be (re-)applied by drizzle-kit migrate. Skip insert.
          continue;
        }
        if (existingByHash.has(item.hash)) {
          alreadyOk++;
          continue;
        }
        await client.query(
          `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2);`,
          [item.hash, item.entry.when],
        );
        inserted++;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }

    for (const m of missingProbed) {
      console.log(
        `[drizzle-bootstrap] PENDING ${m.entry.tag} (when=${m.entry.when}): ` +
          `canary missing — drizzle-kit migrate will apply it.`,
      );
    }
    console.log(
      `[drizzle-bootstrap] Done. inserted=${inserted} deleted=${deleted} ` +
        `already_ok=${alreadyOk} pending=${missingProbed.length} ` +
        `cutoff_when=${Number.isFinite(cutoffWhen) ? cutoffWhen : "none"} ` +
        `total_journal=${planned.length}.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[drizzle-bootstrap] FAILED:", err);
  process.exit(1);
});
