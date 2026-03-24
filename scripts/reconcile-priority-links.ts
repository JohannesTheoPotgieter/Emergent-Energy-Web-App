import { db } from "../server/db";
import { priorityLinks, priorityProjects, projectInfo } from "@shared/schema";
import { and, eq } from "drizzle-orm";

async function resolveProjectId(projectName: string | null): Promise<number | null> {
  if (!projectName) return null;
  const [project] = await db
    .select({ id: projectInfo.id })
    .from(projectInfo)
    .where(eq(projectInfo.projectName, projectName))
    .limit(1);
  return project?.id ?? null;
}

async function run() {
  const links = await db.select().from(priorityLinks);
  let inserted = 0;
  let skipped = 0;

  for (const link of links) {
    let projectId = link.projectId ?? null;
    if (!projectId) {
      projectId = await resolveProjectId(link.projectName ?? null);
    }
    if (!projectId) {
      skipped++;
      continue;
    }

    await db.insert(priorityProjects).values({
      priorityId: link.priorityId,
      projectId,
      linkedBy: null,
    }).onConflictDoNothing();

    // Keep legacy row enriched with resolved project_id when missing.
    if (!link.projectId) {
      await db.update(priorityLinks)
        .set({ projectId })
        .where(eq(priorityLinks.id, link.id));
    }

    inserted++;
  }

  // Add reverse-compatibility rows for strategic-only links.
  const strategicLinks = await db.select().from(priorityProjects);
  let backfilledLegacy = 0;
  for (const sp of strategicLinks) {
    const [exists] = await db.select({ id: priorityLinks.id }).from(priorityLinks).where(and(
      eq(priorityLinks.priorityId, sp.priorityId),
      eq(priorityLinks.projectId, sp.projectId),
    )).limit(1);
    if (exists) continue;

    const [project] = await db.select({ name: projectInfo.projectName }).from(projectInfo).where(eq(projectInfo.id, sp.projectId)).limit(1);
    await db.insert(priorityLinks).values({
      priorityId: sp.priorityId,
      linkType: "project",
      projectId: sp.projectId,
      projectName: project?.name ?? null,
      taskId: null,
      taskType: null,
    });
    backfilledLegacy++;
  }

  console.log(`[reconcile-priority-links] inserted/checked strategic links: ${inserted}`);
  console.log(`[reconcile-priority-links] skipped unresolved legacy links: ${skipped}`);
  console.log(`[reconcile-priority-links] backfilled legacy compatibility rows: ${backfilledLegacy}`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[reconcile-priority-links] failed", err);
    process.exit(1);
  });
