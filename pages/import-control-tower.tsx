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
      return <Badge data-testid="status-committed" className="bg-emerald-100 text-emerald-800"><CheckCircle2 className="h-3 w-3 mr-1" /> Committed</Badge>;
    case "PREVIEW":
      return <Badge data-testid="status-preview" className="bg-blue-100 text-blue-800"><Clock className="h-3 w-3 mr-1" /> Preview</Badge>;
    case "FAILED":
      return <Badge data-testid="status-failed" className="bg-red-100 text-red-800"><XCircle className="h-3 w-3 mr-1" /> Failed</Badge>;
    case "ROLLED_BACK":
      return <Badge data-testid="status-rolled-back" className="bg-orange-100 text-orange-800"><RotateCcw className="h-3 w-3 mr-1" /> Rolled Back</Badge>;
    case "SUPERSEDED":
      return <Badge data-testid="status-superseded" className="bg-gray-100 text-gray-600">Superseded</Badge>;
    default:
      return <Badge data-testid="status-unknown" variant="outline">{status}</Badge>;
  }
}

function severityBadge(severity: string) {
  switch (severity) {
    case "BLOCKER":
      return <Badge data-testid="severity-blocker" className="bg-red-100 text-red-800">Blocker</Badge>;
    case "WARNING":
      return <Badge data-testid="severity-warning" className="bg-yellow-100 text-yellow-800">Warning</Badge>;
    case "INFO":
      return <Badge data-testid="severity-info" className="bg-blue-100 text-blue-800">Info</Badge>;
    default:
      return <Badge variant="outline">{severity}</Badge>;
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

export default function ImportControlTowerPage() {
  const { toast } = useToast();
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [expandedRun, setExpandedRun] = useState<number | null>(null);

  const { data: runs = [], isLoading } = useQuery<ImportRun[]>({
    queryKey: ["/api/import-control-tower/history", typeFilter, statusFilter],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("importType", typeFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
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

  const totalRuns = runs.length;
  const committedRuns = runs.filter(r => r.status === "COMMITTED").length;
  const failedRuns = runs.filter(r => r.status === "FAILED").length;
  const previewRuns = runs.filter(r => r.status === "PREVIEW").length;
  const totalRecords = runs.reduce((sum, r) => sum + (r.recordsAttempted || 0), 0);
  const succeededRecords = runs.reduce((sum, r) => sum + (r.recordsSucceeded || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Import Control Tower</h1>
          <p className="text-sm text-muted-foreground mt-1">Monitor, investigate, and retry all import operations</p>
        </div>
        <Button
          data-testid="button-refresh"
          variant="outline"
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/import-control-tower/history"] })}
        >
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold" data-testid="text-total-runs">{totalRuns}</div>
            <div className="text-xs text-muted-foreground">Total Runs</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-emerald-600" data-testid="text-committed-runs">{committedRuns}</div>
            <div className="text-xs text-muted-foreground">Committed</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-red-600" data-testid="text-failed-runs">{failedRuns}</div>
            <div className="text-xs text-muted-foreground">Failed</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold text-blue-600" data-testid="text-preview-runs">{previewRuns}</div>
            <div className="text-xs text-muted-foreground">Pending</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <div className="text-2xl font-bold" data-testid="text-success-rate">
              {totalRecords > 0 ? Math.round((succeededRecords / totalRecords) * 100) : 0}%
            </div>
            <div className="text-xs text-muted-foreground">Success Rate</div>
          </CardContent>
        </Card>
      </div>

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
                        <TableCell>{statusBadge(run.status)}</TableCell>
                        <TableCell className="text-center">
                          <div className="text-xs space-y-0.5">
                            <div data-testid={`text-records-attempted-${run.id}`}>{run.recordsAttempted} attempted</div>
                            {run.recordsSucceeded > 0 && (
                              <div className="text-emerald-600" data-testid={`text-records-succeeded-${run.id}`}>{run.recordsSucceeded} ok</div>
                            )}
                            {run.recordsFailed > 0 && (
                              <div className="text-red-600" data-testid={`text-records-failed-${run.id}`}>{run.recordsFailed} failed</div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          {run.totalIssues > 0 ? (
                            <div className="text-xs space-y-0.5">
                              {run.unresolvedBlockers > 0 && (
                                <div className="text-red-600 flex items-center justify-center gap-1">
                                  <AlertTriangle className="h-3 w-3" /> {run.unresolvedBlockers}
                                </div>
                              )}
                              {run.unresolvedWarnings > 0 && (
                                <div className="text-yellow-600">{run.unresolvedWarnings} warn</div>
                              )}
                              {run.resolvedIssues > 0 && (
                                <div className="text-emerald-600">{run.resolvedIssues} resolved</div>
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
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            {(run.status === "FAILED" || run.status === "ROLLED_BACK") && (
                              <Button
                                data-testid={`button-retry-${run.id}`}
                                variant="ghost"
                                size="sm"
                                onClick={() => retryMutation.mutate(run.id)}
                                disabled={retryMutation.isPending}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {expandedRun === run.id && (
                        <TableRow key={`${run.id}-detail`}>
                          <TableCell colSpan={10} className="bg-muted/30 p-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
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
    </div>
  );
}
