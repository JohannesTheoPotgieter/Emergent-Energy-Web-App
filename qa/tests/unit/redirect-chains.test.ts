import { describe, expect, it } from "vitest";
import {
  PAGE_REGISTRY,
  LEGACY_REDIRECTS,
} from "@/config/page-registry";

describe("redirect chain elimination", () => {
  // ── No multi-hop chains ──

  it("no LEGACY_REDIRECTS target is itself a redirect source", () => {
    const sources = new Set(LEGACY_REDIRECTS.map((r) => r.path));

    for (const redirect of LEGACY_REDIRECTS) {
      const cleanTarget = redirect.redirectTo.split("?")[0];
      expect(
        sources.has(cleanTarget),
        `Multi-hop chain: ${redirect.path} → ${redirect.redirectTo}, but ${cleanTarget} is also a redirect source`,
      ).toBe(false);
    }
  });

  it("no LEGACY_REDIRECTS target points to a PAGE_REGISTRY alias", () => {
    const aliasTargets = new Set(
      PAGE_REGISTRY.filter((p) => p.type === "alias").map((p) => p.path),
    );

    for (const redirect of LEGACY_REDIRECTS) {
      const cleanTarget = redirect.redirectTo.split("?")[0];
      expect(
        aliasTargets.has(cleanTarget),
        `Chain via alias: ${redirect.path} → ${cleanTarget}, which is a PAGE_REGISTRY alias`,
      ).toBe(false);
    }
  });

  // ── All redirect targets resolve to real routes ──

  it("every LEGACY_REDIRECTS target resolves to a real PAGE_REGISTRY route or root", () => {
    const registryPaths = new Set(PAGE_REGISTRY.map((p) => p.path));
    // "/" is handled directly in App.tsx as HomePage
    registryPaths.add("/");

    for (const redirect of LEGACY_REDIRECTS) {
      const cleanTarget = redirect.redirectTo.split("?")[0];
      expect(
        registryPaths.has(cleanTarget),
        `Dangling redirect: ${redirect.path} → ${redirect.redirectTo} (${cleanTarget} not in PAGE_REGISTRY)`,
      ).toBe(true);
    }
  });

  it("every PAGE_REGISTRY alias redirectTo resolves to a real page or root", () => {
    const realPages = new Set(
      PAGE_REGISTRY.filter((p) => p.routeComponentKey && !p.redirectTo).map((p) => p.path),
    );
    realPages.add("/");

    const aliases = PAGE_REGISTRY.filter((p) => p.type === "alias" && p.redirectTo);
    for (const alias of aliases) {
      const cleanTarget = alias.redirectTo!.split("?")[0];
      expect(
        realPages.has(cleanTarget),
        `Dangling alias: ${alias.path} → ${alias.redirectTo} (${cleanTarget} is not a real page)`,
      ).toBe(true);
    }
  });

  // ── Specific known redirects ──

  it("/dashboard redirects to /execution-board (canonical company surface)", () => {
    // Updated 2026-05-06 (EE-QA-014): /dashboard previously redirected to /gates,
    // which surprised users who expected a dashboard. /gates remains reachable
    // from the sidebar — only the legacy redirect target moved.
    const entry = LEGACY_REDIRECTS.find((r) => r.path === "/dashboard");
    expect(entry).toBeDefined();
    expect(entry!.redirectTo).toBe("/execution-board");
  });

  // ── Structural invariants ──

  it("all LEGACY_REDIRECTS entries have valid path and redirectTo fields", () => {
    for (const redirect of LEGACY_REDIRECTS) {
      expect(redirect.path).toBeTruthy();
      expect(redirect.path.startsWith("/")).toBe(true);
      expect(redirect.redirectTo).toBeTruthy();
      expect(redirect.redirectTo.startsWith("/")).toBe(true);
    }
  });
});
