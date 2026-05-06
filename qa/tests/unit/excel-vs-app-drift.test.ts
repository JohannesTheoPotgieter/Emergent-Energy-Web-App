/**
 * Drift detection + per-section RBAC unit tests for the Excel-vs-App
 * routes (`server/routes/excel-vs-app.routes.ts`) and the
 * `getDriftDetail` repository extension. Pure-function logic only —
 * the route handler's full integration coverage runs against a
 * postgres DB.
 *
 * Invariants verified:
 *   1. Classification is correct across all four cases:
 *        - liveValue == snapshotValue, no override        → none
 *        - override present, displayValue == snapshot     → none
 *          (operator's edit happens to match Excel — phantom drift)
 *        - liveValue != snapshotValue, no override        → unverified
 *        - liveValue != snapshotValue, override present   → verified
 *   2. Loose equality (`valuesEqual`) folds "1500" / 1500 /
 *      "1,500.00" together so numeric coercion drift doesn't surface
 *      as a false positive.
 *   3. Per-section RBAC: only roles in DRIFT_RESOLVER_ROLES[section]
 *      can resolve drift on that section.
 */
import { describe, expect, it } from "vitest";
import { valuesEqual } from "../../../server/lib/import/merge-engine";
import { DRIFT_RESOLVER_ROLES } from "@shared/excel-vs-app/contract";

type DriftClass = "none" | "verified" | "unverified";

function classifyDrift(
  liveValue: unknown,
  snapshotValue: unknown,
  overrideValue: unknown,
  hasOverrideEntry: boolean,
): DriftClass {
  const display = hasOverrideEntry ? overrideValue : liveValue;
  if (valuesEqual(display as any, snapshotValue as any)) return "none";
  return hasOverrideEntry ? "verified" : "unverified";
}

describe("Excel-vs-App drift detection", () => {
  it("identical live and snapshot, no override → none", () => {
    expect(classifyDrift("1500.00", "1500.00", null, false)).toBe("none");
  });

  it("loose-equal numeric strings → none", () => {
    expect(classifyDrift("1,500.00", 1500, null, false)).toBe("none");
    expect(classifyDrift(1500, "1500.00", null, false)).toBe("none");
  });

  it("live differs from snapshot, no override → unverified", () => {
    expect(classifyDrift("1700.00", "1500.00", null, false)).toBe("unverified");
  });

  it("live differs from snapshot, override matches snapshot → none (phantom drift)", () => {
    // Operator overrode to a value that happens to match Excel-truth
    // — display value equals snapshot, no real drift to surface.
    expect(classifyDrift("1700.00", "1500.00", "1500.00", true)).toBe("none");
  });

  it("live differs from snapshot, override differs from snapshot → verified", () => {
    expect(classifyDrift("1500.00", "1500.00", "1700.00", true)).toBe("verified");
    expect(classifyDrift("1700.00", "1500.00", "1900.00", true)).toBe("verified");
  });

  it("null vs empty string vs undefined treated as equal", () => {
    expect(classifyDrift(null, "", null, false)).toBe("none");
    expect(classifyDrift("", null, null, false)).toBe("none");
  });

  it("date-string normalisation: ISO vs Excel date → none", () => {
    // valuesEqual normalises strings via lowercase/trim — exact-match
    // ISO strings stay equal; cross-format date comparisons depend on
    // the import engine's normalisation, which writes both sides as
    // ISO once committed. A drift between distinct dates surfaces.
    expect(classifyDrift("2026-04-15", "2026-04-15", null, false)).toBe("none");
    expect(classifyDrift("2026-04-15", "2026-05-01", null, false)).toBe("unverified");
  });

  it("boolean tracked field: true vs string 'true' loose-equal", () => {
    // valuesEqual normalises booleans to 'true'/'false' strings.
    expect(classifyDrift(true, "true", null, false)).toBe("none");
    expect(classifyDrift(false, true, null, false)).toBe("unverified");
  });
});

