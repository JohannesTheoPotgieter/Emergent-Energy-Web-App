import { db } from "../db";
import { and, asc, desc, eq, inArray, isNull, not, or, sql } from "drizzle-orm";
import {
  workItems,
  workItemAssignments,
  taskComments,
  taskChecklists,
  taskChecklistItems,
  taskAttachments,
  taskActivityLog,
  writebackMappings,
  writebackAuditLog,
  keyDateMappings,
  mytoolTimeblocks,
  type InsertTaskChecklistItem,
  type InsertKeyDateMapping,
  type InsertMytoolTimeblock,
  type InsertTaskActivityLog,
  type InsertTaskAttachment,
  type InsertTaskChecklist,
  type InsertTaskComment,
  type InsertWritebackAuditLog,
  type InsertWritebackMapping,
  type InsertWorkItem,
  type KeyDateMapping,
  type MytoolTimeblock,
  type TaskActivityLog,
  type TaskAttachment,
  type TaskChecklist,
  type TaskChecklistItem,
  type TaskComment,
  type WorkItem,
  type WritebackAuditLog,
  type WritebackMapping,
} from "@shared/schema";
import {
  toPersonalTaskShape,
  fromWorkItem,
  personalStatusToWorkItem,
  personalPriorityToWorkItem,
  workItemStatusToPersonal,
} from "@shared/types/unified-task";

type DbInstance = typeof db;

export class WorkManagementRepository {
  private _dbInstance?: DbInstance;

  constructor(dbInstance?: DbInstance) {
    this._dbInstance = dbInstance;
  }

  private get dbInstance(): DbInstance {
    return this._dbInstance || db;
  }

  async getAllOperationalTasks(): Promise<any[]> {
    const items = await this.dbInstance.select().from(workItems).where(isNull(workItems.deletedAt));
    return items as any[];
  }
  async getOperationalTasksByProject(projectName: string): Promise<any[]> {
    return this.dbInstance.select().from(workItems).where(and(
      isNull(workItems.deletedAt),
      sql`EXISTS (SELECT 1 FROM project_info pi WHERE pi.id = ${workItems.projectId} AND pi.project_name = ${projectName})`
    )).orderBy(workItems.sortOrder) as any;
  }
  async getOperationalTask(id: number): Promise<any | undefined> {
    const results = await this.dbInstance.select().from(workItems).where(eq(workItems.id, id));
    return results[0];
  }
  async createOperationalTask(data: any): Promise<any> {
    const now = new Date();
    const assigneeUserIds = Array.isArray(data.assigneeUserIds)
      ? [...new Set(data.assigneeUserIds.map((id: any) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0))]
      : [];

    const [created] = await this.dbInstance.transaction(async (tx: any) => {
      const [task] = await tx.insert(workItems).values({
        projectId: data.projectId,
        title: data.title || data.taskName || 'Untitled',
        description: data.description,
        status: data.status || 'Not Started',
        priority: data.priority,
        startDate: data.startDate,
        endDate: data.dueDate,
        ownerUserId: data.ownerUserId,
        workstream: 'ENG' as any,
        source: 'UI' as any,
        sortOrder: data.sortOrder,
        holdReason: data.holdReason,
        blockedType: data.blockedType,
        approvalRequired: data.approvalRequired,
        linkedPlanItemId: data.linkedPlanItemId,
        linkedDeliverableId: data.linkedDeliverableId,
        taskTypeTag: data.taskTypeTag,
        blockerReason: data.blockerReason,
        createdAt: now,
        updatedAt: now,
      }).returning();

      if (assigneeUserIds.length > 0) {
        await tx.insert(workItemAssignments).values(
          assigneeUserIds.map((userId: any) => ({
            workItemId: task.id,
            userId,
            role: "ASSIGNEE" as any,
            createdAt: now,
          })) as any,
        );
      }

      return [task];
    });
    return created;
  }
  async updateOperationalTask(id: number, data: any): Promise<any> {
    const mapped: any = { ...data, updatedAt: new Date() };
    if (data.dueDate !== undefined) { mapped.endDate = data.dueDate; delete mapped.dueDate; }
    if (data.taskName !== undefined) { mapped.title = data.taskName; delete mapped.taskName; }
    const [updated] = await this.dbInstance.update(workItems).set(mapped).where(eq(workItems.id, id)).returning();
    return updated;
  }
  async deleteOperationalTask(id: number): Promise<void> {
    await this.dbInstance.update(workItems).set({ deletedAt: new Date() }).where(eq(workItems.id, id));
  }

