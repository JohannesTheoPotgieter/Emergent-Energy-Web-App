import { useState, useCallback, useRef, useId } from "react";
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
  FolderOpen,
  Trash2,
  Files,
} from "lucide-react";

let _nextId = 0;
function makeFileId(): string {
  return `f_${++_nextId}_${Date.now()}`;
}

async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  let batch: FileSystemEntry[];
  do {
    batch = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries(e => resolve(e), () => resolve([]));
    });
    all.push(...batch);
  } while (batch.length > 0);
  return all;
}

async function traverseEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file(f => resolve([f]), () => resolve([]));
    });
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const entries = await readAllEntries(reader);
    const nested = await Promise.all(entries.map(e => traverseEntry(e)));
    return nested.flat();
  }
  return [];
}

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

interface FilePreviewItem {
  id: string;
  file: File;
  fileName: string;
  preview: ProjectPreview | null;
  error: string | null;
  selected: boolean;
  overrideName: string;
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

interface CommitResultItem {
  fileName: string;
  result?: {
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
  };
  error?: string;
}

type Step = "upload" | "preview" | "committing" | "committed";

export default function BootstrapImportPage() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [fileItems, setFileItems] = useState<FilePreviewItem[]>([]);
  const [commitResults, setCommitResults] = useState<CommitResultItem[]>([]);
  const [projects, setProjects] = useState<ImportedProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      setLoadingProjects(true);
      const res = await fetch("/api/bootstrap-import/projects", { headers: getAuthHeaders() });
      if (res.ok) setProjects(await res.json());
    } catch { /* ignore */ } finally {
      setLoadingProjects(false);
    }
  }, []);

  const handleFilesSelected = useCallback(async (files: File[]) => {
    const excelFiles = files.filter(f => /\.(xlsx|xlsm|xls)$/i.test(f.name) && !f.name.startsWith("~$"));
    if (excelFiles.length === 0) {
      toast({ title: "No Excel Files", description: "No .xlsx, .xlsm, or .xls files found in your selection.", variant: "destructive" });
      return;
    }

    setUploading(true);
    setCommitResults([]);

    const nameCount = new Map<string, number>();
    excelFiles.forEach(f => nameCount.set(f.name, (nameCount.get(f.name) || 0) + 1));

    const nameSuffix = new Map<string, number>();
    const items: FilePreviewItem[] = excelFiles.map(f => {
      const count = nameCount.get(f.name) || 1;
      let displayName = f.name;
      if (count > 1) {
        const idx = (nameSuffix.get(f.name) || 0) + 1;
        nameSuffix.set(f.name, idx);
        displayName = `${f.name} (${idx})`;
      }
      return {
        id: makeFileId(),
        file: f,
        fileName: displayName,
        preview: null,
        error: null,
        selected: true,
        overrideName: "",
      };
    });
    setFileItems(items);
    setStep("preview");

    const formData = new FormData();
    excelFiles.forEach(f => formData.append("files", f));

    try {
      const res = await fetch("/api/bootstrap-import/preview-batch", {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Preview failed");
      }

      const data = await res.json();
      const updatedItems = items.map((item, idx) => {
        const match = data.results[idx];
        if (match?.preview) {
          return { ...item, preview: match.preview, overrideName: match.preview.projectName };
        } else if (match?.error) {
          return { ...item, error: match.error, selected: false };
        }
        return item;
      });
      setFileItems(updatedItems);
    } catch (error: any) {
      toast({ title: "Preview Error", description: error.message, variant: "destructive" });
      setFileItems(items.map(i => ({ ...i, error: "Failed to analyze", selected: false })));
    } finally {
      setUploading(false);
    }
  }, [toast]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const dtItems = e.dataTransfer.items;
    const allFiles: File[] = [];

    if (dtItems) {
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < dtItems.length; i++) {
        const entry = dtItems[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      if (entries.length > 0) {
        const nested = await Promise.all(entries.map(e => traverseEntry(e)));
        allFiles.push(...nested.flat());
      } else {
        for (let i = 0; i < dtItems.length; i++) {
          const file = dtItems[i].getAsFile();
          if (file) allFiles.push(file);
        }
      }
    } else {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        allFiles.push(e.dataTransfer.files[i]);
      }
    }

    if (allFiles.length > 0) handleFilesSelected(allFiles);
  }, [handleFilesSelected]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) handleFilesSelected(files);
  }, [handleFilesSelected]);

  const toggleFileSelection = useCallback((id: string) => {
    setFileItems(prev => prev.map(item =>
      item.id === id ? { ...item, selected: !item.selected } : item
    ));
  }, []);

  const updateOverrideName = useCallback((id: string, name: string) => {
    setFileItems(prev => prev.map(item =>
      item.id === id ? { ...item, overrideName: name } : item
    ));
  }, []);

  const handleCommitAll = useCallback(async () => {
    const selected = fileItems.filter(f => f.selected && f.preview && !f.error);
    if (selected.length === 0) return;

    setCommitting(true);
    setStep("committing");

    try {
      const formData = new FormData();
      const nameOverrides: Record<string, string> = {};

      selected.forEach((item, idx) => {
        formData.append("files", item.file);
        if (item.overrideName && item.overrideName !== item.preview?.projectName) {
          nameOverrides[String(idx)] = item.overrideName;
        }
      });

      if (Object.keys(nameOverrides).length > 0) {
        formData.append("nameOverrides", JSON.stringify(nameOverrides));
      }

      const res = await fetch("/api/bootstrap-import/commit-batch", {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Commit failed");
      }

      const data = await res.json();
      const mappedResults = data.results.map((r: any, i: number) => ({
        ...r,
        fileName: selected[i]?.fileName || r.fileName,
      }));
      setCommitResults(mappedResults);
      setStep("committed");

      const succeeded = data.committed || 0;
      const failed = data.failed || 0;
      toast({
        title: "Import Complete",
        description: `${succeeded} project(s) created${failed > 0 ? `, ${failed} failed` : ""}.`,
        variant: failed > 0 ? "destructive" : "default",
      });
      fetchProjects();
    } catch (error: any) {
      toast({ title: "Commit Error", description: error.message, variant: "destructive" });
      setStep("preview");
    } finally {
      setCommitting(false);
    }
  }, [fileItems, toast, fetchProjects]);

  const handleReset = useCallback(() => {
    setStep("upload");
    setFileItems([]);
    setCommitResults([]);
    setExpandedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
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

  const selectedCount = fileItems.filter(f => f.selected && f.preview && !f.error).length;
  const totalPlan = fileItems.filter(f => f.selected && f.preview).reduce((s, f) => s + (f.preview?.planTaskCount || 0), 0);
  const totalRevenue = fileItems.filter(f => f.selected && f.preview).reduce((s, f) => s + (f.preview?.revenueLineCount || 0), 0);
  const totalCost = fileItems.filter(f => f.selected && f.preview).reduce((s, f) => s + (f.preview?.costLineCount || 0), 0);
  const totalCosRealised = fileItems.filter(f => f.selected && f.preview).reduce((s, f) => s + (f.preview?.cosRealisedCount || 0), 0);
  const totalCashflow = fileItems.filter(f => f.selected && f.preview).reduce((s, f) => s + (f.preview?.cashflowConfirmedCount || 0), 0);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6" data-testid="bootstrap-import-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Bootstrap Import</h1>
          <p className="text-sm text-gray-500 mt-1">
            Select multiple tracker files to create projects with all their data in one go.
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
        <StepBadge active={step === "upload"} completed={step !== "upload"} label="1. Select Files" />
        <span className="text-gray-300">&rarr;</span>
        <StepBadge active={step === "preview"} completed={step === "committing" || step === "committed"} label="2. Review" />
        <span className="text-gray-300">&rarr;</span>
        <StepBadge active={step === "committed"} completed={false} label="3. Done" />
      </div>

      {/* Upload step */}
      {step === "upload" && (
        <Card data-testid="card-upload">
          <CardContent className="pt-6">
            <div
              className={`border-2 border-dashed rounded-lg p-10 text-center transition-colors ${
                uploading ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-blue-400 hover:bg-blue-50/50"
              }`}
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
              data-testid="dropzone"
            >
              {uploading ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
                  <p className="text-sm text-gray-600">Analyzing tracker files...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <FolderOpen className="w-10 h-10 text-gray-400" />
                  <p className="font-medium text-gray-700">Drop a folder or files here</p>
                  <p className="text-xs text-gray-400">Supports .xlsx, .xlsm, .xls files (max 50MB each)</p>
                  <div className="flex gap-3 mt-2">
                    <Button
                      variant="default"
                      onClick={(e) => { e.stopPropagation(); folderInputRef.current?.click(); }}
                      data-testid="button-choose-folder"
                    >
                      <FolderOpen className="w-4 h-4 mr-2" />
                      Choose Folder
                    </Button>
                    <Button
                      variant="outline"
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                      data-testid="button-choose-files"
                    >
                      <Files className="w-4 h-4 mr-2" />
                      Choose Files
                    </Button>
                  </div>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xlsm,.xls"
                multiple
                className="hidden"
                onChange={handleInputChange}
                data-testid="input-file"
              />
              <input
                ref={folderInputRef}
                type="file"
                {...{ webkitdirectory: "", directory: "" } as any}
                className="hidden"
                onChange={handleInputChange}
                data-testid="input-folder"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Preview step */}
      {(step === "preview" || step === "committing") && (
        <>
          {/* Batch summary */}
          {!uploading && fileItems.length > 0 && (
            <Card data-testid="card-batch-summary">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium">
                    {selectedCount} of {fileItems.length} file(s) selected for import
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleReset} disabled={committing} data-testid="button-cancel">
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleCommitAll} disabled={committing || selectedCount === 0} data-testid="button-commit-all">
                      {committing ? (
                        <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Creating {selectedCount} Projects...</>
                      ) : (
                        <><CheckCircle className="w-4 h-4 mr-1" /> Create {selectedCount} Project(s)</>
                      )}
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-3 md:grid-cols-5 gap-2 text-center">
                  <MiniStat label="Plan Tasks" value={totalPlan} />
                  <MiniStat label="Revenue" value={totalRevenue} />
                  <MiniStat label="Cost Lines" value={totalCost} />
                  <MiniStat label="COS Realised" value={totalCosRealised} color="green" />
                  <MiniStat label="Cashflow OK" value={totalCashflow} color="blue" />
                </div>
              </CardContent>
            </Card>
          )}

          {uploading && (
            <Card>
              <CardContent className="pt-6 text-center">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
                <p className="text-sm text-gray-600">Analyzing {fileItems.length} file(s)...</p>
              </CardContent>
            </Card>
          )}

          {/* Individual file cards */}
          <div className="space-y-2" data-testid="file-list">
            {fileItems.map(item => (
              <FileCard
                key={item.id}
                item={item}
                expanded={expandedFile === item.id}
                onToggleExpand={() => setExpandedFile(expandedFile === item.id ? null : item.id)}
                onToggleSelect={() => toggleFileSelection(item.id)}
                onNameChange={(name) => updateOverrideName(item.id, name)}
                disabled={committing}
              />
            ))}
          </div>
        </>
      )}

      {/* Committed step */}
      {step === "committed" && commitResults.length > 0 && (
        <Card data-testid="card-committed">
          <CardContent className="pt-6">
            <div className="text-center mb-6">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-2" />
              <h2 className="text-xl font-bold text-green-700" data-testid="text-success-title">
                Import Complete
              </h2>
              <p className="text-sm text-gray-500">
                {commitResults.filter(r => r.result).length} project(s) created
                {commitResults.filter(r => r.error).length > 0 && `, ${commitResults.filter(r => r.error).length} failed`}
              </p>
            </div>
            <div className="space-y-2" data-testid="commit-results">
              {commitResults.map((r, i) => (
                <div key={i} className={`flex items-center justify-between p-3 rounded-lg ${r.result ? "bg-green-50" : "bg-red-50"}`}
                     data-testid={`result-${i}`}>
                  <div className="flex items-center gap-2">
                    {r.result ? <CheckCircle className="w-4 h-4 text-green-600" /> : <XCircle className="w-4 h-4 text-red-600" />}
                    <span className="text-sm font-medium">{r.fileName}</span>
                    {r.result && <span className="text-xs text-gray-500">&rarr; {r.result.summary.projectName}</span>}
                  </div>
                  {r.result ? (
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>{r.result.summary.planTasks} tasks</span>
                      <span>{r.result.summary.revenueLines} rev</span>
                      <span>{r.result.summary.costLines} cost</span>
                      <Badge variant="outline" className="text-[10px]">ID: {r.result.projectId}</Badge>
                    </div>
                  ) : (
                    <span className="text-xs text-red-600 max-w-xs truncate">{r.error}</span>
                  )}
                </div>
              ))}
            </div>
            <div className="text-center mt-6">
              <Button onClick={handleReset} data-testid="button-import-more">
                <Upload className="w-4 h-4 mr-2" />
                Import More Files
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
                    {p.projectPhase && <Badge variant="outline" className="ml-2 text-[10px]">{p.projectPhase}</Badge>}
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

function FileCard({
  item,
  expanded,
  onToggleExpand,
  onToggleSelect,
  onNameChange,
  disabled,
}: {
  item: FilePreviewItem;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  onNameChange: (name: string) => void;
  disabled: boolean;
}) {
  const p = item.preview;
  const hasBlockers = p?.hasBlockers || false;

  return (
    <Card className={`transition-colors ${item.selected ? "border-blue-200" : "border-gray-200 opacity-60"}`}
          data-testid={`file-card-${item.fileName}`}>
      <CardContent className="pt-3 pb-3">
        {/* Header row */}
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={item.selected}
            onChange={onToggleSelect}
            disabled={disabled || !!item.error || hasBlockers}
            className="w-4 h-4 rounded border-gray-300"
            data-testid={`checkbox-${item.fileName}`}
          />
          <button onClick={onToggleExpand} className="flex items-center gap-1 text-left flex-1 min-w-0" data-testid={`expand-${item.fileName}`}>
            {expanded ? <ChevronDown className="w-4 h-4 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 flex-shrink-0" />}
            <FileSpreadsheet className="w-4 h-4 text-green-600 flex-shrink-0" />
            <span className="text-sm font-medium truncate">{item.fileName}</span>
          </button>
          {item.error ? (
            <Badge variant="destructive" className="text-[10px] flex-shrink-0">
              <XCircle className="w-3 h-3 mr-1" /> Error
            </Badge>
          ) : p ? (
            <div className="flex items-center gap-2 flex-shrink-0 text-xs text-gray-500">
              <span>{p.planTaskCount} tasks</span>
              <span>{p.revenueLineCount} rev</span>
              <span>{p.costLineCount} cost</span>
              {p.cosRealisedCount > 0 && (
                <Badge variant="outline" className="text-[10px] text-green-700 border-green-300">
                  {p.cosRealisedCount} COS
                </Badge>
              )}
              {hasBlockers && <Badge variant="destructive" className="text-[10px]">BLOCKERS</Badge>}
            </div>
          ) : (
            <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
          )}
        </div>

        {/* Error message */}
        {item.error && (
          <p className="text-xs text-red-600 ml-8 mt-1">{item.error}</p>
        )}

        {/* Expanded details */}
        {expanded && p && (
          <div className="mt-3 ml-8 space-y-3">
            {/* Project name override */}
            <div>
              <label className="text-xs font-medium text-gray-500">Project Name</label>
              <Input
                value={item.overrideName}
                onChange={e => onNameChange(e.target.value)}
                className="mt-1 h-8 text-sm"
                disabled={disabled}
                data-testid={`input-name-${item.fileName}`}
              />
            </div>

            {/* Detected info */}
            {p.projectInfo && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <InfoPill label="Contract Value" value={p.projectInfo.contractValue} />
                <InfoPill label="System Size" value={p.projectInfo.systemSize} />
                <InfoPill label="Phase" value={p.projectInfo.projectPhase} />
                <InfoPill label="PD" value={p.projectInfo.clientName} />
              </div>
            )}

            {/* Data counts */}
            <div className="grid grid-cols-4 gap-2">
              <CountCard label="Plan Tasks" count={p.planTaskCount} />
              <CountCard label="Revenue" count={p.revenueLineCount} />
              <CountCard label="Costs" count={p.costLineCount} />
              <CountCard label="Phases" count={p.executionPhaseCount} />
            </div>

            {/* Business rules */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-green-50 border border-green-200 rounded p-2">
                <div className="text-[10px] text-green-700 font-medium">COS Realised</div>
                <div className="text-sm font-bold text-green-800">{p.cosRealisedCount} of {p.costLineCount}</div>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded p-2">
                <div className="text-[10px] text-blue-700 font-medium">Cashflow Confirmed</div>
                <div className="text-sm font-bold text-blue-800">{p.cashflowConfirmedCount} of {p.costLineCount}</div>
              </div>
            </div>

            {/* Sheets */}
            <div className="flex flex-wrap gap-1">
              {p.sheetsFound.map((s, i) => (
                <Badge key={i} variant="outline" className="text-[10px]">{s}</Badge>
              ))}
            </div>

            {/* Issues */}
            {p.issues.length > 0 && (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {p.issues.map((issue, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs p-1.5 bg-gray-50 rounded">
                    {issue.severity === "BLOCKER" ? (
                      <XCircle className="w-3 h-3 text-red-500 mt-0.5 flex-shrink-0" />
                    ) : issue.severity === "WARNING" ? (
                      <AlertTriangle className="w-3 h-3 text-amber-500 mt-0.5 flex-shrink-0" />
                    ) : (
                      <CheckCircle className="w-3 h-3 text-blue-500 mt-0.5 flex-shrink-0" />
                    )}
                    <span><span className="font-medium">[{issue.section}]</span> {issue.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
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

function CountCard({ label, count }: { label: string; count: number }) {
  return (
    <div className="bg-gray-50 border rounded p-2 text-center">
      <div className="text-sm font-bold">{count}</div>
      <div className="text-[10px] text-gray-500">{label}</div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color?: string }) {
  const colorClasses = color === "green" ? "text-green-700" : color === "blue" ? "text-blue-700" : "text-gray-900";
  return (
    <div className="text-center">
      <div className={`text-lg font-bold ${colorClasses}`}>{value}</div>
      <div className="text-[10px] text-gray-500">{label}</div>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="bg-white border rounded p-1.5">
      <div className="text-[9px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-xs font-medium truncate">{value}</div>
    </div>
  );
}
