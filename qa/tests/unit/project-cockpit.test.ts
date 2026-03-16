import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  parseCockpitMode,
  resolveSummaryDeepLink,
  toCockpitModeQuery,
} from "@/lib/project-cockpit";

describe("Project cockpit dual-mode contracts", () => {
  it("renders cockpit command experience and mode toggle in project detail page", () => {
    const source = fs.readFileSync("client/src/pages/project-detail.tsx", "utf8");
    expect(source).toContain("data-testid=\"cockpit-command-header\"");
    expect(source).toContain("data-testid=\"cockpit-mode-toggle\"");
    expect(source).toContain("data-testid=\"cockpit-mode-executive\"");
    expect(source).toContain("data-testid=\"cockpit-mode-execution\"");
    expect(source).toContain("data-testid=\"executive-summary-cards\"");
  });

  it("keeps mode parsing deterministic and defaults to executive", () => {
    expect(parseCockpitMode("execution")).toBe("execution");
    expect(parseCockpitMode("executive")).toBe("executive");
    expect(parseCockpitMode(null)).toBe("executive");
    expect(parseCockpitMode("unexpected")).toBe("executive");
  });

  it("preserves existing query context when switching modes", () => {
    const current = new URLSearchParams("tab=raid&highlightId=42");
    const next = toCockpitModeQuery(current, "execution");
    const parsed = new URLSearchParams(next);
    expect(parsed.get("tab")).toBe("raid");
    expect(parsed.get("highlightId")).toBe("42");
    expect(parsed.get("mode")).toBe("execution");
  });

  it("routes executive summary deep links to the expected execution areas", () => {
    expect(resolveSummaryDeepLink("plan")).toEqual({ section: "delivery", subTab: "task-grid" });
    expect(resolveSummaryDeepLink("procurement")).toEqual({ section: "commercial", subTab: "procurement" });
    expect(resolveSummaryDeepLink("quality")).toEqual({ section: "quality", subTab: "quality" });
    expect(resolveSummaryDeepLink("history")).toEqual({ section: "collaboration", subTab: "history" });
  });

  it("keeps permission-aware rendering guards in execution mode sections", () => {
    const source = fs.readFileSync("client/src/pages/project-detail.tsx", "utf8");
    expect(source).toContain('activeSection === "commercial" && canViewTab.finance');
    expect(source).toContain('activeSection === "engineering" && canViewTab.engineering');
    expect(source).toContain('activeSection === "quality" && canViewTab.quality');
  });
});
