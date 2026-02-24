import { useState, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Upload,
  RefreshCw,
  Database,
  CheckCircle,
  XCircle,
  AlertTriangle,
  FileSpreadsheet,
  ChevronDown,
  ChevronRight,
  Trash2,
} from "lucide-react";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface ProjectPreview {
  projectName: string;
  projectInfo: {
    contractValue: string | null;
    systemSize: string | null;
    clientName: string | null;
    projectPhase: string | null;
    location: string | null;
  } | null;
  planTaskCount: number;
  revenueLineCount: number;
  costLineCount: number;
  executionPhaseCount: number;
  counterpartyNames: string[];
  issues: Array<{ severity: string; section: string; message: string }>;
  hasBlockers: boolean;
  sheetsFound: string[];
  fileHash: string;
  cosRealisedCount: number;
  cashflowConfirmedCount: number;
}

interface ImportedProject {
  id: number;
  projectName: string;
  projectPhase: string | null;
  contractValue: string | null;
  costLineCount: number;
  revenueLineCount: number;
  planTaskCount: number;
}

interface CommitResult {
  projectId: number;
  importRunId: number;
  summary: {
    projectName: string;
    planTasks: number;
    revenueLines: number;
    costLines: number;
    executionPhases: number;
    cosRealisedCount: number;
    cashflowConfirmedCount: number;
    issues: number;
  };
}

type Step = "upload" | "preview" | "committed";

