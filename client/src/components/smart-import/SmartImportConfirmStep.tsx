/**
 * Smart Import v2 — "Confirm import" step
 *
 * Dead-simple summary of what will happen, plus the commit button.
 * After successful commit, shows a plain result screen.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, CheckCircle2, Loader2, AlertCircle,
  Plus, RefreshCw, Check, Minus, Shield, FileSpreadsheet, Upload,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { getAuthHeaders } from "@/pages/smart-import";
import { SECTION_LABELS, CONFIRM_LABELS, RESULT_LABELS, IMPORT_MODE_LABELS } from "./labels";
import { SmartImportMoneyImpact } from "./SmartImportMoneyImpact";
import { SmartImportQbProtectionsCallout } from "./SmartImportQbProtectionsCallout";
import { SmartImportIntegrityCheck } from "./SmartImportIntegrityCheck";
import { SmartImportPreflightPanel } from "./SmartImportPreflightPanel";
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

export function SmartImportConfirmStep({ runId, planning, preview, decisions, onBack, onCommitComplete, onStartNew }: ConfirmStepProps) {
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<any>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [, navigate] = useLocation();

  const sections = planning?.sections || {};
  const conflicts = planning?.conflicts;
  const importMode = planning?.importMode || "BASELINE";

  // Aggregate counts across sections
  let totalNew = 0, totalChanged = 0, totalUnchanged = 0, totalMissing = 0;
  for (const key of ["PLAN", "REVENUE", "EXPENDITURE"] as const) {
    const s = sections[key];
    if (!s) continue;
    totalNew += s.newCount || 0;
    totalChanged += s.changedCount || 0;
    totalUnchanged += s.unchangedCount || 0;
    totalMissing += s.missingFromUploadCount || 0;
  }
  const totalDecisions = Object.keys(decisions).length;

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
    const projectName = preview?.detection?.projectInfo?.name || preview?.detection?.projectInfo?.projectName || preview?.projectInfo?.name || "";
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
          Confirm import
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Review the summary below. When you're ready, press "Confirm import" to apply the changes.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Import type badge */}
        <div className="flex items-center gap-2">
          <Badge className={importMode === "BASELINE" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-blue-50 text-blue-700 border-blue-200"}>
            {IMPORT_MODE_LABELS[importMode as keyof typeof IMPORT_MODE_LABELS] || importMode}
          </Badge>
        </div>

        {/* Summary counts */}
        <div className="grid gap-2" data-testid="confirm-summary">
          <SummaryRow icon={<Plus className="w-4 h-4 text-emerald-600" />} count={totalNew} label={CONFIRM_LABELS.newRows} color="bg-emerald-50 text-emerald-800 border-emerald-200" />
          <SummaryRow icon={<RefreshCw className="w-4 h-4 text-blue-600" />} count={totalChanged} label={CONFIRM_LABELS.updatedRows} color="bg-blue-50 text-blue-800 border-blue-200" />
          <SummaryRow icon={<Check className="w-4 h-4 text-slate-500" />} count={totalUnchanged} label={CONFIRM_LABELS.unchangedRows} color="bg-slate-50 text-slate-600 border-slate-200" />
          {totalDecisions > 0 && (
            <SummaryRow icon={<Shield className="w-4 h-4 text-purple-600" />} count={totalDecisions} label={CONFIRM_LABELS.decisionsApplied} color="bg-purple-50 text-purple-800 border-purple-200" />
          )}
          {totalMissing > 0 && (
            <SummaryRow icon={<Minus className="w-4 h-4 text-amber-600" />} count={totalMissing} label={CONFIRM_LABELS.missingRows} color="bg-amber-50 text-amber-800 border-amber-200" />
          )}
        </div>

        {/* Per-section breakdown */}
        <div className="text-xs text-muted-foreground space-y-1 border-t pt-3">
          {(["PLAN", "REVENUE", "EXPENDITURE"] as const).map(key => {
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

        {/* Pre-flight warnings (S003/S004) — surfaces planned-identifier
            collisions, blank-outline milestones, and missing source
            coordinates before the user commits. */}
        {preview?.preflight && (preview.preflight.warnings?.length ?? 0) > 0 && (
          <div className="border-t pt-3">
            <SmartImportPreflightPanel preflight={preview.preflight} variant="pre-commit" />
          </div>
        )}

        {/* QuickBooks protections — compact, sits just before the money
            impact so the user understands what is locked before reading
            the financial movement. */}
        <div className="border-t pt-3">
          <SmartImportQbProtectionsCallout runId={runId} compact />
        </div>

        {/* Money impact (A1) — pre-commit financial dry-run. */}
        <div className="border-t pt-3">
          <SmartImportMoneyImpact runId={runId} decisions={decisions} />
        </div>

        {/* Invoice / PO integrity (B4a) — advisory data-hygiene check. */}
        <div className="border-t pt-3">
          <SmartImportIntegrityCheck runId={runId} />
        </div>

        {/* UX-3: downstream-impact card — final "who will see this" before commit. */}
        <div className="border-t pt-3">
          <SmartImportDownstreamImpact
            planning={planning}
            projectName={preview?.detection?.projectInfo?.name ?? null}
          />
        </div>

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
        <div className="flex justify-between pt-2">
          <Button variant="outline" size="sm" onClick={onBack} disabled={committing} data-testid="confirm-back-btn">
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Back
          </Button>
          <Button
            size="sm"
            onClick={handleCommit}
            disabled={committing}
            className="bg-emerald-600 hover:bg-emerald-700"
            data-testid="confirm-import-btn"
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
