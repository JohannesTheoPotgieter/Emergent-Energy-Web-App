/**
 * EE-QA-015 — produce the file-size baseline for the ratchet test.
 *
 * Run after a meaningful split / refactor:
 *
 *   npx tsx scripts/build-file-size-baseline.ts
 *
 * Then commit the updated `qa/fixtures/file-size-baseline.json`. The
 * ratchet test (`qa/tests/unit/file-size-ratchet.test.ts`) reads it
 * and fails if any baseline file grows OR if a NEW file appears over
 * the threshold.
 */
import fs from "node:fs";
import path from "node:path";

export const FILE_SIZE_ROOTS = ["client/src", "server", "shared"];
/**
 * Files above this LOC count are tracked in the baseline. New files
 * exceeding it fail the ratchet. The audit's long-term target is
 * 1,500 LOC; the threshold here is the same — every PR is one step
 * closer.
 */
export const FILE_SIZE_THRESHOLD = 1500;

export function* walk(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      yield* walk(p);
    } else if (e.isFile() && /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts")) {
      yield p;
    }
  }
}

export function countLines(file: string): number {
  return fs.readFileSync(file, "utf8").split("\n").length;
}

export interface FileSizeBaselineEntry {
  /** Path relative to repo root, forward slashes. */
  file: string;
  /** Current LOC. The ratchet test fails if the file grows above this + buffer. */
  loc: number;
}

export function buildBaseline(): FileSizeBaselineEntry[] {
  const out: FileSizeBaselineEntry[] = [];
  for (const r of FILE_SIZE_ROOTS) {
    for (const f of walk(r)) {
      const n = countLines(f);
      if (n <= FILE_SIZE_THRESHOLD) continue;
      out.push({ file: f.replaceAll(path.sep, "/"), loc: n });
    }
  }
  out.sort((a, b) => b.loc - a.loc);
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("build-file-size-baseline.ts")) {
  const entries = buildBaseline();
  console.log(
    JSON.stringify(
      {
        _documentation:
          "EE-QA-015 baseline — files above the FILE_SIZE_THRESHOLD LOC. The CI guard `qa/tests/unit/file-size-ratchet.test.ts` fails if any of these grow OR a NEW file lands over the threshold. To regenerate after a split, run `npx tsx scripts/build-file-size-baseline.ts` and commit the new JSON.",
        threshold: FILE_SIZE_THRESHOLD,
        buffer: 50,
        generated: new Date().toISOString().split("T")[0],
        files: entries,
      },
      null,
      2,
    ),
  );
}
