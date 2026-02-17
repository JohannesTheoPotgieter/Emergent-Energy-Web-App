import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Loader2, ChevronDown, ChevronRight, AlertTriangle, History,
} from "lucide-react";

interface LeaveRun {
  id: number;
  triggerType: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  triggeredBy: string | null;
  summary: Record<string, any> | null;
}

interface LeaveLedgerEntry {
  id: number;
  runId: number;
  employeeName: string | null;
  leaveType: string | null;
  status: string;
  message: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-100 text-blue-700 border-blue-200",
  success: "bg-green-100 text-green-700 border-green-200",
  partial: "bg-yellow-100 text-yellow-700 border-yellow-200",
  fail: "bg-red-100 text-red-700 border-red-200",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] || "bg-gray-100 text-gray-700 border-gray-200";
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
  const { data, isLoading } = useQuery<{ run: LeaveRun; ledgerEntries: LeaveLedgerEntry[] }>({
    queryKey: [`/api/admin/leave/runs/${runId}`],
    queryFn: async () => {
      const res = await fetch(`/api/admin/leave/runs/${runId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load run details");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={8}>
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
        <TableCell colSpan={8}>
          <div className="py-4 text-center text-muted-foreground text-sm">
            No ledger entries for this run.
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell colSpan={8}>
        <div className="p-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Leave Type</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id} data-testid={`row-ledger-${entry.id}`}>
                  <TableCell className="text-sm">{entry.employeeName || "—"}</TableCell>
                  <TableCell className="text-sm">{entry.leaveType || "—"}</TableCell>
                  <TableCell className="text-sm">
                    {entry.startDate ? new Date(entry.startDate).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {entry.endDate ? new Date(entry.endDate).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={entry.status} />
                  </TableCell>
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

export default function LeaveAdminRunsPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);

  const { data: runs = [], isLoading } = useQuery<LeaveRun[]>({
    queryKey: ["/api/leave/runs"],
    queryFn: async () => {
      const res = await fetch("/api/leave/runs", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load runs");
      return res.json();
    },
  });

  const sortedRuns = [...runs].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );

  const toggleExpand = (runId: number) => {
    setExpandedRunId((prev) => (prev === runId ? null : runId));
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-access-denied">Access Denied</h2>
            <p className="text-muted-foreground">You do not have admin privileges to access this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50 flex items-center gap-2" data-testid="text-page-title">
            <History className="h-7 w-7 text-blue-600" />
            Leave Sync Runs
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            View leave sync run history and drill into individual run details
          </p>
        </div>

        <Card data-testid="card-leave-runs">
          <CardHeader>
            <CardTitle className="text-base">Run History</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground" data-testid="loading-spinner">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading sync runs...
              </div>
            ) : sortedRuns.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground" data-testid="text-empty-state">
                No sync runs found. Trigger a sync from the Actions page.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Trigger Type</TableHead>
                    <TableHead>Started At</TableHead>
                    <TableHead>Finished At</TableHead>
                    <TableHead>Status</TableHead>
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
                        <TableCell className="text-sm" data-testid={`text-started-${run.id}`}>
                          {new Date(run.startedAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-sm" data-testid={`text-finished-${run.id}`}>
                          {run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={run.status} />
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
