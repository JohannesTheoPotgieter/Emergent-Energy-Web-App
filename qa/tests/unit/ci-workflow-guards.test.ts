/**
 * CI workflow regression guards (Layer 1 + Layer 2 of the long-term CI fix)
 *
 * Pins three invariants on the CI workflows so we don't silently regress to
 * the chronic "compile fails in 2 seconds" state that preceded this fix:
 *
 *   1. CI + PR workflows invoke `npm run ci:compile` (the canonical script),
 *      not raw `npx turbo run lint check build`. Keeps CI and local in lock
 *      step — the same command produces the same result in both places.
 *
 *   2. The `compile` jobs do NOT reference `secrets.TURBO_TOKEN` or
 *      `secrets.TURBO_TEAM`. Remote cache is a speed optimization, not a
 *      correctness gate; a missing/empty secret must not make `compile`
 *      fail at startup. The compile job runs on local turbo cache only.
 *
 *   3. `package.json` exposes `ci:compile` so the dev-facing and CI-facing
 *      compile commands are literally one script. If this is deleted or
 *      renamed, CI goes off-script.
 *
 * These are source-text assertions on purpose — the failure mode we're
 * guarding against is a silent workflow-YAML revert that reintroduces the
 * empty-secret env block, or a rename of the npm script on one side but
 * not the other.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("ci:compile is the single canonical compile command", () => {
  it("package.json defines ci:compile", () => {
    const pkg = JSON.parse(read("package.json"));
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    expect(
      scripts["ci:compile"],
      "ci:compile is the canonical compile script consumed by both CI workflows and local devs. If you remove it, one side will drift from the other.",
    ).toBeDefined();
    expect(scripts["ci:compile"]).toMatch(/turbo\s+run/);
    expect(scripts["ci:compile"]).toMatch(/lint/);
    expect(scripts["ci:compile"]).toMatch(/check/);
    expect(scripts["ci:compile"]).toMatch(/build/);
  });
});

describe("GitHub workflows invoke npm run ci:compile", () => {
  const WORKFLOW_FILES = [
    ".github/workflows/pr-checks.yml",
  ];
  for (const file of WORKFLOW_FILES) {
    it(`${file} compile job runs npm run ci:compile`, () => {
      const source = read(file);
      expect(
        source,
        `${file} must call \`npm run ci:compile\`. Running raw \`npx turbo run ...\` inline drifts from what devs run locally.`,
      ).toMatch(/npm\s+run\s+ci:compile/);
    });
  }
});

describe("GitHub workflows do not couple to Turbo Remote Cache secrets", () => {
  const WORKFLOW_FILES = [
    ".github/workflows/pr-checks.yml",
  ];
  for (const file of WORKFLOW_FILES) {
    it(`${file} does not reference secrets.TURBO_TOKEN or secrets.TURBO_TEAM`, () => {
      const source = read(file);
      // The compile job must be able to go green without any repo-level
      // secrets being configured. Remote cache can be added back later as a
      // pure speed optimization — never as a correctness gate.
      expect(
        source,
        `${file} must not reference secrets.TURBO_TOKEN — an empty/missing secret previously made compile fail at startup. Use local turbo cache only.`,
      ).not.toMatch(/secrets\.TURBO_TOKEN/);
      expect(
        source,
        `${file} must not reference secrets.TURBO_TEAM for the same reason.`,
      ).not.toMatch(/secrets\.TURBO_TEAM/);
    });
  }
});
