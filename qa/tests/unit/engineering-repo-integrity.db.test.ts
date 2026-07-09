/**
 * Engineering tasks repository — integrity + pagination hardening (Batch 3).
 *
 *   1. bulkCreateEngineeringTasks is atomic: a mid-batch failure rolls back
 *      fully (no partially-created tasks), and the happy path writes each task
 *      with its OWNER assignment + status-history row.
 *   2. listEngineeringTasks paginates (limit/offset) and enforces a hard cap.
 *
 * Opt-in only (Postgres): RUN_DB_TESTS=1 + DATABASE_URL. See
 * qa/tests/unit/v2-finance-cashflow-db.test.ts for the pattern.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";
const dbDescribe = hasDb ? describe : describe.skip;
const MARKER = `__eng_integrity_${process.pid}_${Date.now()}__`;

dbDescribe("Engineering tasks repository — atomic bulk create + pagination", () => {
  let dbModule: typeof import("../../../server/db");
  let tasks: typeof import("@shared/schema/tasks");
  let projects: typeof import("@shared/schema/projects");
  let usersSchema: typeof import("@shared/schema/users");
  let repo: typeof import("../../../server/repositories/engineering-tasks-repository");

  let actorId: number;
  let pageProjectId: number;
  let bulkProjectId: number;

  async function makeProject(suffix: string): Promise<number> {
    const [p] = await dbModule.db
      .insert(projects.projectInfo)
      .values({ projectName: `${MARKER}_${suffix}` })
      .returning({ id: projects.projectInfo.id });
    return p.id;
  }

  async function countTasks(projectId: number): Promise<number> {
    const rows = await dbModule.db
      .select({ id: tasks.workItems.id })
      .from(tasks.workItems)
      .where(and(eq(tasks.workItems.projectId, projectId), isNull(tasks.workItems.deletedAt)));
    return rows.length;
  }

  beforeAll(async () => {
    dbModule = await import("../../../server/db");
    tasks = await import("@shared/schema/tasks");
    projects = await import("@shared/schema/projects");
    usersSchema = await import("@shared/schema/users");
    await dbModule.initializeDatabase();
    repo = await import("../../../server/repositories/engineering-tasks-repository");

    const [u] = await dbModule.db.select({ id: usersSchema.users.id }).from(usersSchema.users).limit(1);
    actorId = u.id;
    pageProjectId = await makeProject("page");
    bulkProjectId = await makeProject("bulk");

    // Five tasks for pagination (distinct titles, all on pageProjectId).
    for (let i = 0; i < 5; i++) {
      await repo.createEngineeringTask(
        { title: `${MARKER} page ${i}`, projectId: pageProjectId, taskTypeTag: "rfi", ownerUserId: actorId },
        actorId,
      );
    }
  });

  afterAll(async () => {
    if (!dbModule?.db) return;
    for (const pid of [pageProjectId, bulkProjectId]) {
      if (pid != null) await dbModule.db.delete(projects.projectInfo).where(eq(projects.projectInfo.id, pid));
    }
  });

  it("createEngineeringTask writes the task + OWNER assignment + status-history atomically", async () => {
    const task = await repo.createEngineeringTask(
      { title: `${MARKER} single`, projectId: bulkProjectId, taskTypeTag: "rfi", ownerUserId: actorId },
      actorId,
    );
    const [owner] = await dbModule.db
      .select({ userId: tasks.workItemAssignments.userId })
      .from(tasks.workItemAssignments)
      .where(and(eq(tasks.workItemAssignments.workItemId, task.id), eq(tasks.workItemAssignments.role, "OWNER")));
    expect(owner?.userId).toBe(actorId);
    const history = await dbModule.db
      .select({ id: tasks.workItemStatusHistory.id })
      .from(tasks.workItemStatusHistory)
      .where(eq(tasks.workItemStatusHistory.workItemId, task.id));
    expect(history.length).toBeGreaterThanOrEqual(1);
  });

  it("bulkCreateEngineeringTasks creates every task with its assignment + history", async () => {
    const before = await countTasks(bulkProjectId);
    const rows = await repo.bulkCreateEngineeringTasks(
      { projectId: bulkProjectId, taskTypeTags: ["substitution", "eng_snag", "commissioning_review"], ownerUserId: actorId },
      actorId,
    );
    expect(rows).toHaveLength(3);
    expect(await countTasks(bulkProjectId)).toBe(before + 3);
    // Each has an OWNER assignment.
    const assignments = await dbModule.db
      .select({ workItemId: tasks.workItemAssignments.workItemId })
      .from(tasks.workItemAssignments)
      .where(and(inArray(tasks.workItemAssignments.workItemId, rows.map((r) => r.id)), eq(tasks.workItemAssignments.role, "OWNER")));
    expect(assignments).toHaveLength(3);
  });

  it("bulkCreateEngineeringTasks rolls back fully on a mid-batch failure — no orphan tasks", async () => {
    const rollbackProject = await makeProject("rollback");
    try {
      const orig = dbModule.db.transaction.bind(dbModule.db);
      const spy = vi
        .spyOn(dbModule.db, "transaction")
        .mockImplementation(((cb: (tx: unknown) => Promise<unknown>) =>
          orig(async (tx: unknown) => {
            await cb(tx);
            throw new Error("injected mid-batch failure");
          })) as typeof dbModule.db.transaction);
      try {
        await expect(
          repo.bulkCreateEngineeringTasks(
            { projectId: rollbackProject, taskTypeTags: ["ifc_pack", "as_built"], ownerUserId: actorId },
            actorId,
          ),
        ).rejects.toThrow();
        expect(await countTasks(rollbackProject)).toBe(0);
      } finally {
        spy.mockRestore();
      }
    } finally {
      await dbModule.db.delete(projects.projectInfo).where(eq(projects.projectInfo.id, rollbackProject));
    }
  });

  it("listEngineeringTasks paginates with limit + offset", async () => {
    const all = await repo.listEngineeringTasks({ projectId: pageProjectId });
    expect(all.length).toBe(5);

    const firstTwo = await repo.listEngineeringTasks({ projectId: pageProjectId, limit: 2 });
    expect(firstTwo).toHaveLength(2);

    const nextTwo = await repo.listEngineeringTasks({ projectId: pageProjectId, limit: 2, offset: 2 });
    expect(nextTwo).toHaveLength(2);
    // Disjoint pages.
    const firstIds = new Set(firstTwo.map((t) => t.id));
    expect(nextTwo.every((t) => !firstIds.has(t.id))).toBe(true);
  });

  it("listEngineeringTasks clamps an over-large limit to the hard cap", async () => {
    // The cap must bound the query even when the caller asks for far more.
    const capped = await repo.listEngineeringTasks({ projectId: pageProjectId, limit: 10_000_000 });
    expect(capped.length).toBeLessThanOrEqual(repo.ENGINEERING_TASKS_MAX_LIMIT);
    expect(capped.length).toBe(5);
  });
});
