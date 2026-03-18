// @ts-nocheck
import type { Request } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  approvals,
  changeRequests,
  commissioningItems,
  counterparties,
  counterpartyContacts,
  deliverables,
  engineeringTasks,
  entityAssignments,
  mytoolTasks,
  operationalTasks,
  procurementItems,
  projectEngApprovals,
  projectInfo,
  qcChecklist,
  qcItemInstance,
  raidItems,
  trItems,
  users,
  workItemAssignments,
  workItems,
  type AssigneeType,
} from "@shared/schema";
import { db } from "../db";
import { getEffectiveUser } from "../auth-context";
import { logAuditFromReq } from "../audit-logger";
import { evaluateAuthorityForRequest } from "../permission-middleware";

export const ASSIGNMENT_ENTITY_TYPES = [
  "personal_task",
  "operational_task",
  "tr_item",
  "work_item",
  "engineering_task",
  "quality_item",
  "deliverable",
  "approval",
  "project_eng_approval",
  "procurement_item",
  "raid_item",
  "commissioning_item",
  "change_request",
] as const;

export type AssignmentEntityType = typeof ASSIGNMENT_ENTITY_TYPES[number];
export type AssignmentRole = "OWNER" | "ASSIGNEE" | "APPROVER" | "REVIEWER" | "VIEWER";

export type AssignableDirectoryEntry = {
  assigneeType: AssigneeType;
  assigneeId: number;
  displayLabel: string;
  secondaryLabel: string | null;
  sourceLabel: string;
  counterpartyId: number | null;
  contactId: number | null;
  isActive: boolean;
  roleTags: string[];
};

export type ResolvedAssignment = {
  id: number | null;
  entityType: AssignmentEntityType;
  entityId: number;
  assignmentRole: AssignmentRole;
  assigneeType: AssigneeType;
  assigneeId: number;
  displayLabel: string;
  displayLabelSnapshot: string;
  secondaryLabel: string | null;
  active: boolean;
};

export type SetEntityAssignmentInput = {
  entityType: AssignmentEntityType;
  entityId: number;
  assignmentRole?: AssignmentRole;
  assigneeType: AssigneeType | null;
  assigneeId: number | null;
  mode?: "replace" | "append" | "clear";
  metadata?: Record<string, unknown> | null;
};

type Queryable = typeof db;

const TASK_SOURCE_TO_ENTITY_TYPE: Record<string, AssignmentEntityType> = {
  personal: "personal_task",
  operational: "operational_task",
  tr_register: "tr_item",
  plan: "work_item",
  engineering_task: "engineering_task",
  quality_task: "quality_item",
  deliverable: "deliverable",
  approval: "approval",
  project_eng_approval: "project_eng_approval",
  procurement_item: "procurement_item",
  raid_item: "raid_item",
  commissioning_item: "commissioning_item",
  change_request: "change_request",
};

const ENTITY_PERMISSION_BY_TYPE: Record<AssignmentEntityType, string> = {
  personal_task: "my_work",
  operational_task: "operational_tasks",
  tr_item: "tr_register",
  work_item: "work_items",
  engineering_task: "eng_tasks",
  quality_item: "quality",
  deliverable: "deliverables",
  approval: "approvals",
  project_eng_approval: "approvals",
  procurement_item: "procurement",
  raid_item: "projects",
  commissioning_item: "projects",
  change_request: "projects",
};

const MULTI_ASSIGNMENT_TYPES = new Set<AssignmentEntityType>(["operational_task", "tr_item", "work_item"]);
const EXTERNAL_ASSIGNMENT_TYPES = new Set<AssignmentEntityType>(["operational_task", "tr_item", "quality_item", "deliverable"]);

function toInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sanitizeSearch(search?: string | null): string {
  return String(search || "").trim().toLowerCase();
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).filter(Boolean);
  }

  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry)).filter(Boolean);
    }
  } catch {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

function isExternalAssignee(assigneeType: AssigneeType): boolean {
  return assigneeType === "external_counterparty" || assigneeType === "external_contact";
}

export function isExternalAssignmentEnabledForEntity(entityType: AssignmentEntityType): boolean {
  return EXTERNAL_ASSIGNMENT_TYPES.has(entityType);
}

export function isAssignmentModeMulti(entityType: AssignmentEntityType): boolean {
  return MULTI_ASSIGNMENT_TYPES.has(entityType);
}

async function resolveAssignableTarget(assigneeType: AssigneeType, assigneeId: number): Promise<AssignableDirectoryEntry | null> {
  if (assigneeType === "internal_user") {
    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, assigneeId))
      .limit(1);

    if (!user) return null;
    return {
      assigneeType,
      assigneeId: user.id,
      displayLabel: user.name,
      secondaryLabel: user.email || user.role || null,
      sourceLabel: "Internal user",
      counterpartyId: null,
      contactId: null,
      isActive: true,
      roleTags: user.role ? [user.role] : [],
    };
  }

  if (assigneeType === "external_counterparty") {
    const [counterparty] = await db
      .select({
        id: counterparties.id,
        nameCanonical: counterparties.nameCanonical,
        isActive: counterparties.isActive,
        roleTags: counterparties.roleTags,
        typeDefault: counterparties.typeDefault,
      })
      .from(counterparties)
      .where(eq(counterparties.id, assigneeId))
      .limit(1);

    if (!counterparty) return null;
    return {
      assigneeType,
      assigneeId: counterparty.id,
      displayLabel: counterparty.nameCanonical,
      secondaryLabel: counterparty.typeDefault || null,
      sourceLabel: "External counterparty",
      counterpartyId: counterparty.id,
      contactId: null,
      isActive: Boolean(counterparty.isActive),
      roleTags: parseStringArray(counterparty.roleTags),
    };
  }

  const [contact] = await db
    .select({
      id: counterpartyContacts.id,
      name: counterpartyContacts.name,
      email: counterpartyContacts.email,
      isActive: counterpartyContacts.isActive,
      roleTags: counterpartyContacts.roleTags,
      counterpartyId: counterpartyContacts.counterpartyId,
      counterpartyName: counterparties.nameCanonical,
    })
    .from(counterpartyContacts)
    .leftJoin(counterparties, eq(counterpartyContacts.counterpartyId, counterparties.id))
    .where(eq(counterpartyContacts.id, assigneeId))
    .limit(1);

  if (!contact) return null;
  return {
    assigneeType,
    assigneeId: contact.id,
    displayLabel: contact.name,
    secondaryLabel: contact.counterpartyName || contact.email || null,
    sourceLabel: "External contact",
    counterpartyId: toInt(contact.counterpartyId),
    contactId: contact.id,
    isActive: Boolean(contact.isActive),
    roleTags: parseStringArray(contact.roleTags),
  };
}

function filterDirectory<T extends AssignableDirectoryEntry>(entries: T[], search?: string | null): T[] {
  const query = sanitizeSearch(search);
  if (!query) return entries;
  return entries.filter((entry) =>
    [entry.displayLabel, entry.secondaryLabel, entry.sourceLabel, ...entry.roleTags]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query)),
  );
}

export async function listAssignableDirectory(search?: string | null): Promise<AssignableDirectoryEntry[]> {
  const [internalUsers, externalCounterparties, externalContacts] = await Promise.all([
    db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    }).from(users).orderBy(asc(users.name)),
    db.select({
      id: counterparties.id,
      nameCanonical: counterparties.nameCanonical,
      isActive: counterparties.isActive,
      roleTags: counterparties.roleTags,
      typeDefault: counterparties.typeDefault,
    }).from(counterparties).orderBy(asc(counterparties.nameCanonical)),
    db.select({
      id: counterpartyContacts.id,
      name: counterpartyContacts.name,
      email: counterpartyContacts.email,
      isActive: counterpartyContacts.isActive,
      roleTags: counterpartyContacts.roleTags,
      counterpartyId: counterpartyContacts.counterpartyId,
      counterpartyName: counterparties.nameCanonical,
    })
      .from(counterpartyContacts)
      .leftJoin(counterparties, eq(counterpartyContacts.counterpartyId, counterparties.id))
      .orderBy(asc(counterpartyContacts.name)),
  ]);

  const entries: AssignableDirectoryEntry[] = [
    ...internalUsers.map((user) => ({
      assigneeType: "internal_user" as const,
      assigneeId: user.id,
      displayLabel: user.name,
      secondaryLabel: user.email || user.role || null,
      sourceLabel: "Internal user",
      counterpartyId: null,
      contactId: null,
      isActive: true,
      roleTags: user.role ? [user.role] : [],
    })),
    ...externalCounterparties.map((counterparty) => ({
      assigneeType: "external_counterparty" as const,
      assigneeId: counterparty.id,
      displayLabel: counterparty.nameCanonical,
      secondaryLabel: counterparty.typeDefault || null,
      sourceLabel: "External counterparty",
      counterpartyId: counterparty.id,
      contactId: null,
      isActive: Boolean(counterparty.isActive),
      roleTags: parseStringArray(counterparty.roleTags),
    })),
    ...externalContacts.map((contact) => ({
      assigneeType: "external_contact" as const,
      assigneeId: contact.id,
      displayLabel: contact.name,
      secondaryLabel: contact.counterpartyName || contact.email || null,
      sourceLabel: "External contact",
      counterpartyId: toInt(contact.counterpartyId),
      contactId: contact.id,
      isActive: Boolean(contact.isActive),
      roleTags: parseStringArray(contact.roleTags),
    })),
  ];

  return filterDirectory(entries, search);
}

