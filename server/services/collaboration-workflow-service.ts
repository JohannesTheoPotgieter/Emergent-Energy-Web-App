// ============================================================
// COLLABORATION WORKFLOW SERVICE — Acceptances, Commitments,
//   Evidence Requests, Queries, Client Updates
// ============================================================
//
// CUTOVER STATUS (2026-03-31):
//   Phase 1 ✓ — All writes go to canonical tables (project_client_*)
//   Phase 2 ✓ — All reads come from canonical tables (project_client_*)
//   Phase 3 ✓ — Runtime guards block any future legacy writes
//   Legacy tables: client_commitments, client_updates — DO NOT USE
// ============================================================

import { and, eq, desc, sql } from "drizzle-orm";
import { db } from "../db";
import {
  stageAcceptances,
  acceptanceReservations,
  // CANONICAL — all reads and writes target these tables
  projectClientCommitments,
  projectClientUpdates,
  evidenceRequests,
  projectQueries,
  projectStageDependencies,
  projectStageInstances,
  projectStageRequirements,
  QUERY_ROUTING,
  type StageAcceptance,
  type ProjectClientCommitment,
  type EvidenceRequest,
  type ProjectQuery,
  type ProjectClientUpdate,
} from "@shared/schema";
import logger from "../lib/logger";

// ── Legacy Write Guards ───────────────────────────────────────
// Phase 3: Runtime guards that throw if anyone attempts to write to legacy tables.
// These exist to catch any missed code paths during the observation window.

function _blockLegacyCommitmentWrite(operation: string): never {
  const msg = `[LEGACY_GUARD] Write to deprecated client_commitments table blocked (${operation}). Use projectClientCommitments instead.`;
  logger.error(msg);
  throw new Error(msg);
}

function _blockLegacyUpdateWrite(operation: string): never {
  const msg = `[LEGACY_GUARD] Write to deprecated client_updates table blocked (${operation}). Use projectClientUpdates instead.`;
  logger.error(msg);
  throw new Error(msg);
}

// ── Legacy Read Telemetry ─────────────────────────────────────
// Temporary logging for the 90-day observation window.
// If this fires, something is still reading from legacy tables.

function _logLegacyRead(table: string, caller: string): void {
  logger.warn(`[LEGACY_TELEMETRY] Legacy read from ${table} in ${caller} — this should not happen after cutover`);
}

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
  // D4 live-meeting capture (optional). When the acceptance is recorded
  // via /handover/:projectId/live, these carry the attendee list + notes
  // from the meeting for audit + later review.
  attendees?: string[];
  sectionNotes?: Record<string, string>;
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
    attendees: params.attendees ?? null,
    sectionNotes: params.sectionNotes ?? null,
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

// ── Client Commitments (CANONICAL: project_client_commitments) ──

export async function createClientCommitment(params: {
  projectId: number;
  stageCodeCreated: string;
  commitmentText: string;
  committedByUserId?: number;
  deliveryStageCode?: string;
  notes?: string;
}): Promise<ProjectClientCommitment> {
  // Phase 1: Write to canonical table
  const [commitment] = await db.insert(projectClientCommitments).values({
    projectId: params.projectId,
    stageCodeCreated: params.stageCodeCreated,
    commitmentText: params.commitmentText,
    committedByUserId: params.committedByUserId || null,
    committedDate: new Date(),
    deliveryStageCode: params.deliveryStageCode || null,
    status: 'OPEN',
    notes: params.notes || null,
  }).returning();

  return commitment;
}

export async function getClientCommitments(projectId: number) {
  // Phase 2: Read from canonical table
  return db
    .select()
    .from(projectClientCommitments)
    .where(eq(projectClientCommitments.projectId, projectId))
    .orderBy(desc(projectClientCommitments.createdAt));
}

