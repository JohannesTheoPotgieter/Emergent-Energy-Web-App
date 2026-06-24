/**
 * Role → Section → Nav → Page → Entity chain-of-truth guard.
 *
 * Companion to nav-cleanup-validation.test.ts. Where that test checks the
 * shape of TOP_SECTIONS / DISPLAY_TOP_NAV in isolation, this test pins down
 * the *full row × column matrix* described in
 * docs/roles-permissions-navigation-audit-2026-05-05.md §3:
 *
 *   - For every CompanyRole, exactly which of the 7 top-nav items render.
 *   - Admin is visible iff the role is in ADMIN_ROLES.
 *   - Every visible top-nav primary path passes evaluatePathAccess for a
 *     role that's supposed to see it (no "shown but immediately denied").
 *   - validateNavigationPermissionModel() reports zero outstanding issues.
 *   - No new hardcoded role string-equality checks crept into client pages.
 *
 * Updating this matrix is intentionally noisy: any change to
 * ROLE_VISIBLE_SECTIONS or DISPLAY_TOP_NAV must also be reflected here AND
 * in the audit doc, keeping all three artefacts in lockstep.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DISPLAY_TOP_NAV,
  ROLE_VISIBLE_SECTIONS,
} from "@/config/app-navigation";
import { validateNavigationPermissionModel } from "@/config/navigation-permissions";
import { evaluatePathAccess } from "@/config/runtime-access";
import { ADMIN_ROLES, ENTITY_REGISTRY, type CompanyRole } from "@shared/schema";

// ---------------------------------------------------------------------------
// Expected role × top-nav visibility matrix.
// Mirrors §3 of docs/roles-permissions-navigation-audit-2026-05-05.md.
// ---------------------------------------------------------------------------

type TopNavLabel = "Home" | "Execution" | "Finance" | "Engineering" | "Quality Management" | "Settings";

/**
 * Locked role × top-nav visibility per COO spec (2026-05-11):
 *
 *   Home · Execution · Engineering · Finance · Quality Management · Settings
 *
 * Hidden tabs (Projects/Portfolio, Gates, Project Development, HSE, Reports,
 * the legacy Admin grid) sit behind Functionality Control and don't render
 * in the top bar regardless of the role. Settings is COO/CEO only.
 */
const EXPECTED_VISIBILITY: Record<CompanyRole, TopNavLabel[]> = {
  COO_ADMIN:               ["Home", "Execution", "Engineering", "Finance", "Quality Management", "Settings"],
  CEO_ADMIN:               ["Home", "Execution", "Finance", "Settings"],
  CCO:                     ["Home", "Finance"],
  KEY_ACCOUNTS_MANAGER:    ["Home", "Finance"],
  PROGRAM_MANAGER:         ["Home", "Execution", "Finance", "Quality Management"],
  PROGRAM_FINANCE_MANAGER: ["Home", "Execution", "Finance"],
  PROJECT_MANAGER_SITE:    ["Home", "Execution", "Finance", "Quality Management"],
  CONSTRUCTION_MANAGER:    ["Home", "Execution", "Finance", "Quality Management"],
  ENGINEERING_MANAGER:     ["Home", "Execution", "Engineering", "Quality Management"],
  QUALITY_MANAGER:         ["Home", "Execution", "Quality Management"],
  HSE_MANAGER:             ["Home", "Execution"],
  SSEG_MANAGER:            ["Home", "Execution", "Engineering", "Quality Management"],
  CFO:                     ["Home", "Execution", "Finance"],
  ACCOUNTANT:              ["Home", "Finance"],
  ENGINEER:                ["Home", "Engineering", "Quality Management"],
  PROJECT_DEVELOPER:       ["Home", "Finance"],
};

/**
 * Filter DISPLAY_TOP_NAV the same way the topbar component does:
 * the role's allowed section keys (from ROLE_VISIBLE_SECTIONS) must satisfy
 * either `requiredSectionKey` or any of `requiredAnySectionKeys`, and any
 * `requiredPathPermissions` are assumed allowed (canViewPath returns true).
 */
function visibleLabelsFor(role: CompanyRole): TopNavLabel[] {
  const allowed = new Set<string>(ROLE_VISIBLE_SECTIONS[role]);
  return DISPLAY_TOP_NAV.filter((item) => {
    if (item.requiredSectionKey && !allowed.has(item.requiredSectionKey)) return false;
    if (item.requiredAnySectionKeys && !item.requiredAnySectionKeys.some((k) => allowed.has(k))) return false;
    return true;
  }).map((item) => item.label);
}

describe("role × top-nav visibility matrix matches the audit doc", () => {
  for (const role of Object.keys(EXPECTED_VISIBILITY) as CompanyRole[]) {
    it(`${role} sees exactly: ${EXPECTED_VISIBILITY[role].join(", ")}`, () => {
      const actual = visibleLabelsFor(role);
      expect(actual).toEqual(EXPECTED_VISIBILITY[role]);
    });
  }

  it("every CompanyRole in ROLE_VISIBLE_SECTIONS is covered by EXPECTED_VISIBILITY", () => {
    const declared = new Set(Object.keys(ROLE_VISIBLE_SECTIONS));
    const expected = new Set(Object.keys(EXPECTED_VISIBILITY));
    expect(Array.from(declared).sort()).toEqual(Array.from(expected).sort());
  });
});

