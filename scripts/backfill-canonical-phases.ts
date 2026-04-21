/**
 * Backfill / normalize project_info.phase + execution_phase to the canonical
 * 10-stage cycle defined in shared/phases.ts.
 *
 * Source of truth: project_info.phase (canonical label).
 * Mirror: project_info.execution_phase = phase.
 *
 * For each project, we compute a target canonical phase using this priority:
 *   1. resolveCanonicalPhase(current.phase)
 *   2. resolveCanonicalPhase(latest project_phase_history.to_phase, ignoring 'Gone')
 *   3. latest in_progress / IN_PROGRESS stage_code from project_stage_instances
 *      (highest displayNumber wins on ties)
 *   4. highest displayNumber 'progressed' / 'PROGRESSED' stage_code from
 *      project_stage_instances
 *   5. resolveCanonicalPhase(current.execution_phase)
 *   6. resolveCanonicalPhase from project_name suffix " + X"
 *   7. NULL (project_status = 'hold' / 'internal' is left as-is so the
 *      project shows as off-lifecycle in the UI)
 *
 * If target differs from current.phase, we UPDATE both columns and write a
 * row to project_phase_history. Pass --apply to actually write.
 *
 * Usage:
 *   npx tsx scripts/backfill-canonical-phases.ts            # dry-run
 *   npx tsx scripts/backfill-canonical-phases.ts --apply    # write
 */
import { Pool } from "pg";
import {
  PHASES,
  PHASE_BY_CODE,
  resolveCanonicalPhase,
  type CanonicalPhase,
} from "../shared/phases";

const APPLY = process.argv.includes("--apply");
const REASON = "canonical-phase-backfill 2026-04-21";
// changed_by_user_id is NOT NULL on project_phase_history — attribute the
// system backfill to the CEO_ADMIN user (id 22 = Dayne) per user direction.
const ACTOR_USER_ID = Number(process.env.BACKFILL_ACTOR_USER_ID ?? 22);

interface ProjectRow {
  id: number;
  project_name: string;
  phase: string | null;
  execution_phase: string | null;
  project_status: string;
  in_dlp: boolean;
}

// Off-lifecycle labels that may sit in `phase` or `execution_phase` but are
// NOT phases — they live on project_status / in_dlp instead. We treat the
// phase column as blank when it holds one of these and infer from history /
// stages / suffix instead.
const OFF_LIFECYCLE_LABELS = new Set([
  "hold",
  "on hold",
  "on-hold",
  "internal",
  "closed",
  "tbc",
  "dlp",
]);

function isOffLifecycle(value: string | null | undefined): boolean {
  if (!value) return false;
  return OFF_LIFECYCLE_LABELS.has(value.trim().toLowerCase());
}

interface HistoryRow {
  project_id: number;
  to_phase: string | null;
  changed_at: Date;
}

interface StageRow {
  project_id: number;
  stage_code: string;
  stage_status: string;
  completed_at: Date | null;
  started_at: Date | null;
}

function suffixPhase(name: string): CanonicalPhase | null {
  // Match "Project Name + Phase Name" suffix used by held projects.
  const m = name.match(/\+\s*(.+?)\s*$/);
  if (!m) return null;
  return resolveCanonicalPhase(m[1]);
}

