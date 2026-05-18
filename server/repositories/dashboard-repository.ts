// Repository for the programme-dashboard "import-health" and
// "attention-items" widgets. Both endpoints used to return hardcoded
// mock data (see the source-of-truth audit, P0 #2). They now read
// canonical-current rows so the dashboard reflects what's actually in
// the database.

import { and, desc, eq, isNull, ilike } from "drizzle-orm";
import { db } from "../db";
import { smartImportRuns } from "@shared/schema/imports";
import { projectInfo } from "@shared/schema/projects";
import { workItems } from "@shared/schema/tasks";
import { qcWarning } from "@shared/schema/quality";
import { financialEditRequests } from "@shared/schema/finance";
import { pctTo100 } from "../lib/kpi-formulas";

// ─── Import health ───────────────────────────────────────────────

export interface ImportHistoryEntry {
  timestamp: string;
  status: "success" | "partial" | "failed" | "preview";
  recordsProcessed: number;
  errors: number;
  sourceFileName: string | null;
  projectName: string | null;
}

export interface ImportHealth {
  lastImportTime: string | null;
  lastImportStatus: ImportHistoryEntry["status"] | null;
  errorCount: number;
  pendingValidations: number;
  importHistory: ImportHistoryEntry[];
}

function classifyImportStatus(status: string): ImportHistoryEntry["status"] {
  switch (status?.toLowerCase()) {
    case "committed":
      return "success";
    case "failed":
    case "rolled_back":
    case "superseded":
      return "failed";
    case "awaiting_review":
      return "partial";
    default:
      return "preview";
  }
}

export async function getDashboardImportHealth(): Promise<ImportHealth> {
  type RecentRow = {
    uploadedAt: Date | string | null;
    committedAt: Date | string | null;
    status: string;
    recordsAttempted: number | null;
    recordsSucceeded: number | null;
    recordsFailed: number | null;
    sourceFileName: string;
    projectName: string;
  };

  const [recent, pendingRows] = await Promise.all([
    (db
      .select({
        uploadedAt: smartImportRuns.uploadedAt,
        committedAt: smartImportRuns.committedAt,
        status: smartImportRuns.status,
        recordsAttempted: smartImportRuns.recordsAttempted,
        recordsSucceeded: smartImportRuns.recordsSucceeded,
        recordsFailed: smartImportRuns.recordsFailed,
        sourceFileName: smartImportRuns.sourceFileName,
        projectName: smartImportRuns.projectName,
      })
      .from(smartImportRuns)
      .orderBy(desc(smartImportRuns.uploadedAt))
      .limit(10)) as Promise<RecentRow[]>,
    db
      .select({ id: smartImportRuns.id })
      .from(smartImportRuns)
      .where(eq(smartImportRuns.status, "awaiting_review")),
  ]);

  const history: ImportHistoryEntry[] = recent.map((r: RecentRow): ImportHistoryEntry => {
    const ts = r.committedAt ?? r.uploadedAt;
    return {
      timestamp: ts ? new Date(ts).toISOString() : new Date().toISOString(),
      status: classifyImportStatus(r.status),
      recordsProcessed: Number(r.recordsSucceeded ?? r.recordsAttempted ?? 0),
      errors: Number(r.recordsFailed ?? 0),
      sourceFileName: r.sourceFileName ?? null,
      projectName: r.projectName ?? null,
    };
  });

  const last = history[0] ?? null;
  return {
    lastImportTime: last?.timestamp ?? null,
    lastImportStatus: last?.status ?? null,
    errorCount: history.reduce((sum, h) => sum + h.errors, 0),
    pendingValidations: pendingRows.length,
    importHistory: history,
  };
}

// ─── Attention items ─────────────────────────────────────────────

export interface AttentionItem {
  id: number;
  name: string;
  owner: string | null;
  ageDays: number;
  severity: "high" | "medium" | "low";
  link: string;
  /** Behind-plan only: gap between expected and actual progress, percentage points. */
  daysBehind?: number;
}

export interface AttentionItemsResponse {
  behindPlan: AttentionItem[];
  engineeringBlockers: AttentionItem[];
  qualityWarnings: AttentionItem[];
  overdueActions: AttentionItem[];
}

const BEHIND_PLAN_GAP_THRESHOLD = 5; // percentage points
const TOP_N = 10;