export async function listAssignableDirectoryForEntity(
  entityType: AssignmentEntityType,
  search?: string | null,
): Promise<AssignableDirectoryEntry[]> {
  const entries = await listAssignableDirectory(search);
  if (isExternalAssignmentEnabledForEntity(entityType)) {
    return entries;
  }

  return entries.filter((entry) => entry.assigneeType === "internal_user");
}

export async function listAssignableDirectoryForTaskSource(
  taskSource: string,
  search?: string | null,
): Promise<AssignableDirectoryEntry[]> {
  const entityType = mapTaskSourceToEntityType(taskSource);
  if (!entityType) {
    return listAssignableDirectory(search);
  }

  return listAssignableDirectoryForEntity(entityType, search);
}

export function mapTaskSourceToEntityType(taskSource: string): AssignmentEntityType | null {
  return TASK_SOURCE_TO_ENTITY_TYPE[taskSource] || null;
}

async function getEntityProjectId(executor: Queryable, entityType: AssignmentEntityType, entityId: number): Promise<number | null> {
  switch (entityType) {
    case "personal_task":
      return null;
    case "operational_task": {
      const [row] = await executor.select({ projectId: operationalTasks.projectId }).from(operationalTasks).where(eq(operationalTasks.id, entityId)).limit(1);
      return toInt(row?.projectId);
    }
    case "tr_item":
      return null;
    case "work_item": {
      const [row] = await executor.select({ projectId: workItems.projectId }).from(workItems).where(eq(workItems.id, entityId)).limit(1);
      return toInt(row?.projectId);
    }
    case "engineering_task": {
      const [row] = await executor.select({ projectId: engineeringTasks.projectId }).from(engineeringTasks).where(eq(engineeringTasks.id, entityId)).limit(1);
      return toInt(row?.projectId);
    }
    case "quality_item": {
      const [row] = await executor
        .select({ projectId: qcChecklist.projectId })
        .from(qcItemInstance)
        .innerJoin(qcChecklist, eq(qcItemInstance.checklistId, qcChecklist.id))
        .where(eq(qcItemInstance.id, entityId))
        .limit(1);
      return toInt(row?.projectId);
    }
    case "deliverable": {
      const [row] = await executor.select({ projectId: deliverables.projectId }).from(deliverables).where(eq(deliverables.id, entityId)).limit(1);
      return toInt(row?.projectId);
    }
    case "approval": {
      const [row] = await executor.select({ projectId: approvals.projectId }).from(approvals).where(eq(approvals.id, entityId)).limit(1);
      return toInt(row?.projectId);
    }
    case "project_eng_approval": {
      const [row] = await executor
        .select({ projectId: projectInfo.id })
        .from(projectEngApprovals)
        .innerJoin(projectInfo, sql`${projectInfo.id} = (SELECT project_id FROM project_eng_stages WHERE id = ${projectEngApprovals.projectEngStageId})`)
        .where(eq(projectEngApprovals.id, entityId))
        .limit(1);
      return toInt(row?.projectId);
    }
    case "procurement_item": {
      const [row] = await executor.select({ projectId: procurementItems.projectId }).from(procurementItems).where(eq(procurementItems.id, entityId)).limit(1);
      return toInt(row?.projectId);
    }
    case "raid_item": {
      const [row] = await executor.select({ projectId: raidItems.projectId }).from(raidItems).where(eq(raidItems.id, entityId)).limit(1);
      return toInt(row?.projectId);
    }
    case "commissioning_item": {
      const [row] = await executor.select({ projectId: commissioningItems.projectId }).from(commissioningItems).where(eq(commissioningItems.id, entityId)).limit(1);
      return toInt(row?.projectId);
    }
    case "change_request": {
      const [row] = await executor.select({ projectId: changeRequests.projectId }).from(changeRequests).where(eq(changeRequests.id, entityId)).limit(1);
      return toInt(row?.projectId);
    }
  }
}

async function getCanonicalAssignments(
  executor: Queryable,
  entityType: AssignmentEntityType,
  entityId: number,
  assignmentRole?: AssignmentRole,
): Promise<ResolvedAssignment[]> {
  const conditions = [
    eq(entityAssignments.entityType, entityType),
    eq(entityAssignments.entityId, entityId),
    eq(entityAssignments.active, true),
  ];
  if (assignmentRole) {
    conditions.push(eq(entityAssignments.assignmentRole, assignmentRole));
  }

  const rows = await executor
    .select()
    .from(entityAssignments)
    .where(and(...conditions))
    .orderBy(desc(entityAssignments.assignedAt), desc(entityAssignments.id));

  if (rows.length === 0) return [];

  const resolvedTargets = await Promise.all(
    rows.map((row) => resolveAssignableTarget(row.assigneeType as AssigneeType, row.assigneeId)),
  );

  return rows.map((row, index) => {
    const resolved = resolvedTargets[index];
    return {
      id: row.id,
      entityType,
      entityId,
      assignmentRole: row.assignmentRole as AssignmentRole,
      assigneeType: row.assigneeType as AssigneeType,
      assigneeId: row.assigneeId,
      displayLabel: resolved?.displayLabel || row.displayLabelSnapshot,
      displayLabelSnapshot: row.displayLabelSnapshot,
      secondaryLabel: resolved?.secondaryLabel || null,
      active: Boolean(row.active),
    };
  });
}

