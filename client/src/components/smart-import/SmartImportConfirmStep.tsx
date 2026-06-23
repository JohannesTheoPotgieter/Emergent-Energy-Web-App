/**
 * Smart Import v2 — "Review & import" step
 *
 * The single consolidated review screen for the manual flow. It opens with an
 * at-a-glance change summary (new / updated / removed counts), a short preview
 * of the actual rows that change (with before → after values), the schedule and
 * money impact, then the commit button. Heavier detail (per-section row tables,
 * invoice/PO checks, "who will see this", and file metadata) lives behind
 * expanders so the important changes are visible at a glance.
 *
 * UI only — this does not change how importing works. The plan/money/commit
 * endpoints and conflict-decision handling are unchanged. After a successful
 * commit it shows the same plain result screen.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, CheckCircle2, Loader2, AlertCircle, AlertTriangle,
  Plus, RefreshCw, Check, Minus, Shield, FileSpreadsheet, Upload,
  ChevronDown, ChevronUp, ChevronRight, CalendarDays, ListTree,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { getAuthHeaders } from "@/pages/smart-import";
import {
  SECTION_LABELS, RESULT_LABELS, IMPORT_MODE_LABELS,
  CLASSIFICATION_LABELS, REVIEW_LABELS, fieldLabel,
} from "./labels";
import { SmartImportMoneyImpact } from "./SmartImportMoneyImpact";
import { SmartImportQbProtectionsCallout } from "./SmartImportQbProtectionsCallout";
import { SmartImportIntegrityCheck } from "./SmartImportIntegrityCheck";
import { SmartImportPreflightPanel } from "./SmartImportPreflightPanel";
import { SmartImportScheduleImpact } from "./SmartImportScheduleImpact";
import { SmartImportDownstreamImpact } from "./SmartImportDownstreamImpact";
import { SmartImportPostCommitNext } from "./SmartImportPostCommitNext";

interface ConfirmStepProps {
  runId: number;
  planning: any;
  preview?: any;
  decisions: Record<string, "keep_app" | "accept_file">;
  onBack: () => void;
  onCommitComplete?: () => void;
  onStartNew?: () => void;
  /** Number of conflict decisions still unresolved. Commit is gated on 0. */
  unresolvedConflictCount?: number;
  /** Jump back to the decisions step to resolve the remaining conflicts. */
  onResolveConflicts?: () => void;
}

const SECTION_ORDER = ["PLAN", "REVENUE", "EXPENDITURE"] as const;

type ChangeKind = "updated" | "new" | "removed";

interface TopChange {
  section: string;
  kind: ChangeKind;
  label: string;
  detail: string | null;
  extraFields: number;
}

/** Truncate a single cell value for the before → after preview. */
function fmtChangeVal(v: unknown): string {
  if (v == null || v === "") return "—";
  const s = String(v);
  return s.length > 24 ? s.slice(0, 21) + "…" : s;
}

/**
 * Collect the most material row changes across all sections for the
 * "what's changing" preview. Updated rows (with a field delta) come first,
 * then new rows, then removed rows — that's the order a reviewer cares about.
 */
function collectTopChanges(sections: any, limit = 8): { items: TopChange[]; total: number } {
  const updated: TopChange[] = [];
  const created: TopChange[] = [];
  const removed: TopChange[] = [];

  for (const section of SECTION_ORDER) {
    const rows = sections?.[section]?.rows ?? [];
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      const label = String(r?.rowLabel || r?.displayLabel || "Row");
      if (r?.classification === "CHANGED") {
        const cf = Array.isArray(r.changedFields) ? r.changedFields : [];
        const first = cf[0];
        const detail = first
          ? `${fieldLabel(first.fieldName)}: ${fmtChangeVal(first.existingValue ?? first.currentAppValue)} → ${fmtChangeVal(first.fileValue ?? first.uploadedValue)}`
          : null;
        updated.push({ section, kind: "updated", label, detail, extraFields: Math.max(0, cf.length - 1) });
      } else if (r?.classification === "NEW") {
        created.push({ section, kind: "new", label, detail: null, extraFields: 0 });
      } else if (r?.classification === "MISSING_FROM_UPLOAD") {
        removed.push({ section, kind: "removed", label, detail: null, extraFields: 0 });
      }
    }
  }

  const ordered = [...updated, ...created, ...removed];
  return { items: ordered.slice(0, limit), total: ordered.length };
}

