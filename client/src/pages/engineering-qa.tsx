import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  Beaker,
  CheckCircle2,
  CloudDownload,
  CloudUpload,
  FileWarning,
  Loader2,
  RefreshCw,
  RotateCcw,
  Shuffle,
  Zap,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

async function qaFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options?.headers as Record<string, string> || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export default function EngineeringQA() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedItem, setSelectedItem] = useState<string>("");

  const { data: connectorInfo } = useQuery({
    queryKey: ["/api/sp-sync/qa/connector-info"],
    queryFn: () => qaFetch("/api/sp-sync/qa/connector-info"),
    refetchInterval: 5000,
  });

  const { data: mockItems, isLoading: loadingItems } = useQuery({
    queryKey: ["/api/sp-sync/qa/mock-items"],
    queryFn: () => qaFetch("/api/sp-sync/qa/mock-items"),
  });

  const { data: syncStatus } = useQuery({
    queryKey: ["/api/sp-sync/status"],
    queryFn: () => qaFetch("/api/sp-sync/status"),
  });

  const { data: intakeRequests } = useQuery({
    queryKey: ["/api/sp-sync/requests"],
    queryFn: () => qaFetch("/api/sp-sync/requests"),
  });

  const { data: auditLog } = useQuery({
    queryKey: ["/api/sp-sync/audit-log"],
    queryFn: () => qaFetch("/api/sp-sync/audit-log"),
  });

  const resetMutation = useMutation({
    mutationFn: () => qaFetch("/api/sp-sync/qa/reset", { method: "POST" }),
    onSuccess: (data) => {
      toast({ title: "QA Reset Complete", description: data.message });
      queryClient.invalidateQueries();
    },
    onError: (err: Error) => toast({ title: "Reset Failed", description: err.message, variant: "destructive" }),
  });

  const pullMutation = useMutation({
    mutationFn: () => qaFetch("/api/sp-sync/pull", { method: "POST" }),
    onSuccess: (data) => {
      toast({ title: "Pull Sync Complete", description: `${data.summary?.newRequests || 0} new, ${data.summary?.updatedRequests || 0} updated, ${data.summary?.conflicts || 0} conflicts` });
      queryClient.invalidateQueries();
    },
    onError: (err: Error) => toast({ title: "Pull Failed", description: err.message, variant: "destructive" }),
  });

  const pushMutation = useMutation({
    mutationFn: () => qaFetch("/api/sp-sync/push", { method: "POST" }),
    onSuccess: (data) => {
      toast({ title: "Push Sync Complete", description: `${data.pushed || 0} items pushed` });
      queryClient.invalidateQueries();
    },
    onError: (err: Error) => toast({ title: "Push Failed", description: err.message, variant: "destructive" }),
  });

  const simulateEditMutation = useMutation({
    mutationFn: (params: { mockItemId: string; fieldEdits: Record<string, any> }) =>
      qaFetch("/api/sp-sync/qa/simulate-edit", { method: "POST", body: JSON.stringify(params) }),
    onSuccess: (data) => {
      toast({ title: "Edit Simulated", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/sp-sync/qa/mock-items"] });
    },
    onError: (err: Error) => toast({ title: "Simulate Failed", description: err.message, variant: "destructive" }),
  });

  const simulateConflictMutation = useMutation({
    mutationFn: (mockItemId: string) =>
      qaFetch("/api/sp-sync/qa/simulate-conflict", { method: "POST", body: JSON.stringify({ mockItemId }) }),
    onSuccess: (data) => {
      toast({ title: "Conflict Created", description: data.message });
      queryClient.invalidateQueries();
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const simulateCpSignedMutation = useMutation({
    mutationFn: (mockItemId: string) =>
      qaFetch("/api/sp-sync/qa/simulate-cp-signed", { method: "POST", body: JSON.stringify({ mockItemId }) }),
    onSuccess: (data) => {
      toast({ title: "CP Signed Simulated", description: data.message });
      queryClient.invalidateQueries();
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const isQaMode = connectorInfo?.isQaMode;
  const anyLoading = resetMutation.isPending || pullMutation.isPending || pushMutation.isPending;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="qa-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Beaker className="h-7 w-7 text-purple-500" />
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-qa-title">QA Test Harness</h1>
            <p className="text-sm text-muted-foreground">Test Engineering module with mock SharePoint data</p>
          </div>
        </div>
        <Badge
          variant={isQaMode ? "default" : "secondary"}
          className={isQaMode ? "bg-purple-600" : ""}
          data-testid="badge-connector-status"
        >
          {connectorInfo?.name || "Unknown"} Connector
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card data-testid="card-mock-items">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{mockItems?.length || 0}</div>
            <div className="text-xs text-muted-foreground">Mock SP Items</div>
          </CardContent>
        </Card>
        <Card data-testid="card-intake-requests">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{intakeRequests?.length || 0}</div>
            <div className="text-xs text-muted-foreground">Intake Requests</div>
          </CardContent>
        </Card>
        <Card data-testid="card-conflicts">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{syncStatus?.conflictsCount || 0}</div>
            <div className="text-xs text-muted-foreground">Conflicts</div>
          </CardContent>
        </Card>
        <Card data-testid="card-audit-entries">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{auditLog?.length || 0}</div>
            <div className="text-xs text-muted-foreground">Audit Entries</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardContent className="p-5 space-y-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Zap className="h-4 w-4 text-yellow-500" /> Quick Actions
            </h2>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                <div>
                  <div className="font-medium text-sm">1. Activate QA Mode</div>
                  <div className="text-xs text-muted-foreground">Seed 12 mock items, switch to MockConnector, auto-configure</div>
                </div>
                <Button
                  size="sm"
                  variant="default"
                  className="bg-purple-600 hover:bg-purple-700"
                  onClick={() => resetMutation.mutate()}
                  disabled={anyLoading}
                  data-testid="button-qa-reset"
                >
                  {resetMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  <span className="ml-1">Reset & Seed</span>
                </Button>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                <div>
                  <div className="font-medium text-sm">2. Pull from Mock SP</div>
                  <div className="text-xs text-muted-foreground">Import mock items into intake_requests</div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => pullMutation.mutate()}
                  disabled={anyLoading || !isQaMode}
                  data-testid="button-qa-pull"
                >
                  {pullMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
                  <span className="ml-1">Pull Sync</span>
                </Button>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                <div>
                  <div className="font-medium text-sm">3. Push to Mock SP</div>
                  <div className="text-xs text-muted-foreground">Push local changes back to mock items</div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => pushMutation.mutate()}
                  disabled={anyLoading || !isQaMode}
                  data-testid="button-qa-push"
                >
                  {pushMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                  <span className="ml-1">Push Sync</span>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Shuffle className="h-4 w-4 text-orange-500" /> Scenario Simulation
            </h2>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Select Mock Item</label>
                <Select value={selectedItem} onValueChange={setSelectedItem}>
                  <SelectTrigger data-testid="select-mock-item">
                    <SelectValue placeholder="Choose an item..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(mockItems || []).map((item: any) => (
                      <SelectItem key={item.mockItemId} value={item.mockItemId}>
                        {item.mockItemId} — {(item.fields as any)?.Title || "Untitled"} ({(item.fields as any)?.Request_x0020_Type || "?"})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border bg-orange-50 dark:bg-orange-950/20">
                <div>
                  <div className="font-medium text-sm flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-orange-500" /> Simulate External Edit
                  </div>
                  <div className="text-xs text-muted-foreground">Changes Status + Priority on SP side</div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => selectedItem && simulateEditMutation.mutate({
                    mockItemId: selectedItem,
                    fieldEdits: { Status: "On Hold", Priority: "Urgent", Comments: `[SP] Updated at ${new Date().toLocaleTimeString()}` },
                  })}
                  disabled={!selectedItem || anyLoading}
                  data-testid="button-simulate-edit"
                >
                  <RefreshCw className="h-4 w-4 mr-1" /> Edit
                </Button>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border bg-red-50 dark:bg-red-950/20">
                <div>
                  <div className="font-medium text-sm flex items-center gap-1">
                    <FileWarning className="h-3 w-3 text-red-500" /> Create Conflict
                  </div>
                  <div className="text-xs text-muted-foreground">Edits both SP and local sides → conflict on next pull</div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => selectedItem && simulateConflictMutation.mutate(selectedItem)}
                  disabled={!selectedItem || anyLoading || !intakeRequests?.length}
                  data-testid="button-simulate-conflict"
                >
                  <AlertTriangle className="h-4 w-4 mr-1" /> Conflict
                </Button>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border bg-green-50 dark:bg-green-950/20">
                <div>
                  <div className="font-medium text-sm flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-500" /> CP Signed Gate
                  </div>
                  <div className="text-xs text-muted-foreground">Marks item as "CP Signed" → triggers task generation on pull</div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => selectedItem && simulateCpSignedMutation.mutate(selectedItem)}
                  disabled={!selectedItem || anyLoading}
                  data-testid="button-simulate-cp-signed"
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" /> CP Signed
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Beaker className="h-4 w-4 text-purple-500" /> Mock SharePoint Items
          </h2>
          {loadingItems ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-mock-items">
                <thead>
                  <tr className="border-b text-left">
                    <th className="p-2 font-medium">ID</th>
                    <th className="p-2 font-medium">Client</th>
                    <th className="p-2 font-medium">Type</th>
                    <th className="p-2 font-medium">Status</th>
                    <th className="p-2 font-medium">Priority</th>
                    <th className="p-2 font-medium">kWp</th>
                    <th className="p-2 font-medium">Province</th>
                    <th className="p-2 font-medium">Last Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {(mockItems || []).map((item: any) => {
                    const f = item.fields as Record<string, any>;
                    return (
                      <tr key={item.mockItemId} className="border-b hover:bg-muted/30" data-testid={`row-mock-${item.mockItemId}`}>
                        <td className="p-2 font-mono text-xs">{item.mockItemId}</td>
                        <td className="p-2">{f.Client || f.Title || "—"}</td>
                        <td className="p-2"><Badge variant="outline" className="text-xs">{f.Request_x0020_Type || "—"}</Badge></td>
                        <td className="p-2">
                          <Badge variant={
                            f.Status === "Blocked" ? "destructive" :
                            f.Status === "CP Signed" ? "default" :
                            "secondary"
                          } className="text-xs">{f.Status || "—"}</Badge>
                        </td>
                        <td className="p-2">
                          <Badge variant={
                            f.Priority === "Critical" ? "destructive" :
                            f.Priority === "Urgent" ? "destructive" :
                            f.Priority === "High" ? "default" :
                            "secondary"
                          } className="text-xs">{f.Priority || "—"}</Badge>
                        </td>
                        <td className="p-2">{f.Size_x0020_in_x0020_kWp || "—"}</td>
                        <td className="p-2">{f.Province || "—"}</td>
                        <td className="p-2 text-xs text-muted-foreground">{item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime).toLocaleString() : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {auditLog && auditLog.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h2 className="font-semibold mb-3">Recent Audit Log</h2>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {auditLog.slice(0, 20).map((entry: any, i: number) => (
                <div key={entry.id || i} className="flex items-center gap-3 text-sm p-2 rounded border bg-muted/20" data-testid={`audit-entry-${i}`}>
                  <Badge variant="default" className="text-xs shrink-0">
                    {entry.action}
                  </Badge>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {entry.direction}
                  </Badge>
                  <span className="flex-1 truncate">
                    {typeof entry.summary === "object" ? (entry.summary?.message || JSON.stringify(entry.summary)) : entry.summary}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {entry.createdAt ? new Date(entry.createdAt).toLocaleTimeString() : ""}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
