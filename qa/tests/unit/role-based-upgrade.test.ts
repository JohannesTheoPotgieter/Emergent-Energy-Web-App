/**
 * Role-Based UX Upgrade — Comprehensive Test Suite
 *
 * Tests:
 * 1. Role alias mapping (legacy → lens)
 * 2. Permission resolution through aliases
 * 3. Lens profile defaults
 * 4. Module registry completeness
 * 5. COO super admin access
 * 6. Legacy role preservation
 * 7. Route stability
 * 8. Navigation continuity
 */

import { describe, expect, it } from "vitest";
import {
  ROLE_TO_LENS_MAP,
  resolveUserLens,
  isSuperAdmin,
  LENS_ROLES,
  LENS_ROLE_LABELS,
  DEFAULT_LENS_PROFILES,
  CANONICAL_MODULES,
  CANONICAL_MODULE_LABELS,
  MODULE_TO_NAV_GROUPS,
  LIFECYCLE_GATES,
} from "@shared/schema/role-based-upgrade";
import {
  COMPANY_ROLES,
  COMPANY_ROLE_LABELS,
  ROLE_PERMISSION_ALIASES,
  normalizeRoleForPermissions,
  checkPermission,
  ENTITY_PERMISSION_DEFAULTS,
  ADMIN_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  WORKSTREAM_VISIBILITY_DEFAULTS,
  ROLE_DEPARTMENT_MAP,
} from "@shared/schema/users";
import { PAGE_REGISTRY, LEGACY_REDIRECTS, ROLE_LANDING_PAGE } from "@/config/page-registry";

// ===================== ROLE ALIAS MAPPING =====================

describe("Role alias mapping (legacy → lens)", () => {
  it("maps all 16 company roles to a lens role", () => {
    for (const role of COMPANY_ROLES) {
      const lens = resolveUserLens(role);
      expect(LENS_ROLES).toContain(lens);
    }
  });

  it("maps COO_ADMIN to COO_SUPER_ADMIN", () => {
    expect(resolveUserLens("COO_ADMIN")).toBe("COO_SUPER_ADMIN");
  });

  it("maps CEO_ADMIN to CEO", () => {
    expect(resolveUserLens("CEO_ADMIN")).toBe("CEO");
  });

  it("maps PROJECT_MANAGER_SITE to PROJECT_MANAGER", () => {
    expect(resolveUserLens("PROJECT_MANAGER_SITE")).toBe("PROJECT_MANAGER");
  });

  it("maps CCO to HEAD_OF_PROJECT_DEVELOPMENT", () => {
    expect(resolveUserLens("CCO")).toBe("HEAD_OF_PROJECT_DEVELOPMENT");
  });

  it("maps KEY_ACCOUNTS_MANAGER to HEAD_OF_PROJECT_DEVELOPMENT", () => {
    expect(resolveUserLens("KEY_ACCOUNTS_MANAGER")).toBe("HEAD_OF_PROJECT_DEVELOPMENT");
  });

  it("maps QUALITY_MANAGER to its own QUALITY_MANAGER lens", () => {
    expect(resolveUserLens("QUALITY_MANAGER")).toBe("QUALITY_MANAGER");
  });

  it("maps HSE_MANAGER directly to HSE_MANAGER lens", () => {
    expect(resolveUserLens("HSE_MANAGER")).toBe("HSE_MANAGER");
  });

  it("maps SSEG_MANAGER directly to SSEG_MANAGER lens", () => {
    expect(resolveUserLens("SSEG_MANAGER")).toBe("SSEG_MANAGER");
  });

  it("maps ENGINEERING_MANAGER to ENGINEER lens", () => {
    expect(resolveUserLens("ENGINEERING_MANAGER")).toBe("ENGINEER");
  });

  it("maps ACCOUNTANT to PROGRAM_FINANCE_MANAGER lens", () => {
    expect(resolveUserLens("ACCOUNTANT")).toBe("PROGRAM_FINANCE_MANAGER");
  });

  it("falls back to ENGINEER for unknown roles", () => {
    expect(resolveUserLens("UNKNOWN_ROLE")).toBe("ENGINEER");
    expect(resolveUserLens(null)).toBe("ENGINEER");
    expect(resolveUserLens(undefined)).toBe("ENGINEER");
  });

  it("preserves all original roles and adds HSE_MANAGER + SSEG_MANAGER", () => {
    expect(COMPANY_ROLES).toHaveLength(16);
    // Original 14
    expect(COMPANY_ROLES).toContain("COO_ADMIN");
    expect(COMPANY_ROLES).toContain("CEO_ADMIN");
    expect(COMPANY_ROLES).toContain("CCO");
    expect(COMPANY_ROLES).toContain("PROJECT_MANAGER_SITE");
    expect(COMPANY_ROLES).toContain("QUALITY_MANAGER");
    // New 2
    expect(COMPANY_ROLES).toContain("HSE_MANAGER");
    expect(COMPANY_ROLES).toContain("SSEG_MANAGER");
  });
});