  async getTaskComments(taskId: number): Promise<TaskComment[]> { return this.dbInstance.select().from(taskComments).where(eq(taskComments.workItemId, taskId)).orderBy(desc(taskComments.createdAt)); }
  async createTaskComment(data: InsertTaskComment): Promise<TaskComment> { const [created] = await this.dbInstance.insert(taskComments).values({ ...data, createdAt: new Date() }).returning(); return created; }
  async deleteTaskComment(id: number): Promise<void> { await this.dbInstance.delete(taskComments).where(eq(taskComments.id, id)); }

  async getTaskChecklists(taskId: number): Promise<TaskChecklist[]> { return this.dbInstance.select().from(taskChecklists).where(eq(taskChecklists.workItemId, taskId)).orderBy(taskChecklists.sortOrder); }
  async createTaskChecklist(data: InsertTaskChecklist): Promise<TaskChecklist> { const [created] = await this.dbInstance.insert(taskChecklists).values({ ...data, createdAt: new Date() }).returning(); return created; }
  async deleteTaskChecklist(id: number): Promise<void> { await this.dbInstance.delete(taskChecklists).where(eq(taskChecklists.id, id)); }

  async getChecklistItems(checklistId: number): Promise<TaskChecklistItem[]> { return this.dbInstance.select().from(taskChecklistItems).where(eq(taskChecklistItems.checklistId, checklistId)).orderBy(taskChecklistItems.sortOrder); }
  async createChecklistItem(data: InsertTaskChecklistItem): Promise<TaskChecklistItem> { const [created] = await this.dbInstance.insert(taskChecklistItems).values({ ...data, createdAt: new Date() }).returning(); return created; }
  async updateChecklistItem(id: number, data: Partial<InsertTaskChecklistItem>): Promise<TaskChecklistItem> { const [updated] = await this.dbInstance.update(taskChecklistItems).set(data).where(eq(taskChecklistItems.id, id)).returning(); return updated; }
  async deleteChecklistItem(id: number): Promise<void> { await this.dbInstance.delete(taskChecklistItems).where(eq(taskChecklistItems.id, id)); }

  async getTaskAttachments(taskId: number): Promise<TaskAttachment[]> { return this.dbInstance.select().from(taskAttachments).where(eq(taskAttachments.workItemId, taskId)).orderBy(desc(taskAttachments.createdAt)); }
  async createTaskAttachment(data: InsertTaskAttachment): Promise<TaskAttachment> { const [created] = await this.dbInstance.insert(taskAttachments).values({ ...data, createdAt: new Date() }).returning(); return created; }
  async deleteTaskAttachment(id: number): Promise<void> { await this.dbInstance.delete(taskAttachments).where(eq(taskAttachments.id, id)); }

  async getTaskActivityLog(taskId: number): Promise<TaskActivityLog[]> { return this.dbInstance.select().from(taskActivityLog).where(eq(taskActivityLog.workItemId, taskId)).orderBy(desc(taskActivityLog.createdAt)); }
  async createTaskActivityLog(data: InsertTaskActivityLog): Promise<TaskActivityLog> { const [created] = await this.dbInstance.insert(taskActivityLog).values({ ...data, createdAt: new Date() }).returning(); return created; }

  async getAllWritebackMappings(): Promise<WritebackMapping[]> { return this.dbInstance.select().from(writebackMappings).orderBy(desc(writebackMappings.createdAt)); }
  async getWritebackMapping(id: number): Promise<WritebackMapping | undefined> { const [mapping] = await this.dbInstance.select().from(writebackMappings).where(eq(writebackMappings.id, id)); return mapping; }
  async createWritebackMapping(data: InsertWritebackMapping): Promise<WritebackMapping> { const now = new Date(); const [created] = await this.dbInstance.insert(writebackMappings).values({ ...data, createdAt: now, updatedAt: now }).returning(); return created; }
  async updateWritebackMapping(id: number, data: Partial<InsertWritebackMapping>): Promise<WritebackMapping> { const [updated] = await this.dbInstance.update(writebackMappings).set({ ...data, updatedAt: new Date() }).where(eq(writebackMappings.id, id)).returning(); return updated; }
  async deleteWritebackMapping(id: number): Promise<void> { await this.dbInstance.delete(writebackMappings).where(eq(writebackMappings.id, id)); }

