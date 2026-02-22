import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Zap,
  GitCompareArrows,
  Check,
  ChevronDown,
  ChevronUp,
  Search,
  Globe,
  List,
  Settings,
  ExternalLink,
  Info,
  WifiOff,
  ArrowRight,
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

function ListLookupButton({ siteId, listName, onFound }: { siteId: string; listName: string; onFound: (id: string, name?: string) => void }) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const handleLookup = async () => {
    if (!siteId.trim() || !listName.trim()) {
      toast({ title: "Enter a list name first", description: "Type the list name in the field below, then click lookup", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const data = await spFetch(`/api/sp-sync/discover/list-by-name/${encodeURIComponent(siteId)}/${encodeURIComponent(listName.trim())}`);
      if (data.list?.id) {
        onFound(data.list.id, data.list.displayName);
        toast({ title: "Found it!", description: `List "${data.list.displayName}" ID: ${data.list.id.slice(0, 8)}...` });
      } else {
        toast({ title: "List not found", description: data.error || `No list named "${listName}" on this site`, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Lookup failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={handleLookup} disabled={loading} className="h-9 px-2.5 gap-1 text-xs whitespace-nowrap" data-testid="btn-lookup-list">
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
      Lookup
    </Button>
  );
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

interface SPList {
  id: string;
  displayName: string;
  itemCount?: number;
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

function SetupFlow({ onComplete }: { onComplete: () => void }) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"auto" | "manual" | null>(null);
  const [autoStep, setAutoStep] = useState<"idle" | "running" | "pick-list" | "done" | "error">("idle");
  const [autoStatus, setAutoStatus] = useState("");
  const [autoError, setAutoError] = useState("");
  const [discoveredSite, setDiscoveredSite] = useState<{ id: string; displayName: string; webUrl: string } | null>(null);
  const [discoveredLists, setDiscoveredLists] = useState<SPList[]>([]);

  const [manualSiteId, setManualSiteId] = useState("emergy.sharepoint.com,7413e721-9ee5-49f1-9396-a2da73697d21,ce878166-ee49-4369-a18c-c71e6cd8f433");
  const [manualListId, setManualListId] = useState("");
  const [manualSiteName, setManualSiteName] = useState("Engineering Support");
  const [manualListName, setManualListName] = useState("Proposals Pipeline");
  const [manualSaving, setManualSaving] = useState(false);

  const runAutoSetup = async () => {
    setAutoStep("running");
    setAutoError("");
    try {
      setAutoStatus("Discovering site...");
      const siteData = await spFetch("/api/sp-sync/discover/site-by-url?hostAndPath=emergy.sharepoint.com:/sites/EngineeringSupport");
      const site = siteData.site || siteData;
      if (!site?.id) throw new Error("Site not found");
      setDiscoveredSite(site);

      setAutoStatus("Finding lists...");
      const listsData = await spFetch(`/api/sp-sync/discover/lists/${site.id}`);
      const lists: SPList[] = listsData.lists || [];

      if (lists.length === 0) {
        setAutoStep("error");
        setAutoError("No lists found on this site. The Outlook connector may not have SharePoint permissions. You can enter the IDs manually instead.");
        return;
      }

      if (lists.length === 1) {
        await connectToList(site, lists[0]);
        return;
      }

      const autoMatch = lists.find((l) =>
        l.displayName?.toLowerCase().includes("proposal") ||
        l.displayName?.toLowerCase().includes("pipeline") ||
        l.displayName?.toLowerCase().includes("engineering")
      );

      if (autoMatch) {
        await connectToList(site, autoMatch);
        return;
      }

      setDiscoveredLists(lists);
      setAutoStep("pick-list");
      setAutoStatus("");
    } catch (err: any) {
      setAutoStep("error");
      setAutoError(err.message || "Discovery failed");
    }
  };

  const connectToList = async (site: { id: string; displayName: string; webUrl: string }, list: SPList) => {
    setAutoStatus(`Connecting to "${list.displayName}"...`);
    await spFetch("/api/sp-sync/config", {
      method: "POST",
      body: JSON.stringify({
        siteId: site.id,
        listId: list.id,
        siteName: site.displayName,
        listName: list.displayName,
        siteUrl: site.webUrl,
      }),
    });

    setAutoStatus("Auto-mapping columns...");
    try {
      await spFetch("/api/sp-sync/config/auto-detect", { method: "POST" });
    } catch {
    }

    setAutoStep("done");
    toast({ title: "Connected", description: `Linked to ${list.displayName}` });
    onComplete();
  };

  const handleManualSave = async () => {
    if (!manualSiteId.trim() || !manualListId.trim()) {
      toast({ title: "Missing IDs", description: "Please enter both site and list IDs", variant: "destructive" });
      return;
    }
    setManualSaving(true);
    try {
      await spFetch("/api/sp-sync/config", {
        method: "POST",
        body: JSON.stringify({
          siteId: manualSiteId.trim(),
          listId: manualListId.trim(),
          siteName: manualSiteName.trim() || "SharePoint Site",
          listName: manualListName.trim() || "List",
          siteUrl: "",
        }),
      });

      try {
        await spFetch("/api/sp-sync/config/auto-detect", { method: "POST" });
      } catch {
      }

      toast({ title: "Connected", description: "SharePoint configured with manual IDs" });
      onComplete();
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setManualSaving(false);
    }
  };

  return (
    <Card className="border-dashed border-2 max-w-2xl mx-auto">
      <CardContent className="py-8 px-6">
        {!mode && (
          <div className="text-center space-y-6">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto">
              <Plug className="h-7 w-7 text-blue-500" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">Connect SharePoint</h3>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
                Link the Engineering Proposals Pipeline to sync intake requests automatically.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                size="lg"
                onClick={() => { setMode("auto"); runAutoSetup(); }}
                className="gap-2 min-w-52"
                data-testid="btn-auto-setup"
              >
                <Zap className="h-4 w-4" />
                Auto-Discover & Connect
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => setMode("manual")}
                className="gap-2 min-w-52"
                data-testid="btn-manual-setup"
              >
                <Settings className="h-4 w-4" />
                Enter IDs Manually
              </Button>
            </div>
          </div>
        )}

        {mode === "auto" && autoStep === "running" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            <p className="text-sm font-medium">{autoStatus}</p>
          </div>
        )}

        {mode === "auto" && autoStep === "pick-list" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span>Site found: <strong>{discoveredSite?.displayName}</strong></span>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Which list is the proposals pipeline?</p>
              <div className="grid gap-2">
                {discoveredLists.map(list => (
                  <button
                    key={list.id}
                    onClick={() => discoveredSite && connectToList(discoveredSite, list)}
                    className="flex items-center justify-between p-3 rounded-lg border hover:border-blue-300 hover:bg-blue-50/50 transition-all text-left group"
                    data-testid={`btn-pick-list-${list.id}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <List className="h-4 w-4 text-muted-foreground group-hover:text-blue-500" />
                      <span className="text-sm font-medium">{list.displayName}</span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setMode(null); setAutoStep("idle"); }} className="text-xs">
              Back
            </Button>
          </div>
        )}

        {mode === "auto" && autoStep === "error" && (
          <div className="space-y-4">
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800">Auto-discovery hit a snag</p>
                  <p className="text-sm text-amber-700 mt-1">{autoError}</p>
                </div>
              </div>
            </div>
            {discoveredSite && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                Site found: {discoveredSite.displayName} ({discoveredSite.id})
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => {
                setMode("manual");
                setAutoStep("idle");
                if (discoveredSite) {
                  setManualSiteId(discoveredSite.id);
                  setManualSiteName(discoveredSite.displayName || "Engineering Support");
                }
              }} className="gap-1.5">
                <Settings className="h-3.5 w-3.5" />
                Enter List ID Manually
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setMode(null); setAutoStep("idle"); }}>
                Back
              </Button>
            </div>
          </div>
        )}

        {mode === "manual" && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <Settings className="h-5 w-5 text-muted-foreground" />
              <h3 className="font-semibold">Manual Configuration</h3>
            </div>

            <div className="p-3 bg-muted/50 rounded-lg flex gap-2 items-start">
              <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground leading-relaxed space-y-1.5">
                <p className="font-medium text-foreground">How to find the List ID:</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>Open the list in SharePoint</li>
                  <li>Click the gear icon → <strong>List settings</strong></li>
                  <li>In the URL bar, copy the value after <code className="bg-muted px-1 rounded">List=%7B</code> and before <code className="bg-muted px-1 rounded">%7D</code></li>
                  <li>That GUID is the list ID (e.g. <code className="bg-muted px-1 rounded">12345678-abcd-...</code>)</li>
                </ol>
                <p>The Site ID is pre-filled from your Engineering Support site.</p>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">List Name</Label>
                <div className="flex gap-1.5">
                  <Input
                    placeholder="e.g. Proposals Pipeline"
                    value={manualListName}
                    onChange={e => setManualListName(e.target.value)}
                    className="text-sm h-9 flex-1"
                    data-testid="input-list-name"
                  />
                  <ListLookupButton
                    siteId={manualSiteId}
                    listName={manualListName}
                    onFound={(id, name) => { setManualListId(id); if (name) setManualListName(name); }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Type the SharePoint list name and click <strong>Lookup</strong> to auto-fill the List ID
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Site ID (pre-filled)</Label>
                  <Input
                    placeholder="e.g. emergy.sharepoint.com,abc123..."
                    value={manualSiteId}
                    onChange={e => setManualSiteId(e.target.value)}
                    className="text-sm h-9 font-mono text-xs"
                    data-testid="input-site-id"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">List ID {manualListId && <span className="text-emerald-600">(found)</span>}</Label>
                  <Input
                    placeholder="Auto-filled by lookup, or paste manually"
                    value={manualListId}
                    onChange={e => setManualListId(e.target.value)}
                    className="text-sm h-9 font-mono text-xs"
                    data-testid="input-list-id"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Site Name</Label>
                <Input
                  placeholder="Engineering Support"
                  value={manualSiteName}
                  onChange={e => setManualSiteName(e.target.value)}
                  className="text-sm h-9"
                  data-testid="input-site-name"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleManualSave}
                disabled={manualSaving || !manualSiteId.trim() || !manualListId.trim()}
                className="gap-1.5"
                data-testid="btn-manual-save"
              >
                {manualSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Connect
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setMode(null)}>Back</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SyncDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pullResult, setPullResult] = useState<PullResult | null>(null);
  const [pushResult, setPushResult] = useState<PushResult | null>(null);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [conflictDialog, setConflictDialog] = useState<IntakeRequest | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [showSettings, setShowSettings] = useState(false);

  const { data: status, isLoading } = useQuery<SyncStatus>({
    queryKey: ["sp-sync-status"],
    queryFn: () => spFetch("/api/sp-sync/status"),
    refetchInterval: 15000,
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm">
            <RefreshCw className="h-4 w-4 text-white" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl md:text-2xl font-bold" data-testid="text-sync-title">SharePoint Sync</h2>
            <p className="text-xs text-muted-foreground">
              {isConfigured
                ? `${syncStatus.siteName || "Site"} → ${syncStatus.listName || "List"}`
                : "Not connected"}
            </p>
          </div>
        </div>
        {isConfigured && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${syncStatus.connectorAvailable ? "bg-emerald-500" : "bg-red-400"}`} />
              <span className="text-[11px] text-muted-foreground">
                {syncStatus.connectorAvailable ? "Connected" : "Offline"}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setShowSettings(!showSettings)}
              data-testid="btn-toggle-settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {!isConfigured && !showSettings && (
        <SetupFlow onComplete={invalidateAll} />
      )}

      {isConfigured && showSettings && (
        <Card className="border-dashed">
          <CardContent className="py-4 px-5">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold">Reconfigure Connection</h4>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowSettings(false)}>Close</Button>
            </div>
            <SetupFlow onComplete={() => { invalidateAll(); setShowSettings(false); }} />
          </CardContent>
        </Card>
      )}

      {isConfigured && !showSettings && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
              </div>

              {pullResult && (
                <div className="mt-3 p-3 bg-muted/40 rounded-lg">
                  <div className="flex items-center gap-4 text-sm flex-wrap">
                    <span className="text-muted-foreground">
                      <span className="font-semibold text-foreground">{pullResult.totalItems}</span> processed
                    </span>
                    {pullResult.newProjects > 0 && (
                      <span className="text-emerald-600">+{pullResult.newProjects} projects</span>
                    )}
                    {pullResult.newRequests > 0 && (
                      <span className="text-blue-600">+{pullResult.newRequests} new</span>
                    )}
                    {pullResult.updatedRequests > 0 && (
                      <span className="text-muted-foreground">{pullResult.updatedRequests} updated</span>
                    )}
                    {pullResult.conflicts > 0 && (
                      <span className="text-amber-600 font-medium">{pullResult.conflicts} conflicts</span>
                    )}
                    {pullResult.errors > 0 && (
                      <span className="text-red-600 font-medium">{pullResult.errors} errors</span>
                    )}
                  </div>
                </div>
              )}

              {pushResult && (
                <div className="mt-3 p-3 bg-muted/40 rounded-lg">
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-emerald-600 font-medium">{pushResult.pushed} pushed</span>
                    {pushResult.errors > 0 && (
                      <span className="text-red-600 font-medium">{pushResult.errors} errors</span>
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
                          <div className="flex gap-1 mt-0.5 flex-wrap">
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
