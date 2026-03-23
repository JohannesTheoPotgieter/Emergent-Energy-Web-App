import { db } from "../db";
import { eq, isNull, sql } from "drizzle-orm";
import {
  projectInfo,
  qcChecklist,
  deliverables,
} from "@shared/schema";

export async function backfillProjectIds(): Promise<void> {
  const projects = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo);
  if (projects.length === 0) return;

  const nameToId = new Map<string, number>();
  for (const p of projects) {
    nameToId.set(p.projectName, p.id);
  }

  for (const [name, id] of Array.from(nameToId.entries())) {
    // work_items already has projectId as NOT NULL, no backfill needed

    await db.update(qcChecklist)
      .set({ projectId: id })
      .where(sql`${qcChecklist.projectName} = ${name} AND ${qcChecklist.projectId} IS NULL`);

    await db.update(deliverables)
      .set({ projectId: id })
      .where(sql`${deliverables.projectName} = ${name} AND ${deliverables.projectId} IS NULL`);
  }

  console.log(`[Backfill] Linked projectId for ${nameToId.size} projects across qc_checklist, deliverables`);
}