  async getWritebackAuditLogs(mappingId?: number): Promise<WritebackAuditLog[]> {
    if (mappingId !== undefined) {
      return this.dbInstance.select().from(writebackAuditLog).where(eq(writebackAuditLog.mappingId, mappingId)).orderBy(desc(writebackAuditLog.appliedAt));
    }
    return this.dbInstance.select().from(writebackAuditLog).orderBy(desc(writebackAuditLog.appliedAt));
  }
  async createWritebackAuditLog(data: InsertWritebackAuditLog): Promise<WritebackAuditLog> { const [created] = await this.dbInstance.insert(writebackAuditLog).values({ ...data, appliedAt: new Date() }).returning(); return created; }
  async updateWritebackAuditLog(id: number, data: Partial<InsertWritebackAuditLog>): Promise<WritebackAuditLog> { const [updated] = await this.dbInstance.update(writebackAuditLog).set(data).where(eq(writebackAuditLog.id, id)).returning(); return updated; }

  async getKeyDateMappings(projectName: string): Promise<KeyDateMapping[]> { return this.dbInstance.select().from(keyDateMappings).where(eq(keyDateMappings.projectName, projectName)).orderBy(keyDateMappings.sortOrder); }
  async createKeyDateMapping(data: InsertKeyDateMapping): Promise<KeyDateMapping> { const [created] = await this.dbInstance.insert(keyDateMappings).values(data).returning(); return created; }
  async updateKeyDateMapping(id: number, data: Partial<InsertKeyDateMapping>): Promise<KeyDateMapping> { const [updated] = await this.dbInstance.update(keyDateMappings).set({ ...data, updatedAt: new Date() }).where(eq(keyDateMappings.id, id)).returning(); return updated; }
  async deleteKeyDateMapping(id: number): Promise<void> { await this.dbInstance.delete(keyDateMappings).where(eq(keyDateMappings.id, id)); }

  // ── Personal Tasks (unified: reads/writes work_items with workstream='PERSONAL') ──

  private workItemToMytoolShape(row: WorkItem): any {
    return toPersonalTaskShape(fromWorkItem(row));
  }

  async getMytoolTasks(ownerUserId: number): Promise<any[]> {
    const rows = await this.dbInstance.select().from(workItems).where(
      and(
        eq(workItems.workstream, "PERSONAL"),
        eq(workItems.ownerUserId, ownerUserId),
        isNull(workItems.deletedAt),
      )
    ).orderBy(workItems.sortOrder);
    return rows.map((r: any) => this.workItemToMytoolShape(r));
  }

  async getMytoolTasksByDate(ownerUserId: number, date: string): Promise<any[]> {
    const rows = await this.dbInstance.select().from(workItems).where(
      and(
        eq(workItems.workstream, "PERSONAL"),
        eq(workItems.ownerUserId, ownerUserId),
        isNull(workItems.deletedAt),
        or(
          eq(workItems.scheduledDate, date),
          and(
            not(inArray(workItems.status, ["COMPLETE"])),
            sql`${workItems.scheduledDate} < ${date}`
          ),
          and(
            not(inArray(workItems.status, ["COMPLETE"])),
            sql`${workItems.scheduledDate} IS NULL`
          ),
        )
      )
    ).orderBy(workItems.sortOrder);
    return rows.map((r: any) => this.workItemToMytoolShape(r));
  }

  async getMytoolTask(id: number): Promise<any | undefined> {
    const [row] = await this.dbInstance.select().from(workItems).where(eq(workItems.id, id));
    return row ? this.workItemToMytoolShape(row) : undefined;
  }

