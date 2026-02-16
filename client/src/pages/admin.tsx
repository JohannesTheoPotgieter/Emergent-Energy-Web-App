import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { CheckCircle, XCircle, Loader2, Play, RefreshCw, FileSpreadsheet, Clock, Database, Trash2, FolderOpen, AlertTriangle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface FolderConfig {
  folderPath: string;
  exists: boolean;
  fileCount: number;
  latestFileDate: string | null;
  projectCounts?: { active: number; historical: number; total: number };
}

interface ScanResult {
  success: boolean;
  message: string;
  filesProcessed: number;
  filesFailed: number;
  filesTotal: number;
  totalRecordsProcessed: number;
  latestFileDate: string;
  results: {
    fileName: string;
    projectName: string;
    status: "success" | "failed";
    message: string;
    recordsProcessed?: number;
    fileDate: string;
  }[];
  timestamps: {
    started: string;
    completed: string;
    durationMs: number;
  };
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
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [folderConfig, setFolderConfig] = useState<FolderConfig | null>(null);
  const [folderLoading, setFolderLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const [progressInfo, setProgressInfo] = useState<{ current: number; total: number; currentFile: string } | null>(null);

  const [smokeLoading, setSmokeLoading] = useState(false);
  const [smokeResult, setSmokeResult] = useState<SmokeTestResult | null>(null);
  const [smokeError, setSmokeError] = useState<string | null>(null);

  const [clearLoading, setClearLoading] = useState(false);
  const [clearResult, setClearResult] = useState<{ success: boolean; message: string } | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);

  const viewerOnly = !isAdmin;

  const loadFolderConfig = async () => {
    setFolderLoading(true);
    try {
      const res = await fetch("/api/admin/folder-config", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setFolderConfig(data);
      }
    } catch (err) {
      console.error("Failed to load folder config:", err);
    } finally {
      setFolderLoading(false);
    }
  };

  useEffect(() => {
    loadFolderConfig();
  }, []);

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const allFiles = Array.from(e.target.files);
    const excelFiles = allFiles.filter((f) =>
      /\.(xlsx|xlsm|xls)$/i.test(f.name)
    );
    if (excelFiles.length === 0) {
      toast({ title: "No Excel Files", description: "The selected folder contains no Excel files (.xlsx, .xlsm, .xls)", variant: "destructive" });
      return;
    }
    setUploadLoading(true);
    setScanResult(null);
    cancelRef.current = false;
    setProgressInfo({ current: 0, total: excelFiles.length, currentFile: "" });

    const results: ScanResult["results"] = [];
    let totalRecords = 0;
    let wasCancelled = false;

    for (let i = 0; i < excelFiles.length; i++) {
      if (cancelRef.current) {
        wasCancelled = true;
        break;
      }
      const file = excelFiles[i];
      setProgressInfo({ current: i + 1, total: excelFiles.length, currentFile: file.name });
      try {
        const formData = new FormData();
        formData.append("trackers", file);
        formData.append("mode", "refresh");
        const res = await fetch("/api/upload", { method: "POST", body: formData, credentials: "include" });
        const data = await res.json();
        if (res.ok && data.results) {
          for (const r of data.results) {
            const recCount = r.recordsProcessed ?? ((r.expensesParsed || 0) + (r.inflowsParsed || 0) + (r.planParsed || 0) + (r.cashflowParsed || 0) + (r.financeRevenueParsed || 0) + (r.financeCosParsed || 0));
            results.push({
              fileName: r.fileName || r.file || file.name,
              projectName: r.project_name || r.projectName || file.name.replace(/\.(xlsx|xlsm|xls)$/i, ''),
              status: r.status as "success" | "failed",
              message: r.message || "",
              recordsProcessed: recCount,
              fileDate: r.fileDate || new Date().toISOString(),
            });
            totalRecords += recCount;
          }
        } else {
          results.push({
            fileName: file.name,
            projectName: file.name,
            status: "failed",
            message: data.message || "Upload failed",
            fileDate: new Date().toISOString(),
          });
        }
      } catch (err: any) {
        results.push({
          fileName: file.name,
          projectName: file.name,
          status: "failed",
          message: err.message || "Upload failed",
          fileDate: new Date().toISOString(),
        });
      }
    }

    const successCount = results.filter((r) => r.status === "success").length;
    const failedCount = results.filter((r) => r.status === "failed").length;
    const processedTotal = wasCancelled ? results.length : excelFiles.length;

    const activeProjectNames = results
      .filter((r) => r.status === "success" && r.projectName)
      .map((r) => r.projectName);
    if (activeProjectNames.length > 0) {
      try {
        await fetch("/api/admin/mark-active", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectNames: activeProjectNames }),
          credentials: "include",
        });
      } catch {}
    }

    setScanResult({
      success: failedCount === 0 && !wasCancelled,
      message: wasCancelled
        ? `Import stopped — ${successCount} of ${processedTotal} files processed before cancellation`
        : `${successCount} of ${excelFiles.length} files processed successfully`,
      filesProcessed: successCount,
      filesFailed: failedCount,
      filesTotal: processedTotal,
      totalRecordsProcessed: totalRecords,
      latestFileDate: new Date().toISOString(),
      results,
      timestamps: { started: new Date().toISOString(), completed: new Date().toISOString(), durationMs: 0 },
    });
    setProgressInfo(null);
    setUploadLoading(false);
    queryClient.invalidateQueries();
    loadFolderConfig();
    toast({
      title: wasCancelled ? "Import Stopped" : "Import Complete",
      description: wasCancelled
        ? `Stopped after ${successCount} file(s). Already imported files are saved.`
        : `${successCount} file(s) processed successfully`,
      variant: wasCancelled ? "destructive" : "default",
    });
    if (folderInputRef.current) folderInputRef.current.value = "";
  };

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
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-admin-title">{viewerOnly ? "Data Import" : "Admin Dashboard"}</h1>
          <p className="text-muted-foreground">{viewerOnly ? "Upload tracker files to import project data" : "Data import, system health, and diagnostics"}</p>
        </div>
        {!viewerOnly && (
          <a href="/writeback-admin">
            <Button variant="outline" data-testid="button-writeback-admin">
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Excel Writeback
            </Button>
          </a>
        )}
      </div>

      <Tabs defaultValue="import" className="w-full">
        {!viewerOnly && (
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="import" data-testid="tab-data-import">
              <FolderOpen className="h-4 w-4 mr-2" />
              Data Import
            </TabsTrigger>
            <TabsTrigger value="maintenance" data-testid="tab-maintenance">
              <Database className="h-4 w-4 mr-2" />
              Maintenance
            </TabsTrigger>
            <TabsTrigger value="smoke" data-testid="tab-smoke-test">
              <Play className="h-4 w-4 mr-2" />
              Smoke Test
            </TabsTrigger>
          </TabsList>
        )}

        {/* DATA IMPORT TAB */}
        <TabsContent value="import" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <FolderOpen className="h-5 w-5" />
                    Import Tracker Files
                  </CardTitle>
                  <CardDescription>
                    Choose a folder on your computer containing Excel tracker files (.xlsx, .xlsm, .xls). All Excel files in the folder will be imported.
                  </CardDescription>
                </div>
                <div>
                  <input
                    ref={folderInputRef}
                    type="file"
                    className="hidden"
                    {...({ webkitdirectory: "true", directory: "" } as any)}
                    onChange={handleFolderSelect}
                    data-testid="input-folder-select"
                  />
                  <Button
                    onClick={() => folderInputRef.current?.click()}
                    disabled={uploadLoading}
                    size="lg"
                    data-testid="button-choose-folder"
                  >
                    {uploadLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <FolderOpen className="mr-2 h-4 w-4" />
                        Choose Folder
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>
            {progressInfo && (
              <CardContent>
                <div className="space-y-3" data-testid="import-progress">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground truncate max-w-[50%]">
                      Processing: {progressInfo.currentFile}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="font-medium">
                        {progressInfo.current} of {progressInfo.total}
                      </span>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => { cancelRef.current = true; }}
                        data-testid="button-stop-import"
                      >
                        <XCircle className="mr-1 h-4 w-4" />
                        Stop Import
                      </Button>
                    </div>
                  </div>
                  <Progress value={(progressInfo.current / progressInfo.total) * 100} className="h-3" />
                  <p className="text-xs text-muted-foreground text-center">
                    {Math.round((progressInfo.current / progressInfo.total) * 100)}% complete
                  </p>
                </div>
              </CardContent>
            )}
            {!progressInfo && folderConfig && (
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="flex items-center gap-2 p-3 rounded-lg border">
                    <Database className="h-4 w-4 text-blue-500" />
                    <div>
                      <p className="text-xs text-muted-foreground">Total Projects</p>
                      <p className="text-sm font-medium" data-testid="text-total-projects">{folderConfig.projectCounts?.total ?? 0}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-3 rounded-lg border border-green-200 dark:border-green-900">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <div>
                      <p className="text-xs text-muted-foreground">Active Projects</p>
                      <p className="text-sm font-medium text-green-600" data-testid="text-active-projects">{folderConfig.projectCounts?.active ?? 0}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-3 rounded-lg border border-orange-200 dark:border-orange-900">
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
              </CardContent>
            )}
          </Card>

          {/* Scan Results */}
          {scanResult && (
            <Card className={scanResult.filesFailed > 0 ? "border-yellow-500" : "border-green-500"}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    {scanResult.filesFailed === 0 ? (
                      <CheckCircle className="h-6 w-6 text-green-500" />
                    ) : (
                      <AlertTriangle className="h-6 w-6 text-yellow-500" />
                    )}
                    {scanResult.message}
                  </CardTitle>
                  <div className="flex gap-2">
                    <Badge variant="default">
                      {scanResult.totalRecordsProcessed.toLocaleString()} records
                    </Badge>
                    <Badge variant="outline">
                      {scanResult.timestamps.durationMs}ms
                    </Badge>
                  </div>
                </div>
                <CardDescription>
                  Completed at {new Date(scanResult.timestamps.completed).toLocaleString()}
                  {scanResult.latestFileDate && (
                    <> • Latest file: {new Date(scanResult.latestFileDate).toLocaleString()}</>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {scanResult.results.map((r, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center justify-between p-3 rounded-lg border ${
                        r.status === "failed" ? "border-red-200 bg-red-50 dark:bg-red-950/20" : "bg-muted/50"
                      }`}
                      data-testid={`scan-result-${idx}`}
                    >
                      <div className="flex items-center gap-3">
                        {r.status === "success" ? (
                          <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                        )}
                        <div>
                          <span className="font-medium text-sm">{r.projectName}</span>
                          <p className="text-xs text-muted-foreground">{r.fileName}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        {r.status === "success" && r.recordsProcessed !== undefined && (
                          <span className="text-muted-foreground">
                            {r.recordsProcessed} records
                          </span>
                        )}
                        {r.status === "failed" && (
                          <Badge variant="destructive">{r.message}</Badge>
                        )}
                        {r.fileDate && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(r.fileDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* MAINTENANCE TAB */}
        <TabsContent value="maintenance" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
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
              <div className="flex items-center justify-between">
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
