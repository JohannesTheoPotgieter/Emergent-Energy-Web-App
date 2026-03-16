import { useState, useEffect, useCallback } from "react";
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
  KeyRound,
  AlertTriangle,
  Check,
  X,
  PackageSearch,
  RefreshCw,
  Settings2,
  Mail,
  MessageSquare,
  Shield,
  CheckCircle2,
  XCircle,
  Users,
  Pencil,
  Search,
  Zap,
  Plug,
  Clock,
} from "lucide-react";
import {
  COMPANY_ROLES,
  COMPANY_ROLE_LABELS,
  type CompanyRole,
} from "@shared/schema";

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem("auth_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function authFetch(url: string, opts?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { ...(opts?.headers as Record<string, string> || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...opts, credentials: "include", headers });
}

async function fetchSetting(key: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/settings?key=${encodeURIComponent(key)}`, {
      credentials: "include",
      headers: getAuthHeaders(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.value ?? null;
  } catch {
    return null;
  }
}

interface MsIntegrationStatus {
  outlook: { configured: boolean; connected: boolean; email: string | null };
  teams: { enabled: boolean; configured: boolean; tags: string[] };
  user: { id: number; name: string; role: string };
}

interface OutlookConnection {
  configured: boolean;
  connected: boolean;
  email?: string;
}

const SECTION_IDS = ["connections", "teams", "users", "passwords", "procurement"] as const;
type SectionId = typeof SECTION_IDS[number];

const SECTION_META: Record<SectionId, { label: string; icon: any; description: string }> = {
  connections: { label: "Connections", icon: Plug, description: "Outlook and Teams connection status" },
  teams: { label: "Teams Settings", icon: MessageSquare, description: "Configure Teams chat integration" },
  users: { label: "Microsoft Accounts", icon: Users, description: "Link users to their Microsoft 365 accounts for SSO" },
  passwords: { label: "Role Passwords", icon: KeyRound, description: "Manage login passwords for each role" },
  procurement: { label: "Procurement Analysis", icon: PackageSearch, description: "Rebuild supplier data from expense records" },
};

export default function RoleSettingsPage() {
  const { toast } = useToast();
  const { isAdmin, user } = useAuth();
  const queryClient = useQueryClient();
  const companyRole = localStorage.getItem("company_role");
  const [activeSection, setActiveSection] = useState<SectionId>("connections");

  if (companyRole !== "COO_ADMIN" && !isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="access-denied-container">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-access-denied">Access Denied</h2>
            <p className="text-muted-foreground">Only administrators can access this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 flex-1 max-w-[1100px] mx-auto w-full" data-testid="app-settings-page">
      <header className="shrink-0 mb-5">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2" data-testid="text-page-title">
          <Settings2 className="h-7 w-7 text-blue-600" />
          App Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage Microsoft 365 connections, user accounts, role passwords, and system tools
        </p>
      </header>

      <div className="flex flex-col md:flex-row gap-4 md:gap-6 flex-1 min-h-0">
        <nav className="w-full md:w-56 shrink-0 flex md:flex-col gap-1 overflow-x-auto md:overflow-x-visible pb-2 md:pb-0" data-testid="settings-nav">
          {SECTION_IDS.map((id) => {
            const meta = SECTION_META[id];
            const Icon = meta.icon;
            const isActive = activeSection === id;
            return (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className={`flex items-center gap-2 md:gap-2.5 px-3 py-2 md:py-2.5 rounded-lg text-left text-sm transition-all whitespace-nowrap shrink-0 ${
                  isActive
                    ? "bg-blue-50 text-blue-700 font-medium border border-blue-200"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent"
                }`}
                data-testid={`nav-${id}`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-blue-600" : "text-gray-400"}`} />
                <span>{meta.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-foreground">{SECTION_META[activeSection].label}</h2>
            <p className="text-sm text-muted-foreground">{SECTION_META[activeSection].description}</p>
          </div>

          {activeSection === "connections" && <ConnectionsSection />}
          {activeSection === "teams" && <TeamsSettingsSection />}
          {activeSection === "users" && <UserMappingSection />}
          {activeSection === "passwords" && <RolePasswordsSection />}
          {activeSection === "procurement" && <ProcurementAnalysisSection />}
        </div>
      </div>
    </div>
  );
}

function ConnectionsSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const [refreshingOutlook, setRefreshingOutlook] = useState(false);

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

  const [featureFlags, setFeatureFlags] = useState({ feature_ms_teams: false });

  const { data: config } = useQuery<any>({
    queryKey: ["/api/admin/ms-integration"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/ms-integration");
      if (!res.ok) throw new Error("Failed to load config");
      return res.json();
    },
    enabled: isAdmin,
  });

  useEffect(() => {
    if (config?.feature_flags) {
      setFeatureFlags({ feature_ms_teams: config.feature_flags.feature_ms_teams || false });
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

  const handleRefreshOutlook = async () => {
    setRefreshingOutlook(true);
    try {
      const res = await authFetch("/api/outlook/refresh", { method: "POST" });
      const result = await res.json();
      queryClient.setQueryData(["/api/outlook/status"], result);
      if (result.connected) {
        toast({ title: "Outlook reconnected", description: result.email ? `Connected as ${result.email}` : "Connection restored." });
      } else {
        toast({ title: "Still disconnected", description: "The connection could not be restored.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Refresh failed", description: err.message, variant: "destructive" });
    } finally {
      setRefreshingOutlook(false);
      refetchOutlook();
    }
  };

  const outlookConnected = integrationStatus?.outlook?.connected || outlookStatus?.connected;
  const outlookEmail = integrationStatus?.outlook?.email || outlookStatus?.email;
  const outlookConfigured = integrationStatus?.outlook?.configured ?? outlookStatus?.configured;
  const teamsEnabled = integrationStatus?.teams?.enabled || featureFlags.feature_ms_teams;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card data-testid="card-outlook-status">
          <CardContent className="py-5">
            <div className="flex items-center gap-3 mb-3">
              <div className={`p-2.5 rounded-lg ${outlookConnected ? "bg-blue-100" : "bg-muted"}`}>
                <Mail className={`h-5 w-5 ${outlookConnected ? "text-blue-600" : "text-gray-400"}`} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">Outlook</p>
                <Badge variant="outline" className={`text-[10px] mt-0.5 ${outlookConnected ? "bg-emerald-50 text-emerald-700 border-emerald-200" : outlookConfigured === false ? "bg-muted text-muted-foreground border-border" : "bg-amber-50 text-amber-700 border-amber-200"}`} data-testid="badge-outlook-status">
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
              <p>Powers calendar sync, email access, and approval notifications</p>
            </div>
            {outlookConnected && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1 mt-3 text-xs"
                onClick={handleRefreshOutlook}
                disabled={refreshingOutlook}
                data-testid="button-refresh-outlook"
              >
                {refreshingOutlook ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Refresh Connection
              </Button>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-teams-status">
          <CardContent className="py-5">
            <div className="flex items-center gap-3 mb-3">
              <div className={`p-2.5 rounded-lg ${teamsEnabled ? "bg-purple-100" : "bg-muted"}`}>
                <MessageSquare className={`h-5 w-5 ${teamsEnabled ? "text-purple-600" : "text-gray-400"}`} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">Teams Chat</p>
                <Badge variant="outline" className={`text-[10px] mt-0.5 ${teamsEnabled ? "bg-purple-50 text-purple-700 border-purple-200" : "bg-muted text-muted-foreground border-border"}`} data-testid="badge-teams-status">
                  {teamsEnabled ? "Enabled" : "Not Enabled"}
                </Badge>
              </div>
            </div>
            <div className="text-xs text-muted-foreground space-y-1.5">
              <p>Link Teams messages to projects and create tasks from chats</p>
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

      <Card data-testid="card-feature-toggle">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-600" />
            Feature Toggle
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div className="flex items-center gap-3">
              <MessageSquare className="h-5 w-5 text-purple-600" />
              <div>
                <p className="text-sm font-medium">Teams Integration</p>
                <p className="text-xs text-muted-foreground">Enable linking Teams messages to projects and creating tasks from chats</p>
              </div>
            </div>
            <Switch
              checked={featureFlags.feature_ms_teams}
              onCheckedChange={(checked) => setFeatureFlags({ feature_ms_teams: checked })}
              data-testid="switch-feature-teams"
            />
          </div>
          <Button
            onClick={() => saveConfigMutation.mutate({ key: "feature_flags", value: { ...featureFlags, feature_ms_sharepoint_docs: false } })}
            disabled={saveConfigMutation.isPending}
            className="gap-1 mt-3"
            size="sm"
            data-testid="button-save-flags"
          >
            <Save className="h-3.5 w-3.5" /> Save
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function TeamsSettingsSection() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const [teamsConfig, setTeamsConfig] = useState({
    unansweredThresholdHours: 48,
    hotThresholdHours: 24,
    tags: ["finance-payment", "finance-invoice", "decision", "risk", "blocked", "snag", "client", "internal"],
  });

  const [newTag, setNewTag] = useState("");

  const { data: config } = useQuery<any>({
    queryKey: ["/api/admin/ms-integration"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/ms-integration");
      if (!res.ok) throw new Error("Failed to load config");
      return res.json();
    },
    enabled: isAdmin,
  });

  useEffect(() => {
    if (config?.teams_config) setTeamsConfig(config.teams_config);
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
      toast({ title: "Teams settings saved" });
    },
    onError: () => {
      toast({ title: "Error saving settings", variant: "destructive" });
    },
  });

  const addTag = () => {
    const tag = newTag.trim().toLowerCase().replace(/\s+/g, "-");
    if (tag && !teamsConfig.tags.includes(tag)) {
      setTeamsConfig({ ...teamsConfig, tags: [...teamsConfig.tags, tag] });
      setNewTag("");
    }
  };

  const removeTag = (tag: string) => {
    setTeamsConfig({ ...teamsConfig, tags: teamsConfig.tags.filter(t => t !== tag) });
  };

  return (
    <div className="space-y-4">
      <Card data-testid="card-teams-thresholds">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-purple-600" />
            Response Thresholds
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            These thresholds determine when Teams messages are flagged as needing attention.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Unanswered Threshold (hours)</Label>
              <Input
                type="number"
                value={teamsConfig.unansweredThresholdHours}
                onChange={(e) => setTeamsConfig({ ...teamsConfig, unansweredThresholdHours: parseInt(e.target.value) || 48 })}
                className="h-9"
                data-testid="input-unanswered-hours"
              />
              <p className="text-[10px] text-muted-foreground">Messages without a reply after this time are marked "unanswered"</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Hot Thread Threshold (hours)</Label>
              <Input
                type="number"
                value={teamsConfig.hotThresholdHours}
                onChange={(e) => setTeamsConfig({ ...teamsConfig, hotThresholdHours: parseInt(e.target.value) || 24 })}
                className="h-9"
                data-testid="input-hot-hours"
              />
              <p className="text-[10px] text-muted-foreground">Threads with high activity within this window are flagged as "hot"</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-teams-tags">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-purple-600" />
            Message Tags
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Tags help categorise Teams messages. Users can apply these tags when linking messages to projects.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {teamsConfig.tags.map(tag => (
              <Badge key={tag} variant="outline" className="text-xs gap-1 pr-1">
                {tag}
                <button onClick={() => removeTag(tag)} className="ml-0.5 hover:text-red-500 transition-colors" data-testid={`remove-tag-${tag}`}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Add a tag..."
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTag()}
              className="h-8 text-xs max-w-[200px]"
              data-testid="input-new-tag"
            />
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={addTag} data-testid="button-add-tag">
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Button
        onClick={() => saveConfigMutation.mutate({ key: "teams_config", value: teamsConfig })}
        disabled={saveConfigMutation.isPending}
        className="gap-1"
        data-testid="button-save-teams"
      >
        {saveConfigMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save Teams Settings
      </Button>
    </div>
  );
}

function UserMappingSection() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [userSearch, setUserSearch] = useState("");
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editMsId, setEditMsId] = useState("");
  const [editEmail, setEditEmail] = useState("");

  const { data: userMappings = [], isLoading } = useQuery<any[]>({
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

  return (
    <div className="space-y-4">
      <Card className="border-blue-200/50 bg-blue-50/30">
        <CardContent className="p-3 text-sm text-blue-800">
          <p>
            Link each user to their <strong>Microsoft account</strong> to enable Microsoft 365 sign-in.
            Set their email and Azure AD Object ID below.
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
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

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[500px] -mx-px">
              <table className="w-full text-sm min-w-[600px]" data-testid="users-mapping-table">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-muted/40 border-b text-[11px] text-muted-foreground">
                    <th className="text-left p-2.5 pl-3 bg-muted/40">User</th>
                    <th className="text-left p-2.5 bg-muted/40">Role</th>
                    <th className="text-left p-2.5 bg-muted/40">Email</th>
                    <th className="text-left p-2.5 bg-muted/40">Microsoft ID</th>
                    <th className="text-left p-2.5 bg-muted/40">Status</th>
                    <th className="text-left p-2.5 w-16 bg-muted/40"></th>
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
              Edit Microsoft Account — {editingUser?.name}
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
    </div>
  );
}

function RolePasswordsSection() {
  const { toast } = useToast();
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [passwords, setPasswords] = useState<Record<string, { password: string | null; updatedAt: string | null }>>({});

  useEffect(() => {
    loadPasswords();
  }, []);

  const loadPasswords = async () => {
    try {
      const res = await fetch("/api/role-auth/passwords", { credentials: "include", headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        const map: Record<string, { password: string | null; updatedAt: string | null }> = {};
        for (const c of data) {
          map[c.role] = { password: c.lastPasswordPlain, updatedAt: c.updatedAt };
        }
        setPasswords(map);
      }
    } catch {}
  };

  const handleChangePassword = async (targetRole: string) => {
    if (!newPassword || newPassword.length < 4) {
      toast({ title: "Error", description: "Password must be at least 4 characters.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/role-auth/password", {
        credentials: "include",
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ targetRole, newPassword }),
      });
      if (res.ok) {
        toast({ title: "Password Updated", description: `Password changed for ${COMPANY_ROLE_LABELS[targetRole as CompanyRole]}.` });
        setEditingRole(null);
        setNewPassword("");
        loadPasswords();
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.message || "Failed to change password.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to change password.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      {COMPANY_ROLES.map((role) => {
        const info = passwords[role];
        return (
          <div
            key={role}
            className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 rounded-lg border border-border hover:bg-muted transition-colors"
            data-testid={`role-password-row-${role}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-foreground" data-testid={`text-role-label-${role}`}>
                  {COMPANY_ROLE_LABELS[role]}
                </span>
                <span className="text-xs text-gray-400">{role}</span>
              </div>
              {info?.password && (
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-xs text-muted-foreground">Current:</span>
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-foreground break-all" data-testid={`text-current-password-${role}`}>
                    {info.password}
                  </code>
                </div>
              )}
            </div>

            {editingRole === role ? (
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  placeholder="New password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full sm:w-48 h-8 text-sm"
                  data-testid={`input-password-${role}`}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleChangePassword(role);
                    if (e.key === "Escape") { setEditingRole(null); setNewPassword(""); }
                  }}
                />
                <Button
                  size="sm"
                  className="h-8 bg-green-600 hover:bg-green-700"
                  onClick={() => handleChangePassword(role)}
                  disabled={saving}
                  data-testid={`button-confirm-password-${role}`}
                >
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  onClick={() => { setEditingRole(null); setNewPassword(""); }}
                  data-testid={`button-cancel-password-${role}`}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => { setEditingRole(role); setNewPassword(""); }}
                data-testid={`button-change-password-${role}`}
              >
                Change Password
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ProcurementAnalysisSection() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<{ costLines: number; counterparties: number; sourceExpenses: number } | null>(null);
  const [lastResult, setLastResult] = useState<{ costLines: number; counterpartiesCreated: number; counterpartiesMatched: number; projects: number; message: string } | null>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const res = await fetch("/api/procurement-analysis/status", { credentials: "include", headers: getAuthHeaders() });
      if (res.ok) setStatus(await res.json());
    } catch {}
  };

  const handleRun = async () => {
    setRunning(true);
    setLastResult(null);
    try {
      const res = await fetch("/api/procurement-analysis/run", {
        credentials: "include",
        method: "POST",
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: data.error || "Procurement analysis failed", variant: "destructive" });
        return;
      }
      setLastResult(data);
      toast({ title: "Procurement Analysis Complete", description: data.message });
      loadStatus();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to run procurement analysis", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-amber-200/50 bg-amber-50/30">
        <CardContent className="p-3 text-sm text-amber-800">
          <p>
            This rebuilds procurement data from existing expense records. It extracts supplier names,
            creates counterparty records, and populates the Procurement dashboard. Safe to run at any time.
          </p>
        </CardContent>
      </Card>

      {status && (
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="py-4 text-center">
              <div className="text-2xl font-bold text-foreground" data-testid="text-source-expenses">{status.sourceExpenses.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground mt-1">Source Expenses</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <div className="text-2xl font-bold text-blue-700" data-testid="text-cost-lines">{status.costLines.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground mt-1">Cost Lines</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <div className="text-2xl font-bold text-emerald-700" data-testid="text-counterparties">{status.counterparties.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground mt-1">Counterparties</div>
            </CardContent>
          </Card>
        </div>
      )}

      {lastResult && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="py-3" data-testid="procurement-result">
            <p className="text-sm font-medium text-green-800">Analysis Complete</p>
            <p className="text-xs text-green-700 mt-1">{lastResult.message}</p>
            <div className="flex gap-4 mt-2 text-xs text-green-600">
              <span>{lastResult.costLines} cost lines</span>
              <span>{lastResult.counterpartiesCreated} new suppliers</span>
              <span>{lastResult.counterpartiesMatched} matched</span>
              <span>{lastResult.projects} projects</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Button onClick={handleRun} disabled={running} data-testid="btn-run-procurement">
        {running ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Running Analysis...</>
        ) : (
          <><RefreshCw className="w-4 h-4 mr-2" /> Run Procurement Analysis</>
        )}
      </Button>
    </div>
  );
}
