import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("redirect chain elimination", () => {
  const registrySource = read("client/src/config/page-registry.ts");
  const appSource = read("client/src/App.tsx");

  // ── Multi-hop chains collapsed ──

  it("/dashboard redirects directly to /gates (not /execution-board)", () => {
    // Find the LEGACY_REDIRECTS entry for /dashboard
    expect(registrySource).toContain('{ path: "/dashboard", redirectTo: "/gates" }');
    expect(registrySource).not.toContain('{ path: "/dashboard", redirectTo: "/execution-board" }');
  });

  it("/pm-dashboard is a live page (not a redirect)", () => {
    // pm-dashboard is now a live page with its own component, not a redirect
    expect(registrySource).toContain('id: "pmDashboard", path: "/pm-dashboard"');
    expect(registrySource).toContain('routeComponentKey: "PMDashboard"');
  });

  it("PM role fallback resolves home path via ROLE_LANDING_PAGE", () => {
    expect(appSource).toContain('ROLE_LANDING_PAGE[effectiveRole] || "/"');
  });

  it("collapse comments document the original chain", () => {
    expect(registrySource).toContain("Legacy: /dashboard → /execution-board → /gates. Collapsed to direct.");
  });

  // ── No remaining multi-hop chains ──

  it("no LEGACY_REDIRECTS target is itself a redirect source", () => {
    // Extract all redirect targets
    const legacyRedirects = registrySource
      .split("LEGACY_REDIRECTS")[1]
      ?.split("];")[0] || "";

    const targetMatches = legacyRedirects.matchAll(/redirectTo:\s*"([^"]+)"/g);
    const targets = [...targetMatches].map(m => m[1]);

    const sourceMatches = legacyRedirects.matchAll(/path:\s*"([^"]+)"/g);
    const sources = new Set([...sourceMatches].map(m => m[1]));

    for (const target of targets) {
      const cleanTarget = target.split("?")[0];
      if (sources.has(cleanTarget)) {
        throw new Error(`Multi-hop chain: ${cleanTarget} is both a redirect target and source`);
      }
    }
  });

  // ── PageRegistryEntry type field ──

  it("PageRegistryEntry interface includes type: alias | page", () => {
    expect(registrySource).toContain('type?: "page" | "alias"');
  });

  it("all PAGE_REGISTRY entries with redirectTo are marked type: alias", () => {
    // Extract PAGE_REGISTRY block
    const registryBlock = registrySource.split("export const PAGE_REGISTRY")[1] || "";
    // Find entries with redirectTo
    const lines = registryBlock.split("\n").filter(l => l.includes("redirectTo:"));
    for (const line of lines) {
      expect(line).toContain('type: "alias"');
    }
  });

  // ── Redirect chain checker script ──

  it("check-redirect-chains script exists", () => {
    const script = read("scripts/check-redirect-chains.ts");
    expect(script).toContain("LEGACY_REDIRECTS");
    expect(script).toContain("PAGE_REGISTRY");
    expect(script).toContain("multi-hop");
  });

  it("package.json has check:redirects script", () => {
    const pkg = read("package.json");
    expect(pkg).toContain('"check:redirects"');
    expect(pkg).toContain("check-redirect-chains.ts");
  });
});