// ===================== COO SUPER ADMIN =====================

describe("COO super admin detection", () => {
  it("identifies COO_ADMIN as super admin", () => {
    expect(isSuperAdmin("COO_ADMIN")).toBe(true);
  });

  it("does not identify CEO_ADMIN as super admin", () => {
    expect(isSuperAdmin("CEO_ADMIN")).toBe(false);
  });

  it("does not identify regular roles as super admin", () => {
    expect(isSuperAdmin("ENGINEER")).toBe(false);
    expect(isSuperAdmin("PROJECT_MANAGER_SITE")).toBe(false);
    expect(isSuperAdmin("CFO")).toBe(false);
    expect(isSuperAdmin(null)).toBe(false);
  });
});

// ===================== PERMISSION RESOLUTION THROUGH ALIASES =====================

describe("Permission resolution through new role aliases", () => {
  it("COO_SUPER_ADMIN resolves to COO_ADMIN for permission checks", () => {
    expect(normalizeRoleForPermissions("COO_SUPER_ADMIN")).toBe("COO_ADMIN");
  });

  it("CEO resolves to CEO_ADMIN for permission checks", () => {
    expect(normalizeRoleForPermissions("CEO")).toBe("CEO_ADMIN");
  });

  it("HEAD_OF_PROJECT_DEVELOPMENT resolves to CCO for permission checks", () => {
    expect(normalizeRoleForPermissions("HEAD_OF_PROJECT_DEVELOPMENT")).toBe("CCO");
  });

  it("HSE_MANAGER is a real role — no aliasing needed", () => {
    expect(normalizeRoleForPermissions("HSE_MANAGER")).toBe("HSE_MANAGER");
  });

  it("SSEG_MANAGER is a real role — no aliasing needed", () => {
    expect(normalizeRoleForPermissions("SSEG_MANAGER")).toBe("SSEG_MANAGER");
  });

  it("PROJECT_MANAGER resolves to PROJECT_MANAGER_SITE for permission checks", () => {
    expect(normalizeRoleForPermissions("PROJECT_MANAGER")).toBe("PROJECT_MANAGER_SITE");
  });

  it("existing aliases still work", () => {
    expect(normalizeRoleForPermissions("admin")).toBe("COO_ADMIN");
    expect(normalizeRoleForPermissions("COO")).toBe("COO_ADMIN");
  });

  it("COO_ADMIN has view permission on all entities", () => {
    for (const rule of ENTITY_PERMISSION_DEFAULTS) {
      expect(
        checkPermission("COO_ADMIN", rule.entity, "view"),
        `COO_ADMIN should have view access to ${rule.entity}`
      ).toBe(true);
    }
  });

  it("COO_ADMIN has edit permission on all entities", () => {
    for (const rule of ENTITY_PERMISSION_DEFAULTS) {
      expect(
        checkPermission("COO_ADMIN", rule.entity, "edit"),
        `COO_ADMIN should have edit access to ${rule.entity}`
      ).toBe(true);
    }
  });

  it("COO_ADMIN has override permission on all entities", () => {
    for (const rule of ENTITY_PERMISSION_DEFAULTS) {
      expect(
        checkPermission("COO_ADMIN", rule.entity, "override"),
        `COO_ADMIN should have override access to ${rule.entity}`
      ).toBe(true);
    }
  });
});

// ===================== LENS PROFILES =====================

describe("Lens profile defaults", () => {
  it("has a profile for every lens role", () => {
    for (const lens of LENS_ROLES) {
      const profile = DEFAULT_LENS_PROFILES.find(p => p.lensRole === lens);
      expect(profile, `Missing profile for ${lens}`).toBeDefined();
    }
  });

  it("every profile has a valid landing page", () => {
    for (const profile of DEFAULT_LENS_PROFILES) {
      expect(profile.landingPage).toBeTruthy();
      expect(profile.landingPage.startsWith("/")).toBe(true);
    }
  });

  it("every profile has at least one allowed module", () => {
    for (const profile of DEFAULT_LENS_PROFILES) {
      expect(profile.allowedModules.length).toBeGreaterThan(0);
    }
  });

  it("COO_SUPER_ADMIN has all modules", () => {
    const cooProfile = DEFAULT_LENS_PROFILES.find(p => p.lensRole === "COO_SUPER_ADMIN")!;
    expect(cooProfile.allowedModules).toEqual(expect.arrayContaining([...CANONICAL_MODULES]));
  });

  it("every profile has quick actions with valid paths", () => {
    for (const profile of DEFAULT_LENS_PROFILES) {
      expect(profile.quickActions.length).toBeGreaterThan(0);
      for (const action of profile.quickActions) {
        expect(action.path.startsWith("/")).toBe(true);
        expect(action.label).toBeTruthy();
      }
    }
  });

  it("every allowed module is a valid canonical module", () => {
    for (const profile of DEFAULT_LENS_PROFILES) {
      for (const mod of profile.allowedModules) {
        expect(CANONICAL_MODULES).toContain(mod);
      }
    }
  });
});

