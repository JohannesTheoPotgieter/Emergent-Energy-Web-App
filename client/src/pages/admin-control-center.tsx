import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Database,
  Users,
  FolderKanban,
  Activity,
  FileUp,
  Link2,
  Settings,
  ShieldAlert,
  Trash2,
  Loader2,
  CheckCircle,
  XCircle,
  Mail,
  MessageSquare,
  FolderOpen,
  ToggleLeft,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
} from "lucide-react";

function useAdminFetch<T>(endpoint: string, queryKey: string[]) {
  return useQuery<T>({
    queryKey,
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(endpoint, { headers, credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    staleTime: 30_000,
  });
}

interface HealthData {
  db: { connected: boolean; host: string | null; error: string | null };
  users: number;
  projects: { total: number; active: number };
  imports: { total: number; committed: number; failed: number; lastRun: string | null };
  auditEvents: number;
}

interface FeatureFlag {
  key: string;
  value: boolean;
  rawValue: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface EnumData {
  executionPhases: string[];
  ragValues: string[];
  projectPhases: string[];
  workstreams: string[];
}

interface IntegrationData {
  outlook: boolean;
  sharepoint: boolean;
  teams: boolean;
  objectCount: number;
}

export default function AdminControlCenterPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [clearDays, setClearDays] = useState("90");

  const { data: health, isLoading: healthLoading } = useAdminFetch<HealthData>(
    "/api/admin/control-center/health",
    ["admin-control-health"]
  );

  const { data: flags, isLoading: flagsLoading } = useAdminFetch<FeatureFlag[]>(
    "/api/admin/control-center/feature-flags",
    ["admin-control-flags"]
  );

  const { data: enums, isLoading: enumsLoading } = useAdminFetch<EnumData>(
    "/api/admin/control-center/enums",
    ["admin-control-enums"]
  );

  const { data: integrations, isLoading: integrationsLoading } = useAdminFetch<IntegrationData>(
    "/api/admin/control-center/integrations",
    ["admin-control-integrations"]
  );

  const toggleFlag = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: boolean }) => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/admin/control-center/feature-flags/${key}`, {
        method: "PUT",
        headers,
        credentials: "include",
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error("Failed to toggle flag");
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["admin-control-flags"] });
      toast({ title: "Feature flag updated", description: `${vars.key} set to ${vars.value ? "ON" : "OFF"}` });
    },
  });

  const clearSessions = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/admin/control-center/dangerous/clear-sessions", {
        method: "POST",
        headers,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to clear sessions");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sessions cleared", description: "All user sessions have been cleared." });
    },
  });

  const clearAuditLog = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/admin/control-center/dangerous/clear-audit-log", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ olderThanDays: parseInt(clearDays) || 90 }),
      });
      if (!res.ok) throw new Error("Failed to clear audit log");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-control-health"] });
      toast({ title: "Audit log trimmed", description: `Entries older than ${clearDays} days removed.` });
    },
  });

  const quickLinks = [
    { label: "Recovery Center", path: "/admin/recovery", icon: ShieldAlert },
    { label: "KPI Traceability", path: "/admin/kpi-traceability", icon: Activity },
    { label: "Import Control Tower", path: "/admin/import-control-tower", icon: FileUp },
    { label: "Users & Roles", path: "/admin/roles", icon: Users },
    { label: "Activity Log", path: "/admin/activity-log", icon: Activity },
    { label: "App Settings", path: "/admin/settings", icon: Settings },
    { label: "Database Migration", path: "/admin/database-migration", icon: Database },
    { label: "Smart Import", path: "/smart-import", icon: FileUp },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto" data-testid="admin-control-center">
      <div>
        <h1 className="text-2xl font-bold text-foreground" data-testid="text-page-title">Admin Control Center</h1>
        <p className="text-sm text-muted-foreground mt-1">System monitoring, configuration, and management</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <Card data-testid="card-system-health">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4 text-emerald-600" />
              System Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {healthLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : health ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Database</span>
                  {health.db.connected ? (
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200" data-testid="status-db">
                      <CheckCircle className="h-3 w-3 mr-1" /> Connected
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200" data-testid="status-db">
                      <XCircle className="h-3 w-3 mr-1" /> Disconnected
                    </Badge>
                  )}
                </div>
                {health.db.host && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Host</span>
                    <span className="text-xs font-mono text-muted-foreground">{health.db.host}</span>
                  </div>
                )}
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Users</span>
                  <span className="text-sm font-medium" data-testid="text-user-count">{health.users}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Projects (active/total)</span>
                  <span className="text-sm font-medium" data-testid="text-project-count">
                    {health.projects.active} / {health.projects.total}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Audit Events</span>
                  <span className="text-sm font-medium" data-testid="text-audit-count">{health.auditEvents}</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Failed to load health data</p>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-import-stats">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileUp className="h-4 w-4 text-blue-600" />
              Import Stats
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {healthLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : health ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total Runs</span>
                  <span className="text-sm font-medium">{health.imports.total}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Committed</span>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    {health.imports.committed}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Failed</span>
                  <Badge variant="outline" className={health.imports.failed > 0 ? "bg-red-50 text-red-700 border-red-200" : ""}>
                    {health.imports.failed}
                  </Badge>
                </div>
                {health.imports.lastRun && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Last Run</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(health.imports.lastRun).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card data-testid="card-integrations">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Link2 className="h-4 w-4 text-violet-600" />
              Integration Status
            </CardTitle>
            <CardDescription>MS365 connection summary</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {integrationsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : integrations ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" /> Outlook
                  </span>
                  <Badge variant="outline" className={integrations.outlook ? "bg-green-50 text-green-700 border-green-200" : "bg-slate-50 text-slate-500 border-slate-200"}>
                    {integrations.outlook ? "Active" : "Not Connected"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <FolderOpen className="h-3.5 w-3.5" /> SharePoint
                  </span>
                  <Badge variant="outline" className={integrations.sharepoint ? "bg-green-50 text-green-700 border-green-200" : "bg-slate-50 text-slate-500 border-slate-200"}>
                    {integrations.sharepoint ? "Active" : "Not Connected"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5" /> Teams
                  </span>
                  <Badge variant="outline" className={integrations.teams ? "bg-green-50 text-green-700 border-green-200" : "bg-slate-50 text-slate-500 border-slate-200"}>
                    {integrations.teams ? "Active" : "Not Connected"}
                  </Badge>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Synced Objects</span>
                  <span className="text-sm font-medium">{integrations.objectCount}</span>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card data-testid="card-quick-links">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ExternalLink className="h-4 w-4 text-sky-600" />
              Quick Links
            </CardTitle>
            <CardDescription>Admin pages and tools</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {quickLinks.map(link => (
                <a
                  key={link.path}
                  href={link.path}
                  className="flex items-center gap-2 p-2.5 rounded-lg border border-border hover:bg-accent transition-colors text-sm"
                  data-testid={`link-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <link.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{link.label}</span>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-enums">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FolderKanban className="h-4 w-4 text-orange-600" />
              System Enums
            </CardTitle>
            <CardDescription>Status lists, phases, and options</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {enumsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : enums ? (
              <>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase mb-1.5">Execution Phases</p>
                  <div className="flex flex-wrap gap-1">
                    {enums.executionPhases.map(p => (
                      <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase mb-1.5">RAG Values</p>
                  <div className="flex flex-wrap gap-1">
                    {enums.ragValues.map(r => (
                      <Badge key={r} variant="outline" className={`text-xs ${r === "Green" ? "bg-green-50 text-green-700" : r === "Amber" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{r}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase mb-1.5">Project Phases in DB ({enums.projectPhases.length})</p>
                  <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                    {enums.projectPhases.map(p => (
                      <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
                    ))}
                  </div>
                </div>
                {enums.workstreams.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase mb-1.5">Workstreams ({enums.workstreams.length})</p>
                    <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                      {enums.workstreams.map(w => (
                        <Badge key={w} variant="outline" className="text-xs">{w}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-feature-flags">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ToggleLeft className="h-4 w-4 text-cyan-600" />
            Feature Flags
          </CardTitle>
          <CardDescription>Toggle system features</CardDescription>
        </CardHeader>
        <CardContent>
          {flagsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : flags && flags.length > 0 ? (
            <div className="space-y-3">
              {flags.map(flag => (
                <div key={flag.key} className="flex items-center justify-between p-3 rounded-lg border border-border">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium font-mono" data-testid={`text-flag-key-${flag.key}`}>{flag.key}</p>
                    {flag.updatedBy && (
                      <p className="text-xs text-muted-foreground">
                        Updated by {flag.updatedBy}
                        {flag.updatedAt && ` · ${new Date(flag.updatedAt).toLocaleDateString()}`}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={flag.value}
                    onCheckedChange={(checked) => toggleFlag.mutate({ key: flag.key, value: checked })}
                    data-testid={`switch-flag-${flag.key}`}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No feature flags configured</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-red-200" data-testid="card-dangerous-actions">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 text-red-700">
            <AlertTriangle className="h-4 w-4" />
            Dangerous Actions
          </CardTitle>
          <CardDescription>These actions can affect all users. Use with caution.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg border border-red-100 bg-red-50/50">
            <div>
              <p className="text-sm font-medium">Clear All Sessions</p>
              <p className="text-xs text-muted-foreground">Force all users to re-login</p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" data-testid="button-clear-sessions">
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Clear
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear All Sessions?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will force all users to re-authenticate. You will also be logged out.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-clear-sessions">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => clearSessions.mutate()}
                    className="bg-red-600 hover:bg-red-700"
                    data-testid="button-confirm-clear-sessions"
                  >
                    {clearSessions.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Clear Sessions
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border border-red-100 bg-red-50/50">
            <div>
              <p className="text-sm font-medium">Trim Audit Log</p>
              <p className="text-xs text-muted-foreground">Remove old audit entries</p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={clearDays}
                onChange={(e) => setClearDays(e.target.value)}
                className="w-20 h-8 text-sm"
                placeholder="90"
                data-testid="input-clear-days"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">days old</span>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" data-testid="button-clear-audit">
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Trim
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Trim Audit Log?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete audit events older than {clearDays} days. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="button-cancel-clear-audit">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => clearAuditLog.mutate()}
                      className="bg-red-600 hover:bg-red-700"
                      data-testid="button-confirm-clear-audit"
                    >
                      {clearAuditLog.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                      Trim Audit Log
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
