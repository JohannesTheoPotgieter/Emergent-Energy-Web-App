// ============================================================
// COLLABORATION WORKFLOW SERVICE — Acceptances, Commitments,
//   Evidence Requests, Queries, Client Updates
// ============================================================

import { and, eq, desc, sql, lte, isNull } from "drizzle-orm";
import { db } from "../db";
import {
  stageAcceptances,
  acceptanceReservations,
  clientCommitments,
  evidenceRequests,
  projectQueries,
  clientUpdates,
  projectStageDependencies,
  projectStageInstances,
  projectStageRequirements,
  QUERY_ROUTING,
  type InsertStageAcceptance,
  type StageAcceptance,
  type InsertAcceptanceReservation,
  type AcceptanceReservation,
  type InsertClientCommitment,
  type ClientCommitment,
  type InsertEvidenceRequest,
  type EvidenceRequest,
  type InsertProjectQuery,
  type ProjectQuery,
  type InsertClientUpdate,
  type ClientUpdate,
} from "@shared/schema";

// ── Acceptances ────────────────────────────────────────────

export async function createAcceptance(params: {
  projectId: number;
  stageCode: string;
  outcome: string;
  decidedByUserId?: number;
  rejectionReason?: string;
  adminOverride?: boolean;
  adminOverrideReason?: string;
  reservations?: { description: string; ownerUserId?: number; deadline?: string }[];
}): Promise<StageAcceptance> {
  const [acceptance] = await db.insert(stageAcceptances).values({
    projectId: params.projectId,
    stageCode: params.stageCode,
    outcome: params.outcome,
    decidedByUserId: params.decidedByUserId || null,
    decidedDate: new Date(),
    rejectionReason: params.rejectionReason || null,
    adminOverride: params.adminOverride || false,
    adminOverrideReason: params.adminOverrideReason || null,
  }).returning();

  // Create reservation records if accepted with reservations
  if (params.outcome === 'accepted_with_reservations' && params.reservations?.length) {
    const reservationValues = params.reservations.map(r => ({
      acceptanceId: acceptance.id,
      projectId: params.projectId,
      stageCode: params.stageCode,
      description: r.description,
      ownerUserId: r.ownerUserId || null,
      deadline: r.deadline || null,
      status: 'open' as const,
    }));
    await db.insert(acceptanceReservations).values(reservationValues);
  }

  return acceptance;
}

export async function getAcceptances(projectId: number, stageCode?: string) {
  const conditions = [eq(stageAcceptances.projectId, projectId)];
  if (stageCode) conditions.push(eq(stageAcceptances.stageCode, stageCode));

  return db
    .select()
    .from(stageAcceptances)
    .where(and(...conditions))
    .orderBy(desc(stageAcceptances.decidedDate));
}

export async function getAcceptanceReservations(projectId: number, stageCode?: string) {
  const conditions = [eq(acceptanceReservations.projectId, projectId)];
  if (stageCode) conditions.push(eq(acceptanceReservations.stageCode, stageCode));

  return db
    .select()
    .from(acceptanceReservations)
    .where(and(...conditions))
    .orderBy(desc(acceptanceReservations.createdAt));
}

export async function updateReservationStatus(id: number, status: string, notes?: string) {
  await db
    .update(acceptanceReservations)
    .set({
      status,
      closedDate: status === 'closed' ? new Date() : null,
      notes: notes || undefined,
    })
    .where(eq(acceptanceReservations.id, id));

  const [updated] = await db.select().from(acceptanceReservations).where(eq(acceptanceReservations.id, id));
  return updated;
}

// ── Client Commitments ─────────────────────────────────────

export async function createClientCommitment(params: {
  projectId: number;
  stageCodeCreated: string;
  commitmentText: string;
  committedByUserId?: number;
  deliveryStageCode?: string;
  notes?: string;
}): Promise<ClientCommitment> {
  const [commitment] = await db.insert(clientCommitments).values({
    projectId: params.projectId,
    stageCodeCreated: params.stageCodeCreated,
    commitmentText: params.commitmentText,
    committedByUserId: params.committedByUserId || null,
    committedDate: new Date(),
    deliveryStageCode: params.deliveryStageCode || null,
    status: 'open',
    notes: params.notes || null,
  }).returning();

  return commitment;
}

export async function getClientCommitments(projectId: number) {
  return db
    .select()
    .from(clientCommitments)
    .where(eq(clientCommitments.projectId, projectId))
    .orderBy(desc(clientCommitments.createdAt));
}

export async function updateClientCommitment(id: number, params: {
  status?: string;
  deliveredDate?: string;
  notes?: string;
}) {
  const updates: Record<string, any> = {};
  if (params.status) updates.status = params.status;
  if (params.deliveredDate) updates.deliveredDate = new Date(params.deliveredDate);
  if (params.status === 'delivered' && !params.deliveredDate) updates.deliveredDate = new Date();
  if (params.notes !== undefined) updates.notes = params.notes;

  await db.update(clientCommitments).set(updates).where(eq(clientCommitments.id, id));
  const [updated] = await db.select().from(clientCommitments).where(eq(clientCommitments.id, id));
  return updated;
}

