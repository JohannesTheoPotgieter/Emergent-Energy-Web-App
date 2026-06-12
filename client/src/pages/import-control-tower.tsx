import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  FinancePageHeader,
  StatusBadge,
  FinanceLoading,
  FinanceError,
} from "@/components/finance/template";
import { PageLayout } from "@/components/layout";
import {
  FileSpreadsheet,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Eye,
  Upload,
  Filter,
  ExternalLink,
  Scale,
  Ban,
} from "lucide-react";
import { format } from "date-fns";

interface ImportRun {
  id: number;
  projectName: string;
  projectId: number | null;
  sourceFileName: string;
  status: string;
  uploadedAt: string;
  committedAt: string | null;
  uploadedBy: number | null;
  uploaderName: string | null;
  recordsAttempted: number;
  recordsSucceeded: number;
  recordsFailed: number;
  importType: string;
  sections: string[];
  totalIssues: number;
  unresolvedBlockers: number;
  unresolvedWarnings: number;
  resolvedIssues: number;
  // Operator-friendly error envelope from scheduled-import-v2 or the
  // manual /api/smart-import/upload route. Null on success or when the
  // run pre-dates the failure-envelope persistence.
  errorMessage: string | null;
  errorStep: "upload" | "download" | "preview" | "planner" | "auto_commit" | "commit" | null;
  errorAt: string | null;
  // Folder-pickup batch id (one per scheduler tick) so the Tower can
  // group all files from the same pickup behind a single
  // ?batchRunId=… URL and the smart-import wizard can show a "Back to
  // batch" link from a single file detail.
  batchRunId: string | null;
  /** "scheduler" = folder pickup, "manual" = single-file upload. */
  source: "scheduler" | "manual";
  // Set when the scheduler quarantined this file during ingest hygiene — a
  // conflicted-copy / older-revision duplicate parked as awaiting_review and
  // never auto-committed. Null for normal runs.
  quarantineReason: string | null;
  quarantineKind: "conflicted_copy" | "older_revision" | null;
  // Why the scheduler PARKED this run instead of auto-committing (tightened
  // "clean" gate): e.g. "locked period 2026-03-01", "over-wipe: 92% …". Null
  // when the run did not park on the gate.
  autoCommitGateReason: string | null;
}

// Post-commit reconciliation preview (rolled-back dry-run) for a parked run.
interface ReconPreviewLine {
  lineId: number;
  categoryName: string | null;
  description: string | null;
  invoiceNumber: string | null;
  revenueDerived: number;
  revenueStored: number | null;
  reconDelta: number | null;
  derivationWarning: string | null;
  offending: boolean;
}
interface ReconPreviewResponse {
  runId: number;
  projectId: number | null;
  note: string | null;
  importQuality: {
    colourReadDates: number;
    defaultedDates: number;
    paymentDerivedInvoiceDates: number;
    categoriesMissingAllocation: number;
  };
  recon: {
    status: "green" | "amber" | "red";
    appTotal: number;
    trackerTotal: number;
    appVsTrackerDelta: number;
    accumulatedAbsDelta: number;
    reason: string;
    lines: ReconPreviewLine[];
  } | null;
}

interface ImportIssue {
  id: number;
  severity: string;
  section: string;
  message: string;
  suggestedAction: string | null;
  issueType: string | null;
  resolved: boolean;
  resolution: string | null;
  resolutionNote: string | null;
  autoResolved: boolean;
  resolvedAt: string | null;
  payloadJson: any;
}

interface RunErrors {
  runId: number;
  projectName: string;
  sourceFileName: string;
  status: string;
  issues: ImportIssue[];
}

function statusBadge(status: string) {
  switch (status) {
    case "COMMITTED":
      return <StatusBadge data-testid="status-committed" tone="positive" icon={CheckCircle2} label="Committed" />;
    case "PREVIEW":
      return <StatusBadge data-testid="status-preview" tone="info" icon={Clock} label="Preview" />;
    case "FAILED":
      return <StatusBadge data-testid="status-failed" tone="critical" icon={XCircle} label="Failed" />;
    case "ROLLED_BACK":
      return <StatusBadge data-testid="status-rolled-back" tone="warning" icon={RotateCcw} label="Rolled Back" />;
    case "SUPERSEDED":
      return <StatusBadge data-testid="status-superseded" tone="neutral" label="Superseded" />;
    default:
      return <StatusBadge data-testid="status-unknown" tone="neutral" label={status} />;
  }
}

