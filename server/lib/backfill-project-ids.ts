import { db } from "../db";
import { eq, isNull, sql } from "drizzle-orm";
import {
  projectInfo,
  operationalTasks,
  qcChecklist,
  deliverables,
  engineeringTasks,
} from "@shared/schema";

export async function backfillProjectIds(): Promise<void> {
  const projects = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo);
  if (projects.length === 0) return;

  const nameToId = new Map<string, number>();
  for (const p of projects) {
    nameToId.set(p.projectName, p.id);
  }

  for (const [name, id] of Array.from(nameToId.entries())) {
    await db.update(operationalTasks)
      .set({ projectId: id })
      .where(sql`${operationalTasks.projectName} = ${name} AND ${operationalTasks.projectId} IS NULL`);

    await db.update(qcChecklist)
      .set({ projectId: id })
      .where(sql`${qcChecklist.projectName} = ${name} AND ${qcChecklist.projectId} IS NULL`);

    await db.update(deliverables)
      .set({ projectId: id })
      .where(sql`${deliverables.projectName} = ${name} AND ${deliverables.projectId} IS NULL`);

    await db.update(engineeringTasks)
      .set({ projectId: id })
      .where(sql`${engineeringTasks.projectName} = ${name} AND ${engineeringTasks.projectId} IS NULL`);
  }

  console.log(`[Backfill] Linked projectId for ${nameToId.size} projects across operational_tasks, qc_checklist, deliverables, engineering_tasks`);
}
