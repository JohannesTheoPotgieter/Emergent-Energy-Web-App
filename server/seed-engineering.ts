import { db } from "./db";
import { workItems, projectInfo } from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";
import engineeringData from "./seed-engineering-data.json";

export async function seedEngineeringData() {
  try {
    const existing = await db
      .select({ count: sql<number>`count(*)` })
      .from(workItems)
      .where(and(eq(workItems.workstream, "ENG"), eq(workItems.source, "INTEGRATION")));

    const clickupCount = Number(existing[0]?.count || 0);

    if (clickupCount >= engineeringData.length) {
      console.log(`[Seed] Engineering data already present (${clickupCount} ClickUp tasks), skipping.`);
      return;
    }

    console.log(`[Seed] Found ${clickupCount} ClickUp tasks, expected ${engineeringData.length}. Seeding engineering data...`);

    // Build project name → id lookup
    const allProjects = await db.select({ id: projectInfo.id, projectName: projectInfo.projectName }).from(projectInfo);
    const projectNameToId = new Map<string, number>();
    for (const p of allProjects) {
      if (p.projectName) projectNameToId.set(p.projectName, p.id);
    }

    let inserted = 0;
    let skipped = 0;

    for (const task of engineeringData as any[]) {
      const externalRef = task.external_task_id ? `clickup:${task.external_task_id}` : null;

      if (externalRef) {
        const dup = await db
          .select({ id: workItems.id })
          .from(workItems)
          .where(eq(workItems.externalRef, externalRef))
          .limit(1);

        if (dup.length > 0) {
          skipped++;
          continue;
        }
      }

      const projectId = projectNameToId.get(task.project_name);
      if (!projectId) {
        console.warn(`[Seed] Skipping task "${task.title}" — project "${task.project_name}" not found`);
        skipped++;
        continue;
      }

      await db.insert(workItems).values({
        projectId,
        workstream: "ENG",
        source: "INTEGRATION",
        title: task.title,
        description: task.description || null,
        status: task.status || "planned",
        priority: task.priority || "Medium",
        startDate: task.start_date || null,
        endDate: task.due_date || null,
        duration: task.duration_days || null,
        percentComplete: task.percent_complete || 0,
        expectedPctComplete: task.expected_percent_complete || null,
        blockerReason: task.blocker_reason || null,
        sortOrder: task.sort_order || 0,
        createdAt: task.created_at ? new Date(task.created_at) : new Date(),
        updatedAt: task.updated_at ? new Date(task.updated_at) : new Date(),
        actualStart: task.actual_start_date || null,
        actualEnd: task.actual_end_date || null,
        actualDuration: task.actual_duration_days || null,
        phase: task.phase || null,
        holdReason: task.hold_reason || null,
        approvalRequired: task.approval_required || false,
        externalRef,
        trackingRag: task.tracking_rag || null,
        taskTypeTag: task.task_type_tag || null,
        legacyTable: "operational_tasks",
      });
      inserted++;
    }

    console.log(`[Seed] Engineering data complete: ${inserted} inserted, ${skipped} skipped (duplicates).`);
  } catch (err) {
    console.error("[Seed] Engineering data error:", err);
  }
}
