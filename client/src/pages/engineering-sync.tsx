import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Shield,
  RefreshCw,
  CheckCircle2,
  Loader2,
  CloudDownload,
  CloudUpload,
  AlertTriangle,
  History,
  Plug,
  ArrowRight,
  Zap,
  GitCompareArrows,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  Circle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

async function spFetch(url: string, options?: RequestInit) {
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

function timeAgo(d: string | null) {
  if (!d) return "Never";
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function formatDateTime(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-ZA", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch { return d; }
}

interface SyncStatus {
  configured: boolean;
  connectorAvailable: boolean;
  lastPulledAt: string | null;
  lastPushedAt: string | null;
  totalRequests: number;
  conflictsCount: number;
  siteName: string | null;
  listName: string | null;
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

interface PushResult {
  success: boolean;
  pushed: number;
  errors: number;
}

interface IntakeRequest {
  id: number;
  clientName?: string;
  status?: string;
  syncConflict?: boolean;
  conflictFieldsJson?: Record<string, { app: any; sp: any }> | null;
  [key: string]: any;
}

interface AuditLogEntry {
  id: number;
  action: string;
  detail?: string;
  actorRole?: string;
  createdAt: string;
}

export default function EngineeringSyncPage() {
  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const isCoo = companyRole === "COO_ADMIN";

  if (!isCoo) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground" data-testid="sync-forbidden">
        <Shield className="h-12 w-12 mb-3 opacity-20" />
        <h2 className="text-lg font-semibold">COO Access Required</h2>
        <p className="text-sm mt-1">Only COO administrators can manage SharePoint sync.</p>
      </div>
    );
  }

  return <SyncDashboard />;
}

function SyncDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pullResult, setPullResult] = useState<PullResult | null>(null);
  const [pushResult, setPushResult] = useState<PushResult | null>(null);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [conflictDialog, setConflictDialog] = useState<IntakeRequest | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [setupRunning, setSetupRunning] = useState(false);
  const [setupStep, setSetupStep] = useState("");

  const { data: status, isLoading } = useQuery<SyncStatus>({
    queryKey: ["sp-sync-status"],
    queryFn: () => spFetch("/api/sp-sync/status"),
    refetchInterval: 15000,
  });

  const { data: configData } = useQuery<{ config: any; isConfigured: boolean }>({
    queryKey: ["sp-sync-config"],
    queryFn: () => spFetch("/api/sp-sync/config"),
  });

  const { data: requestsData } = useQuery<{ requests: IntakeRequest[] }>({
    queryKey: ["sp-sync-intake-requests"],
    queryFn: () => spFetch("/api/sp-sync/intake-requests"),
  });

  const { data: auditData } = useQuery<{ logs: AuditLogEntry[] }>({
    queryKey: ["sp-sync-audit-log"],
    queryFn: () => spFetch("/api/sp-sync/audit-log"),
    enabled: showAuditLog,
  });

  const conflictRequests = (requestsData?.requests || []).filter(
    r => r.syncConflict && r.conflictFieldsJson && Object.keys(r.conflictFieldsJson).length > 0
  );

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["sp-sync-status"] });
    queryClient.invalidateQueries({ queryKey: ["sp-sync-intake-requests"] });
    queryClient.invalidateQueries({ queryKey: ["sp-sync-audit-log"] });
    queryClient.invalidateQueries({ queryKey: ["sp-sync-config"] });
  };

  const runOneClickSetup = async () => {
    setSetupRunning(true);
    try {
      setSetupStep("Finding SharePoint site...");
      const siteData = await spFetch("/api/sp-sync/discover/site-by-url?hostAndPath=emergy.sharepoint.com:/sites/EngineeringSupport");
      const site = siteData.site || siteData;
      if (!site?.id) throw new Error("Could not find SharePoint site");

      setSetupStep("Loading lists...");
      const listsData = await spFetch(`/api/sp-sync/discover/lists/${site.id}`);
      const lists = listsData.lists || [];
      const targetList = lists.find((l: any) =>
        l.displayName?.toLowerCase().includes("proposal") ||
        l.displayName?.toLowerCase().includes("pipeline") ||
        l.displayName?.toLowerCase().includes("engineering")
      ) || lists[0];

      if (!targetList) throw new Error("No lists found on site");

      setSetupStep(`Connecting to "${targetList.displayName}"...`);
      await spFetch("/api/sp-sync/config", {
        method: "POST",
        body: JSON.stringify({
          siteId: site.id,
          listId: targetList.id,
          siteName: site.displayName,
          listName: targetList.displayName,
          siteUrl: site.webUrl,
        }),
      });

      setSetupStep("Auto-detecting columns...");
      await spFetch("/api/sp-sync/config/auto-detect", { method: "POST" });

      invalidateAll();
      toast({ title: "Setup complete", description: `Connected to ${targetList.displayName}` });
    } catch (err: any) {
      toast({ title: "Setup failed", description: err.message, variant: "destructive" });
    } finally {
      setSetupRunning(false);
      setSetupStep("");
    }
  };

  const pullMutation = useMutation({
    mutationFn: () => spFetch("/api/sp-sync/pull", { method: "POST" }),
    onSuccess: (data: PullResult) => {
      setPullResult(data);
      setPushResult(null);
      invalidateAll();
      toast({ title: "Pull complete", description: `${data.totalItems} items synced` });
    },
    onError: (e: Error) => toast({ title: "Pull failed", description: e.message, variant: "destructive" }),
  });

  const pushMutation = useMutation({
    mutationFn: () => spFetch("/api/sp-sync/push", { method: "POST" }),
    onSuccess: (data: PushResult) => {
      setPushResult(data);
      setPullResult(null);
      invalidateAll();
      toast({ title: "Push complete", description: `${data.pushed} items pushed` });
    },
    onError: (e: Error) => toast({ title: "Push failed", description: e.message, variant: "destructive" }),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ requestId, resolutions }: { requestId: number; resolutions: Record<string, string> }) =>
      spFetch(`/api/sp-sync/resolve-conflict/${requestId}`, {
        method: "POST",
        body: JSON.stringify({ resolutions }),
      }),
    onSuccess: () => {
      invalidateAll();
      setConflictDialog(null);
      setResolutions({});
      toast({ title: "Conflict resolved" });
    },
    onError: (e: Error) => toast({ title: "Resolve failed", description: e.message, variant: "destructive" }),
  });

  const openConflict = (req: IntakeRequest) => {
    setConflictDialog(req);
    const defaults: Record<string, string> = {};
    if (req.conflictFieldsJson) {
      for (const field of Object.keys(req.conflictFieldsJson)) {
        defaults[field] = "keep_app";
      }
    }
    setResolutions(defaults);
  };

  const syncStatus: SyncStatus = status || {
    configured: false, connectorAvailable: false,
    lastPulledAt: null, lastPushedAt: null,
    totalRequests: 0, conflictsCount: 0,
    siteName: null, listName: null,
  };

  const isConfigured = syncStatus.configured;
  const isSyncing = pullMutation.isPending || pushMutation.isPending;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl" data-testid="sync-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm">
            <RefreshCw className="h-4 w-4 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold" data-testid="text-sync-title">SharePoint Sync</h2>
            <p className="text-xs text-muted-foreground">
              {isConfigured
                ? `${syncStatus.siteName} → ${syncStatus.listName}`
                : "Not connected"}
            </p>
          </div>
        </div>
        {isConfigured && (
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${syncStatus.connectorAvailable ? "bg-emerald-500" : "bg-red-400"}`} />
            <span className="text-[11px] text-muted-foreground">
              {syncStatus.connectorAvailable ? "Connected" : "Offline"}
            </span>
          </div>
        )}
      </div>

      {!isConfigured && (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center">
              <Plug className="h-7 w-7 text-blue-500" />
            </div>
            <div className="text-center">
              <h3 className="font-semibold text-base">Connect SharePoint</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                One click to discover your Engineering Support site, select the proposals list, and auto-map columns.
              </p>
            </div>
            <Button
              size="lg"
              onClick={runOneClickSetup}
              disabled={setupRunning}
              className="gap-2 min-w-48"
              data-testid="btn-one-click-setup"
            >
              {setupRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {setupStep}
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4" />
                  Connect & Auto-Configure
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {isConfigured && (
        <>
          <div className="grid grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold" data-testid="text-total-requests">{syncStatus.totalRequests}</p>
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Requests</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold text-blue-600">{timeAgo(syncStatus.lastPulledAt)}</p>
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Last Pull</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold text-indigo-600">{timeAgo(syncStatus.lastPushedAt)}</p>
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Last Push</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className={`text-2xl font-bold ${syncStatus.conflictsCount > 0 ? "text-amber-600" : "text-emerald-600"}`} data-testid="text-conflicts-count">
                  {syncStatus.conflictsCount}
                </p>
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Conflicts</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  onClick={() => { setPullResult(null); setPushResult(null); pullMutation.mutate(); }}
                  disabled={isSyncing}
                  className="gap-2"
                  data-testid="btn-pull"
                >
                  {pullMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
                  Pull from SharePoint
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setPullResult(null); setPushResult(null); pushMutation.mutate(); }}
                  disabled={isSyncing}
                  className="gap-2"
                  data-testid="btn-push"
                >
                  {pushMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                  Push to SharePoint
                </Button>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs gap-1.5 text-muted-foreground"
                    onClick={runOneClickSetup}
                    disabled={setupRunning}
                    data-testid="btn-reconfigure"
                  >
                    {setupRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />}
                    Reconfigure
                  </Button>
                </div>
              </div>

              {pullResult && (
                <div className="mt-3 p-3 bg-muted/40 rounded-lg">
                  <div className="flex items-center gap-6 text-sm flex-wrap">
                    <span className="text-muted-foreground">
                      <span className="font-semibold text-foreground">{pullResult.totalItems}</span> processed
                    </span>
                    {pullResult.newProjects > 0 && (
                      <span className="text-emerald-600">
                        +{pullResult.newProjects} projects
                      </span>
                    )}
                    {pullResult.newRequests > 0 && (
                      <span className="text-blue-600">
                        +{pullResult.newRequests} new
                      </span>
                    )}
                    {pullResult.updatedRequests > 0 && (
                      <span className="text-muted-foreground">
                        {pullResult.updatedRequests} updated
                      </span>
                    )}
                    {pullResult.conflicts > 0 && (
                      <span className="text-amber-600 font-medium">
                        {pullResult.conflicts} conflicts
                      </span>
                    )}
                    {pullResult.errors > 0 && (
                      <span className="text-red-600 font-medium">
                        {pullResult.errors} errors
                      </span>
                    )}
                  </div>
                </div>
              )}

              {pushResult && (
                <div className="mt-3 p-3 bg-muted/40 rounded-lg">
                  <div className="flex items-center gap-6 text-sm">
                    <span className="text-emerald-600 font-medium">
                      {pushResult.pushed} pushed
                    </span>
                    {pushResult.errors > 0 && (
                      <span className="text-red-600 font-medium">
                        {pushResult.errors} errors
                      </span>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {conflictRequests.length > 0 && (
            <Card className="border-amber-200 bg-amber-50/30">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <GitCompareArrows className="h-4 w-4 text-amber-600" />
                  <h3 className="text-sm font-semibold text-amber-800">
                    {conflictRequests.length} Conflict{conflictRequests.length > 1 ? "s" : ""} to Resolve
                  </h3>
                </div>
                <div className="space-y-2">
                  {conflictRequests.map(req => (
                    <div
                      key={req.id}
                      className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-amber-100"
                      data-testid={`conflict-row-${req.id}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{req.clientName || `Request #${req.id}`}</p>
                          <div className="flex gap-1 mt-0.5">
                            {Object.keys(req.conflictFieldsJson || {}).map(f => (
                              <Badge key={f} variant="outline" className="text-[9px] border-amber-200 text-amber-700">{f}</Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 text-xs h-7 border-amber-200 text-amber-700 hover:bg-amber-50"
                        onClick={() => openConflict(req)}
                        data-testid={`btn-resolve-${req.id}`}
                      >
                        Resolve
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div>
            <button
              onClick={() => setShowAuditLog(!showAuditLog)}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
              data-testid="btn-toggle-audit"
            >
              <History className="h-3.5 w-3.5" />
              <span>Activity Log</span>
              {showAuditLog ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>

            {showAuditLog && (
              <div className="mt-2 border rounded-lg overflow-hidden">
                {!auditData?.logs?.length ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No activity yet</p>
                ) : (
                  <div className="max-h-64 overflow-auto">
                    {auditData.logs.slice(0, 25).map(log => (
                      <div
                        key={log.id}
                        className="flex items-start gap-3 px-3 py-2 border-b last:border-b-0 text-xs"
                        data-testid={`audit-row-${log.id}`}
                      >
                        <span className="text-muted-foreground whitespace-nowrap shrink-0">
                          {formatDateTime(log.createdAt)}
                        </span>
                        <Badge variant="outline" className="text-[9px] shrink-0">{log.action}</Badge>
                        <span className="text-muted-foreground truncate">{log.detail || "—"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <Dialog open={!!conflictDialog} onOpenChange={(open) => { if (!open) setConflictDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              Resolve: {conflictDialog?.clientName || `#${conflictDialog?.id}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-80 overflow-auto">
            {conflictDialog?.conflictFieldsJson && Object.entries(conflictDialog.conflictFieldsJson).map(([field, values]) => (
              <div key={field} className="rounded-lg border p-3 space-y-2">
                <p className="text-xs font-semibold capitalize">{field.replace(/([A-Z])/g, ' $1').trim()}</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-blue-50 rounded text-xs">
                    <p className="text-[10px] text-blue-600 font-semibold mb-0.5">App</p>
                    <p className="break-words">{String(values.app ?? "—")}</p>
                  </div>
                  <div className="p-2 bg-orange-50 rounded text-xs">
                    <p className="text-[10px] text-orange-600 font-semibold mb-0.5">SharePoint</p>
                    <p className="break-words">{String(values.sp ?? "—")}</p>
                  </div>
                </div>
                <Select
                  value={resolutions[field] || "keep_app"}
                  onValueChange={v => setResolutions(prev => ({ ...prev, [field]: v }))}
                >
                  <SelectTrigger className="h-7 text-xs" data-testid={`select-resolution-${field}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep_app">Keep App</SelectItem>
                    <SelectItem value="keep_sp">Keep SharePoint</SelectItem>
                    <SelectItem value="merge">Merge</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConflictDialog(null)}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => {
                if (conflictDialog) resolveMutation.mutate({ requestId: conflictDialog.id, resolutions });
              }}
              disabled={resolveMutation.isPending}
              className="gap-1.5"
              data-testid="btn-confirm-resolve"
            >
              {resolveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
