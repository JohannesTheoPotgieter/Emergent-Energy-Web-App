import { db } from "../db";
import { and, desc, eq, inArray, isNull, not, or, sql } from "drizzle-orm";
import {
  workItems,
  taskComments,
  taskChecklists,
  taskChecklistItems,
  taskAttachments,
  taskActivityLog,
  writebackMappings,
  writebackAuditLog,
  keyDateMappings,
  mytoolTasks,
  mytoolTimeblocks,
  type InsertTaskChecklistItem,
  type InsertKeyDateMapping,
  type InsertMytoolTask,
  type InsertMytoolTimeblock,
  type InsertTaskActivityLog,
  type InsertTaskAttachment,
  type InsertTaskChecklist,
  type InsertTaskComment,
  type InsertWritebackAuditLog,
  type InsertWritebackMapping,
  type KeyDateMapping,
  type MytoolTask,
  type MytoolTimeblock,
  type TaskActivityLog,
  type TaskAttachment,
  type TaskChecklist,
  type TaskChecklistItem,
  type TaskComment,
  type WritebackAuditLog,
  type WritebackMapping,
} from "@shared/schema";

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
    const [created] = await this.dbInstance.insert(workItems).values({
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

  async getTaskComments(taskId: number): Promise<TaskComment[]> { return this.dbInstance.select().from(taskComments).where(eq(taskComments.taskId, taskId)).orderBy(desc(taskComments.createdAt)); }
  async createTaskComment(data: InsertTaskComment): Promise<TaskComment> { const [created] = await this.dbInstance.insert(taskComments).values({ ...data, createdAt: new Date() }).returning(); return created; }
  async deleteTaskComment(id: number): Promise<void> { await this.dbInstance.delete(taskComments).where(eq(taskComments.id, id)); }

  async getTaskChecklists(taskId: number): Promise<TaskChecklist[]> { return this.dbInstance.select().from(taskChecklists).where(eq(taskChecklists.taskId, taskId)).orderBy(taskChecklists.sortOrder); }
  async createTaskChecklist(data: InsertTaskChecklist): Promise<TaskChecklist> { const [created] = await this.dbInstance.insert(taskChecklists).values({ ...data, createdAt: new Date() }).returning(); return created; }
  async deleteTaskChecklist(id: number): Promise<void> { await this.dbInstance.delete(taskChecklists).where(eq(taskChecklists.id, id)); }

  async getChecklistItems(checklistId: number): Promise<TaskChecklistItem[]> { return this.dbInstance.select().from(taskChecklistItems).where(eq(taskChecklistItems.checklistId, checklistId)).orderBy(taskChecklistItems.sortOrder); }
  async createChecklistItem(data: InsertTaskChecklistItem): Promise<TaskChecklistItem> { const [created] = await this.dbInstance.insert(taskChecklistItems).values({ ...data, createdAt: new Date() }).returning(); return created; }
  async updateChecklistItem(id: number, data: Partial<InsertTaskChecklistItem>): Promise<TaskChecklistItem> { const [updated] = await this.dbInstance.update(taskChecklistItems).set(data).where(eq(taskChecklistItems.id, id)).returning(); return updated; }
  async deleteChecklistItem(id: number): Promise<void> { await this.dbInstance.delete(taskChecklistItems).where(eq(taskChecklistItems.id, id)); }

  async getTaskAttachments(taskId: number): Promise<TaskAttachment[]> { return this.dbInstance.select().from(taskAttachments).where(eq(taskAttachments.taskId, taskId)).orderBy(desc(taskAttachments.createdAt)); }
  async createTaskAttachment(data: InsertTaskAttachment): Promise<TaskAttachment> { const [created] = await this.dbInstance.insert(taskAttachments).values({ ...data, createdAt: new Date() }).returning(); return created; }
  async deleteTaskAttachment(id: number): Promise<void> { await this.dbInstance.delete(taskAttachments).where(eq(taskAttachments.id, id)); }

  async getTaskActivityLog(taskId: number): Promise<TaskActivityLog[]> { return this.dbInstance.select().from(taskActivityLog).where(eq(taskActivityLog.taskId, taskId)).orderBy(desc(taskActivityLog.createdAt)); }
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

  async getMytoolTasks(ownerUserId: number): Promise<MytoolTask[]> {
    return this.dbInstance.select().from(mytoolTasks).where(and(eq(mytoolTasks.ownerUserId, ownerUserId), isNull(mytoolTasks.deletedAt))).orderBy(mytoolTasks.sortOrder);
  }
  async getMytoolTasksByDate(ownerUserId: number, date: string): Promise<MytoolTask[]> {
    return this.dbInstance.select().from(mytoolTasks).where(and(eq(mytoolTasks.ownerUserId, ownerUserId), isNull(mytoolTasks.deletedAt), or(eq(mytoolTasks.plannedForDate, date), and(not(inArray(mytoolTasks.status, ["done", "cancelled"])), sql`${mytoolTasks.plannedForDate} < ${date}`), and(not(inArray(mytoolTasks.status, ["done", "cancelled"])), sql`${mytoolTasks.plannedForDate} IS NULL`)))).orderBy(mytoolTasks.sortOrder);
  }
  async getMytoolTask(id: number): Promise<MytoolTask | undefined> { const [task] = await this.dbInstance.select().from(mytoolTasks).where(eq(mytoolTasks.id, id)); return task; }
  async createMytoolTask(data: InsertMytoolTask): Promise<MytoolTask> { const now = new Date(); const [created] = await this.dbInstance.insert(mytoolTasks).values({ ...data, createdAt: now, updatedAt: now }).returning(); return created; }
  async updateMytoolTask(id: number, data: Partial<InsertMytoolTask>): Promise<MytoolTask> {
    const updateData: Partial<InsertMytoolTask> & { updatedAt: Date; completedAt?: Date } = { ...data, updatedAt: new Date() };
    if ((data as { status?: string }).status === "done") updateData.completedAt = new Date();
    const [updated] = await this.dbInstance.update(mytoolTasks).set(updateData).where(eq(mytoolTasks.id, id)).returning();
    return updated;
  }
  async deleteMytoolTask(id: number): Promise<void> { await this.dbInstance.update(mytoolTasks).set({ deletedAt: new Date() }).where(eq(mytoolTasks.id, id)); }

  async getMytoolTimeblocks(ownerUserId: number, date: string): Promise<MytoolTimeblock[]> {
    return this.dbInstance.select().from(mytoolTimeblocks).where(and(eq(mytoolTimeblocks.ownerUserId, ownerUserId), eq(mytoolTimeblocks.date, date)));
  }
  async createMytoolTimeblock(data: InsertMytoolTimeblock): Promise<MytoolTimeblock> { const now = new Date(); const [created] = await this.dbInstance.insert(mytoolTimeblocks).values({ ...data, createdAt: now, updatedAt: now }).returning(); return created; }
  async updateMytoolTimeblock(id: number, data: Partial<InsertMytoolTimeblock>): Promise<MytoolTimeblock> { const [updated] = await this.dbInstance.update(mytoolTimeblocks).set({ ...data, updatedAt: new Date() }).where(eq(mytoolTimeblocks.id, id)).returning(); return updated; }
  async deleteMytoolTimeblock(id: number): Promise<void> { await this.dbInstance.delete(mytoolTimeblocks).where(eq(mytoolTimeblocks.id, id)); }
}