  async createMytoolTask(data: any): Promise<any> {
    const now = new Date();
    const [created] = await this.dbInstance.insert(workItems).values({
      title: data.title,
      description: data.notes || null,
      status: personalStatusToWorkItem(data.status || "inbox"),
      priority: personalPriorityToWorkItem(data.priority || "normal"),
      workstream: "PERSONAL",
      source: "UI",
      ownerUserId: data.ownerUserId,
      createdBy: data.ownerUserId,
      projectId: data.projectId || null,
      scheduledDate: data.plannedForDate || data.scheduledDate || null,
      endDate: data.dueAt ? new Date(data.dueAt).toISOString().slice(0, 10) : null,
      startDate: data.startDate || null,
      bucket: data.bucket || "personal",
      sourceEmailId: data.sourceEmailId || null,
      sourceEmailSubject: data.sourceEmailSubject || null,
      nextStep: data.nextStep || null,
      definitionOfDone: data.definitionOfDone || null,
      completionNote: data.completionNote || null,
      pinnedToday: data.pinnedToday ?? false,
      pinnedWeek: data.pinnedWeek ?? false,
      sortOrder: data.sortOrder ?? 0,
      isRecurring: data.isRecurring ?? false,
      recurrenceFrequency: data.recurrenceFrequency || null,
      recurrenceInterval: data.recurrenceInterval ?? 1,
      recurrenceDaysOfWeek: data.recurrenceDaysOfWeek || null,
      recurrenceEndDate: data.recurrenceEndDate || null,
      recurrenceParentId: data.recurrenceParentId || null,
      type: data.taskType === "milestone" ? "milestone" : null,
      scheduledStartTime: data.scheduledStartTime || null,
      scheduledEndTime: data.scheduledEndTime || null,
      taskCategory: null,
      taskTypeTag: data.tag || null,
      holdReason: data.blockedReason || null,
      createdAt: now,
      updatedAt: now,
    } as any).returning();
    return this.workItemToMytoolShape(created);
  }

  async updateMytoolTask(id: number, data: any): Promise<any> {
    const updateFields: Record<string, any> = { updatedAt: new Date() };

    if (data.title !== undefined) updateFields.title = data.title;
    if (data.notes !== undefined) updateFields.description = data.notes;
    if (data.status !== undefined) {
      updateFields.status = personalStatusToWorkItem(data.status);
      if (data.status === "done") updateFields.completedAt = new Date();
    }
    if (data.priority !== undefined) updateFields.priority = personalPriorityToWorkItem(data.priority);
    if (data.plannedForDate !== undefined) updateFields.scheduledDate = data.plannedForDate;
    if (data.dueAt !== undefined) updateFields.endDate = data.dueAt ? new Date(data.dueAt).toISOString().slice(0, 10) : null;
    if (data.startDate !== undefined) updateFields.startDate = data.startDate;
    if (data.bucket !== undefined) updateFields.bucket = data.bucket;
    if (data.projectName !== undefined) updateFields.subProjectName = data.projectName;
    if (data.projectId !== undefined) updateFields.projectId = data.projectId || null;
    if (data.sourceEmailId !== undefined) updateFields.sourceEmailId = data.sourceEmailId;
    if (data.sourceEmailSubject !== undefined) updateFields.sourceEmailSubject = data.sourceEmailSubject;
    if (data.blockedReason !== undefined) updateFields.holdReason = data.blockedReason;
    if (data.nextStep !== undefined) updateFields.nextStep = data.nextStep;
    if (data.definitionOfDone !== undefined) updateFields.definitionOfDone = data.definitionOfDone;
    if (data.completionNote !== undefined) updateFields.completionNote = data.completionNote;
    if (data.pinnedToday !== undefined) updateFields.pinnedToday = data.pinnedToday;
    if (data.pinnedWeek !== undefined) updateFields.pinnedWeek = data.pinnedWeek;
    if (data.sortOrder !== undefined) updateFields.sortOrder = data.sortOrder;
    if (data.isRecurring !== undefined) updateFields.isRecurring = data.isRecurring;
    if (data.recurrenceFrequency !== undefined) updateFields.recurrenceFrequency = data.recurrenceFrequency;
    if (data.recurrenceInterval !== undefined) updateFields.recurrenceInterval = data.recurrenceInterval;
    if (data.recurrenceDaysOfWeek !== undefined) updateFields.recurrenceDaysOfWeek = data.recurrenceDaysOfWeek;
    if (data.recurrenceEndDate !== undefined) updateFields.recurrenceEndDate = data.recurrenceEndDate;
    if (data.recurrenceParentId !== undefined) updateFields.recurrenceParentId = data.recurrenceParentId;
    if (data.scheduledDate !== undefined) updateFields.scheduledDate = data.scheduledDate;
    if (data.scheduledStartTime !== undefined) updateFields.scheduledStartTime = data.scheduledStartTime;
    if (data.scheduledEndTime !== undefined) updateFields.scheduledEndTime = data.scheduledEndTime;
    if (data.tag !== undefined) updateFields.taskTypeTag = data.tag;

    const [updated] = await this.dbInstance.update(workItems).set(updateFields).where(eq(workItems.id, id)).returning();
    return this.workItemToMytoolShape(updated);
  }