function severityBadge(severity: string) {
  switch (severity) {
    case "BLOCKER":
      return <StatusBadge data-testid="severity-blocker" tone="critical" label="Blocker" />;
    case "WARNING":
      return <StatusBadge data-testid="severity-warning" tone="warning" label="Warning" />;
    case "INFO":
      return <StatusBadge data-testid="severity-info" tone="info" label="Info" />;
    default:
      return <StatusBadge tone="neutral" label={severity} />;
  }
}

function sectionBadge(section: string) {
  const colors: Record<string, string> = {
    PLAN: "bg-indigo-100 text-indigo-800",
    REVENUE: "bg-green-100 text-green-800",
    EXPENDITURE: "bg-amber-100 text-amber-800",
    CASHFLOW: "bg-cyan-100 text-cyan-800",
    GENERAL: "bg-gray-100 text-gray-700",
  };
  return <Badge data-testid={`section-${section.toLowerCase()}`} className={colors[section] || "bg-gray-100 text-gray-700"}>{section}</Badge>;
}

function reconStatusBadge(status: "green" | "amber" | "red") {
  if (status === "red") return <StatusBadge data-testid="recon-status-red" tone="critical" label="Red" />;
  if (status === "amber") return <StatusBadge data-testid="recon-status-amber" tone="warning" label="Amber" />;
  return <StatusBadge data-testid="recon-status-green" tone="positive" label="Green" />;
}

