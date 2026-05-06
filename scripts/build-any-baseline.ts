/**
 * EE-QA-023 — produce the current `any` usage count for the ratchet baseline.
 *
 * Run after a meaningful cleanup PR:
 *
 *   npx tsx scripts/build-any-baseline.ts
 *
 * Then commit the updated `qa/fixtures/typescript-any-baseline.json`.
 * The unit test `qa/tests/unit/typescript-any-ratchet.test.ts` reads
 * that file and fails if the count grows.
 */
import fs from "node:fs";
import path from "node:path";

export const ANY_BASELINE_ROOTS = ["client/src", "server", "shared"];

// Matches `any` as a type, allowing for whitespace, `<`, `(`, or `,` as
// the leading boundary. Excludes identifiers like `anyOf` / `anything` by
// rejecting a trailing word character.
export const ANY_RE = /(?:\s|^|<|\(|,)any\b(?!\s*[A-Za-z_$])/g;

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

export function stripCommentsAndStrings(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/`[^`]*`/g, '""');
}

export function countAny(roots: readonly string[] = ANY_BASELINE_ROOTS): number {
  let total = 0;
  for (const r of roots) {
    for (const f of walk(r)) {
      const stripped = stripCommentsAndStrings(fs.readFileSync(f, "utf8"));
      total += (stripped.match(ANY_RE) ?? []).length;
    }
  }
  return total;
}

if (process.argv[1] && process.argv[1].endsWith("build-any-baseline.ts")) {
  const total = countAny();
  console.log(JSON.stringify({ total, generated: new Date().toISOString().split("T")[0] }, null, 2));
}
