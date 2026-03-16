import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Play, RotateCcw, ChevronDown, ChevronRight, Loader2, ArrowLeft,
} from "lucide-react";
import { Link } from "wouter";

interface ImportRun {
  id: number;
  triggerType: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  triggeredBy: string | null;
  summary: Record<string, any> | null;
}

interface LedgerEntry {
  id: number;
  runId: number;
  fileName: string;
  projectName: string | null;
  status: string;
  message: string | null;
  recordsProcessed: number | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-100 text-blue-700 border-blue-200",
  success: "bg-green-100 text-green-700 border-green-200",
  partial: "bg-yellow-100 text-yellow-700 border-yellow-200",
  fail: "bg-red-100 text-red-700 border-red-200",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] || "bg-muted text-foreground border-border";
  return (
    <Badge className={cls} variant="outline" data-testid={`badge-status-${status}`}>
      {status}
    </Badge>
  );
}

function SummaryDisplay({ summary }: { summary: Record<string, any> | null }) {
  if (!summary || Object.keys(summary).length === 0) {
    return <span className="text-muted-foreground text-sm">—</span>;
  }
  return (
    <div className="space-y-1 text-sm">
      {Object.entries(summary).map(([key, value]) => (
        <div key={key} className="flex gap-2">
          <span className="text-muted-foreground capitalize">{key.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}:</span>
          <span className="font-medium">
            {typeof value === "object" ? JSON.stringify(value) : String(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ExpandedRunDetail({ runId }: { runId: number }) {
  const { data, isLoading } = useQuery<{ run: ImportRun; ledgerEntries: LedgerEntry[] }>({
    queryKey: [`/api/admin/import/runs/${runId}`],
  });

  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={7}>
          <div className="flex items-center justify-center py-4 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Loading ledger entries...
          </div>
        </TableCell>
      </TableRow>
    );
  }

  const entries = data?.ledgerEntries || [];

  if (entries.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={7}>
          <div className="py-4 text-center text-muted-foreground text-sm">
            No ledger entries for this run.
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell colSpan={7}>
        <div className="p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Records</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id} data-testid={`row-ledger-${entry.id}`}>
                  <TableCell className="font-mono text-xs">{entry.fileName}</TableCell>
                  <TableCell>{entry.projectName || "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={entry.status} />
                  </TableCell>
                  <TableCell>{entry.recordsProcessed ?? "—"}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                    {entry.message || "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {new Date(entry.createdAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </TableCell>
    </TableRow>
  );
}

export default function SpImportRunsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);

  const { data: runs = [], isLoading } = useQuery<ImportRun[]>({
    queryKey: ["/api/admin/import/runs"],
  });

  const sortedRuns = [...runs].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );

  const runImportMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/import/run"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/import/runs"] });
      toast({ title: "Import Started", description: "A new import run has been triggered." });
    },
    onError: (err: Error) => {
      toast({ title: "Import Failed", description: err.message, variant: "destructive" });
    },
  });

  const retryFailedMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/import/retry-failed"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/import/runs"] });
      toast({ title: "Retry Started", description: "Failed imports are being retried." });
    },
    onError: (err: Error) => {
      toast({ title: "Retry Failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleExpand = (runId: number) => {
    setExpandedRunId((prev) => (prev === runId ? null : runId));
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/sp-admin-settings">
              <Button variant="ghost" size="sm" data-testid="button-back-admin">
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">
                SharePoint Import Runs
              </h1>
              <p className="text-sm text-muted-foreground">
                View import run history and trigger new imports
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => runImportMutation.mutate()}
              disabled={runImportMutation.isPending}
              data-testid="button-run-import"
            >
              {runImportMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Run Import Now
            </Button>
            <Button
              variant="outline"
              onClick={() => retryFailedMutation.mutate()}
              disabled={retryFailedMutation.isPending}
              data-testid="button-retry-failed"
            >
              {retryFailedMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-2" />
              )}
              Retry Failed
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Import Run History</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading import runs...
              </div>
            ) : sortedRuns.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground" data-testid="text-empty-state">
                No import runs found. Click "Run Import Now" to trigger an import.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Trigger Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Started At</TableHead>
                    <TableHead>Finished At</TableHead>
                    <TableHead>Triggered By</TableHead>
                    <TableHead>Summary</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRuns.map((run) => (
                    <>
                      <TableRow
                        key={run.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleExpand(run.id)}
                        data-testid={`row-run-${run.id}`}
                      >
                        <TableCell>
                          {expandedRunId === run.id ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm" data-testid={`text-run-id-${run.id}`}>
                          {run.id}
                        </TableCell>
                        <TableCell data-testid={`text-trigger-type-${run.id}`}>
                          <Badge variant="secondary">{run.triggerType}</Badge>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={run.status} />
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`text-started-${run.id}`}>
                          {new Date(run.startedAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`text-finished-${run.id}`}>
                          {run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell data-testid={`text-triggered-by-${run.id}`}>
                          {run.triggeredBy || "—"}
                        </TableCell>
                        <TableCell data-testid={`text-summary-${run.id}`}>
                          <SummaryDisplay summary={run.summary} />
                        </TableCell>
                      </TableRow>
                      {expandedRunId === run.id && (
                        <ExpandedRunDetail key={`detail-${run.id}`} runId={run.id} />
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
