import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminQueryState } from "@/components/admin/admin-shell";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  ShieldAlert,
} from "lucide-react";

export interface ImportGovernanceSummary {
  previewRuns: number;
  awaitingReviewRuns: number;
  committedRuns: number;
  failedRuns: number;
  rolledBackRuns: number;
  supersededRuns: number;
  reviewBacklog: number;
  pendingExcelConfirmations: number;
  unresolvedPlanEdits: number;
  lastRunAt: string | null;
}

export interface ImportGovernanceRun {
  id: number;
  projectName: string;
  status: string;
  uploadedAt: string | null;
  sourceFileName: string;
  recordsAttempted: number;
  recordsSucceeded: number;
  recordsFailed: number;
  blockerCount: number;
  warningCount: number;
}

export interface ImportGovernanceData {
  summary: ImportGovernanceSummary;
  recentRuns: ImportGovernanceRun[];
  recentAttentionRuns: ImportGovernanceRun[];
}

function statusBadge(status: string) {
  if (status === "COMMITTED") {
    return <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">Committed</Badge>;
  }
  if (status === "FAILED") {
    return <Badge className="border-red-200 bg-red-50 text-red-700">Failed</Badge>;
  }
  if (status === "ROLLED_BACK") {
    return <Badge className="border-amber-200 bg-amber-50 text-amber-700">Rolled Back</Badge>;
  }
  return <Badge variant="outline">{status.replace(/_/g, " ")}</Badge>;
}

export function ImportGovernancePanel({
  data,
  isLoading,
  error,
  onRetry,
  compact = false,
}: {
  data?: ImportGovernanceData;
  isLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const summary = data?.summary;
  const attentionRuns = data?.recentAttentionRuns || [];

  return (
    <Card data-testid="card-import-governance">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-blue-600" />
              Import Governance
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Review backlog, Excel confirmations, and unresolved import exceptions.
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link href="/admin/import-control-tower">
              Import Control Tower
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <AdminQueryState
          isLoading={isLoading}
          error={error}
          onRetry={onRetry}
          empty={!summary}
          emptyTitle="Import governance data is not available yet."
          emptyDescription="Run a Smart Import or open Import Control Tower to establish import history."
          loadingLabel="Loading import governance..."
        >
          {summary ? (
            <>
              <div className={`grid gap-3 ${compact ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-2 xl:grid-cols-5"}`}>
                <div className="rounded-xl border border-border/70 bg-muted/25 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Review Backlog</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">{summary.reviewBacklog}</p>
                  <p className="text-xs text-muted-foreground">Preview and awaiting-review runs</p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-amber-700">Pending Excel Confirmations</p>
                  <p className="mt-1 text-2xl font-semibold text-amber-800">{summary.pendingExcelConfirmations}</p>
                  <p className="text-xs text-amber-700">Tracker changes still need acknowledgement</p>
                </div>
                <div className="rounded-xl border border-red-200 bg-red-50/70 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-red-700">Open Plan Edit Conflicts</p>
                  <p className="mt-1 text-2xl font-semibold text-red-800">{summary.unresolvedPlanEdits}</p>
                  <p className="text-xs text-red-700">Manual plan edits waiting for reconciliation</p>
                </div>
                <div className="rounded-xl border border-border/70 bg-muted/25 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Committed Runs</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">{summary.committedRuns}</p>
                  <p className="text-xs text-muted-foreground">Successful governed promotions</p>
                </div>
                {!compact ? (
                  <div className="rounded-xl border border-border/70 bg-muted/25 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Failed Runs</p>
                    <p className="mt-1 text-2xl font-semibold text-foreground">{summary.failedRuns}</p>
                    <p className="text-xs text-muted-foreground">
                      Last run {summary.lastRunAt ? new Date(summary.lastRunAt).toLocaleString() : "not recorded"}
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">Recent runs needing attention</p>
                  <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                    <Link href="/admin/excel-updates">Open Excel Updates</Link>
                  </Button>
                </div>

                {attentionRuns.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/25 p-4 text-sm text-muted-foreground">
                    Recent import runs are clear. No unresolved blockers, warnings, or failed commits are waiting for action.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {attentionRuns.slice(0, compact ? 4 : 6).map((run) => (
                      <div
                        key={run.id}
                        className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background/90 p-3 md:flex-row md:items-center md:justify-between"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium text-foreground">{run.projectName}</p>
                            {statusBadge(run.status)}
                            {run.blockerCount > 0 ? (
                              <Badge className="border-red-200 bg-red-50 text-red-700">
                                <ShieldAlert className="mr-1 h-3 w-3" />
                                {run.blockerCount} blocker{run.blockerCount === 1 ? "" : "s"}
                              </Badge>
                            ) : null}
                            {run.warningCount > 0 ? (
                              <Badge className="border-amber-200 bg-amber-50 text-amber-700">
                                <AlertTriangle className="mr-1 h-3 w-3" />
                                {run.warningCount} warning{run.warningCount === 1 ? "" : "s"}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">{run.sourceFileName}</p>
                          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Clock3 className="h-3 w-3" />
                              {run.uploadedAt ? new Date(run.uploadedAt).toLocaleString() : "No timestamp"}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                              {run.recordsSucceeded}/{run.recordsAttempted} records succeeded
                            </span>
                          </div>
                        </div>
                        <Button asChild variant="outline" size="sm" className="gap-1.5">
                          <Link href="/admin/smart-import">Review in Smart Import</Link>
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </AdminQueryState>
      </CardContent>
    </Card>
  );
}