function ageDays(from: Date | string | null): number {
  if (!from) return 0;
  const d = from instanceof Date ? from : new Date(from);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

function severityFromAge(age: number): "high" | "medium" | "low" {
  if (age >= 14) return "high";
  if (age >= 5) return "medium";
  return "low";
}

function severityFromGap(gapPct: number): "high" | "medium" | "low" {
  if (gapPct >= 20) return "high";
  if (gapPct >= 10) return "medium";
  return "low";
}

function severityFromQcWarning(input: string | null): "high" | "medium" | "low" {
  switch ((input ?? "").toLowerCase()) {
    case "critical":
    case "high":
      return "high";
    case "low":
      return "low";
    default:
      return "medium";
  }
}

export async function getDashboardAttentionItems(): Promise<AttentionItemsResponse> {
  type PmTaskRow = { projectId: number | null; actual: number | null; expected: number | null };
  type EngBlockerRow = {
    id: number;
    title: string;
    ownerName: string | null;
    updatedAt: Date | string | null;
    projectId: number | null;
  };
  type QcWarningRow = {
    id: number;
    title: string;
    severity: string | null;
    createdAt: Date | string | null;
    projectId: number | null;
    projectName: string | null;
  };
  type PendingEditRow = {
    id: number;
    editSummary: string;
    createdAt: Date | string | null;
    isCriticalPath: boolean | null;
    projectId: number | null;
    projectName: string | null;
  };

  const [
    pmTaskRows,
    engBlockerRows,
    qcWarningRows,
    pendingEditRows,
    projects,
  ] = await Promise.all([
    (db
      .select({
        projectId: workItems.projectId,
        actual: workItems.percentComplete,
        expected: workItems.expectedPctComplete,
      })
      .from(workItems)
      .where(and(
        eq(workItems.workstream, "PM"),
        isNull(workItems.deletedAt),
      ))) as Promise<PmTaskRow[]>,
    (db
      .select({
        id: workItems.id,
        title: workItems.title,
        ownerName: workItems.ownerName,
        updatedAt: workItems.updatedAt,
        projectId: workItems.projectId,
      })
      .from(workItems)
      .where(and(
        eq(workItems.workstream, "ENG"),
        isNull(workItems.deletedAt),
        ilike(workItems.status, "%block%"),
      ))
      .limit(TOP_N)) as Promise<EngBlockerRow[]>,
    (db
      .select({
        id: qcWarning.id,
        title: qcWarning.title,
        severity: qcWarning.severity,
        createdAt: qcWarning.createdAt,
        projectId: qcWarning.projectId,
        projectName: qcWarning.projectName,
      })
      .from(qcWarning)
      .where(eq(qcWarning.status, "open"))
      .orderBy(desc(qcWarning.createdAt))
      .limit(TOP_N)) as Promise<QcWarningRow[]>,
    (db
      .select({
        id: financialEditRequests.id,
        editSummary: financialEditRequests.editSummary,
        createdAt: financialEditRequests.createdAt,
        isCriticalPath: financialEditRequests.isCriticalPath,
        projectId: financialEditRequests.projectId,
        projectName: financialEditRequests.projectName,
      })
      .from(financialEditRequests)
      .where(eq(financialEditRequests.status, "pending"))
      .orderBy(desc(financialEditRequests.createdAt))
      .limit(TOP_N)) as Promise<PendingEditRow[]>,
    db
      .select({ id: projectInfo.id, name: projectInfo.projectName })
      .from(projectInfo)
      .where(isNull(projectInfo.deletedAt)),
  ]);

  const projectName = new Map<number, string>();
  for (const p of projects) projectName.set(p.id, p.name);

  // ── Behind-plan rollup ────────────────────────────────────────
  // Per-project avg(expected - actual). We sum and count to compute
  // the simple mean rather than the duration-weighted figure used by
  // computeProjectCompletion — fine for an attention widget.
  const acc = new Map<number, { gapSum: number; count: number }>();
  for (const t of pmTaskRows) {
    const projectId = t.projectId;
    if (projectId == null || t.expected == null || t.actual == null) continue;
    // `work_items.percentComplete` / `expectedPctComplete` are written on
    // the canonical 0..1 scale (see clampPercent in
    // server/lib/import/value-normalization.ts). `BEHIND_PLAN_GAP_THRESHOLD`
    // and `severityFromGap` operate in percentage points (0..100), so
    // route through pctTo100() which converts 0..1 → 0..100 and is also
    // tolerant of legacy 0..100 stragglers. See
    // docs/smart-import-v2-task-dedup-audit.md (Fix 4a).
    const expected = pctTo100(t.expected);
    const actual = pctTo100(t.actual);
    if (expected == null || actual == null) continue;
    const gap = expected - actual; // positive = behind plan, in percentage points
    const cur = acc.get(projectId) ?? { gapSum: 0, count: 0 };
    cur.gapSum += gap;
    cur.count += 1;
    acc.set(projectId, cur);
  }
  const behindPlan: AttentionItem[] = Array.from(acc.entries())
    .map(([projectId, { gapSum, count }]) => ({ projectId, avgGap: count > 0 ? gapSum / count : 0 }))
    .filter((p) => p.avgGap >= BEHIND_PLAN_GAP_THRESHOLD)
    .sort((a, b) => b.avgGap - a.avgGap)
    .slice(0, TOP_N)
    .map((p) => {
      const gapPct = Math.round(p.avgGap * 10) / 10;
      return {
        id: p.projectId,
        name: projectName.get(p.projectId) ?? `Project ${p.projectId}`,
        owner: null,
        ageDays: 0,
        daysBehind: gapPct,
        severity: severityFromGap(gapPct),
        link: `/projects/${p.projectId}`,
      };
    });

  // ── Engineering blockers ─────────────────────────────────────
  const engineeringBlockers: AttentionItem[] = engBlockerRows.map((r: EngBlockerRow): AttentionItem => {
    const age = ageDays(r.updatedAt);
    return {
      id: r.id,
      name: r.title,
      owner: r.ownerName ?? null,
      ageDays: age,
      severity: severityFromAge(age),
      link: r.projectId != null ? `/projects/${r.projectId}` : "/engineering",
    };
  });

  // ── Quality warnings ─────────────────────────────────────────
  const qualityWarnings: AttentionItem[] = qcWarningRows.map((r: QcWarningRow): AttentionItem => ({
    id: r.id,
    name: r.title,
    owner: null,
    ageDays: ageDays(r.createdAt),
    severity: severityFromQcWarning(r.severity ?? null),
    link: r.projectId != null ? `/projects/${r.projectId}` : "/quality",
  }));

  // ── Overdue actions (pending financial edits) ────────────────
  const overdueActions: AttentionItem[] = pendingEditRows.map((r: PendingEditRow): AttentionItem => {
    const age = ageDays(r.createdAt);
    return {
      id: r.id,
      name: r.editSummary,
      owner: null,
      ageDays: age,
      severity: r.isCriticalPath ? "high" : severityFromAge(age),
      link: "/financial-review-queue",
    };
  });

  return { behindPlan, engineeringBlockers, qualityWarnings, overdueActions };
}
