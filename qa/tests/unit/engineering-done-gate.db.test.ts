/**
 * Engineering Done-gate — DB-integrated hardening tests (Batch 1).
 *
 * Proves the three closed bypasses against a live Postgres database:
 *   1. Only a `linkRole='output'` link satisfies the "no Done without a linked
 *      document" gate — an `evidence`/`reference` link must NOT unblock Done.
 *   2. A `projectDocumentLinkId` that belongs to another project is rejected
 *      with a coded ApiError (`DOCUMENT_PROJECT_MISMATCH`).
 *   3. The same `projectDocumentLinkId` cannot be linked to a task twice
 *      (partial unique index + conflict-safe insert → dedupe / 409).
 * Plus the happy path (output link → Complete succeeds) and the reverse
 * accessor (tasks linked to a document).
 *
 * Opt-in only (mirrors qa/tests/unit/v2-finance-cashflow-db.test.ts): DB-mutating
 * tests must NOT seed a dev/prod DB on a normal build, and must NOT run under the
 * `test:api` harness (which forces the SQLite fallback via API_TEST_MODE). Set
 * `RUN_DB_TESTS=1` with a Postgres `DATABASE_URL` to run — otherwise the suite
 * self-skips. Dynamic-import `server/db`, call `initializeDatabase()`, THEN import
 * the repo/guard so their `import { db }` bindings resolve to the live instance.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";

const hasDb = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";
const dbDescribe = hasDb ? describe : describe.skip;
const MARKER = `__eng_done_gate_${process.pid}_${Date.now()}__`;

dbDescribe("Engineering Done-gate — output-only, project-scoped, deduped", () => {
  let dbModule: typeof import("../../../server/db");
  let tasks: typeof import("@shared/schema/tasks");
  let projects: typeof import("@shared/schema/projects");
  let docs: typeof import("@shared/schema/documents");
  let usersSchema: typeof import("@shared/schema/users");
  let repo: typeof import("../../../server/repositories/engineering-tasks-repository");
  let guard: typeof import("../../../server/lib/task-workflow-guard");
  let docsRepo: typeof import("../../../server/repositories/managed-documents-repository");

  let actorId: number;
  let projectA: number;
  let projectB: number;
  let docOnA: number;
  const createdTaskIds: number[] = [];

  async function makeTask(projectId: number, taskTypeTag = "ifc_pack"): Promise<{ id: number; status: string }> {
    const [t] = await dbModule.db
      .insert(tasks.workItems)
      .values({
        workstream: "ENG",
        source: "UI",
        title: `${MARKER} ${taskTypeTag}`,
        status: "in_progress",
        projectId,
        taskTypeTag,
        createdBy: actorId,
      })
      .returning({ id: tasks.workItems.id, status: tasks.workItems.status });
    createdTaskIds.push(t.id);
    return t;
  }

  async function makeProjectDocumentLink(projectId: number): Promise<number> {
    const [link] = await dbModule.db
      .insert(docs.projectDocumentLinks)
      .values({
        projectId,
        domain: "engineering",
        documentType: "ifc_pack",
        fileName: `${MARKER}.pdf`,
        createdByUserId: actorId,
      })
      .returning({ id: docs.projectDocumentLinks.id });
    return link.id;
  }

  beforeAll(async () => {
    dbModule = await import("../../../server/db");
    tasks = await import("@shared/schema/tasks");
    projects = await import("@shared/schema/projects");
    docs = await import("@shared/schema/documents");
    usersSchema = await import("@shared/schema/users");
    await dbModule.initializeDatabase();
    repo = await import("../../../server/repositories/engineering-tasks-repository");
    guard = await import("../../../server/lib/task-workflow-guard");
    docsRepo = await import("../../../server/repositories/managed-documents-repository");

    // Reuse an existing user for the NOT-NULL FK columns (no seeding helper exists).
    const [u] = await dbModule.db.select({ id: usersSchema.users.id }).from(usersSchema.users).limit(1);
    actorId = u.id;

    const [pa] = await dbModule.db
      .insert(projects.projectInfo)
      .values({ projectName: `${MARKER}_A` })
      .returning({ id: projects.projectInfo.id });
    const [pb] = await dbModule.db
      .insert(projects.projectInfo)
      .values({ projectName: `${MARKER}_B` })
      .returning({ id: projects.projectInfo.id });
    projectA = pa.id;
    projectB = pb.id;

    const [d] = await dbModule.db
      .insert(docs.managedDocuments)
      .values({
        rootScope: "project",
        projectId: projectA,
        driveId: MARKER,
        driveItemId: `${MARKER}_item`,
        name: "IFC.pdf",
        path: `${MARKER}/IFC.pdf`,
        createdByUserId: actorId,
      })
      .returning({ id: docs.managedDocuments.id });
    docOnA = d.id;
  });

  afterAll(async () => {
    if (!dbModule?.db) return;
    // Deleting the projects cascades to work_items, managed_documents and
    // project_document_links (all onDelete: cascade on projectId), which in turn
    // cascades work_item_document_links. Belt-and-braces explicit cleanup first.
    if (createdTaskIds.length) {
      await dbModule.db
        .delete(tasks.workItemDocumentLinks)
        .where(inArray(tasks.workItemDocumentLinks.workItemId, createdTaskIds));
    }
    for (const pid of [projectA, projectB]) {
      if (pid != null) {
        await dbModule.db.delete(projects.projectInfo).where(eq(projects.projectInfo.id, pid));
      }
    }
  });

  it("1) an evidence-only link does NOT satisfy the Done-gate — Complete is blocked", async () => {
    const task = await makeTask(projectA);
    await dbModule.db.insert(tasks.workItemDocumentLinks).values({
      workItemId: task.id,
      managedDocumentId: docOnA,
      linkRole: "evidence",
      createdByUserId: actorId,
    });
    const ctx = await guard.buildTaskWorkflowContext(task.id, task.status);
    expect(ctx.documentLinked).toBe(false);
    await expect(repo.transitionEngineeringTaskStatus(task.id, "complete", actorId)).rejects.toThrow(
      /can't be marked done/i,
    );
  });

  it("2) a projectDocumentLinkId from another project is rejected (coded)", async () => {
    const task = await makeTask(projectA);
    const linkOnB = await makeProjectDocumentLink(projectB);
    await expect(
      repo.linkDocumentToTask(task.id, { projectDocumentLinkId: linkOnB, linkRole: "output" }, actorId),
    ).rejects.toMatchObject({ code: "DOCUMENT_PROJECT_MISMATCH" });
  });

  it("3) linking the same projectDocumentLinkId twice does not create a duplicate", async () => {
    const task = await makeTask(projectA);
    const linkOnA = await makeProjectDocumentLink(projectA);
    const first = await repo.linkDocumentToTask(task.id, { projectDocumentLinkId: linkOnA, linkRole: "output" }, actorId);
    expect(first).not.toBeNull();
    const second = await repo.linkDocumentToTask(task.id, { projectDocumentLinkId: linkOnA, linkRole: "output" }, actorId);
    expect(second).toBeNull(); // route maps null → 409
    const rows = await dbModule.db
      .select()
      .from(tasks.workItemDocumentLinks)
      .where(eq(tasks.workItemDocumentLinks.workItemId, task.id));
    expect(rows.filter((r: { projectDocumentLinkId: number | null }) => r.projectDocumentLinkId === linkOnA)).toHaveLength(1);
  });

  it("4) an in-project output link satisfies the gate — Complete succeeds", async () => {
    const task = await makeTask(projectA);
    const link = await repo.linkDocumentToTask(task.id, { managedDocumentId: docOnA, linkRole: "output" }, actorId);
    expect(link).not.toBeNull();
    const ctx = await guard.buildTaskWorkflowContext(task.id, task.status);
    expect(ctx.documentLinked).toBe(true);
    const updated = await repo.transitionEngineeringTaskStatus(task.id, "complete", actorId);
    expect(updated?.status).toBe("complete");
  });

  it("5) the reverse accessor lists tasks linked to a document", async () => {
    const task = await makeTask(projectA);
    await repo.linkDocumentToTask(task.id, { managedDocumentId: docOnA, linkRole: "output" }, actorId);
    const linked = await docsRepo.listTasksLinkedToDocument(docOnA);
    expect(linked.some((t) => t.taskId === task.id)).toBe(true);
  });
});