  async deleteMytoolTask(id: number): Promise<void> {
    await this.dbInstance.update(workItems).set({ deletedAt: new Date() }).where(eq(workItems.id, id));
  }

  async getMytoolTimeblocks(ownerUserId: number, date: string): Promise<MytoolTimeblock[]> {
    return this.dbInstance.select().from(mytoolTimeblocks).where(and(eq(mytoolTimeblocks.ownerUserId, ownerUserId), eq(mytoolTimeblocks.date, date)));
  }
  async createMytoolTimeblock(data: InsertMytoolTimeblock): Promise<MytoolTimeblock> { const now = new Date(); const [created] = await this.dbInstance.insert(mytoolTimeblocks).values({ ...data, createdAt: now, updatedAt: now }).returning(); return created; }
  async updateMytoolTimeblock(id: number, data: Partial<InsertMytoolTimeblock>): Promise<MytoolTimeblock> { const [updated] = await this.dbInstance.update(mytoolTimeblocks).set({ ...data, updatedAt: new Date() }).where(eq(mytoolTimeblocks.id, id)).returning(); return updated; }
  async deleteMytoolTimeblock(id: number): Promise<void> { await this.dbInstance.delete(mytoolTimeblocks).where(eq(mytoolTimeblocks.id, id)); }

  /**
   * All non-deleted work_items rows for a single project — full-row shape
   * so callers can project as needed (financial-integration warnings,
   * sync-status readouts, critical-path probes).
   */
  async listByProjectIdNonDeleted(projectId: number): Promise<WorkItem[]> {
    return this.dbInstance
      .select()
      .from(workItems)
      .where(and(
        eq(workItems.projectId, projectId),
        isNull(workItems.deletedAt),
      ));
  }

  // ── Plan structure helpers (PM workstream over work_items) ──

  async listPmTopLevelWbsCodes(projectId: number): Promise<string[]> {
    const rows = await this.dbInstance
      .select({ wbsCode: workItems.wbsCode })
      .from(workItems)
      .where(and(
        eq(workItems.projectId, projectId),
        eq(workItems.workstream, "PM"),
        isNull(workItems.deletedAt),
        isNull(workItems.parentId),
      ))
      .orderBy(desc(workItems.id));
    return rows.map((r: { wbsCode: string | null }) => r.wbsCode).filter((c: string | null): c is string => Boolean(c));
  }

  async getMaxSortOrder(projectId: number): Promise<number> {
    const rows = await this.dbInstance
      .select({ maxSort: sql<number>`COALESCE(MAX(${workItems.sortOrder}), 0)` })
      .from(workItems)
      .where(and(
        eq(workItems.projectId, projectId),
        isNull(workItems.deletedAt),
      ));
    return Number(rows[0]?.maxSort ?? 0);
  }

  async createPmMilestone(input: {
    projectId: number;
    title: string;
    wbsCode: string;
    sortOrder: number;
    createdBy: number | null;
  }): Promise<{ id: number; wbsCode: string }> {
    const [created] = await this.dbInstance.insert(workItems).values({
      projectId: input.projectId,
      workstream: "PM",
      source: "UI",
      title: input.title,
      status: "Not Started",
      priority: "Normal",
      startDate: null,
      endDate: null,
      duration: 0,
      percentComplete: 0,
      wbsCode: input.wbsCode,
      indentLevel: 0,
      parentId: null,
      isMilestone: true,
      createdBy: input.createdBy,
      taskMode: "auto",
      sortOrder: input.sortOrder,
    } as InsertWorkItem).returning();
    return { id: created.id, wbsCode: input.wbsCode };
  }

