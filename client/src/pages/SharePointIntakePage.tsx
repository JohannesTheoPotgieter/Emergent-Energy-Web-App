import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { engFetch, engPost } from "@/lib/eng-fetch";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  RefreshCw, Loader2, AlertTriangle, CheckCircle, ChevronDown,
  ChevronRight, Activity, CloudDownload,
} from "lucide-react";

// --- Types ---

interface SyncStatus {
  configured: boolean;
  connectorAvailable: boolean;
  connectorName: string;
  lastPulledAt: string | null;
  lastPushedAt: string | null;
  totalRequests: number;
  conflictsCount: number;
  siteName: string | null;
  listName: string | null;
}

interface IntakeRequest {
  id: number;
  spItemId: string;
  clientKey: string;
  clientName: string;
  projectId: number | null;
  requestType: string | null;
  status: string | null;
  priority: string | null;
  syncConflict: boolean;
  conflictFieldsJson: Record<string, { spValue: any; appValue: any }> | null;
  lastSyncedAt: string | null;
  lastPulledAt: string | null;
  updatedAt: string | null;
}

interface AuditLogEntry {
  id: number;
  action: string;
  actorRole: string | null;
  direction: string | null;
  itemCount: number | null;
  newProjectsCount: number | null;
  newRequestsCount: number | null;
  updatedRequestsCount: number | null;
  conflictsCount: number | null;
  errorsCount: number | null;
  createdAt: string;
}

interface PullResult {
  success: boolean;
  totalItems: number;
  newProjects: number;
  newRequests: number;
  updatedRequests: number;
  conflicts: number;
  errors: number;
}

// --- Helpers ---

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "--";
  const d = new Date(dateStr);
  return d.toLocaleString("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function statusVariant(status: string | null): "default" | "success" | "warning" | "destructive" | "secondary" {
  if (!status) return "secondary";
  const s = status.toLowerCase();
  if (s.includes("complete") || s.includes("done")) return "success";
  if (s.includes("progress") || s.includes("active")) return "default";
  if (s.includes("hold") || s.includes("pending") || s.includes("wait")) return "warning";
  if (s.includes("cancel") || s.includes("reject")) return "destructive";
  return "secondary";
}

// --- Component ---

