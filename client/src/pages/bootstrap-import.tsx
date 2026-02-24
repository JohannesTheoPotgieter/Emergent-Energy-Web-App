import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Loader2,
  Play,
  Search,
  RefreshCw,
  Download,
  Database,
  CheckCircle,
  XCircle,
  AlertTriangle,
  FileSpreadsheet,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

interface ScanResult {
  files: { path: string; name: string; sizeKb: number }[];
  totalFiles: number;
}

interface RunSummary {
  discovered: number;
  imported: number;
  updated: number;
  skipped: number;
  quarantined: number;
  errors: number;
  successCount: number;
}

interface StagingRow {
  id: number;
  sourcePath: string;
  projectNameExtracted: string;
  canonicalProjectName: string | null;
  parseStatus: string;
  errorReason: string | null;
  planRowCount: number | null;
  revenueRowCount: number | null;
  costRowCount: number | null;
  needsReview: boolean;
  sheetsFound: any;
}

interface ImportRun {
  id: number;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  discoveredCount: number;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  quarantinedCount: number;
  errorsCount: number;
}

interface ReportData {
  run: ImportRun;
  staging: StagingRow[];
  quarantined: StagingRow[];
  validation: any;
  summary: RunSummary;
}

export default function BootstrapImportPage() {
  const { toast } = useToast();
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<ImportRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [featureFlag, setFeatureFlag] = useState(false);
  const [togglingFlag, setTogglingFlag] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [expandedQuarantine, setExpandedQuarantine] = useState<Set<number>>(new Set());

  const fetchRuns = useCallback(async () => {
    try {
      setLoadingRuns(true);
      const res = await fetch("/api/bootstrap-import/runs", { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setRuns(data);
      }
    } catch {
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  const fetchFeatureFlag = useCallback(async () => {
    try {
      const res = await fetch("/api/bootstrap-import/feature-flag", { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setFeatureFlag(data.USE_NEW_DASHBOARD_ROLLUPS || false);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchRuns();
    fetchFeatureFlag();
  }, [fetchRuns, fetchFeatureFlag]);

  async function handleScan() {
    setScanning(true);
    try {
      const res = await fetch("/api/bootstrap-import/scan", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = await res.json();
        setScanResult(data);
        toast({ title: `Found ${data.totalFiles} Excel file(s)` });
      } else {
        const err = await res.json();
        toast({ title: "Scan failed", description: err.error, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Scan failed", description: e.message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  }

  async function handleRun() {
    setRunning(true);
    try {
      const res = await fetch("/api/bootstrap-import/run", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = await res.json();
        toast({ title: "Import started", description: `Run #${data.runId} in progress` });
        await fetchRuns();
        setSelectedRunId(data.runId);
        loadReport(data.runId);
      } else {
        const err = await res.json();
        toast({ title: "Import failed", description: err.error, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  async function loadReport(runId: number) {
    setLoadingReport(true);
    setSelectedRunId(runId);
    try {
      const res = await fetch(`/api/bootstrap-import/report/${runId}`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setReport(data);
      } else {
        toast({ title: "Failed to load report", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to load report", variant: "destructive" });
    } finally {
      setLoadingReport(false);
    }
  }

  async function handleDownloadReport(runId: number) {
    try {
      const res = await fetch(`/api/bootstrap-import/report/${runId}/download`, { headers: getAuthHeaders() });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `bootstrap-import-run-${runId}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {}
  }

  async function handleToggleFeatureFlag() {
    setTogglingFlag(true);
    try {
      const res = await fetch("/api/bootstrap-import/feature-flag", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ enabled: !featureFlag }),
      });
      if (res.ok) {
        const data = await res.json();
        setFeatureFlag(data.USE_NEW_DASHBOARD_ROLLUPS);
        toast({ title: data.message });
      }
    } catch {
      toast({ title: "Failed to toggle feature flag", variant: "destructive" });
    } finally {
      setTogglingFlag(false);
    }
  }

  async function handleRebuildDerived() {
    setRebuilding(true);
    try {
      const res = await fetch("/api/bootstrap-import/rebuild-derived", {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        toast({ title: "Derived tables rebuilt successfully" });
      } else {
        const err = await res.json();
        toast({ title: "Rebuild failed", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Rebuild failed", variant: "destructive" });
    } finally {
      setRebuilding(false);
    }
  }

  function toggleQuarantine(id: number) {
    setExpandedQuarantine(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto" data-testid="bootstrap-import-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Database className="h-6 w-6" />
            Bootstrap Import
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Bulk import Excel trackers, rebuild derived KPI tables, and manage the dashboard rollup feature flag.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Dashboard Rollups</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">
                  {featureFlag ? "Using pre-computed KPIs" : "Using live queries"}
                </p>
              </div>
              <Switch
                data-testid="switch-feature-flag"
                checked={featureFlag}
                onCheckedChange={handleToggleFeatureFlag}
                disabled={togglingFlag}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Import Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="text-run-count">{runs.length}</p>
            <p className="text-xs text-muted-foreground">Total import runs</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={handleScan} disabled={scanning} data-testid="button-scan">
              {scanning ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Search className="h-4 w-4 mr-1" />}
              Scan Files
            </Button>
            <Button size="sm" onClick={handleRun} disabled={running} data-testid="button-run">
              {running ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
              Run Import
            </Button>
            <Button size="sm" variant="outline" onClick={handleRebuildDerived} disabled={rebuilding} data-testid="button-rebuild">
              {rebuilding ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Rebuild KPIs
            </Button>
          </CardContent>
        </Card>
      </div>

      {scanResult && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              Scan Results ({scanResult.totalFiles} files)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scanResult.files.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Excel files found in uploads directory.</p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {scanResult.files.map((f, i) => (
                  <div key={i} className="flex justify-between text-sm py-1 border-b border-border/50 last:border-0">
                    <span className="font-mono text-xs truncate max-w-[70%]">{f.name}</span>
                    <span className="text-muted-foreground text-xs">{f.sizeKb} KB</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              Import History
              <Button size="sm" variant="ghost" onClick={fetchRuns} disabled={loadingRuns}>
                <RefreshCw className={`h-3 w-3 ${loadingRuns ? "animate-spin" : ""}`} />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingRuns ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No import runs yet.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {runs.map(run => (
                  <button
                    key={run.id}
                    data-testid={`button-run-${run.id}`}
                    className={`w-full text-left p-2 rounded border text-sm hover:bg-accent/50 transition-colors ${
                      selectedRunId === run.id ? "border-primary bg-accent/30" : "border-border"
                    }`}
                    onClick={() => loadReport(run.id)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Run #{run.id}</span>
                      <Badge variant={run.status === "COMPLETED" ? "default" : run.status === "FAILED" ? "destructive" : "secondary"}>
                        {run.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {new Date(run.startedAt).toLocaleString()}
                    </div>
                    <div className="flex gap-2 mt-1 text-xs">
                      <span>{run.importedCount} imported</span>
                      {run.quarantinedCount > 0 && (
                        <span className="text-amber-500">{run.quarantinedCount} quarantined</span>
                      )}
                      {run.errorsCount > 0 && (
                        <span className="text-red-500">{run.errorsCount} errors</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              {report ? `Run #${report.run.id} Report` : "Select a run to view report"}
              {report && (
                <Button size="sm" variant="outline" onClick={() => handleDownloadReport(report.run.id)} data-testid="button-download-report">
                  <Download className="h-3 w-3 mr-1" /> Export
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingReport ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : !report ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Click on an import run from the history to view its detailed report.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  {[
                    { label: "Discovered", value: report.summary.discovered, color: "text-blue-400" },
                    { label: "Imported", value: report.summary.imported, color: "text-green-400" },
                    { label: "Updated", value: report.summary.updated, color: "text-cyan-400" },
                    { label: "Skipped", value: report.summary.skipped, color: "text-gray-400" },
                    { label: "Quarantined", value: report.summary.quarantined, color: "text-amber-400" },
                    { label: "Errors", value: report.summary.errors, color: "text-red-400" },
                  ].map(s => (
                    <div key={s.label} className="text-center">
                      <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                    </div>
                  ))}
                </div>

                <div>
                  <h4 className="text-sm font-medium mb-2">Projects</h4>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {report.staging.map(s => (
                      <div key={s.id} className="flex items-center justify-between py-1 px-2 rounded text-sm bg-accent/20">
                        <div className="flex items-center gap-2 min-w-0">
                          {s.parseStatus === "OK" && !s.needsReview ? (
                            <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                          ) : s.parseStatus === "FAILED" ? (
                            <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                          ) : (
                            <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                          )}
                          <span className="truncate">{s.projectNameExtracted || s.sourcePath}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 text-xs text-muted-foreground">
                          {s.planRowCount !== null && <span>{s.planRowCount}P</span>}
                          {s.revenueRowCount !== null && <span>{s.revenueRowCount}R</span>}
                          {s.costRowCount !== null && <span>{s.costRowCount}C</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {report.quarantined.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      Quarantined ({report.quarantined.length})
                    </h4>
                    <div className="space-y-1">
                      {report.quarantined.map(q => (
                        <div key={q.id} className="border border-amber-500/30 rounded p-2">
                          <button
                            className="w-full flex items-center gap-2 text-sm text-left"
                            onClick={() => toggleQuarantine(q.id)}
                          >
                            {expandedQuarantine.has(q.id) ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                            <span className="font-medium">{q.projectNameExtracted}</span>
                            <Badge variant="outline" className="text-xs ml-auto">{q.parseStatus}</Badge>
                          </button>
                          {expandedQuarantine.has(q.id) && (
                            <div className="mt-2 text-xs text-muted-foreground">
                              <p>{q.errorReason || "Needs manual review"}</p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