// ── Evidence Requests ──────────────────────────────────────

export async function createEvidenceRequest(params: {
  projectId: number;
  stageCode: string;
  requestedByUserId?: number;
  requestedFromDepartment: string;
  requestedFromUserId?: number;
  description: string;
  dueDate?: string;
}): Promise<EvidenceRequest> {
  // Auto-create a corresponding dependency record
  const [dep] = await db.insert(projectStageDependencies).values({
    projectId: params.projectId,
    stageCode: params.stageCode,
    fromDepartment: 'PM', // requesting party default
    fromUserId: params.requestedByUserId || null,
    toDepartment: params.requestedFromDepartment,
    toUserId: params.requestedFromUserId || null,
    description: `Evidence request: ${params.description}`,
    dueDate: params.dueDate || null,
    status: 'WAITING',
  }).returning();

  const [request] = await db.insert(evidenceRequests).values({
    projectId: params.projectId,
    stageCode: params.stageCode,
    requestedByUserId: params.requestedByUserId || null,
    requestedFromDepartment: params.requestedFromDepartment,
    requestedFromUserId: params.requestedFromUserId || null,
    description: params.description,
    dueDate: params.dueDate || null,
    status: 'requested',
    linkedDependencyId: dep.id,
  }).returning();

  return request;
}

export async function getEvidenceRequests(projectId: number, stageCode?: string) {
  const conditions = [eq(evidenceRequests.projectId, projectId)];
  if (stageCode) conditions.push(eq(evidenceRequests.stageCode, stageCode));

  return db
    .select()
    .from(evidenceRequests)
    .where(and(...conditions))
    .orderBy(desc(evidenceRequests.createdAt));
}

export async function fulfillEvidenceRequest(id: number, evidenceUrl: string) {
  await db.update(evidenceRequests).set({
    status: 'uploaded',
    evidenceUrl,
    fulfilledDate: new Date(),
  }).where(eq(evidenceRequests.id, id));

  // Also resolve the linked dependency
  const [request] = await db.select().from(evidenceRequests).where(eq(evidenceRequests.id, id));
  if (request?.linkedDependencyId) {
    await db.update(projectStageDependencies).set({
      status: 'RESOLVED',
      resolvedAt: new Date(),
    }).where(eq(projectStageDependencies.id, request.linkedDependencyId));
  }

  return request;
}

export async function updateEvidenceRequestStatus(id: number, status: string) {
  await db.update(evidenceRequests).set({ status }).where(eq(evidenceRequests.id, id));
  const [updated] = await db.select().from(evidenceRequests).where(eq(evidenceRequests.id, id));
  return updated;
}

// ── Project Queries ────────────────────────────────────────

export async function createProjectQuery(params: {
  projectId: number;
  stageCode: string;
  queryType: string;
  raisedByUserId?: number;
  raisedByDepartment?: string;
  subject: string;
  description?: string;
  priority?: string;
  assignedToUserId?: number;
}): Promise<ProjectQuery> {
  const assignedToDepartment = QUERY_ROUTING[params.queryType] || 'PM';

  const [query] = await db.insert(projectQueries).values({
    projectId: params.projectId,
    stageCode: params.stageCode,
    queryType: params.queryType,
    raisedByUserId: params.raisedByUserId || null,
    raisedByDepartment: params.raisedByDepartment || null,
    assignedToUserId: params.assignedToUserId || null,
    assignedToDepartment,
    subject: params.subject,
    description: params.description || null,
    priority: params.priority || 'normal',
    status: 'open',
  }).returning();

  return query;
}

export async function getProjectQueries(projectId: number, stageCode?: string) {
  const conditions = [eq(projectQueries.projectId, projectId)];
  if (stageCode) conditions.push(eq(projectQueries.stageCode, stageCode));

  return db
    .select()
    .from(projectQueries)
    .where(and(...conditions))
    .orderBy(desc(projectQueries.createdAt));
}

export async function respondToQuery(id: number, params: {
  responseText: string;
  respondedByUserId?: number;
  newStatus?: string;
}) {
  await db.update(projectQueries).set({
    responseText: params.responseText,
    respondedByUserId: params.respondedByUserId || null,
    respondedDate: new Date(),
    status: params.newStatus || 'answered',
  }).where(eq(projectQueries.id, id));

  const [updated] = await db.select().from(projectQueries).where(eq(projectQueries.id, id));
  return updated;
}

export async function updateQueryStatus(id: number, status: string) {
  await db.update(projectQueries).set({ status }).where(eq(projectQueries.id, id));
  const [updated] = await db.select().from(projectQueries).where(eq(projectQueries.id, id));
  return updated;
}

// ── Client Updates ─────────────────────────────────────────