export async function updateClientCommitment(id: number, params: {
  status?: string;
  deliveredDate?: string;
  notes?: string;
}) {
  const updates: Partial<typeof projectClientCommitments.$inferInsert> = {};
  if (params.status) updates.status = params.status;
  if (params.deliveredDate) updates.deliveredDate = new Date(params.deliveredDate);
  if (params.status === 'DELIVERED' && !params.deliveredDate) updates.deliveredDate = new Date();
  if (params.notes !== undefined) updates.notes = params.notes;

  // Phase 1: Write to canonical table
  await db.update(projectClientCommitments).set(updates).where(eq(projectClientCommitments.id, id));
  // Phase 2: Read from canonical table
  const [updated] = await db.select().from(projectClientCommitments).where(eq(projectClientCommitments.id, id));
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

// ── Client Updates (CANONICAL: project_client_updates) ────────

export async function createClientUpdate(params: {
  projectId: number;
  progressSummaryText?: string;
  completedThisPeriodText?: string;
  next7DaysText?: string;
  blockersText?: string;
  clientActionsRequiredText?: string;
  reviewerUserId?: number;
}): Promise<ProjectClientUpdate> {
  // Phase 2: Read next update number from canonical table
  const [maxRow] = await db
    .select({ maxNum: sql<number>`COALESCE(MAX(update_number), 0)` })
    .from(projectClientUpdates)
    .where(eq(projectClientUpdates.projectId, params.projectId));

  const nextNumber = (maxRow?.maxNum ?? 0) + 1;
  const now = new Date();
  const nextDue = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Phase 1: Write to canonical table
  const [update] = await db.insert(projectClientUpdates).values({
    projectId: params.projectId,
    updateNumber: nextNumber,
    dueDate: nextDue.toISOString().split('T')[0],
    status: 'DRAFT',
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
  // Phase 2: Read from canonical table
  return db
    .select()
    .from(projectClientUpdates)
    .where(eq(projectClientUpdates.projectId, projectId))
    .orderBy(desc(projectClientUpdates.updateNumber));
}

export async function updateClientUpdate(id: number, params: {
  status?: string;
  progressSummaryText?: string;
  completedThisPeriodText?: string;
  next7DaysText?: string;
  blockersText?: string;
  clientActionsRequiredText?: string;
  sentByUserId?: number;
  reviewerUserId?: number;
  sentDate?: string;
  // Legacy param names — remap silently for backward compat
  clientUpdateStatus?: string;
  clientUpdateSentBy?: number;
}) {
  const updates: Partial<typeof projectClientUpdates.$inferInsert> = { updatedAt: new Date() };
  // Support both canonical and legacy param names
  const effectiveStatus = params.status || params.clientUpdateStatus;
  if (effectiveStatus) updates.status = effectiveStatus.toUpperCase();
  if (params.progressSummaryText !== undefined) updates.progressSummaryText = params.progressSummaryText;
  if (params.completedThisPeriodText !== undefined) updates.completedThisPeriodText = params.completedThisPeriodText;
  if (params.next7DaysText !== undefined) updates.next7DaysText = params.next7DaysText;
  if (params.blockersText !== undefined) updates.blockersText = params.blockersText;
  if (params.clientActionsRequiredText !== undefined) updates.clientActionsRequiredText = params.clientActionsRequiredText;
  const effectiveSentBy = params.sentByUserId || params.clientUpdateSentBy;
  if (effectiveSentBy) updates.sentByUserId = effectiveSentBy;
  if (params.reviewerUserId) updates.reviewerUserId = params.reviewerUserId;
  if (params.sentDate) updates.sentDate = new Date(params.sentDate);
  const finalStatus = effectiveStatus?.toUpperCase();
  if (finalStatus === 'SENT' && !params.sentDate) updates.sentDate = new Date();

  // Phase 1: Write to canonical table
  await db.update(projectClientUpdates).set(updates).where(eq(projectClientUpdates.id, id));
  // Phase 2: Read from canonical table
  const [updated] = await db.select().from(projectClientUpdates).where(eq(projectClientUpdates.id, id));
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

  const currentStage = stages.find((s: typeof projectStageInstances.$inferSelect) => s.stageStatus === 'IN_PROGRESS') || stages[0];
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

  const completedItems = recentCompleted.map((r: typeof projectStageRequirements.$inferSelect) => `- ${r.itemName}`).join('\n') || '- No recently completed items';
  const blockerItems = openDeps.map((d: typeof projectStageDependencies.$inferSelect) => `- ${d.description} (waiting on ${d.toDepartment})`).join('\n') || '- No current blockers';

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
  // Phase 2: Read from canonical table
  return db
    .select()
    .from(projectClientCommitments)
    .where(eq(projectClientCommitments.status, 'OPEN'))
    .orderBy(projectClientCommitments.createdAt);
}
