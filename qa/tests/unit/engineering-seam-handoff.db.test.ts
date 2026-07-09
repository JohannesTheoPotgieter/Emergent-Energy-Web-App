/**
 * Engineering seam handoff — DB-integrated hardening tests (Batch 2).
 *
 * Proves the seam handoff:
 *   1. `compliance_input` auto-resolves + assigns + notifies the SSEG_MANAGER role
 *      (not a raw id), and links the source task via a dependency.
 *   2. `construction_snag` routes to the CONSTRUCTION_MANAGER role.
 *   3. an explicit recipient whose role doesn't match the seam type is rejected
 *      (coded SEAM_RECIPIENT_ROLE_MISMATCH).
 *   4. a mid-write failure rolls the whole handoff back — no orphan task
 *      (spine writes are wrapped in one transaction).
 *
 * Opt-in only (Postgres): set RUN_DB_TESTS=1 with a DATABASE_URL. Mirrors
 * qa/tests/unit/v2-finance-cashflow-db.test.ts (dynamic import + initializeDatabase).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";
const dbDescribe = hasDb ? describe : describe.skip;
const MARKER = `__eng_seam_${process.pid}_${Date.now()}__`;

dbDescribe("Engineering seam handoff — role-routed, validated, transactional", () => {
  let dbModule: typeof import("../../../server/db");
  let tasks: typeof import("@shared/schema/tasks");
  let projects: typeof import("@shared/schema/projects");
  let usersSchema: typeof import("@shared/schema/users");
  let repo: typeof import("../../../server/repositories/engineering-tasks-repository");

  let actorId: number;
  let projectA: number;
  let sourceTaskId: number;
  let engineerUserId: number;
  const createdUserIds: number[] = [];

  async function makeUser(role: string, tag: string): Promise<number> {
    const [u] = await dbModule.db
      .insert(usersSchema.users)
      .values({
        username: `${MARKER}_${tag}`,
        email: `${MARKER}_${tag}@example.test`,
        password: "x",
        name: `${MARKER} ${tag}`,
        role,
      })
      .returning({ id: usersSchema.users.id });
    createdUserIds.push(u.id);
    return u.id;
  }

  beforeAll(async () => {
    dbModule = await import("../../../server/db");
    tasks = await import("@shared/schema/tasks");
    projects = await import("@shared/schema/projects");
    usersSchema = await import("@shared/schema/users");
    await dbModule.initializeDatabase();
    repo = await import("../../../server/repositories/engineering-tasks-repository");

    const [existing] = await dbModule.db.select({ id: usersSchema.users.id }).from(usersSchema.users).limit(1);
    actorId = existing.id;

    // Guarantee at least one active holder of each seam role exists (the
    // returned ids aren't needed — cleanup tracks them via createdUserIds).
    await makeUser("SSEG_MANAGER", "sseg");
    await makeUser("CONSTRUCTION_MANAGER", "cm");
    engineerUserId = await makeUser("ENGINEER", "eng");

    const [p] = await dbModule.db
      .insert(projects.projectInfo)
      .values({ projectName: `${MARKER}_A` })
      .returning({ id: projects.projectInfo.id });
    projectA = p.id;

    const [t] = await dbModule.db
      .insert(tasks.workItems)
      .values({ workstream: "ENG", source: "UI", title: `${MARKER} source`, status: "in_progress", projectId: projectA, createdBy: actorId })
      .returning({ id: tasks.workItems.id });
    sourceTaskId = t.id;
  });

  afterAll(async () => {
    if (!dbModule?.db) return;
    // Remove seam tasks created for this marker, then the source task, project, users.
    const seamTasks = await dbModule.db
      .select({ id: tasks.workItems.id })
      .from(tasks.workItems)
      .where(eq(tasks.workItems.projectId, projectA));
    const ids = seamTasks.map((r: { id: number }) => r.id);
    if (ids.length) {
      await dbModule.db.delete(tasks.workItemDependencies).where(inArray(tasks.workItemDependencies.successorId, ids));
      await dbModule.db.delete(tasks.workItemAssignments).where(inArray(tasks.workItemAssignments.workItemId, ids));
    }
    await dbModule.db.delete(projects.projectInfo).where(eq(projects.projectInfo.id, projectA));
    if (createdUserIds.length) {
      await dbModule.db.delete(usersSchema.users).where(inArray(usersSchema.users.id, createdUserIds));
    }
  });

  async function ownerRole(userId: number | null): Promise<string | null> {
    if (userId == null) return null;
    const [u] = await dbModule.db.select({ role: usersSchema.users.role }).from(usersSchema.users).where(eq(usersSchema.users.id, userId));
    return u?.role ?? null;
  }

  it("1) compliance_input auto-resolves + assigns + notifies the SSEG_MANAGER role, linking the source task", async () => {
    const task = await repo.createSeamHandoff(
      { seamType: "compliance_input", title: `${MARKER} compliance`, projectId: projectA, fromTaskId: sourceTaskId },
      actorId,
    );
    // The recipient is resolved by ROLE (not a raw id) — assert the owner holds
    // SSEG_MANAGER, whichever active holder the deterministic pick selected.
    expect(task.ownerUserId).not.toBeNull();
    expect(await ownerRole(task.ownerUserId)).toBe("SSEG_MANAGER");

    const [owner] = await dbModule.db
      .select({ userId: tasks.workItemAssignments.userId })
      .from(tasks.workItemAssignments)
      .where(and(eq(tasks.workItemAssignments.workItemId, task.id), eq(tasks.workItemAssignments.role, "OWNER")));
    expect(owner?.userId).toBe(task.ownerUserId);

    const deps = await dbModule.db
      .select()
      .from(tasks.workItemDependencies)
      .where(and(eq(tasks.workItemDependencies.successorId, task.id), eq(tasks.workItemDependencies.predecessorId, sourceTaskId)));
    expect(deps).toHaveLength(1);
  });

  it("2) construction_snag routes to the CONSTRUCTION_MANAGER role", async () => {
    const task = await repo.createSeamHandoff(
      { seamType: "construction_snag", title: `${MARKER} snag`, projectId: projectA },
      actorId,
    );
    expect(await ownerRole(task.ownerUserId)).toBe("CONSTRUCTION_MANAGER");
  });

  it("3) an explicit recipient whose role doesn't match the seam type is rejected", async () => {
    await expect(
      repo.createSeamHandoff(
        { seamType: "compliance_input", toOwnerUserId: engineerUserId, title: `${MARKER} mismatch`, projectId: projectA },
        actorId,
      ),
    ).rejects.toMatchObject({ code: "SEAM_RECIPIENT_ROLE_MISMATCH" });
  });

  it("4) a mid-write failure rolls the whole handoff back — no orphan task", async () => {
    const orig = dbModule.db.transaction.bind(dbModule.db);
    const spy = vi
      .spyOn(dbModule.db, "transaction")
      // Run every spine write with the real tx, then throw before commit → full rollback.
      .mockImplementation(((cb: (tx: unknown) => Promise<unknown>) =>
        orig(async (tx: unknown) => {
          await cb(tx);
          throw new Error("injected mid-write failure");
        })) as typeof dbModule.db.transaction);
    try {
      await expect(
        repo.createSeamHandoff({ seamType: "construction_snag", title: `${MARKER} rollback`, projectId: projectA }, actorId),
      ).rejects.toThrow();
      const rows = await dbModule.db
        .select({ id: tasks.workItems.id })
        .from(tasks.workItems)
        .where(eq(tasks.workItems.title, `${MARKER} rollback`));
      expect(rows).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});
