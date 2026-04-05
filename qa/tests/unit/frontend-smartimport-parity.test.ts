import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

/**
 * Phase 7 — Frontend unification proof + Smart Import regression proof.
 *
 * These tests verify:
 * 1. All frontend task write paths hit canonical endpoints (work_items-backed)
 * 2. No frontend code references stale/dropped endpoints
 * 3. Smart Import pipeline writes to work_items, not legacy tables
 * 4. No import code references dropped tables
 */

// ============================================================
// SECTION A: Frontend write paths are all canonical
// ============================================================

describe("my-work-tasks.tsx write paths are all canonical", () => {
  const src = readFile("client/src/pages/my-work-tasks.tsx");

  it("reads from canonical /api/my-work/all-tasks", () => {
    expect(src).toContain("/api/my-work/all-tasks");
  });

  it("creates personal tasks via /api/mytool/tasks (canonical)", () => {
    expect(src).toContain('"/api/mytool/tasks"');
  });

  it("updates personal tasks via /api/mytool/tasks/:id (canonical)", () => {
    expect(src).toMatch(/\/api\/mytool\/tasks\/\$\{/);
  });

  it("deletes personal tasks via /api/mytool/tasks/:id (canonical)", () => {
    expect(src).toMatch(/DELETE.*\/api\/mytool\/tasks/);
  });

  it("updates operational tasks via /api/operational-tasks/:id (canonical)", () => {
    expect(src).toContain("/api/operational-tasks/");
  });

  it("updates plan tasks via /api/planning-tasks/:id (canonical)", () => {
    expect(src).toContain("/api/planning-tasks/");
  });

  it("does NOT reference /api/calendar/my-tasks (stale endpoint)", () => {
    expect(src).not.toContain("/api/calendar/my-tasks");
  });

  it("does NOT directly reference mytool_tasks table", () => {
    expect(src).not.toMatch(/mytool_tasks/);
  });
});

describe("my-work-calendar.tsx is fully canonical", () => {
  const src = readFile("client/src/pages/my-work-calendar.tsx");

  it("reads from /api/my-work/all-tasks (canonical)", () => {
    expect(src).toContain("/api/my-work/all-tasks");
  });

  it("schedules via /api/calendar/schedule-task (canonical)", () => {
    expect(src).toContain("/api/calendar/schedule-task");
  });

  it("does NOT read from /api/calendar/my-tasks", () => {
    expect(src).not.toContain("/api/calendar/my-tasks");
  });
});

// task-management.tsx has been removed; its functionality was consolidated elsewhere.
// The canonical /api/tasks endpoints are now consumed from other pages.

describe("EngineeringTasksPage.tsx uses canonical adapter endpoints", () => {
  const src = readFile("client/src/pages/EngineeringTasksPage.tsx");

  it("reads from /api/eng/tasks (canonical via adapter)", () => {
    expect(src).toContain("/api/eng/tasks");
  });

  it("writes via /api/eng/tasks/:id (canonical via adapter)", () => {
    expect(src).toMatch(/\/api\/eng\/tasks\/\$\{/);
  });
});

describe("UnifiedPlanTab.tsx uses canonical endpoints", () => {
  const src = readFile("client/src/components/tabs/UnifiedPlanTab.tsx");

  it("reads from /api/planning-tasks/:project", () => {
    expect(src).toContain("/api/planning-tasks/");
  });

  it("writes via /api/planning-tasks (canonical)", () => {
    expect(src).toMatch(/\/api\/planning-tasks/);
  });

  it("manages dependencies via /api/dependencies (canonical work_item_dependencies)", () => {
    expect(src).toContain("/api/dependencies");
  });
});

describe("BoardView.tsx uses canonical endpoints", () => {
  const src = readFile("client/src/components/BoardView.tsx");

  it("reads from /api/operational-tasks/:project", () => {
    expect(src).toContain("/api/operational-tasks/");
  });

  it("creates via /api/operational-tasks (canonical)", () => {
    expect(src).toContain('"/api/operational-tasks"');
  });
});

// ============================================================
// SECTION B: No stale/dropped endpoint references
// ============================================================

describe("no frontend code references stale or dropped endpoints", () => {
  const FRONTEND_FILES = [
    "client/src/pages/my-work-tasks.tsx",
    "client/src/pages/my-work-calendar.tsx",
    "client/src/pages/EngineeringTasksPage.tsx",
    "client/src/components/tabs/UnifiedPlanTab.tsx",
    "client/src/components/BoardView.tsx",
    "client/src/components/TaskDetailDrawer.tsx",
    "client/src/components/mytool/TaskDetailDrawer.tsx",
  ];

  for (const file of FRONTEND_FILES) {
    it(`${file} does not reference /api/calendar/my-tasks`, () => {
      const src = readFile(file);
      expect(src).not.toContain("/api/calendar/my-tasks");
    });
  }

  for (const file of FRONTEND_FILES) {
    it(`${file} does not reference /api/mytool-tasks (stale endpoint)`, () => {
      const src = readFile(file);
      expect(src).not.toContain("/api/mytool-tasks");
    });
  }
});

// ============================================================
// SECTION C: Smart Import writes to canonical work_items
// ============================================================

describe("Smart Import pipeline is canonical and does not reference dropped tables", () => {
  const src = readFile("server/smart-import-routes.ts");

  it("imports work_items from schema", () => {
    expect(src).toContain("workItems");
  });

  it("inserts plan tasks into work_items", () => {
    expect(src).toMatch(/insert\(workItems\)/);
  });

  it("sets workstream to PM for plan imports", () => {
    expect(src).toContain('"PM"');
  });

  it("sets source to SMART_IMPORT", () => {
    expect(src).toContain('"SMART_IMPORT"');
  });

  it("sets legacyTable to null explicitly", () => {
    // Smart Import creates new canonical records, not legacy migrations
    expect(src).toMatch(/legacyTable:\s*null/);
  });

  it("does NOT reference mytool_tasks", () => {
    expect(src).not.toMatch(/mytool_tasks/);
  });

  it("does NOT reference mytool_task_dependencies", () => {
    expect(src).not.toMatch(/mytool_task_dependencies/);
  });

  it("does NOT reference mytool_recurrence_instances", () => {
    expect(src).not.toMatch(/mytool_recurrence_instances/);
  });

  it("uses work_item_dependencies for plan dependencies", () => {
    expect(src).toContain("workItemDependencies");
  });

  it("uses work_item_assignments for owner assignments", () => {
    expect(src).toContain("workItemAssignments");
  });
});

describe("Smart Import rollback deletes from canonical work_items only", () => {
  const src = readFile("server/smart-import-routes.ts");

  it("rollback deletes from work_items", () => {
    // Rollback should target work_items with SMART_IMPORT source and specific runId
    expect(src).toMatch(/delete.*workItems|update.*workItems/i);
  });

  it("rollback does NOT touch any legacy table", () => {
    expect(src).not.toMatch(/delete.*mytool_tasks/i);
    expect(src).not.toMatch(/delete.*operational_tasks/i);
  });
});

// ============================================================
// SECTION D: Reconciliation module works post-migration
// ============================================================

describe("reconciliation module handles dropped tables gracefully", () => {
  const src = readFile("server/lib/reconciliation/work-item-reconciliation.ts");

  it("legacy side returns empty array (no query to dropped table)", () => {
    expect(src).toContain("const legacyRows: Record<string, unknown>[] = []");
  });

  it("canonical side reads from work_items", () => {
    expect(src).toContain(".from(workItems)");
  });

  it("does NOT query operational_tasks or mytool_tasks", () => {
    expect(src).not.toMatch(/from\(operationalTasks\)/);
    expect(src).not.toMatch(/from\(mytoolTasks\)/);
  });
});

// ============================================================
// SECTION E: All screen-specific adapter endpoints write to work_items
// ============================================================

describe("all task adapter endpoints write to work_items on the backend", () => {
  it("/api/mytool/tasks creates in work_items (PERSONAL workstream)", () => {
    const src = readFile("server/repositories/work-management-repository.ts");
    const fn = src.slice(src.indexOf("async createMytoolTask"), src.indexOf("async updateMytoolTask"));
    expect(fn).toContain(".insert(workItems)");
    expect(fn).toContain('"PERSONAL"');
  });

  it("/api/operational-tasks creates in work_items", () => {
    const src = readFile("server/repositories/work-management-repository.ts");
    const fn = src.slice(src.indexOf("async createOperationalTask"), src.indexOf("async updateOperationalTask"));
    expect(fn).toContain(".insert(workItems)");
  });

  it("/api/eng/tasks creates in work_items via createWorkItem (ENG workstream)", () => {
    const src = readFile("server/work-items-adapter.ts");
    // createEngineeringWorkItem delegates to createWorkItem which inserts into workItems
    const createEngFn = src.slice(src.indexOf("export async function createEngineeringWorkItem"), src.indexOf("export async function updateEngineeringWorkItem"));
    expect(createEngFn).toContain('workstream: "ENG"');
    expect(createEngFn).toContain("createWorkItem(");
    // Verify createWorkItem inserts into workItems
    const createWorkItemFn = src.slice(src.indexOf("export async function createWorkItem"), src.indexOf("export async function updateWorkItemByLegacy"));
    expect(createWorkItemFn).toContain(".insert(workItems)");
  });

  it("/api/planning-tasks reads from work_items", () => {
    const src = readFile("server/routes/planning-tasks-routes.ts");
    expect(src).toContain("getAllWorkItemsForPlanTab");
  });
});
