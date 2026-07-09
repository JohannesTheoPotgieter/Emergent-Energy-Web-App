import { db } from "../db";
import { eq, isNull, sql } from "drizzle-orm";
import {
  projectInfo,
  qcChecklist,
  qcWarning,
  qcPlanLink,
  qcPostmortem,
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
    // work_items already has projectId as NOT NULL, no backfill needed.
    // Task 3.2: link the deprecated project_name columns to the FK project_id
    // (case/whitespace-insensitive) so readers can move to id-only. Idempotent
    // — only fills rows where project_id IS NULL; old columns are kept.
    const normalized = sql`lower(btrim(${name}))`;

    await db.update(qcChecklist)
      .set({ projectId: id })
      .where(sql`lower(btrim(${qcChecklist.projectName})) = ${normalized} AND ${qcChecklist.projectId} IS NULL`);

    await db.update(qcWarning)
      .set({ projectId: id })
      .where(sql`lower(btrim(${qcWarning.projectName})) = ${normalized} AND ${qcWarning.projectId} IS NULL`);

    await db.update(qcPlanLink)
      .set({ projectId: id })
      .where(sql`lower(btrim(${qcPlanLink.projectName})) = ${normalized} AND ${qcPlanLink.projectId} IS NULL`);

    await db.update(qcPostmortem)
      .set({ projectId: id })
      .where(sql`lower(btrim(${qcPostmortem.projectName})) = ${normalized} AND ${qcPostmortem.projectId} IS NULL`);

    await db.update(deliverables)
      .set({ projectId: id })
      .where(sql`lower(btrim(${deliverables.projectName})) = ${normalized} AND ${deliverables.projectId} IS NULL`);
  }

  console.log(`[Backfill] Linked projectId for ${nameToId.size} projects across qc_checklist, qc_warning, qc_plan_link, qc_postmortem, deliverables`);
}
