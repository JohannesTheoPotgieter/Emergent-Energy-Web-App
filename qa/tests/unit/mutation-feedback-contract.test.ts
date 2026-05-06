/**
 * EE-QA-021 — CI guard against silent mutation failures.
 *
 * Walks `client/src/**\/*.{ts,tsx}` and finds every file that uses
 * `useMutation`. The mutation MUST give the user a visible failure path,
 * which means the file must satisfy at least one of:
 *
 *   1. `useApiMutation` (the wrapper from `@/hooks/use-api-mutation` —
 *      this guarantees a destructive toast on error by default).
 *   2. Bare `useMutation` AND the file mentions `onError` somewhere.
 *
 * Pre-Wave-6.3 offenders (44 files using `useMutation` with no
 * `onError`) are listed in `qa/fixtures/mutation-feedback-baseline.json`
 * and are temporarily exempt — adding a NEW entry there fails the test
 * deliberately. Removing one (by adopting `useApiMutation` or adding
 * an explicit `onError` toast) is the goal.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "client", "src");
const BASELINE_PATH = path.join(process.cwd(), "qa", "fixtures", "mutation-feedback-baseline.json");

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      yield* walk(p);
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      yield p;
    }
  }
}

function scan(): string[] {
  const out: string[] = [];
  for (const file of walk(ROOT)) {
    let src: string;
    try {
      src = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // Match useMutation as an actual call, not a substring.
    const usesMutation = /\buseMutation\s*[<(]/.test(src);
    if (!usesMutation) continue;

    // Either the canonical wrapper or an explicit onError handler is required.
    const usesWrapper = /\buseApiMutation\b/.test(src);
    const hasOnError = /\bonError\b/.test(src);
    if (usesWrapper || hasOnError) continue;

    const rel = path.relative(process.cwd(), file).replaceAll(path.sep, "/");
    out.push(rel);
  }
  return out.sort();
}

describe("EE-QA-021 — mutation feedback contract", () => {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as {
    _documentation?: string;
    files: string[];
  };
  const baselineSet = new Set(baseline.files);

  it("has no NEW useMutation calls without onError or useApiMutation", () => {
    const offenders = scan();
    const newOffenders = offenders.filter((f) => !baselineSet.has(f));
    if (newOffenders.length > 0) {
      throw new Error(
        [
          `Found ${newOffenders.length} NEW useMutation call(s) without an onError handler:`,
          ...newOffenders.map((f) => `  ${f}`),
          "",
          "Fix one of:",
          "  • Switch to `useApiMutation` from @/hooks/use-api-mutation (preferred)",
          "  • Add an `onError` callback that toasts / shows a banner",
          "",
          "Silent mutation failures break user trust — the user sees nothing happen and",
          "assumes the action worked. See client/src/hooks/use-api-mutation.ts for the",
          "canonical wrapper.",
        ].join("\n"),
      );
    }
    expect(newOffenders).toEqual([]);
  });

  it("baseline only lists files that still need migration (debt is shrinking, never growing)", () => {
    const offenders = new Set(scan());
    const stale = baseline.files.filter((f) => !offenders.has(f));
    if (stale.length > 0) {
      throw new Error(
        [
          `${stale.length} file(s) in the baseline have been fixed (excellent!) — please remove them:`,
          ...stale.map((f) => `  ${f}`),
          "",
          "Edit qa/fixtures/mutation-feedback-baseline.json and drop those entries.",
        ].join("\n"),
      );
    }
    expect(stale).toEqual([]);
  });
});
