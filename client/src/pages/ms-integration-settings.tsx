import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

export default function MsIntegrationSettingsPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState("overview");
  const [siteUrl, setSiteUrl] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [selectedDriveId, setSelectedDriveId] = useState("");
  const [selectedDriveName, setSelectedDriveName] = useState("");

  const [featureFlags, setFeatureFlags] = useState({
    feature_ms_sharepoint_docs: false,
    feature_ms_teams: false,
  });

  const [teamsConfig, setTeamsConfig] = useState({
    unansweredThresholdHours: 48,
    hotThresholdHours: 24,
    tags: ["finance-payment", "finance-invoice", "decision", "risk", "blocked", "snag", "client", "internal"],
  });

  const { data: config, isLoading } = useQuery<MsIntegrationConfig>({
    queryKey: ["/api/admin/ms-integration"],
    queryFn: async () => {
      const res = await authFetch("/api/admin/ms-integration");
      if (!res.ok) throw new Error("Failed to load config");
      return res.json();
    },
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
        toast({ title: "Site found", description: `${result.siteName} — ${result.drives?.length || 0} document libraries found` });
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

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-access-denied">Access Denied</h2>
            <p className="text-muted-foreground">Only administrators can access integration settings.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const spConfig = config?.sharepoint_project_docs;
  const isConnected = spConfig?.connectionStatus === "connected";

  return (
    <div className="space-y-6 max-w-[960px] mx-auto" data-testid="ms-integration-settings-page">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 flex items-center gap-2" data-testid="text-page-title">
          <Settings2 className="h-7 w-7 text-blue-600" />
          Microsoft Integration Settings
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure SharePoint Documents and Teams integration for projects
        </p>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4 h-10">
          <TabsTrigger value="overview" className="text-xs gap-1" data-testid="tab-overview">
            <Activity className="h-3.5 w-3.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="sharepoint" className="text-xs gap-1" data-testid="tab-sharepoint">
            <FileText className="h-3.5 w-3.5" /> SharePoint Docs
          </TabsTrigger>
          <TabsTrigger value="teams" className="text-xs gap-1" data-testid="tab-teams">
            <MessageSquare className="h-3.5 w-3.5" /> Teams
          </TabsTrigger>
          <TabsTrigger value="permissions" className="text-xs gap-1" data-testid="tab-permissions">
            <Shield className="h-3.5 w-3.5" /> Permissions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
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

        <TabsContent value="sharepoint" className="mt-4 space-y-4">
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

        <TabsContent value="teams" className="mt-4 space-y-4">
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

        <TabsContent value="permissions" className="mt-4 space-y-4">
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