async function getLegacyAssignments(executor: Queryable, entityType: AssignmentEntityType, entityId: number): Promise<ResolvedAssignment[]> {
  switch (entityType) {
    case "personal_task": {
      const [task] = await executor.select().from(mytoolTasks).where(eq(mytoolTasks.id, entityId)).limit(1);
      if (!task?.ownerUserId) return [];
      const resolved = await resolveAssignableTarget("internal_user", task.ownerUserId);
      return resolved ? [{
        id: null,
        entityType,
        entityId,
        assignmentRole: "OWNER",
        assigneeType: "internal_user",
        assigneeId: task.ownerUserId,
        displayLabel: resolved.displayLabel,
        displayLabelSnapshot: resolved.displayLabel,
        secondaryLabel: resolved.secondaryLabel,
        active: true,
      }] : [];
    }
    case "operational_task": {
      const [task] = await executor.select().from(operationalTasks).where(eq(operationalTasks.id, entityId)).limit(1);
      if (!task) return [];
      const internalIds = Array.isArray(task.assigneeUserIds) ? task.assigneeUserIds : [];
      const assignments: ResolvedAssignment[] = [];
      for (const userId of internalIds) {
        const resolved = await resolveAssignableTarget("internal_user", userId);
        if (resolved) {
          assignments.push({
            id: null,
            entityType,
            entityId,
            assignmentRole: "ASSIGNEE",
            assigneeType: "internal_user",
            assigneeId: userId,
            displayLabel: resolved.displayLabel,
            displayLabelSnapshot: resolved.displayLabel,
            secondaryLabel: resolved.secondaryLabel,
            active: true,
          });
        }
      }
      for (const rawName of task.assignees || []) {
        if (typeof rawName !== "string") continue;
        if (rawName.startsWith("counterparty:")) {
          const id = toInt(rawName.split(":")[1]);
          if (!id) continue;
          const resolved = await resolveAssignableTarget("external_counterparty", id);
          if (!resolved) continue;
          assignments.push({
            id: null,
            entityType,
            entityId,
            assignmentRole: "ASSIGNEE",
            assigneeType: "external_counterparty",
            assigneeId: id,
            displayLabel: resolved.displayLabel,
            displayLabelSnapshot: resolved.displayLabel,
            secondaryLabel: resolved.secondaryLabel,
            active: true,
          });
        }
        if (rawName.startsWith("contact:")) {
          const id = toInt(rawName.split(":")[1]);
          if (!id) continue;
          const resolved = await resolveAssignableTarget("external_contact", id);
          if (!resolved) continue;
          assignments.push({
            id: null,
            entityType,
            entityId,
            assignmentRole: "ASSIGNEE",
            assigneeType: "external_contact",
            assigneeId: id,
            displayLabel: resolved.displayLabel,
            displayLabelSnapshot: resolved.displayLabel,
            secondaryLabel: resolved.secondaryLabel,
            active: true,
          });
        }
      }
      return assignments;
    }
    case "tr_item": {
      const [item] = await executor.select().from(trItems).where(eq(trItems.id, entityId)).limit(1);
      if (!item) return [];
      const assignments: ResolvedAssignment[] = [];
      for (const userId of item.ownerUserIds || []) {
        const resolved = await resolveAssignableTarget("internal_user", userId);
        if (!resolved) continue;
        assignments.push({
          id: null,
          entityType,
          entityId,
          assignmentRole: "OWNER",
          assigneeType: "internal_user",
          assigneeId: userId,
          displayLabel: resolved.displayLabel,
          displayLabelSnapshot: resolved.displayLabel,
          secondaryLabel: resolved.secondaryLabel,
          active: true,
        });
      }
      for (const rawName of item.owners || []) {
        if (typeof rawName !== "string") continue;
        if (rawName.startsWith("counterparty:")) {
          const id = toInt(rawName.split(":")[1]);
          if (!id) continue;
          const resolved = await resolveAssignableTarget("external_counterparty", id);
          if (!resolved) continue;
          assignments.push({
            id: null,
            entityType,
            entityId,
            assignmentRole: "OWNER",
            assigneeType: "external_counterparty",
            assigneeId: id,
            displayLabel: resolved.displayLabel,
            displayLabelSnapshot: resolved.displayLabel,
            secondaryLabel: resolved.secondaryLabel,
            active: true,
          });
        }
      }
      return assignments;
    }
    case "work_item": {
      const rows = await executor
        .select({
          userId: workItemAssignments.userId,
          role: workItemAssignments.role,
          name: users.name,
          email: users.email,
        })
        .from(workItemAssignments)
        .innerJoin(users, eq(workItemAssignments.userId, users.id))
        .where(eq(workItemAssignments.workItemId, entityId))
        .orderBy(asc(workItemAssignments.id));

      if (rows.length === 0) return [];
      return rows.map((row) => ({
        id: null,
        entityType,
        entityId,
        assignmentRole: row.role as AssignmentRole,
        assigneeType: "internal_user" as const,
        assigneeId: row.userId,
        displayLabel: row.name,
        displayLabelSnapshot: row.name,
        secondaryLabel: row.email || null,
        active: true,
      }));
    }
    case "engineering_task": {
      const [task] = await executor.select().from(engineeringTasks).where(eq(engineeringTasks.id, entityId)).limit(1);
      if (!task?.assigneeUserId) return [];
      const resolved = await resolveAssignableTarget("internal_user", task.assigneeUserId);
      return resolved ? [{
        id: null,
        entityType,
        entityId,
        assignmentRole: "ASSIGNEE",
        assigneeType: "internal_user",
        assigneeId: task.assigneeUserId,
        displayLabel: resolved.displayLabel,
        displayLabelSnapshot: task.assigneeName || resolved.displayLabel,
        secondaryLabel: resolved.secondaryLabel,
        active: true,
      }] : [];
    }
    case "quality_item": {
      const [item] = await executor.select().from(qcItemInstance).where(eq(qcItemInstance.id, entityId)).limit(1);
      if (!item?.assigneeUserId) return [];
      const resolved = await resolveAssignableTarget("internal_user", item.assigneeUserId);
      return resolved ? [{
        id: null,
        entityType,
        entityId,
        assignmentRole: "ASSIGNEE",
        assigneeType: "internal_user",
        assigneeId: item.assigneeUserId,
        displayLabel: resolved.displayLabel,
        displayLabelSnapshot: resolved.displayLabel,
        secondaryLabel: resolved.secondaryLabel,
        active: true,
      }] : [];
    }
    case "deliverable": {
      const [item] = await executor.select().from(deliverables).where(eq(deliverables.id, entityId)).limit(1);
      if (!item) return [];
      const assignments: ResolvedAssignment[] = [];
      if (item.ownerUserId) {
        const resolved = await resolveAssignableTarget("internal_user", item.ownerUserId);
        if (resolved) {
          assignments.push({
            id: null,
            entityType,
            entityId,
            assignmentRole: "OWNER",
            assigneeType: "internal_user",
            assigneeId: item.ownerUserId,
            displayLabel: resolved.displayLabel,
            displayLabelSnapshot: resolved.displayLabel,
            secondaryLabel: resolved.secondaryLabel,
            active: true,
          });
        }
      }
      if (item.reviewerUserId) {
        const resolved = await resolveAssignableTarget("internal_user", item.reviewerUserId);
        if (resolved) {
          assignments.push({
            id: null,
            entityType,
            entityId,
            assignmentRole: "REVIEWER",
            assigneeType: "internal_user",
            assigneeId: item.reviewerUserId,
            displayLabel: resolved.displayLabel,
            displayLabelSnapshot: resolved.displayLabel,
            secondaryLabel: resolved.secondaryLabel,
            active: true,
          });
        }
      }
      return assignments;
    }
    case "approval": {
      const [item] = await executor.select().from(approvals).where(eq(approvals.id, entityId)).limit(1);
      if (!item?.assignedApprover) return [];
      const resolved = await resolveAssignableTarget("internal_user", item.assignedApprover);
      return resolved ? [{
        id: null,
        entityType,
        entityId,
        assignmentRole: "APPROVER",
        assigneeType: "internal_user",
        assigneeId: item.assignedApprover,
        displayLabel: resolved.displayLabel,
        displayLabelSnapshot: resolved.displayLabel,
        secondaryLabel: resolved.secondaryLabel,
        active: true,
      }] : [];
    }
    case "project_eng_approval": {
      const [item] = await executor.select().from(projectEngApprovals).where(eq(projectEngApprovals.id, entityId)).limit(1);
      if (!item?.approverUserId) return [];
      const resolved = await resolveAssignableTarget("internal_user", item.approverUserId);
      return resolved ? [{
        id: null,
        entityType,
        entityId,
        assignmentRole: "APPROVER",
        assigneeType: "internal_user",
        assigneeId: item.approverUserId,
        displayLabel: resolved.displayLabel,
        displayLabelSnapshot: resolved.displayLabel,
        secondaryLabel: resolved.secondaryLabel,
        active: true,
      }] : [];
    }
    case "procurement_item":
    case "raid_item":
    case "commissioning_item":
    case "change_request":
      return [];
  }
}