export default function ImportControlTowerPage() {
  const { toast } = useToast();
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [expandedRun, setExpandedRun] = useState<number | null>(null);
  // Parked-run review: reconciliation-preview dialog + reject dialog.
  const [previewRunId, setPreviewRunId] = useState<number | null>(null);
  const [rejectRunId, setRejectRunId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // `?batchRunId=…` filters the tower to a single folder-pickup batch —
  // the "folder import completion screen". The smart-import wizard, the
  // toast that fires after a manual pickup, and the link in the
  // expanded-row "Back to batch" affordance all route here.
  const batchRunIdFromUrl = (() => {
    if (typeof window === "undefined") return null;
    const v = new URLSearchParams(window.location.search).get("batchRunId");
    return v && v.trim().length > 0 ? v : null;
  })();

  const { data: runs = [], isLoading, isError, error, refetch } = useQuery<ImportRun[]>({
    queryKey: ["/api/import-control-tower/history", typeFilter, statusFilter, batchRunIdFromUrl],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("importType", typeFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (batchRunIdFromUrl) params.set("batchRunId", batchRunIdFromUrl);
      const res = await fetch(`/api/import-control-tower/history?${params.toString()}`, { headers, credentials: "include" });
      if (!res.ok) throw new Error("Failed to load import history");
      return res.json();
    },
  });

  const { data: runErrors, isLoading: errorsLoading } = useQuery<RunErrors>({
    queryKey: ["/api/import-control-tower/run", selectedRunId, "errors"],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/import-control-tower/run/${selectedRunId}/errors`, { headers, credentials: "include" });
      if (!res.ok) throw new Error("Failed to load errors");
      return res.json();
    },
    enabled: !!selectedRunId,
  });

  const retryMutation = useMutation({
    mutationFn: async (runId: number) => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/import-control-tower/retry/${runId}`, { method: "POST", headers, credentials: "include" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Retry failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Import reset to Preview", description: "The import run has been reset and can now be re-committed." });
      queryClient.invalidateQueries({ queryKey: ["/api/import-control-tower/history"] });
    },
    onError: (err: Error) => {
      toast({ title: "Retry Failed", description: err.message, variant: "destructive" });
    },
  });

  // Post-commit reconciliation preview for the run open in the preview dialog.
  const { data: reconPreview, isLoading: previewLoading } = useQuery<ReconPreviewResponse>({
    queryKey: ["/api/smart-import/reconciliation-preview", previewRunId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/smart-import/${previewRunId}/reconciliation-preview`, { headers, credentials: "include" });
      if (!res.ok) throw new Error("Failed to load reconciliation preview");
      return res.json();
    },
    enabled: !!previewRunId,
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ runId, reason }: { runId: number; reason: string }) => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/smart-import/${runId}/reject`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || "Reject failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Import rejected", description: "The parked run was dismissed. The source file and all figures are untouched." });
      setRejectRunId(null);
      setRejectReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/import-control-tower/history"] });
    },
    onError: (err: Error) => {
      toast({ title: "Reject Failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return <FinanceLoading label="Loading Import Control Tower…" />;
  if (isError) return <div className="p-4 md:p-6"><FinanceError title="Unable to load Import Control Tower" hint={error instanceof Error ? error.message : "Failed to fetch data"} onRetry={() => refetch()} /></div>;

  const totalRuns = runs.length;
  const committedRuns = runs.filter(r => r.status === "COMMITTED").length;
  const failedRuns = runs.filter(r => r.status === "FAILED").length;
  const previewRuns = runs.filter(r => r.status === "PREVIEW").length;
  const totalRecords = runs.reduce((sum, r) => sum + (r.recordsAttempted || 0), 0);
  const succeededRecords = runs.reduce((sum, r) => sum + (r.recordsSucceeded || 0), 0);

  return (
    <PageLayout
      data-testid="import-control-tower-page"
      header={
        <FinancePageHeader
          title={batchRunIdFromUrl ? "Folder Import Batch" : "Import Control Tower"}
          question={
            batchRunIdFromUrl
              ? `Files picked up in batch ${batchRunIdFromUrl}`
              : "Monitor, investigate, and retry all import operations"
          }
          actions={
            <Button
              data-testid="button-refresh"
              variant="outline"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/import-control-tower/history"] })}
            >
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          }
        />
      }
    >
      {batchRunIdFromUrl && (
        <div
          className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"
          data-testid="batch-context-banner"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Viewing one folder-pickup batch</p>
              <p className="text-xs">
                Showing every file picked up by the scheduler in this run.
                Open any file's details — the back-link returns here.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              data-testid="button-clear-batch-filter"
              onClick={() => {
                window.location.href = "/admin/import-control-tower";
              }}
            >
              View all runs →
            </Button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
            <div>
              <span className="text-blue-700">Files</span>
              <div className="text-base font-semibold">{runs.length}</div>
            </div>
            <div>
              <span className="text-blue-700">Committed</span>
              <div className="text-base font-semibold text-emerald-700">
                {runs.filter((r) => r.status === "committed").length}
              </div>
            </div>
            <div>
              <span className="text-blue-700">Pending</span>
              <div className="text-base font-semibold text-blue-700">
                {runs.filter((r) => r.status === "preview" || r.status === "awaiting_review").length}
              </div>
            </div>
            <div>
              <span className="text-blue-700">Failed</span>
              <div className="text-base font-semibold text-red-700">
                {runs.filter((r) => r.status === "failed").length}
              </div>
            </div>
            <div>
              <span className="text-blue-700">Skipped</span>
              <div className="text-base font-semibold">
                {runs.filter((r) => r.status === "skipped" || r.status === "superseded").length}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Compact summary strip — same five metrics, one slim row instead of
          five large cards. */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span><span className="text-base font-bold tabular-nums" data-testid="text-total-runs">{totalRuns}</span> <span className="text-muted-foreground">Total</span></span>
            <span><span className="text-base font-bold tabular-nums text-emerald-600" data-testid="text-committed-runs">{committedRuns}</span> <span className="text-muted-foreground">Committed</span></span>
            <span><span className="text-base font-bold tabular-nums text-red-600" data-testid="text-failed-runs">{failedRuns}</span> <span className="text-muted-foreground">Failed</span></span>
            <span><span className="text-base font-bold tabular-nums text-blue-600" data-testid="text-preview-runs">{previewRuns}</span> <span className="text-muted-foreground">Pending</span></span>
            <span className="ml-auto"><span className="text-base font-bold tabular-nums" data-testid="text-success-rate">{totalRecords > 0 ? Math.round((succeededRecords / totalRecords) * 100) : 0}%</span> <span className="text-muted-foreground">Success rate</span></span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" /> Import History
            </CardTitle>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-[140px] h-8" data-testid="select-type-filter">
                    <SelectValue placeholder="Import Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="plan">Plan</SelectItem>
                    <SelectItem value="cost">Cost</SelectItem>
                    <SelectItem value="revenue">Revenue</SelectItem>
                    <SelectItem value="project">Project</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px] h-8" data-testid="select-status-filter">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="COMMITTED">Committed</SelectItem>
                  <SelectItem value="PREVIEW">Preview</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                  <SelectItem value="ROLLED_BACK">Rolled Back</SelectItem>
                  <SelectItem value="SUPERSEDED">Superseded</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading import history...</div>
          ) : runs.length === 0 ? (
            <div className="text-center py-12">
              <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No import runs found</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Run ID</TableHead>
                    <TableHead>File Name</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Uploaded By</TableHead>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Records</TableHead>
                    <TableHead className="text-center">Issues</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <>
                      <TableRow
                        key={run.id}
                        className="cursor-pointer hover:bg-muted/50"
                        data-testid={`row-import-${run.id}`}
                        onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                      >
                        <TableCell className="w-8">
                          {expandedRun === run.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </TableCell>
                        <TableCell className="font-mono text-xs" data-testid={`text-run-id-${run.id}`}>#{run.id}</TableCell>
                        <TableCell className="max-w-[200px] truncate text-sm" title={run.sourceFileName} data-testid={`text-file-name-${run.id}`}>
                          {run.sourceFileName}
                        </TableCell>
                        <TableCell className="text-sm font-medium" data-testid={`text-project-${run.id}`}>{run.projectName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground" data-testid={`text-uploader-${run.id}`}>
                          {run.uploaderName || "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground" data-testid={`text-timestamp-${run.id}`}>
                          {run.uploadedAt ? format(new Date(run.uploadedAt), "dd MMM yyyy HH:mm") : "—"}
                        </TableCell>
                        <TableCell>
                          {(run.errorMessage || run.quarantineReason) ? (
                            <span
                              title={run.errorMessage ?? run.quarantineReason ?? undefined}
                              data-testid={`status-with-error-${run.id}`}
                            >
                              {statusBadge(run.status)}
                            </span>
                          ) : (
                            statusBadge(run.status)
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="text-xs tabular-nums">
                            <span data-testid={`text-records-attempted-${run.id}`}>{run.recordsAttempted}</span>
                            {(run.recordsSucceeded > 0 || run.recordsFailed > 0) && (
                              <span className="text-muted-foreground">
                                {" ("}
                                {run.recordsSucceeded > 0 && (
                                  <span className="text-emerald-600" data-testid={`text-records-succeeded-${run.id}`}>{run.recordsSucceeded} ok</span>
                                )}
                                {run.recordsSucceeded > 0 && run.recordsFailed > 0 && " · "}
                                {run.recordsFailed > 0 && (
                                  <span className="text-red-600" data-testid={`text-records-failed-${run.id}`}>{run.recordsFailed} failed</span>
                                )}
                                {")"}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          {run.totalIssues > 0 ? (
                            <div className="text-xs tabular-nums flex items-center justify-center gap-2">
                              {run.unresolvedBlockers > 0 && (
                                <span className="text-red-600 inline-flex items-center gap-0.5">
                                  <AlertTriangle className="h-3 w-3" />{run.unresolvedBlockers}
                                </span>
                              )}
                              {run.unresolvedWarnings > 0 && (
                                <span className="text-yellow-600">{run.unresolvedWarnings} warn</span>
                              )}
                              {run.resolvedIssues > 0 && (
                                <span className="text-emerald-600">{run.resolvedIssues} ok</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                            <Button
                              data-testid={`button-view-errors-${run.id}`}
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedRunId(run.id)}
                              disabled={run.totalIssues === 0}
                              title="View issues"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              data-testid={`button-open-wizard-${run.id}`}
                              variant="ghost"
                              size="sm"
                              title="Open in Smart Import wizard"
                              onClick={() => {
                                // Preserve the batch context so the wizard
                                // can show "Back to folder import results".
                                const carryBatch = run.batchRunId ?? batchRunIdFromUrl;
                                const qs = new URLSearchParams();
                                qs.set("runId", String(run.id));
                                if (carryBatch) qs.set("batchRunId", carryBatch);
                                window.location.href = `/admin/smart-import?${qs.toString()}`;
                              }}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                            {(run.status === "FAILED" || run.status === "ROLLED_BACK") && (
                              <Button
                                data-testid={`button-retry-${run.id}`}
                                variant="ghost"
                                size="sm"
                                onClick={() => retryMutation.mutate(run.id)}
                                disabled={retryMutation.isPending}
                                title="Retry import"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {(run.status === "awaiting_review" || run.status === "preview") && (
                              <>
                                <Button
                                  data-testid={`button-preview-recon-${run.id}`}
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setPreviewRunId(run.id)}
                                  title="Preview reconciliation (post-commit dry-run)"
                                >
                                  <Scale className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  data-testid={`button-reject-${run.id}`}
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => { setRejectRunId(run.id); setRejectReason(""); }}
                                  title="Reject this parked run (file untouched)"
                                >
                                  <Ban className="h-3.5 w-3.5 text-red-600" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {expandedRun === run.id && (
                        <TableRow key={`${run.id}-detail`}>
                          <TableCell colSpan={10} className="bg-muted/30 p-4">
                            {run.errorMessage && (
                              <div
                                className="mb-4 rounded-md border border-red-200 bg-red-50 p-3"
                                data-testid={`text-error-message-${run.id}`}
                              >
                                <div className="flex items-start gap-2">
                                  <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-red-700" />
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
                                      {run.errorStep === "upload" && "Could not accept the upload"}
                                      {run.errorStep === "download" && "Could not download from SharePoint"}
                                      {run.errorStep === "preview" && "Could not parse the workbook"}
                                      {run.errorStep === "planner" && "Could not plan the import"}
                                      {run.errorStep === "auto_commit" && "Auto-commit failed"}
                                      {run.errorStep === "commit" && "Commit failed"}
                                      {!run.errorStep && "Import failure"}
                                    </p>
                                    <p className="mt-1 text-sm text-red-900">{run.errorMessage}</p>
                                    {run.errorAt && (
                                      <p className="mt-1 text-[11px] text-red-700">
                                        {format(new Date(run.errorAt), "dd MMM yyyy HH:mm")}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                            {run.quarantineReason && (
                              <div
                                className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3"
                                data-testid={`text-quarantine-message-${run.id}`}
                              >
                                <div className="flex items-start gap-2">
                                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-700" />
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                                      {run.quarantineKind === "conflicted_copy" && "Quarantined — conflicted / duplicate copy"}
                                      {run.quarantineKind === "older_revision" && "Quarantined — older revision"}
                                      {!run.quarantineKind && "Quarantined — duplicate"}
                                    </p>
                                    <p className="mt-1 text-sm text-amber-900">{run.quarantineReason}</p>
                                    <p className="mt-1 text-[11px] text-amber-700">
                                      Parked for review — not auto-committed, so it cannot double-count a project.
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )}
                            {run.autoCommitGateReason && !run.quarantineReason && (
                              <div
                                className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3"
                                data-testid={`text-park-reason-${run.id}`}
                              >
                                <div className="flex items-start gap-2">
                                  <Clock className="h-4 w-4 mt-0.5 shrink-0 text-blue-700" />
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                                      Parked for review — not auto-committed
                                    </p>
                                    <p className="mt-1 text-sm text-blue-900">{run.autoCommitGateReason}</p>
                                    <p className="mt-1 text-[11px] text-blue-700">
                                      Review the reconciliation preview, then commit deliberately (lock-aware) or reject.
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <span className="text-muted-foreground">Source:</span>
                                <div className="mt-1" data-testid={`text-source-${run.id}`}>
                                  {run.source === "scheduler" ? "Folder pickup (scheduled)" : "Manual upload"}
                                </div>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Sections:</span>
                                <div className="flex gap-1 mt-1 flex-wrap">
                                  {run.sections.length > 0 ? run.sections.map(s => (
                                    <span key={s}>{sectionBadge(s)}</span>
                                  )) : <span className="text-muted-foreground text-xs">None detected</span>}
                                </div>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Committed:</span>
                                <div className="mt-1">{run.committedAt ? format(new Date(run.committedAt), "dd MMM yyyy HH:mm") : "Not yet"}</div>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Project ID:</span>
                                <div className="mt-1">{run.projectId ?? "Unlinked"}</div>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Import Type:</span>
                                <div className="mt-1">{run.importType || "—"}</div>
                              </div>
                              {run.batchRunId && (
                                <div>
                                  <span className="text-muted-foreground">Batch:</span>
                                  <div className="mt-1">
                                    {batchRunIdFromUrl === run.batchRunId ? (
                                      <span className="text-xs text-muted-foreground" data-testid={`text-batch-current-${run.id}`}>
                                        Viewing this batch
                                      </span>
                                    ) : (
                                      <a
                                        href={`/admin/import-control-tower?batchRunId=${encodeURIComponent(run.batchRunId)}`}
                                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                                        data-testid={`link-back-to-batch-${run.id}`}
                                      >
                                        ← Open batch
                                      </a>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedRunId} onOpenChange={() => setSelectedRunId(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Import Errors — Run #{selectedRunId}
            </DialogTitle>
          </DialogHeader>
          {errorsLoading ? (
            <div className="py-8 text-center text-muted-foreground">Loading errors...</div>
          ) : runErrors ? (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-medium">{runErrors.projectName}</span>
                <span className="text-muted-foreground">{runErrors.sourceFileName}</span>
                {statusBadge(runErrors.status)}
              </div>
              <Separator />
              {runErrors.issues.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">No issues found for this import run.</div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Severity</TableHead>
                        <TableHead>Section</TableHead>
                        <TableHead>Message</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Resolution</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runErrors.issues.map((issue) => (
                        <TableRow key={issue.id} data-testid={`row-issue-${issue.id}`}>
                          <TableCell>{severityBadge(issue.severity)}</TableCell>
                          <TableCell>{sectionBadge(issue.section)}</TableCell>
                          <TableCell className="text-sm max-w-[300px]">
                            <div>{issue.message}</div>
                            {issue.suggestedAction && (
                              <div className="text-xs text-muted-foreground mt-1">💡 {issue.suggestedAction}</div>
                            )}
                          </TableCell>
                          <TableCell>
                            {issue.resolved ? (
                              <Badge className="bg-emerald-100 text-emerald-800">
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Resolved
                              </Badge>
                            ) : (
                              <Badge className="bg-red-100 text-red-800">
                                <XCircle className="h-3 w-3 mr-1" /> Open
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {issue.resolution || "—"}
                            {issue.autoResolved && <span className="ml-1">(auto)</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Reconciliation preview — the post-commit dry-run for a parked run. */}
      <Dialog open={!!previewRunId} onOpenChange={() => setPreviewRunId(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              Reconciliation preview — Run #{previewRunId}
            </DialogTitle>
          </DialogHeader>
          {previewLoading ? (
            <div className="py-8 text-center text-muted-foreground">Computing post-commit reconciliation…</div>
          ) : reconPreview ? (
            <div className="space-y-4" data-testid="recon-preview-body">
              <p className="text-xs text-muted-foreground">
                What this project's reconciliation would be after committing this file — computed by a dry-run that is rolled back, so nothing is saved.
              </p>
              {reconPreview.recon ? (
                <>
                  <div className="flex items-center gap-3">
                    {reconStatusBadge(reconPreview.recon.status)}
                    <span className="text-sm text-muted-foreground">{reconPreview.recon.reason}</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div><span className="text-muted-foreground">App (§3.3):</span><div className="tabular-nums">R {reconPreview.recon.appTotal.toLocaleString()}</div></div>
                    <div><span className="text-muted-foreground">Tracker (col-U):</span><div className="tabular-nums">R {reconPreview.recon.trackerTotal.toLocaleString()}</div></div>
                    <div><span className="text-muted-foreground">App − tracker:</span><div className="tabular-nums">R {reconPreview.recon.appVsTrackerDelta.toLocaleString()}</div></div>
                    <div><span className="text-muted-foreground">Σ |drift|:</span><div className="tabular-nums">R {reconPreview.recon.accumulatedAbsDelta.toLocaleString()}</div></div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-muted-foreground">
                    <div>Colour-read dates: <span className="font-medium text-foreground">{reconPreview.importQuality.colourReadDates}</span></div>
                    <div>Defaulted dates: <span className="font-medium text-foreground">{reconPreview.importQuality.defaultedDates}</span></div>
                    <div>Payment-derived inv. dates: <span className="font-medium text-foreground">{reconPreview.importQuality.paymentDerivedInvoiceDates}</span></div>
                    <div>Categories missing alloc.: <span className="font-medium text-foreground">{reconPreview.importQuality.categoriesMissingAllocation}</span></div>
                  </div>
                  <Separator />
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Category</TableHead>
                          <TableHead>Invoice</TableHead>
                          <TableHead className="text-right">Derived (Q/X)×J</TableHead>
                          <TableHead className="text-right">Stored col-U</TableHead>
                          <TableHead className="text-right">Δ</TableHead>
                          <TableHead>V-check</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reconPreview.recon.lines.slice(0, 100).map((l) => (
                          <TableRow key={l.lineId} data-testid={`recon-preview-line-${l.lineId}`} className={l.offending ? "bg-red-50" : undefined}>
                            <TableCell className="text-sm max-w-[200px] truncate" title={l.description ?? undefined}>{l.categoryName || "—"}</TableCell>
                            <TableCell className="text-xs">{l.invoiceNumber || "—"}</TableCell>
                            <TableCell className="text-right tabular-nums text-sm">{l.revenueDerived.toLocaleString()}</TableCell>
                            <TableCell className="text-right tabular-nums text-sm">{l.revenueStored != null ? l.revenueStored.toLocaleString() : "—"}</TableCell>
                            <TableCell className="text-right tabular-nums text-sm">{l.reconDelta != null ? l.reconDelta.toLocaleString() : "—"}</TableCell>
                            <TableCell>{l.derivationWarning ? <Badge className="bg-red-100 text-red-800">{l.derivationWarning}</Badge> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              ) : (
                <div className="py-6 text-center text-sm text-muted-foreground" data-testid="recon-preview-note">{reconPreview.note || "No reconciliation preview available."}</div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">No preview.</div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject — dismiss a parked run; file + figures untouched, audited. */}
      <Dialog open={!!rejectRunId} onOpenChange={(open) => { if (!open) { setRejectRunId(null); setRejectReason(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-red-600" />
              Reject import — Run #{rejectRunId}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Dismiss this parked run. The source file in SharePoint and every reported figure stay untouched; the run is recorded as rejected with your reason (audited).
            </p>
            <textarea
              data-testid="input-reject-reason"
              className="w-full min-h-[90px] rounded-md border border-input bg-background p-2 text-sm"
              placeholder="Why is this import being rejected? (required)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" data-testid="button-cancel-reject" onClick={() => { setRejectRunId(null); setRejectReason(""); }}>Cancel</Button>
              <Button
                variant="destructive"
                size="sm"
                data-testid="button-confirm-reject"
                disabled={!rejectReason.trim() || rejectMutation.isPending}
                onClick={() => rejectRunId && rejectMutation.mutate({ runId: rejectRunId, reason: rejectReason.trim() })}
              >
                {rejectMutation.isPending ? "Rejecting…" : "Reject import"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
