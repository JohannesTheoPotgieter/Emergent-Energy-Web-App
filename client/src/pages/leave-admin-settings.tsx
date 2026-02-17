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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Save,
  Plug,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  CloudCog,
  Shield,
} from "lucide-react";

interface LeaveSettings {
  isEnabled: boolean;
  companyCode: string;
  apiBaseUrl: string;
  authMode: string;
  apiUsername: string;
  apiPassword: string;
  apiToken: string;
  showLeaveType: boolean;
  showFullSurname: boolean;
  syncFrequencyMinutes: number;
  lookbackDays: number;
  lookaheadDays: number;
  lastSyncAt: string | null;
}

interface TestResult {
  success: boolean;
  message?: string;
  error?: string;
}

export default function LeaveAdminSettingsPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<Omit<LeaveSettings, "lastSyncAt">>({
    isEnabled: false,
    companyCode: "",
    apiBaseUrl: "",
    authMode: "oauth",
    apiUsername: "",
    apiPassword: "",
    apiToken: "",
    showLeaveType: true,
    showFullSurname: false,
    syncFrequencyMinutes: 60,
    lookbackDays: 30,
    lookaheadDays: 90,
  });

  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const { data: settings, isLoading } = useQuery<LeaveSettings>({
    queryKey: ["/api/admin/leave/settings"],
    queryFn: async () => {
      const res = await fetch("/api/admin/leave/settings", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load settings");
      return res.json();
    },
  });

  useEffect(() => {
    if (settings) {
      setForm({
        isEnabled: settings.isEnabled ?? false,
        companyCode: settings.companyCode || "",
        apiBaseUrl: settings.apiBaseUrl || "",
        authMode: settings.authMode || "oauth",
        apiUsername: settings.apiUsername || "",
        apiPassword: settings.apiPassword || "",
        apiToken: settings.apiToken || "",
        showLeaveType: settings.showLeaveType ?? true,
        showFullSurname: settings.showFullSurname ?? false,
        syncFrequencyMinutes: settings.syncFrequencyMinutes ?? 60,
        lookbackDays: settings.lookbackDays ?? 30,
        lookaheadDays: settings.lookaheadDays ?? 90,
      });
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (data: Omit<LeaveSettings, "lastSyncAt">) => {
      const res = await fetch("/api/admin/leave/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/leave/settings"] });
      toast({ title: "Settings saved", description: "Leave integration settings have been updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/leave/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          companyCode: form.companyCode,
          apiBaseUrl: form.apiBaseUrl,
          authMode: form.authMode,
          apiUsername: form.apiUsername,
          apiPassword: form.apiPassword,
          apiToken: form.apiToken,
        }),
      });
      if (!res.ok) throw new Error("Connection test failed");
      return res.json() as Promise<TestResult>;
    },
    onSuccess: (result) => {
      setTestResult(result);
      if (result.success) {
        toast({ title: "Connection successful", description: result.message || "PaySpace API is reachable." });
      } else {
        toast({ title: "Connection failed", description: result.error || "Unknown error", variant: "destructive" });
      }
    },
    onError: (err: Error) => {
      setTestResult({ success: false, error: err.message });
      toast({ title: "Connection failed", description: err.message, variant: "destructive" });
    },
  });

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-access-denied">Access Denied</h2>
            <p className="text-muted-foreground">You do not have admin privileges to access this page.</p>
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

  return (
    <div className="space-y-6 max-w-[900px] mx-auto" data-testid="leave-admin-settings-page">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50 flex items-center gap-2" data-testid="text-page-title">
          <CloudCog className="h-7 w-7 text-blue-600" />
          Leave Integration (PaySpace)
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Configure automatic sync of leave data from PaySpace
        </p>
      </header>

      {settings?.lastSyncAt && (
        <div className="flex items-center gap-2 text-sm text-gray-500" data-testid="text-last-sync">
          <Clock className="h-4 w-4" />
          Last sync: {new Date(settings.lastSyncAt).toLocaleString()}
        </div>
      )}

      <Card data-testid="card-leave-settings">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Plug className="h-4 w-4 text-blue-600" />
              Connection Settings
            </CardTitle>
            <Badge variant={form.isEnabled ? "default" : "secondary"} data-testid="badge-status">
              {form.isEnabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-3">
            <Switch
              id="leave-enabled"
              checked={form.isEnabled}
              onCheckedChange={(checked) => setForm({ ...form, isEnabled: checked })}
              data-testid="switch-enabled"
            />
            <Label htmlFor="leave-enabled" data-testid="label-enabled">
              Enable leave sync
            </Label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="company-code" data-testid="label-company-code">Company Code</Label>
              <Input
                id="company-code"
                value={form.companyCode}
                onChange={(e) => setForm({ ...form, companyCode: e.target.value })}
                placeholder="e.g. EMERG001"
                data-testid="input-company-code"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-base-url" data-testid="label-api-base-url">API Base URL</Label>
              <Input
                id="api-base-url"
                value={form.apiBaseUrl}
                onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })}
                placeholder="e.g. https://api.payspace.com/v1"
                data-testid="input-api-base-url"
              />
            </div>
          </div>

          <div className="space-y-2 max-w-xs">
            <Label htmlFor="auth-mode" data-testid="label-auth-mode">Authentication Mode</Label>
            <Select
              value={form.authMode}
              onValueChange={(value) => setForm({ ...form, authMode: value })}
            >
              <SelectTrigger id="auth-mode" data-testid="select-auth-mode">
                <SelectValue placeholder="Select auth mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="oauth" data-testid="option-oauth">OAuth</SelectItem>
                <SelectItem value="basic" data-testid="option-basic">Basic Auth</SelectItem>
                <SelectItem value="token" data-testid="option-token">API Token</SelectItem>
                <SelectItem value="soap" data-testid="option-soap">SOAP</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="api-username" data-testid="label-api-username">API Username</Label>
              <Input
                id="api-username"
                value={form.apiUsername}
                onChange={(e) => setForm({ ...form, apiUsername: e.target.value })}
                placeholder="Username"
                data-testid="input-api-username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-password" data-testid="label-api-password">API Password</Label>
              <Input
                id="api-password"
                type="password"
                value={form.apiPassword}
                onChange={(e) => setForm({ ...form, apiPassword: e.target.value })}
                placeholder="••••••••"
                data-testid="input-api-password"
              />
            </div>
          </div>

          <div className="space-y-2 max-w-sm">
            <Label htmlFor="api-token" data-testid="label-api-token">API Token</Label>
            <Input
              id="api-token"
              type="password"
              value={form.apiToken}
              onChange={(e) => setForm({ ...form, apiToken: e.target.value })}
              placeholder="Bearer token (if applicable)"
              data-testid="input-api-token"
            />
          </div>

          <div className="border-t pt-4 space-y-4">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Display Options</h3>
            <div className="flex items-center gap-3">
              <Switch
                id="show-leave-type"
                checked={form.showLeaveType}
                onCheckedChange={(checked) => setForm({ ...form, showLeaveType: checked })}
                data-testid="switch-show-leave-type"
              />
              <Label htmlFor="show-leave-type" data-testid="label-show-leave-type">
                Show leave type
              </Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="show-full-surname"
                checked={form.showFullSurname}
                onCheckedChange={(checked) => setForm({ ...form, showFullSurname: checked })}
                data-testid="switch-show-full-surname"
              />
              <Label htmlFor="show-full-surname" data-testid="label-show-full-surname">
                Show full surname
              </Label>
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Sync Schedule</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sync-frequency" data-testid="label-sync-frequency">Sync Frequency (minutes)</Label>
                <Input
                  id="sync-frequency"
                  type="number"
                  min={1}
                  value={form.syncFrequencyMinutes}
                  onChange={(e) => setForm({ ...form, syncFrequencyMinutes: parseInt(e.target.value) || 60 })}
                  data-testid="input-sync-frequency"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lookback-days" data-testid="label-lookback-days">Lookback Days</Label>
                <Input
                  id="lookback-days"
                  type="number"
                  min={0}
                  value={form.lookbackDays}
                  onChange={(e) => setForm({ ...form, lookbackDays: parseInt(e.target.value) || 30 })}
                  data-testid="input-lookback-days"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lookahead-days" data-testid="label-lookahead-days">Lookahead Days</Label>
                <Input
                  id="lookahead-days"
                  type="number"
                  min={0}
                  value={form.lookaheadDays}
                  onChange={(e) => setForm({ ...form, lookaheadDays: parseInt(e.target.value) || 90 })}
                  data-testid="input-lookahead-days"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Lookback/lookahead controls the date window for fetching leave records relative to today.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setTestResult(null);
                testMutation.mutate();
              }}
              disabled={testMutation.isPending || !form.apiBaseUrl || !form.companyCode}
              data-testid="button-test-connection"
            >
              {testMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plug className="h-4 w-4 mr-2" />
              )}
              Test Connection
            </Button>

            <Button
              onClick={() => saveMutation.mutate(form)}
              disabled={saveMutation.isPending}
              data-testid="button-save-settings"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Settings
            </Button>
          </div>

          {testResult && (
            <div
              className={`mt-2 p-4 rounded-lg border ${
                testResult.success
                  ? "bg-green-50 border-green-200 dark:bg-green-900/10 dark:border-green-800"
                  : "bg-red-50 border-red-200 dark:bg-red-900/10 dark:border-red-800"
              }`}
              data-testid="test-result"
            >
              {testResult.success ? (
                <div className="flex items-center gap-2 text-green-700 dark:text-green-400 font-medium">
                  <CheckCircle className="h-4 w-4" />
                  {testResult.message || "Connection successful"}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-medium">
                  <XCircle className="h-4 w-4" />
                  {testResult.error || "Connection failed"}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-privacy">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-green-600" />
            Privacy &amp; POPIA Compliance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            This integration processes employee leave data in compliance with the Protection of Personal Information Act (POPIA).
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>Only leave-related data is fetched — no salary, banking, or medical information is accessed.</li>
            <li>Employee names can be partially masked using the "Show full surname" toggle above.</li>
            <li>Leave type visibility can be controlled to limit exposure of sensitive leave categories.</li>
            <li>All data is transmitted over encrypted connections (HTTPS/TLS).</li>
            <li>API credentials are stored securely and never exposed to end users.</li>
            <li>Data retention follows your organisation's data governance policies.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