export async function getAssignmentsForEntity(
  entityType: AssignmentEntityType,
  entityId: number,
  assignmentRole?: AssignmentRole,
): Promise<ResolvedAssignment[]> {
  const canonical = await getCanonicalAssignments(db, entityType, entityId, assignmentRole);
  if (canonical.length > 0) return canonical;

  const legacy = await getLegacyAssignments(db, entityType, entityId);
  if (!assignmentRole) return legacy;
  return legacy.filter((assignment) => assignment.assignmentRole === assignmentRole);
}

async function canSelfManageAssignment(entityType: AssignmentEntityType, entityId: number, userId: number, role: string): Promise<boolean> {
  if (["COO_ADMIN", "CEO_ADMIN"].includes(role)) return true;

  switch (entityType) {
    case "personal_task": {
      const [task] = await db.select({ ownerUserId: mytoolTasks.ownerUserId }).from(mytoolTasks).where(eq(mytoolTasks.id, entityId)).limit(1);
      return task?.ownerUserId === userId;
    }
    case "operational_task": {
      const [task] = await db
        .select({ ownerUserId: operationalTasks.ownerUserId, assigneeUserIds: operationalTasks.assigneeUserIds })
        .from(operationalTasks)
        .where(eq(operationalTasks.id, entityId))
        .limit(1);
      return task?.ownerUserId === userId || Boolean(task?.assigneeUserIds?.includes(userId));
    }
    case "tr_item": {
      const [item] = await db.select({ ownerUserIds: trItems.ownerUserIds }).from(trItems).where(eq(trItems.id, entityId)).limit(1);
      return Boolean(item?.ownerUserIds?.includes(userId));
    }
    case "quality_item": {
      if (["QUALITY_MANAGER", "quality_manager"].includes(role)) return true;
      const [item] = await db.select({ assigneeUserId: qcItemInstance.assigneeUserId }).from(qcItemInstance).where(eq(qcItemInstance.id, entityId)).limit(1);
      return item?.assigneeUserId === userId;
    }
    case "deliverable": {
      const [item] = await db
        .select({ ownerUserId: deliverables.ownerUserId, reviewerUserId: deliverables.reviewerUserId })
        .from(deliverables)
        .where(eq(deliverables.id, entityId))
        .limit(1);
      return item?.ownerUserId === userId || item?.reviewerUserId === userId;
    }
    case "approval": {
      const [item] = await db.select({ assignedApprover: approvals.assignedApprover }).from(approvals).where(eq(approvals.id, entityId)).limit(1);
      return item?.assignedApprover === userId;
    }
    default:
      return false;
  }
}

