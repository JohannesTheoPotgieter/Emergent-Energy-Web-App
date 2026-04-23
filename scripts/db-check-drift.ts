#!/usr/bin/env tsx
/**
 * Schema-drift CI guard (Phase 3b).
 *
 * Fails the build when `shared/schema/*.ts` has been edited but no
 * corresponding new migration file was produced via `npm run db:generate`.
 *
 * Implementation: invoke `drizzle-kit generate` against an ephemeral
 * output directory and a throwaway DB URL. drizzle-kit compares the
 * current schema to the last journal snapshot; if they disagree, it
 * writes a new SQL file. We count the files it produced — non-zero means
 * the committed migrations are out of sync with the schema.
 *
 * Invoked by CI and by `npm run db:check` locally. No side effects on the
 * real /migrations directory.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const repoRoot = process.cwd();
const migrationsDir = path.join(repoRoot, "migrations");
// Keep scratch inside the repo so drizzle-kit's relative path resolution
// works (`--out=/abs/...` is mis-handled as `./abs/...`). We clean it up
// in the finally block.
const scratch = path.join(repoRoot, ".migrations-drift-check");
if (fs.existsSync(scratch)) fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(scratch, { recursive: true });
const scratchMigrations = scratch;

type Journal = {
  entries?: Array<{ tag?: string }>;
};

function checkMigrationJournalIntegrity(): void {
  const sqlFiles = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const journalPath = path.join(migrationsDir, "meta", "_journal.json");
  const journalRaw = fs.readFileSync(journalPath, "utf8");
  const journal = JSON.parse(journalRaw) as Journal;
  const tracked = new Set((journal.entries ?? []).map((entry) => `${entry.tag ?? ""}.sql`));

  const untracked = sqlFiles.filter((file) => !tracked.has(file));
  if (untracked.length > 0) {
    console.error("");
    console.error("✖ Migration journal drift detected.");
    console.error("");
    console.error("These migration SQL files exist in /migrations but are missing");
    console.error("from migrations/meta/_journal.json:");
    console.error("");
    for (const file of untracked) console.error(`    ${file}`);
    console.error("");
    console.error("Fix by regenerating/committing the matching journal+snapshot state");
    console.error("for these migrations so CI and deploy use the same migration truth.");
    console.error("");
    process.exit(3);
  }
}

try {
  checkMigrationJournalIntegrity();

  // Mirror the journal + baseline so drizzle-kit compares against the
  // committed state. Hard-copy rather than symlink so the scratch run
  // can't accidentally write to the real directory.
  fs.mkdirSync(scratchMigrations, { recursive: true });
  for (const entry of fs.readdirSync(migrationsDir)) {
    if (entry === "archive") continue; // historical, not tracked by journal
    const src = path.join(migrationsDir, entry);
    const dst = path.join(scratchMigrations, entry);
    if (fs.statSync(src).isDirectory()) {
      fs.cpSync(src, dst, { recursive: true });
    } else {
      fs.copyFileSync(src, dst);
    }
  }

  const before = new Set(fs.readdirSync(scratchMigrations));

  // Invoke drizzle-kit generate with explicit flags — no scratch config
  // file needed, which also avoids node_modules resolution issues in tmp.
  // drizzle-kit diffs schema against the snapshot in scratchMigrations/meta;
  // a placeholder DATABASE_URL is fine because `generate` doesn't connect.
  const relScratch = path.relative(repoRoot, scratchMigrations);
  try {
    execSync(
      `npx drizzle-kit generate ` +
        `--schema=shared/schema.ts ` +
        `--out=${relScratch} ` +
        `--dialect=postgresql ` +
        `--name=__drift_check__`,
      {
        cwd: repoRoot,
        stdio: "pipe",
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || "postgresql://unused:unused@127.0.0.1:5432/unused" },
      }
    );
  } catch (err: unknown) {
    const stderr = err instanceof Error && "stderr" in err ? String((err as { stderr: Buffer }).stderr) : String(err);
    console.error("drizzle-kit generate failed in drift-check sandbox:");
    console.error(stderr);
    process.exit(2);
  }

  const after = new Set(fs.readdirSync(scratchMigrations));
  const added: string[] = [];
  for (const entry of after) {
    if (!before.has(entry) && entry.endsWith(".sql")) added.push(entry);
  }

  if (added.length > 0) {
    console.error("");
    console.error("✖ Schema drift detected.");
    console.error("");
    console.error("The schema in shared/schema/*.ts does not match the committed");
    console.error("migrations. drizzle-kit would produce the following new file(s):");
    console.error("");
    for (const f of added) console.error(`    ${f}`);
    console.error("");
    console.error("Resolve by running:");
    console.error("");
    console.error("    npm run db:generate -- --name=<short_snake_case_description>");
    console.error("");
    console.error("Then commit the resulting migration file next to the existing");
    console.error("baseline and the updated migrations/meta/ snapshot.");
    console.error("");
    process.exit(1);
  }

  console.log("✓ Schema in sync with committed migrations (no drift).");
  process.exit(0);
} finally {
  try {
    fs.rmSync(scratch, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}