function SummaryRow({ icon, count, label, color }: { icon: React.ReactNode; count: number; label: string; color: string }) {
  if (count === 0) return null;
  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border ${color}`} data-testid={`confirm-summary-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      {icon}
      <span className="text-lg font-bold">{count}</span>
      <span className="text-sm">{label}</span>
    </div>
  );
}

/** Big at-a-glance stat tile. */
function GlanceStat({
  icon, count, label, tone, testId,
}: {
  icon: React.ReactNode;
  count: number;
  label: string;
  tone: "emerald" | "blue" | "amber";
  testId: string;
}) {
  const colour = {
    emerald: "bg-emerald-50 text-emerald-800 border-emerald-200",
    blue: "bg-blue-50 text-blue-800 border-blue-200",
    amber: "bg-amber-50 text-amber-800 border-amber-200",
  }[tone];
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${colour}`} data-testid={testId}>
      {icon}
      <div className="leading-tight">
        <div className="text-2xl font-bold tabular-nums">{count}</div>
        <div className="text-xs font-medium">{label}</div>
      </div>
    </div>
  );
}

const KIND_BADGE: Record<ChangeKind, { label: string; cls: string }> = {
  updated: { label: CLASSIFICATION_LABELS.CHANGED, cls: "bg-blue-50 text-blue-700 border-blue-200" },
  new: { label: CLASSIFICATION_LABELS.NEW, cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  removed: { label: CLASSIFICATION_LABELS.MISSING_FROM_UPLOAD, cls: "bg-amber-50 text-amber-700 border-amber-200" },
};

/** Lightweight, lazily-rendered disclosure for the secondary detail blocks. */
function Disclosure({
  title, icon, testId, defaultOpen = false, children,
}: {
  title: string;
  icon?: React.ReactNode;
  testId: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t pt-3" data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-sm font-medium text-slate-700 hover:text-slate-900"
        data-testid={`${testId}-toggle`}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">{icon}{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && <div className="pt-3">{children}</div>}
    </div>
  );
}

/** Per-section row breakdown (counts + an expandable row table). */
function SectionDetail({ sectionKey, plan }: { sectionKey: string; plan: any }) {
  const [expanded, setExpanded] = useState(false);
  if (!plan) return null;

  const newCount = plan.newCount || 0;
  const changedCount = plan.changedCount || 0;
  const unchangedCount = plan.unchangedCount || 0;
  const missingCount = plan.missingFromUploadCount || 0;
  const total = newCount + changedCount + unchangedCount + missingCount;
  if (total === 0) return null;

  const parts: string[] = [];
  if (newCount) parts.push(`${newCount} ${REVIEW_LABELS.new}`);
  if (changedCount) parts.push(`${changedCount} ${REVIEW_LABELS.updated}`);
  if (missingCount) parts.push(`${missingCount} ${REVIEW_LABELS.removed}`);
  if (parts.length === 0 && unchangedCount) parts.push(`${unchangedCount} unchanged`);

  return (
    <div className="border rounded-lg overflow-hidden" data-testid={`review-section-${sectionKey}`}>
      <div className="flex items-center justify-between bg-slate-50 px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{SECTION_LABELS[sectionKey] || sectionKey}</span>
          <span className="text-xs text-muted-foreground">{parts.join(" · ")}</span>
        </div>
        {Array.isArray(plan.rows) && plan.rows.length > 0 && (
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-slate-700"
            onClick={() => setExpanded((e) => !e)}
            data-testid={`review-section-${sectionKey}-toggle`}
          >
            {expanded ? "Hide" : "Rows"}
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        )}
      </div>
      {expanded && Array.isArray(plan.rows) && (
        <div className="max-h-64 overflow-y-auto border-t px-3 py-2">
          <table className="w-full text-xs">
            <tbody>
              {plan.rows
                .filter((r: any) => r.classification !== "UNCHANGED")
                .slice(0, 60)
                .map((row: any, idx: number) => (
                  <tr key={idx} className="border-t border-slate-100 first:border-t-0">
                    <td className="py-1 pr-2 align-top">
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${
                        row.classification === "NEW" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                        row.classification === "CHANGED" ? "bg-blue-50 text-blue-700 border-blue-200" :
                        "bg-amber-50 text-amber-700 border-amber-200"
                      }`}>
                        {CLASSIFICATION_LABELS[row.classification] || row.classification}
                      </Badge>
                    </td>
                    <td className="py-1 pr-2 font-medium align-top">{String(row.rowLabel || `Row ${idx + 1}`)}</td>
                    <td className="py-1 text-muted-foreground align-top">
                      {Array.isArray(row.changedFields) && row.changedFields.length > 0 && (
                        <span className="font-mono text-[10px]">
                          {fieldLabel(row.changedFields[0].fieldName)}: {fmtChangeVal(row.changedFields[0].existingValue ?? row.changedFields[0].currentAppValue)} {"→"} {fmtChangeVal(row.changedFields[0].fileValue ?? row.changedFields[0].uploadedValue)}
                          {row.changedFields.length > 1 && <span className="text-slate-400"> +{row.changedFields.length - 1} {REVIEW_LABELS.moreFields}</span>}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function SmartImportConfirmStep({
  runId, planning, preview, decisions, onBack, onCommitComplete, onStartNew,
  unresolvedConflictCount = 0, onResolveConflicts,
}: ConfirmStepProps) {
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<any>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [showAllChanges, setShowAllChanges] = useState(false);
  const [, navigate] = useLocation();

  const sections = planning?.sections || {};
  const importMode = planning?.importMode || "BASELINE";

  // Aggregate counts across sections
  let totalNew = 0, totalChanged = 0, totalUnchanged = 0, totalMissing = 0;
  for (const key of SECTION_ORDER) {
    const s = sections[key];
    if (!s) continue;
    totalNew += s.newCount || 0;
    totalChanged += s.changedCount || 0;
    totalUnchanged += s.unchangedCount || 0;
    totalMissing += s.missingFromUploadCount || 0;
  }
  const totalDecisions = Object.keys(decisions).length;
  const hasAnyChange = totalNew + totalChanged + totalMissing > 0;

  const { items: topChanges, total: changeTotal } = useMemo(
    () => collectTopChanges(planning?.sections, showAllChanges ? 1000 : 8),
    [planning, showAllChanges],
  );

  const projectName =
    preview?.detection?.projectInfo?.name ||
    preview?.detection?.projectInfo?.projectName ||
    preview?.projectInfo?.name ||
    "";

  const unmatchedSheets: any[] = preview?.detection?.unmatched || [];
  const keyDates = (() => {
    const pi = preview?.detection?.projectInfo;
    if (!pi) return [] as { label: string; value: string }[];
    const fmt = (v: any) => { try { return new Date(v).toLocaleDateString("en-ZA"); } catch { return String(v); } };
    const out: { label: string; value: string }[] = [];
    if (pi.pdHandoverDate) out.push({ label: "PD Handover", value: fmt(pi.pdHandoverDate) });
    if (pi.constructionStartDate) out.push({ label: "Construction", value: fmt(pi.constructionStartDate) });
    if (pi.commissioningDate) out.push({ label: "Commissioning", value: fmt(pi.commissioningDate) });
    if (pi.clientHandoverDate) out.push({ label: "Client Handover", value: fmt(pi.clientHandoverDate) });
    return out;
  })();

  const blockedByConflicts = unresolvedConflictCount > 0;

  const handleCommit = async () => {
    setCommitting(true);
    setCommitError(null);
    try {
      const body: any = { preserveManualEdits: true };
      if (totalDecisions > 0) {
        body.v2ConflictResolutions = decisions;
      }
      const res = await fetch(`/api/smart-import/${runId}/commit`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Import failed" }));
        throw new Error(err.error || err.message || `Import failed (${res.status})`);
      }
      const data = await res.json();
      setCommitResult(data);
      onCommitComplete?.();
    } catch (err: any) {
      setCommitError(err.message || "Something went wrong during import.");
    } finally {
      setCommitting(false);
    }
  };

  // After successful commit — show result screen
  if (commitResult) {
    const counts = commitResult.counts || {};
    const summary = commitResult.summary || {};
    return (
      <Card data-testid="confirm-result">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2 text-emerald-700">
            <CheckCircle2 className="w-5 h-5" />
            {RESULT_LABELS.success}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <SummaryRow icon={<Plus className="w-4 h-4 text-emerald-600" />} count={summary.rowsWritten || 0} label={RESULT_LABELS.newAdded + " / updated"} color="bg-emerald-50 text-emerald-800 border-emerald-200" />
            {totalUnchanged > 0 && (
              <SummaryRow icon={<Check className="w-4 h-4 text-slate-500" />} count={totalUnchanged} label={RESULT_LABELS.noChange} color="bg-slate-50 text-slate-600 border-slate-200" />
            )}
            {totalDecisions > 0 && (
              <SummaryRow icon={<Shield className="w-4 h-4 text-blue-600" />} count={totalDecisions} label={RESULT_LABELS.decisionsApplied} color="bg-blue-50 text-blue-800 border-blue-200" />
            )}
            {totalMissing > 0 && (
              <SummaryRow icon={<Minus className="w-4 h-4 text-amber-600" />} count={totalMissing} label={RESULT_LABELS.skippedKept} color="bg-amber-50 text-amber-800 border-amber-200" />
            )}
          </div>

          {/* Per-section breakdown */}
          {(counts.planTasks != null || counts.revenueLines != null || counts.costLines != null) && (
            <div className="text-xs text-muted-foreground space-y-1 border-t pt-3">
              {counts.planTasks != null && counts.planTasks > 0 && (
                <div className="flex items-center gap-2">
                  <span className="font-medium w-40">{SECTION_LABELS.PLAN || "Schedule / Timeline"}</span>
                  <span>{counts.planTasks} rows imported</span>
                </div>
              )}
              {counts.revenueLines != null && counts.revenueLines > 0 && (
                <div className="flex items-center gap-2">
                  <span className="font-medium w-40">{SECTION_LABELS.REVENUE || "Revenue / Milestones"}</span>
                  <span>{counts.revenueLines} rows imported</span>
                </div>
              )}
              {counts.costLines != null && counts.costLines > 0 && (
                <div className="flex items-center gap-2">
                  <span className="font-medium w-40">{SECTION_LABELS.EXPENDITURE || "Costs / Expenses"}</span>
                  <span>{counts.costLines} rows imported</span>
                </div>
              )}
            </div>
          )}

          {Array.isArray(commitResult?.v2?.rowWarnings) && commitResult.v2.rowWarnings.length > 0 && (
            <div className="border-t pt-3">
              <SmartImportPreflightPanel rowWarnings={commitResult.v2.rowWarnings} variant="post-commit" />
            </div>
          )}

          {/* UX-3: plain-English "what happens next" card. */}
          <SmartImportPostCommitNext planning={planning} commitResult={commitResult} />

          <p className="text-xs text-muted-foreground mt-3">
            {RESULT_LABELS.dashboardNote}
          </p>

          {/* Post-import actions */}
          <div className="flex gap-2 pt-2">
            {projectName && (
              <Button
                size="sm"
                onClick={() => navigate(`/project/${encodeURIComponent(projectName)}`)}
                data-testid="confirm-view-project-btn"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />
                View Project
              </Button>
            )}
            {onStartNew && (
              <Button
                variant="outline"
                size="sm"
                onClick={onStartNew}
                data-testid="confirm-start-new-btn"
              >
                <Upload className="w-3.5 h-3.5 mr-1.5" />
                Import Another File
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="confirm-step">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-blue-600" />
          {REVIEW_LABELS.title}
          {projectName && <span className="text-muted-foreground font-normal">— {projectName}</span>}
          <Badge className={`ml-1 ${importMode === "BASELINE" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-blue-50 text-blue-700 border-blue-200"}`}>
            {IMPORT_MODE_LABELS[importMode as keyof typeof IMPORT_MODE_LABELS] || importMode}
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">{REVIEW_LABELS.subtitle}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* At a glance — the headline counts. */}
        <div data-testid="review-glance">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            {REVIEW_LABELS.glanceTitle}
          </p>
          {hasAnyChange ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <GlanceStat icon={<Plus className="w-5 h-5" />} count={totalNew} label={REVIEW_LABELS.new} tone="emerald" testId="glance-new" />
              <GlanceStat icon={<RefreshCw className="w-5 h-5" />} count={totalChanged} label={REVIEW_LABELS.updated} tone="blue" testId="glance-updated" />
              {totalMissing > 0 && (
                <GlanceStat icon={<Minus className="w-5 h-5" />} count={totalMissing} label={REVIEW_LABELS.removed} tone="amber" testId="glance-removed" />
              )}
            </div>
          ) : (
            <div className="rounded-lg border bg-slate-50 px-4 py-3 text-sm text-slate-600" data-testid="glance-no-changes">
              {REVIEW_LABELS.noChanges}
            </div>
          )}
        </div>

        {/* What's changing — the actual rows, with before → after. */}
        {changeTotal > 0 && (
          <div data-testid="review-changes-preview">
            <p className="text-sm font-medium text-slate-700 mb-2">{REVIEW_LABELS.whatsChanging}</p>
            <div className="border rounded-lg divide-y divide-slate-100">
              {topChanges.map((c, idx) => {
                const badge = KIND_BADGE[c.kind];
                return (
                  <div key={idx} className="flex items-start gap-2 px-3 py-2 text-sm" data-testid={`review-change-${idx}`}>
                    <Badge variant="outline" className={`mt-0.5 text-[10px] px-1.5 py-0 flex-shrink-0 ${badge.cls}`}>{badge.label}</Badge>
                    <Badge variant="outline" className="mt-0.5 text-[10px] px-1.5 py-0 flex-shrink-0 text-slate-500">{SECTION_LABELS[c.section] || c.section}</Badge>
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-slate-700">{c.label}</span>
                      {c.detail && (
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {c.detail}
                          {c.extraFields > 0 && <span className="text-slate-400"> +{c.extraFields} {REVIEW_LABELS.moreFields}</span>}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {changeTotal > topChanges.length && !showAllChanges && (
              <button
                type="button"
                className="mt-1.5 text-xs font-medium text-blue-700 hover:text-blue-800"
                onClick={() => setShowAllChanges(true)}
                data-testid="review-show-all-changes"
              >
                {REVIEW_LABELS.showAllChanges} ({changeTotal - topChanges.length} {REVIEW_LABELS.moreItems})
              </button>
            )}
          </div>
        )}

        {/* Schedule impact — only renders when there's a plan section. */}
        <SmartImportScheduleImpact planning={planning} />

        {/* Money impact — kept visible (a glance priority), with the QB
            protection note right above it. */}
        <div className="rounded-lg border bg-card p-3 space-y-3" data-testid="review-money">
          <SmartImportQbProtectionsCallout runId={runId} compact />
          <SmartImportMoneyImpact runId={runId} decisions={decisions} />
        </div>

        {/* Conflict gate — only when there are unresolved decisions. */}
        {blockedByConflicts && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3" data-testid="review-conflict-gate">
            <div className="flex items-start gap-2 text-sm text-amber-900">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                <strong>{unresolvedConflictCount}</strong> {REVIEW_LABELS.decisionsNeededSuffix}.
              </span>
            </div>
            {onResolveConflicts && (
              <Button size="sm" variant="outline" className="flex-shrink-0 border-amber-300" onClick={onResolveConflicts} data-testid="review-resolve-conflicts">
                {REVIEW_LABELS.resolveDecisions}
              </Button>
            )}
          </div>
        )}

        {/* Per-section detail — counts plus an expandable row table. */}
        <Disclosure title={REVIEW_LABELS.sectionDetails} icon={<ListTree className="w-4 h-4 text-muted-foreground" />} testId="review-section-details" defaultOpen={!hasAnyChange}>
          <div className="space-y-2">
            {/* Plain CONFIRM-style one-liner kept for continuity / screen readers. */}
            <div className="text-xs text-muted-foreground space-y-1" data-testid="confirm-summary">
              {SECTION_ORDER.map((key) => {
                const s = sections[key];
                if (!s) return null;
                const total = (s.newCount || 0) + (s.changedCount || 0) + (s.unchangedCount || 0);
                if (total === 0) return null;
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className="font-medium w-40">{SECTION_LABELS[key]}</span>
                    <span>{s.newCount || 0} new, {s.changedCount || 0} updated, {s.unchangedCount || 0} unchanged</span>
                  </div>
                );
              })}
            </div>
            {SECTION_ORDER.map((key) => (
              <SectionDetail key={key} sectionKey={key} plan={sections[key]} />
            ))}
          </div>
        </Disclosure>

        {/* Pre-flight warnings (S003/S004). */}
        {preview?.preflight && (preview.preflight.warnings?.length ?? 0) > 0 && (
          <div className="border-t pt-3">
            <SmartImportPreflightPanel preflight={preview.preflight} variant="pre-commit" />
          </div>
        )}

        {/* Invoice / PO integrity (B4a) — advisory data-hygiene check. */}
        <Disclosure title={REVIEW_LABELS.checksTitle} icon={<CheckCircle2 className="w-4 h-4 text-muted-foreground" />} testId="review-checks">
          <SmartImportIntegrityCheck runId={runId} />
        </Disclosure>

        {/* UX-3: downstream-impact card — "who will see this" before commit. */}
        <Disclosure title={REVIEW_LABELS.whoSeesTitle} icon={<Shield className="w-4 h-4 text-muted-foreground" />} testId="review-downstream">
          <SmartImportDownstreamImpact
            planning={planning}
            projectName={preview?.detection?.projectInfo?.name ?? null}
          />
        </Disclosure>

        {/* File metadata — sheets not used + key dates, low priority. */}
        {(unmatchedSheets.length > 0 || keyDates.length > 0) && (
          <Disclosure title={REVIEW_LABELS.fileDetailsTitle} icon={<CalendarDays className="w-4 h-4 text-muted-foreground" />} testId="review-file-details">
            <div className="space-y-3 text-sm">
              {keyDates.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-600 mb-1">{REVIEW_LABELS.keyDates}</p>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                    {keyDates.map((d) => (
                      <span key={d.label}>{d.label}: <strong className="text-foreground">{d.value}</strong></span>
                    ))}
                  </div>
                </div>
              )}
              {unmatchedSheets.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-600 mb-1">{REVIEW_LABELS.sheetsNotUsed}</p>
                  <ul className="text-xs text-muted-foreground space-y-0.5">
                    {unmatchedSheets.map((u: any, i: number) => (
                      <li key={i}>&quot;{String(u.sheetName || "")}&quot;{u.reason ? ` — ${String(u.reason)}` : ""}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Disclosure>
        )}

        {/* Error display */}
        {commitError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800 flex items-start gap-2" data-testid="confirm-error">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Import could not be completed</p>
              <p className="text-xs mt-0.5">{typeof commitError === "object" ? JSON.stringify(commitError) : String(commitError)}</p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-between pt-2 border-t">
          <Button variant="outline" size="sm" onClick={onBack} disabled={committing} data-testid="confirm-back-btn">
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Back
          </Button>
          <Button
            size="sm"
            onClick={handleCommit}
            disabled={committing || blockedByConflicts}
            className="bg-emerald-600 hover:bg-emerald-700"
            data-testid="confirm-import-btn"
            title={blockedByConflicts ? "Resolve the outstanding decisions first" : undefined}
          >
            {committing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                Confirm import
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
