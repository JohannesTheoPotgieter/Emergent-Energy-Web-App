// Error breakdown: TS7006 implicit-any: 10, TS2345 query/param types: 8, other: 0
// Fix guide: use queryStr/queryInt from server/lib/req-parse for query params,
// add explicit ': any' to .map/.filter callback params on db result rows.
import { Express, Request, Response, NextFunction } from 'express';
import { db, getDbMode } from './db';
import { eq, sql, inArray, desc, and, isNull } from 'drizzle-orm';
import {
  projectInfo,
  executionGateLog,
  mergeAuditLog,
  qcChecklist,
  qcItemInstance,
  normalizedCostLines,
  normalizedRevenueLines,
  projectRagAudit,
  workItems,
  users,
  qcWarning,
  approvals,
  smartImportRuns,
  projectExecutionState,
  projectPhaseHistory,
  phaseTemplate,
  cashflowPoints,
} from '@shared/schema';
import { syncProjectSplitTables, syncProjectSplitTablesAfterInsert } from './lib/project-info-sync';
import { getAllPMWorkItemsAsProjectPlan, getAllWorkItemsForProgress } from './work-items-adapter';
import { logAuditFromReq } from './audit-logger';
import { requirePermission } from './permission-middleware';
import { actorFromReq, createProjectEvent } from './services/project-event-service';
import {
  createStageGateOverride,
  evaluateStageGate,
} from './services/lifecycle-stage-gate-service';
import { buildProjectLifecycleWorkspace } from './services/project-lifecycle-workspace-service';
import { refreshProjectMetricsAsync } from './services/dashboard-metrics';
import { initializeProjectStages } from './services/stage-lifecycle-service';
import { evaluateRevenueArStatus } from './lib/finance/revenue-ar-status';
import { projectStageInstances, STAGE_CODES } from '@shared/schema';
import {
  resolveStageFromPhase,
  isFullyCompletedPhase,
  stagesBefore,
} from '../shared/utils/phase-to-stage-map';
import { PHASES as CANONICAL_PHASES, resolveCanonicalPhase } from '../shared/phases';
import { jwtAuth, requireAuth } from './auth-context';
import { bridgeCatch } from './bridge/bridge-writer';
import { computeMarginPct } from './lib/finance/margin';
import { computeProjectProgress } from './lib/kpi-formulas';
import {
  isCanonicalCosRealised,
  OVERRIDE_REALISED,
  OVERRIDE_NOT_REALISED,
} from './lib/finance/cos-realisation';
import { paramStr, parseIntParam } from './lib/req-params';
import { setFinanceTrustHeaders } from './lib/finance-trust/envelope';
import { notFound } from './lib/api-error';
import { resolveFinanceYearScope } from './lib/finance-year-scope';

const EXEC_ROLES = [
  'COO_ADMIN',
  'CEO_ADMIN',
  'CCO',
  'CFO',
  'PROGRAM_MANAGER',
  'ENGINEERING_MANAGER',
];
const STAGE_GATE_OVERRIDE_ROLES = [
  'COO_ADMIN',
  'CEO_ADMIN',
  'CCO',
  'CFO',
  'PROGRAM_MANAGER',
  'ENGINEERING_MANAGER',
];
const CANONICAL_LIFECYCLE_LABELS = CANONICAL_PHASES.map((p) => p.label);
const CANONICAL_LIFECYCLE_LABELS_LC = new Map(
  CANONICAL_LIFECYCLE_LABELS.map((p) => [p.toLowerCase(), p]),
);

function requireCanonicalLifecyclePhase(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('phase is required and must be a string');
  }
  const matched = CANONICAL_LIFECYCLE_LABELS_LC.get(raw.trim().toLowerCase());
  if (!matched) {
    throw new Error(
      `Invalid lifecycle phase: ${String(raw)}. Use canonical lifecycle labels only.`,
    );
  }
  return matched;
}

function requireExecRole(req: Request, res: Response, next: NextFunction) {
  const role = ((req as any).user as any)?.role || '';
  if (EXEC_ROLES.includes(role)) return next();
  res.status(403).json({ error: 'forbidden', message: 'Executive role required' });
}