async function assertAssignmentPermission(req: Request, entityType: AssignmentEntityType, entityId: number): Promise<void> {
  const user = getEffectiveUser(req);
  if (!user?.id) {
    throw new Error("Authentication required");
  }

  const permissionEntity = ENTITY_PERMISSION_BY_TYPE[entityType] as any;
  const [assignEval, reassignEval] = await Promise.all([
    evaluateAuthorityForRequest(req, permissionEntity, "assign"),
    evaluateAuthorityForRequest(req, permissionEntity, "reassign"),
  ]);

  if (assignEval.allowed || reassignEval.allowed) return;
  if (await canSelfManageAssignment(entityType, entityId, user.id, user.role || "")) return;

  logAuditFromReq(req, {
    entityType: "assignment",
    entityId: `${entityType}:${entityId}`,
    action: "assignment_denied",
    changesJson: {
      entityType,
      entityId,
      assignReason: assignEval.reason,
      reassignReason: reassignEval.reason,
    },
  });
  throw new Error(assignEval.reason || reassignEval.reason || "You do not have permission to change assignments");
}

function serializeLegacyExternalToken(assignment: ResolvedAssignment): string {
  if (assignment.assigneeType === "external_counterparty") return `counterparty:${assignment.assigneeId}`;
  if (assignment.assigneeType === "external_contact") return `contact:${assignment.assigneeId}`;
  return assignment.displayLabel;
}

