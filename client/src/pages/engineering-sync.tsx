import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Shield,
  RefreshCw,
  ArrowDownToLine,
  ArrowUpFromLine,
  Settings,
  Search,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Globe,
  List,
  Columns3,
  GitCompareArrows,
  History,
  Zap,
  CloudDownload,
  CloudUpload,
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

function formatDateTime(d: string | null) {
  if (!d) return "Never";
  try {
    return new Date(d).toLocaleString("en-ZA", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
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

interface SyncConfig {
  config: any;
  isConfigured: boolean;
}

interface SPSite {
  id: string;
  displayName: string;
  webUrl: string;
}

interface SPList {
  id: string;
  displayName: string;
  description?: string;
}

interface SPColumn {
  id: string;
  name: string;
  displayName: string;
  description?: string;
}

interface IntakeRequest {
  id: number;
  projectName?: string;
  status?: string;
  spConflictFields?: Record<string, { app: any; sp: any }> | null;
  [key: string]: any;
}

interface AuditLogEntry {
  id: number;
  action: string;
  detail?: string;
  actorName?: string;
  createdAt: string;
  [key: string]: any;
}

interface PullResult {
  success: boolean;
  totalItems: number;
  newProjects: number;
  newRequests: number;
  updatedRequests: number;
  conflicts: number;
  errors: number;
  conflictList?: any[];
  errorList?: any[];
}

interface PushResult {
  success: boolean;
  pushed: number;
  errors: number;
}

function StatusCard({ status }: { status: SyncStatus }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <Card>
        <CardContent className="p-4">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Status</p>
          <Badge
            className={status.configured ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}
            data-testid="badge-sync-status"
          >
            {status.configured ? "Configured" : "Not Configured"}
          </Badge>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Connector</p>
          <Badge
            className={status.connectorAvailable ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}
            data-testid="badge-connector"
          >
            {status.connectorAvailable ? "Available" : "Not Connected"}
          </Badge>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Last Pulled</p>
          <p className="text-sm font-semibold" data-testid="text-last-pulled">{formatDateTime(status.lastPulledAt)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Last Pushed</p>
          <p className="text-sm font-semibold" data-testid="text-last-pushed">{formatDateTime(status.lastPushedAt)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Total Requests</p>
          <p className="text-2xl font-bold" data-testid="text-total-requests">{status.totalRequests}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Conflicts</p>
          <p className={`text-2xl font-bold ${status.conflictsCount > 0 ? "text-red-600" : ""}`} data-testid="text-conflicts-count">
            {status.conflictsCount}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function SetupSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [discoveredSite, setDiscoveredSite] = useState<SPSite | null>(null);
  const [lists, setLists] = useState<SPList[]>([]);
  const [selectedList, setSelectedList] = useState<SPList | null>(null);
  const [columns, setColumns] = useState<SPColumn[]>([]);
  const [mappingOverrides, setMappingOverrides] = useState<Record<string, string>>({});
  const [step, setStep] = useState<"idle" | "site-found" | "lists-loaded" | "list-selected" | "columns-loaded">("idle");

  const { data: configData } = useQuery<SyncConfig>({
    queryKey: ["sp-sync-config"],
    queryFn: () => spFetch("/api/sp-sync/config"),
  });

  const discoverSiteMutation = useMutation({
    mutationFn: () => spFetch("/api/sp-sync/discover/site-by-url?hostAndPath=emergy.sharepoint.com:/sites/EngineeringSupport"),
    onSuccess: (data: any) => {
      const site = data.site || data;
      setDiscoveredSite(site);
      setStep("site-found");
      toast({ title: "Site discovered", description: site.displayName || site.id });
    },
    onError: (e: Error) => toast({ title: "Discovery failed", description: e.message, variant: "destructive" }),
  });

  const loadListsMutation = useMutation({
    mutationFn: (siteId: string) => spFetch(`/api/sp-sync/discover/lists/${siteId}`),
    onSuccess: (data: any) => {
      setLists(data.lists || []);
      setStep("lists-loaded");
    },
    onError: (e: Error) => toast({ title: "Failed to load lists", description: e.message, variant: "destructive" }),
  });

  const loadColumnsMutation = useMutation({
    mutationFn: ({ siteId, listId }: { siteId: string; listId: string }) =>
      spFetch(`/api/sp-sync/discover/columns/${siteId}/${listId}`),
    onSuccess: (data: any) => {
      setColumns(data.columns || []);
      setStep("columns-loaded");
    },
    onError: (e: Error) => toast({ title: "Failed to load columns", description: e.message, variant: "destructive" }),
  });

  const saveConfigMutation = useMutation({
    mutationFn: (body: any) => spFetch("/api/sp-sync/config", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sp-sync-status"] });
      queryClient.invalidateQueries({ queryKey: ["sp-sync-config"] });
      toast({ title: "Configuration saved" });
    },
    onError: (e: Error) => toast({ title: "Failed to save config", description: e.message, variant: "destructive" }),
  });

  const autoDetectMutation = useMutation({
    mutationFn: () => spFetch("/api/sp-sync/config/auto-detect", { method: "POST" }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["sp-sync-config"] });
      toast({ title: "Column mapping auto-detected" });
    },
    onError: (e: Error) => toast({ title: "Auto-detect failed", description: e.message, variant: "destructive" }),
  });

  const updateMappingMutation = useMutation({
    mutationFn: (mapping: Record<string, string>) =>
      spFetch("/api/sp-sync/config/mapping", { method: "PATCH", body: JSON.stringify(mapping) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sp-sync-config"] });
      toast({ title: "Mapping updated" });
    },
    onError: (e: Error) => toast({ title: "Failed to update mapping", description: e.message, variant: "destructive" }),
  });

  const handleSelectList = (list: SPList) => {
    setSelectedList(list);
    setStep("list-selected");
    if (discoveredSite) {
      loadColumnsMutation.mutate({ siteId: discoveredSite.id, listId: list.id });
    }
  };

  const handleSaveConfig = () => {
    if (!discoveredSite || !selectedList) return;
    saveConfigMutation.mutate({
      siteId: discoveredSite.id,
      listId: selectedList.id,
      siteName: discoveredSite.displayName,
      listName: selectedList.displayName,
      siteUrl: discoveredSite.webUrl,
    });
  };

  const currentMapping = configData?.config?.columnMapping || {};

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Settings className="h-5 w-5" />
          Setup &amp; Configuration
        </CardTitle>
        <CardDescription>
          {configData?.isConfigured
            ? `Connected to ${configData.config?.siteName || "SharePoint"} → ${configData.config?.listName || "List"}`
            : "Connect to SharePoint Proposals Pipeline"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => discoverSiteMutation.mutate()}
            disabled={discoverSiteMutation.isPending}
            data-testid="btn-discover-site"
          >
            {discoverSiteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
            Discover SharePoint Site
          </Button>

          {configData?.isConfigured && (
            <>
              <Button
                variant="outline"
                onClick={() => autoDetectMutation.mutate()}
                disabled={autoDetectMutation.isPending}
                data-testid="btn-auto-detect"
              >
                {autoDetectMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
                Auto-Detect Columns
              </Button>
            </>
          )}
        </div>

        {discoveredSite && step !== "idle" && (
          <Card className="bg-muted/30">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-emerald-600" />
                <span className="text-sm font-semibold">{discoveredSite.displayName}</span>
                <Badge className="bg-emerald-100 text-emerald-700 text-[9px]">Found</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{discoveredSite.webUrl}</p>

              {step === "site-found" && (
                <Button
                  size="sm"
                  onClick={() => loadListsMutation.mutate(discoveredSite.id)}
                  disabled={loadListsMutation.isPending}
                  data-testid="btn-load-lists"
                >
                  {loadListsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <List className="h-4 w-4 mr-2" />}
                  Load Available Lists
                </Button>
              )}

              {lists.length > 0 && (step === "lists-loaded" || step === "list-selected" || step === "columns-loaded") && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Available Lists</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {lists.map(list => (
                      <button
                        key={list.id}
                        onClick={() => handleSelectList(list)}
                        className={`text-left p-3 rounded-lg border transition-all text-sm ${
                          selectedList?.id === list.id
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "border-border hover:border-primary/30 hover:bg-muted/30"
                        }`}
                        data-testid={`btn-select-list-${list.id}`}
                      >
                        <span className="font-medium">{list.displayName}</span>
                        {list.description && <p className="text-xs text-muted-foreground mt-0.5">{list.description}</p>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedList && step === "columns-loaded" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Columns3 className="h-4 w-4 text-blue-600" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Columns in "{selectedList.displayName}"
                    </span>
                  </div>
                  <div className="max-h-48 overflow-auto border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Column Name</TableHead>
                          <TableHead className="text-xs">Display Name</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {columns.map(col => (
                          <TableRow key={col.id}>
                            <TableCell className="text-xs font-mono">{col.name}</TableCell>
                            <TableCell className="text-xs">{col.displayName}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <Button
                    onClick={handleSaveConfig}
                    disabled={saveConfigMutation.isPending}
                    data-testid="btn-save-config"
                  >
                    {saveConfigMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                    Save Configuration
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {configData?.isConfigured && Object.keys(currentMapping).length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Column Mapping</p>
            <div className="max-h-64 overflow-auto border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">App Field</TableHead>
                    <TableHead className="text-xs">SharePoint Column</TableHead>
                    <TableHead className="text-xs w-48">Override</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(currentMapping).map(([appField, spCol]) => (
                    <TableRow key={appField}>
                      <TableCell className="text-xs font-mono">{appField}</TableCell>
                      <TableCell className="text-xs">{String(spCol)}</TableCell>
                      <TableCell>
                        <Input
                          className="h-7 text-xs"
                          placeholder={String(spCol)}
                          value={mappingOverrides[appField] || ""}
                          onChange={e => setMappingOverrides(prev => ({ ...prev, [appField]: e.target.value }))}
                          data-testid={`input-mapping-${appField}`}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const cleaned: Record<string, string> = {};
                for (const [k, v] of Object.entries(mappingOverrides)) {
                  if (v.trim()) cleaned[k] = v.trim();
                }
                if (Object.keys(cleaned).length > 0) {
                  updateMappingMutation.mutate(cleaned);
                }
              }}
              disabled={updateMappingMutation.isPending || Object.values(mappingOverrides).every(v => !v.trim())}
              data-testid="btn-save-mapping"
            >
              {updateMappingMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Mapping Overrides
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SyncControls() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pullResult, setPullResult] = useState<PullResult | null>(null);
  const [pushResult, setPushResult] = useState<PushResult | null>(null);

  const pullMutation = useMutation({
    mutationFn: () => spFetch("/api/sp-sync/pull", { method: "POST" }),
    onSuccess: (data: PullResult) => {
      setPullResult(data);
      queryClient.invalidateQueries({ queryKey: ["sp-sync-status"] });
      queryClient.invalidateQueries({ queryKey: ["sp-sync-intake-requests"] });
      queryClient.invalidateQueries({ queryKey: ["sp-sync-audit-log"] });
      toast({ title: "Pull complete", description: `${data.totalItems} items processed` });
    },
    onError: (e: Error) => toast({ title: "Pull failed", description: e.message, variant: "destructive" }),
  });

  const pushMutation = useMutation({
    mutationFn: () => spFetch("/api/sp-sync/push", { method: "POST" }),
    onSuccess: (data: PushResult) => {
      setPushResult(data);
      queryClient.invalidateQueries({ queryKey: ["sp-sync-status"] });
      queryClient.invalidateQueries({ queryKey: ["sp-sync-audit-log"] });
      toast({ title: "Push complete", description: `${data.pushed} items pushed` });
    },
    onError: (e: Error) => toast({ title: "Push failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <RefreshCw className="h-5 w-5" />
          Sync Controls
        </CardTitle>
        <CardDescription>Pull data from SharePoint or push updates back</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => { setPullResult(null); pullMutation.mutate(); }}
            disabled={pullMutation.isPending}
            data-testid="btn-pull"
          >
            {pullMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CloudDownload className="h-4 w-4 mr-2" />}
            Pull from SharePoint
          </Button>
          <Button
            variant="outline"
            onClick={() => { setPushResult(null); pushMutation.mutate(); }}
            disabled={pushMutation.isPending}
            data-testid="btn-push"
          >
            {pushMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CloudUpload className="h-4 w-4 mr-2" />}
            Push to SharePoint
          </Button>
        </div>

        {pullResult && (
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Pull Summary</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-center">
                <div><p className="text-lg font-bold">{pullResult.totalItems}</p><p className="text-[10px] text-muted-foreground">Total Items</p></div>
                <div><p className="text-lg font-bold text-emerald-600">{pullResult.newProjects}</p><p className="text-[10px] text-muted-foreground">New Projects</p></div>
                <div><p className="text-lg font-bold text-blue-600">{pullResult.newRequests}</p><p className="text-[10px] text-muted-foreground">New Requests</p></div>
                <div><p className="text-lg font-bold">{pullResult.updatedRequests}</p><p className="text-[10px] text-muted-foreground">Updated</p></div>
                <div><p className={`text-lg font-bold ${pullResult.conflicts > 0 ? "text-amber-600" : ""}`}>{pullResult.conflicts}</p><p className="text-[10px] text-muted-foreground">Conflicts</p></div>
                <div><p className={`text-lg font-bold ${pullResult.errors > 0 ? "text-red-600" : ""}`}>{pullResult.errors}</p><p className="text-[10px] text-muted-foreground">Errors</p></div>
              </div>
            </CardContent>
          </Card>
        )}

        {pushResult && (
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Push Summary</p>
              <div className="grid grid-cols-2 gap-3 text-center max-w-xs">
                <div><p className="text-lg font-bold text-emerald-600">{pushResult.pushed}</p><p className="text-[10px] text-muted-foreground">Pushed</p></div>
                <div><p className={`text-lg font-bold ${pushResult.errors > 0 ? "text-red-600" : ""}`}>{pushResult.errors}</p><p className="text-[10px] text-muted-foreground">Errors</p></div>
              </div>
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}

function ConflictResolution() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedRequest, setSelectedRequest] = useState<IntakeRequest | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, string>>({});

  const { data: requestsData } = useQuery<{ requests: IntakeRequest[] }>({
    queryKey: ["sp-sync-intake-requests"],
    queryFn: () => spFetch("/api/sp-sync/intake-requests"),
  });

  const conflictRequests = (requestsData?.requests || []).filter(
    r => r.spConflictFields && Object.keys(r.spConflictFields).length > 0
  );

  const resolveMutation = useMutation({
    mutationFn: ({ requestId, resolutions }: { requestId: number; resolutions: Record<string, string> }) =>
      spFetch(`/api/sp-sync/resolve-conflict/${requestId}`, {
        method: "POST",
        body: JSON.stringify({ resolutions }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sp-sync-intake-requests"] });
      queryClient.invalidateQueries({ queryKey: ["sp-sync-status"] });
      queryClient.invalidateQueries({ queryKey: ["sp-sync-audit-log"] });
      setSelectedRequest(null);
      setResolutions({});
      toast({ title: "Conflict resolved" });
    },
    onError: (e: Error) => toast({ title: "Failed to resolve conflict", description: e.message, variant: "destructive" }),
  });

  const openResolveDialog = (request: IntakeRequest) => {
    setSelectedRequest(request);
    const defaultRes: Record<string, string> = {};
    if (request.spConflictFields) {
      for (const field of Object.keys(request.spConflictFields)) {
        defaultRes[field] = "keep_app";
      }
    }
    setResolutions(defaultRes);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <GitCompareArrows className="h-5 w-5" />
            Conflict Resolution
            {conflictRequests.length > 0 && (
              <Badge className="bg-red-100 text-red-700 ml-2">{conflictRequests.length}</Badge>
            )}
          </CardTitle>
          <CardDescription>Requests with conflicting data between app and SharePoint</CardDescription>
        </CardHeader>
        <CardContent>
          {conflictRequests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No conflicts to resolve</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">ID</TableHead>
                    <TableHead className="text-xs">Project</TableHead>
                    <TableHead className="text-xs">Conflict Fields</TableHead>
                    <TableHead className="text-xs w-24">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {conflictRequests.map(req => (
                    <TableRow key={req.id} data-testid={`conflict-row-${req.id}`}>
                      <TableCell className="text-xs font-mono">{req.id}</TableCell>
                      <TableCell className="text-xs">{req.projectName || "—"}</TableCell>
                      <TableCell className="text-xs">
                        <div className="flex flex-wrap gap-1">
                          {Object.keys(req.spConflictFields || {}).map(field => (
                            <Badge key={field} variant="outline" className="text-[9px]">
                              <AlertTriangle className="h-3 w-3 mr-0.5 text-amber-500" />
                              {field}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => openResolveDialog(req)}
                          data-testid={`btn-resolve-${req.id}`}
                        >
                          Resolve
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedRequest} onOpenChange={(open) => { if (!open) setSelectedRequest(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Resolve Conflicts — Request #{selectedRequest?.id}</DialogTitle>
            <DialogDescription>
              Choose how to resolve each conflicting field
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-96 overflow-auto">
            {selectedRequest?.spConflictFields && Object.entries(selectedRequest.spConflictFields).map(([field, values]) => (
              <div key={field} className="border rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold">{field}</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 bg-blue-50 rounded">
                    <p className="text-[10px] text-blue-600 font-semibold mb-1">App Value</p>
                    <p className="break-words">{String(values.app ?? "—")}</p>
                  </div>
                  <div className="p-2 bg-orange-50 rounded">
                    <p className="text-[10px] text-orange-600 font-semibold mb-1">SharePoint Value</p>
                    <p className="break-words">{String(values.sp ?? "—")}</p>
                  </div>
                </div>
                <Select
                  value={resolutions[field] || "keep_app"}
                  onValueChange={v => setResolutions(prev => ({ ...prev, [field]: v }))}
                >
                  <SelectTrigger className="h-8 text-xs" data-testid={`select-resolution-${field}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep_app">Keep App Value</SelectItem>
                    <SelectItem value="keep_sp">Keep SharePoint Value</SelectItem>
                    <SelectItem value="merge">Merge (for comments)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSelectedRequest(null)}
              data-testid="btn-cancel-resolve"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedRequest) {
                  resolveMutation.mutate({ requestId: selectedRequest.id, resolutions });
                }
              }}
              disabled={resolveMutation.isPending}
              data-testid="btn-confirm-resolve"
            >
              {resolveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Apply Resolutions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AuditLog() {
  const { data } = useQuery<{ logs: AuditLogEntry[] }>({
    queryKey: ["sp-sync-audit-log"],
    queryFn: () => spFetch("/api/sp-sync/audit-log"),
  });

  const logs = data?.logs || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <History className="h-5 w-5" />
          Sync Audit Log
        </CardTitle>
        <CardDescription>History of all sync operations</CardDescription>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No sync activity yet</p>
          </div>
        ) : (
          <div className="border rounded-lg overflow-auto max-h-96">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Time</TableHead>
                  <TableHead className="text-xs">Action</TableHead>
                  <TableHead className="text-xs">Detail</TableHead>
                  <TableHead className="text-xs">Actor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map(log => (
                  <TableRow key={log.id} data-testid={`audit-row-${log.id}`}>
                    <TableCell className="text-xs whitespace-nowrap">{formatDateTime(log.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[9px]">{log.action}</Badge>
                    </TableCell>
                    <TableCell className="text-xs max-w-xs truncate">{log.detail || "—"}</TableCell>
                    <TableCell className="text-xs">{log.actorName || "System"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function EngineeringSyncPage() {
  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const isCoo = companyRole === "COO_ADMIN";

  if (!isCoo) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground" data-testid="sync-forbidden">
        <Shield className="h-16 w-16 mb-4 opacity-30" />
        <h2 className="text-xl font-semibold">COO Access Required</h2>
        <p className="text-sm mt-2">Only COO administrators can access SharePoint sync management.</p>
      </div>
    );
  }

  const { data: status, isLoading } = useQuery<SyncStatus>({
    queryKey: ["sp-sync-status"],
    queryFn: () => spFetch("/api/sp-sync/status"),
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="space-y-5" data-testid="sync-page">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm">
            <RefreshCw className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-heading font-bold">SharePoint Sync</h2>
            <p className="text-xs text-muted-foreground">Loading...</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {[1,2,3,4,5,6].map(i => <div key={i} className="h-20 bg-muted animate-pulse rounded-xl" />)}
        </div>
      </div>
    );
  }

  const syncStatus: SyncStatus = status || {
    configured: false,
    connectorAvailable: false,
    lastPulledAt: null,
    lastPushedAt: null,
    totalRequests: 0,
    conflictsCount: 0,
    siteName: null,
    listName: null,
  };

  return (
    <div className="space-y-6" data-testid="sync-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm">
            <RefreshCw className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-heading font-bold" data-testid="text-sync-title">
              SharePoint Sync
            </h2>
            <p className="text-xs text-muted-foreground">
              Engineering Proposals Pipeline &middot;
              {syncStatus.siteName ? ` ${syncStatus.siteName}` : " Not configured"}
              {syncStatus.listName ? ` → ${syncStatus.listName}` : ""}
            </p>
          </div>
        </div>
      </div>

      <StatusCard status={syncStatus} />

      <Tabs defaultValue="sync" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sync" data-testid="tab-sync">Sync</TabsTrigger>
          <TabsTrigger value="setup" data-testid="tab-setup">Setup</TabsTrigger>
          <TabsTrigger value="conflicts" data-testid="tab-conflicts">
            Conflicts
            {syncStatus.conflictsCount > 0 && (
              <Badge className="bg-red-100 text-red-700 ml-1.5 text-[9px] px-1.5">{syncStatus.conflictsCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="sync">
          <SyncControls />
        </TabsContent>

        <TabsContent value="setup">
          <SetupSection />
        </TabsContent>

        <TabsContent value="conflicts">
          <ConflictResolution />
        </TabsContent>

        <TabsContent value="audit">
          <AuditLog />
        </TabsContent>
      </Tabs>
    </div>
  );
}
