import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2,
  Save,
  Plug,
  CheckCircle,
  XCircle,
  AlertTriangle,
  CloudCog,
  Folder,
  FolderOpen,
  ChevronRight,
  ArrowLeft,
  FileText,
  MessageSquare,
  Shield,
  Settings2,
  Globe,
  HardDrive,
  Tag,
  Clock,
  Zap,
  Activity,
  Mail,
  CheckCircle2,
  RefreshCw,
  Calendar,
  Send,
  Users,
  Pencil,
  Search,
} from "lucide-react";

function authFetch(url: string, opts?: RequestInit) {
  return fetch(url, { ...opts, credentials: "include" });
}

interface MsIntegrationConfig {
  feature_flags?: {
    feature_ms_sharepoint_docs: boolean;
    feature_ms_teams: boolean;
  };
  sharepoint_project_docs?: {
    siteUrl: string;
    siteId: string;
    driveId: string;
    driveName: string;
    siteName: string;
    lastTestedAt: string | null;
    connectionStatus: string;
  };
  teams_config?: {
    unansweredThresholdHours: number;
    hotThresholdHours: number;
    tags: string[];
  };
}

interface DriveInfo {
  id: string;
  name: string;
  description: string;
  webUrl: string;
}

interface TestResult {
  success: boolean;
  siteId?: string;
  siteName?: string;
  siteWebUrl?: string;
  drives?: DriveInfo[];
  error?: string;
}

interface OutlookConnection {
  configured: boolean;
  connected: boolean;
  email?: string;
}

interface MsIntegrationStatus {
  outlook: { configured: boolean; connected: boolean; email: string | null };
  sharepoint: { enabled: boolean; connected: boolean; siteName: string | null; driveName: string | null };
  teams: { enabled: boolean; configured: boolean; tags: string[] };
  user: { id: number; name: string; role: string };
}

