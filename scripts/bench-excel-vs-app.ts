/**
 * Benchmark for the Excel-vs-App diff endpoints.
 *
 * Run on staging with realistic data (real projects, real
 * Tracker imports). Records p50 / p95 / p99 over N iterations
 * for:
 *   1. trackerReplicaRepository.getDriftDetail(projectId)
 *      — direct repo call.
 *   2. The program-level summary (one getDriftDetail per project).
 *   3. applyManualOverride / clearManualOverride round-trip per
 *      single field.
 *
 * Usage:
 *   npx tsx scripts/bench-excel-vs-app.ts                 # all projects, N=10
 *   npx tsx scripts/bench-excel-vs-app.ts --iterations=20
 *   npx tsx scripts/bench-excel-vs-app.ts --project-id=42
 *   npx tsx scripts/bench-excel-vs-app.ts --skip-mutations  # read-only
 *
 * Output is greppable so a CI job can scrape thresholds:
 *   [ExcelVsApp.bench] {"op":"getDriftDetail","p50":12,"p95":34,...}
 *
 * No production state is modified — the mutation benchmark uses
 * a temporary row it creates and deletes.
 */
import { eq } from "drizzle-orm";
import { db, initializeDatabase } from "../server/db";
import { projectInfo } from "@shared/schema/projects";
import { normalizedCostLines } from "@shared/schema/finance";
import { trackerReplicaRepository } from "../server/repositories/tracker-replica-repository";
import { applyManualOverride, clearManualOverride } from "../server/lib/manual-overrides";

interface Opts {
  iterations: number;
  projectId?: number;
  skipMutations: boolean;
  verbose: boolean;
}

function parseArgs(): Opts {
  const opts: Opts = { iterations: 10, skipMutations: false, verbose: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--skip-mutations") opts.skipMutations = true;
    else if (arg === "--verbose") opts.verbose = true;
    else if (arg.startsWith("--iterations=")) {
      const n = Number(arg.split("=")[1]);
      if (Number.isFinite(n) && n > 0) opts.iterations = n;
    } else if (arg.startsWith("--project-id=")) {
      const n = Number(arg.split("=")[1]);
      if (Number.isFinite(n) && n > 0) opts.projectId = n;
    }
  }
  return opts;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function emit(op: string, samples: number[], extra?: Record<string, unknown>) {
  const sorted = [...samples].sort((a, b) => a - b);
  const out = {
    op,
    n: samples.length,
    minMs: Math.round(sorted[0] ?? 0),
    p50Ms: Math.round(percentile(sorted, 50)),
    p95Ms: Math.round(percentile(sorted, 95)),
    p99Ms: Math.round(percentile(sorted, 99)),
    maxMs: Math.round(sorted[sorted.length - 1] ?? 0),
    meanMs: Math.round(samples.reduce((s, v) => s + v, 0) / Math.max(1, samples.length)),
    ...extra,
  };
  console.info(`[ExcelVsApp.bench] ${JSON.stringify(out)}`);
}

async function timeIt<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = performance.now();
  const result = await fn();
  return { result, ms: performance.now() - t0 };
}

async function benchPerProject(projectId: number, opts: Opts) {
  const samples: number[] = [];
  let driftRowCount = 0;
  for (let i = 0; i < opts.iterations; i++) {
    const { result, ms } = await timeIt(() => trackerReplicaRepository.getDriftDetail(projectId));
    samples.push(ms);
    driftRowCount = result.costLines.length + result.revenueLines.length + result.planTasks.length;
    if (opts.verbose) console.log(`[bench]   project=${projectId} iter=${i} ms=${ms.toFixed(1)}`);
  }
  emit("getDriftDetail", samples, { projectId, rowCount: driftRowCount });
}

async function benchProgram(opts: Opts) {
  const projects = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo);
  const samples: number[] = [];
  for (let i = 0; i < opts.iterations; i++) {
    const { ms } = await timeIt(async () => {
      // Mirror the route's Promise.all pattern.
      await Promise.all(projects.map((p: { id: number }) => trackerReplicaRepository.getDriftDetail(p.id)));
    });
    samples.push(ms);
    if (opts.verbose) console.log(`[bench]   program iter=${i} ms=${ms.toFixed(1)}`);
  }
  emit("program.summary", samples, { projectCount: projects.length });
}

async function benchMutations(opts: Opts) {
  // Create a temporary project + cost row so we don't perturb real
  // data. Clean up at the end.
  const marker = `__bench_${Date.now()}_${Math.random().toString(36).slice(2, 8)}__`;
  const [p] = await db.insert(projectInfo).values({ projectName: marker }).returning({ id: projectInfo.id });
  const [row] = await db
    .insert(normalizedCostLines)
    .values({
      projectId: p.id,
      projectName: marker,
      description: "bench row",
      amountExVat: "1500.00",
    } as any)
    .returning({ id: normalizedCostLines.id });

  try {
    const applySamples: number[] = [];
    const clearSamples: number[] = [];
    for (let i = 0; i < opts.iterations; i++) {
      const a = await timeIt(() =>
        applyManualOverride({
          table: "normalized_cost_lines",
          rowId: row.id,
          fieldName: "amountExVat",
          value: `${1500 + i}`,
          editedBy: 1,
        }),
      );
      applySamples.push(a.ms);
      const c = await timeIt(() => clearManualOverride("normalized_cost_lines", row.id, "amountExVat"));
      clearSamples.push(c.ms);
    }
    emit("applyManualOverride", applySamples);
    emit("clearManualOverride", clearSamples);
  } finally {
    await db.delete(normalizedCostLines).where(eq(normalizedCostLines.id, row.id));
    await db.delete(projectInfo).where(eq(projectInfo.id, p.id));
  }
}

async function main() {
  const opts = parseArgs();
  await initializeDatabase();

  console.log(`[bench] starting, iterations=${opts.iterations}${opts.projectId ? `, projectId=${opts.projectId}` : ""}`);

  if (opts.projectId != null) {
    await benchPerProject(opts.projectId, opts);
  } else {
    // Pick the project with the most cost lines as the "biggest".
    const projects = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo);
    if (projects.length === 0) {
      console.warn("[bench] no projects in DB — nothing to benchmark");
    } else {
      // Sample one mid-sized + one largest — minimal but representative.
      // Pick the first 3 as a quick proxy when no row-count metric is at hand.
      for (const p of projects.slice(0, 3)) {
        await benchPerProject(p.id, opts);
      }
      await benchProgram(opts);
    }
  }

  if (!opts.skipMutations) {
    await benchMutations(opts);
  }

  console.log("[bench] complete");
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[bench] failed:", err);
    process.exit(1);
  });