  async getIndentLevel(id: number): Promise<number> {
    const rows = await this.dbInstance
      .select({ indentLevel: workItems.indentLevel })
      .from(workItems)
      .where(eq(workItems.id, id));
    return rows[0]?.indentLevel ?? 0;
  }

  async setParentAndIndent(id: number, parentId: number, indentLevel: number): Promise<void> {
    await this.dbInstance
      .update(workItems)
      .set({ parentId, indentLevel, updatedAt: new Date() })
      .where(eq(workItems.id, id));
  }

  async markAsMilestoneIfNot(id: number): Promise<void> {
    await this.dbInstance
      .update(workItems)
      .set({ isMilestone: true, updatedAt: new Date() })
      .where(and(eq(workItems.id, id), eq(workItems.isMilestone, false)));
  }

  async clearParent(id: number): Promise<void> {
    await this.dbInstance
      .update(workItems)
      .set({ parentId: null, indentLevel: 0, updatedAt: new Date() })
      .where(eq(workItems.id, id));
  }

  async clearParentByParentId(parentId: number): Promise<void> {
    await this.dbInstance
      .update(workItems)
      .set({ parentId: null, indentLevel: 0, updatedAt: new Date() })
      .where(eq(workItems.parentId, parentId));
  }

  async softDeleteWorkItem(id: number): Promise<void> {
    const now = new Date();
    await this.dbInstance
      .update(workItems)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(workItems.id, id));
  }

  async setParentBatch(parentWorkItemId: number, workItemIds: number[]): Promise<void> {
    if (workItemIds.length === 0) return;
    await this.dbInstance.transaction(async (tx: typeof db) => {
      const parentItem = await tx
        .select({ indentLevel: workItems.indentLevel })
        .from(workItems)
        .where(eq(workItems.id, parentWorkItemId));
      const parentIndent = parentItem[0]?.indentLevel ?? 0;
      const now = new Date();
      for (const wiId of workItemIds) {
        await tx
          .update(workItems)
          .set({ parentId: parentWorkItemId, indentLevel: parentIndent + 1, updatedAt: now })
          .where(eq(workItems.id, wiId));
      }
      await tx
        .update(workItems)
        .set({ isMilestone: true, updatedAt: now })
        .where(and(eq(workItems.id, parentWorkItemId), eq(workItems.isMilestone, false)));
    });
  }

  async setSortOrders(items: Array<{ id: number; sortOrder: number }>): Promise<void> {
    if (items.length === 0) return;
    await this.dbInstance.transaction(async (tx: typeof db) => {
      const now = new Date();
      for (const item of items) {
        await tx
          .update(workItems)
          .set({ sortOrder: item.sortOrder, updatedAt: now })
          .where(eq(workItems.id, item.id));
      }
    });
  }

  async listPmWbsTree(projectId: number): Promise<Array<{
    id: number;
    parentId: number | null;
    wbsCode: string | null;
    sortOrder: number | null;
  }>> {
    const rows = await this.dbInstance
      .select({
        id: workItems.id,
        parentId: workItems.parentId,
        wbsCode: workItems.wbsCode,
        sortOrder: workItems.sortOrder,
      })
      .from(workItems)
      .where(and(
        eq(workItems.projectId, projectId),
        eq(workItems.workstream, "PM"),
        isNull(workItems.deletedAt),
      ))
      .orderBy(asc(workItems.sortOrder), asc(workItems.id));
    return rows;
  }

  async applyWbsRenumber(updates: Array<{ id: number; wbsCode: string; indentLevel: number }>): Promise<void> {
    if (updates.length === 0) return;
    await this.dbInstance.transaction(async (tx: typeof db) => {
      const now = new Date();
      for (const u of updates) {
        await tx
          .update(workItems)
          .set({ wbsCode: u.wbsCode, indentLevel: u.indentLevel, updatedAt: now })
          .where(eq(workItems.id, u.id));
      }
    });
  }
}