export default function MsIntegrationSettingsPage() {
  const { isAdmin, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const defaultTab = typeof window !== 'undefined' && window.location.pathname.includes('/ms-mapping') ? 'users' : 'overview';
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [siteUrl, setSiteUrl] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [selectedDriveId, setSelectedDriveId] = useState("");
  const [selectedDriveName, setSelectedDriveName] = useState("");
  const [refreshingOutlook, setRefreshingOutlook] = useState(false);

  const [featureFlags, setFeatureFlags] = useState({
    feature_ms_sharepoint_docs: false,
    feature_ms_teams: false,
  });

  const [teamsConfig, setTeamsConfig] = useState({
    unansweredThresholdHours: 48,
    hotThresholdHours: 24,
    tags: ["finance-payment", "finance-invoice", "decision", "risk", "blocked", "snag", "client", "internal"],
  });

  const { data: integrationStatus } = useQuery<MsIntegrationStatus>({
    queryKey: ["/api/ms-integration/status"],
    queryFn: async () => {
      const res = await authFetch("/api/ms-integration/status");
      if (!res.ok) throw new Error("Failed to load status");
      return res.json();
    },
  });

  const { data: outlookStatus, refetch: refetchOutlook } = useQuery<OutlookConnection>({
    queryKey: ["/api/outlook/status"],
    retry: false,
  });

  const handleRefreshOutlook = async () => {
    setRefreshingOutlook(true);
    try {
      const res = await authFetch("/api/outlook/refresh", { method: "POST" });
      const result = await res.json();
      queryClient.setQueryData(["/api/outlook/status"], result);
      if (result.connected) {
        toast({ title: "Outlook reconnected", description: result.email ? `Connected as ${result.email}` : "Connection restored." });
      } else {
        toast({ title: "Still disconnected", description: "The connection could not be restored. The token may need re-authorization.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Refresh failed", description: err.message, variant: "destructive" });
    } finally {
      setRefreshingOutlook(false);
      refetchOutlook();
    }
  };

  const { data: config, isLoading } = useQuery<MsIntegrationConfig>({
    queryKey: ["/api/admin/ms-integration"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/ms-integration");
      if (!res.ok) throw new Error("Failed to load config");
      return res.json();
    },
    enabled: isAdmin,
  });

  useEffect(() => {
    if (config) {
      if (config.feature_flags) setFeatureFlags(config.feature_flags);
      if (config.sharepoint_project_docs) {
        setSiteUrl(config.sharepoint_project_docs.siteUrl || "");
        setSelectedDriveId(config.sharepoint_project_docs.driveId || "");
        setSelectedDriveName(config.sharepoint_project_docs.driveName || "");
      }
      if (config.teams_config) setTeamsConfig(config.teams_config);
    }
  }, [config]);

  const saveConfigMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: any }) => {
      const res = await authFetch(`/api/admin/ms-integration/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/ms-integration"] });
      toast({ title: "Settings saved" });
    },
    onError: () => {
      toast({ title: "Error saving settings", variant: "destructive" });
    },
  });

  const testSiteMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await authFetch("/api/admin/ms-integration/test-sharepoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteUrl: url }),
      });
      if (!res.ok) throw new Error("Connection test failed");
      return res.json() as Promise<TestResult>;
    },
    onSuccess: (result) => {
      setTestResult(result);
      if (result.success) {
        const driveCount = result.drives?.length || 0;
        const desc = driveCount > 0
          ? `${result.siteName} — ${driveCount} document libraries found`
          : result.drivesError
            ? `${result.siteName} — ${result.drivesError}`
            : `${result.siteName} — 0 document libraries found. The app may need Sites.Read.All permission in Azure AD.`;
        toast({ title: "Site found", description: desc, variant: driveCount > 0 ? "default" : undefined });
      } else {
        toast({ title: "Connection failed", description: result.error, variant: "destructive" });
      }
    },
    onError: (err: Error) => {
      setTestResult({ success: false, error: err.message });
      toast({ title: "Connection failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSaveSharePoint = () => {
    saveConfigMutation.mutate({
      key: "sharepoint_project_docs",
      value: {
        siteUrl,
        siteId: testResult?.siteId || config?.sharepoint_project_docs?.siteId || "",
        driveId: selectedDriveId,
        driveName: selectedDriveName,
        siteName: testResult?.siteName || config?.sharepoint_project_docs?.siteName || "",
        lastTestedAt: testResult?.success ? new Date().toISOString() : config?.sharepoint_project_docs?.lastTestedAt || null,
        connectionStatus: testResult?.success ? "connected" : config?.sharepoint_project_docs?.connectionStatus || "not_configured",
      },
    });
  };

  const handleSaveFeatureFlags = () => {
    saveConfigMutation.mutate({ key: "feature_flags", value: featureFlags });
  };

  const handleSaveTeamsConfig = () => {
    saveConfigMutation.mutate({ key: "teams_config", value: teamsConfig });
  };

  const [userSearch, setUserSearch] = useState("");
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editMsId, setEditMsId] = useState("");
  const [editEmail, setEditEmail] = useState("");

  const { data: userMappings = [], isLoading: usersLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/users/microsoft-mapping"],
    enabled: isAdmin,
  });

  const updateMappingMutation = useMutation({
    mutationFn: ({ userId, microsoftId, email }: { userId: number; microsoftId: string; email: string }) =>
      apiRequest("PATCH", `/api/admin/users/${userId}/microsoft-id`, { microsoftId, email }),
    onSuccess: () => {
      toast({ title: "Microsoft mapping updated" });
      setEditingUser(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users/microsoft-mapping"] });
    },
    onError: (err: any) =>
      toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const filteredUsers = userMappings.filter((u: any) => {
    if (!userSearch.trim()) return true;
    const q = userSearch.toLowerCase();
    return u.name?.toLowerCase().includes(q) || u.username?.toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) || u.role?.toLowerCase().includes(q);
  });

  const linkedCount = userMappings.filter((u: any) => u.microsoftId).length;
  const unlinkedCount = userMappings.filter((u: any) => !u.microsoftId).length;

  if (isLoading && isAdmin) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const spConfig = config?.sharepoint_project_docs;
  const isConnected = spConfig?.connectionStatus === "connected";

  const outlookConnected = integrationStatus?.outlook?.connected || outlookStatus?.connected;
  const outlookEmail = integrationStatus?.outlook?.email || outlookStatus?.email;
  const outlookConfigured = integrationStatus?.outlook?.configured ?? outlookStatus?.configured;
  const spEnabled = integrationStatus?.sharepoint?.enabled || featureFlags.feature_ms_sharepoint_docs;
  const spConnected = integrationStatus?.sharepoint?.connected || isConnected;
  const teamsEnabled = integrationStatus?.teams?.enabled || featureFlags.feature_ms_teams;

  if (!isAdmin) {
    return (
      <div className="space-y-6 max-w-[960px] mx-auto" data-testid="ms-integration-status-page">
        <header>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 flex items-center gap-2" data-testid="text-page-title">
            <Settings2 className="h-7 w-7 text-blue-600" />
            Microsoft Integration Status
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            View the status of Outlook, SharePoint, and Teams connections linked to your account
          </p>
        </header>

        <Card data-testid="card-user-info">
          <CardContent className="py-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                <span className="text-sm font-bold text-blue-700">{user?.name?.charAt(0)?.toUpperCase() || "?"}</span>
              </div>
              <div>
                <p className="text-sm font-semibold" data-testid="text-user-name">{user?.name || "User"}</p>
                <p className="text-xs text-muted-foreground" data-testid="text-user-role">{(user as any)?.companyRole || (user as any)?.role || "Team Member"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card data-testid="card-outlook-status">
            <CardContent className="py-5">
              <div className="flex items-center gap-3 mb-3">
                <div className={`p-2.5 rounded-lg ${outlookConnected ? "bg-blue-100" : "bg-gray-100"}`}>
                  <Mail className={`h-5 w-5 ${outlookConnected ? "text-blue-600" : "text-gray-400"}`} />
                </div>
                <div>
                  <p className="text-sm font-semibold">Outlook</p>
                  <Badge variant="outline" className={`text-[10px] mt-0.5 ${outlookConnected ? "bg-emerald-50 text-emerald-700 border-emerald-200" : outlookConfigured === false ? "bg-gray-50 text-gray-500 border-gray-200" : "bg-amber-50 text-amber-700 border-amber-200"}`} data-testid="badge-outlook-user-status">
                    {outlookConnected ? "Connected" : outlookConfigured === false ? "Not Set Up" : "Disconnected"}
                  </Badge>
                </div>
              </div>
              <div className="text-xs text-muted-foreground space-y-1.5">
                {outlookConnected && outlookEmail && (
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                    <span>{outlookEmail}</span>
                  </div>
                )}
                <p>Calendar sync, email access, approval emails</p>
              </div>
              {outlookConnected && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 mt-3 text-xs"
                  onClick={handleRefreshOutlook}
                  disabled={refreshingOutlook}
                  data-testid="button-user-refresh-outlook"
                >
                  {refreshingOutlook ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Refresh Connection
                </Button>
              )}
            </CardContent>
          </Card>

          <Card data-testid="card-sharepoint-status">
            <CardContent className="py-5">
              <div className="flex items-center gap-3 mb-3">
                <div className={`p-2.5 rounded-lg ${spConnected && spEnabled ? "bg-green-100" : "bg-gray-100"}`}>
                  <FileText className={`h-5 w-5 ${spConnected && spEnabled ? "text-green-600" : "text-gray-400"}`} />
                </div>
                <div>
                  <p className="text-sm font-semibold">SharePoint</p>
                  <Badge variant="outline" className={`text-[10px] mt-0.5 ${spConnected && spEnabled ? "bg-emerald-50 text-emerald-700 border-emerald-200" : !spEnabled ? "bg-gray-50 text-gray-500 border-gray-200" : "bg-amber-50 text-amber-700 border-amber-200"}`} data-testid="badge-sp-user-status">
                    {spConnected && spEnabled ? "Connected" : !spEnabled ? "Not Enabled" : "Not Configured"}
                  </Badge>
                </div>
              </div>
              <div className="text-xs text-muted-foreground space-y-1.5">
                {spConnected && integrationStatus?.sharepoint?.siteName && (
                  <div className="flex items-center gap-1.5">
                    <Folder className="h-3 w-3 text-green-500" />
                    <span>{integrationStatus.sharepoint.siteName}</span>
                  </div>
                )}
                <p>Project document storage and browsing</p>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-teams-status">
            <CardContent className="py-5">
              <div className="flex items-center gap-3 mb-3">
                <div className={`p-2.5 rounded-lg ${teamsEnabled ? "bg-purple-100" : "bg-gray-100"}`}>
                  <MessageSquare className={`h-5 w-5 ${teamsEnabled ? "text-purple-600" : "text-gray-400"}`} />
                </div>
                <div>
                  <p className="text-sm font-semibold">Teams</p>
                  <Badge variant="outline" className={`text-[10px] mt-0.5 ${teamsEnabled ? "bg-purple-50 text-purple-700 border-purple-200" : "bg-gray-50 text-gray-500 border-gray-200"}`} data-testid="badge-teams-user-status">
                    {teamsEnabled ? "Enabled" : "Not Enabled"}
                  </Badge>
                </div>
              </div>
              <div className="text-xs text-muted-foreground space-y-1.5">
                <p>Link Teams messages to projects, create tasks</p>
                {teamsEnabled && integrationStatus?.teams?.tags && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {integrationStatus.teams.tags.slice(0, 4).map(tag => (
                      <Badge key={tag} variant="outline" className="text-[9px] py-0 px-1">{tag}</Badge>
                    ))}
                    {integrationStatus.teams.tags.length > 4 && (
                      <Badge variant="outline" className="text-[9px] py-0 px-1">+{integrationStatus.teams.tags.length - 4}</Badge>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <Shield className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
              <p>Integration settings are managed by administrators. Contact your COO or system admin if you need changes to these connections.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 flex-1 max-w-[960px] mx-auto w-full" data-testid="ms-integration-settings-page">
      <header className="shrink-0 mb-4">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 flex items-center gap-2" data-testid="text-page-title">
          <Settings2 className="h-7 w-7 text-blue-600" />
          Microsoft Integration Settings
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage Outlook, SharePoint, and Teams connections for all Microsoft features
        </p>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col min-h-0 flex-1">
        <TabsList className="grid w-full grid-cols-6 h-10 shrink-0">
          <TabsTrigger value="overview" className="text-xs gap-1" data-testid="tab-overview">
            <Activity className="h-3.5 w-3.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="outlook" className="text-xs gap-1" data-testid="tab-outlook">
            <Mail className="h-3.5 w-3.5" /> Outlook
          </TabsTrigger>
          <TabsTrigger value="sharepoint" className="text-xs gap-1" data-testid="tab-sharepoint">
            <FileText className="h-3.5 w-3.5" /> SharePoint
          </TabsTrigger>
          <TabsTrigger value="teams" className="text-xs gap-1" data-testid="tab-teams">
            <MessageSquare className="h-3.5 w-3.5" /> Teams
          </TabsTrigger>
          <TabsTrigger value="users" className="text-xs gap-1" data-testid="tab-users">
            <Users className="h-3.5 w-3.5" /> Users
          </TabsTrigger>
          <TabsTrigger value="permissions" className="text-xs gap-1" data-testid="tab-permissions">
            <Shield className="h-3.5 w-3.5" /> Permissions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 flex-1 overflow-y-auto min-h-0 space-y-4">
          <Card data-testid="card-feature-flags">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-600" />
                Feature Flags
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-blue-600" />
                  <div>
                    <p className="text-sm font-medium">SharePoint Project Documents</p>
                    <p className="text-xs text-muted-foreground">Browse and upload files from SharePoint on project pages</p>
                  </div>
                </div>
                <Switch
                  checked={featureFlags.feature_ms_sharepoint_docs}
                  onCheckedChange={(checked) => setFeatureFlags({ ...featureFlags, feature_ms_sharepoint_docs: checked })}
                  data-testid="switch-feature-sharepoint"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-3">
                  <MessageSquare className="h-5 w-5 text-purple-600" />
                  <div>
                    <p className="text-sm font-medium">Teams Integration</p>
                    <p className="text-xs text-muted-foreground">Link Teams messages to projects, create tasks, and track hot threads</p>
                  </div>
                </div>
                <Switch
                  checked={featureFlags.feature_ms_teams}
                  onCheckedChange={(checked) => setFeatureFlags({ ...featureFlags, feature_ms_teams: checked })}
                  data-testid="switch-feature-teams"
                />
              </div>

              <Button onClick={handleSaveFeatureFlags} disabled={saveConfigMutation.isPending} className="gap-1" data-testid="button-save-flags">
                <Save className="h-4 w-4" /> Save Feature Flags
              </Button>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="py-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`p-2 rounded-lg ${outlookConnected ? "bg-blue-100" : "bg-gray-100"}`}>
                    <Mail className={`h-5 w-5 ${outlookConnected ? "text-blue-600" : "text-gray-400"}`} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Outlook Connection</p>
                    <Badge variant="outline" className={`text-[10px] ${outlookConnected ? "bg-blue-50 text-blue-700 border-blue-200" : outlookConfigured === false ? "bg-gray-50 text-gray-500 border-gray-200" : "bg-amber-50 text-amber-700 border-amber-200"}`} data-testid="badge-outlook-status">
                      {outlookConnected ? "Connected" : outlookConfigured === false ? "Not Configured" : "Disconnected"}
                    </Badge>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  {outlookConnected && outlookEmail && <p>Account: {outlookEmail}</p>}
                  <p>Calendar, Email, Approvals</p>
                  <p>Powers My Tool features</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`p-2 rounded-lg ${isConnected ? "bg-green-100" : "bg-gray-100"}`}>
                    <FileText className={`h-5 w-5 ${isConnected ? "text-green-600" : "text-gray-400"}`} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">SharePoint Documents</p>
                    <Badge variant="outline" className={`text-[10px] ${isConnected ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-500 border-gray-200"}`} data-testid="badge-sp-status">
                      {isConnected ? "Connected" : "Not Configured"}
                    </Badge>
                  </div>
                </div>
                {isConnected && spConfig && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>Site: {spConfig.siteName}</p>
                    <p>Library: {spConfig.driveName}</p>
                    {spConfig.lastTestedAt && <p>Last tested: {new Date(spConfig.lastTestedAt).toLocaleString()}</p>}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`p-2 rounded-lg ${featureFlags.feature_ms_teams ? "bg-purple-100" : "bg-gray-100"}`}>
                    <MessageSquare className={`h-5 w-5 ${featureFlags.feature_ms_teams ? "text-purple-600" : "text-gray-400"}`} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Teams Integration</p>
                    <Badge variant="outline" className={`text-[10px] ${featureFlags.feature_ms_teams ? "bg-purple-50 text-purple-700 border-purple-200" : "bg-gray-50 text-gray-500 border-gray-200"}`} data-testid="badge-teams-status">
                      {featureFlags.feature_ms_teams ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Unanswered threshold: {teamsConfig.unansweredThresholdHours}h</p>
                  <p>Hot thread threshold: {teamsConfig.hotThresholdHours}h</p>
                  <p>Tags: {teamsConfig.tags.length} configured</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4 text-slate-600" />
                Required Microsoft Graph Permissions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="space-y-1.5">
                  <p className="font-semibold text-sm">Outlook (Calendar & Email)</p>
                  <div className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Calendars.ReadWrite</div>
                  <div className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Mail.ReadWrite</div>
                  <div className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Mail.Send</div>
                  <div className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> User.Read</div>
                </div>
                <div className="space-y-1.5">
                  <p className="font-semibold text-sm">SharePoint Documents</p>
                  <div className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Sites.Read.All</div>
                  <div className="flex items-center gap-2"><CheckCircle className="h-3 w-3 text-green-500" /> Files.ReadWrite.All</div>
                </div>
                <div className="space-y-1.5">
                  <p className="font-semibold text-sm">Teams Integration</p>
                  <div className="flex items-center gap-2"><AlertTriangle className="h-3 w-3 text-amber-500" /> ChannelMessage.Read.All</div>
                  <div className="flex items-center gap-2"><AlertTriangle className="h-3 w-3 text-amber-500" /> Chat.Read</div>
                  <div className="flex items-center gap-2"><AlertTriangle className="h-3 w-3 text-amber-500" /> Team.ReadBasic.All</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">Green = already granted via Outlook connector. Amber = may need to be added in Azure/Entra.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="outlook" className="mt-4 flex-1 overflow-y-auto min-h-0 space-y-4">
          <Card data-testid="card-outlook-connection">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Mail className="h-4 w-4 text-blue-600" />
                Microsoft Account Connection
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <p className="text-sm text-muted-foreground">
                This Microsoft account powers all integrations — Outlook calendar, email, approval emails, SharePoint, and Teams.
                All features in My Tool (calendar sync, inbox, time blocks) use this connection.
              </p>

              {outlookStatus?.connected ? (
                <div className="p-4 rounded-lg bg-emerald-50/50 border border-emerald-200/50 space-y-3" data-testid="outlook-connection-connected">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                    <span className="text-sm font-semibold text-emerald-700">Connected</span>
                    {outlookStatus.email && (
                      <Badge variant="secondary" className="text-xs ml-1">{outlookStatus.email}</Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                    <div className="flex items-center gap-2 p-2 rounded border border-emerald-200/50 bg-white/50">
                      <Calendar className="h-4 w-4 text-blue-500" />
                      <span className="text-xs text-slate-600">Calendar Sync</span>
                      <CheckCircle className="h-3 w-3 text-emerald-500 ml-auto" />
                    </div>
                    <div className="flex items-center gap-2 p-2 rounded border border-emerald-200/50 bg-white/50">
                      <Mail className="h-4 w-4 text-blue-500" />
                      <span className="text-xs text-slate-600">Email Access</span>
                      <CheckCircle className="h-3 w-3 text-emerald-500 ml-auto" />
                    </div>
                    <div className="flex items-center gap-2 p-2 rounded border border-emerald-200/50 bg-white/50">
                      <Send className="h-4 w-4 text-blue-500" />
                      <span className="text-xs text-slate-600">Approval Emails</span>
                      <CheckCircle className="h-3 w-3 text-emerald-500 ml-auto" />
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 mt-2"
                    onClick={handleRefreshOutlook}
                    disabled={refreshingOutlook}
                    data-testid="button-refresh-outlook"
                  >
                    {refreshingOutlook ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Refresh Connection
                  </Button>
                </div>
              ) : outlookStatus?.configured === false ? (
                <div className="p-4 rounded-lg bg-amber-50/50 border border-amber-200/50" data-testid="outlook-connection-not-configured">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-sm font-semibold text-amber-700">Not Configured</span>
                      <p className="text-xs text-muted-foreground mt-1">
                        The Outlook connector has not been set up yet. This needs to be configured through the platform's integration settings to enable calendar, email, and approval features.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-lg bg-amber-50/50 border border-amber-200/50" data-testid="outlook-connection-issue">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <span className="text-sm font-semibold text-amber-700">Connection Issue</span>
                      <p className="text-xs text-muted-foreground mt-1">
                        The connection may need to be refreshed. The token may have expired and needs re-authorization.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 gap-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                      onClick={handleRefreshOutlook}
                      disabled={refreshingOutlook}
                      data-testid="button-reconnect-outlook"
                    >
                      {refreshingOutlook ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      Reconnect
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Plug className="h-4 w-4 text-slate-600" />
                What This Connection Powers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground space-y-3">
                <div className="p-3 border rounded-lg">
                  <p className="text-sm font-semibold text-slate-700 mb-1">My Tool — Calendar</p>
                  <ul className="list-disc ml-4 space-y-1">
                    <li>Outlook calendar events shown in day planner and weekly view</li>
                    <li>Time blocks sync back to a dedicated "EE — My Tool Blocks" calendar</li>
                    <li>Events marked with "My Tool" category in Outlook</li>
                  </ul>
                </div>
                <div className="p-3 border rounded-lg">
                  <p className="text-sm font-semibold text-slate-700 mb-1">My Tool — Email</p>
                  <ul className="list-disc ml-4 space-y-1">
                    <li>Browse, read, reply, and forward Outlook emails from within the app</li>
                    <li>Convert emails to tasks with one click (Email-to-Task)</li>
                    <li>Search across mail folders</li>
                  </ul>
                </div>
                <div className="p-3 border rounded-lg">
                  <p className="text-sm font-semibold text-slate-700 mb-1">Approval Emails</p>
                  <ul className="list-disc ml-4 space-y-1">
                    <li>HTML approval emails with Approve/Reject buttons sent via Outlook</li>
                    <li>Used for procurement, engineering gates, and quality workflows</li>
                  </ul>
                </div>
                <div className="p-3 border rounded-lg">
                  <p className="text-sm font-semibold text-slate-700 mb-1">SharePoint & Teams</p>
                  <ul className="list-disc ml-4 space-y-1">
                    <li>Same Microsoft account provides access to SharePoint document libraries</li>
                    <li>Teams message reading uses the same connection token</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sharepoint" className="mt-4 flex-1 overflow-y-auto min-h-0 space-y-4">
          <Card data-testid="card-sharepoint-config">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="h-4 w-4 text-blue-600" />
                SharePoint Site Connection
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="sp-site-url" data-testid="label-site-url">SharePoint Site URL</Label>
                <Input
                  id="sp-site-url"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  placeholder="https://yourcompany.sharepoint.com/sites/Projects"
                  data-testid="input-site-url"
                />
                <p className="text-xs text-muted-foreground">
                  Enter your SharePoint site URL where project documents are stored
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setTestResult(null);
                    testSiteMutation.mutate(siteUrl);
                  }}
                  disabled={testSiteMutation.isPending || !siteUrl.trim()}
                  data-testid="button-test-site"
                >
                  {testSiteMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plug className="h-4 w-4 mr-2" />
                  )}
                  Test Connection
                </Button>
              </div>

              {testResult && (
                <div
                  className={`p-4 rounded-lg border ${
                    testResult.success
                      ? "bg-green-50 border-green-200"
                      : "bg-red-50 border-red-200"
                  }`}
                  data-testid="test-result"
                >
                  {testResult.success ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-green-700 font-medium">
                        <CheckCircle className="h-4 w-4" />
                        Site found: {testResult.siteName}
                      </div>

                      {testResult.drives && testResult.drives.length > 0 && (
                        <div className="space-y-2">
                          <Label className="text-sm font-medium" data-testid="label-select-library">Select Document Library</Label>
                          <div className="space-y-1.5">
                            {testResult.drives.map((drive) => (
                              <button
                                key={drive.id}
                                className={`w-full text-left p-3 rounded-lg border transition-all ${
                                  selectedDriveId === drive.id
                                    ? "border-blue-400 bg-blue-50 ring-1 ring-blue-200"
                                    : "border-gray-200 hover:border-blue-200 hover:bg-blue-50/50"
                                }`}
                                onClick={() => {
                                  setSelectedDriveId(drive.id);
                                  setSelectedDriveName(drive.name);
                                }}
                                data-testid={`drive-option-${drive.id}`}
                              >
                                <div className="flex items-center gap-2">
                                  <HardDrive className={`h-4 w-4 ${selectedDriveId === drive.id ? "text-blue-600" : "text-gray-400"}`} />
                                  <span className="text-sm font-medium">{drive.name}</span>
                                  {selectedDriveId === drive.id && <CheckCircle className="h-4 w-4 text-blue-600 ml-auto" />}
                                </div>
                                {drive.description && <p className="text-xs text-muted-foreground mt-0.5 ml-6">{drive.description}</p>}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-red-700 font-medium">
                      <XCircle className="h-4 w-4" />
                      {testResult.error || "Connection failed"}
                    </div>
                  )}
                </div>
              )}

              {(selectedDriveId || spConfig?.driveId) && (
                <div className="p-3 bg-slate-50 border rounded-lg">
                  <p className="text-xs font-medium text-slate-700 mb-1">Current Configuration</p>
                  <div className="text-xs text-slate-600 space-y-0.5">
                    <p>Site: {testResult?.siteName || spConfig?.siteName || "—"}</p>
                    <p>Library: {selectedDriveName || spConfig?.driveName || "—"}</p>
                    <p>Drive ID: <code className="bg-slate-100 px-1 rounded text-[10px]">{selectedDriveId || spConfig?.driveId || "—"}</code></p>
                  </div>
                </div>
              )}

              <Button
                onClick={handleSaveSharePoint}
                disabled={saveConfigMutation.isPending || (!selectedDriveId && !spConfig?.driveId)}
                className="gap-1"
                data-testid="button-save-sharepoint"
              >
                {saveConfigMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save SharePoint Settings
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Folder className="h-4 w-4 text-amber-600" />
                How Project Folder Mapping Works
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground space-y-2">
                <p>Once this site and library are configured:</p>
                <ul className="list-disc ml-4 space-y-1">
                  <li>Each project can be mapped to a specific folder within this library</li>
                  <li>COO and Program Manager can set or change the folder mapping from the project page</li>
                  <li>Users browse and upload files directly in the mapped SharePoint folder</li>
                  <li>Files are stored in SharePoint — not duplicated in the app</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="teams" className="mt-4 flex-1 overflow-y-auto min-h-0 space-y-4">
          <Card data-testid="card-teams-config">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-purple-600" />
                Teams Integration Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label data-testid="label-unanswered-threshold">Unanswered Threshold (hours)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={teamsConfig.unansweredThresholdHours}
                    onChange={(e) => setTeamsConfig({ ...teamsConfig, unansweredThresholdHours: parseInt(e.target.value) || 48 })}
                    data-testid="input-unanswered-threshold"
                  />
                  <p className="text-xs text-muted-foreground">Messages with no response for this long appear as "Unanswered"</p>
                </div>
                <div className="space-y-2">
                  <Label data-testid="label-hot-threshold">Hot Thread Threshold (hours)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={teamsConfig.hotThresholdHours}
                    onChange={(e) => setTeamsConfig({ ...teamsConfig, hotThresholdHours: parseInt(e.target.value) || 24 })}
                    data-testid="input-hot-threshold"
                  />
                  <p className="text-xs text-muted-foreground">Tagged messages with no update for this long appear as "Hot"</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label data-testid="label-tags">Message Tags</Label>
                <div className="flex flex-wrap gap-2">
                  {teamsConfig.tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className="text-xs py-1 px-2 gap-1 cursor-pointer hover:bg-red-50 hover:border-red-200 transition-colors"
                      onClick={() => setTeamsConfig({ ...teamsConfig, tags: teamsConfig.tags.filter(t => t !== tag) })}
                      data-testid={`tag-${tag}`}
                    >
                      <Tag className="h-3 w-3" />
                      {tag}
                      <XCircle className="h-3 w-3 text-muted-foreground" />
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <Input
                    placeholder="Add new tag..."
                    className="max-w-[200px] h-8 text-xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const val = (e.target as HTMLInputElement).value.trim().toLowerCase().replace(/\s+/g, "-");
                        if (val && !teamsConfig.tags.includes(val)) {
                          setTeamsConfig({ ...teamsConfig, tags: [...teamsConfig.tags, val] });
                          (e.target as HTMLInputElement).value = "";
                        }
                      }
                    }}
                    data-testid="input-add-tag"
                  />
                  <p className="text-xs text-muted-foreground self-center">Press Enter to add</p>
                </div>
              </div>

              <Button onClick={handleSaveTeamsConfig} disabled={saveConfigMutation.isPending} className="gap-1" data-testid="button-save-teams">
                <Save className="h-4 w-4" /> Save Teams Settings
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-purple-600" />
                How Teams Integration Works
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs text-muted-foreground space-y-2">
                <p>Once enabled, users can:</p>
                <ul className="list-disc ml-4 space-y-1">
                  <li>Paste a Teams message link to connect it to a project</li>
                  <li>Tag linked messages (finance, risk, blocked, etc.) for tracking</li>
                  <li>Convert a Teams message into a task using the existing task system</li>
                  <li>View linked Teams messages on the project page</li>
                </ul>
                <p className="mt-2 font-medium text-slate-700">COO/Program Manager rollups:</p>
                <ul className="list-disc ml-4 space-y-1">
                  <li><strong>Hot Threads:</strong> Tagged messages with no update for {teamsConfig.hotThresholdHours}h</li>
                  <li><strong>Unanswered:</strong> Messages with no response for {teamsConfig.unansweredThresholdHours}h</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="mt-4 flex-1 flex flex-col min-h-0 gap-4">
          <Card className="border-blue-200/50 bg-blue-50/30">
            <CardContent className="p-3 text-sm text-blue-800">
              <p>
                Set each user's <strong>Microsoft ID</strong> (their Azure AD Object ID) and <strong>email</strong> to enable Microsoft 365 login.
                When a user signs in with Microsoft, the system matches them by Microsoft ID or email address.
              </p>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                className="pl-9 h-8 text-xs"
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                data-testid="input-search-users"
              />
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="text-xs gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-600" />
                {linkedCount} linked
              </Badge>
              <Badge variant="outline" className="text-xs gap-1">
                <XCircle className="h-3 w-3 text-gray-400" />
                {unlinkedCount} unlinked
              </Badge>
            </div>
          </div>

          {usersLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Card className="flex-1 min-h-0 flex flex-col">
              <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
                <div className="overflow-auto flex-1 min-h-0">
                  <table className="w-full text-sm" data-testid="users-mapping-table">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-muted/40 border-b text-[11px] text-muted-foreground">
                        <th className="text-left p-2.5 pl-3 bg-muted/40">User</th>
                        <th className="text-left p-2.5 bg-muted/40">Role</th>
                        <th className="text-left p-2.5 bg-muted/40">Email</th>
                        <th className="text-left p-2.5 bg-muted/40">Microsoft ID</th>
                        <th className="text-left p-2.5 bg-muted/40">Status</th>
                        <th className="text-left p-2.5 w-20 bg-muted/40">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u: any) => (
                        <tr key={u.id} className="border-b hover:bg-muted/10 transition-colors" data-testid={`user-row-${u.id}`}>
                          <td className="p-2.5 pl-3">
                            <div>
                              <p className="font-medium">{u.name}</p>
                              <p className="text-[10px] text-muted-foreground">{u.username}</p>
                            </div>
                          </td>
                          <td className="p-2.5">
                            <Badge variant="outline" className="text-[10px]">{u.role}</Badge>
                          </td>
                          <td className="p-2.5 text-muted-foreground text-xs">
                            {u.email || <span className="text-gray-300">Not set</span>}
                          </td>
                          <td className="p-2.5 font-mono text-[10px] text-muted-foreground max-w-[200px] truncate">
                            {u.microsoftId || <span className="text-gray-300">Not linked</span>}
                          </td>
                          <td className="p-2.5">
                            {u.microsoftId ? (
                              <Badge className="bg-green-100 text-green-700 text-[10px]">
                                <CheckCircle2 className="h-3 w-3 mr-0.5" />
                                Linked
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] text-gray-400">
                                Unlinked
                              </Badge>
                            )}
                          </td>
                          <td className="p-2.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => {
                                setEditingUser(u);
                                setEditMsId(u.microsoftId || "");
                                setEditEmail(u.email || "");
                              }}
                              data-testid={`button-edit-${u.id}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <Dialog open={!!editingUser} onOpenChange={v => { if (!v) setEditingUser(null); }}>
            <DialogContent className="sm:max-w-md" data-testid="dialog-edit-ms-mapping">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-blue-600" />
                  Edit Microsoft Mapping — {editingUser?.name}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Email Address</Label>
                  <Input
                    value={editEmail}
                    onChange={e => setEditEmail(e.target.value)}
                    placeholder="user@emergentenergy.co.za"
                    data-testid="input-edit-email"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Must match the user's Microsoft 365 email for SSO to work
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Microsoft ID (Azure AD Object ID)</Label>
                  <Input
                    value={editMsId}
                    onChange={e => setEditMsId(e.target.value)}
                    placeholder="e.g. a1b2c3d4-e5f6-..."
                    className="font-mono text-xs"
                    data-testid="input-edit-ms-id"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Found in Azure AD user profile. Leave blank to unlink.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditingUser(null)}>Cancel</Button>
                <Button
                  onClick={() => {
                    if (editingUser) {
                      updateMappingMutation.mutate({
                        userId: editingUser.id,
                        microsoftId: editMsId.trim(),
                        email: editEmail.trim(),
                      });
                    }
                  }}
                  disabled={updateMappingMutation.isPending}
                  data-testid="button-save-ms-mapping"
                >
                  {updateMappingMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="permissions" className="mt-4 flex-1 overflow-y-auto min-h-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4 text-slate-600" />
                Access Control Rules
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-3 border rounded-lg">
                  <p className="text-sm font-semibold mb-1">SharePoint Documents</p>
                  <ul className="text-xs text-muted-foreground list-disc ml-4 space-y-1">
                    <li>Users can only view documents for projects they have access to in the app</li>
                    <li>Microsoft Graph also enforces SharePoint-level permissions</li>
                    <li>Folder mapping can only be set by COO and Program Manager</li>
                    <li>Upload and browse actions are audited</li>
                  </ul>
                </div>
                <div className="p-3 border rounded-lg">
                  <p className="text-sm font-semibold mb-1">Teams Messages</p>
                  <ul className="text-xs text-muted-foreground list-disc ml-4 space-y-1">
                    <li>Users can only see linked Teams items for projects they have access to</li>
                    <li>Microsoft Graph also enforces Teams-level permissions</li>
                    <li>COO override works at app level only — Graph still limits what COO can fetch</li>
                    <li>Linking and unlinking actions are audited</li>
                  </ul>
                </div>
                <div className="p-3 border rounded-lg">
                  <p className="text-sm font-semibold mb-1">Folder Mapping Roles</p>
                  <div className="flex gap-2 mt-1">
                    <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">COO</Badge>
                    <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">Program Manager</Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