describe("Excel-vs-App per-section RBAC", () => {
  const cannotResolveAny: readonly string[] = [
    "ENGINEER",
    "PROJECT_DEVELOPER",
    "ACCOUNTANT",
    "HSE_MANAGER",
    "SSEG_MANAGER",
    "KEY_ACCOUNTS_MANAGER",
    "QUALITY_MANAGER",
    "ENGINEERING_MANAGER",
    "CONSTRUCTION_MANAGER",
    "PROJECT_MANAGER_SITE",
  ];

  function actorCanResolveSection(role: string, section: keyof typeof DRIFT_RESOLVER_ROLES): boolean {
    const allowed = DRIFT_RESOLVER_ROLES[section] as readonly string[];
    return allowed.includes(role);
  }

  it("PLAN: PROGRAM_MANAGER, COO_ADMIN, CEO_ADMIN allowed", () => {
    expect(actorCanResolveSection("PROGRAM_MANAGER", "PLAN")).toBe(true);
    expect(actorCanResolveSection("COO_ADMIN", "PLAN")).toBe(true);
    expect(actorCanResolveSection("CEO_ADMIN", "PLAN")).toBe(true);
  });

  it("PLAN: PROGRAM_FINANCE_MANAGER, CCO, CFO, ENGINEER NOT allowed", () => {
    expect(actorCanResolveSection("PROGRAM_FINANCE_MANAGER", "PLAN")).toBe(false);
    expect(actorCanResolveSection("CCO", "PLAN")).toBe(false);
    expect(actorCanResolveSection("CFO", "PLAN")).toBe(false);
    expect(actorCanResolveSection("ENGINEER", "PLAN")).toBe(false);
  });

  it("REVENUE: PROGRAM_FINANCE_MANAGER, CCO, CFO, COO_ADMIN, CEO_ADMIN allowed", () => {
    for (const r of ["PROGRAM_FINANCE_MANAGER", "CCO", "CFO", "COO_ADMIN", "CEO_ADMIN"] as const) {
      expect(actorCanResolveSection(r, "REVENUE")).toBe(true);
    }
  });

  it("REVENUE: PROGRAM_MANAGER NOT allowed (PM is plan-only)", () => {
    expect(actorCanResolveSection("PROGRAM_MANAGER", "REVENUE")).toBe(false);
  });

  it("EXPENDITURE: PROGRAM_FINANCE_MANAGER, CFO, COO_ADMIN, CEO_ADMIN allowed", () => {
    for (const r of ["PROGRAM_FINANCE_MANAGER", "CFO", "COO_ADMIN", "CEO_ADMIN"] as const) {
      expect(actorCanResolveSection(r, "EXPENDITURE")).toBe(true);
    }
  });

  it("EXPENDITURE: CCO NOT allowed", () => {
    // CCO can resolve revenue drift but expenditure stays with finance.
    expect(actorCanResolveSection("CCO", "EXPENDITURE")).toBe(false);
  });

  it("non-resolver roles cannot resolve any section", () => {
    for (const role of cannotResolveAny) {
      // PROJECT_MANAGER_SITE is in the role list but doesn't appear
      // in any section's resolver list — the diff page can be viewed
      // by them, but resolution stays with the section's authority.
      expect(actorCanResolveSection(role, "PLAN")).toBe(false);
      expect(actorCanResolveSection(role, "REVENUE")).toBe(false);
      expect(actorCanResolveSection(role, "EXPENDITURE")).toBe(false);
    }
  });

  it("admins (COO_ADMIN, CEO_ADMIN) can resolve every section", () => {
    for (const role of ["COO_ADMIN", "CEO_ADMIN"] as const) {
      expect(actorCanResolveSection(role, "PLAN")).toBe(true);
      expect(actorCanResolveSection(role, "REVENUE")).toBe(true);
      expect(actorCanResolveSection(role, "EXPENDITURE")).toBe(true);
    }
  });
});

describe("Excel-vs-App PLAN owner exception", () => {
  // Mirrors the route logic: section check first, then PLAN-only owner
  // exception, then deny. Pure function so the policy can be pinned
  // without DB access.
  function canResolvePlanRowAsOwner(
    role: string | undefined,
    actorId: number | null,
    rowOwnerUserId: number | null,
  ): boolean {
    if (role && (DRIFT_RESOLVER_ROLES.PLAN as readonly string[]).includes(role)) return true;
    if (actorId != null && rowOwnerUserId === actorId) return true;
    return false;
  }

  it("ENGINEER who owns the work item can resolve plan drift on it", () => {
    expect(canResolvePlanRowAsOwner("ENGINEER", 7, 7)).toBe(true);
  });

  it("ENGINEER who does NOT own the work item cannot resolve", () => {
    expect(canResolvePlanRowAsOwner("ENGINEER", 7, 8)).toBe(false);
  });

  it("PROGRAM_MANAGER can resolve any plan row regardless of owner", () => {
    expect(canResolvePlanRowAsOwner("PROGRAM_MANAGER", 7, 999)).toBe(true);
  });

  it("Owner exception only fires when row has a non-null ownerUserId", () => {
    expect(canResolvePlanRowAsOwner("ENGINEER", 7, null)).toBe(false);
  });

  it("actorId null disables owner exception", () => {
    expect(canResolvePlanRowAsOwner("ENGINEER", null, 7)).toBe(false);
  });
});
