import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminPageShell, AdminQueryState } from "@/components/admin/admin-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  LogOut,
  Clock,
  Wifi,
  WifiOff,
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

function getQueryError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatIntegrationStatus(status: string | undefined) {
  if (!status) return "Not Connected";
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
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

interface RolloutFoundationFlag {
  key: string;
  label: string;
  description: string;
  defaultValue: boolean;
  value: boolean;
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
  activeAccounts?: number;
  outlookStatus?: string;
  sharepointStatus?: string;
  teamsStatus?: string;
}

interface SessionData {
  count: number;
  sessions: Array<{
    sid: string;
    userId: number | null;
    userName: string | null;
    username: string | null;
    userRole: string | null;
    expiresAt: string;
  }>;
}

interface ImportFailure {
  id: number;
  projectName: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string | null;
  recordsAttempted: number | null;
  recordsFailed: number | null;
  blockerCount: number;
  topError: string | null;
}

interface SystemIssue {
  id: number;
  entityType: string;
  entityId: string | null;
  action: string;
  userName: string | null;
  projectName: string | null;
  createdAt: string;
  details: Record<string, any> | null;
  requestPath: string | null;
}

interface IntegrationHealthItem {
  name: string;
  type: string;
  objectCount: number;
  lastSyncTime: string | null;
  status: string;
  connectedUsers?: number;
  configured?: boolean;
}

interface ImportGovernanceData {
  summary: {
    previewRuns: number;
    awaitingReviewRuns: number;
    committedRuns: number;
    failedRuns: number;
    rolledBackRuns: number;
    supersededRuns: number;
    reviewBacklog: number;
    pendingExcelConfirmations: number;
    unresolvedPlanEdits: number;
    lastRunAt: string | null;
  };
  recentRuns: Array<{
    id: number;
    projectName: string;
    status: string;
    uploadedAt: string;
    sourceFileName: string;
    recordsAttempted: number;
    recordsSucceeded: number;
    recordsFailed: number;
    blockerCount: number;
    warningCount: number;
  }>;
  recentAttentionRuns: Array<{
    id: number;
    projectName: string;
    status: string;
    uploadedAt: string;
    sourceFileName: string;
    recordsAttempted: number;
    recordsSucceeded: number;
    recordsFailed: number;
    blockerCount: number;
    warningCount: number;
  }>;
}

export default function AdminControlCenterPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [clearDays, setClearDays] = useState("90");
  const [flagOverrideDraft, setFlagOverrideDraft] = useState<{ key: string; value: boolean; suggestedValue: boolean; reason: string } | null>(null);

  const healthQuery = useAdminFetch<HealthData>(
    "/api/admin/control-center/health",
    ["admin-control-health"]
  );

  const flagsQuery = useAdminFetch<FeatureFlag[]>(
    "/api/admin/control-center/feature-flags",
    ["admin-control-flags"]
  );
  const rolloutFoundationQuery = useAdminFetch<{ flags: RolloutFoundationFlag[] }>(
    "/api/admin/control-center/rollout-foundation",
    ["admin-control-rollout-foundation"]
  );

  const enumsQuery = useAdminFetch<EnumData>(
    "/api/admin/control-center/enums",
    ["admin-control-enums"]
  );

  const integrationsQuery = useAdminFetch<IntegrationData>(
    "/api/admin/control-center/integrations",
    ["admin-control-integrations"]
  );

  const activeSessionsQuery = useAdminFetch<SessionData>(
    "/api/admin/control-center/active-sessions",
    ["admin-control-sessions"]
  );

  const importFailuresQuery = useAdminFetch<ImportFailure[]>(
    "/api/admin/control-center/recent-import-failures",
    ["admin-control-import-failures"]
  );

  const systemIssuesQuery = useAdminFetch<SystemIssue[]>(
    "/api/admin/control-center/recent-issues",
    ["admin-control-system-issues"]
  );

  const integrationHealthQuery = useAdminFetch<IntegrationHealthItem[]>(
    "/api/admin/control-center/integration-health",
    ["admin-control-integration-health"]
  );

  const importGovernanceQuery = useAdminFetch<ImportGovernanceData>(
    "/api/admin/control-center/import-governance",
    ["admin-control-import-governance"]
  );

  const permEnforcementQuery = useAdminFetch<{
    summary: {
      totalBackendEnforcedRoutes: number;
      totalOwnershipScopedEndpoints: number;
      totalApplicationLogicOnly: number;
      recentAccessDenials7d: number;
      recentImportIssues7d: number;
    };
    backendEnforced: { route: string; entity: string; action: string; level: string }[];
    ownershipScoping: { endpoint: string; scope: string; enforced: string }[];
    applicationLogicOnly: { endpoint: string; scope: string; status: string }[];
  }>(
    "/api/admin/control-center/permission-enforcement",
    ["admin-control-perm-enforcement"]
  );

  const opsExceptionsQuery = useAdminFetch<{
    unassignedTasks: number;
    unassignedProjects: number;
    blockedItems: number;
    overdueByOwner: { owner: string; count: number }[];
  }>(
    "/api/admin/control-center/operational-exceptions",
    ["admin-control-ops-exceptions"]
  );
  const health: HealthData = healthQuery.data ?? {
    db: { connected: false, host: null, error: null },
    users: 0,
    projects: { total: 0, active: 0 },
    imports: { total: 0, committed: 0, failed: 0, lastRun: null },
    auditEvents: 0,
  };
  const flags: FeatureFlag[] = flagsQuery.data ?? [];
  const rolloutFoundation = rolloutFoundationQuery.data ?? { flags: [] };
  const enums: EnumData = enumsQuery.data ?? { executionPhases: [], ragValues: [], projectPhases: [], workstreams: [] };
  const integrations: IntegrationData = integrationsQuery.data ?? { outlook: false, sharepoint: false, teams: false, objectCount: 0, activeAccounts: 0, outlookStatus: "not_connected", sharepointStatus: "not_connected", teamsStatus: "not_connected" };
  const activeSessions: SessionData = activeSessionsQuery.data ?? { count: 0, sessions: [] };
  const importFailures: ImportFailure[] = importFailuresQuery.data ?? [];
  const systemIssues: SystemIssue[] = systemIssuesQuery.data ?? [];
  const integrationHealth: IntegrationHealthItem[] = integrationHealthQuery.data ?? [];
  const importGovernance: ImportGovernanceData = importGovernanceQuery.data ?? {
    summary: {
      previewRuns: 0,
      awaitingReviewRuns: 0,
      committedRuns: 0,
      failedRuns: 0,
      rolledBackRuns: 0,
      supersededRuns: 0,
      reviewBacklog: 0,
      pendingExcelConfirmations: 0,
      unresolvedPlanEdits: 0,
      lastRunAt: null,
    },
    recentRuns: [],
    recentAttentionRuns: [],
  };
  const permEnforcement = permEnforcementQuery.data ?? {
    summary: {
      totalBackendEnforcedRoutes: 0,
      totalOwnershipScopedEndpoints: 0,
      totalApplicationLogicOnly: 0,
      recentAccessDenials7d: 0,
      recentImportIssues7d: 0,
    },
    backendEnforced: [],
    ownershipScoping: [],
    applicationLogicOnly: [],
  };
  const opsExceptions = opsExceptionsQuery.data ?? {
    unassignedTasks: 0,
    unassignedProjects: 0,
    blockedItems: 0,
    overdueByOwner: [],
  };
  const healthLoading = healthQuery.isLoading;
  const flagsLoading = flagsQuery.isLoading;
  const enumsLoading = enumsQuery.isLoading;
  const integrationsLoading = integrationsQuery.isLoading;
  const sessionsLoading = activeSessionsQuery.isLoading;
  const importFailuresLoading = importFailuresQuery.isLoading;
  const systemIssuesLoading = systemIssuesQuery.isLoading;
  const integrationHealthLoading = integrationHealthQuery.isLoading;
  const permEnforcementLoading = permEnforcementQuery.isLoading;
  const opsExceptionsLoading = opsExceptionsQuery.isLoading;
  const cleanedAdminVisibilityEnabled = flags?.find((flag) => flag.key === "cleaned_admin_visibility")?.value === true;
  const connectedIntegrationCount = [integrations?.outlook, integrations?.sharepoint, integrations?.teams].filter(Boolean).length;
  const shellStatuses = [
    health?.db.connected
      ? { label: "Database connected", tone: "success" as const }
      : { label: "Database needs attention", tone: "danger" as const },
    importGovernance?.summary.reviewBacklog
      ? { label: `${importGovernance.summary.reviewBacklog} imports awaiting review`, tone: "warning" as const }
      : { label: "Import review backlog clear", tone: "success" as const },
    connectedIntegrationCount > 0
      ? { label: `${connectedIntegrationCount}/3 Microsoft surfaces connected`, tone: connectedIntegrationCount === 3 ? "success" as const : "warning" as const }
      : { label: "Microsoft connectivity needs attention", tone: "danger" as const },
  ];

  const forceLogout = useMutation({
    mutationFn: async (sid: string) => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/admin/control-center/sessions/${encodeURIComponent(sid)}`, {
        method: "DELETE",
        headers,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to terminate session");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-control-sessions"] });
      toast({ title: "Session terminated", description: "User has been logged out." });
    },
  });

  const toggleFlag = useMutation({
    mutationFn: async ({ key, value, reason, suggestedValue }: { key: string; value: boolean; reason?: string; suggestedValue?: boolean | null }) => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/admin/control-center/feature-flags/${key}`, {
        method: "PUT",
        headers,
        credentials: "include",
        body: JSON.stringify({ value, reason, suggestedValue }),
      });
      if (!res.ok) throw new Error("Failed to toggle flag");
      return res.json();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["admin-control-flags"] });
      toast({ title: "Feature flag updated", description: `${vars.key} set to ${vars.value ? "ON" : "OFF"}` });
      setFlagOverrideDraft(null);
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err?.message || "Failed to update flag", variant: "destructive" });
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

  const quickLinkSections = [
    {
      title: "Governance",
      items: [
        { label: "Roles & Permissions", path: "/admin/roles", icon: Users },
        { label: "Audit Log", path: "/admin/activity-log", icon: Activity },
      ],
    },
    {
      title: "Imports",
      items: [
        { label: "Smart Import", path: "/admin/smart-import", icon: FileUp },
        { label: "Excel Updates", path: "/admin/excel-updates", icon: FolderOpen },
      ],
    },
    {
      title: "System Controls",
      items: [
        { label: "System Settings", path: "/admin/settings", icon: Settings },
        { label: "Control Center", path: "/admin/control-center", icon: Database },
      ],
    },
  ];

  const secondaryUtilityLinks = [
    { label: "Legacy Admin Utilities", path: "/admin/legacy-utilities", icon: FolderOpen },
    { label: "Database Migration", path: "/admin/database-migration", icon: Database },
    { label: "Smart Import", path: "/admin/smart-import", icon: FileUp },
  ];

  return (
    <AdminPageShell
      surfaceId="control-center"
      title="Control Center"
      description="Trusted operational cockpit for system governance, import health, Microsoft integration visibility, permissions, and audit-linked recovery controls."
      statuses={shellStatuses}
      metrics={[
        { label: "Active Projects", value: health?.projects.active ?? "—", helper: "Projects currently marked active" },
        { label: "Import Backlog", value: importGovernance?.summary.reviewBacklog ?? "—", helper: "Preview and review runs awaiting action" },
        { label: "Pending Excel", value: importGovernance?.summary.pendingExcelConfirmations ?? "—", helper: "Tracker confirmations still outstanding" },
        { label: "Microsoft Sync", value: `${connectedIntegrationCount}/3`, helper: "Outlook, SharePoint, Teams connectivity" },
      ]}
    >
    <div className="space-y-6" data-testid="admin-control-center">
      <div>
        <h1 className="text-2xl font-bold text-foreground" data-testid="text-page-title">Control Center</h1>
        <p className="text-sm text-muted-foreground mt-1">Primary admin hub for trusted system controls, governance, and recovery</p>
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
            <AdminQueryState
              isLoading={healthLoading}
              error={healthQuery.error ? getQueryError(healthQuery.error, "System health could not be loaded.") : null}
              onRetry={() => { void healthQuery.refetch(); }}
              loadingLabel="Loading system health..."
            >
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
            </AdminQueryState>
          </CardContent>
        </Card>

        <Card data-testid="card-import-stats">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileUp className="h-4 w-4 text-blue-600" />
              Import Governance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <AdminQueryState
              isLoading={healthLoading || importGovernanceQuery.isLoading}
              error={(healthQuery.error || importGovernanceQuery.error) ? getQueryError(healthQuery.error || importGovernanceQuery.error, "Import governance could not be loaded.") : null}
              onRetry={() => { void healthQuery.refetch(); void importGovernanceQuery.refetch(); }}
              loadingLabel="Loading import governance..."
            >
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total Runs</span>
                  <span className="text-sm font-medium">{health.imports.total}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Awaiting Review</span>
                  <Badge variant="outline" className={(importGovernance?.summary.reviewBacklog || 0) > 0 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}>
                    {importGovernance?.summary.reviewBacklog ?? 0}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Pending Excel Confirmations</span>
                  <Badge variant="outline" className={(importGovernance?.summary.pendingExcelConfirmations || 0) > 0 ? "bg-amber-50 text-amber-700 border-amber-200" : ""}>
                    {importGovernance?.summary.pendingExcelConfirmations ?? 0}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Failed Runs</span>
                  <Badge variant="outline" className={health.imports.failed > 0 ? "bg-red-50 text-red-700 border-red-200" : ""}>
                    {health.imports.failed}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Unresolved Plan Edits</span>
                  <span className="text-sm font-medium">{importGovernance?.summary.unresolvedPlanEdits ?? 0}</span>
                </div>
                {(importGovernance?.summary.lastRunAt || health.imports.lastRun) && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Last Run</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(importGovernance?.summary.lastRunAt || health.imports.lastRun || "").toLocaleString()}
                    </span>
                  </div>
                )}
              </>
            </AdminQueryState>
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
            <AdminQueryState
              isLoading={integrationsLoading}
              error={integrationsQuery.error ? getQueryError(integrationsQuery.error, "Microsoft integration status could not be loaded.") : null}
              onRetry={() => { void integrationsQuery.refetch(); }}
              loadingLabel="Loading Microsoft integration status..."
            >
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" /> Outlook
                  </span>
                  <Badge variant="outline" className={integrations.outlook ? "bg-green-50 text-green-700 border-green-200" : "bg-slate-50 text-slate-500 border-slate-200"}>
                    {formatIntegrationStatus(integrations.outlookStatus)}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <FolderOpen className="h-3.5 w-3.5" /> SharePoint
                  </span>
                  <Badge variant="outline" className={integrations.sharepoint ? "bg-green-50 text-green-700 border-green-200" : "bg-slate-50 text-slate-500 border-slate-200"}>
                    {formatIntegrationStatus(integrations.sharepointStatus)}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5" /> Teams
                  </span>
                  <Badge variant="outline" className={integrations.teams ? "bg-green-50 text-green-700 border-green-200" : "bg-slate-50 text-slate-500 border-slate-200"}>
                    {formatIntegrationStatus(integrations.teamsStatus)}
                  </Badge>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Synced Objects</span>
                  <span className="text-sm font-medium">{integrations.objectCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Connected Accounts</span>
                  <span className="text-sm font-medium">{integrations.activeAccounts ?? 0}</span>
                </div>
              </>
            </AdminQueryState>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-operational-exceptions">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Operational Exceptions
          </CardTitle>
          <CardDescription>Live management exceptions requiring attention</CardDescription>
        </CardHeader>
        <CardContent>
          <AdminQueryState
            isLoading={opsExceptionsLoading}
            error={opsExceptionsQuery.error ? getQueryError(opsExceptionsQuery.error, "Operational exceptions could not be loaded.") : null}
            onRetry={() => { void opsExceptionsQuery.refetch(); }}
            loadingLabel="Loading operational exceptions..."
          >
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className={`rounded-lg border p-3 text-center ${opsExceptions.unassignedTasks > 0 ? "border-red-200 bg-red-50" : "border-border"}`}>
                  <p className={`text-2xl font-bold ${opsExceptions.unassignedTasks > 0 ? "text-red-600" : "text-foreground"}`}>{opsExceptions.unassignedTasks}</p>
                  <p className="text-xs text-muted-foreground">Unassigned Tasks</p>
                </div>
                <div className={`rounded-lg border p-3 text-center ${opsExceptions.unassignedProjects > 0 ? "border-amber-200 bg-amber-50" : "border-border"}`}>
                  <p className={`text-2xl font-bold ${opsExceptions.unassignedProjects > 0 ? "text-amber-600" : "text-foreground"}`}>{opsExceptions.unassignedProjects}</p>
                  <p className="text-xs text-muted-foreground">Projects Without PM</p>
                </div>
                <div className={`rounded-lg border p-3 text-center ${opsExceptions.blockedItems > 0 ? "border-orange-200 bg-orange-50" : "border-border"}`}>
                  <p className={`text-2xl font-bold ${opsExceptions.blockedItems > 0 ? "text-orange-600" : "text-foreground"}`}>{opsExceptions.blockedItems}</p>
                  <p className="text-xs text-muted-foreground">Blocked Items</p>
                </div>
                <div className="rounded-lg border p-3 text-center border-border">
                  <p className="text-2xl font-bold text-foreground">{opsExceptions.overdueByOwner.reduce((s, o) => s + o.count, 0)}</p>
                  <p className="text-xs text-muted-foreground">Total Overdue</p>
                </div>
              </div>
              {opsExceptions.overdueByOwner.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Overdue by Owner</p>
                  <div className="space-y-1.5">
                    {opsExceptions.overdueByOwner.map((o, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground truncate">{o.owner || "Unassigned"}</span>
                        <Badge variant="outline" className={o.count > 3 ? "bg-red-50 text-red-700 border-red-200" : ""}>{o.count}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </AdminQueryState>
        </CardContent>
      </Card>

      <Card data-testid="card-permission-enforcement">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-emerald-600" />
            Permission Enforcement Coverage
          </CardTitle>
          <CardDescription>Backend security enforcement status and recent governance signals</CardDescription>
        </CardHeader>
        <CardContent>
          <AdminQueryState
            isLoading={permEnforcementLoading}
            error={permEnforcementQuery.error ? getQueryError(permEnforcementQuery.error, "Permission enforcement coverage could not be loaded.") : null}
            onRetry={() => { void permEnforcementQuery.refetch(); }}
            loadingLabel="Loading permission enforcement coverage..."
          >
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-700">{permEnforcement.summary.totalBackendEnforcedRoutes}</p>
                  <p className="text-xs text-muted-foreground">Backend-Enforced Routes</p>
                </div>
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-center">
                  <p className="text-2xl font-bold text-blue-700">{permEnforcement.summary.totalOwnershipScopedEndpoints}</p>
                  <p className="text-xs text-muted-foreground">Ownership-Scoped</p>
                </div>
                <div className="rounded-lg border p-3 text-center border-border">
                  <p className="text-2xl font-bold text-foreground">{permEnforcement.summary.totalApplicationLogicOnly}</p>
                  <p className="text-xs text-muted-foreground">Application Logic Only</p>
                </div>
                <div className={`rounded-lg border p-3 text-center ${permEnforcement.summary.recentAccessDenials7d > 0 ? "border-amber-200 bg-amber-50" : "border-border"}`}>
                  <p className={`text-2xl font-bold ${permEnforcement.summary.recentAccessDenials7d > 0 ? "text-amber-600" : "text-foreground"}`}>{permEnforcement.summary.recentAccessDenials7d}</p>
                  <p className="text-xs text-muted-foreground">Access Denials (7d)</p>
                </div>
                <div className={`rounded-lg border p-3 text-center ${permEnforcement.summary.recentImportIssues7d > 0 ? "border-red-200 bg-red-50" : "border-border"}`}>
                  <p className={`text-2xl font-bold ${permEnforcement.summary.recentImportIssues7d > 0 ? "text-red-600" : "text-foreground"}`}>{permEnforcement.summary.recentImportIssues7d}</p>
                  <p className="text-xs text-muted-foreground">Import Issues (7d)</p>
                </div>
              </div>
              <Separator />
              <details className="text-sm">
                <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">View Backend-Enforced Routes ({permEnforcement.backendEnforced.length})</summary>
                <div className="mt-2 max-h-48 overflow-y-auto border rounded-md">
                  <Table>
                    <TableHeader><TableRow><TableHead className="text-xs">Route</TableHead><TableHead className="text-xs">Entity</TableHead><TableHead className="text-xs">Level</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {permEnforcement.backendEnforced.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs font-mono py-1">{r.route}</TableCell>
                          <TableCell className="text-xs py-1"><Badge variant="outline" className="text-[10px]">{r.entity}/{r.action}</Badge></TableCell>
                          <TableCell className="text-xs py-1">{r.level}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </details>
              <details className="text-sm">
                <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">View Ownership-Scoped Endpoints ({permEnforcement.ownershipScoping.length})</summary>
                <div className="mt-2 max-h-32 overflow-y-auto border rounded-md">
                  <Table>
                    <TableHeader><TableRow><TableHead className="text-xs">Endpoint</TableHead><TableHead className="text-xs">Scope</TableHead><TableHead className="text-xs">Enforced</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {permEnforcement.ownershipScoping.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs font-mono py-1">{r.endpoint}</TableCell>
                          <TableCell className="text-xs py-1">{r.scope}</TableCell>
                          <TableCell className="text-xs py-1"><Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">{r.enforced}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </details>
            </div>
          </AdminQueryState>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card data-testid="card-quick-links">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ExternalLink className="h-4 w-4 text-sky-600" />
              Quick Links
            </CardTitle>
            <CardDescription>Primary admin structure for day-to-day operations</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {quickLinkSections.map((section) => (
                <div key={section.title} className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.title}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {section.items.map((link) => (
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
                </div>
              ))}
            </div>
            <details className="pt-2">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
                Secondary utilities (maintenance only)
              </summary>
              <div className="grid grid-cols-1 gap-2 mt-2">
                {secondaryUtilityLinks.map((link) => (
                  <a
                    key={link.path}
                    href={link.path}
                    className="flex items-center gap-2 p-2.5 rounded-lg border border-dashed border-border hover:bg-accent transition-colors text-sm"
                    data-testid={`secondary-link-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <link.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="truncate">{link.label}</span>
                  </a>
                ))}
              </div>
            </details>

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
            <AdminQueryState
              isLoading={enumsLoading}
              error={enumsQuery.error ? getQueryError(enumsQuery.error, "Reference enums could not be loaded.") : null}
              onRetry={() => { void enumsQuery.refetch(); }}
              loadingLabel="Loading system reference data..."
            >
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
            </AdminQueryState>
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
          <AdminQueryState
            isLoading={flagsLoading}
            error={flagsQuery.error ? getQueryError(flagsQuery.error, "Feature flag controls could not be loaded.") : null}
            onRetry={() => { void flagsQuery.refetch(); void rolloutFoundationQuery.refetch(); }}
            empty={!flags || flags.length === 0}
            emptyTitle="No feature flags configured"
            emptyDescription="Feature governance flags will appear here once configured."
            loadingLabel="Loading feature flags..."
          >
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
                    onCheckedChange={(checked) => {
                      const rolloutFlag = rolloutFoundation?.flags?.find((item) => item.key === flag.key);
                      if (cleanedAdminVisibilityEnabled && rolloutFlag && rolloutFlag.defaultValue !== checked) {
                        setFlagOverrideDraft({ key: flag.key, value: checked, suggestedValue: rolloutFlag.defaultValue, reason: "" });
                        return;
                      }
                      toggleFlag.mutate({ key: flag.key, value: checked, suggestedValue: rolloutFlag?.defaultValue ?? null });
                    }}
                    data-testid={`switch-flag-${flag.key}`}
                  />
                </div>
              ))}
            </div>
          </AdminQueryState>
        </CardContent>
      </Card>

      <Card data-testid="card-active-sessions">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-indigo-600" />
            Active Sessions
            {activeSessions && (
              <Badge variant="outline" className="ml-2">{activeSessions.count}</Badge>
            )}
          </CardTitle>
          <CardDescription>Currently logged-in users</CardDescription>
        </CardHeader>
        <CardContent>
          <AdminQueryState
            isLoading={sessionsLoading}
            error={activeSessionsQuery.error ? getQueryError(activeSessionsQuery.error, "Active session data could not be loaded.") : null}
            onRetry={() => { void activeSessionsQuery.refetch(); }}
            empty={!activeSessions || activeSessions.sessions.length === 0}
            emptyTitle="No active sessions found"
            emptyDescription="When users are signed in, their current sessions will appear here."
            loadingLabel="Loading active sessions..."
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-[80px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeSessions.sessions.map((session) => (
                  <TableRow key={session.sid} data-testid={`row-session-${session.sid}`}>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium" data-testid={`text-session-user-${session.sid}`}>
                          {session.userName || "Unknown"}
                        </p>
                        <p className="text-xs text-muted-foreground">{session.username || `ID: ${session.userId}`}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{session.userRole || "—"}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(session.expiresAt).toLocaleString()}
                      </div>
                    </TableCell>
                    <TableCell>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 text-red-600 hover:text-red-700 hover:bg-red-50" data-testid={`button-force-logout-${session.sid}`}>
                            <LogOut className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Force Logout?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will terminate {session.userName || "this user"}'s session immediately.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => forceLogout.mutate(session.sid)}
                              className="bg-red-600 hover:bg-red-700"
                              data-testid={`button-confirm-force-logout-${session.sid}`}
                            >
                              Force Logout
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AdminQueryState>
        </CardContent>
      </Card>

      <Card data-testid="card-integration-health">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4 text-violet-600" />
            Integration Health
          </CardTitle>
          <CardDescription>Detailed sync status per integration type</CardDescription>
        </CardHeader>
        <CardContent>
          <AdminQueryState
            isLoading={integrationHealthLoading}
            error={integrationHealthQuery.error ? getQueryError(integrationHealthQuery.error, "Detailed integration health could not be loaded.") : null}
            onRetry={() => { void integrationHealthQuery.refetch(); }}
            empty={!integrationHealth || integrationHealth.length === 0}
            emptyTitle="No integration health data available"
            emptyDescription="Connected Microsoft surfaces will expose detailed sync state here."
            loadingLabel="Loading detailed integration health..."
          >
            <div className="space-y-3">
              {integrationHealth.map((item) => (
                <div key={item.type} className="flex items-center justify-between p-3 rounded-lg border border-border" data-testid={`row-integration-${item.type}`}>
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      {item.status === "connected" ? (
                        <Wifi className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <WifiOff className="h-3.5 w-3.5 text-slate-400" />
                      )}
                      <p className="text-sm font-medium">{item.name}</p>
                    </div>
                    {item.lastSyncTime && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 ml-5">
                        <Clock className="h-3 w-3" />
                        Last sync: {new Date(item.lastSyncTime).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">{item.objectCount} objects</span>
                    <Badge
                      variant="outline"
                      className={item.status === "connected" ? "bg-green-50 text-green-700 border-green-200" : "bg-slate-50 text-slate-500 border-slate-200"}
                      data-testid={`status-integration-${item.type}`}
                    >
                      {item.status === "connected" ? "Connected" : "Not Connected"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </AdminQueryState>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card data-testid="card-import-failures">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileUp className="h-4 w-4 text-red-600" />
              Recent Import Failures
            </CardTitle>
            <CardDescription>Last 10 failed import runs</CardDescription>
          </CardHeader>
          <CardContent>
            <AdminQueryState
              isLoading={importFailuresLoading}
              error={importFailuresQuery.error ? getQueryError(importFailuresQuery.error, "Recent import failures could not be loaded.") : null}
              onRetry={() => { void importFailuresQuery.refetch(); }}
              empty={!importFailures || importFailures.length === 0}
              emptyTitle="No recent import failures"
              emptyDescription="Failed runs and blocker-heavy imports will appear here for review."
              loadingLabel="Loading recent import failures..."
            >
              <div className="space-y-3">
                {importFailures.map((failure) => (
                  <div key={failure.id} className="p-3 rounded-lg border border-red-100 bg-red-50/30 space-y-1" data-testid={`row-import-failure-${failure.id}`}>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium truncate max-w-[200px]">{failure.projectName}</p>
                      <span className="text-xs text-muted-foreground">
                        {new Date(failure.uploadedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{failure.fileName}</p>
                    {failure.uploadedBy && (
                      <p className="text-xs text-muted-foreground">By: {failure.uploadedBy}</p>
                    )}
                    <div className="flex items-center gap-2">
                      {failure.blockerCount > 0 && (
                        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">
                          {failure.blockerCount} blockers
                        </Badge>
                      )}
                      {failure.recordsFailed != null && failure.recordsFailed > 0 && (
                        <Badge variant="outline" className="text-xs">
                          {failure.recordsFailed} records failed
                        </Badge>
                      )}
                    </div>
                    {failure.topError && (
                      <p className="text-xs text-red-600 truncate" data-testid={`text-error-${failure.id}`}>
                        {failure.topError}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </AdminQueryState>
          </CardContent>
        </Card>

        <Card data-testid="card-system-issues">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Recent System Events
            </CardTitle>
            <CardDescription>Administrative and error events</CardDescription>
          </CardHeader>
          <CardContent>
            <AdminQueryState
              isLoading={systemIssuesLoading}
              error={systemIssuesQuery.error ? getQueryError(systemIssuesQuery.error, "Recent system events could not be loaded.") : null}
              onRetry={() => { void systemIssuesQuery.refetch(); }}
              empty={!systemIssues || systemIssues.length === 0}
              emptyTitle="No recent system events"
              emptyDescription="Administrative errors, recovery actions, and system events will appear here."
              loadingLabel="Loading recent system events..."
            >
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {systemIssues.map((issue) => (
                  <div key={issue.id} className="p-2.5 rounded-lg border border-border space-y-0.5" data-testid={`row-system-issue-${issue.id}`}>
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="text-xs">{issue.action}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(issue.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {issue.entityType}{issue.entityId ? ` #${issue.entityId}` : ""}
                      {issue.userName && ` · ${issue.userName}`}
                      {issue.projectName && ` · ${issue.projectName}`}
                    </p>
                    {issue.requestPath && (
                      <p className="text-xs text-muted-foreground font-mono truncate">{issue.requestPath}</p>
                    )}
                  </div>
                ))}
              </div>
            </AdminQueryState>
          </CardContent>
        </Card>
      </div>

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

      <Dialog open={!!flagOverrideDraft} onOpenChange={(open) => { if (!open) setFlagOverrideDraft(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override suggested flag value</DialogTitle>
            <DialogDescription>
              A reason is required when overriding the recommended value. This is audit logged with suggested and final values.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="flag-override-reason">Reason</Label>
            <Input
              id="flag-override-reason"
              value={flagOverrideDraft?.reason ?? ""}
              onChange={(e) => setFlagOverrideDraft((prev) => (prev ? { ...prev, reason: e.target.value } : prev))}
              placeholder="Describe why the suggested value is being overridden"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFlagOverrideDraft(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!flagOverrideDraft) return;
                toggleFlag.mutate({
                  key: flagOverrideDraft.key,
                  value: flagOverrideDraft.value,
                  suggestedValue: flagOverrideDraft.suggestedValue,
                  reason: flagOverrideDraft.reason,
                });
              }}
              disabled={!flagOverrideDraft?.reason.trim() || toggleFlag.isPending}
            >
              Save override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
    </AdminPageShell>
  );
}
