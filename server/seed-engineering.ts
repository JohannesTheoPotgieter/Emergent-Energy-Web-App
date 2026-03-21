import { db } from "./db";
import { operationalTasks, projectInfo } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { syncProjectSplitTablesAfterInsert } from "./lib/project-info-sync";
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

    // Ensure all referenced projects exist in project_info
    const uniqueProjectNames = [...new Set((engineeringData as any[]).map(t => t.project_name).filter(Boolean))];
    const existingProjects = await db
      .select({ id: projectInfo.id, projectName: projectInfo.projectName })
      .from(projectInfo);
    const projectNameToId = new Map<string, number>();
    for (const p of existingProjects) {
      projectNameToId.set(p.projectName.toLowerCase().trim(), p.id);
    }

    let projectsCreated = 0;
    for (const name of uniqueProjectNames) {
      if (!projectNameToId.has(name.toLowerCase().trim())) {
        const insertValues = {
          projectName: name,
          phase: "P0_FIRST_ASSESSMENT",
          isActive: true,
        };
        const [created] = await db.insert(projectInfo).values(insertValues).returning({ id: projectInfo.id });
        await syncProjectSplitTablesAfterInsert(created.id, insertValues);
        projectNameToId.set(name.toLowerCase().trim(), created.id);
        projectsCreated++;
      }
    }
    if (projectsCreated > 0) {
      console.log(`[Seed] Auto-created ${projectsCreated} missing projects in project_info`);
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

      // Resolve project_id from project_info
      const resolvedProjectId = task.project_name
        ? projectNameToId.get(task.project_name.toLowerCase().trim()) ?? null
        : null;

      await db.insert(operationalTasks).values({
        projectId: resolvedProjectId,
        projectName: task.project_name,
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
