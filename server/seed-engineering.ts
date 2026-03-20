import { db } from "./db";
import { operationalTasks, projectInfo } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import engineeringData from "./seed-engineering-data.json";

export async function seedEngineeringData() {
  try {
    const existing = await db
      .select({ count: sql<number>`count(*)` })
      .from(operationalTasks)
      .where(eq(operationalTasks.externalSource, "clickup"));

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
        const [created] = await db.insert(projectInfo).values({
          projectName: name,
          phase: "P0_FIRST_ASSESSMENT",
          isActive: true,
        }).returning({ id: projectInfo.id });
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
      if (task.external_task_id) {
        const dup = await db
          .select({ id: operationalTasks.id })
          .from(operationalTasks)
          .where(eq(operationalTasks.externalTaskId, task.external_task_id))
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
        dueDate: task.due_date || null,
        durationDays: task.duration_days || null,
        percentComplete: task.percent_complete || 0,
        expectedPercentComplete: task.expected_percent_complete || null,
        assignees: task.assignees || null,
        tags: task.tags || null,
        blockerReason: task.blocker_reason || null,
        plannedHours: task.planned_hours || null,
        actualHours: task.actual_hours || null,
        sortOrder: task.sort_order || 0,
        isBaseline: task.is_baseline || false,
        createdAt: task.created_at ? new Date(task.created_at) : new Date(),
        updatedAt: task.updated_at ? new Date(task.updated_at) : new Date(),
        actualStartDate: task.actual_start_date || null,
        actualEndDate: task.actual_end_date || null,
        actualDurationDays: task.actual_duration_days || null,
        comment: task.comment || null,
        escalationLevel: task.escalation_level || null,
        phase: task.phase || null,
        primaryWorkstream: task.primary_workstream || null,
        holdReason: task.hold_reason || null,
        approvalRequired: task.approval_required || false,
        watchers: task.watchers || null,
        workstream: task.workstream || null,
        externalSource: task.external_source || "clickup",
        externalTaskId: task.external_task_id || null,
        externalSubtaskIds: task.external_subtask_ids || null,
        externalSubtaskUrls: task.external_subtask_urls || null,
        trackingRag: task.tracking_rag || null,
        summaryText: task.summary_text || null,
        importedCommentCount: task.imported_comment_count || null,
        taskTypeTag: task.task_type_tag || null,
      });
      inserted++;
    }

    console.log(`[Seed] Engineering data complete: ${inserted} inserted, ${skipped} skipped (duplicates).`);
  } catch (err) {
    console.error("[Seed] Engineering data error:", err);
  }
}