export async function createClientUpdate(params: {
  projectId: number;
  progressSummaryText?: string;
  completedThisPeriodText?: string;
  next7DaysText?: string;
  blockersText?: string;
  clientActionsRequiredText?: string;
  reviewerUserId?: number;
}): Promise<ClientUpdate> {
  // Get next update number
  const existing = await db
    .select({ updateNumber: clientUpdates.updateNumber })
    .from(clientUpdates)
    .where(eq(clientUpdates.projectId, params.projectId))
    .orderBy(desc(clientUpdates.updateNumber))
    .limit(1);

  const nextNumber = (existing[0]?.updateNumber ?? 0) + 1;
  const now = new Date();
  const nextDue = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [update] = await db.insert(clientUpdates).values({
    projectId: params.projectId,
    updateNumber: nextNumber,
    lastClientUpdateDate: now,
    nextClientUpdateDueDate: nextDue,
    clientUpdateStatus: 'draft',
    progressSummaryText: params.progressSummaryText || null,
    completedThisPeriodText: params.completedThisPeriodText || null,
    next7DaysText: params.next7DaysText || null,
    blockersText: params.blockersText || null,
    clientActionsRequiredText: params.clientActionsRequiredText || null,
    reviewerUserId: params.reviewerUserId || null,
  }).returning();

  return update;
}

export async function getClientUpdates(projectId: number) {
  return db
    .select()
    .from(clientUpdates)
    .where(eq(clientUpdates.projectId, projectId))
    .orderBy(desc(clientUpdates.updateNumber));
}

export async function updateClientUpdate(id: number, params: {
  clientUpdateStatus?: string;
  progressSummaryText?: string;
  completedThisPeriodText?: string;
  next7DaysText?: string;
  blockersText?: string;
  clientActionsRequiredText?: string;
  clientUpdateSentBy?: number;
  reviewerUserId?: number;
  sentDate?: string;
}) {
  const updates: Record<string, any> = {};
  if (params.clientUpdateStatus) updates.clientUpdateStatus = params.clientUpdateStatus;
  if (params.progressSummaryText !== undefined) updates.progressSummaryText = params.progressSummaryText;
  if (params.completedThisPeriodText !== undefined) updates.completedThisPeriodText = params.completedThisPeriodText;
  if (params.next7DaysText !== undefined) updates.next7DaysText = params.next7DaysText;
  if (params.blockersText !== undefined) updates.blockersText = params.blockersText;
  if (params.clientActionsRequiredText !== undefined) updates.clientActionsRequiredText = params.clientActionsRequiredText;
  if (params.clientUpdateSentBy) updates.clientUpdateSentBy = params.clientUpdateSentBy;
  if (params.reviewerUserId) updates.reviewerUserId = params.reviewerUserId;
  if (params.sentDate) updates.sentDate = new Date(params.sentDate);
  if (params.clientUpdateStatus === 'sent' && !params.sentDate) updates.sentDate = new Date();

  await db.update(clientUpdates).set(updates).where(eq(clientUpdates.id, id));
  const [updated] = await db.select().from(clientUpdates).where(eq(clientUpdates.id, id));
  return updated;
}

export async function generateClientUpdateDraft(projectId: number): Promise<{
  progressSummaryText: string;
  completedThisPeriodText: string;
  next7DaysText: string;
  blockersText: string;
  clientActionsRequiredText: string;
}> {
  // Get current stage info
  const stages = await db
    .select()
    .from(projectStageInstances)
    .where(eq(projectStageInstances.projectId, projectId));

  const currentStage = stages.find((s: any) => s.stageStatus === 'IN_PROGRESS') || stages[0];
  const stageName = currentStage?.stageCode?.replace(/_/g, ' ').replace(/S\d+\s/, '') || 'Unknown';

  // Get recent completed requirements
  const recentCompleted = await db
    .select()
    .from(projectStageRequirements)
    .where(and(
      eq(projectStageRequirements.projectId, projectId),
      eq(projectStageRequirements.status, 'COMPLETE'),
    ))
    .orderBy(desc(projectStageRequirements.completedDate))
    .limit(5);

  // Get open dependencies (blockers)
  const openDeps = await db
    .select()
    .from(projectStageDependencies)
    .where(and(
      eq(projectStageDependencies.projectId, projectId),
      eq(projectStageDependencies.status, 'WAITING'),
    ));

  const completedItems = recentCompleted.map((r: any) => `- ${r.itemName}`).join('\n') || '- No recently completed items';
  const blockerItems = openDeps.map((d: any) => `- ${d.description} (waiting on ${d.toDepartment})`).join('\n') || '- No current blockers';

  return {
    progressSummaryText: `Project is currently in ${stageName} stage. Readiness: ${currentStage?.readinessPct ?? 0}%.`,
    completedThisPeriodText: completedItems,
    next7DaysText: '- Continue stage progression activities',
    blockersText: blockerItems,
    clientActionsRequiredText: '- None at this time',
  };
}

// ── Cross-project queries (for gates pages) ────────────────

export async function getAllOpenQueries() {
  return db
    .select()
    .from(projectQueries)
    .where(
      sql`${projectQueries.status} IN ('open', 'in_progress')`
    )
    .orderBy(projectQueries.createdAt);
}

export async function getAllOverdueCommitments() {
  return db
    .select()
    .from(clientCommitments)
    .where(eq(clientCommitments.status, 'open'))
    .orderBy(clientCommitments.createdAt);
}
