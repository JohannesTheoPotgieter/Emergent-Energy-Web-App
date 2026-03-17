import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, XCircle, Loader2, Play, RefreshCw, FileSpreadsheet, Clock, Database, Trash2, FolderOpen, Upload } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchRolloutFeatureFlags } from "@/lib/feature-flags";
import { useToast } from "@/hooks/use-toast";

interface FolderConfig {
  folderPath: string;
  exists: boolean;
  fileCount: number;
  latestFileDate: string | null;
  projectCounts?: { active: number; historical: number; total: number };
}

interface SmokeTestCheck {
  name: string;
  passed: boolean;
  details: any;
}

interface SmokeTestResult {
  passed: boolean;
  checks: SmokeTestCheck[];
  error?: string;
  code?: string;
  timestamps: {
    started: string;
    completed: string;
    durationMs: number;
  };
}

export default function AdminPage() {
  const { isAdmin } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [folderConfig, setFolderConfig] = useState<FolderConfig | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [progressInfo, setProgressInfo] = useState<{ current: number; total: number; currentFile: string } | null>(null);

  const [smokeLoading, setSmokeLoading] = useState(false);
  const [smokeResult, setSmokeResult] = useState<SmokeTestResult | null>(null);
  const [smokeError, setSmokeError] = useState<string | null>(null);

  const [clearLoading, setClearLoading] = useState(false);
  const [clearResult, setClearResult] = useState<{ success: boolean; message: string } | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);

  const viewerOnly = !isAdmin;

  const { data: rolloutFlags } = useQuery({
    queryKey: ["rollout-feature-flags"],
    queryFn: fetchRolloutFeatureFlags,
    staleTime: 60_000,
  });
  const cleanedAdminVisibilityEnabled = rolloutFlags?.find((flag) => flag.key === "cleaned_admin_visibility")?.value === true;

  const loadFolderConfig = async () => {
    try {
      const res = await fetch("/api/admin/folder-config", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setFolderConfig(data);
      }
    } catch (err) {
      console.error("Failed to load folder config:", err);
    }
  };

  useEffect(() => {
    loadFolderConfig();
  }, []);

  const runSmokeTest = async () => {
    setSmokeLoading(true);
    setSmokeError(null);
    setSmokeResult(null);
    try {
      const res = await fetch("/api/admin/smoke-test", { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401) throw new Error("Authentication required.");
        throw new Error(`Server error: ${res.status}`);
      }
      setSmokeResult(await res.json());
    } catch (err: any) {
      setSmokeError(err?.message || "Failed to run smoke test");
    } finally {
      setSmokeLoading(false);
    }
  };

  const clearAllData = async () => {
    setClearLoading(true);
    setClearError(null);
    setClearResult(null);
    try {
      const res = await fetch("/api/admin/clear-all-data", { method: "POST", credentials: "include" });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData?.message || `Server error: ${res.status}`);
      }
      const data = await res.json();
      setClearResult({ success: true, message: data.message });
      queryClient.invalidateQueries();
      loadFolderConfig();
    } catch (err: any) {
      setClearError(err?.message || "Failed to clear data");
    } finally {
      setClearLoading(false);
    }
  };

  const formatCheckName = (name: string) => {
    return name.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-admin-title">{viewerOnly ? "Data Import" : "Admin Dashboard"}</h1>
          <p className="text-sm text-muted-foreground">{viewerOnly ? "Upload tracker files to import project data" : "Data import, system health, and diagnostics"}</p>
        </div>
        
      </div>

      <Tabs defaultValue="import" className="w-full">
        {!viewerOnly && (
          <TabsList className={`grid w-full ${cleanedAdminVisibilityEnabled ? "grid-cols-1" : "grid-cols-3"} h-auto`}>
            <TabsTrigger value="import" data-testid="tab-data-import">
              <FolderOpen className="h-4 w-4 mr-2" />
              Data Import
            </TabsTrigger>
            {!cleanedAdminVisibilityEnabled && (<>
            <TabsTrigger value="maintenance" data-testid="tab-maintenance">
              <Database className="h-4 w-4 mr-2" />
              Maintenance
            </TabsTrigger>
            <TabsTrigger value="smoke" data-testid="tab-smoke-test">
              <Play className="h-4 w-4 mr-2" />
              Smoke Test
            </TabsTrigger>
            </>)}
          </TabsList>
        )}

        {/* DATA IMPORT TAB */}
        <TabsContent value="import" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-blue-600" />
                Smart Import
              </CardTitle>
              <CardDescription>
                Upload individual files or entire folders using the Smart Import wizard. Files are analysed, sections detected, and mappings confirmed before committing to the database.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={() => navigate("/admin/smart-import")}
                  className="flex items-center gap-3 p-4 rounded-lg border hover:border-blue-400 hover:bg-blue-50/50 transition-colors text-left"
                  data-testid="link-smart-import-file"
                >
                  <FileSpreadsheet className="h-8 w-8 text-emerald-500 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-sm">Upload Files</p>
                    <p className="text-xs text-muted-foreground">Select one or more Excel trackers to analyse and import</p>
                  </div>
                </button>
                <button
                  onClick={() => navigate("/admin/smart-import")}
                  className="flex items-center gap-3 p-4 rounded-lg border hover:border-blue-400 hover:bg-blue-50/50 transition-colors text-left"
                  data-testid="link-smart-import-folder"
                >
                  <FolderOpen className="h-8 w-8 text-blue-500 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-sm">Upload Folder</p>
                    <p className="text-xs text-muted-foreground">Select a folder of trackers to batch-analyse and import</p>
                  </div>
                </button>
              </div>
              {folderConfig && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="flex items-center gap-2 p-3 rounded-lg border">
                    <Database className="h-4 w-4 text-blue-500" />
                    <div>
                      <p className="text-xs text-muted-foreground">Total Projects</p>
                      <p className="text-sm font-medium" data-testid="text-total-projects">{folderConfig.projectCounts?.total ?? 0}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-3 rounded-lg border border-green-200">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <div>
                      <p className="text-xs text-muted-foreground">Active Projects</p>
                      <p className="text-sm font-medium text-green-600" data-testid="text-active-projects">{folderConfig.projectCounts?.active ?? 0}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-3 rounded-lg border border-orange-200">
                    <Clock className="h-4 w-4 text-orange-500" />
                    <div>
                      <p className="text-xs text-muted-foreground">Historical Projects</p>
                      <p className="text-sm font-medium text-orange-600" data-testid="text-historical-projects">{folderConfig.projectCounts?.historical ?? 0}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-3 rounded-lg border">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Last Import</p>
                      <p className="text-sm font-medium" data-testid="text-latest-date">
                        {folderConfig.latestFileDate
                          ? new Date(folderConfig.latestFileDate).toLocaleString()
                          : "N/A"}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* MAINTENANCE TAB */}
        <TabsContent value="maintenance" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="h-5 w-5" />
                    Re-process Stored Files
                  </CardTitle>
                  <CardDescription>
                    Re-parse all previously uploaded tracker files from the uploads directory
                  </CardDescription>
                </div>
                <Button
                  onClick={async () => {
                    setScanLoading(true);
                    setProgressInfo({ current: 0, total: 0, currentFile: "Starting..." });
                    try {
                      const res = await fetch("/api/admin/refresh-data", {
                        method: "POST",
                        credentials: "include",
                        headers: { "Accept": "text/event-stream" },
                      });
                      const reader = res.body?.getReader();
                      const decoder = new TextDecoder();
                      if (!reader) throw new Error("No response stream");
                      let buffer = "";
                      while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split("\n");
                        buffer = lines.pop() || "";
                        for (const line of lines) {
                          if (line.startsWith("data: ")) {
                            try {
                              const event = JSON.parse(line.slice(6));
                              if (event.type === "start") {
                                setProgressInfo({ current: 0, total: event.total, currentFile: "Starting..." });
                              } else if (event.type === "progress") {
                                setProgressInfo({ current: event.current, total: event.total, currentFile: event.projectName || event.fileName });
                              } else if (event.type === "complete") {
                                toast({ title: "Refresh Complete", description: `${event.results?.filter((r: any) => r.status === "success").length || 0} projects refreshed` });
                              } else if (event.type === "error") {
                                toast({ title: "Refresh Failed", description: event.message, variant: "destructive" });
                              }
                            } catch {}
                          }
                        }
                      }
                      queryClient.invalidateQueries();
                    } catch (err: any) {
                      toast({ title: "Refresh Failed", description: err.message, variant: "destructive" });
                    } finally {
                      setScanLoading(false);
                      setProgressInfo(null);
                    }
                  }}
                  disabled={scanLoading}
                  data-testid="button-refresh-data"
                >
                  {scanLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Refresh All Data
                </Button>
              </div>
            </CardHeader>
            {scanLoading && progressInfo && (
              <CardContent>
                <div className="space-y-2" data-testid="refresh-progress">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground truncate max-w-[60%]">
                      Processing: {progressInfo.currentFile}
                    </span>
                    <span className="font-medium">
                      {progressInfo.total > 0 ? `${progressInfo.current} of ${progressInfo.total}` : "Preparing..."}
                    </span>
                  </div>
                  <Progress value={progressInfo.total > 0 ? (progressInfo.current / progressInfo.total) * 100 : 0} className="h-3" />
                  {progressInfo.total > 0 && (
                    <p className="text-xs text-muted-foreground text-center">
                      {Math.round((progressInfo.current / progressInfo.total) * 100)}% complete
                    </p>
                  )}
                </div>
              </CardContent>
            )}
          </Card>

          <Card className="border-destructive/50">
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-destructive">
                    <Trash2 className="h-5 w-5" />
                    Clear All Data
                  </CardTitle>
                  <CardDescription>
                    Permanently delete all project data, uploads, and user edits
                  </CardDescription>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" disabled={clearLoading} data-testid="button-clear-all-data">
                      {clearLoading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-2 h-4 w-4" />
                      )}
                      Clear All Data
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. This will permanently delete all project data,
                        uploaded tracker files, cashflow data, revenue tracking, and all user edits.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={clearAllData}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Yes, delete everything
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardHeader>
            {clearError && (
              <CardContent>
                <p className="text-destructive" data-testid="text-clear-error">{clearError}</p>
              </CardContent>
            )}
            {clearResult && (
              <CardContent>
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-5 w-5" />
                  <span>{clearResult.message}</span>
                </div>
              </CardContent>
            )}
          </Card>
        </TabsContent>

        {/* SMOKE TEST TAB */}
        <TabsContent value="smoke" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button onClick={runSmokeTest} disabled={smokeLoading} data-testid="button-run-smoke-test">
              {smokeLoading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Running...</>
              ) : (
                <><Play className="mr-2 h-4 w-4" />Run Smoke Test</>
              )}
            </Button>
          </div>

          {smokeError && (
            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="text-destructive flex items-center gap-2">
                  <XCircle className="h-5 w-5" />Error
                </CardTitle>
              </CardHeader>
              <CardContent><p data-testid="text-smoke-test-error">{smokeError}</p></CardContent>
            </Card>
          )}

          {smokeResult && (
            <div className="space-y-4">
              <Card className={smokeResult.passed ? "border-green-500" : "border-destructive"}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      {smokeResult.passed ? (
                        <CheckCircle className="h-6 w-6 text-green-500" />
                      ) : (
                        <XCircle className="h-6 w-6 text-destructive" />
                      )}
                      Smoke Test {smokeResult.passed ? "Passed" : "Failed"}
                    </CardTitle>
                    <Badge variant={smokeResult.passed ? "default" : "destructive"} data-testid="badge-smoke-test-result">
                      {smokeResult.checks.filter((c) => c.passed).length} / {smokeResult.checks.length} checks passed
                    </Badge>
                  </div>
                  <CardDescription>
                    Completed in {smokeResult.timestamps.durationMs}ms at {new Date(smokeResult.timestamps.completed).toLocaleString()}
                  </CardDescription>
                </CardHeader>
              </Card>
              <div className="grid gap-4 md:grid-cols-2">
                {smokeResult.checks.map((check, index) => (
                  <Card key={index} className={check.passed ? "" : "border-destructive/50"}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        {check.passed ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive" />
                        )}
                        {formatCheckName(check.name)}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-40" data-testid={`details-${check.name}`}>
                        {JSON.stringify(check.details, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {!smokeLoading && !smokeResult && !smokeError && (
            <Card>
              <CardContent className="py-12 text-center">
                <Play className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No Test Results</h3>
                <p className="text-muted-foreground">Click "Run Smoke Test" to validate system health.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
