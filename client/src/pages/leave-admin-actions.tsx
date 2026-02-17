import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Play,
  RotateCcw,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Zap,
  Activity,
} from "lucide-react";

interface LeaveStatus {
  isEnabled: boolean;
  lastSyncAt: string | null;
}

interface LeaveRun {
  id: number;
  triggerType: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  triggeredBy: string | null;
  summary: Record<string, any> | null;
}

const STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-100 text-blue-700 border-blue-200",
  success: "bg-green-100 text-green-700 border-green-200",
  partial: "bg-yellow-100 text-yellow-700 border-yellow-200",
  fail: "bg-red-100 text-red-700 border-red-200",
};

export default function LeaveAdminActionsPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: status, isLoading: statusLoading } = useQuery<LeaveStatus>({
    queryKey: ["/api/leave/status"],
    queryFn: async () => {
      const res = await fetch("/api/leave/status", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load status");
      return res.json();
    },
  });

  const { data: runs = [], isLoading: runsLoading } = useQuery<LeaveRun[]>({
    queryKey: ["/api/leave/runs"],
    queryFn: async () => {
      const res = await fetch("/api/leave/runs", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load runs");
      return res.json();
    },
  });

  const lastRun = runs.length > 0
    ? [...runs].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0]
    : null;

  const syncNowMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/leave/sync-now", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to trigger sync");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leave/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leave/status"] });
      toast({ title: "Sync Started", description: "A leave sync has been triggered." });
    },
    onError: (err: Error) => {
      toast({ title: "Sync Failed", description: err.message, variant: "destructive" });
    },
  });

  const retryFailedMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/leave/retry-failed", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to retry");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leave/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leave/status"] });
      toast({ title: "Retry Started", description: "Failed leave syncs are being retried." });
    },
    onError: (err: Error) => {
      toast({ title: "Retry Failed", description: err.message, variant: "destructive" });
    },
  });

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

  const isLoading = statusLoading || runsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const statusColor = STATUS_COLORS[lastRun?.status || ""] || "bg-gray-100 text-gray-700 border-gray-200";

  return (
    <div className="space-y-6 max-w-[900px] mx-auto" data-testid="leave-admin-actions-page">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50 flex items-center gap-2" data-testid="text-page-title">
          <Zap className="h-7 w-7 text-blue-600" />
          Leave Sync Actions
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Manually trigger leave sync operations and view current status
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card data-testid="card-integration-status">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-600" />
              Integration Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Sync Enabled</span>
              <Badge
                variant={status?.isEnabled ? "default" : "secondary"}
                data-testid="badge-enabled-status"
              >
                {status?.isEnabled ? (
                  <span className="flex items-center gap-1"><CheckCircle className="h-3 w-3" /> Enabled</span>
                ) : (
                  <span className="flex items-center gap-1"><XCircle className="h-3 w-3" /> Disabled</span>
                )}
              </Badge>
            </div>
            {status?.lastSyncAt && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Last Sync</span>
                <span className="text-sm flex items-center gap-1" data-testid="text-last-sync">
                  <Clock className="h-3 w-3" />
                  {new Date(status.lastSyncAt).toLocaleString()}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-last-run">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-600" />
              Last Run
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lastRun ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <Badge className={statusColor} variant="outline" data-testid="badge-last-run-status">
                    {lastRun.status}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Started</span>
                  <span className="text-sm" data-testid="text-last-run-started">
                    {new Date(lastRun.startedAt).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Trigger</span>
                  <Badge variant="secondary" data-testid="badge-last-run-trigger">
                    {lastRun.triggerType}
                  </Badge>
                </div>
                {lastRun.summary && Object.keys(lastRun.summary).length > 0 && (
                  <div className="border-t pt-2 space-y-1">
                    {Object.entries(lastRun.summary).map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground capitalize">
                          {key.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}
                        </span>
                        <span className="font-medium" data-testid={`text-summary-${key}`}>
                          {typeof value === "object" ? JSON.stringify(value) : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="text-no-runs">
                No sync runs recorded yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-actions">
        <CardHeader>
          <CardTitle className="text-base">Manual Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Button
              onClick={() => syncNowMutation.mutate()}
              disabled={syncNowMutation.isPending}
              data-testid="button-sync-now"
            >
              {syncNowMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Sync Now
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
        </CardContent>
      </Card>
    </div>
  );
}