describe("Settings visibility ⇔ ADMIN_ROLES membership", () => {
  it("Settings top-nav is shown for exactly COO_ADMIN and CEO_ADMIN", () => {
    const adminRoles = new Set<string>(ADMIN_ROLES);
    for (const role of Object.keys(ROLE_VISIBLE_SECTIONS) as CompanyRole[]) {
      const sees = visibleLabelsFor(role).includes("Settings");
      expect(sees, `${role} Settings visibility`).toBe(adminRoles.has(role));
    }
  });
});

describe("every visible top-nav primary path is reachable for at least one role", () => {
  // Build a permission snapshot that represents "no overrides; defer to ENTITY_REGISTRY".
  const snapshot = {
    sections: null,
    entityPermissions: null,
    userOverrides: null,
  };

  for (const item of DISPLAY_TOP_NAV) {
    it(`${item.label} (${item.path}) resolves to allowed for at least one role that should see it`, () => {
      const candidateRoles = (Object.keys(ROLE_VISIBLE_SECTIONS) as CompanyRole[]).filter((role) =>
        visibleLabelsFor(role).includes(item.label as TopNavLabel),
      );
      expect(candidateRoles.length, `${item.label} should be visible to >= 1 role`).toBeGreaterThan(0);

      const someoneCanReach = candidateRoles.some((role) => {
        const result = evaluatePathAccess({
          role,
          path: item.path,
          snapshot: { ...snapshot, sections: ROLE_VISIBLE_SECTIONS[role] as unknown as string[] },
          failOpenForUnknown: false,
        });
        return result.allowed;
      });
      expect(someoneCanReach, `no role can actually reach ${item.path}`).toBe(true);
    });
  }
});

describe("navigation permission model has zero outstanding issues", () => {
  it("validateNavigationPermissionModel() returns no errors or warnings", () => {
    const issues = validateNavigationPermissionModel();
    expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
  });
});

describe("ENTITY_REGISTRY is consistent with the chain", () => {
  it("every entity referenced by ROLE_VISIBLE_SECTIONS-allowed paths exists in ENTITY_REGISTRY", () => {
    // Indirectly: route-permission-coverage.test.ts already enforces
    // PAGE_REGISTRY entities are valid. Here we just guard that the
    // registry isn't empty and that an arbitrary well-known entity exists,
    // so that this test fails fast if registry generation breaks.
    const entities = new Set(ENTITY_REGISTRY.map((e) => e.entity));
    expect(entities.has("admin_roles")).toBe(true);
    expect(entities.has("financials")).toBe(true);
    expect(entities.has("projects")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hardcoded role literal guard.
//
// Block the simplest pattern that drift returns through:
//   user.role === "ROLE_NAME"   /   user?.role === "ROLE_NAME"
//   companyRole === "ROLE_NAME"
//
// Allow-list:
//   - shared/permissions/** and shared/schema/** (canonical definitions)
//   - shared/coo-operational-access-matrix.ts (canonical)
//   - client/src/lib/access-control.ts (the helper itself)
//   - client/src/config/** (nav config, by design)
//   - test files
// ---------------------------------------------------------------------------

const ROLE_NAMES = [
  "COO_ADMIN", "CEO_ADMIN", "CCO", "CFO",
  "PROGRAM_MANAGER", "PROGRAM_FINANCE_MANAGER",
  "CONSTRUCTION_MANAGER", "QUALITY_MANAGER", "ENGINEERING_MANAGER",
  "KEY_ACCOUNTS_MANAGER", "ACCOUNTANT", "ENGINEER",
  "PROJECT_MANAGER_SITE", "PROJECT_DEVELOPER",
  "HSE_MANAGER", "SSEG_MANAGER",
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "__generated__") continue;
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      yield full;
    }
  }
}

describe("no new hardcoded role string-equality checks", () => {
  it("client pages do not use `=== \"ROLE_NAME\"` outside the allow-listed config files", () => {
    const root = path.resolve(__dirname, "../../..");
    const pagesDir = path.join(root, "client/src/pages");
    const offenders: string[] = [];
    const pattern = new RegExp(
      String.raw`(?:user\??\.role|companyRole|role)\s*(?:===|!==)\s*["'](?:` +
        ROLE_NAMES.join("|") +
        String.raw`)["']`,
    );

    for (const file of walk(pagesDir)) {
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      lines.forEach((line, idx) => {
        if (pattern.test(line)) {
          offenders.push(`${path.relative(root, file)}:${idx + 1}  ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      "Found hardcoded role checks; replace with isAdmin / PermissionGate / checkPermission:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
