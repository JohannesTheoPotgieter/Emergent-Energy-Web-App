import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { PageEmpty } from "@/components/ui/page-states";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, CheckCircle2, AlertTriangle, Clock, Loader2, Plug } from "lucide-react";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { apiRequest } from "@/lib/queryClient";

interface SyncLogEntry {
  id: number;
  sync_type: string;
  started_at: string;
  completed_at: string | null;
  deals_processed: number;
  deals_created: number;
  deals_updated: number;
  errors: string | null;
  status: string;
}

interface SyncResult {
  dealsProcessed: number;
  dealsCreated: number;
  dealsUpdated: number;
  errors: string[];
}

function statusBadge(s: string) {
  if (s === "completed") return "bg-green-50 text-green-700";
  if (s === "running") return "bg-blue-50 text-blue-700";
  if (s === "failed") return "bg-red-50 text-red-700";
  return "bg-muted text-muted-foreground";
}

export default function AdminPipedrivePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: status } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/admin/pipedrive/status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/pipedrive/status");
      return res.json();
    },
  });

  const { data: syncLog = [], isLoading, isError, error, refetch } = useQuery<SyncLogEntry[]>({
    queryKey: ["/api/admin/pipedrive/sync-log"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/pipedrive/sync-log");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/pipedrive/sync");
      return res.json() as Promise<SyncResult>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pipedrive/sync-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/opportunities"] });
      toast({
        title: "Sync completed",
        description: `Processed ${result.dealsProcessed} deals: ${result.dealsCreated} created, ${result.dealsUpdated} updated${result.errors.length > 0 ? `, ${result.errors.length} errors` : ""}`,
      });
    },
    onError: (err: Error) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/pipedrive/sync-log"] });
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const lastSync = syncLog[0];
  const isConfigured = status?.configured ?? false;

  if (isLoading) return <PageSkeleton lines={5} />;
  if (isError) return <PageShell className="p-4 md:p-6"><PageError title="Unable to load Pipedrive sync data" message={error instanceof Error ? error.message : "Failed to fetch data"} onRetry={() => refetch()} /></PageShell>;

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-admin-pipedrive">
      <SectionHeader
        icon={<Plug className="h-5 w-5" />}
        eyebrow="Admin"
        title="Pipedrive Integration"
        description="Sync opportunities from Pipedrive CRM into the app"
        actions={
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || !isConfigured}
          >
            {syncMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Sync Now
          </Button>
        }
      />

      {/* Status cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-1">
              {isConfigured ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              )}
              <span className="text-xs text-muted-foreground">API Status</span>
            </div>
            <div className="text-sm font-medium">{isConfigured ? "Connected" : "Not configured"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground mb-1">Last Sync</div>
            <div className="text-sm font-medium">
              {lastSync ? new Date(lastSync.started_at).toLocaleString() : "Never"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground mb-1">Last Result</div>
            <div className="text-sm font-medium">
              {lastSync ? `${lastSync.deals_processed} deals` : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground mb-1">Total Syncs</div>
            <div className="text-sm font-medium">{syncLog.length}</div>
          </CardContent>
        </Card>
      </div>

      {!isConfigured && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800">Pipedrive API not configured</p>
                <p className="text-xs text-amber-700 mt-1">
                  Set the <code className="px-1 py-0.5 bg-amber-100 rounded text-[11px]">PIPEDRIVE_API_TOKEN</code> environment
                  variable to enable deal synchronization.
                </p>
                <p className="text-xs text-amber-700 mt-2 font-medium">Setup steps:</p>
                <ol className="text-xs text-amber-700 mt-1 list-decimal pl-4 space-y-0.5">
                  <li>In Pipedrive, go to Settings &rarr; Personal preferences &rarr; API</li>
                  <li>Copy your personal API token</li>
                  <li>Add <code className="px-1 py-0.5 bg-amber-100 rounded text-[11px]">PIPEDRIVE_API_TOKEN=your-token</code> to your .env file (or Replit Secrets)</li>
                  <li>Restart the server, then return here and click Sync Now</li>
                </ol>
                <p className="text-xs text-amber-600 mt-2">
                  Sync is read-only: deals are imported from Pipedrive into Opportunities. No data is written back to Pipedrive.
                  Clients are auto-created from Pipedrive organizations if they don't already exist.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sync log table */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Sync History</h3>
        {isLoading && <p className="text-sm text-muted-foreground">Loading sync log...</p>}
        {!isLoading && syncLog.length === 0 && (
          <PageEmpty
            icon={RefreshCw}
            title="No sync history"
            description="Run your first sync to see results here."
          />
        )}
        {syncLog.length > 0 && (
          <div className="space-y-2">
            {syncLog.map(entry => (
              <Card key={entry.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-3">
                  <div className="flex items-center gap-3">
                    <Badge className={`text-[10px] ${statusBadge(entry.status)}`}>{entry.status}</Badge>
                    <Badge variant="outline" className="text-[10px]">{entry.sync_type}</Badge>
                    <span className="text-xs text-muted-foreground">
                      <Clock className="h-3 w-3 inline mr-0.5" />
                      {new Date(entry.started_at).toLocaleString()}
                    </span>
                    <span className="flex-1" />
                    <span className="text-xs">
                      {entry.deals_processed} processed
                    </span>
                    {entry.deals_created > 0 && (
                      <Badge variant="secondary" className="text-[10px] text-green-600">+{entry.deals_created} new</Badge>
                    )}
                    {entry.deals_updated > 0 && (
                      <Badge variant="secondary" className="text-[10px] text-blue-600">{entry.deals_updated} updated</Badge>
                    )}
                    {entry.errors && (
                      <Badge variant="destructive" className="text-[10px]">errors</Badge>
                    )}
                  </div>
                  {entry.errors && (
                    <details className="mt-2">
                      <summary className="text-xs text-red-600 cursor-pointer">View errors</summary>
                      <pre className="text-[10px] text-red-700 bg-red-50 p-2 rounded mt-1 overflow-x-auto">
                        {JSON.stringify(JSON.parse(entry.errors), null, 2)}
                      </pre>
                    </details>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