function pickHighestStage(rows: StageRow[], statuses: string[]): CanonicalPhase | null {
  const matching = rows.filter((r) => statuses.includes(r.stage_status));
  if (matching.length === 0) return null;
  // Resolve to canonical phase, then pick the one with the highest
  // displayNumber. This biases towards the most recent point in the
  // lifecycle the project has actually reached.
  let best: CanonicalPhase | null = null;
  for (const r of matching) {
    const ph = PHASE_BY_CODE[r.stage_code];
    if (!ph) continue;
    if (!best || ph.displayNumber > best.displayNumber) best = ph;
  }
  return best;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    const projects = (await client.query<ProjectRow>(
      `SELECT id, project_name, phase, execution_phase, project_status, in_dlp FROM project_info ORDER BY id`,
    )).rows;

    const history = (await client.query<HistoryRow>(
      `SELECT project_id, to_phase, changed_at FROM project_phase_history ORDER BY project_id, changed_at DESC`,
    )).rows;

    const stages = (await client.query<StageRow>(
      `SELECT project_id, stage_code, stage_status, completed_at, started_at FROM project_stage_instances`,
    )).rows;

    const histByProject = new Map<number, HistoryRow[]>();
    for (const h of history) {
      const arr = histByProject.get(h.project_id) ?? [];
      arr.push(h);
      histByProject.set(h.project_id, arr);
    }
    const stagesByProject = new Map<number, StageRow[]>();
    for (const s of stages) {
      const arr = stagesByProject.get(s.project_id) ?? [];
      arr.push(s);
      stagesByProject.set(s.project_id, arr);
    }

    let unchanged = 0;
    let normalized = 0;
    let inferred = 0;
    let unresolved = 0;
    const changes: Array<{
      id: number;
      name: string;
      from: string | null;
      to: string | null;
      source: string;
      status: string;
      setInDlp: boolean;
      setStatus: string | null;
    }> = [];

    for (const p of projects) {
      let target: CanonicalPhase | null = null;
      let source = "";

      // Off-lifecycle labels (Hold/Internal/Closed/TBC/DLP) in the phase
      // column are treated as blank; we infer the underlying phase from
      // history/stages/suffix and additionally flip in_dlp=true if DLP was
      // the recorded label.
      const phaseIsOffLifecycle = isOffLifecycle(p.phase);
      const execIsOffLifecycle = isOffLifecycle(p.execution_phase);
      const dlpDetected =
        (p.phase ?? "").trim().toLowerCase() === "dlp" ||
        (p.execution_phase ?? "").trim().toLowerCase() === "dlp";

      // 1. Current phase, if already canonical or aliasable (skip if it's
      //    an off-lifecycle label).
      if (!phaseIsOffLifecycle) {
        const fromPhase = resolveCanonicalPhase(p.phase);
        if (fromPhase) {
          target = fromPhase;
          source = "phase";
        }
      }

      // 2. Latest non-Gone phase_history entry.
      if (!target) {
        const hist = (histByProject.get(p.id) ?? []).find(
          (h) => h.to_phase && h.to_phase.toLowerCase() !== "gone",
        );
        if (hist) {
          const r = resolveCanonicalPhase(hist.to_phase);
          if (r) {
            target = r;
            source = "history";
          }
        }
      }

      // 3. Project name suffix " + X" — for held/forked projects this is
      //    an explicit user-encoded label and is more authoritative than the
      //    default S01 stage instance every project starts with.
      if (!target) {
        const r = suffixPhase(p.project_name);
        if (r) {
          target = r;
          source = "name_suffix";
        }
      }

      // 3a. DLP detected: lock to O&M Handover immediately. DLP is a
      //     strong human-curated label and prod's stage_instances often
      //     contain auto-init S10 progressed rows that misrepresent
      //     reality. The +in_dlp flag preserves DLP context.
      if (!target && dlpDetected) {
        target = PHASES.find((ph) => ph.code === "S08_OM_HANDOVER") ?? null;
        source = "dlp_default";
      }

      // 4. In-progress stage instance.
      if (!target) {
        const r = pickHighestStage(
          stagesByProject.get(p.id) ?? [],
          ["in_progress", "IN_PROGRESS"],
        );
        if (r) {
          target = r;
          source = "stage_in_progress";
        }
      }

      // 5. Progressed stage instance — but only if there's at least one
      //    stage that's also been started (avoids picking up auto-init
      //    rows where every stage is marked progressed but never touched).
      if (!target) {
        const stageRows = stagesByProject.get(p.id) ?? [];
        const hasRealStarted = stageRows.some(
          (r) => r.started_at != null || r.completed_at != null,
        );
        if (hasRealStarted) {
          const r = pickHighestStage(stageRows, ["progressed", "PROGRESSED"]);
          if (r) {
            target = r;
            source = "stage_progressed";
          }
        }
      }

      // 7. execution_phase aliased (skip if off-lifecycle).
      if (!target && !execIsOffLifecycle) {
        const r = resolveCanonicalPhase(p.execution_phase);
        if (r) {
          target = r;
          source = "execution_phase";
        }
      }

      // 8. Final fallback for active projects with no signal at all:
      //    default to First Assessment (the lifecycle entry point) so
      //    every active project shows on a board somewhere. Held / internal
      //    projects with no signal are left blank — they're off-lifecycle.
      if (!target && p.project_status === "active") {
        target = PHASES[0]; // First Assessment
        source = "default_active";
      }

      // If phase was an off-lifecycle label (Hold/Internal/Closed/TBC),
      // also realign project_status so the off-lifecycle context isn't
      // lost when we move the value out of the phase column. DLP is just
      // a flag and does NOT change project_status.
      const phaseLc = (p.phase ?? "").trim().toLowerCase();
      let targetStatus: string | null = null;
      if (phaseLc === "hold" || phaseLc === "on hold" || phaseLc === "on-hold") {
        targetStatus = "hold";
      } else if (phaseLc === "internal") {
        targetStatus = "internal";
      } else if (phaseLc === "closed") {
        targetStatus = "closed";
      } else if (phaseLc === "tbc") {
        targetStatus = "tbc";
      }
      const setStatus =
        targetStatus !== null && targetStatus !== p.project_status;

      const targetLabel = target?.label ?? null;
      const currentPhase = (p.phase ?? "").trim() || null;
      const currentExec = (p.execution_phase ?? "").trim() || null;
      const setInDlp = dlpDetected && !p.in_dlp;

      const phaseDiffers = currentPhase !== targetLabel;
      const execDiffers = currentExec !== targetLabel;

      if (!phaseDiffers && !execDiffers && !setInDlp && !setStatus) {
        unchanged++;
        continue;
      }

      if (!targetLabel) {
        unresolved++;
        changes.push({
          id: p.id,
          name: p.project_name,
          from: currentPhase,
          to: null,
          source: "unresolved",
          status: p.project_status,
          setInDlp,
          setStatus: setStatus ? targetStatus : null,
        });
      } else if (source === "phase" && phaseDiffers === false && execDiffers) {
        normalized++;
        changes.push({
          id: p.id,
          name: p.project_name,
          from: currentExec,
          to: targetLabel,
          source: "mirror_exec_to_phase",
          status: p.project_status,
          setInDlp,
          setStatus: setStatus ? targetStatus : null,
        });
      } else if (source === "phase") {
        normalized++;
        changes.push({
          id: p.id,
          name: p.project_name,
          from: currentPhase,
          to: targetLabel,
          source,
          status: p.project_status,
          setInDlp,
          setStatus: setStatus ? targetStatus : null,
        });
      } else {
        inferred++;
        changes.push({
          id: p.id,
          name: p.project_name,
          from: currentPhase,
          to: targetLabel,
          source,
          status: p.project_status,
          setInDlp,
          setStatus: setStatus ? targetStatus : null,
        });
      }
    }

    console.log(`\n=== Canonical phase backfill plan (${APPLY ? "APPLY" : "DRY-RUN"}) ===`);
    console.log(`Total projects: ${projects.length}`);
    console.log(`Unchanged: ${unchanged}`);
    console.log(`Normalized (alias / mirror execution_phase): ${normalized}`);
    console.log(`Inferred from history/stages/suffix: ${inferred}`);
    console.log(`Unresolved (phase left NULL): ${unresolved}`);
    console.log(``);
    console.log(`id   | status   | source              | from                  -> to`);
    console.log(`-----+----------+---------------------+----------------------------------`);
    for (const c of changes) {
      console.log(
        `${String(c.id).padEnd(4)} | ${c.status.padEnd(8)} | ${c.source.padEnd(19)} | ${String(c.from ?? "").padEnd(22)} -> ${c.to ?? "NULL"}  (${c.name})`,
      );
    }

    if (!APPLY) {
      console.log(`\nDRY-RUN — pass --apply to write changes.`);
      return;
    }

    await client.query("BEGIN");
    let appliedRows = 0;
    let appliedHist = 0;
    for (const c of changes) {
      const proj = projects.find((p) => p.id === c.id)!;
      const newPhase = c.to;
      const newExec = c.to;
      // Only insert history if phase actually changes (not pure mirror).
      const phaseChanged = (proj.phase ?? null) !== newPhase;
      if (phaseChanged) {
        await client.query(
          `INSERT INTO project_phase_history (project_id, from_phase, to_phase, changed_by_user_id, reason, changed_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [c.id, proj.phase, newPhase, ACTOR_USER_ID, REASON],
        );
        appliedHist++;
      }
      await client.query(
        `UPDATE project_info
         SET phase = $1,
             execution_phase = $2,
             in_dlp = CASE WHEN $3::boolean THEN TRUE ELSE in_dlp END,
             project_status = COALESCE($4, project_status),
             phase_updated_at = CASE WHEN $5::boolean THEN NOW() ELSE phase_updated_at END
         WHERE id = $6`,
        [newPhase, newExec, c.setInDlp, c.setStatus, phaseChanged, c.id],
      );
      appliedRows++;
    }
    await client.query("COMMIT");
    console.log(`\nApplied: ${appliedRows} project_info updates, ${appliedHist} history rows inserted.`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
