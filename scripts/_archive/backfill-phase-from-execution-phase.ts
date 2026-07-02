#!/usr/bin/env tsx
/**
 * Backfill the canonical lifecycle phase (project_execution_state.phase) from
 * the phase that is actually maintained in the app.
 *
 * Why: the Execution board reads project_execution_state.phase, but for most
 * projects that field is stuck at the "PLANNING" seed default — while the real,
 * app-maintained phase lives in project_execution_state.execution_phase (the
 * field every OTHER app surface resolves first: `executionPhase ?? phase`).
 * This promotes that in-app value into the canonical phase, mapped to the
 * CLOSEST canonical label via resolveCanonicalPhase, so the single canonical
 * field the board reads + edits holds the real value.
 *
 * Source of truth per project: execution_phase ?? phase  → resolveCanonicalPhase
 * Going forward, phase is maintained in-app (inline on the board / the company
 * lifecycle board), so this is a one-time catch-up, not a recurring sync.
 *
 * Connects directly via DATABASE_URL (no app boot), like the other scripts.
 *
 * Run on Replit:
 *   tsx scripts/backfill-phase-from-execution-phase.ts            # dry run
 *   tsx scripts/backfill-phase-from-execution-phase.ts --apply    # write
 */

import "dotenv/config";
import { Client } from "pg";
import { resolveCanonicalPhase } from "../shared/phases";

const APPLY = process.argv.includes("--apply");

function clean(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set — run this on Replit.");
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const rows = (
      await client.query(`
        SELECT pe.project_id        AS project_id,
               pi.project_name      AS project_name,
               pe.phase             AS phase,
               pe.execution_phase   AS execution_phase
          FROM project_execution_state pe
          JOIN project_info pi ON pi.id = pe.project_id
         WHERE pe.deleted_at IS NULL AND pi.deleted_at IS NULL
         ORDER BY pi.project_name
      `)
    ).rows as Array<Record<string, unknown>>;

    const planned: Array<{ id: number; name: string; from: string | null; to: string }> = [];
    const distribution = new Map<string, number>();
    let unresolved = 0;

    for (const r of rows) {
      const phase = clean(r.phase);
      const execPhase = clean(r.execution_phase);
      // The app's own precedence: prefer the maintained execution_phase.
      const source = execPhase ?? phase;
      const resolved = resolveCanonicalPhase(source);
      if (!resolved) {
        unresolved += 1;
        distribution.set(phase ?? "(none)", (distribution.get(phase ?? "(none)") ?? 0) + 1);
        continue;
      }
      distribution.set(resolved.label, (distribution.get(resolved.label) ?? 0) + 1);
      if (resolved.label !== phase) {
        planned.push({ id: Number(r.project_id), name: String(r.project_name), from: phase, to: resolved.label });
      }
    }

    console.log(`Projects scanned: ${rows.length}`);
    console.log(`Resulting phase distribution (closest canonical of execution_phase ?? phase):`);
    for (const [label, n] of [...distribution.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)}  ${label}`);
    }
    if (unresolved > 0) {
      console.log(`  (${unresolved} project(s) had no resolvable phase — left unchanged; e.g. blank or "DLP" status)`);
    }

    if (planned.length === 0) {
      console.log("\nNothing to change — every project's canonical phase already matches its in-app value. ✅");
      return;
    }

    console.log(`\n${planned.length} project(s) would change:`);
    console.log("  name".padEnd(34) + "phase → canonical");
    for (const p of planned) {
      console.log(`  ${p.name.slice(0, 30).padEnd(32)} ${String(p.from ?? "—")} → ${p.to}`);
    }

    if (!APPLY) {
      console.log("\nDry run — nothing written. Re-run with --apply to write these canonical phases.");
      return;
    }

    let updated = 0;
    for (const p of planned) {
      const res = await client.query(
        `UPDATE project_execution_state SET phase = $1, phase_updated_at = now() WHERE project_id = $2`,
        [p.to, p.id],
      );
      updated += res.rowCount ?? 0;
    }
    console.log(`\nUpdated ${updated} project phase(s). The Execution board will reflect them immediately.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