export default function SharePointIntakePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<IntakeRequest | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [auditOpen, setAuditOpen] = useState(false);

  // --- Queries ---

  const statusQuery = useQuery<SyncStatus>({
    queryKey: ["sp-sync-status"],
    queryFn: () => engFetch("/api/sp-sync/status"),
    refetchInterval: 30_000,
  });

  const requestsQuery = useQuery<{ requests: IntakeRequest[] }>({
    queryKey: ["sp-sync-intake-requests"],
    queryFn: () => engFetch("/api/sp-sync/intake-requests"),
  });

  const auditQuery = useQuery<{ logs: AuditLogEntry[] }>({
    queryKey: ["sp-sync-audit-log"],
    queryFn: () => engFetch("/api/sp-sync/audit-log?limit=30"),
    enabled: auditOpen,
  });

  // --- Mutations ---

  const pullMutation = useMutation<PullResult>({
    mutationFn: () => engPost("/api/sp-sync/pull", {}),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["sp-sync-intake-requests"] });
      queryClient.invalidateQueries({ queryKey: ["sp-sync-status"] });
      queryClient.invalidateQueries({ queryKey: ["sp-sync-audit-log"] });
      toast({
        title: "SharePoint Pull Complete",
        description: `${data.totalItems} items processed: ${data.newRequests} new, ${data.updatedRequests} updated, ${data.conflicts} conflicts, ${data.errors} errors.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Pull Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: ({ requestId, resolutions }: { requestId: number; resolutions: Record<string, string> }) =>
      engPost(`/api/sp-sync/resolve-conflict/${requestId}`, { resolutions }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sp-sync-intake-requests"] });
      queryClient.invalidateQueries({ queryKey: ["sp-sync-status"] });
      queryClient.invalidateQueries({ queryKey: ["sp-sync-audit-log"] });
      setConflictDialogOpen(false);
      setSelectedRequest(null);
      setResolutions({});
      toast({ title: "Conflict Resolved", description: "Field resolutions applied successfully." });
    },
    onError: (err: Error) => {
      toast({ title: "Resolution Failed", description: err.message, variant: "destructive" });
    },
  });

  // --- Handlers ---

  function openConflictDialog(req: IntakeRequest) {
    setSelectedRequest(req);
    const initial: Record<string, string> = {};
    if (req.conflictFieldsJson) {
      for (const field of Object.keys(req.conflictFieldsJson)) {
        initial[field] = "keep_sp";
      }
    }
    setResolutions(initial);
    setConflictDialogOpen(true);
  }

  function handleResolve() {
    if (!selectedRequest) return;
    resolveMutation.mutate({ requestId: selectedRequest.id, resolutions });
  }

  // --- Derived ---

  const status = statusQuery.data;
  const requests = requestsQuery.data?.requests ?? [];
  const auditLogs = auditQuery.data?.logs ?? [];

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SharePoint Intake Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage SharePoint sync, review intake requests, and resolve conflicts.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Sync status indicator */}
          {statusQuery.isLoading ? (
            <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Loading</Badge>
          ) : status?.configured && status?.connectorAvailable ? (
            <Badge variant="success">
              <CheckCircle className="h-3 w-3 mr-1" />
              Connected
              {status.conflictsCount > 0 && (
                <span className="ml-1.5 text-amber-600">({status.conflictsCount} conflicts)</span>
              )}
            </Badge>
          ) : (
            <Badge variant="destructive">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {!status?.configured ? "Not Configured" : "Connector Unavailable"}
            </Badge>
          )}

          <Button
            onClick={() => pullMutation.mutate()}
            disabled={pullMutation.isPending}
            size="sm"
          >
            {pullMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <CloudDownload className="h-4 w-4 mr-1.5" />
            )}
            Refresh from SharePoint
          </Button>
        </div>
      </div>

      {/* Status summary cards */}
      {status && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Requests</p>
              <p className="text-2xl font-bold mt-1">{status.totalRequests}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Conflicts</p>
              <p className="text-2xl font-bold mt-1 text-amber-600">{status.conflictsCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Last Pulled</p>
              <p className="text-sm font-medium mt-1">{formatDate(status.lastPulledAt)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Source</p>
              <p className="text-sm font-medium mt-1 truncate">
                {status.siteName && status.listName
                  ? `${status.siteName} / ${status.listName}`
                  : "--"}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Pull result toast shown inline if there was a recent pull */}
      {pullMutation.isSuccess && pullMutation.data && (
        <Card className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20">
          <CardContent className="p-4 flex items-center gap-3 text-sm">
            <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>
              Last pull: <strong>{pullMutation.data.totalItems}</strong> items processed
              &mdash; {pullMutation.data.newRequests} new, {pullMutation.data.updatedRequests} updated,{" "}
              {pullMutation.data.conflicts} conflicts, {pullMutation.data.errors} errors.
            </span>
          </CardContent>
        </Card>
      )}

      {/* Intake requests table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Intake Requests</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => requestsQuery.refetch()}
            disabled={requestsQuery.isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${requestsQuery.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {requestsQuery.isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading requests...
            </div>
          ) : requestsQuery.isError ? (
            <div className="flex items-center justify-center py-12 text-destructive">
              <AlertTriangle className="h-5 w-5 mr-2" />
              Failed to load requests: {(requestsQuery.error as Error).message}
            </div>
          ) : requests.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No intake requests found. Pull from SharePoint to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>SP Item</TableHead>
                  <TableHead>Client / Project Key</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Conflict</TableHead>
                  <TableHead>Last Synced</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((req) => (
                  <TableRow key={req.id}>
                    <TableCell className="font-mono text-xs">{req.id}</TableCell>
                    <TableCell className="font-mono text-xs">{req.spItemId ?? "--"}</TableCell>
                    <TableCell>
                      <div className="font-medium">{req.clientName || req.clientKey}</div>
                      {req.clientName && req.clientKey !== req.clientName && (
                        <div className="text-xs text-muted-foreground">{req.clientKey}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(req.status)}>
                        {req.status || "Unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {req.syncConflict ? (
                        <Badge variant="warning">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          Conflict
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(req.lastPulledAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {req.syncConflict && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openConflictDialog(req)}
                        >
                          Resolve
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Collapsible audit log */}
      <Collapsible open={auditOpen} onOpenChange={setAuditOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <CardTitle>Sync Audit Log</CardTitle>
              </div>
              {auditOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              {auditQuery.isLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Loading audit log...
                </div>
              ) : auditQuery.isError ? (
                <div className="flex items-center justify-center py-8 text-destructive">
                  <AlertTriangle className="h-5 w-5 mr-2" />
                  Failed to load audit log.
                </div>
              ) : auditLogs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No sync operations recorded yet.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Direction</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>New</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead>Conflicts</TableHead>
                      <TableHead>Errors</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(log.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{log.action}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">{log.direction ?? "--"}</TableCell>
                        <TableCell className="text-xs">{log.actorRole ?? "--"}</TableCell>
                        <TableCell className="text-xs font-mono">{log.itemCount ?? 0}</TableCell>
                        <TableCell className="text-xs font-mono">{log.newRequestsCount ?? 0}</TableCell>
                        <TableCell className="text-xs font-mono">{log.updatedRequestsCount ?? 0}</TableCell>
                        <TableCell className="text-xs font-mono">
                          {(log.conflictsCount ?? 0) > 0 ? (
                            <span className="text-amber-600">{log.conflictsCount}</span>
                          ) : (
                            "0"
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {(log.errorsCount ?? 0) > 0 ? (
                            <span className="text-red-600">{log.errorsCount}</span>
                          ) : (
                            "0"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Conflict resolution dialog */}
      <Dialog open={conflictDialogOpen} onOpenChange={setConflictDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Resolve Sync Conflict</DialogTitle>
            <DialogDescription>
              {selectedRequest
                ? `Resolve conflicting fields for "${selectedRequest.clientName || selectedRequest.clientKey}" (ID: ${selectedRequest.id}).`
                : "Select which value to keep for each conflicting field."}
            </DialogDescription>
          </DialogHeader>

          {selectedRequest?.conflictFieldsJson && (
            <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
              {Object.entries(selectedRequest.conflictFieldsJson).map(([field, data]) => (
                <div key={field} className="rounded-lg border border-border p-3 space-y-2">
                  <p className="text-sm font-semibold capitalize">{field.replace(/([A-Z])/g, " $1").trim()}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded bg-blue-50 dark:bg-blue-950/30 p-2">
                      <span className="text-muted-foreground">SharePoint:</span>
                      <p className="font-mono mt-0.5 break-all">{String(data.spValue ?? "--")}</p>
                    </div>
                    <div className="rounded bg-emerald-50 dark:bg-emerald-950/30 p-2">
                      <span className="text-muted-foreground">App:</span>
                      <p className="font-mono mt-0.5 break-all">{String(data.appValue ?? "--")}</p>
                    </div>
                  </div>
                  <RadioGroup
                    value={resolutions[field] ?? "keep_sp"}
                    onValueChange={(val) => setResolutions((prev) => ({ ...prev, [field]: val }))}
                    className="flex gap-4"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="keep_sp" id={`${field}-sp`} />
                      <Label htmlFor={`${field}-sp`} className="text-xs">Keep SharePoint</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="keep_app" id={`${field}-app`} />
                      <Label htmlFor={`${field}-app`} className="text-xs">Keep App</Label>
                    </div>
                  </RadioGroup>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setConflictDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleResolve} disabled={resolveMutation.isPending}>
              {resolveMutation.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Apply Resolutions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
