/**
 * EE-QA-023 — ratchet test for `any` usage.
 *
 * Counts `any` type usages across `client/src`, `server`, and `shared`
 * and fails if the count exceeds the baseline in
 * `qa/fixtures/typescript-any-baseline.json`. The number can only go
 * DOWN — every removed `any` is a small step toward end-to-end type
 * safety.
 *
 * After a meaningful cleanup PR, regenerate the baseline:
 *
 *   npx tsx scripts/build-any-baseline.ts
 *
 * The 50-row `buffer` accommodates trivial false positives from
 * comment-stripping edge cases without being lax enough to mask real
 * regressions.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { countAny } from "../../../scripts/build-any-baseline";

const BASELINE_PATH = path.join(process.cwd(), "qa", "fixtures", "typescript-any-baseline.json");

describe("EE-QA-023 — TypeScript `any` ratchet", () => {
  const { max, buffer = 50 } = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as {
    max: number;
    buffer?: number;
  };

  it("does not introduce NEW `any` usages beyond the baseline", () => {
    const current = countAny();
    if (current > max + buffer) {
      throw new Error(
        [
          `\`any\` usage grew from baseline ${max} to ${current} (buffer ${buffer}).`,
          "",
          "Every new `any` weakens type safety. Either:",
          "  • Replace the `any` with a real type (preferred)",
          "  • Use `unknown` and narrow at the boundary",
          "  • Use a Drizzle-inferred type for DB rows (typeof table.$inferSelect)",
          "",
          "If you genuinely cleaned up `any` in this PR, regenerate the baseline:",
          "  npx tsx scripts/build-any-baseline.ts",
          "Then commit qa/fixtures/typescript-any-baseline.json with the new max.",
        ].join("\n"),
      );
    }
    expect(current).toBeLessThanOrEqual(max + buffer);
  });

  it("baseline encourages downward pressure (cleanups should refresh the JSON)", () => {
    // If current is far below the baseline, the codebase has been cleaned up
    // since the baseline was last regenerated. Surface the gap so the next
    // contributor knows to bake the win into the baseline.
    const current = countAny();
    const slack = max - current;
    if (slack > 200) {
      throw new Error(
        [
          `Baseline says max=${max} but current count is ${current} (${slack} below).`,
          "",
          "Lock the win in by running:",
          "  npx tsx scripts/build-any-baseline.ts",
          "and updating qa/fixtures/typescript-any-baseline.json.",
        ].join("\n"),
      );
    }
    expect(slack).toBeLessThanOrEqual(200);
  });
});
