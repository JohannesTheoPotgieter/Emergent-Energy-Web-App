/**
 * Task 1.1 — NCR legacy deep-link banner reacts to route changes.
 *
 * The banner derived `ncrId` from `window.location.search` inside a
 * `useMemo` with an empty dependency array, evaluated once while the
 * component stayed mounted — so clicking an NCR row
 * (`setLocation('/quality?ncr=<id>')`) never updated it. The fix reads the
 * router's reactive search string (`useSearch` from wouter) and tracks
 * dismissal per-id so a new deep link re-shows the banner.
 *
 * Source-contract test (matching quality-ui-consistency.test.ts): pins the
 * reactive source and guards against the one-time window.location read
 * returning.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = fs.readFileSync(
  path.join(process.cwd(), "client/src/components/quality/NcrLegacyDeepLinkBanner.tsx"),
  "utf8",
);

describe("NcrLegacyDeepLinkBanner reactivity", () => {
  it("derives the id from the router's reactive search string", () => {
    expect(SOURCE).toContain('import { useSearch } from "wouter"');
    expect(SOURCE).toContain("const search = useSearch();");
    expect(SOURCE).toContain("new URLSearchParams(search)");
  });

  it("no longer reads window.location.search once in a useMemo", () => {
    // Strip // comments so the explanatory comment describing the old bug
    // doesn't trip the regex.
    const codeOnly = SOURCE.replace(/^\s*\/\/.*$/gm, "").replace(/\/\/[^\n]*/g, "");
    expect(codeOnly).not.toContain("window.location.search");
    expect(codeOnly).not.toMatch(/useMemo\([^)]*\},\s*\[\]\)/);
  });

  it("tracks dismissal per-id so a new deep link re-shows the banner", () => {
    expect(SOURCE).toContain("dismissedId");
    expect(SOURCE).toContain("setDismissedId(ncrId)");
    expect(SOURCE).toContain("dismissedId === ncrId");
  });

  it("still fetches the NCR only when an id is present and not dismissed", () => {
    expect(SOURCE).toContain("enabled: ncrId !== null && !dismissed");
  });
});