async function syncLegacyAssignments(executor: Queryable, entityType: AssignmentEntityType, entityId: number): Promise<void> {
  const activeAssignments = await getCanonicalAssignments(executor, entityType, entityId);
  const activePrimary = activeAssignments[0] || null;
  const activeInternal = activeAssignments.filter((assignment) => assignment.assigneeType === "internal_user");
  const activeExternal = activeAssignments.filter((assignment) => isExternalAssignee(assignment.assigneeType));

  switch (entityType) {
    case "personal_task":
      await executor.update(mytoolTasks).set({
        ownerUserId: activePrimary?.assigneeType === "internal_user" ? activePrimary.assigneeId : null,
        updatedAt: new Date(),
      }).where(eq(mytoolTasks.id, entityId));
      return;
    case "operational_task":
      await executor.update(operationalTasks).set({
        ownerUserId: activeInternal[0]?.assigneeId || null,
        assigneeUserIds: activeInternal.map((assignment) => assignment.assigneeId),
        assignees: [
          ...activeInternal.map((assignment) => assignment.displayLabel),
          ...activeExternal.map((assignment) => serializeLegacyExternalToken(assignment)),
        ],
      }).where(eq(operationalTasks.id, entityId));
      return;
    case "tr_item":
      await executor.update(trItems).set({
        ownerUserIds: activeInternal.map((assignment) => assignment.assigneeId),
        owners: [
          ...activeInternal.map((assignment) => assignment.displayLabel),
          ...activeExternal.map((assignment) => serializeLegacyExternalToken(assignment)),
        ],
        updatedAt: new Date(),
      }).where(eq(trItems.id, entityId));
      return;
    case "work_item": {
      await executor.delete(workItemAssignments).where(and(
        eq(workItemAssignments.workItemId, entityId),
        sql`${workItemAssignments.role} != 'VIEWER'`,
      ));

      if (activeInternal.length > 0) {
        await executor.insert(workItemAssignments).values(
          activeInternal.map((assignment) => ({
            workItemId: entityId,
            userId: assignment.assigneeId,
            role: (assignment.assignmentRole === "OWNER" || assignment.assignmentRole === "REVIEWER")
              ? assignment.assignmentRole
              : "ASSIGNEE",
            allocationPct: null,
          })),
        );
      }

      const ownerAssignment = activeInternal.find((assignment) => assignment.assignmentRole === "OWNER") || activeInternal[0] || null;
      await executor.update(workItems).set({
        ownerUserId: ownerAssignment?.assigneeId || null,
        ownerName: ownerAssignment?.displayLabel || null,
        updatedAt: new Date(),
      }).where(eq(workItems.id, entityId));
      return;
    }
    case "engineering_task":
      await executor.update(engineeringTasks).set({
        assigneeUserId: activePrimary?.assigneeType === "internal_user" ? activePrimary.assigneeId : null,
        assigneeName: activePrimary?.displayLabel || null,
        updatedAt: new Date(),
      }).where(eq(engineeringTasks.id, entityId));
      return;
    case "quality_item":
      await executor.update(qcItemInstance).set({
        assigneeUserId: activePrimary?.assigneeType === "internal_user" ? activePrimary.assigneeId : null,
        lastUpdatedAt: new Date(),
      }).where(eq(qcItemInstance.id, entityId));
      return;
    case "deliverable": {
      const owner = activeAssignments.find((assignment) => assignment.assignmentRole === "OWNER") || null;
      const reviewer = activeAssignments.find((assignment) => assignment.assignmentRole === "REVIEWER") || null;
      await executor.update(deliverables).set({
        ownerUserId: owner?.assigneeType === "internal_user" ? owner.assigneeId : null,
        reviewerUserId: reviewer?.assigneeType === "internal_user" ? reviewer.assigneeId : null,
        updatedAt: new Date(),
      }).where(eq(deliverables.id, entityId));
      return;
    }
    case "approval":
      await executor.update(approvals).set({
        assignedApprover: activePrimary?.assigneeType === "internal_user" ? activePrimary.assigneeId : null,
      }).where(eq(approvals.id, entityId));
      return;
    case "project_eng_approval":
      await executor.update(projectEngApprovals).set({
        approverUserId: activePrimary?.assigneeType === "internal_user" ? activePrimary.assigneeId : null,
        updatedAt: new Date(),
      }).where(eq(projectEngApprovals.id, entityId));
      return;
    case "procurement_item":
      await executor.update(procurementItems).set({
        ownerUserId: activePrimary?.assigneeType === "internal_user" ? activePrimary.assigneeId : null,
        updatedAt: new Date(),
      }).where(eq(procurementItems.id, entityId));
      return;
    case "raid_item":
      await executor.update(raidItems).set({
        ownerUserId: activePrimary?.assigneeType === "internal_user" ? activePrimary.assigneeId : null,
        updatedAt: new Date(),
      }).where(eq(raidItems.id, entityId));
      return;
    case "commissioning_item":
      await executor.update(commissioningItems).set({
        ownerUserId: activePrimary?.assigneeType === "internal_user" ? activePrimary.assigneeId : null,
        updatedAt: new Date(),
      }).where(eq(commissioningItems.id, entityId));
      return;
    case "change_request":
      await executor.update(changeRequests).set({
        ownerUserId: activePrimary?.assigneeType === "internal_user" ? activePrimary.assigneeId : null,
        updatedAt: new Date(),
      }).where(eq(changeRequests.id, entityId));
      return;
  }
}

