import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PRIORITY_ADMIN_ROLES } from "@shared/config/priorities";
import { ENTITY_PERMISSION_DEFAULTS } from "@shared/permissions/registry";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function routeBlock(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, `${start} should exist`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `${end} should exist after ${start}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("priorities sprint 1 hardening", () => {
  it("registers progress-source options before the dynamic priority detail route", () => {
    const source = read("server/departments/priority-strategic-routes.ts");
    const progressSourceIndex = source.indexOf('"/api/priorities/progress-source-options"');
    const detailIndex = source.indexOf('"/api/priorities/:id"');

    expect(progressSourceIndex).toBeGreaterThanOrEqual(0);
    expect(detailIndex).toBeGreaterThanOrEqual(0);
    expect(progressSourceIndex).toBeLessThan(detailIndex);
  });

  it("uses one terminal-status contract instead of closed-only priority filters", () => {
    const sharedConfig = read("shared/config/priorities.ts");
    const routeSource = read("server/departments/priority-strategic-routes.ts");

    expect(sharedConfig).toContain("PRIORITY_TERMINAL_STATUSES");
    expect(sharedConfig).toContain("isPriorityTerminalStatus");
    expect(routeSource).not.toContain('p.status !== "closed"');
    expect(routeSource).not.toContain('p.status === "closed"');
    expect(routeSource).not.toContain("status != 'closed'");
  });

  it("invalidates the my-work query through the shared priority invalidation helper", () => {
    const pageSource = read("client/src/pages/priorities.tsx");
    const createDialogSource = read("client/src/components/priorities/CreatePriorityDialog.tsx");

    expect(pageSource).toContain("invalidatePriorityQueries");
    expect(pageSource).not.toContain('const invalidateAll = () => queryClient.invalidateQueries({ queryKey: ["/api/priorities"] })');
    expect(createDialogSource).toContain("invalidatePriorityQueries");
  });

  it("allows the server to handle regular-user role-priority creation explicitly", () => {
    const source = read("server/departments/priority-strategic-routes.ts");
    const createBlock = routeBlock(
      source,
      "// ==================== POST /api/priorities ====================",
      "// ==================== PUT /api/priorities/:id ====================",
    );

    expect(createBlock).not.toContain("requirePriorityCreator");
    expect(createBlock).toContain('requirePermission("company_priorities", "view")');
    expect(createBlock).toContain("effectiveScope !== \"role\"");
    expect(createBlock).toContain("ownerUserId: effectiveOwnerUserId");
    expect(createBlock).toContain("assignedUserId: effectiveAssignedUserId");
  });

  it("does not expose unusable bulk or company-create actions to unsupported roles", () => {
    const source = read("client/src/pages/priorities.tsx");

    expect(source).toContain("canUseBulkActions");
    expect(source).toContain("canCreateInActiveTab");
    expect(source).not.toContain("showEscalate={isAdmin || isDeptHead}");
    expect(source).not.toContain("showReopen={showClosed && (isAdmin || isDeptHead)}");
    expect(source).not.toContain("(isAdmin || isDeptHead) ? (");
  });

  it("keeps company priority edit registry defaults aligned with priority admins", () => {
    const companyPriorities = ENTITY_PERMISSION_DEFAULTS.find(
      (entry) => entry.entity === "company_priorities",
    );

    expect(companyPriorities).toBeTruthy();
    // Collapsed model: create folds into edit, so create_roles no longer
    // exists. The equivalent invariant — every priority admin retains mutating
    // access to company priorities — is now expressed via edit_roles only.
    for (const role of PRIORITY_ADMIN_ROLES) {
      expect(companyPriorities?.edit_roles).toContain(role);
    }
  });
});