// ===================== MODULE REGISTRY =====================

describe("Canonical module model", () => {
  it("has exactly 12 canonical modules", () => {
    expect(CANONICAL_MODULES).toHaveLength(12);
  });

  it("has labels for all modules", () => {
    for (const mod of CANONICAL_MODULES) {
      expect(CANONICAL_MODULE_LABELS[mod]).toBeTruthy();
    }
  });

  it("has nav group mappings for all modules", () => {
    for (const mod of CANONICAL_MODULES) {
      expect(MODULE_TO_NAV_GROUPS[mod]).toBeDefined();
      expect(Array.isArray(MODULE_TO_NAV_GROUPS[mod])).toBe(true);
    }
  });
});

// ===================== LENS ROLE LABELS =====================

describe("Lens role labels", () => {
  it("has labels for all 13 lens roles", () => {
    expect(LENS_ROLES).toHaveLength(13);
    for (const lens of LENS_ROLES) {
      expect(LENS_ROLE_LABELS[lens]).toBeTruthy();
    }
  });
});

// ===================== LEGACY PRESERVATION =====================

describe("Legacy role and route preservation", () => {
  it("COMPANY_ROLES array includes all original + new roles", () => {
    const expected = [
      'COO_ADMIN', 'CEO_ADMIN', 'CCO', 'CFO',
      'PROGRAM_MANAGER', 'PROGRAM_FINANCE_MANAGER',
      'CONSTRUCTION_MANAGER', 'QUALITY_MANAGER', 'ENGINEERING_MANAGER',
      'KEY_ACCOUNTS_MANAGER', 'ACCOUNTANT', 'ENGINEER',
      'PROJECT_MANAGER_SITE', 'PROJECT_DEVELOPER',
      'HSE_MANAGER', 'SSEG_MANAGER',
    ];
    expect([...COMPANY_ROLES]).toEqual(expected);
  });

  it("COMPANY_ROLE_LABELS has labels for all roles", () => {
    for (const role of COMPANY_ROLES) {
      expect(COMPANY_ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it("ADMIN_ROLES still includes COO_ADMIN and CEO_ADMIN", () => {
    expect(ADMIN_ROLES).toContain("COO_ADMIN");
    expect(ADMIN_ROLES).toContain("CEO_ADMIN");
  });

  it("DEFAULT_ROLE_PERMISSIONS has entries for all 16 roles", () => {
    expect(DEFAULT_ROLE_PERMISSIONS).toHaveLength(16);
    for (const role of COMPANY_ROLES) {
      const perm = (DEFAULT_ROLE_PERMISSIONS as Array<{ role: string }>).find((p) => p.role === role);
      expect(perm, `Missing permission entry for ${role}`).toBeDefined();
    }
  });

  it("WORKSTREAM_VISIBILITY_DEFAULTS has entries for all roles", () => {
    for (const role of COMPANY_ROLES) {
      expect(WORKSTREAM_VISIBILITY_DEFAULTS[role], `Missing visibility for ${role}`).toBeDefined();
    }
  });

  it("ROLE_DEPARTMENT_MAP maps all roles", () => {
    for (const role of COMPANY_ROLES) {
      expect(ROLE_DEPARTMENT_MAP[role], `Missing department for ${role}`).toBeDefined();
    }
  });

  it("PAGE_REGISTRY has not lost any entries", () => {
    expect(PAGE_REGISTRY.length).toBeGreaterThanOrEqual(80);
  });

  it("LEGACY_REDIRECTS are preserved", () => {
    expect(LEGACY_REDIRECTS.length).toBeGreaterThanOrEqual(13);
    const paths = LEGACY_REDIRECTS.map(r => r.path);
    expect(paths).toContain("/dashboard");
    expect(paths).toContain("/my-tool");
    // /execution-board is now a live page in PAGE_REGISTRY, not a legacy redirect
    expect(paths).not.toContain("/command-center");
  });

  it("ROLE_LANDING_PAGE still maps finance roles to /cashflow", () => {
    expect(ROLE_LANDING_PAGE["CFO"]).toBe("/cashflow");
    expect(ROLE_LANDING_PAGE["PROGRAM_FINANCE_MANAGER"]).toBe("/cashflow");
    expect(ROLE_LANDING_PAGE["ACCOUNTANT"]).toBe("/cashflow");
  });

  it("ROLE_LANDING_PAGE still maps engineering roles to /engineering", () => {
    expect(ROLE_LANDING_PAGE["ENGINEERING_MANAGER"]).toBe("/engineering");
    expect(ROLE_LANDING_PAGE["ENGINEER"]).toBe("/engineering");
  });

  it("ROLE_LANDING_PAGE still maps quality to /quality", () => {
    expect(ROLE_LANDING_PAGE["QUALITY_MANAGER"]).toBe("/quality");
  });
});

// ===================== ROUTE STABILITY =====================

describe("Route stability", () => {
  // Note: "/" is handled directly in App.tsx as HomePage, not via PAGE_REGISTRY
  const CRITICAL_ROUTES = [
    "/projects", "/cashflow", "/cos", "/revenue-tracker", "/gp-tracker",
    "/engineering", "/engineering/tasks", "/quality",
    "/pd", "/pd/tickets", "/clients", "/opportunities", "/sites",
    "/gates", "/gates/blocked", "/gates/ready", "/gates/exceptions",
    "/admin/control-center", "/admin/roles", "/admin/smart-import",
    "/my-work", "/my-work/tasks", "/my-work/calendar",
    "/hse", "/construction", "/handover", "/governance/approvals",
    "/execution-board", "/portfolios", "/weekly-reviews",
    "/reports/center", "/reports/programme",
  ];

  for (const route of CRITICAL_ROUTES) {
    it(`route ${route} still exists in PAGE_REGISTRY or redirects`, () => {
      const inRegistry = PAGE_REGISTRY.some(p => p.path === route);
      const inRedirects = LEGACY_REDIRECTS.some(r => r.path === route);
      expect(inRegistry || inRedirects, `Route ${route} not found`).toBe(true);
    });
  }
});

// ===================== LIFECYCLE GATES =====================

describe("Lifecycle gates operational surfaces", () => {
  it("defines 8 lifecycle gate checkpoints", () => {
    expect(LIFECYCLE_GATES).toHaveLength(8);
  });

  it("all gates have valid paths", () => {
    for (const gate of LIFECYCLE_GATES) {
      expect(gate.path.startsWith("/")).toBe(true);
      expect(gate.label).toBeTruthy();
      expect(CANONICAL_MODULES).toContain(gate.module);
    }
  });

  it("includes key business-critical gates", () => {
    const keys = LIFECYCLE_GATES.map(g => g.key);
    expect(keys).toContain("pd_to_pm_handover");
    expect(keys).toContain("financial_review");
    expect(keys).toContain("commissioning");
    expect(keys).toContain("client_handover");
  });
});

// ===================== ROLE-TO-LENS BIDIRECTIONAL COVERAGE =====================

describe("Role-to-lens mapping coverage", () => {
  it("every company role has a mapping in ROLE_TO_LENS_MAP", () => {
    for (const role of COMPANY_ROLES) {
      expect(ROLE_TO_LENS_MAP[role], `Missing lens mapping for ${role}`).toBeDefined();
    }
  });

  it("every lens role is reachable from at least one company role", () => {
    const reachableLenses = new Set(Object.values(ROLE_TO_LENS_MAP));
    for (const lens of LENS_ROLES) {
      expect(reachableLenses.has(lens), `Lens ${lens} is not reachable from any company role`).toBe(true);
    }
  });

  it("HSE_MANAGER and SSEG_MANAGER are proper company roles with direct lens mappings", () => {
    expect(ROLE_TO_LENS_MAP["HSE_MANAGER"]).toBe("HSE_MANAGER");
    expect(ROLE_TO_LENS_MAP["SSEG_MANAGER"]).toBe("SSEG_MANAGER");
    expect(COMPANY_ROLES).toContain("HSE_MANAGER");
    expect(COMPANY_ROLES).toContain("SSEG_MANAGER");
  });

  it("QUALITY_MANAGER has its own dedicated lens", () => {
    expect(ROLE_TO_LENS_MAP["QUALITY_MANAGER"]).toBe("QUALITY_MANAGER");
    expect(DEFAULT_LENS_PROFILES.find(p => p.lensRole === "QUALITY_MANAGER")).toBeDefined();
  });
});
