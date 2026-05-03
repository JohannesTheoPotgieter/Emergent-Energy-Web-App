/**
 * Release-gate regression guards (Phase 4)
 *
 * Pins the structural decisions of the release-gate repair:
 *
 *   1. `script/test-routes.ts` now GENERATES docs/qa/app-route-inventory.md
 *      from client/src/config/page-registry.ts rather than asserting a hand-
 *      written doc is up to date. The drift source — "hand-written doc must
 *      match generated registry" — is eliminated.
 *
 *   2. The auth rate limiter in server/bootstrap/security-middleware.ts
 *      exempts loopback (127.0.0.1, ::1) when NODE_ENV !== "production".
 *      Previously this limiter blocked test:api and any local dev flow that
 *      logged in >20 times in 15 minutes.
 *
 *   3. Both CI workflows (ci.yml + pr-checks.yml) run `npm run test` as a
 *      required step in the compile job. Unit-test regressions now block
 *      merges; they don't ship silently.
 *
 *   4. `qa/release-gate.ts` no longer references the archived
 *      docs/qa/app-route-inventory.md as a required file — test:routes
 *      regenerates it, so reading the artefact is no longer a gate.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("route-inventory generator — Phase 4", () => {
  const source = read("script/test-routes.ts");

  it("generates docs/qa/app-route-inventory.md from the registry", () => {
    expect(
      source,
      "test:routes must now write the inventory from the registry rather than asserting a hand-written doc matches.",
    ).toMatch(/fs\.writeFileSync\(\s*outputPath/);
    expect(source).toMatch(/docs\/qa/);
    expect(source).toMatch(/page-registry\.ts/);
  });

  it("reports the route count on success and exits non-zero on registry parse failure", () => {
    expect(source).toMatch(/routes\.length === 0/);
    expect(source).toMatch(/process\.exit\(1\)/);
  });

  it("generated inventory file exists and is machine-generated (banner present)", () => {
    const inventory = read("docs/qa/app-route-inventory.md");
    expect(inventory).toMatch(/\*\*Generated\*\*/);
    expect(inventory).toMatch(/test-routes\.ts/);
    expect(inventory).toMatch(/Do not hand-edit/);
  });
});

describe("auth rate-limiter — non-prod loopback exempt (Phase 4)", () => {
  const source = read("server/bootstrap/security-middleware.ts");

  it("defines an isNonProdLoopback helper", () => {
    expect(source).toMatch(/isNonProdLoopback/);
  });

  it("only exempts when NODE_ENV is not production", () => {
    expect(
      source,
      "The loopback exemption must be gated on NODE_ENV !== 'production' so it can never leak to prod.",
    ).toMatch(/process\.env\.NODE_ENV === "production"/);
  });

  it("exempts 127.0.0.1 and ::1", () => {
    expect(source).toMatch(/127\.0\.0\.1/);
    expect(source).toMatch(/::1/);
  });

  it("applies the exemption inside both redis and memory auth rate-limit paths", () => {
    const exemptCalls = source.match(/isNonProdLoopback\(req\)/g);
    expect(exemptCalls, "exemption should be called at least twice (redis + memory paths)").toBeTruthy();
    expect((exemptCalls ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("CI workflows — unit-test job wired as required (Phase 4)", () => {
  const CI_FILES = [
    ".github/workflows/ci.yml",
    ".github/workflows/pr-checks.yml",
  ];
  for (const file of CI_FILES) {
    it(`${file} invokes npm run test in the compile job`, () => {
      const source = read(file);
      expect(
        source,
        `${file} must invoke \`npm run test\` as a required step so unit-test regressions block merges.`,
      ).toMatch(/npm\s+run\s+test\b/);
    });
  }
});
