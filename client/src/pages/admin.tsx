import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, XCircle, Loader2, Play, RefreshCw, FileSpreadsheet, Clock, Database } from "lucide-react";

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

interface RefreshResult {
  success: boolean;
  message: string;
  projectsRefreshed: number;
  projectsTotal: number;
  totalRecordsProcessed: number;
  results: {
    fileName: string;
    projectName: string;
    status: string;
    message?: string;
    recordsProcessed?: number;
  }[];
  timestamps: {
    started: string;
    completed: string;
    durationMs: number;
  };
}

interface RefreshHistory {
  lastRefresh: string | null;
  lastRefreshStatus: string | null;
  sourceFilesCount: number;
  sourceFiles: {
    projectName: string;
    fileName: string;
    filePath: string;
    exists: boolean;
    uploadedAt: string;
  }[];
}

export default function AdminPage() {
  const { user } = useAuth();
  const [smokeLoading, setSmokeLoading] = useState(false);
  const [smokeResult, setSmokeResult] = useState<SmokeTestResult | null>(null);
  const [smokeError, setSmokeError] = useState<string | null>(null);

  const [refreshLoading, setRefreshLoading] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshHistory, setRefreshHistory] = useState<RefreshHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadRefreshHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/admin/refresh-history", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setRefreshHistory(data);
      }
    } catch (err) {
      console.error("Failed to load refresh history:", err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    // Load history on mount (auth removed for stability)
    loadRefreshHistory();
  }, []);

  const runSmokeTest = async () => {
    setSmokeLoading(true);
    setSmokeError(null);
    setSmokeResult(null);

    try {
      const res = await fetch("/api/admin/smoke-test", { credentials: "include" });

      if (!res.ok) {
        if (res.status === 401) throw new Error("Authentication required. Please log in.");
        if (res.status === 403) throw new Error("Admin access required.");
        throw new Error(`Server error: ${res.status}`);
      }

      const data = await res.json();
      setSmokeResult(data);
    } catch (err: any) {
      setSmokeError(err?.message || "Failed to run smoke test");
    } finally {
      setSmokeLoading(false);
    }
  };

  const runDataRefresh = async () => {
    setRefreshLoading(true);
    setRefreshError(null);
    setRefreshResult(null);

    try {
      const res = await fetch("/api/admin/refresh-data", {
        method: "POST",
        credentials: "include",
      });

      if (!res.ok) {
        if (res.status === 401) throw new Error("Authentication required. Please log in.");
        if (res.status === 403) throw new Error("Admin access required.");
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData?.message || `Server error: ${res.status}`);
      }

      const data = await res.json();
      setRefreshResult(data);
      loadRefreshHistory();
    } catch (err: any) {
      setRefreshError(err?.message || "Failed to refresh data");
    } finally {
      setRefreshLoading(false);
    }
  };

  const formatCheckName = (name: string) => {
    return name.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  };

  // Auth removed for stability - page accessible to all users
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground">System health, data refresh, and diagnostics</p>
      </div>

      <Tabs defaultValue="refresh" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="refresh" data-testid="tab-data-refresh">
            <RefreshCw className="h-4 w-4 mr-2" />
            Data Refresh
          </TabsTrigger>
          <TabsTrigger value="smoke" data-testid="tab-smoke-test">
            <Play className="h-4 w-4 mr-2" />
            Smoke Test
          </TabsTrigger>
        </TabsList>

        <TabsContent value="refresh" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="h-5 w-5" />
                    Automated Data Refresh
                  </CardTitle>
                  <CardDescription>
                    Re-process all stored tracker files to update dashboard data
                  </CardDescription>
                </div>
                <Button
                  onClick={runDataRefresh}
                  disabled={refreshLoading}
                  data-testid="button-refresh-data"
                >
                  {refreshLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Refreshing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Refresh All Data
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {historyLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading source files...
                </div>
              ) : refreshHistory ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Last refresh:</span>
                      <span className="font-medium">
                        {refreshHistory.lastRefresh
                          ? new Date(refreshHistory.lastRefresh).toLocaleString()
                          : "Never"}
                      </span>
                    </div>
                    {refreshHistory.lastRefreshStatus && (
                      <Badge variant={refreshHistory.lastRefreshStatus === "success" ? "default" : "secondary"}>
                        {refreshHistory.lastRefreshStatus}
                      </Badge>
                    )}
                  </div>

                  <div className="border rounded-lg overflow-hidden">
                    <div className="bg-muted px-4 py-2 border-b">
                      <h4 className="font-medium text-sm">
                        Source Files ({refreshHistory.sourceFilesCount})
                      </h4>
                    </div>
                    <div className="divide-y max-h-60 overflow-y-auto">
                      {refreshHistory.sourceFiles.map((file, idx) => (
                        <div key={idx} className="px-4 py-2 flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">{file.projectName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {file.exists ? (
                              <Badge variant="outline" className="text-green-600 border-green-600">
                                Available
                              </Badge>
                            ) : (
                              <Badge variant="destructive">Missing</Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {file.uploadedAt
                                ? new Date(file.uploadedAt).toLocaleDateString()
                                : ""}
                            </span>
                          </div>
                        </div>
                      ))}
                      {refreshHistory.sourceFiles.length === 0 && (
                        <div className="px-4 py-8 text-center text-muted-foreground">
                          No source files found. Upload tracker files first.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {refreshError && (
            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="text-destructive flex items-center gap-2">
                  <XCircle className="h-5 w-5" />
                  Refresh Failed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p data-testid="text-refresh-error">{refreshError}</p>
              </CardContent>
            </Card>
          )}

          {refreshResult && (
            <Card className={refreshResult.success ? "border-green-500" : "border-yellow-500"}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    {refreshResult.success ? (
                      <CheckCircle className="h-6 w-6 text-green-500" />
                    ) : (
                      <XCircle className="h-6 w-6 text-yellow-500" />
                    )}
                    {refreshResult.message}
                  </CardTitle>
                  <Badge variant={refreshResult.success ? "default" : "secondary"}>
                    {refreshResult.totalRecordsProcessed.toLocaleString()} records
                  </Badge>
                </div>
                <CardDescription>
                  Completed in {refreshResult.timestamps.durationMs}ms at{" "}
                  {new Date(refreshResult.timestamps.completed).toLocaleString()}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {refreshResult.results.map((r, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2 bg-muted rounded"
                    >
                      <div className="flex items-center gap-2">
                        {r.status === "success" ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive" />
                        )}
                        <span className="font-medium">{r.projectName}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        {r.recordsProcessed !== undefined && (
                          <span className="text-muted-foreground">
                            {r.recordsProcessed} records
                          </span>
                        )}
                        {r.message && r.status !== "success" && (
                          <span className="text-destructive">{r.message}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="smoke" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button
              onClick={runSmokeTest}
              disabled={smokeLoading}
              data-testid="button-run-smoke-test"
            >
              {smokeLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Run Smoke Test
                </>
              )}
            </Button>
          </div>

          {smokeError && (
            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="text-destructive flex items-center gap-2">
                  <XCircle className="h-5 w-5" />
                  Error
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p data-testid="text-smoke-test-error">{smokeError}</p>
              </CardContent>
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
                    <Badge
                      variant={smokeResult.passed ? "default" : "destructive"}
                      data-testid="badge-smoke-test-result"
                    >
                      {smokeResult.checks.filter((c) => c.passed).length} /{" "}
                      {smokeResult.checks.length} checks passed
                    </Badge>
                  </div>
                  <CardDescription>
                    Completed in {smokeResult.timestamps.durationMs}ms at{" "}
                    {new Date(smokeResult.timestamps.completed).toLocaleString()}
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
                      <pre
                        className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-40"
                        data-testid={`details-${check.name}`}
                      >
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
                <p className="text-muted-foreground mb-4">
                  Click "Run Smoke Test" to validate system health and data integrity.
                </p>
                <p className="text-sm text-muted-foreground">
                  The smoke test checks: database connectivity, authentication, uploads, data
                  presence, cashflow series, revenue/COS data, and override functionality.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
