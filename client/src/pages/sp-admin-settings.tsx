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
  Loader2,
  Save,
  Plug,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  CloudCog,
} from "lucide-react";

interface SpSettings {
  siteId: string;
  driveId: string;
  folderItemId: string;
  folderPath: string;
  intervalMinutes: number;
  enabled: boolean;
  lastRunAt: string | null;
}

interface TestResult {
  success: boolean;
  siteName?: string;
  driveName?: string;
  error?: string;
}

export default function SpAdminSettingsPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<Omit<SpSettings, "lastRunAt">>({
    siteId: "",
    driveId: "",
    folderItemId: "",
    folderPath: "",
    intervalMinutes: 60,
    enabled: false,
  });

  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const { data: settings, isLoading } = useQuery<SpSettings>({
    queryKey: ["/api/admin/sp-settings"],
    queryFn: async () => {
      const res = await fetch("/api/admin/sp-settings", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load settings");
      return res.json();
    },
  });

  useEffect(() => {
    if (settings) {
      setForm({
        siteId: settings.siteId || "",
        driveId: settings.driveId || "",
        folderItemId: settings.folderItemId || "",
        folderPath: settings.folderPath || "",
        intervalMinutes: settings.intervalMinutes ?? 60,
        enabled: settings.enabled ?? false,
      });
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (data: Omit<SpSettings, "lastRunAt">) => {
      const res = await fetch("/api/admin/sp-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/sp-settings"] });
      toast({ title: "Settings saved", description: "SharePoint settings have been updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (data: { siteId: string; driveId: string }) => {
      const res = await fetch("/api/admin/sp-settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Connection test failed");
      return res.json() as Promise<TestResult>;
    },
    onSuccess: (result) => {
      setTestResult(result);
      if (result.success) {
        toast({ title: "Connection successful", description: `Site: ${result.siteName}, Drive: ${result.driveName}` });
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
    <div className="space-y-6 max-w-[900px] mx-auto" data-testid="sp-admin-settings-page">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50 flex items-center gap-2" data-testid="text-page-title">
          <CloudCog className="h-7 w-7 text-blue-600" />
          SharePoint Integration
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Configure automatic sync of tracker files from SharePoint
        </p>
      </header>

      {settings?.lastRunAt && (
        <div className="flex items-center gap-2 text-sm text-gray-500" data-testid="text-last-run">
          <Clock className="h-4 w-4" />
          Last sync: {new Date(settings.lastRunAt).toLocaleString()}
        </div>
      )}

      <Card data-testid="card-sp-settings">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Plug className="h-4 w-4 text-blue-600" />
              Connection Settings
            </CardTitle>
            <Badge variant={form.enabled ? "default" : "secondary"} data-testid="badge-status">
              {form.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-3">
            <Switch
              id="sp-enabled"
              checked={form.enabled}
              onCheckedChange={(checked) => setForm({ ...form, enabled: checked })}
              data-testid="switch-enabled"
            />
            <Label htmlFor="sp-enabled" data-testid="label-enabled">
              Enable SharePoint sync
            </Label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="site-id" data-testid="label-site-id">Site ID</Label>
              <Input
                id="site-id"
                value={form.siteId}
                onChange={(e) => setForm({ ...form, siteId: e.target.value })}
                placeholder="e.g. contoso.sharepoint.com,guid,guid"
                data-testid="input-site-id"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="drive-id" data-testid="label-drive-id">Drive ID</Label>
              <Input
                id="drive-id"
                value={form.driveId}
                onChange={(e) => setForm({ ...form, driveId: e.target.value })}
                placeholder="e.g. b!xxxxx"
                data-testid="input-drive-id"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="folder-item-id" data-testid="label-folder-item-id">
                Folder Item ID <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="folder-item-id"
                value={form.folderItemId}
                onChange={(e) => setForm({ ...form, folderItemId: e.target.value })}
                placeholder="Specific folder item ID"
                data-testid="input-folder-item-id"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="folder-path" data-testid="label-folder-path">
                Folder Path <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="folder-path"
                value={form.folderPath}
                onChange={(e) => setForm({ ...form, folderPath: e.target.value })}
                placeholder="e.g. /Trackers/Active"
                data-testid="input-folder-path"
              />
            </div>
          </div>

          <div className="space-y-2 max-w-xs">
            <Label htmlFor="interval-minutes" data-testid="label-interval-minutes">Sync Interval (minutes)</Label>
            <Input
              id="interval-minutes"
              type="number"
              min={1}
              value={form.intervalMinutes}
              onChange={(e) => setForm({ ...form, intervalMinutes: parseInt(e.target.value) || 60 })}
              data-testid="input-interval-minutes"
            />
            <p className="text-xs text-muted-foreground">How often to check for updated files</p>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setTestResult(null);
                testMutation.mutate({ siteId: form.siteId, driveId: form.driveId });
              }}
              disabled={testMutation.isPending || !form.siteId || !form.driveId}
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
              disabled={saveMutation.isPending || !form.siteId || !form.driveId}
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
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-green-700 dark:text-green-400 font-medium">
                    <CheckCircle className="h-4 w-4" />
                    Connection successful
                  </div>
                  {testResult.siteName && (
                    <p className="text-sm text-green-600 dark:text-green-500" data-testid="text-site-name">
                      Site: {testResult.siteName}
                    </p>
                  )}
                  {testResult.driveName && (
                    <p className="text-sm text-green-600 dark:text-green-500" data-testid="text-drive-name">
                      Drive: {testResult.driveName}
                    </p>
                  )}
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
    </div>
  );
}