export async function setEntityAssignment(req: Request, input: SetEntityAssignmentInput): Promise<ResolvedAssignment[]> {
  const user = getEffectiveUser(req);
  if (!user?.id || !Number.isFinite(user.id)) {
    throw new Error("Authentication required");
  }

  const assignmentRole = input.assignmentRole || "ASSIGNEE";
  const mode = input.mode || "replace";
  const assigneeId = toInt(input.assigneeId);
  const entityId = toInt(input.entityId);
  console.log("[Assignment] setEntityAssignment called:", { entityType: input.entityType, inputEntityId: input.entityId, entityId, inputAssigneeId: input.assigneeId, assigneeId, assigneeType: input.assigneeType, mode, userId: user.id });

  if (!entityId) {
    throw new Error("A valid entity ID is required");
  }

  if (input.assigneeType && !assigneeId) {
    throw new Error("A valid assignee ID is required");
  }

  if (input.assigneeType && isExternalAssignee(input.assigneeType) && !EXTERNAL_ASSIGNMENT_TYPES.has(input.entityType)) {
    throw new Error(`External assignment is not enabled for ${input.entityType}`);
  }

  if (input.assigneeType === "internal_user" && !MULTI_ASSIGNMENT_TYPES.has(input.entityType) && mode === "append") {
    throw new Error(`${input.entityType} only supports one active assignment for ${assignmentRole}`);
  }

  if (input.assigneeType) {
    await assertAssignmentPermission(req, input.entityType, entityId);
  } else if (mode === "clear") {
    await assertAssignmentPermission(req, input.entityType, entityId);
  }

  const target = input.assigneeType && assigneeId
    ? await resolveAssignableTarget(input.assigneeType, assigneeId)
    : null;

  if (input.assigneeType && assigneeId && !target) {
    throw new Error("Selected assignee could not be found");
  }

  if (target && !target.isActive) {
    throw new Error("Selected assignee is inactive");
  }

  console.log("[Assignment] Starting transaction:", { entityType: input.entityType, entityId, assignmentRole, mode, assigneeType: input.assigneeType, assigneeId });
  return db.transaction(async (tx) => {
    const projectId = await getEntityProjectId(tx as Queryable, input.entityType, entityId);
    const before = await getCanonicalAssignments(tx as Queryable, input.entityType, entityId);
    console.log("[Assignment] Before state:", before.length, "active assignments");

    if (mode !== "append" || !target) {
      await tx.update(entityAssignments).set({
        active: false,
        clearedAt: new Date(),
        clearedByUserId: user.id,
        updatedAt: new Date(),
      }).where(and(
        eq(entityAssignments.entityType, input.entityType),
        eq(entityAssignments.entityId, entityId),
        eq(entityAssignments.assignmentRole, assignmentRole),
        eq(entityAssignments.active, true),
      ));
    }

    if (target && assigneeId) {
      const alreadyActive = await getCanonicalAssignments(tx as Queryable, input.entityType, entityId, assignmentRole);
      const duplicate = alreadyActive.find((assignment) =>
        assignment.assigneeType === input.assigneeType &&
        assignment.assigneeId === assigneeId,
      );

      if (!duplicate) {
        await tx.insert(entityAssignments).values({
          entityType: input.entityType,
          entityId,
          projectId,
          assignmentRole,
          assigneeType: input.assigneeType,
          assigneeId,
          displayLabelSnapshot: target.displayLabel,
          active: true,
          assignedByUserId: user.id,
          metadata: input.metadata || null,
          updatedAt: new Date(),
        });
      }
    }

    await syncLegacyAssignments(tx as Queryable, input.entityType, entityId);
    const after = await getCanonicalAssignments(tx as Queryable, input.entityType, entityId);
    console.log("[Assignment] After state:", after.length, "active assignments, ids:", after.map(a => `${a.assigneeType}:${a.assigneeId}`).join(", "));

    logAuditFromReq(req, {
      entityType: "assignment",
      entityId: `${input.entityType}:${entityId}`,
      action: target ? "assignment_updated" : "assignment_cleared",
      changesJson: {
        entityType: input.entityType,
        entityId,
        assignmentRole,
        assigneeType: input.assigneeType,
        assigneeId,
        mode,
        before: before.map((assignment) => ({
          assignmentRole: assignment.assignmentRole,
          assigneeType: assignment.assigneeType,
          assigneeId: assignment.assigneeId,
          displayLabel: assignment.displayLabel,
        })),
        after: after.map((assignment) => ({
          assignmentRole: assignment.assignmentRole,
          assigneeType: assignment.assigneeType,
          assigneeId: assignment.assigneeId,
          displayLabel: assignment.displayLabel,
        })),
      },
    });

    return after;
  });
}