export default function BootstrapImportPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<ProjectPreview | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [overrideName, setOverrideName] = useState("");
  const [projects, setProjects] = useState<ImportedProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [showIssues, setShowIssues] = useState(false);

  const fetchProjects = useCallback(async () => {
    try {
      setLoadingProjects(true);
      const res = await fetch("/api/bootstrap-import/projects", { headers: getAuthHeaders() });
      if (res.ok) setProjects(await res.json());
    } catch { /* ignore */ } finally {
      setLoadingProjects(false);
    }
  }, []);

  const handleFileSelect = useCallback(async (file: File) => {
    setSelectedFile(file);
    setUploading(true);
    setPreview(null);
    setCommitResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/bootstrap-import/preview", {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Preview failed");
      }

      const data: ProjectPreview = await res.json();
      setPreview(data);
      setOverrideName(data.projectName);
      setStep("preview");
    } catch (error: any) {
      toast({ title: "Preview Error", description: error.message, variant: "destructive" });
      setStep("upload");
    } finally {
      setUploading(false);
    }
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && /\.(xlsx|xlsm|xls)$/i.test(file.name)) {
      handleFileSelect(file);
    } else {
      toast({ title: "Invalid File", description: "Please upload an Excel file (.xlsx, .xlsm, .xls)", variant: "destructive" });
    }
  }, [handleFileSelect, toast]);

  const handleCommit = useCallback(async () => {
    if (!selectedFile || !preview) return;
    setCommitting(true);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      if (overrideName && overrideName !== preview.projectName) {
        formData.append("projectName", overrideName);
      }

      const res = await fetch("/api/bootstrap-import/commit", {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Commit failed");
      }

      const result: CommitResult = await res.json();
      setCommitResult(result);
      setStep("committed");
      toast({ title: "Project Created", description: `"${result.summary.projectName}" created with all data imported.` });
      fetchProjects();
    } catch (error: any) {
      toast({ title: "Commit Error", description: error.message, variant: "destructive" });
    } finally {
      setCommitting(false);
    }
  }, [selectedFile, preview, overrideName, toast, fetchProjects]);

  const handleReset = useCallback(() => {
    setStep("upload");
    setPreview(null);
    setCommitResult(null);
    setSelectedFile(null);
    setOverrideName("");
    setShowIssues(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleRebuildDerived = useCallback(async () => {
    setRebuilding(true);
    try {
      const res = await fetch("/api/bootstrap-import/rebuild-derived", {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        toast({ title: "KPIs Rebuilt", description: "Derived tables have been rebuilt." });
      } else {
        const err = await res.json();
        throw new Error(err.error);
      }
    } catch (error: any) {
      toast({ title: "Rebuild Error", description: error.message, variant: "destructive" });
    } finally {
      setRebuilding(false);
    }
  }, [toast]);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6" data-testid="bootstrap-import-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Create Project from Tracker</h1>
          <p className="text-sm text-gray-500 mt-1">
            Upload a project tracker Excel file to create a project with all its data in one step.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchProjects} disabled={loadingProjects} data-testid="button-refresh-projects">
            {loadingProjects ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="ml-1">Projects</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleRebuildDerived} disabled={rebuilding} data-testid="button-rebuild-kpis">
            {rebuilding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
            <span className="ml-1">Rebuild KPIs</span>
          </Button>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm" data-testid="step-indicator">
        <StepBadge active={step === "upload"} completed={step !== "upload"} label="1. Upload" />
        <span className="text-gray-300">→</span>
        <StepBadge active={step === "preview"} completed={step === "committed"} label="2. Preview" />
        <span className="text-gray-300">→</span>
        <StepBadge active={step === "committed"} completed={false} label="3. Done" />
      </div>

      {/* Upload step */}
      {step === "upload" && (
        <Card data-testid="card-upload">
          <CardContent className="pt-6">
            <div
              className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
                uploading ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-blue-400 hover:bg-blue-50/50"
              }`}
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              data-testid="dropzone"
            >
              {uploading ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
                  <p className="text-sm text-gray-600">Analyzing tracker file...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Upload className="w-10 h-10 text-gray-400" />
                  <p className="font-medium text-gray-700">Drop your tracker file here, or click to browse</p>
                  <p className="text-xs text-gray-400">Supported: .xlsx, .xlsm, .xls (max 50MB)</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xlsm,.xls"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelect(f);
                }}
                data-testid="input-file"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Preview step */}
      {step === "preview" && preview && (
        <>
          <Card data-testid="card-preview">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileSpreadsheet className="w-5 h-5" />
                Preview: {selectedFile?.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Project name override */}
              <div>
                <label className="text-sm font-medium text-gray-700">Project Name</label>
                <Input
                  value={overrideName}
                  onChange={e => setOverrideName(e.target.value)}
                  placeholder="Project name"
                  className="mt-1"
                  data-testid="input-project-name"
                />
              </div>

              {/* Detected project info */}
              {preview.projectInfo && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="detected-info">
                  <InfoPill label="Contract Value" value={preview.projectInfo.contractValue} />
                  <InfoPill label="System Size" value={preview.projectInfo.systemSize} />
                  <InfoPill label="Phase" value={preview.projectInfo.projectPhase} />
                  <InfoPill label="PD" value={preview.projectInfo.clientName} />
                </div>
              )}

              {/* Data summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="data-summary">
                <CountCard label="Plan Tasks" count={preview.planTaskCount} icon="📋" />
                <CountCard label="Revenue Lines" count={preview.revenueLineCount} icon="💰" />
                <CountCard label="Cost Lines" count={preview.costLineCount} icon="📊" />
                <CountCard label="Phases" count={preview.executionPhaseCount} icon="🔄" />
              </div>

              {/* Business rules summary */}
              <div className="grid grid-cols-2 gap-3" data-testid="business-rules">
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="text-xs text-green-700 font-medium">COS Realised</div>
                  <div className="text-lg font-bold text-green-800" data-testid="text-cos-realised">
                    {preview.cosRealisedCount} of {preview.costLineCount}
                  </div>
                  <div className="text-[10px] text-green-600">Invoice captured + black font date</div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="text-xs text-blue-700 font-medium">Cashflow Confirmed</div>
                  <div className="text-lg font-bold text-blue-800" data-testid="text-cashflow-confirmed">
                    {preview.cashflowConfirmedCount} of {preview.costLineCount}
                  </div>
                  <div className="text-[10px] text-blue-600">Invoice + PO + black font payment date</div>
                </div>
              </div>

              {/* Sheets found */}
              <div className="flex flex-wrap gap-1">
                {preview.sheetsFound.map((s, i) => (
                  <Badge key={i} variant="outline" className="text-xs" data-testid={`badge-sheet-${i}`}>{s}</Badge>
                ))}
              </div>

              {/* Counterparties */}
              {preview.counterpartyNames.length > 0 && (
                <div>
                  <span className="text-xs font-medium text-gray-500">
                    {preview.counterpartyNames.length} counterparties detected
                  </span>
                </div>
              )}

              {/* Issues */}
              {preview.issues.length > 0 && (
                <div>
                  <button
                    className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
                    onClick={() => setShowIssues(!showIssues)}
                    data-testid="button-toggle-issues"
                  >
                    {showIssues ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    {preview.issues.length} issue(s)
                    {preview.hasBlockers && <Badge variant="destructive" className="ml-1 text-[10px]">BLOCKERS</Badge>}
                  </button>
                  {showIssues && (
                    <div className="mt-2 space-y-1 max-h-48 overflow-y-auto" data-testid="issues-list">
                      {preview.issues.map((issue, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs p-2 bg-gray-50 rounded">
                          {issue.severity === "BLOCKER" ? (
                            <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                          ) : issue.severity === "WARNING" ? (
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                          ) : (
                            <CheckCircle className="w-3.5 h-3.5 text-blue-500 mt-0.5 flex-shrink-0" />
                          )}
                          <div>
                            <span className="font-medium">[{issue.section}]</span> {issue.message}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Action buttons */}
          <div className="flex gap-3 justify-end" data-testid="action-buttons">
            <Button variant="outline" onClick={handleReset} data-testid="button-cancel">
              Cancel
            </Button>
            <Button
              onClick={handleCommit}
              disabled={committing || preview.hasBlockers || !overrideName.trim()}
              data-testid="button-commit"
            >
              {committing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Creating Project...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Create Project
                </>
              )}
            </Button>
          </div>

          {preview.hasBlockers && (
            <p className="text-xs text-red-600 text-right" data-testid="text-blocker-warning">
              Cannot create project while blockers exist. Fix the tracker file and re-upload.
            </p>
          )}
        </>
      )}

      {/* Committed step */}
      {step === "committed" && commitResult && (
        <Card data-testid="card-committed">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
              <h2 className="text-xl font-bold text-green-700" data-testid="text-success-title">
                Project Created Successfully
              </h2>
              <p className="text-gray-600" data-testid="text-success-name">
                "{commitResult.summary.projectName}" (ID: {commitResult.projectId})
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-lg mx-auto" data-testid="commit-summary">
                <CountCard label="Plan Tasks" count={commitResult.summary.planTasks} icon="📋" />
                <CountCard label="Revenue" count={commitResult.summary.revenueLines} icon="💰" />
                <CountCard label="Cost Lines" count={commitResult.summary.costLines} icon="📊" />
                <CountCard label="Phases" count={commitResult.summary.executionPhases} icon="🔄" />
              </div>
              <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto">
                <div className="bg-green-50 border border-green-200 rounded p-2 text-center">
                  <div className="text-xs text-green-700">COS Realised</div>
                  <div className="font-bold text-green-800">{commitResult.summary.cosRealisedCount}</div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded p-2 text-center">
                  <div className="text-xs text-blue-700">Cashflow Confirmed</div>
                  <div className="font-bold text-blue-800">{commitResult.summary.cashflowConfirmedCount}</div>
                </div>
              </div>
              <Button onClick={handleReset} className="mt-4" data-testid="button-import-another">
                <Upload className="w-4 h-4 mr-2" />
                Import Another Project
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Imported projects list */}
      {projects.length > 0 && (
        <Card data-testid="card-projects-list">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Imported Projects ({projects.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {projects.map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg" data-testid={`row-project-${p.id}`}>
                  <div>
                    <span className="font-medium text-sm">{p.projectName}</span>
                    {p.projectPhase && (
                      <Badge variant="outline" className="ml-2 text-[10px]">{p.projectPhase}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    <span>{p.planTaskCount} tasks</span>
                    <span>{p.revenueLineCount} revenue</span>
                    <span>{p.costLineCount} costs</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StepBadge({ active, completed, label }: { active: boolean; completed: boolean; label: string }) {
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
      active ? "bg-blue-100 text-blue-800" :
      completed ? "bg-green-100 text-green-800" :
      "bg-gray-100 text-gray-500"
    }`}>
      {completed && <CheckCircle className="w-3 h-3 inline mr-1" />}
      {label}
    </span>
  );
}

function CountCard({ label, count, icon }: { label: string; count: number; icon: string }) {
  return (
    <div className="bg-gray-50 border rounded-lg p-3 text-center">
      <div className="text-lg">{icon}</div>
      <div className="text-xl font-bold">{count}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="bg-white border rounded-lg p-2">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-sm font-medium truncate">{value}</div>
    </div>
  );
}
