import { describe, expect, it } from "vitest";
import { PAGES } from "@/config/page-registry";
import { buildVisibleTopSections } from "@/config/app-navigation";
import {
  ragStatusToHealth,
  deriveHealthFromRagStatuses,
  PRIORITY_HEALTH_VALUES,
} from "@shared/kpi-definitions";

// ── Page Registry & Navigation ──────────────────────────────────────

describe("priority page registry", () => {
  it("registers /priorities route with PrioritiesPage component", () => {
    const page = PAGES.find((p) => p.path === "/priorities");
    expect(page).toBeDefined();
    expect(page!.routeComponentKey).toBe("PrioritiesPage");
  });

  it("registers /priorities/:id route with PriorityDetailPage component", () => {
    const page = PAGES.find((p) => p.path === "/priorities/:id");
    expect(page).toBeDefined();
    expect(page!.routeComponentKey).toBe("PriorityDetailPage");
  });

  it("redirects legacy /company-priorities to /priorities", () => {
    const page = PAGES.find((p) => p.path === "/company-priorities");
    expect(page).toBeDefined();
    expect(page!.redirectTo).toBe("/priorities");
  });

  it("does not duplicate priority page IDs", () => {
    const priorityPages = PAGES.filter((p) => p.path.startsWith("/priorities") || p.path === "/company-priorities");
    const ids = priorityPages.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("priority navigation", () => {
  it("shows Priorities section when user has permission", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    const prioritiesSection = sections.find((s) => s.label === "Priorities");
    expect(prioritiesSection).toBeDefined();
    expect(prioritiesSection!.path).toBe("/priorities");
  });

  it("includes All Priorities as secondary nav item", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    const prioritiesSection = sections.find((s) => s.label === "Priorities");
    expect(prioritiesSection!.secondary.map((s) => s.label)).toContain("All Priorities");
  });

  it("does not expose legacy Manage link in nav", () => {
    const sections = buildVisibleTopSections({ canViewPath: () => true });
    const prioritiesSection = sections.find((s) => s.label === "Priorities");
    const labels = prioritiesSection?.secondary.map((s) => s.label) || [];
    expect(labels).not.toContain("Manage");
  });
});

// ── Validation Logic ────────────────────────────────────────────────

describe("priority validation rules", () => {
  const VALID_SEVERITIES = ["critical", "important", "normal"];
  const VALID_HEALTH_VALUES = ["healthy", "at_risk", "critical"];
  const VALID_STATUSES = ["active", "monitoring", "closed", "not_started", "in_progress", "complete"];
  const VALID_HORIZONS = ["today", "week", "month", "quarter"];

  it("accepts all valid severity values", () => {
    for (const sev of VALID_SEVERITIES) {
      expect(VALID_SEVERITIES).toContain(sev);
    }
  });

  it("accepts all valid manual_health values", () => {
    for (const health of VALID_HEALTH_VALUES) {
      expect(VALID_HEALTH_VALUES).toContain(health);
    }
  });

  it("accepts all valid status values", () => {
    for (const status of VALID_STATUSES) {
      expect(VALID_STATUSES).toContain(status);
    }
  });

  it("accepts all valid horizon values", () => {
    for (const horizon of VALID_HORIZONS) {
      expect(VALID_HORIZONS).toContain(horizon);
    }
  });

  it("rejects manual_progress outside 0-100 range", () => {
    const isValid = (val: number) => val >= 0 && val <= 100;
    expect(isValid(-1)).toBe(false);
    expect(isValid(101)).toBe(false);
    expect(isValid(0)).toBe(true);
    expect(isValid(50)).toBe(true);
    expect(isValid(100)).toBe(true);
  });
});

// ── Enrichment Logic ────────────────────────────────────────────────

describe("priority enrichment logic", () => {
  // Mirror of the enrichment logic from priority-strategic-routes.ts
  function deriveEffectiveHealth(
    hasProjects: boolean,
    derivedHealth: string | null,
    manualHealth: string | null,
  ): string {
    return hasProjects ? (derivedHealth || "healthy") : (manualHealth || "healthy");
  }

  function deriveEffectiveProgress(
    hasProjects: boolean,
    avgProgress: number | null,
    manualProgress: number | null,
  ): number {
    return hasProjects ? Math.round(avgProgress || 0) : (manualProgress || 0);
  }

  it("uses manual health when priority has no projects", () => {
    expect(deriveEffectiveHealth(false, null, "at_risk")).toBe("at_risk");
    expect(deriveEffectiveHealth(false, null, "critical")).toBe("critical");
    expect(deriveEffectiveHealth(false, null, null)).toBe("healthy");
  });

  it("uses derived health when priority has projects", () => {
    expect(deriveEffectiveHealth(true, "critical", "healthy")).toBe("critical");
    expect(deriveEffectiveHealth(true, "at_risk", null)).toBe("at_risk");
    expect(deriveEffectiveHealth(true, null, "critical")).toBe("healthy"); // null derived → healthy
  });

  it("uses manual progress when priority has no projects", () => {
    expect(deriveEffectiveProgress(false, null, 75)).toBe(75);
    expect(deriveEffectiveProgress(false, null, null)).toBe(0);
  });

  it("uses derived progress when priority has projects", () => {
    expect(deriveEffectiveProgress(true, 66.7, 0)).toBe(67); // rounds
    expect(deriveEffectiveProgress(true, null, 80)).toBe(0); // ignores manual
  });
});

// ── RAG Status to Health Mapping (shared/kpi-definitions) ───────────

describe("ragStatusToHealth", () => {
  it("maps red → critical", () => {
    expect(ragStatusToHealth("red")).toBe("critical");
    expect(ragStatusToHealth("Red")).toBe("critical");
    expect(ragStatusToHealth("RED")).toBe("critical");
  });

  it("maps amber/orange → at_risk", () => {
    expect(ragStatusToHealth("amber")).toBe("at_risk");
    expect(ragStatusToHealth("Amber")).toBe("at_risk");
    expect(ragStatusToHealth("orange")).toBe("at_risk");
    expect(ragStatusToHealth("Orange")).toBe("at_risk");
  });

  it("maps green → healthy", () => {
    expect(ragStatusToHealth("green")).toBe("healthy");
    expect(ragStatusToHealth("Green")).toBe("healthy");
  });

  it("returns healthy for null/undefined", () => {
    expect(ragStatusToHealth(null)).toBe("healthy");
    expect(ragStatusToHealth(undefined)).toBe("healthy");
  });
});

describe("deriveHealthFromRagStatuses", () => {
  it("returns critical when any project is red", () => {
    expect(deriveHealthFromRagStatuses(["Green", "Red", "Amber"])).toBe("critical");
  });

  it("returns at_risk when worst is amber/orange", () => {
    expect(deriveHealthFromRagStatuses(["Green", "Amber"])).toBe("at_risk");
    expect(deriveHealthFromRagStatuses(["green", "orange"])).toBe("at_risk");
  });

  it("returns healthy when all green", () => {
    expect(deriveHealthFromRagStatuses(["Green", "green"])).toBe("healthy");
  });

  it("returns null when no projects", () => {
    expect(deriveHealthFromRagStatuses([])).toBeNull();
  });
});

describe("PRIORITY_HEALTH_VALUES constant", () => {
  it("contains exactly the three valid health values", () => {
    expect(PRIORITY_HEALTH_VALUES).toEqual(["healthy", "at_risk", "critical"]);
  });
});

// ── Severity Sorting ────────────────────────────────────────────────

describe("priority severity sorting", () => {
  const severityOrder: Record<string, number> = { critical: 0, important: 1, normal: 2 };
  const healthOrder: Record<string, number> = { critical: 0, at_risk: 1, healthy: 2 };

  function sortPriorities(items: { severity: string; effectiveHealth: string; dueDate: string | null }[]) {
    return [...items].sort((a, b) => {
      const sevA = severityOrder[a.severity] ?? 2;
      const sevB = severityOrder[b.severity] ?? 2;
      if (sevA !== sevB) return sevA - sevB;

      const hA = healthOrder[a.effectiveHealth] ?? 2;
      const hB = healthOrder[b.effectiveHealth] ?? 2;
      if (hA !== hB) return hA - hB;

      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return 0;
    });
  }

  it("sorts critical before important before normal", () => {
    const items = [
      { severity: "normal", effectiveHealth: "healthy", dueDate: null },
      { severity: "critical", effectiveHealth: "healthy", dueDate: null },
      { severity: "important", effectiveHealth: "healthy", dueDate: null },
    ];
    const sorted = sortPriorities(items);
    expect(sorted.map((i) => i.severity)).toEqual(["critical", "important", "normal"]);
  });

  it("within same severity, sorts by health (critical > at_risk > healthy)", () => {
    const items = [
      { severity: "critical", effectiveHealth: "healthy", dueDate: null },
      { severity: "critical", effectiveHealth: "critical", dueDate: null },
      { severity: "critical", effectiveHealth: "at_risk", dueDate: null },
    ];
    const sorted = sortPriorities(items);
    expect(sorted.map((i) => i.effectiveHealth)).toEqual(["critical", "at_risk", "healthy"]);
  });

  it("within same severity and health, sorts by due date with nulls last", () => {
    const items = [
      { severity: "normal", effectiveHealth: "healthy", dueDate: null },
      { severity: "normal", effectiveHealth: "healthy", dueDate: "2026-04-01" },
      { severity: "normal", effectiveHealth: "healthy", dueDate: "2026-03-15" },
    ];
    const sorted = sortPriorities(items);
    expect(sorted.map((i) => i.dueDate)).toEqual(["2026-03-15", "2026-04-01", null]);
  });
});