function normalizeName(name: string): string {
  return name
    .replace(/_Tracker$/i, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .trim();
}

function resolveDashboardFinanceScope(query: Request['query']) {
  const scope = resolveFinanceYearScope(query);
  return {
    start: scope.startDate ?? '0001-01-01',
    end: scope.endDate ?? '9999-12-31',
    label: scope.label,
    allData: scope.mode === 'all',
  };
}

function parseIsoDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2}/.test(trimmed) ? trimmed.slice(0, 10) : trimmed;
  const date = new Date(`${normalized}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isDateInRange(dateValue: string | null | undefined, start: string, end: string): boolean {
  const date = parseIsoDateOnly(dateValue);
  if (!date) return false;
  const startDate = parseIsoDateOnly(start)!;
  const endDate = parseIsoDateOnly(end)!;
  return date >= startDate && date <= endDate;
}

function pickFirstPopulatedDate(source: Record<string, any>, fields: string[]): string | null {
  for (const field of fields) {
    const value = source[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value instanceof Date && !Number.isNaN(value.getTime()))
      return value.toISOString().slice(0, 10);
  }
  return null;
}

function selectDefinedFields<T extends Record<string, any>>(fields: T): T {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as T;
}

type ExecutionDashboardProjectRow = {
  id: number;
  projectName: string;
  pm: string | null;
  pd: string | null;
  executionPhase: string | null;
  ragStatus: string | null;
  archivedStatus: string | null;
  phase: string | null;
  cpSigned: string | null;
  signedStatus: string | null;
};

type ExecutionDashboardEngTaskRow = {
  projectId: number | null;
  projectName: string | null;
  status: string | null;
  dueDate: string | null;
  blockerReason: string | null;
  priority: string | null;
  ownerUserId: number | null;
  title: string | null;
};

function formatDateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateStr.substring(0, 10).split('-').map(Number);
  return { year: y, month: m, day: d };
}

function computeEaster(year: number): { year: number; month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

function getSAPublicHolidays(year: number): Set<string> {
  const holidays = new Set<string>();
  const add = (m: number, d: number) => {
    holidays.add(formatDateKey(year, m, d));
    const dt = new Date(Date.UTC(year, m - 1, d));
    if (dt.getUTCDay() === 0) {
      const next = new Date(dt);
      next.setUTCDate(next.getUTCDate() + 1);
      holidays.add(formatDateKey(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()));
    }
  };
  add(1, 1);
  add(3, 21);
  add(4, 27);
  add(5, 1);
  add(6, 16);
  add(8, 9);
  add(9, 24);
  add(12, 16);
  add(12, 25);
  add(12, 26);
  const easter = computeEaster(year);
  const goodFriday = new Date(Date.UTC(easter.year, easter.month - 1, easter.day));
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  holidays.add(
    formatDateKey(
      goodFriday.getUTCFullYear(),
      goodFriday.getUTCMonth() + 1,
      goodFriday.getUTCDate(),
    ),
  );
  const familyDay = new Date(Date.UTC(easter.year, easter.month - 1, easter.day));
  familyDay.setUTCDate(familyDay.getUTCDate() + 1);
  holidays.add(
    formatDateKey(familyDay.getUTCFullYear(), familyDay.getUTCMonth() + 1, familyDay.getUTCDate()),
  );
  return holidays;
}

const lcHolidayCacheByYear = new Map<number, Set<string>>();
function isHoliday(dateStr: string): boolean {
  const year = parseInt(dateStr.substring(0, 4));
  if (!lcHolidayCacheByYear.has(year)) {
    lcHolidayCacheByYear.set(year, getSAPublicHolidays(year));
  }
  return lcHolidayCacheByYear.get(year)!.has(dateStr);
}

function saWorkingDays(startDateStr: string | null, endDateStr: string | null): number | null {
  if (
    !startDateStr ||
    !endDateStr ||
    !/^\d{4}-\d{2}-\d{2}/.test(startDateStr) ||
    !/^\d{4}-\d{2}-\d{2}/.test(endDateStr)
  )
    return null;
  const s = parseDateParts(startDateStr);
  const e = parseDateParts(endDateStr);
  const start = new Date(Date.UTC(s.year, s.month - 1, s.day));
  const end = new Date(Date.UTC(e.year, e.month - 1, e.day));
  if (end < start) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const dow = cursor.getUTCDay();
    const ds = formatDateKey(
      cursor.getUTCFullYear(),
      cursor.getUTCMonth() + 1,
      cursor.getUTCDate(),
    );
    if (dow !== 0 && dow !== 6 && !isHoliday(ds)) {
      count++;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

function buildOverdueFinanceLedger(params: {
  revenueLines: any[];
  costLines: any[];
  activeProjects: Array<{ id: number; projectName: string; pm?: string | null }>;
  fyStart: string;
  fyEnd: string;
  today: string;
}) {
  const { revenueLines, costLines, activeProjects, fyStart, fyEnd, today } = params;
  const hasText = (v: any) => typeof v === 'string' && v.trim().length > 0;

  const activeProjectIds = new Set<number>(activeProjects.map((p) => p.id));
  const activeProjectNames = new Set<string>(
    activeProjects.map((p) => normalizeName(p.projectName)),
  );
  const projectOwnerById = new Map<number, string>();
  const projectOwnerByNorm = new Map<string, string>();
  for (const p of activeProjects) {
    const owner = p.pm || 'Unassigned';
    projectOwnerById.set(p.id, owner);
    projectOwnerByNorm.set(normalizeName(p.projectName), owner);
  }

  const daysOverdue = (dueDate: string) => {
    const due = parseIsoDateOnly(dueDate);
    const asOf = parseIsoDateOnly(today);
    if (!due || !asOf) return 0;
    const delta = asOf.getTime() - due.getTime();
    return Math.max(0, Math.floor(delta / 86400000));
  };

  const apItems: any[] = [];
  const arItems: any[] = [];
  let apMissingDueDate = 0;
  let arMissingDueDate = 0;
  const apSeen = new Set<string>();
  const arSeen = new Set<string>();
  for (const row of costLines) {
    const rowProjectNorm = normalizeName(row.projectName || '');
    const isActiveProject =
      (row.projectId && activeProjectIds.has(row.projectId)) ||
      (!!row.projectName && activeProjectNames.has(rowProjectNorm));
    if (!isActiveProject) continue;
    if (!hasText(row.invoiceNumber)) continue; // actual AP invoices only
    const amount = parseFloat(row.amountExVat || '0') || 0;
    if (amount <= 0) continue;
    const dueDate = hasText(row.approvedDate) ? String(row.approvedDate).slice(0, 10) : null;
    const invoiceDate = hasText(row.invoiceDate) ? String(row.invoiceDate).slice(0, 10) : null;
    const keyDate = dueDate || invoiceDate;
    if (!isDateInRange(keyDate, fyStart, fyEnd)) continue;

    // Use canonical COS realisation check (invoice + black-font confirmed gate)
    const settled = isCanonicalCosRealised({
      status: null,
      cosStatusOverride: row.cosStatusOverride ?? null,
      cosRealised: row.cosRealised ?? null,
      expenseInvoiceNumber: row.invoiceNumber ?? null,
      expenseInvoicedDate: row.invoiceDate ?? null,
      expensePoNumber: (row as any).poNumber ?? null,
      paymentDate: row.paidDate ?? null,
      today,
      invoiceDateFontColor: (row as any).invoiceDateFontColor ?? null,
      invoiceDateConfirmed: (row as any).invoiceDateConfirmed ?? null,
    });
    if (settled) continue;
    if (!dueDate) {
      apMissingDueDate += 1;
      continue;
    }
    if (!(dueDate < today)) continue;

    const dedupeKey = `${row.projectId || row.projectName}::${row.sourceRow || ''}::${row.invoiceNumber}`;
    if (apSeen.has(dedupeKey)) continue;
    apSeen.add(dedupeKey);

    apItems.push({
      id: dedupeKey,
      projectId: row.projectId || null,
      projectName: row.projectName || 'Unknown project',
      counterparty: row.supplier || 'Unknown supplier',
      invoiceNumber: row.invoiceNumber,
      invoiceDate,
      dueDate,
      outstandingAmount: amount,
      daysOverdue: daysOverdue(dueDate),
      owner: row.projectId
        ? projectOwnerById.get(row.projectId) || 'Unassigned'
        : projectOwnerByNorm.get(rowProjectNorm) || 'Unassigned',
      status: 'Open / Unpaid',
      recordLink: row.projectName
        ? `/project/${encodeURIComponent(row.projectName)}?tab=expenditure`
        : null,
    });
  }

  for (const row of revenueLines) {
    const rowProjectNorm = normalizeName(row.projectName || '');
    const isActiveProject =
      (row.projectId && activeProjectIds.has(row.projectId)) ||
      (!!row.projectName && activeProjectNames.has(rowProjectNorm));
    if (!isActiveProject) continue;
    if (!hasText(row.invoiceNumber)) continue; // actual AR invoices only
    const amount = parseFloat(row.amountExVat || '0') || 0;
    if (amount <= 0) continue;
    const dueDate = hasText(row.expectedPaymentDate)
      ? String(row.expectedPaymentDate).slice(0, 10)
      : null;
    const invoiceDate = hasText(row.invoiceDate) ? String(row.invoiceDate).slice(0, 10) : null;
    const keyDate = dueDate || invoiceDate;
    if (!isDateInRange(keyDate, fyStart, fyEnd)) continue;

    const arState = evaluateRevenueArStatus({
      status: row.status,
      paidDate: row.paidDate,
      paidDateConfirmed: row.paidDateConfirmed,
      paidDateFontColor: row.paidDateFontColor,
      inBankDate: row.inBankDate,
      dueDate,
      invoiceNumber: row.invoiceNumber,
      amount,
      today,
    });
    if (arState.isSettled) continue;
    if (!dueDate) {
      arMissingDueDate += 1;
      continue;
    }
    if (!arState.isOverdue) continue;

    const dedupeKey = `${row.projectId || row.projectName}::${row.sourceRow || ''}::${row.invoiceNumber}`;
    if (arSeen.has(dedupeKey)) continue;
    arSeen.add(dedupeKey);

    arItems.push({
      id: dedupeKey,
      projectId: row.projectId || null,
      projectName: row.projectName || 'Unknown project',
      counterparty: row.client || 'Unknown client',
      invoiceNumber: row.invoiceNumber,
      invoiceDate,
      dueDate,
      outstandingAmount: amount,
      daysOverdue: daysOverdue(dueDate),
      owner: row.projectId
        ? projectOwnerById.get(row.projectId) || 'Unassigned'
        : projectOwnerByNorm.get(rowProjectNorm) || 'Unassigned',
      status: 'Open / Unreceived',
      recordLink: row.projectName
        ? `/project/${encodeURIComponent(row.projectName)}?tab=revenue`
        : null,
    });
  }

  apItems.sort(
    (a, b) => b.daysOverdue - a.daysOverdue || b.outstandingAmount - a.outstandingAmount,
  );
  arItems.sort(
    (a, b) => b.daysOverdue - a.daysOverdue || b.outstandingAmount - a.outstandingAmount,
  );

  const apTotal = apItems.reduce((sum, item) => sum + item.outstandingAmount, 0);
  const arTotal = arItems.reduce((sum, item) => sum + item.outstandingAmount, 0);

  return {
    ap: {
      totalAmount: apTotal,
      count: apItems.length,
      missingDueDateCount: apMissingDueDate,
      items: apItems,
    },
    ar: {
      totalAmount: arTotal,
      count: arItems.length,
      missingDueDateCount: arMissingDueDate,
      items: arItems,
    },
  };
}

/**
 * Canonical phase-transition propagator.
 *
 * Side effects ONLY — does not write `projectInfo.phase` itself (caller is
 * expected to have done that and called `syncProjectSplitTables`). Handles
 * everything downstream of a successful phase change so that all entry
 * points produce identical state:
 *   - Stage instances: prior → PROGRESSED, current → IN_PROGRESS
 *   - project_execution_state: currentStageCode + gateStatus + readinessPct
 *   - project_phase_history audit row
 *   - project.stage_changed event
 *   - Async dashboard metric refresh
 *
 * Deliberately does NOT auto-spawn handover drafts, engineering stages,
 * tickets, approvals, or any other user-facing work items. Phase moves
 * are pure state changes (per Johannes, 2026-05-08).
 */
async function propagatePhaseSideEffects(opts: {
  projectId: number;
  canonicalPhase: string;
  fromPhase: string | null;
  actor: { actorUserId: number | null; actorRole: string | null };
}): Promise<void> {
  const { projectId: id, canonicalPhase, fromPhase, actor } = opts;
  const userId = actor.actorUserId || null;

  try {
    await initializeProjectStages(id);
    const mappedStage = resolveStageFromPhase(canonicalPhase);
    const isCompleted = isFullyCompletedPhase(canonicalPhase);
    const priorStageCodes = isCompleted
      ? ([...STAGE_CODES] as string[])
      : (stagesBefore(mappedStage) as string[]);

    if (priorStageCodes.length > 0) {
      await db
        .update(projectStageInstances)
        .set({
          stageStatus: 'PROGRESSED',
          readinessPct: 100,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(projectStageInstances.projectId, id),
            inArray(projectStageInstances.stageCode, priorStageCodes),
          ),
        );
    }
    if (!isCompleted) {
      await db
        .update(projectStageInstances)
        .set({ stageStatus: 'IN_PROGRESS', startedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(projectStageInstances.projectId, id),
            eq(projectStageInstances.stageCode, mappedStage),
          ),
        );
    }
    await db
      .update(projectExecutionState)
      .set({
        currentStageCode: isCompleted ? 'S10_POST_HANDOVER_REVIEW' : mappedStage,
        gateStatus: isCompleted ? 'PROGRESSED' : 'IN_PROGRESS',
        gateReadinessPct: isCompleted ? 100 : 0,
        updatedAt: new Date(),
      })
      .where(eq(projectExecutionState.projectId, id));
  } catch (stageErr: any) {
    console.warn('[lifecycle-board] Stage lifecycle sync error (non-fatal):', stageErr.message);
  }

  await db.insert(projectPhaseHistory).values({
    projectId: id,
    fromPhase: fromPhase || null,
    toPhase: canonicalPhase,
    changedByUserId: userId,
    reason: `Phase changed from ${fromPhase || 'unknown'} to ${canonicalPhase}`,
  });

  await createProjectEvent({
    projectId: id,
    eventType: 'project.stage_changed',
    actorUserId: actor.actorUserId,
    actorRole: actor.actorRole,
    sourceEntityType: 'project_info',
    sourceEntityId: String(id),
    summary: `Stage changed from ${fromPhase || 'unknown'} to ${canonicalPhase}`,
    details: { fromPhase, toPhase: canonicalPhase },
    idempotencyKey: `phase:${id}:${fromPhase || ''}:${canonicalPhase}`,
  });

  refreshProjectMetricsAsync(id);
}

/**
 * Single canonical "apply a phase transition" routine. Used by all entry
 * points that mutate phase on an EXISTING project (drag/drop on board,
 * generic project edit, promote-existing) so they cannot drift.
 *
 * Returns `{ allowed: false, evaluation }` when a stage gate blocks the
 * move — caller is responsible for translating to a 409 response.
 */
async function applyPhaseTransition(opts: {
  projectId: number;
  canonicalPhase: string;
  fromPhase: string | null;
  actor: { actorUserId: number | null; actorRole: string | null };
  extraFields?: Record<string, any>;
}): Promise<
  | { allowed: false; evaluation: Awaited<ReturnType<typeof evaluateStageGate>> }
  | {
      allowed: true;
      evaluation: Awaited<ReturnType<typeof evaluateStageGate>>;
      updated: typeof projectInfo.$inferSelect;
    }
> {
  const { projectId: id, canonicalPhase, fromPhase, actor, extraFields = {} } = opts;
  const userId = actor.actorUserId || null;

  const evaluation = await evaluateStageGate({
    projectId: id,
    targetStage: canonicalPhase,
    actorUserId: actor.actorUserId,
    actorRole: actor.actorRole,
  });
  if (!evaluation.allowed) return { allowed: false, evaluation };

  const stageTransitionFields = {
    ...extraFields,
    phase: canonicalPhase,
    phaseUpdatedAt: new Date(),
    phaseUpdatedByUserId: userId,
    updatedAt: new Date(),
  };
  const [updated] = await db
    .update(projectInfo)
    .set(stageTransitionFields)
    .where(eq(projectInfo.id, id))
    .returning();
  await syncProjectSplitTables(id, stageTransitionFields);

  await propagatePhaseSideEffects({ projectId: id, canonicalPhase, fromPhase, actor });

  return { allowed: true, evaluation, updated };
}

export function registerLifecycleRoutes(app: Express) {
  app.use('/api/lifecycle-board', jwtAuth);

  (async () => {
    if (getDbMode() === 'sqlite') {
      console.log('[Lifecycle] Postgres-only additive migrations skipped for SQLite');
      return;
    }

    try {
      await db.execute(
        sql.raw(`
        ALTER TABLE project_info ADD COLUMN IF NOT EXISTS rag_comment TEXT;
        ALTER TABLE project_info ADD COLUMN IF NOT EXISTS rag_updated_by_user_id INTEGER;
      `),
      );
      await db.execute(
        sql.raw(`
        CREATE TABLE IF NOT EXISTS project_rag_audit (
          id SERIAL PRIMARY KEY,
          project_id INTEGER NOT NULL REFERENCES project_info(id) ON DELETE CASCADE,
          from_rag TEXT,
          to_rag TEXT NOT NULL,
          comment TEXT NOT NULL,
          changed_by_user_id INTEGER NOT NULL,
          changed_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
      `),
      );
      console.log('[Lifecycle] RAG audit table and columns ensured');
    } catch (err: any) {
      console.error('[Lifecycle] Migration error:', err.message);
    }
  })();

  const RAG_ROLES = ['COO_ADMIN', 'CEO_ADMIN', 'CCO'];

  app.post(
    '/api/lifecycle-board/projects/:id/rag',
    requireAuth,
    requirePermission('projects', 'edit'),
    async (req: Request, res: Response) => {
      try {
        const role = ((req as any).user as any)?.role || '';
        if (!RAG_ROLES.includes(role)) {
          return res
            .status(403)
            .json({ error: 'forbidden', message: 'Only COO, CEO, or CCO can update RAG status' });
        }
        const projectId = parseIntParam(req.params.id);
        if (isNaN(projectId)) return res.status(400).json({ error: 'Invalid project ID' });

        const { rag, comment } = req.body;
        if (!rag || !['GREEN', 'AMBER', 'RED'].includes(rag)) {
          return res.status(400).json({ error: 'rag must be GREEN, AMBER, or RED' });
        }
        if (!comment || typeof comment !== 'string' || comment.trim().length < 5) {
          return res.status(400).json({ error: 'Comment must be at least 5 characters' });
        }

        const [project] = await db
          .select({ id: projectInfo.id, ragStatus: projectExecutionState.ragStatus })
          .from(projectInfo)
          .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
          .where(eq(projectInfo.id, projectId));
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const userId = ((req as any).user as any)?.id;
        const fromRag = project.ragStatus || null;

        await db.transaction(async (tx: any) => {
          const ragFields = {
            ragStatus: rag,
            ragComment: comment.trim(),
            ragUpdatedAt: new Date(),
            ragUpdatedByUserId: userId,
          };
          await tx.update(projectInfo).set(ragFields).where(eq(projectInfo.id, projectId));
          await syncProjectSplitTables(projectId, ragFields, tx);

          await tx.insert(projectRagAudit).values({
            projectId,
            fromRag,
            toRag: rag,
            comment: comment.trim(),
            changedByUserId: userId,
          });
        });

        logAuditFromReq(req, {
          entityType: 'project',
          action: 'rag_update',
          entityId: String(projectId),
          changesJson: { projectId, fromRag, toRag: rag, comment: comment.trim() },
        });

        res.json({ success: true });
      } catch (err: any) {
        console.error('[lifecycle-board] POST rag error:', err);
        throw err;
      }
    },
  );

  app.get(
    '/api/lifecycle-board/projects/:id/rag-history',
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const projectId = parseIntParam(req.params.id);
        if (isNaN(projectId)) return res.status(400).json({ error: 'Invalid project ID' });

        const history = await db
          .select({
            id: projectRagAudit.id,
            fromRag: projectRagAudit.fromRag,
            toRag: projectRagAudit.toRag,
            comment: projectRagAudit.comment,
            changedByUserId: projectRagAudit.changedByUserId,
            changedAt: projectRagAudit.changedAt,
          })
          .from(projectRagAudit)
          .where(eq(projectRagAudit.projectId, projectId))
          .orderBy(desc(projectRagAudit.changedAt));

        const userIds = [...new Set(history.map((h: any) => h.changedByUserId).filter(Boolean))];
        const userMap = new Map<number, string>();
        if (userIds.length > 0) {
          const userRows = await db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(inArray(users.id, userIds as number[]));
          for (const u of userRows) userMap.set(u.id, u.name);
        }

        res.json(
          history.map((h: any) => ({
            ...h,
            changedByName: userMap.get(h.changedByUserId) || 'Unknown',
          })),
        );
      } catch (err: any) {
        console.error('[lifecycle-board] GET rag-history error:', err);
        throw err;
      }
    },
  );

  app.get(
    '/api/project-lifecycle/workspace',
    requireAuth,
    requirePermission('lifecycle', 'view'),
    async (_req: Request, res: Response) => {
      try {
        const workspace = await buildProjectLifecycleWorkspace();
        res.json(workspace);
      } catch (err: any) {
        console.error('[project-lifecycle] GET workspace error:', err);
        res.status(500).json({ error: 'Failed to load Project Lifecycle workspace' });
      }
    },
  );

  app.get(
    '/api/lifecycle-board/lifecycle-model',
    requireAuth,
    async (_req: Request, res: Response) => {
      const lifecycle = CANONICAL_PHASES.map((p) => ({
        key: p.code.toLowerCase(),
        code: p.code,
        label: p.label,
        phaseValue: p.label,
        sequence: p.displayNumber,
        isSelectable: true,
        isActive: true,
        ownerRole: p.ownerRole,
        // 0030_canonical_lifecycle_phases_v2.sql: expose terminal/sequential
        // flags so the lifecycle board can render Hold and Done as separate
        // columns next to the sequential cycle, rather than inline at the end.
        isSequential: p.isSequential,
        isTerminal: p.isTerminal,
      }));
      res.json({ lifecycle });
    },
  );

  app.get(
    '/api/lifecycle-board/remediation/legacy-phases',
    requireAuth,
    requirePermission('projects', 'view'),
    async (_req: Request, res: Response) => {
      const canonicalLc = new Set(CANONICAL_LIFECYCLE_LABELS.map((p) => p.toLowerCase()));

      const projectRows = await db
        .select({
          projectId: projectInfo.id,
          projectName: projectInfo.projectName,
          phase: projectExecutionState.phase,
          projectStatus: projectInfo.projectStatus,
        })
        .from(projectInfo)
        .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id));

      const projectsNeedingReview = projectRows
        .filter(
          (row: any) => !!row.phase && !canonicalLc.has(String(row.phase).trim().toLowerCase()),
        )
        .map((row: any) => ({
          projectId: row.projectId,
          projectName: row.projectName,
          currentPhase: row.phase,
          projectStatus: row.projectStatus,
          suggestedCanonicalPhase: resolveCanonicalPhase(row.phase)?.label ?? null,
          requiresManualReview: !resolveCanonicalPhase(row.phase),
        }));

      const templateRows = await db
        .select({
          templateId: phaseTemplate.id,
          phase: phaseTemplate.phase,
          name: phaseTemplate.name,
          version: phaseTemplate.version,
          isActive: phaseTemplate.isActive,
        })
        .from(phaseTemplate);

      const templatesNeedingReview = templateRows
        .filter(
          (row: any) =>
            !canonicalLc.has(
              String(row.phase || '')
                .trim()
                .toLowerCase(),
            ),
        )
        .map((row: any) => ({
          templateId: row.templateId,
          templateName: row.name,
          version: row.version,
          isActive: row.isActive,
          currentPhase: row.phase,
          suggestedCanonicalPhase: resolveCanonicalPhase(row.phase)?.label ?? null,
          requiresManualReview: !resolveCanonicalPhase(row.phase),
        }));

      res.json({
        generatedAt: new Date().toISOString(),
        canonicalPhases: CANONICAL_LIFECYCLE_LABELS,
        projectsNeedingReview,
        templatesNeedingReview,
      });
    },
  );

  app.get('/api/lifecycle-board/projects', requireAuth, async (_req: Request, res: Response) => {
    try {
      const allProjects = await db
        .select({
          id: projectInfo.id,
          projectName: projectInfo.projectName,
          sizeKwp: projectInfo.sizeKwp,
          pd: projectInfo.pd,
          pm: projectInfo.pm,
          contractValue: projectInfo.contractValue,
          projectStatus: projectInfo.projectStatus,
          phase: projectExecutionState.phase,
          isActive: projectExecutionState.isActive,
          escalationLevel: projectExecutionState.escalationLevel,
          ragStatus: projectExecutionState.ragStatus,
          ragComment: projectExecutionState.ragComment,
          ragUpdatedAt: projectExecutionState.ragUpdatedAt,
          ragUpdatedByUserId: projectExecutionState.ragUpdatedByUserId,
          executionEnabled: projectExecutionState.executionEnabled,
          executionGateStatus: projectExecutionState.executionGateStatus,
          signedStatus: projectExecutionState.signedStatus,
          signedDate: projectExecutionState.signedDate,
          signedDocumentLink: projectExecutionState.signedDocumentLink,
          executionPhase: projectExecutionState.executionPhase,
          archivedStatus: projectExecutionState.archivedStatus,
          phaseUpdatedAt: projectExecutionState.phaseUpdatedAt,
          updatedAt: projectInfo.updatedAt,
          constructionStartDate: projectExecutionState.constructionStartDate,
          commissioningDate: projectExecutionState.commissioningDate,
          clientHandoverDate: projectExecutionState.clientHandoverDate,
        })
        .from(projectInfo)
        .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id));

      const allEngTasks = await db
        .execute(
          sql`
        SELECT pi.project_name AS "projectName", wi.status, wi.end_date AS "dueDate", wi.priority, NULL AS assignees
        FROM work_items wi JOIN project_info pi ON wi.project_id = pi.id
        WHERE wi.deleted_at IS NULL AND wi.workstream = 'ENG'
      `,
        )
        .then((r: any) => r.rows || r);

      // Use the unified progress source (PM + ENG + QUALITY) so the
      // Schedule Status modal, the "Projects Behind Schedule" card, and
      // the COO Home progress chips produce the SAME numbers as the
      // project's Plan tab and the Excel project-plan top-row rollup.
      // See work-items-adapter.ts → getAllWorkItemsForProgress for the
      // rationale.
      const rawPlanTasks = (await getAllWorkItemsForProgress()).map((wi: any) => ({
        projectName: wi.projectName,
        actualPctComplete: wi.actualPctComplete,
        expectedPctComplete: wi.expectedPctComplete,
        durationDays: wi.durationDays,
        taskNo: wi.taskNo,
        rowNumber: wi.rowNumber,
        parentRowNumber: wi.parentRowNumber ?? null,
        indentLevel: wi.indentLevel ?? null,
        startDate: wi.startDate,
        endDate: wi.endDate,
        actualStart: wi.actualStart,
        actualEnd: wi.actualEnd,
      }));

      const allPlanTasks = rawPlanTasks;

      const trackerProjectNames = new Set<string>();
      const expenseNames = await db
        .selectDistinct({ projectName: normalizedCostLines.projectName })
        .from(normalizedCostLines)
        .where(and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt)));
      for (const e of expenseNames) {
        if (e.projectName) trackerProjectNames.add(normalizeName(e.projectName));
      }
      const inflowNames = await db
        .selectDistinct({ projectName: normalizedRevenueLines.projectName })
        .from(normalizedRevenueLines)
        .where(
          and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt)),
        );
      for (const i of inflowNames) {
        if (i.projectName) trackerProjectNames.add(normalizeName(i.projectName));
      }
      const planProjectNames = [
        ...new Set(rawPlanTasks.map((t: any) => t.projectName).filter(Boolean)),
      ];
      for (const pn of planProjectNames) {
        trackerProjectNames.add(normalizeName(pn));
      }

      const allRevLines = await db
        .select({
          projectId: normalizedRevenueLines.projectId,
          projectName: normalizedRevenueLines.projectName,
          amountExVat: normalizedRevenueLines.amountExVat,
          invoiceNumber: normalizedRevenueLines.invoiceNumber,
          paidDateConfirmed: normalizedRevenueLines.paidDateConfirmed,
        })
        .from(normalizedRevenueLines)
        .where(
          and(isNull(normalizedRevenueLines.effectiveTo), isNull(normalizedRevenueLines.deletedAt)),
        );

      const allCostLines = await db
        .select({
          projectId: normalizedCostLines.projectId,
          projectName: normalizedCostLines.projectName,
          amountExVat: normalizedCostLines.amountExVat,
          invoiceNumber: normalizedCostLines.invoiceNumber,
          invoiceDateConfirmed: normalizedCostLines.invoiceDateConfirmed,
          poNumber: normalizedCostLines.poNumber,
          paidDateConfirmed: normalizedCostLines.paidDateConfirmed,
        })
        .from(normalizedCostLines)
        .where(and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt)));

      // Canonical reporting preference: aggregate finance by projectId first,
      // then use normalized projectName only as compatibility fallback.
      const emptyFin = () => ({
        totalRevenue: 0,
        invoicedRevenue: 0,
        receivedRevenue: 0,
        totalCost: 0,
        invoicedCost: 0,
        paidCost: 0,
      });
      const finByProjectId = new Map<number, ReturnType<typeof emptyFin>>();
      const finByNorm = new Map<string, ReturnType<typeof emptyFin>>();
      for (const r of allRevLines) {
        const amt = parseFloat(r.amountExVat || '0') || 0;
        if (r.projectId) {
          if (!finByProjectId.has(r.projectId)) finByProjectId.set(r.projectId, emptyFin());
          const entry = finByProjectId.get(r.projectId)!;
          entry.totalRevenue += amt;
          if (r.invoiceNumber) entry.invoicedRevenue += amt;
          if (r.paidDateConfirmed) entry.receivedRevenue += amt;
          continue;
        }
        const name = r.projectName;
        if (!name) continue;
        const norm = normalizeName(name);
        if (!finByNorm.has(norm)) finByNorm.set(norm, emptyFin());
        const entry = finByNorm.get(norm)!;
        entry.totalRevenue += amt;
        if (r.invoiceNumber) entry.invoicedRevenue += amt;
        if (r.paidDateConfirmed) entry.receivedRevenue += amt;
      }
      for (const c of allCostLines) {
        const amt = parseFloat(c.amountExVat || '0') || 0;
        if (c.projectId) {
          if (!finByProjectId.has(c.projectId)) finByProjectId.set(c.projectId, emptyFin());
          const entry = finByProjectId.get(c.projectId)!;
          entry.totalCost += amt;
          if (c.invoiceNumber) entry.invoicedCost += amt;
          if (c.paidDateConfirmed) entry.paidCost += amt;
          continue;
        }
        const name = c.projectName;
        if (!name) continue;
        const norm = normalizeName(name);
        if (!finByNorm.has(norm)) finByNorm.set(norm, emptyFin());
        const entry = finByNorm.get(norm)!;
        entry.totalCost += amt;
        if (c.invoiceNumber) entry.invoicedCost += amt;
        if (c.paidDateConfirmed) entry.paidCost += amt;
      }

      const DONE_STATUSES = ['DONE', 'QC APPROVED', 'COMPLETED'];
      const today = new Date().toISOString().split('T')[0];

      const engByNorm = new Map<
        string,
        {
          total: number;
          done: number;
          overdue: number;
          highPriority: number;
          assignees: Set<string>;
          rawName: string;
        }
      >();
      for (const t of allEngTasks) {
        const name = t.projectName;
        if (!name) continue;
        const norm = normalizeName(name);
        if (!engByNorm.has(norm))
          engByNorm.set(norm, {
            total: 0,
            done: 0,
            overdue: 0,
            highPriority: 0,
            assignees: new Set(),
            rawName: name,
          });
        const entry = engByNorm.get(norm)!;
        entry.total++;
        const isDone = t.status && DONE_STATUSES.includes(t.status.toUpperCase());
        if (isDone) {
          entry.done++;
        } else {
          if (t.dueDate && t.dueDate < today) entry.overdue++;
          if (t.priority && ['High', 'Urgent', 'Highest'].includes(t.priority))
            entry.highPriority++;
        }
        if (t.assignees && Array.isArray(t.assignees)) {
          for (const a of t.assignees) {
            if (a) entry.assignees.add(a);
          }
        }
      }

      const allQmData = await db
        .select({
          projectName: qcChecklist.projectName,
          isApplicable: qcItemInstance.isApplicable,
          approved: qcItemInstance.approved,
        })
        .from(qcChecklist)
        .innerJoin(qcItemInstance, eq(qcItemInstance.checklistId, qcChecklist.id));

      const qmByNorm = new Map<string, { total: number; approved: number }>();
      for (const q of allQmData) {
        const name = q.projectName;
        if (!name) continue;
        const norm = normalizeName(name);
        if (!qmByNorm.has(norm)) qmByNorm.set(norm, { total: 0, approved: 0 });
        const entry = qmByNorm.get(norm)!;
        if (q.isApplicable) {
          entry.total++;
          if (q.approved) entry.approved++;
        }
      }

      const todayDate = new Date().toISOString().split('T')[0];

      const milestoneKeys = new Set<string>();

      // Group plan tasks by project for leaf-task identification (matching UnifiedPlanTab)
      const lcPlanTasksByNorm = new Map<string, any[]>();
      for (const p of allPlanTasks) {
        const name = p.projectName;
        if (!name) continue;
        const taskNo = (p.taskNo || '').toString().toLowerCase().trim();
        const isSummary = taskNo === 'no.' || taskNo === 'no' || taskNo === '#';
        if (isSummary) continue;
        if (p.rowNumber && milestoneKeys.has(`${name}::${p.rowNumber}`)) continue;
        const norm = normalizeName(name);
        if (!lcPlanTasksByNorm.has(norm)) lcPlanTasksByNorm.set(norm, []);
        lcPlanTasksByNorm.get(norm)!.push(p);
      }

      // Per-project progress via the canonical helper in
      // server/lib/kpi-formulas.ts. weightedPct / totalWeight here are
      // shaped so the downstream serialisation (line ~1826) still divides
      // and produces the same pct that the Plan tab pill shows.
      const planByNorm = new Map<
        string,
        {
          total: number;
          weightedPct: number;
          totalWeight: number;
          weightedExpPct: number;
          totalExpWeight: number;
        }
      >();
      for (const [norm, tasks] of lcPlanTasksByNorm) {
        const progress = computeProjectProgress(
          tasks.map((p: any) => ({
            taskNo: p.taskNo ?? null,
            rowNumber: p.rowNumber ?? null,
            parentRowNumber: p.parentRowNumber ?? null,
            indentLevel: p.indentLevel ?? null,
            durationDays: p.durationDays ?? null,
            actualPctComplete: p.actualPctComplete ?? null,
            expectedPctComplete: p.expectedPctComplete ?? null,
            startDate: p.startDate ?? null,
            endDate: p.endDate ?? null,
            actualStartDate: p.actualStart ?? null,
            actualEndDate: p.actualEnd ?? null,
          })),
          todayDate,
        );
        const hasItems = progress.leafCount > 0;
        // Helper returns 0..100; downstream code expects weightedPct on
        // the same scale as actualPctComplete (0..1) divided by totalWeight,
        // then multiplied by 100 (see line 1828). So we store weightedPct
        // pre-scaled to 0..1 and totalWeight = 1, which lets the existing
        // `(weightedPct / totalWeight) * 100` produce the canonical pct.
        planByNorm.set(norm, {
          total: progress.leafCount,
          weightedPct: hasItems ? progress.actualPct / 100 : 0,
          totalWeight: hasItems ? 1 : 0,
          weightedExpPct: hasItems ? progress.expectedPct / 100 : 0,
          totalExpWeight: hasItems ? 1 : 0,
        });
      }

      const lastEngByProjectId = new Map<number, { name: string; at: string }>();
      try {
        const engWorkItems = await db.execute(
          sql.raw(`
          SELECT DISTINCT ON (wi.project_id)
            wi.project_id,
            COALESCE(u.name, 'Unknown') as engineer_name,
            wi.updated_at
          FROM work_items wi
          LEFT JOIN users u ON u.id = wi.owner_user_id
          WHERE wi.workstream = 'ENG'
            AND wi.deleted_at IS NULL
            AND wi.owner_user_id IS NOT NULL
            AND wi.project_id IS NOT NULL
          ORDER BY wi.project_id, wi.updated_at DESC
        `),
        );
        for (const row of engWorkItems.rows as any[]) {
          lastEngByProjectId.set(row.project_id, { name: row.engineer_name, at: row.updated_at });
        }
      } catch (e: any) {
        console.warn('[lifecycle-board] last engineer query error:', e.message);
      }

      const pdPctByProjectId = new Map<number, number>();
      try {
        const pdItems = await db.execute(
          sql.raw(`
          SELECT project_id,
            CASE WHEN COUNT(*) > 0 THEN
              SUM(COALESCE(percent_complete, 0) * GREATEST(COALESCE(duration, 1), 1)) / NULLIF(SUM(GREATEST(COALESCE(duration, 1), 1)), 0)
            ELSE NULL END as pd_pct
          FROM work_items
          WHERE workstream = 'PD'
            AND deleted_at IS NULL
            AND project_id IS NOT NULL
          GROUP BY project_id
        `),
        );
        for (const row of pdItems.rows as any[]) {
          if (row.pd_pct !== null) pdPctByProjectId.set(row.project_id, Number(row.pd_pct));
        }
      } catch (e: any) {
        console.warn('[lifecycle-board] PD pct query error:', e.message);
      }

      const ragUserIds = allProjects.map((p: any) => (p as any).ragUpdatedByUserId).filter(Boolean);
      const ragUserMap = new Map<number, string>();
      if (ragUserIds.length > 0) {
        try {
          const ragUsers = await db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(inArray(users.id, ragUserIds));
          for (const u of ragUsers) ragUserMap.set(u.id, u.name);
        } catch (e: any) {}
      }

      const projectNormNames = new Set<string>();
      const results: any[] = [];

      for (const proj of allProjects) {
        const norm = normalizeName(proj.projectName);
        projectNormNames.add(norm);

        const plan = planByNorm.get(norm) || {
          total: 0,
          weightedPct: 0,
          totalWeight: 0,
          weightedExpPct: 0,
          totalExpWeight: 0,
        };
        const eng = engByNorm.get(norm) || {
          total: 0,
          done: 0,
          overdue: 0,
          highPriority: 0,
          assignees: new Set<string>(),
          rawName: '',
        };
        const qm = qmByNorm.get(norm) || { total: 0, approved: 0 };
        const fin = finByProjectId.get(proj.id) ||
          finByNorm.get(norm) || {
            totalRevenue: 0,
            invoicedRevenue: 0,
            receivedRevenue: 0,
            totalCost: 0,
            invoicedCost: 0,
            paidCost: 0,
          };

        const hasTracker = trackerProjectNames.has(norm);
        let source: 'excel' | 'engineering' | 'both' = hasTracker ? 'excel' : ('none' as any);
        if (eng.total > 0 && hasTracker) source = 'both';
        else if (eng.total > 0) source = 'engineering';
        else if (hasTracker) source = 'excel';

        const isEligible =
          proj.signedStatus !== 'NONE' &&
          proj.signedDate != null &&
          proj.signedDocumentLink != null &&
          proj.signedDocumentLink.trim() !== '';
        const computedGateStatus = proj.executionEnabled
          ? 'ENABLED'
          : isEligible
            ? 'ELIGIBLE'
            : 'NOT_ELIGIBLE';
        const executionEligibilityReasons: string[] = [];
        if (proj.signedStatus === 'NONE') executionEligibilityReasons.push('No signed status set');
        if (!proj.signedDate) executionEligibilityReasons.push('No signed date');
        if (!proj.signedDocumentLink?.trim())
          executionEligibilityReasons.push('No signed document link');

        const projectPctComplete =
          plan.totalWeight > 0 ? plan.weightedPct / plan.totalWeight : null;
        const expectedPctComplete =
          plan.totalExpWeight > 0 ? plan.weightedExpPct / plan.totalExpWeight : null;
        const gpPct =
          fin.totalRevenue > 0
            ? Math.round(((fin.totalRevenue - fin.totalCost) / fin.totalRevenue) * 100)
            : null;

        const engPct = eng.total > 0 ? eng.done / eng.total : null;
        const qmPct = qm.total > 0 ? qm.approved / qm.total : null;
        const pmPct = projectPctComplete;
        const pdPct = pdPctByProjectId.get(proj.id) ?? null;

        results.push({
          id: proj.id,
          projectName: proj.projectName,
          sizeKwp: proj.sizeKwp,
          pd: proj.pd,
          pm: proj.pm,
          contractValue: proj.contractValue,
          projectStatus: proj.projectStatus,
          phase: proj.phase,
          isActive: proj.isActive,
          escalationLevel: proj.escalationLevel,
          ragStatus: proj.ragStatus,
          ragComment: proj.ragComment,
          ragUpdatedAt: proj.ragUpdatedAt,
          ragUpdatedByUserId: proj.ragUpdatedByUserId,
          ragUpdatedByName: proj.ragUpdatedByUserId
            ? ragUserMap.get(proj.ragUpdatedByUserId) || null
            : null,
          executionEnabled: proj.executionEnabled,
          executionGateStatus: computedGateStatus,
          signedStatus: proj.signedStatus,
          executionPhase: proj.executionPhase,
          archivedStatus: proj.archivedStatus,
          source,
          hasTracker,
          engTotal: eng.total,
          engDone: eng.done,
          engOverdue: eng.overdue,
          engHighPriority: eng.highPriority,
          engAssignees: Array.from(eng.assignees),
          planTotal: plan.total,
          planAvgPct:
            plan.totalWeight > 0
              ? Math.round((plan.weightedPct / plan.totalWeight) * 100) / 100
              : 0,
          projectPctComplete,
          expectedPctComplete,
          qmTotal: qm.total,
          qmApproved: qm.approved,
          totalRevenue: fin.totalRevenue,
          invoicedRevenue: fin.invoicedRevenue,
          receivedRevenue: fin.receivedRevenue,
          totalCost: fin.totalCost,
          invoicedCost: fin.invoicedCost,
          paidCost: fin.paidCost,
          gpPct,
          phaseUpdatedAt: proj.phaseUpdatedAt,
          updatedAt: proj.updatedAt,
          constructionStartDate: proj.constructionStartDate,
          commissioningDate: proj.commissioningDate,
          clientHandoverDate: proj.clientHandoverDate,
          lastEngineer: lastEngByProjectId.get(proj.id) || null,
          pdPercent: pdPct,
          engPercent: engPct,
          qmPercent: qmPct,
          pmPercent: pmPct,
          executionEligibilityReasons,
        });
      }

      res.json(results);
    } catch (err: any) {
      console.error('[lifecycle-board] GET projects error:', err);
      throw err;
    }
  });

  app.get(
    '/api/lifecycle-board/execution-dashboard',
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const fy = resolveDashboardFinanceScope(req.query);
        const today = new Date().toISOString().slice(0, 10);
        const activeProjects = (await db
          .select(
            selectDefinedFields({
              id: projectInfo.id,
              projectName: projectInfo.projectName,
              pm: projectInfo.pm,
              pd: projectInfo.pd,
              executionPhase: projectExecutionState.executionPhase,
              ragStatus: projectExecutionState.ragStatus,
              archivedStatus: projectExecutionState.archivedStatus,
              phase: projectExecutionState.phase,
              cpSigned: projectExecutionState.cpSigned,
              signedStatus: projectExecutionState.signedStatus,
            }),
          )
          .from(projectInfo)
          .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
          .where(
            eq(projectExecutionState.archivedStatus, 'ACTIVE'),
          )) as ExecutionDashboardProjectRow[];

        // Helpers matching program-dashboard logic
        const hasText = (v: any) => typeof v === 'string' && v.trim().length > 0;

        // 2026-05-19: Use the canonical helper so the Execution Dashboard
        // "All Projects" table is fed the same row set (PM + ENG + QUALITY)
        // and ordering (workbook top-to-bottom via sort_order/source_row)
        // as the Plan tab and Schedule Status modal — single source of
        // truth for Actual %, Expected %, Variance. The helper already
        // returns rowNumber + parentRowNumber resolved from work_items
        // self-ref so computeProjectProgress' parent detection works
        // correctly. See server/work-items-adapter.ts.
        const rawPlanTasksFull = await getAllWorkItemsForProgress();

        // Group by projectId for per-project computation
        const planTasksByProjectId = new Map<number, any[]>();
        for (const wi of rawPlanTasksFull) {
          if (!wi.projectId) continue;
          if (!planTasksByProjectId.has(wi.projectId)) planTasksByProjectId.set(wi.projectId, []);
          planTasksByProjectId.get(wi.projectId)!.push(wi);
        }

        const planFyItemsByNorm = new Map<string, number>();
        const planByNorm = new Map<
          string,
          {
            weightedPct: number;
            totalWeight: number;
            weightedExpPct: number;
            totalExpWeight: number;
            fyItems: number;
          }
        >();
        const PLAN_SECTION_HEADERS = new Set(['no.', 'no', '#']);

        for (const project of activeProjects) {
          const norm = normalizeName(project.projectName);
          const tasks = planTasksByProjectId.get(project.id);
          if (!tasks || tasks.length === 0) continue;

          // Strip section-header rows AND rows with no WBS + no dates.
          // Matches planning-tasks-routes.ts:256-265 which the plan tab uses.
          const filtered = tasks.filter((t: any) => {
            const wbs = (t.taskNo || '').toString().toLowerCase().trim();
            if (PLAN_SECTION_HEADERS.has(wbs)) return false;
            const hasWbs = t.taskNo && String(t.taskNo).trim().length > 0;
            const hasStart = t.startDate && String(t.startDate).trim().length > 0;
            const hasEnd = t.endDate && String(t.endDate).trim().length > 0;
            if (!hasWbs && !hasStart && !hasEnd) return false;
            return true;
          });

          // FY membership: any task with a date inside the financial year
          const fyItemCount = fy.allData
            ? filtered.length
            : filtered.filter((t: any) => {
                const d = t.startDate ?? t.endDate;
                return d && isDateInRange(String(d).slice(0, 10), fy.start, fy.end);
              }).length;
          planFyItemsByNorm.set(norm, fyItemCount);

          const progress = computeProjectProgress(
            filtered.map((t: any) => ({
              taskNo: t.taskNo ?? null,
              rowNumber: t.rowNumber ?? null,
              parentRowNumber: t.parentRowNumber ?? null,
              indentLevel: t.indentLevel ?? null,
              durationDays: t.durationDays ?? null,
              actualPctComplete: t.actualPctComplete ?? null,
              expectedPctComplete: t.expectedPctComplete ?? null,
              startDate: t.startDate ? String(t.startDate) : null,
              endDate: t.endDate ? String(t.endDate) : null,
              actualStartDate: t.actualStart ? String(t.actualStart) : null,
              actualEndDate: t.actualEnd ? String(t.actualEnd) : null,
            })),
            today,
          );

          // computeProjectProgress returns the final percentages on a
          // 0..100 scale. The downstream serialiser (~line 1828) does
          // `(weightedPct / totalWeight) * 100`, so pre-scale to 0..1 and
          // pin totalWeight = 1 — that produces the same canonical pct
          // the Plan tab pill displays for the same project.
          const hasItems = progress.leafCount > 0;
          planByNorm.set(norm, {
            weightedPct: hasItems ? progress.actualPct / 100 : 0,
            totalWeight: hasItems ? 1 : 0,
            weightedExpPct: hasItems ? progress.expectedPct / 100 : 0,
            totalExpWeight: hasItems ? 1 : 0,
            fyItems: fyItemCount,
          });
        }

        const revenueLines = await db
          .select(
            selectDefinedFields({
              projectId: normalizedRevenueLines.projectId,
              projectName: normalizedRevenueLines.projectName,
              client: sql<string | null>`NULL`.as('client'),

              amountExVat: normalizedRevenueLines.amountExVat,
              invoiceNumber: normalizedRevenueLines.invoiceNumber,
              paidDateConfirmed: normalizedRevenueLines.paidDateConfirmed,
              paidDate: normalizedRevenueLines.paidDate,
              paidDateFontColor: normalizedRevenueLines.paidDateFontColor,
              inBankDate: normalizedRevenueLines.inBankDate,
              status: normalizedRevenueLines.status,
              invoiceDate: normalizedRevenueLines.invoiceDate,
              expectedPaymentDate: normalizedRevenueLines.expectedPaymentDate,
              sourceRow: normalizedRevenueLines.sourceRow,
            }),
          )
          .from(normalizedRevenueLines)
          .where(
            and(
              isNull(normalizedRevenueLines.effectiveTo),
              isNull(normalizedRevenueLines.deletedAt),
            ),
          );

        const costLines = await db
          .select(
            selectDefinedFields({
              projectId: normalizedCostLines.projectId,
              projectName: normalizedCostLines.projectName,
              supplier: normalizedCostLines.counterpartyName,
              amountExVat: normalizedCostLines.amountExVat,
              invoiceNumber: normalizedCostLines.invoiceNumber,
              paidDateConfirmed: normalizedCostLines.paidDateConfirmed,
              paidDate: normalizedCostLines.paidDate,
              paidDateFontColor: normalizedCostLines.paidDateFontColor,
              invoiceDate: normalizedCostLines.invoiceDate,
              approvedDate: normalizedCostLines.approvedDate,
              cosRealised: normalizedCostLines.cosRealised,
              poNumber: normalizedCostLines.poNumber,
              invoiceDateConfirmed: normalizedCostLines.invoiceDateConfirmed,
              invoiceDateFontColor: normalizedCostLines.invoiceDateFontColor,
              sourceRow: normalizedCostLines.sourceRow,
              cosStatusOverride: normalizedCostLines.cosStatusOverride,
            }),
          )
          .from(normalizedCostLines)
          .where(
            and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt)),
          );

        const overdueLedger = buildOverdueFinanceLedger({
          revenueLines,
          costLines,
          activeProjects,
          fyStart: fy.start,
          fyEnd: fy.end,
          today,
        });
        const overdueByProjectId = new Map<number, { ap: number; ar: number }>();
        const overdueByNorm = new Map<string, { ap: number; ar: number }>();
        const addOverdue = (
          projectId: number | null,
          projectName: string | null | undefined,
          kind: 'ap' | 'ar',
          amount: number,
        ) => {
          if (!amount) return;
          if (projectId) {
            const current = overdueByProjectId.get(projectId) || { ap: 0, ar: 0 };
            current[kind] += amount;
            overdueByProjectId.set(projectId, current);
            return;
          }
          const norm = normalizeName(projectName || '');
          if (!norm) return;
          const current = overdueByNorm.get(norm) || { ap: 0, ar: 0 };
          current[kind] += amount;
          overdueByNorm.set(norm, current);
        };
        for (const item of overdueLedger.ap.items)
          addOverdue(item.projectId || null, item.projectName, 'ap', item.outstandingAmount || 0);
        for (const item of overdueLedger.ar.items)
          addOverdue(item.projectId || null, item.projectName, 'ar', item.outstandingAmount || 0);

        const finByProjectId = new Map<
          number,
          {
            plannedRevenue: number;
            receivedInflow: number;
            plannedExpenditure: number;
            paidExpenditure: number;
            fyRevenueItems: number;
            fyCostItems: number;
            inflowRisk: number;
            outflowRisk: number;
          }
        >();
        const finByNorm = new Map<
          string,
          {
            plannedRevenue: number;
            receivedInflow: number;
            plannedExpenditure: number;
            paidExpenditure: number;
            fyRevenueItems: number;
            fyCostItems: number;
            inflowRisk: number;
            outflowRisk: number;
          }
        >();
        const emptyFin = () => ({
          plannedRevenue: 0,
          receivedInflow: 0,
          plannedExpenditure: 0,
          paidExpenditure: 0,
          fyRevenueItems: 0,
          fyCostItems: 0,
          inflowRisk: 0,
          outflowRisk: 0,
        });

        for (const row of revenueLines) {
          const amount = parseFloat(row.amountExVat || '0') || 0;
          const dateKey = pickFirstPopulatedDate(row as any, [
            'expectedPaymentDate',
            'invoiceDate',
            'paidDate',
            'inBankDate',
          ]);
          if (!fy.allData && !isDateInRange(dateKey, fy.start, fy.end)) continue;
          const paidDateIsPast = !!row.paidDate && row.paidDate <= today;
          const paidConfirmed =
            paidDateIsPast && (row.paidDateConfirmed === true || row.paidDateFontColor === 'black');
          const received = paidConfirmed || !!row.inBankDate;

          const addTo = (entry: ReturnType<typeof emptyFin>) => {
            entry.plannedRevenue += amount;
            if (received) entry.receivedInflow += amount;
            else if (dateKey && dateKey < today) entry.inflowRisk += amount;
            entry.fyRevenueItems += 1;
          };
          if (row.projectId) {
            if (!finByProjectId.has(row.projectId)) finByProjectId.set(row.projectId, emptyFin());
            addTo(finByProjectId.get(row.projectId)!);
          } else if (row.projectName) {
            const norm = normalizeName(row.projectName);
            if (!finByNorm.has(norm)) finByNorm.set(norm, emptyFin());
            addTo(finByNorm.get(norm)!);
          }
        }

        const COS_REALISED_OVERRIDES = OVERRIDE_REALISED;
        const COS_NOT_REALISED_OVERRIDES = OVERRIDE_NOT_REALISED;
        for (const row of costLines) {
          const amount = parseFloat(row.amountExVat || '0') || 0;
          const dateKey = pickFirstPopulatedDate(row as any, [
            'approvedDate',
            'invoiceDate',
            'paidDate',
          ]);
          if (!fy.allData && !isDateInRange(dateKey, fy.start, fy.end)) continue;
          const costPaidDateIsPast = !!row.paidDate && row.paidDate <= today;
          const costPaidConfirmed =
            costPaidDateIsPast &&
            (row.paidDateConfirmed === true || row.paidDateFontColor === 'black');
          const cosOverride = String(row.cosStatusOverride ?? '')
            .trim()
            .toUpperCase();
          let paid: boolean;
          if (COS_REALISED_OVERRIDES.has(cosOverride)) {
            paid = costPaidDateIsPast;
          } else if (COS_NOT_REALISED_OVERRIDES.has(cosOverride)) {
            paid = false;
          } else {
            paid = costPaidConfirmed;
          }

          const addTo = (entry: ReturnType<typeof emptyFin>) => {
            entry.plannedExpenditure += amount;
            if (paid) entry.paidExpenditure += amount;
            else if (dateKey && dateKey < today) entry.outflowRisk += amount;
            entry.fyCostItems += 1;
          };
          if (row.projectId) {
            if (!finByProjectId.has(row.projectId)) finByProjectId.set(row.projectId, emptyFin());
            addTo(finByProjectId.get(row.projectId)!);
          } else if (row.projectName) {
            const norm = normalizeName(row.projectName);
            if (!finByNorm.has(norm)) finByNorm.set(norm, emptyFin());
            addTo(finByNorm.get(norm)!);
          }
        }

        const activeProjectIds = activeProjects.map((p) => p.id);
        const engTasks: ExecutionDashboardEngTaskRow[] =
          activeProjectIds.length > 0
            ? await db
                .select({
                  projectId: workItems.projectId,
                  projectName: projectInfo.projectName,
                  status: workItems.status,
                  dueDate: workItems.endDate,
                  blockerReason: workItems.blockerReason,
                  priority: workItems.priority,
                  ownerUserId: workItems.ownerUserId,
                  title: workItems.title,
                })
                .from(workItems)
                .innerJoin(projectInfo, eq(workItems.projectId, projectInfo.id))
                .where(
                  and(
                    isNull(workItems.deletedAt),
                    eq(workItems.workstream, 'ENG'),
                    inArray(workItems.projectId, activeProjectIds),
                  ),
                )
            : [];
        const qualityRows = await db
          .select(
            selectDefinedFields({
              projectName: qcWarning.projectName,
              status: qcWarning.status,
              severity: qcWarning.severity,
              title: qcWarning.title,
              dueDate: qcWarning.dueDate,
              ownerUserId: qcWarning.ownerUserId,
            }),
          )
          .from(qcWarning);
        const approvalRows = await db
          .select(
            selectDefinedFields({
              projectId: approvals.projectId,
              status: approvals.status,
              title: approvals.title,
              dueDate: approvals.dueDate,
              assignedApprover: approvals.assignedApprover,
            }),
          )
          .from(approvals);
        const importRuns = await db
          .select(
            selectDefinedFields({
              projectId: smartImportRuns.projectId,
              projectName: smartImportRuns.projectName,
              uploadedAt: smartImportRuns.uploadedAt,
            }),
          )
          .from(smartImportRuns);

        const latestImportByProjectId = new Map<number, Date>();
        const latestImportByNorm = new Map<string, Date>();
        for (const run of importRuns) {
          const dt = run.uploadedAt ? new Date(run.uploadedAt) : null;
          if (!dt || Number.isNaN(dt.getTime())) continue;
          if (run.projectId) {
            const current = latestImportByProjectId.get(run.projectId);
            if (!current || dt > current) latestImportByProjectId.set(run.projectId, dt);
          }
          if (run.projectName) {
            const norm = normalizeName(run.projectName);
            const current = latestImportByNorm.get(norm);
            if (!current || dt > current) latestImportByNorm.set(norm, dt);
          }
        }

        const usersById = new Map<number, string>();
        const ownerIds = new Set<number>();
        for (const t of engTasks) if (t.ownerUserId) ownerIds.add(t.ownerUserId);
        for (const q of qualityRows) if (q.ownerUserId) ownerIds.add(q.ownerUserId);
        for (const a of approvalRows) if (a.assignedApprover) ownerIds.add(a.assignedApprover);
        if (ownerIds.size > 0) {
          const owners = await db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(inArray(users.id, Array.from(ownerIds)));
          for (const o of owners) usersById.set(o.id, o.name);
        }

        const actionRows: any[] = [];
        const projectRows: any[] = [];
        const todayDt = new Date();

        for (const project of activeProjects) {
          const norm = normalizeName(project.projectName);
          const plan = planByNorm.get(norm) || {
            weightedPct: 0,
            totalWeight: 0,
            weightedExpPct: 0,
            totalExpWeight: 0,
            fyItems: 0,
          };
          const fin = finByProjectId.get(project.id) || finByNorm.get(norm) || emptyFin();
          const projectOverdue = overdueByProjectId.get(project.id) ||
            overdueByNorm.get(norm) || { ap: 0, ar: 0 };
          const hasCanonicalData =
            planByNorm.has(norm) || finByProjectId.has(project.id) || finByNorm.has(norm);
          const hasCurrentFyItem =
            fy.allData || plan.fyItems > 0 || fin.fyRevenueItems > 0 || fin.fyCostItems > 0;
          if (!hasCanonicalData || !hasCurrentFyItem) continue;

          const actualProgressPct =
            plan.totalWeight > 0
              ? Number(((plan.weightedPct / plan.totalWeight) * 100).toFixed(1))
              : null;
          const expectedProgressPct =
            plan.totalExpWeight > 0
              ? Number(((plan.weightedExpPct / plan.totalExpWeight) * 100).toFixed(1))
              : null;
          const scheduleVariancePct =
            actualProgressPct !== null && expectedProgressPct !== null
              ? Number((actualProgressPct - expectedProgressPct).toFixed(1))
              : null;
          const behindPlan =
            actualProgressPct !== null &&
            expectedProgressPct !== null &&
            actualProgressPct < expectedProgressPct - 5;

          // Compute RAG from progress delta (matching projects-summary logic)
          // Uses manual ragStatus if set, otherwise computes from schedule variance
          let computedRag: string;
          if (project.ragStatus) {
            computedRag = project.ragStatus;
          } else if (scheduleVariancePct !== null) {
            // scheduleVariancePct is in percentage points (e.g., -5 means 5% behind)
            // Thresholds: >= -5 is Green, >= -15 is Amber, < -15 is Red
            computedRag =
              scheduleVariancePct >= -5 ? 'Green' : scheduleVariancePct >= -15 ? 'Amber' : 'Red';
          } else {
            computedRag = 'Unknown';
          }

          const plannedRevenueFy = fin.plannedRevenue;
          const receivedInflowFy = fin.receivedInflow;
          const openInflowFy = plannedRevenueFy - receivedInflowFy;
          const plannedExpenditureFy = fin.plannedExpenditure;
          const paidExpenditureFy = fin.paidExpenditure;
          const openExpenditureFy = plannedExpenditureFy - paidExpenditureFy;
          const grossProfitFy = plannedRevenueFy - plannedExpenditureFy;
          const grossMarginPctFy = computeMarginPct(plannedRevenueFy, plannedExpenditureFy, {
            precision: 1,
          });

          const projectEng = engTasks.filter(
            (t) =>
              (t.projectId && t.projectId === project.id) ||
              (!t.projectId && normalizeName(t.projectName || '') === norm),
          );
          const openEng = projectEng.filter(
            (t) =>
              !['done', 'completed', 'qc approved', 'cancelled', 'canceled'].includes(
                (t.status || '').toLowerCase(),
              ),
          );
          const engBlockers = openEng.filter(
            (t) =>
              Boolean(t.blockerReason) ||
              ['high', 'urgent', 'highest', 'critical'].includes(
                (t.priority || '').toLowerCase(),
              ) ||
              (t.status || '').toLowerCase().includes('block'),
          );

          const projectQuality = qualityRows.filter(
            (q: any) => normalizeName(q.projectName || '') === norm,
          );
          const openQuality = projectQuality.filter(
            (q: any) => (q.status || 'open').toLowerCase() !== 'closed',
          );
          const criticalQuality = openQuality.filter((q: any) =>
            ['high', 'critical'].includes((q.severity || '').toLowerCase()),
          );

          const projectApprovals = approvalRows.filter(
            (a: any) => a.projectId === project.id && a.status === 'pending',
          );

          const latestImport =
            latestImportByProjectId.get(project.id) || latestImportByNorm.get(norm) || null;
          const staleDays = latestImport
            ? Math.floor((todayDt.getTime() - latestImport.getTime()) / (1000 * 60 * 60 * 24))
            : null;
          const importFreshness =
            staleDays === null
              ? 'Critical'
              : staleDays >= 14
                ? 'Critical'
                : staleDays >= 7
                  ? 'Warning'
                  : 'Fresh';

          const engineeringStatus =
            engBlockers.length > 0
              ? 'Blocked'
              : openEng.some((t) => t.dueDate && t.dueDate < todayDt.toISOString().slice(0, 10))
                ? 'At Risk'
                : 'On Track';
          const qualityStatus =
            criticalQuality.length > 0
              ? 'Blocked'
              : openQuality.length > 0
                ? 'At Risk'
                : 'On Track';
          const inflowRisk =
            fin.inflowRisk > 0 ||
            (openInflowFy > 0 && plannedRevenueFy > 0 && openInflowFy / plannedRevenueFy > 0.35);
          const outflowRisk =
            fin.outflowRisk > 0 ||
            (openExpenditureFy > 0 &&
              plannedExpenditureFy > 0 &&
              openExpenditureFy / plannedExpenditureFy > 0.35);
          const criticalActionCount = [
            behindPlan,
            inflowRisk,
            outflowRisk,
            engBlockers.length > 0,
            criticalQuality.length > 0,
            projectApprovals.length > 0,
          ].filter(Boolean).length;

          if (behindPlan)
            actionRows.push({
              projectId: project.id,
              projectName: project.projectName,
              queue: 'Projects Behind Plan',
              issueTitle: `Actual ${actualProgressPct}% vs Expected ${expectedProgressPct}%`,
              severity: expectedProgressPct! - actualProgressPct! > 15 ? 'Critical' : 'High',
              owner: project.pm || project.pd || 'Unassigned',
              dueDate: null,
              link: `/project/${encodeURIComponent(project.projectName)}?tab=plan`,
            });
          if (inflowRisk) {
            const inflowPct =
              plannedRevenueFy > 0 ? Math.round((openInflowFy / plannedRevenueFy) * 100) : 0;
            actionRows.push({
              projectId: project.id,
              projectName: project.projectName,
              queue: 'Inflow at Risk',
              issueTitle: `R${Math.round(openInflowFy).toLocaleString()} open of R${Math.round(plannedRevenueFy).toLocaleString()} planned (${inflowPct}% outstanding)`,
              severity: inflowPct > 60 ? 'Critical' : 'High',
              owner: project.pm || 'Unassigned',
              dueDate: null,
              link: `/project/${encodeURIComponent(project.projectName)}?tab=revenue`,
            });
          }
          if (outflowRisk) {
            const outflowPct =
              plannedExpenditureFy > 0
                ? Math.round((openExpenditureFy / plannedExpenditureFy) * 100)
                : 0;
            actionRows.push({
              projectId: project.id,
              projectName: project.projectName,
              queue: 'Expenditure / COS at Risk',
              issueTitle: `R${Math.round(openExpenditureFy).toLocaleString()} open of R${Math.round(plannedExpenditureFy).toLocaleString()} planned (${outflowPct}% outstanding)`,
              severity: outflowPct > 60 ? 'Critical' : 'High',
              owner: project.pm || 'Unassigned',
              dueDate: null,
              link: `/project/${encodeURIComponent(project.projectName)}?tab=expenditure`,
            });
          }
          for (const t of engBlockers.slice(0, 5))
            actionRows.push({
              projectId: project.id,
              projectName: project.projectName,
              queue: 'Engineering Bottlenecks',
              issueTitle: t.title || 'Engineering blocker',
              severity: 'High',
              owner: t.ownerUserId ? usersById.get(t.ownerUserId) || 'Owner' : 'Unassigned',
              dueDate: t.dueDate || null,
              link: `/project/${encodeURIComponent(project.projectName)}?tab=plan`,
            });
          for (const q of openQuality.slice(0, 5))
            actionRows.push({
              projectId: project.id,
              projectName: project.projectName,
              queue: 'Quality Issues',
              issueTitle: q.title,
              severity: q.severity || 'Medium',
              owner: q.ownerUserId ? usersById.get(q.ownerUserId) || 'Owner' : 'Unassigned',
              dueDate: q.dueDate || null,
              link: `/project/${encodeURIComponent(project.projectName)}`,
            });
          for (const a of projectApprovals.slice(0, 5))
            actionRows.push({
              projectId: project.id,
              projectName: project.projectName,
              queue: 'Pending Approvals / Decisions',
              issueTitle: a.title || 'Pending approval',
              severity: 'Medium',
              owner: a.assignedApprover
                ? usersById.get(a.assignedApprover) || 'Approver'
                : 'Unassigned',
              dueDate: a.dueDate ? new Date(a.dueDate).toISOString().slice(0, 10) : null,
              link: `/project/${encodeURIComponent(project.projectName)}`,
            });

          projectRows.push({
            projectId: project.id,
            projectName: project.projectName,
            portfolio: '—',
            pm: project.pm,
            pd: project.pd,
            executionPhase: project.executionPhase || project.phase || null,
            rag: computedRag,
            actualProgressPct,
            expectedProgressPct,
            scheduleVariancePct,
            plannedRevenueFy,
            receivedInflowFy,
            openInflowFy,
            plannedExpenditureFy,
            paidExpenditureFy,
            openExpenditureFy,
            grossProfitFy,
            grossMarginPctFy,
            overdueInflowFy: projectOverdue.ar,
            overdueOutflowFy: projectOverdue.ap,
            engineeringStatus,
            qualityStatus,
            importFreshness,
            importAgeDays: staleDays,
            behindPlan,
            inflowRisk,
            outflowRisk,
            engineeringBlockerCount: engBlockers.length,
            openQualityWarningCount: openQuality.length,
            pendingApprovalCount: projectApprovals.length,
            criticalActionCount,
            cpSigned: project.cpSigned ?? false,
            signedStatus: project.signedStatus ?? 'NONE',
          });
        }

        const scheduleMeasuredRows = projectRows.filter(
          (p) => p.actualProgressPct !== null && p.expectedProgressPct !== null,
        );
        const avgActual = scheduleMeasuredRows.length
          ? Number(
              (
                scheduleMeasuredRows.reduce((s, p) => s + (p.actualProgressPct || 0), 0) /
                scheduleMeasuredRows.length
              ).toFixed(1),
            )
          : null;
        const avgExpected = scheduleMeasuredRows.length
          ? Number(
              (
                scheduleMeasuredRows.reduce((s, p) => s + (p.expectedProgressPct || 0), 0) /
                scheduleMeasuredRows.length
              ).toFixed(1),
            )
          : null;
        const plannedRevenue = projectRows.reduce((s, p) => s + p.plannedRevenueFy, 0);
        const receivedInflow = projectRows.reduce((s, p) => s + p.receivedInflowFy, 0);
        const plannedExpenditure = projectRows.reduce((s, p) => s + p.plannedExpenditureFy, 0);
        const paidExpenditure = projectRows.reduce((s, p) => s + p.paidExpenditureFy, 0);

        // Excel Program Dashboard parity KPIs
        const onScheduleCount = scheduleMeasuredRows.filter((p) => !p.behindPlan).length;
        const onScheduleRate =
          scheduleMeasuredRows.length > 0
            ? Number(((onScheduleCount / scheduleMeasuredRows.length) * 100).toFixed(1))
            : 0;
        const contractsCompleteCount = projectRows.filter(
          (p) => p.cpSigned && p.signedStatus === 'SIGNED',
        ).length;
        const contractCompleteness =
          projectRows.length > 0
            ? Number(((contractsCompleteCount / projectRows.length) * 100).toFixed(1))
            : 0;

        const currentMonthKey = today.slice(0, 7);
        let revenueOutstandingThisMonth = 0;
        for (const row of revenueLines) {
          const dateKey = pickFirstPopulatedDate(row as any, [
            'expectedPaymentDate',
            'invoiceDate',
            'paidDate',
            'inBankDate',
          ]);
          if (!dateKey || !dateKey.startsWith(currentMonthKey)) continue;
          const amount = parseFloat((row as any).amountExVat || '0') || 0;
          const paidDateIsPast = !!(row as any).paidDate && (row as any).paidDate <= today;
          const received =
            (paidDateIsPast &&
              ((row as any).paidDateConfirmed === true ||
                (row as any).paidDateFontColor === 'black')) ||
            !!(row as any).inBankDate;
          if (!received) revenueOutstandingThisMonth += amount;
        }

        let cosPlannedMonth = 0;
        let cosRealisedMonth = 0;
        for (const row of costLines) {
          const dateKey = pickFirstPopulatedDate(row as any, [
            'approvedDate',
            'invoiceDate',
            'paidDate',
          ]);
          if (!dateKey || !dateKey.startsWith(currentMonthKey)) continue;
          const amount = parseFloat((row as any).amountExVat || '0') || 0;
          const costPaidDateIsPast = !!(row as any).paidDate && (row as any).paidDate <= today;
          const COS_REALISED_OVERRIDES_LOCAL = OVERRIDE_REALISED;
          const COS_NOT_REALISED_OVERRIDES_LOCAL = OVERRIDE_NOT_REALISED;
          const cosOverride = String((row as any).cosStatusOverride ?? '')
            .trim()
            .toUpperCase();
          let paid: boolean;
          if (COS_REALISED_OVERRIDES_LOCAL.has(cosOverride)) paid = costPaidDateIsPast;
          else if (COS_NOT_REALISED_OVERRIDES_LOCAL.has(cosOverride)) paid = false;
          else
            paid =
              costPaidDateIsPast &&
              ((row as any).paidDateConfirmed === true ||
                (row as any).paidDateFontColor === 'black');
          cosPlannedMonth += amount;
          if (paid) cosRealisedMonth += amount;
        }
        const cosOutstandingThisMonth = cosPlannedMonth - cosRealisedMonth;

        // Inflows / outflows this week from cashflow_points.
        // All stored date strings are SAST (UTC+2, no DST). Anchor the week
        // boundary in SAST by shifting the current timestamp by +2 h before
        // extracting day-of-week, matching the SAST helper used elsewhere.
        const nowSast = new Date(Date.now() + 2 * 3600 * 1000);
        const dayOfWeek = nowSast.getUTCDay(); // 0=Sun, in SAST
        const weekStart = new Date(nowSast);
        weekStart.setUTCDate(nowSast.getUTCDate() - ((dayOfWeek + 6) % 7)); // Mon SAST
        weekStart.setUTCHours(0, 0, 0, 0); // zero time so ISO slice gives the SAST date not day-1
        const weekEnd = new Date(weekStart);
        weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
        const weekStartKey = weekStart.toISOString().slice(0, 10);
        const weekEndKey = weekEnd.toISOString().slice(0, 10);
        const cashflowRows = await db
          .select({
            seriesName: cashflowPoints.seriesName,
            value: cashflowPoints.value,
            pointDate: cashflowPoints.pointDate,
          })
          .from(cashflowPoints)
          .where(isNull(cashflowPoints.effectiveTo));
        let projectInflowsThisWeek = 0;
        let projectOutflowsThisWeek = 0;
        for (const row of cashflowRows) {
          const d = row.pointDate ? String(row.pointDate).slice(0, 10) : null;
          if (!d || d < weekStartKey || d > weekEndKey) continue;
          const val = parseFloat(String(row.value ?? '0')) || 0;
          const series = (row.seriesName ?? '').toLowerCase();
          if (series.includes('revenue')) projectInflowsThisWeek += val;
          else if (series.includes('expenditure')) projectOutflowsThisWeek += val;
        }

        const overrideInEffect = costLines.some((row: any) => {
          const raw = row.cosStatusOverride;
          return typeof raw === 'string' && raw.trim().length > 0;
        });
        setFinanceTrustHeaders(res, {
          sourceLayer: 'canonical',
          canonicalTable: 'normalized_cost_lines,normalized_revenue_lines,cashflow_points',
          staleAfterSeconds: 60,
          overrideInEffect,
        });
        res.json({
          financialYear: fy,
          projects: projectRows,
          kpis: {
            activeDashboardProjects: projectRows.length,
            averageActualProgressPct: avgActual,
            averageExpectedProgressPct: avgExpected,
            projectsBehindPlan: projectRows.filter((p) => p.behindPlan).length,
            plannedRevenueFy: plannedRevenue,
            receivedInflowFy: receivedInflow,
            openInflowFy: plannedRevenue - receivedInflow,
            plannedExpenditureFy: plannedExpenditure,
            paidExpenditureFy: paidExpenditure,
            openExpenditureFy: plannedExpenditure - paidExpenditure,
            grossProfitFy: plannedRevenue - plannedExpenditure,
            grossMarginPctFy: computeMarginPct(plannedRevenue, plannedExpenditure, {
              precision: 1,
            }),
            overdueInflowFy: overdueLedger.ar.totalAmount,
            overdueOutflowFy: overdueLedger.ap.totalAmount,
            openEngineeringBlockers: projectRows.reduce((s, p) => s + p.engineeringBlockerCount, 0),
            openQualityWarnings: projectRows.reduce((s, p) => s + p.openQualityWarningCount, 0),
            pendingApprovals: projectRows.reduce((s, p) => s + p.pendingApprovalCount, 0),
            staleImports: projectRows.filter((p) => p.importFreshness !== 'Fresh').length,
            // Excel Program Dashboard parity KPIs
            onScheduleRate,
            contractCompleteness,
            revenueOutstandingThisMonth,
            cosOutstandingThisMonth,
            projectInflowsThisWeek,
            projectOutflowsThisWeek,
          },
          overdueDefinitions: {
            asOfDate: today,
            financialYear: fy.label,
            ap: {
              dueDateField: 'approvedDate',
              settledLogic: 'paidDateConfirmed OR cosRealised OR paidDate with black font',
              missingDueDateCount: overdueLedger.ap.missingDueDateCount,
              itemCount: overdueLedger.ap.count,
            },
            ar: {
              dueDateField: 'expectedPaymentDate',
              settledLogic:
                'status in (IN_BANK/PAID/REALISED/RECEIVED/SETTLED) OR payment/paid date OR inBankDate OR paidDateConfirmed/manual in-bank',
              missingDueDateCount: overdueLedger.ar.missingDueDateCount,
              itemCount: overdueLedger.ar.count,
            },
          },
          actionCenter: {
            queues: [
              'Projects Behind Plan',
              'Inflow at Risk',
              'Expenditure / COS at Risk',
              'Engineering Bottlenecks',
              'Quality Issues',
              'Pending Approvals / Decisions',
            ],
            rows: actionRows,
          },
          dataFreshness: {
            generatedAt: new Date().toISOString(),
            recordCounts: {
              activeProjects: activeProjects.length,
              dashboardProjects: projectRows.length,
              planTasks: rawPlanTasksFull.length,
              revenueLines: revenueLines.length,
              costLines: costLines.length,
              engineeringTasks: engTasks.length,
              qualityWarnings: qualityRows.length,
              approvals: approvalRows.length,
              importRuns: importRuns.length,
            },
          },
        });
      } catch (err: any) {
        console.error('[lifecycle-board] GET execution-dashboard error:', err);
        throw err;
      }
    },
  );

  // ===================== OVERDUE PAYMENTS DRILL-DOWN =====================
  app.get(
    '/api/lifecycle-board/overdue-payments',
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const fy = resolveDashboardFinanceScope(req.query);
        const today = new Date().toISOString().slice(0, 10);
        const direction = String(req.query.direction || 'all'); // "inflow" | "outflow" | "all"
        const projectId = req.query.projectId ? parseInt(String(req.query.projectId)) : null;
        const activeProjects = await db
          .select({
            id: projectInfo.id,
            projectName: projectInfo.projectName,
            pm: projectInfo.pm,
          })
          .from(projectInfo)
          .leftJoin(projectExecutionState, eq(projectExecutionState.projectId, projectInfo.id))
          .where(eq(projectExecutionState.archivedStatus, 'ACTIVE'));

        const revenueLines = await db
          .select({
            projectId: normalizedRevenueLines.projectId,
            projectName: normalizedRevenueLines.projectName,
            client: sql<string | null>`NULL`.as('client'),

            amountExVat: normalizedRevenueLines.amountExVat,
            invoiceNumber: normalizedRevenueLines.invoiceNumber,
            invoiceDate: normalizedRevenueLines.invoiceDate,
            expectedPaymentDate: normalizedRevenueLines.expectedPaymentDate,
            paidDate: normalizedRevenueLines.paidDate,
            paidDateConfirmed: normalizedRevenueLines.paidDateConfirmed,
            paidDateFontColor: normalizedRevenueLines.paidDateFontColor,
            inBankDate: normalizedRevenueLines.inBankDate,
            status: normalizedRevenueLines.status,
            sourceRow: normalizedRevenueLines.sourceRow,
          })
          .from(normalizedRevenueLines)
          .where(
            and(
              isNull(normalizedRevenueLines.effectiveTo),
              isNull(normalizedRevenueLines.deletedAt),
            ),
          );

        const costLines = await db
          .select({
            projectId: normalizedCostLines.projectId,
            projectName: normalizedCostLines.projectName,
            supplier: normalizedCostLines.counterpartyName,
            amountExVat: normalizedCostLines.amountExVat,
            invoiceNumber: normalizedCostLines.invoiceNumber,
            invoiceDate: normalizedCostLines.invoiceDate,
            approvedDate: normalizedCostLines.approvedDate,
            paidDate: normalizedCostLines.paidDate,
            paidDateConfirmed: normalizedCostLines.paidDateConfirmed,
            paidDateFontColor: normalizedCostLines.paidDateFontColor,
            cosRealised: normalizedCostLines.cosRealised,
            sourceRow: normalizedCostLines.sourceRow,
          })
          .from(normalizedCostLines)
          .where(
            and(isNull(normalizedCostLines.effectiveTo), isNull(normalizedCostLines.deletedAt)),
          );

        const overdue = buildOverdueFinanceLedger({
          revenueLines,
          costLines,
          activeProjects,
          fyStart: fy.start,
          fyEnd: fy.end,
          today,
        });

        const arItems = projectId
          ? overdue.ar.items.filter((item: any) => item.projectId === projectId)
          : overdue.ar.items;
        const apItems = projectId
          ? overdue.ap.items.filter((item: any) => item.projectId === projectId)
          : overdue.ap.items;

        res.json({
          asOfDate: today,
          financialYear: fy,
          inflow: {
            items: direction === 'outflow' ? [] : arItems,
            totalAmount:
              direction === 'outflow'
                ? 0
                : arItems.reduce((s: number, i: any) => s + i.outstandingAmount, 0),
            count: direction === 'outflow' ? 0 : arItems.length,
            missingDueDateCount: overdue.ar.missingDueDateCount,
          },
          outflow: {
            items: direction === 'inflow' ? [] : apItems,
            totalAmount:
              direction === 'inflow'
                ? 0
                : apItems.reduce((s: number, i: any) => s + i.outstandingAmount, 0),
            count: direction === 'inflow' ? 0 : apItems.length,
            missingDueDateCount: overdue.ap.missingDueDateCount,
          },
        });
      } catch (err: any) {
        console.error('[lifecycle-board] GET overdue-payments error:', err);
        throw err;
      }
    },
  );

  app.post(
    '/api/lifecycle-board/projects/link-engineering',
    requireAuth,
    requireExecRole,
    requirePermission('projects', 'edit'),
    async (req: Request, res: Response) => {
      try {
        const { engineeringProjectName, targetProjectId } = req.body;
        if (!engineeringProjectName || !targetProjectId) {
          return res
            .status(400)
            .json({ error: 'engineeringProjectName and targetProjectId are required' });
        }

        const [target] = await db
          .select()
          .from(projectInfo)
          .where(eq(projectInfo.id, targetProjectId));
        if (!target) return res.status(404).json({ error: 'Target project not found' });

        // Link engineering work_items to the target project
        const updated = await db
          .update(workItems)
          .set({ projectId: target.id, updatedAt: new Date() })
          .where(
            and(
              sql`EXISTS (SELECT 1 FROM project_info pi WHERE pi.id = ${workItems.projectId} AND REPLACE(REPLACE(pi.project_name, '_Tracker', ''), '_', ' ') = ${engineeringProjectName})`,
              isNull(workItems.deletedAt),
            ),
          )
          .returning();

        logAuditFromReq(req, {
          entityType: 'lifecycle',
          entityId: String(targetProjectId),
          action: 'update',
          projectName: target.projectName,
          changesJson: {
            description: 'Engineering tasks linked',
            engineeringProjectName,
            linkedCount: updated.length,
          },
        });
        res.json({ linked: updated.length, targetProject: target.projectName });
      } catch (err: any) {
        console.error('[lifecycle-board] POST link-engineering error:', err);
        throw err;
      }
    },
  );

  app.post(
    '/api/lifecycle-board/projects/merge',
    requireAuth,
    requireExecRole,
    requirePermission('projects', 'edit'),
    async (req: Request, res: Response) => {
      try {
        const { sourceProjectId, targetProjectId, reason } = req.body;
        if (!sourceProjectId || !targetProjectId) {
          return res
            .status(400)
            .json({ error: 'sourceProjectId and targetProjectId are required' });
        }
        if (sourceProjectId === targetProjectId) {
          return res.status(400).json({ error: 'Cannot merge a project with itself' });
        }

        const userId = ((req as any).user as any)?.id || null;
        const userRole = ((req as any).user as any)?.role || null;

        const result = await db.transaction(async (tx: any) => {
          const [source] = await tx
            .select()
            .from(projectInfo)
            .where(eq(projectInfo.id, sourceProjectId));
          const [target] = await tx
            .select()
            .from(projectInfo)
            .where(eq(projectInfo.id, targetProjectId));
          if (!source) throw new Error('Source project not found');
          if (!target) throw new Error('Target project not found');

          const sourceClean = source.projectName.replace(/_Tracker$/i, '').replace(/_/g, ' ');
          const targetClean = target.projectName.replace(/_Tracker$/i, '').replace(/_/g, ' ');

          // Move work_items from source to target project
          const movedTasks = await tx
            .update(workItems)
            .set({ projectId: targetProjectId, updatedAt: new Date() })
            .where(and(eq(workItems.projectId, sourceProjectId), isNull(workItems.deletedAt)))
            .returning();

          const movedPlanResult = await tx
            .update(workItems)
            .set({ projectId: targetProjectId })
            .where(
              and(
                eq(workItems.workstream, 'PM'),
                eq(workItems.source, 'SMART_IMPORT'),
                eq(workItems.projectId, sourceProjectId),
                isNull(workItems.deletedAt),
              ),
            )
            .returning();
          const movedPlan = movedPlanResult || [];

          const fillFields: Record<string, any> = {};
          const conflicts: { field: string; primaryValue: any; secondaryValue: any }[] = [];
          const mergeFields = [
            'sizeKwp',
            'pd',
            'pm',
            'contractValue',
            'signedStatus',
            'signedDate',
            'signedDocumentLink',
          ] as const;
          for (const field of mergeFields) {
            const tVal = (target as any)[field];
            const sVal = (source as any)[field];
            if (
              (tVal == null || tVal === '' || tVal === 'NONE') &&
              sVal != null &&
              sVal !== '' &&
              sVal !== 'NONE'
            ) {
              fillFields[field] = sVal;
            } else if (tVal != null && sVal != null && tVal !== sVal) {
              conflicts.push({ field, primaryValue: tVal, secondaryValue: sVal });
            }
          }
          if (Object.keys(fillFields).length > 0) {
            fillFields.updatedAt = new Date();
            await tx.update(projectInfo).set(fillFields).where(eq(projectInfo.id, targetProjectId));
            await syncProjectSplitTables(targetProjectId, fillFields, tx);
          }

          const archiveFields = {
            archivedStatus: 'ARCHIVED_MERGED',
            canonicalProjectId: targetProjectId,
            isActive: false,
            updatedAt: new Date(),
          };
          await tx
            .update(projectInfo)
            .set(archiveFields)
            .where(eq(projectInfo.id, sourceProjectId));
          await syncProjectSplitTables(sourceProjectId, archiveFields, tx);

          await tx.insert(mergeAuditLog).values({
            primaryProjectId: targetProjectId,
            secondaryProjectId: sourceProjectId,
            primaryProjectName: target.projectName,
            secondaryProjectName: source.projectName,
            mergedByUserId: userId,
            mergedByRole: userRole,
            reason: reason || null,
            conflictsJson: conflicts.length > 0 ? JSON.stringify(conflicts) : null,
            movedTaskCount: movedTasks.length,
            movedPlanCount: movedPlan.length,
          });

          return {
            merged: true,
            movedTasks: movedTasks.length,
            movedPlanEntries: movedPlan.length,
            fieldsFilled: Object.keys(fillFields).filter((k) => k !== 'updatedAt'),
            conflicts,
            source: source.projectName,
            target: target.projectName,
          };
        });

        logAuditFromReq(req, {
          entityType: 'project_merge',
          entityId: String(targetProjectId),
          action: 'create',
          projectName: result.target,
          changesJson: {
            description: 'Projects merged',
            source: result.source,
            target: result.target,
            movedTasks: result.movedTasks,
          },
        });
        res.json(result);
      } catch (err: any) {
        console.error('[lifecycle-board] POST merge error:', err);
        if (err.message === 'Source project not found') {
          throw notFound('Source project');
        }
        if (err.message === 'Target project not found') {
          throw notFound('Target project');
        }
        throw err;
      }
    },
  );

  app.post(
    '/api/lifecycle-board/projects/promote-engineering',
    requireAuth,
    requireExecRole,
    requirePermission('projects', 'edit'),
    async (req: Request, res: Response) => {
      try {
        const { engineeringProjectName, phase } = req.body;
        if (!engineeringProjectName) {
          return res.status(400).json({ error: 'engineeringProjectName is required' });
        }

        const cleanName = engineeringProjectName.replace(/_Tracker$/i, '').replace(/_/g, ' ');
        const canonicalPhase = requireCanonicalLifecyclePhase(phase || 'First Assessment');
        const userId = ((req as any).user as any)?.id || null;

        const allProjects = await db
          .select({ id: projectInfo.id, projectName: projectInfo.projectName })
          .from(projectInfo);
        const normTarget = normalizeName(cleanName);
        const existing = allProjects.find((p: any) => normalizeName(p.projectName) === normTarget);
        const actor = actorFromReq(req);

        if (existing) {
          const [existingFull] = await db
            .select()
            .from(projectInfo)
            .where(eq(projectInfo.id, existing.id));

          const promoteResult = await applyPhaseTransition({
            projectId: existing.id,
            canonicalPhase,
            fromPhase: existingFull?.phase || null,
            actor,
            extraFields: { isActive: true },
          });

          if (!promoteResult.allowed) {
            const evaluation = promoteResult.evaluation;
            return res.status(409).json({
              error: 'stage_gate_failed',
              message: 'Promote blocked because required gate checks are incomplete',
              gate: {
                projectId: existing.id,
                gateName: evaluation.gateName,
                fromStage: evaluation.fromStage,
                targetStage: evaluation.targetStage,
                missingItems: evaluation.missingItems,
                canOverride: STAGE_GATE_OVERRIDE_ROLES.includes(actor.actorRole || ''),
              },
            });
          }

          logAuditFromReq(req, {
            entityType: 'lifecycle',
            entityId: String(existing.id),
            action: 'update',
            projectName: cleanName,
            changesJson: {
              description: 'Engineering project promoted (existing)',
              phase: canonicalPhase,
            },
          });
          await createProjectEvent({
            projectId: existing.id,
            eventType: 'project.created',
            actorUserId: actor.actorUserId,
            actorRole: actor.actorRole,
            sourceEntityType: 'project_info',
            sourceEntityId: String(existing.id),
            summary: `Project promoted into engineering lifecycle (${canonicalPhase})`,
            details: { phase: canonicalPhase, mode: 'promote_existing' },
            idempotencyKey: `project-promote-existing:${existing.id}:${canonicalPhase}`,
          });
          return res.json(promoteResult.updated);
        }

        // New project path: stage gate is skipped (nothing to gate against on a
        // brand-new row), but full propagation still runs via
        // propagatePhaseSideEffects so stage instances, exec state stage code,
        // history, events and metrics are all consistent with the other paths.
        const promoteInsertFields = {
          projectName: cleanName,
          phase: canonicalPhase,
          isActive: true,
          phaseUpdatedAt: new Date(),
          phaseUpdatedByUserId: userId,
        };
        const [created] = await db.insert(projectInfo).values(promoteInsertFields).returning();
        await syncProjectSplitTablesAfterInsert(created.id, promoteInsertFields);

        await propagatePhaseSideEffects({
          projectId: created.id,
          canonicalPhase,
          fromPhase: null,
          actor,
        });

        logAuditFromReq(req, {
          entityType: 'lifecycle',
          entityId: String(created.id),
          action: 'create',
          projectName: cleanName,
          changesJson: { description: 'Engineering project promoted (new)', phase: canonicalPhase },
        });
        await createProjectEvent({
          projectId: created.id,
          eventType: 'project.created',
          actorUserId: actor.actorUserId,
          actorRole: actor.actorRole,
          sourceEntityType: 'project_info',
          sourceEntityId: String(created.id),
          summary: `Project created in engineering lifecycle (${canonicalPhase})`,
          details: { phase: canonicalPhase, mode: 'promote_new' },
          idempotencyKey: `project-created:${created.id}`,
        });
        res.json(created);
      } catch (err: any) {
        console.error('[lifecycle-board] POST promote-engineering error:', err);
        if (
          String(err?.message || '').includes('lifecycle phase') ||
          String(err?.message || '').includes('phase is required')
        ) {
          return res.status(400).json({ error: 'Invalid lifecycle phase' });
        }
        throw err;
      }
    },
  );

  app.patch(
    '/api/lifecycle-board/projects/:id',
    requireAuth,
    requireExecRole,
    requirePermission('projects', 'edit'),
    async (req: Request, res: Response) => {
      try {
        const idParam = req.params.id as string;
        const id = parseInt(idParam);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid project id' });

        const [existing] = await db.select().from(projectInfo).where(eq(projectInfo.id, id));
        if (!existing) return res.status(404).json({ error: 'Project not found' });

        const {
          sizeKwp,
          pd,
          pm,
          pmUserId,
          contractValue,
          escalationLevel,
          phase,
          ragStatus,
          projectName: newName,
        } = req.body;

        // Phase changes go through the canonical applyPhaseTransition routine
        // so the generic edit dialog produces identical state to a drag/drop on
        // the lifecycle board (stage instances, exec state stage code, history,
        // events, metric refresh, AND stage-gate evaluation).
        const phaseChanging = phase !== undefined && phase !== existing.phase;
        if (phaseChanging) {
          const canonicalPhase = requireCanonicalLifecyclePhase(phase);
          const actor = actorFromReq(req);
          const phaseResult = await applyPhaseTransition({
            projectId: id,
            canonicalPhase,
            fromPhase: existing.phase,
            actor,
          });
          if (!phaseResult.allowed) {
            const evaluation = phaseResult.evaluation;
            return res.status(409).json({
              error: 'stage_gate_failed',
              message: 'Stage transition blocked because required gate checks are incomplete',
              gate: {
                projectId: id,
                gateName: evaluation.gateName,
                fromStage: evaluation.fromStage,
                targetStage: evaluation.targetStage,
                missingItems: evaluation.missingItems,
                canOverride: STAGE_GATE_OVERRIDE_ROLES.includes(actor.actorRole || ''),
              },
            });
          }
        }

        const updates: Record<string, any> = { updatedAt: new Date() };

        if (newName !== undefined && newName.trim() && newName.trim() !== existing.projectName) {
          updates.projectName = newName.trim();
        }
        if (sizeKwp !== undefined) updates.sizeKwp = sizeKwp || null;
        if (pd !== undefined) updates.pd = pd || null;
        if (pm !== undefined) {
          updates.pm = pm || null;
          updates.pmUserId = pmUserId ?? null;
        }
        if (contractValue !== undefined) updates.contractValue = contractValue || null;
        if (escalationLevel !== undefined)
          updates.escalationLevel =
            escalationLevel && escalationLevel !== 'none' ? escalationLevel : null;
        if (ragStatus !== undefined)
          updates.ragStatus = ragStatus && ragStatus !== 'none' ? ragStatus : null;

        const [updated] = await db
          .update(projectInfo)
          .set(updates)
          .where(eq(projectInfo.id, id))
          .returning();
        await syncProjectSplitTables(id, updates);
        logAuditFromReq(req, {
          entityType: 'lifecycle',
          entityId: String(id),
          action: 'update',
          projectName: updated.projectName,
          changesJson: {
            description: 'Project details updated',
            phase,
            escalationLevel,
            ragStatus,
          },
        });
        res.json(updated);
      } catch (err: any) {
        console.error('[lifecycle-board] PATCH project error:', err);
        if (
          String(err?.message || '').includes('lifecycle phase') ||
          String(err?.message || '').includes('phase is required')
        ) {
          return res.status(400).json({ error: 'Invalid lifecycle phase' });
        }
        throw err;
      }
    },
  );

  app.get(
    '/api/lifecycle-board/projects/:id/stage-gates/evaluate',
    requireAuth,
    requirePermission('projects', 'view'),
    async (req: Request, res: Response) => {
      try {
        const id = parseIntParam(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid project id' });
        const targetStage = String(req.query.targetStage || '').trim();
        if (!targetStage) {
          return res.status(400).json({ error: 'targetStage query parameter is required' });
        }
        const actor = actorFromReq(req);
        const evaluation = await evaluateStageGate({
          projectId: id,
          targetStage,
          actorUserId: actor.actorUserId,
          actorRole: actor.actorRole,
        });
        res.json(evaluation);
      } catch (err: any) {
        console.error('[lifecycle-board] GET stage-gates/evaluate error:', err);
        res.status(500).json({ error: 'Failed to evaluate stage gate' });
      }
    },
  );

  app.post(
    '/api/lifecycle-board/projects/:id/stage-gates/override',
    requireAuth,
    requirePermission('projects', 'edit'),
    async (req: Request, res: Response) => {
      try {
        const id = parseIntParam(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid project id' });

        const user = (req as any).user as any;
        const role = user?.role || '';
        if (!STAGE_GATE_OVERRIDE_ROLES.includes(role)) {
          return res
            .status(403)
            .json({
              error: 'forbidden',
              message: 'Your role is not authorized to submit stage gate overrides',
            });
        }

        const { gateName, targetStage, overrideReason, expiryDate, note } = req.body || {};
        if (
          !gateName ||
          !targetStage ||
          !overrideReason ||
          typeof overrideReason !== 'string' ||
          overrideReason.trim().length < 8
        ) {
          return res.status(400).json({
            error: 'validation_error',
            message: 'gateName, targetStage, and overrideReason (min 8 chars) are required',
          });
        }

        const expiresAt = expiryDate ? new Date(expiryDate) : null;
        if (expiryDate && Number.isNaN(expiresAt?.getTime())) {
          return res
            .status(400)
            .json({ error: 'validation_error', message: 'expiryDate must be a valid date' });
        }

        const override = await createStageGateOverride({
          projectId: id,
          gateName: String(gateName),
          targetStage: String(targetStage),
          overrideReason: overrideReason.trim(),
          overriddenBy: user?.id || null,
          overriddenByRole: role,
          expiresAt,
          note: note ? String(note) : null,
        });

        logAuditFromReq(req, {
          entityType: 'lifecycle',
          entityId: String(id),
          action: 'override',
          projectName: undefined,
          changesJson: {
            description: 'Stage gate override granted',
            gateName,
            targetStage,
            overrideReason: overrideReason.trim(),
            expiryDate: expiresAt,
            note: note || null,
          },
        });

        res.status(201).json({
          id: override.id,
          project_id: override.projectId,
          gate_name: override.gateName,
          target_stage: override.targetStage,
          override_reason: override.overrideReason,
          overridden_by: override.overriddenBy,
          timestamp: override.createdAt,
          expiry_date: override.expiresAt,
          note: override.note,
        });
      } catch (err: any) {
        console.error('[lifecycle-board] POST stage-gates/override error:', err);
        res.status(500).json({ error: 'Failed to create override' });
      }
    },
  );

  app.patch(
    '/api/lifecycle-board/projects/:id/phase',
    requireAuth,
    requireExecRole,
    requirePermission('projects', 'edit'),
    async (req: Request, res: Response) => {
      try {
        const idParam = req.params.id as string;
        const id = parseInt(idParam);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid project id' });

        const canonicalPhase = requireCanonicalLifecyclePhase(req.body?.phase);

        const [existing] = await db.select().from(projectInfo).where(eq(projectInfo.id, id));
        if (!existing) return res.status(404).json({ error: 'Project not found' });

        const actor = actorFromReq(req);

        const result = await applyPhaseTransition({
          projectId: id,
          canonicalPhase,
          fromPhase: existing.phase,
          actor,
        });

        if (!result.allowed) {
          const evaluation = result.evaluation;
          return res.status(409).json({
            error: 'stage_gate_failed',
            message: 'Stage transition blocked because required gate checks are incomplete',
            gate: {
              projectId: id,
              gateName: evaluation.gateName,
              fromStage: evaluation.fromStage,
              targetStage: evaluation.targetStage,
              missingItems: evaluation.missingItems,
              canOverride: STAGE_GATE_OVERRIDE_ROLES.includes(actor.actorRole || ''),
            },
          });
        }

        logAuditFromReq(req, {
          entityType: 'project_lifecycle',
          entityId: String(id),
          action: 'update',
          projectName: result.updated.projectName,
          changesJson: {
            description: 'Phase changed',
            fromPhase: existing.phase,
            toPhase: canonicalPhase,
          },
        });
        res.json(result.updated);
      } catch (err: any) {
        console.error('[lifecycle-board] PATCH phase error:', err);
        if (
          String(err?.message || '').includes('lifecycle phase') ||
          String(err?.message || '').includes('phase is required')
        ) {
          return res.status(400).json({ error: 'Invalid lifecycle phase' });
        }
        throw err;
      }
    },
  );

  app.get(
    '/api/lifecycle-board/projects/:id/execution-gate',
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const id = parseIntParam(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid project id' });

        const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, id));
        if (!project) return res.status(404).json({ error: 'Project not found' });

        // SECURITY: parameterized
        const handoverRows: any[] = await db
          .execute(sql`SELECT status FROM project_pd_pm_handover WHERE project_id = ${id} LIMIT 1`)
          .then((r: any) => (Array.isArray(r) ? r : r.rows || []));
        const handoverAccepted = handoverRows[0]?.status === 'ACCEPTED';

        const isEligible =
          project.signedStatus !== 'NONE' &&
          project.signedDate != null &&
          project.signedDocumentLink != null &&
          project.signedDocumentLink.trim() !== '';
        const gateStatus = project.executionEnabled
          ? 'ENABLED'
          : isEligible
            ? 'ELIGIBLE'
            : 'NOT_ELIGIBLE';
        const eligibilityReasons: string[] = [];
        if (project.signedStatus === 'NONE') eligibilityReasons.push('No signed status set');
        if (!project.signedDate) eligibilityReasons.push('No signed date');
        if (!project.signedDocumentLink?.trim()) eligibilityReasons.push('No signed document link');

        res.json({
          id: project.id,
          projectName: project.projectName,
          signedStatus: project.signedStatus,
          signedDate: project.signedDate,
          signedDocumentLink: project.signedDocumentLink,
          executionEnabled: project.executionEnabled,
          executionGateStatus: gateStatus,
          executionGateReason: project.executionGateReason,
          executionPhase: project.executionPhase,
          excelTrackerLink: handoverAccepted ? project.excelTrackerLink : null,
          canLinkExcelTracker: handoverAccepted,
          eligibilityReasons,
          isEligible,
        });
      } catch (err: any) {
        console.error('[lifecycle-board] GET execution-gate error:', err);
        throw err;
      }
    },
  );

  app.patch(
    '/api/lifecycle-board/projects/:id/execution-gate',
    requireAuth,
    requireExecRole,
    requirePermission('projects', 'edit'),
    async (req: Request, res: Response) => {
      try {
        const id = parseIntParam(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid project id' });

        const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, id));
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const { signedStatus, signedDate, signedDocumentLink, executionEnabled, reason } = req.body;

        const updates: Record<string, any> = { updatedAt: new Date() };
        if (signedStatus !== undefined) updates.signedStatus = signedStatus;
        if (signedDate !== undefined) updates.signedDate = signedDate;
        if (signedDocumentLink !== undefined) updates.signedDocumentLink = signedDocumentLink;

        const effectiveSignedStatus =
          signedStatus !== undefined ? signedStatus : project.signedStatus;
        const effectiveSignedDate = signedDate !== undefined ? signedDate : project.signedDate;
        const effectiveSignedDocumentLink =
          signedDocumentLink !== undefined ? signedDocumentLink : project.signedDocumentLink;

        const isEligible =
          effectiveSignedStatus !== 'NONE' &&
          effectiveSignedDate != null &&
          effectiveSignedDocumentLink != null &&
          effectiveSignedDocumentLink.trim() !== '';

        // SECURITY: parameterized
        const handoverRows: any[] = await db
          .execute(sql`SELECT status FROM project_pd_pm_handover WHERE project_id = ${id} LIMIT 1`)
          .then((r: any) => (Array.isArray(r) ? r : r.rows || []));
        const handoverAccepted = handoverRows[0]?.status === 'ACCEPTED';
        if (executionEnabled === true && !handoverAccepted) {
          return res.status(400).json({
            error: 'Cannot enable PM execution controls before PD→PM handover acceptance.',
            message: 'Submit the PD to PM handover and wait for PM acceptance, then retry.',
          });
        }

        if (executionEnabled === true && !isEligible && !reason) {
          const eligibilityReasons: string[] = [];
          if (effectiveSignedStatus === 'NONE') eligibilityReasons.push('No signed status set');
          if (!effectiveSignedDate) eligibilityReasons.push('No signed date');
          if (!effectiveSignedDocumentLink?.trim())
            eligibilityReasons.push('No signed document link');
          return res.status(400).json({
            error: 'Project is not eligible for execution',
            eligibilityReasons,
            message: 'Provide a reason to override eligibility requirements',
          });
        }

        if (executionEnabled !== undefined) updates.executionEnabled = executionEnabled;

        const effectiveExecutionEnabled =
          executionEnabled !== undefined ? executionEnabled : project.executionEnabled;
        const newGateStatus = effectiveExecutionEnabled
          ? 'ENABLED'
          : isEligible
            ? 'ELIGIBLE'
            : 'NOT_ELIGIBLE';
        updates.executionGateStatus = newGateStatus;
        if (reason !== undefined) updates.executionGateReason = reason;

        const previousStatus = project.executionGateStatus;

        const [updated] = await db
          .update(projectInfo)
          .set(updates)
          .where(eq(projectInfo.id, id))
          .returning();
        await syncProjectSplitTables(id, updates);

        const user = (req as any).user as any;
        await db.insert(executionGateLog).values({
          projectId: id,
          action:
            executionEnabled !== undefined ? (executionEnabled ? 'ENABLE' : 'DISABLE') : 'UPDATE',
          previousStatus,
          newStatus: newGateStatus,
          reason: reason || null,
          changedByUserId: user?.id || null,
          changedByRole: user?.role || null,
        });

        const responseEligibilityReasons: string[] = [];
        if (effectiveSignedStatus === 'NONE')
          responseEligibilityReasons.push('No signed status set');
        if (!effectiveSignedDate) responseEligibilityReasons.push('No signed date');
        if (!effectiveSignedDocumentLink?.trim())
          responseEligibilityReasons.push('No signed document link');

        logAuditFromReq(req, {
          entityType: 'lifecycle',
          entityId: String(id),
          action: 'update',
          projectName: updated.projectName,
          changesJson: {
            description: 'Execution gate updated',
            previousStatus,
            newStatus: newGateStatus,
            executionEnabled: effectiveExecutionEnabled,
          },
        });
        const actor = actorFromReq(req);
        const eventType =
          effectiveExecutionEnabled && !isEligible
            ? 'project.override_granted'
            : newGateStatus === 'ENABLED'
              ? 'project.gate_passed'
              : 'project.gate_failed';
        await createProjectEvent({
          projectId: id,
          eventType,
          actorUserId: actor.actorUserId,
          actorRole: actor.actorRole,
          sourceEntityType: 'execution_gate_log',
          sourceEntityId: `${id}:${newGateStatus}`,
          summary: effectiveExecutionEnabled
            ? `Execution gate enabled (${newGateStatus})`
            : `Execution gate set to ${newGateStatus}`,
          details: {
            previousStatus,
            newStatus: newGateStatus,
            executionEnabled: effectiveExecutionEnabled,
            isEligible,
            reason: reason || null,
          },
          idempotencyKey: `gate:${id}:${previousStatus || ''}:${newGateStatus}:${String(effectiveExecutionEnabled)}`,
        });
        res.json({
          id: updated.id,
          projectName: updated.projectName,
          signedStatus: updated.signedStatus,
          signedDate: updated.signedDate,
          signedDocumentLink: updated.signedDocumentLink,
          executionEnabled: updated.executionEnabled,
          executionGateStatus: newGateStatus,
          executionGateReason: updated.executionGateReason,
          executionPhase: updated.executionPhase,
          excelTrackerLink: updated.excelTrackerLink,
          eligibilityReasons: responseEligibilityReasons,
          isEligible,
        });
      } catch (err: any) {
        console.error('[lifecycle-board] PATCH execution-gate error:', err);
        throw err;
      }
    },
  );

  app.get(
    '/api/lifecycle-board/projects/merge-preview',
    requireAuth,
    requireExecRole,
    async (req: Request, res: Response) => {
      try {
        const primaryId = parseInt(req.query.primaryId as string);
        const secondaryId = parseInt(req.query.secondaryId as string);
        if (isNaN(primaryId) || isNaN(secondaryId)) {
          return res
            .status(400)
            .json({ error: 'primaryId and secondaryId query params are required' });
        }

        const [primary] = await db.select().from(projectInfo).where(eq(projectInfo.id, primaryId));
        const [secondary] = await db
          .select()
          .from(projectInfo)
          .where(eq(projectInfo.id, secondaryId));
        if (!primary) return res.status(404).json({ error: 'Primary project not found' });
        if (!secondary) return res.status(404).json({ error: 'Secondary project not found' });

        const primaryClean = primary.projectName.replace(/_Tracker$/i, '').replace(/_/g, ' ');
        const secondaryClean = secondary.projectName.replace(/_Tracker$/i, '').replace(/_/g, ' ');

        const piRows = await db
          .select({ id: projectInfo.id, projectName: projectInfo.projectName })
          .from(projectInfo);
        const piNameMap = new Map<number, string>(piRows.map((p: any) => [p.id, p.projectName]));
        const allTasksRaw = await db
          .select({ projectId: workItems.projectId })
          .from(workItems)
          .where(isNull(workItems.deletedAt));
        const allTasks = allTasksRaw.map((wi: any) => ({
          projectName: wi.projectId ? piNameMap.get(wi.projectId) || null : null,
        }));
        const allPlansRaw = await db
          .select({ projectId: workItems.projectId })
          .from(workItems)
          .where(
            and(
              eq(workItems.workstream, 'PM'),
              eq(workItems.source, 'SMART_IMPORT'),
              isNull(workItems.deletedAt),
            ),
          );
        const allPlans = allPlansRaw.map((wi: any) => ({
          projectName: wi.projectId ? piNameMap.get(wi.projectId) || null : null,
        }));

        const primaryNorm = normalizeName(primary.projectName);
        const secondaryNorm = normalizeName(secondary.projectName);

        let primaryTaskCount = 0;
        let secondaryTaskCount = 0;
        for (const t of allTasks) {
          if (!t.projectName) continue;
          const norm = normalizeName(t.projectName);
          if (norm === primaryNorm) primaryTaskCount++;
          if (norm === secondaryNorm) secondaryTaskCount++;
        }

        let primaryPlanCount = 0;
        let secondaryPlanCount = 0;
        for (const p of allPlans) {
          if (!p.projectName) continue;
          if (p.projectName === primary.projectName) primaryPlanCount++;
          if (p.projectName === secondary.projectName) secondaryPlanCount++;
        }

        const compareFields = [
          'sizeKwp',
          'pd',
          'pm',
          'contractValue',
          'phase',
          'escalationLevel',
          'ragStatus',
          'executionEnabled',
          'executionGateStatus',
          'signedStatus',
          'signedDate',
          'signedDocumentLink',
        ] as const;

        const conflicts: { field: string; primaryValue: any; secondaryValue: any }[] = [];
        for (const field of compareFields) {
          const pVal = (primary as any)[field];
          const sVal = (secondary as any)[field];
          if (pVal !== sVal && (pVal != null || sVal != null)) {
            conflicts.push({ field, primaryValue: pVal, secondaryValue: sVal });
          }
        }

        res.json({
          primary: {
            id: primary.id,
            projectName: primary.projectName,
            sizeKwp: primary.sizeKwp,
            pd: primary.pd,
            pm: primary.pm,
            contractValue: primary.contractValue,
            phase: primary.phase,
            escalationLevel: primary.escalationLevel,
            ragStatus: primary.ragStatus,
          },
          secondary: {
            id: secondary.id,
            projectName: secondary.projectName,
            sizeKwp: secondary.sizeKwp,
            pd: secondary.pd,
            pm: secondary.pm,
            contractValue: secondary.contractValue,
            phase: secondary.phase,
            escalationLevel: secondary.escalationLevel,
            ragStatus: secondary.ragStatus,
          },
          conflicts,
          primaryTaskCount,
          secondaryTaskCount,
          primaryPlanCount,
          secondaryPlanCount,
        });
      } catch (err: any) {
        console.error('[lifecycle-board] GET merge-preview error:', err);
        throw err;
      }
    },
  );

  app.patch(
    '/api/lifecycle-board/projects/:id/restore',
    requireAuth,
    requireExecRole,
    requirePermission('projects', 'edit'),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseIntParam(req.params.id);
        if (isNaN(projectId)) return res.status(400).json({ error: 'Invalid project ID' });

        const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
        if (!project) return res.status(404).json({ error: 'Project not found' });

        if (project.archivedStatus === 'ACTIVE') {
          return res.status(400).json({ error: 'Project is already active' });
        }

        const user = (req as any).user as any;
        const restoredBy = user?.email || user?.name || 'unknown';

        const restoreFields = { archivedStatus: 'ACTIVE', updatedAt: new Date() };
        const [updated] = await db
          .update(projectInfo)
          .set(restoreFields)
          .where(eq(projectInfo.id, projectId))
          .returning();
        await syncProjectSplitTables(projectId, restoreFields);

        logAuditFromReq(req, {
          entityType: 'lifecycle',
          entityId: String(projectId),
          action: 'restore',
          projectName: project.projectName,
          changesJson: {
            description: `Project restored from ${project.archivedStatus} by ${restoredBy}`,
            previousStatus: project.archivedStatus,
          },
        });

        res.json(updated);
      } catch (err: any) {
        console.error('[lifecycle-board] PATCH restore error:', err);
        throw err;
      }
    },
  );

  app.delete(
    '/api/lifecycle-board/projects/:id',
    requireAuth,
    requireExecRole,
    requirePermission('projects', 'delete'),
    async (req: Request, res: Response) => {
      try {
        const projectId = parseIntParam(req.params.id);
        if (isNaN(projectId)) return res.status(400).json({ error: 'Invalid project ID' });

        const [project] = await db.select().from(projectInfo).where(eq(projectInfo.id, projectId));
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const pName = project.projectName;
        const user = (req as any).user as any;
        const deletedBy = user?.email || user?.name || 'unknown';

        logAuditFromReq(req, {
          entityType: 'lifecycle',
          entityId: String(projectId),
          action: 'hard_delete',
          projectName: pName,
          changesJson: {
            description: `Project hard-deleted by ${deletedBy}`,
            projectId,
            projectName: pName,
          },
        });

        await db.transaction(async (tx: any) => {
          const pId = projectId;
          const pN = pName;
          // Safe delete helper — uses SAVEPOINTs so a failed statement
          // (e.g. missing table) doesn't abort the whole PG transaction.
          let spIdx = 0;
          const safeDel = async (query: ReturnType<typeof sql>) => {
            const sp = `sp_del_${spIdx++}`;
            try {
              await tx.execute(sql`SAVEPOINT ${sql.raw(sp)}`);
              await tx.execute(query);
              await tx.execute(sql`RELEASE SAVEPOINT ${sql.raw(sp)}`);
            } catch (_e) {
              await tx.execute(sql`ROLLBACK TO SAVEPOINT ${sql.raw(sp)}`);
            }
          };

          await safeDel(
            sql`DELETE FROM project_eng_deliverables WHERE project_eng_stage_id IN (SELECT id FROM project_eng_stages WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM project_eng_approvals WHERE project_eng_stage_id IN (SELECT id FROM project_eng_stages WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM project_eng_tasks WHERE project_eng_stage_id IN (SELECT id FROM project_eng_stages WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM engineering_task_attachments WHERE engineering_task_id IN (SELECT legacy_id FROM work_items WHERE legacy_table = 'engineering_tasks' AND project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM deliverable_events WHERE deliverable_id IN (SELECT id FROM deliverables WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM deliverable_files WHERE deliverable_id IN (SELECT id FROM deliverables WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM deliverable_versions WHERE deliverable_id IN (SELECT id FROM deliverables WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM task_activity_log WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM task_deliverables WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM task_attachments WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM task_checklist_items WHERE checklist_id IN (SELECT tc.id FROM task_checklists tc WHERE tc.work_item_id IN (SELECT id FROM work_items WHERE project_id = ${pId}))`,
          );
          await safeDel(
            sql`DELETE FROM task_checklists WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM task_comments WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM task_watchers WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM qc_item_evidence WHERE item_instance_id IN (SELECT qi.id FROM qc_item_instance qi JOIN qc_checklist qc ON qi.checklist_id = qc.id WHERE qc.project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM qc_risk_answer WHERE checklist_id IN (SELECT id FROM qc_checklist WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM qc_item_instance WHERE checklist_id IN (SELECT id FROM qc_checklist WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM qc_plan_link WHERE checklist_id IN (SELECT id FROM qc_checklist WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM qc_warning_event WHERE warning_id IN (SELECT id FROM qc_warning WHERE project_name = ${pN})`,
          );
          await safeDel(sql`DELETE FROM qc_warning WHERE project_name = ${pN}`);
          await safeDel(
            sql`DELETE FROM qc_postmortem_metric_value WHERE postmortem_id IN (SELECT id FROM qc_postmortem WHERE project_name = ${pN})`,
          );
          await safeDel(
            sql`DELETE FROM qc_postmortem_summary WHERE postmortem_id IN (SELECT id FROM qc_postmortem WHERE project_name = ${pN})`,
          );
          await safeDel(sql`DELETE FROM qc_postmortem WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM qc_access_challenge WHERE project_name = ${pN}`);
          await safeDel(
            sql`DELETE FROM import_issues WHERE import_run_id IN (SELECT id FROM smart_import_runs WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM teams_chat_messages WHERE group_id IN (SELECT id FROM teams_chat_groups WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM teams_chat_members WHERE group_id IN (SELECT id FROM teams_chat_groups WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM working_plan_dependency_override WHERE scenario_id IN (SELECT id FROM working_plan_scenario WHERE project_name = ${pN})`,
          );
          await safeDel(sql`DELETE FROM project_plan_dependency WHERE project_name = ${pN}`);
          await safeDel(
            sql`DELETE FROM field_changes WHERE change_set_id IN (SELECT id FROM change_sets WHERE project_name = ${pN})`,
          );
          await safeDel(
            sql`DELETE FROM intake_tasks WHERE intake_request_id IN (SELECT id FROM intake_requests WHERE project_id = ${pId})`,
          );
          await safeDel(sql`DELETE FROM project_links WHERE project_id = ${pId}`);

          await safeDel(sql`DELETE FROM project_eng_stages WHERE project_id = ${pId}`);
          await safeDel(sql`DELETE FROM deliverables WHERE project_id = ${pId}`);
          await safeDel(sql`DELETE FROM qc_checklist WHERE project_id = ${pId}`);
          await safeDel(sql`DELETE FROM project_phase_history WHERE project_id = ${pId}`);
          // pd_tickets is intentionally deleted AFTER work_items below —
          // work_items.pd_ticket_id FKs into pd_tickets so removing tickets
          // first fails silently (savepoint swallow) and then the final
          // DELETE FROM project_info hits pd_tickets_project_id_fkey.
          await safeDel(sql`DELETE FROM phase_template_application WHERE project_id = ${pId}`);
          await safeDel(sql`DELETE FROM execution_gate_log WHERE project_id = ${pId}`);
          // Clear every child table that FKs into smart_import_runs.id
          // BEFORE deleting smart_import_runs itself — otherwise the
          // smart_import_runs DELETE fails silently inside safeDel and
          // the final DELETE FROM project_info hits
          // smart_import_runs_project_id_fkey ("Key (id)=(N) is still
          // referenced from table 'smart_import_runs'"). Tables that
          // FK to smart_import_runs.id without ON DELETE CASCADE/SET
          // NULL: normalized_plan_tasks, import_logs,
          // conflict_resolution_log. (import_issues was already cleared
          // up top via subquery; *_summary*.snapshot_run_id columns are
          // ON DELETE SET NULL and don't need explicit cleanup.)
          await safeDel(
            sql`DELETE FROM normalized_plan_tasks WHERE import_run_id IN (SELECT id FROM smart_import_runs WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM import_logs WHERE import_run_id IN (SELECT id FROM smart_import_runs WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM conflict_resolution_log WHERE import_run_id IN (SELECT id FROM smart_import_runs WHERE project_id = ${pId})`,
          );
          await safeDel(sql`DELETE FROM smart_import_runs WHERE project_id = ${pId}`);
          await safeDel(sql`DELETE FROM project_portfolio_assignments WHERE project_id = ${pId}`);
          await safeDel(sql`DELETE FROM teams_chat_groups WHERE project_id = ${pId}`);
          await safeDel(sql`DELETE FROM intake_requests WHERE project_id = ${pId}`);
          // Engineering / non-PM work_items also FK to project_info with NO
          // ACTION, so we must remove every work_item for this project — not
          // just PM smart-import rows — otherwise the final
          // DELETE FROM project_info hits work_items_project_id_fkey. The
          // children of work_items (task_activity_log, task_attachments,
          // task_checklists, task_comments, task_watchers, task_deliverables)
          // were already cleared above via subqueries that match all
          // work_items for this project, so this broader delete is safe.
          // project_eng_tasks_legacy_archive holds NO ACTION FK rows
          // pointing at our work_items; clear them first so the work_items
          // delete below can succeed.
          await safeDel(
            sql`DELETE FROM project_eng_tasks_legacy_archive WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM expense_task_links WHERE canonical_task_id IN (SELECT id FROM work_items WHERE project_id = ${pId})`,
          );
          await safeDel(
            sql`DELETE FROM work_items WHERE project_id = ${pId} OR external_ref LIKE ${pN + '::PLAN::%'}`,
          );
          // Detach any cross-project work_items still pointing at this
          // project's pd_tickets, then drop the tickets. Must happen AFTER
          // the work_items delete above so the FK is empty.
          await safeDel(
            sql`UPDATE work_items SET pd_ticket_id = NULL WHERE pd_ticket_id IN (SELECT id FROM pd_tickets WHERE project_id = ${pId})`,
          );
          await safeDel(sql`DELETE FROM pd_tickets WHERE project_id = ${pId}`);
          // entity_assignments has a NO ACTION FK to project_info, so we
          // must clear it explicitly. (Was missing — caused SERVER_ERROR on
          // delete for any project with assignment rows.)
          await safeDel(sql`DELETE FROM entity_assignments WHERE project_id = ${pId}`);
          await safeDel(
            sql`DELETE FROM normalized_revenue_lines WHERE project_id = ${pId} OR project_name = ${pN}`,
          );
          await safeDel(
            sql`DELETE FROM normalized_cost_lines WHERE project_id = ${pId} OR project_name = ${pN}`,
          );
          await safeDel(
            sql`DELETE FROM normalized_execution_phases WHERE project_id = ${pId} OR project_name = ${pN}`,
          );
          await safeDel(sql`DELETE FROM pm_site_visits WHERE project_id = ${pId}`);
          await safeDel(sql`DELETE FROM pm_on_the_go_actions WHERE project_id = ${pId}`);
          await safeDel(sql`DELETE FROM pm_compliance_tracking WHERE project_id = ${pId}`);
          await safeDel(
            sql`UPDATE ms_objects SET linked_project_id = NULL, linked_task_id = NULL WHERE linked_project_id = ${pId}`,
          );
          await safeDel(sql`DELETE FROM invoice_pattern_matches WHERE project_id = ${pId}`);
          await safeDel(sql`DELETE FROM tr_item_project_links WHERE project_id = ${pId}`);

          await safeDel(sql`DELETE FROM normalized_cost_lines WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM normalized_revenue_lines WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM project_revenue_summary WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM finance_revenue_monthly WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM finance_cos_monthly WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM project_plan WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM project_notes WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM cashflow_points WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM milestone_task_links WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM expense_task_links WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM key_date_mappings WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM writeback_mappings WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM financial_edit_requests WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM financial_integration_rules WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM schedule_change_notice WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM project_team_members WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM project_editable_fields WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM company_projects WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM sp_file_pointers WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM working_plan_scenario WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM revenue_milestone_manual WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM cashflow_weekly_manual WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM cashflow_balance_history WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM available_payment_overrides WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM available_payment_history WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM tracker_monthly_manual WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM change_sets WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM weekly_reviews WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM derived_project_kpis WHERE project_name = ${pN}`);
          await safeDel(sql`DELETE FROM merge_audit_log WHERE project_name = ${pN}`);

          // mytool_tasks cleanup removed — table has 0 active rows, personal tasks now in work_items
          await safeDel(
            sql`UPDATE priority_links SET project_name = NULL WHERE project_name = ${pN}`,
          );
          await safeDel(
            sql`UPDATE audit_events SET project_name = ${pName + ' [DELETED]'} WHERE project_name = ${pN}`,
          );

          await tx.execute(sql`DELETE FROM project_info WHERE id = ${pId}`);
        });

        console.log(
          `[lifecycle-board] Project ${projectId} (${pName}) HARD DELETED by ${deletedBy} — all related data removed`,
        );

        res.json({ success: true, projectName: pName, deletionType: 'hard_delete' });
      } catch (err: any) {
        console.error('[lifecycle-board] DELETE project error:', err);
        throw err;
      }
    },
  );
}
