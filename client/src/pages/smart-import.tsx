import { useState, useEffect, useCallback, useRef, useMemo, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminPageShell, AdminQueryState } from "@/components/admin/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertCircle, AlertTriangle,
  Info, ArrowRight, ArrowLeft, Loader2, X, XCircle, Check, ChevronDown, ChevronUp,
  Pencil, History, Zap, SkipForward,
} from "lucide-react";
import { useLocation } from "wouter";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

const STEP_LABELS = ["Upload", "Sections", "Mapping", "Issues", "Commit"];

const CANONICAL_FIELDS: Record<string, string[]> = {
  PLAN: [
    "task_name", "task_no", "start_date", "end_date", "duration",
    "actual_start", "actual_end", "actual_duration",
    "pct_complete", "expected_pct", "owner", "predecessor", "phase", "comment",
  ],
  REVENUE: [
    "milestone_name", "milestone_no", "percent", "amount_ex_vat", "vat",
    "invoice_number", "invoice_date", "planned_payment_date",
    "payment_received_date", "in_bank_date", "requirements", "documents",
  ],
  EXPENDITURE: [
    "cost_category", "description", "counterparty", "budget_qty", "budget_rate",
    "budget_total", "actual_total", "amount_ex_vat", "po_number",
    "invoice_number", "invoice_date", "approved_date", "payment_date",
    "forecast_payment_date", "budget_cos", "actual_cos",
  ],
};

function confidenceBadge(confidence: number) {
  if (confidence > 0.8) {
    return (
      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0">
        {Math.round(confidence * 100)}%
      </Badge>
    );
  }
  if (confidence >= 0.5) {
    return (
      <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] px-1.5 py-0">
        {Math.round(confidence * 100)}%
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-50 text-red-700 border-red-200 text-[10px] px-1.5 py-0">
      {Math.round(confidence * 100)}%
    </Badge>
  );
}

function StepIndicator({ currentStep, onStepClick }: { currentStep: number; onStepClick?: (step: number) => void }) {
  return (
    <div className="flex items-center gap-1 mb-6" data-testid="step-indicator">
      {STEP_LABELS.map((label, idx) => {
        const stepNum = idx + 1;
        const isActive = stepNum === currentStep;
        const isComplete = stepNum < currentStep;
        const isClickable = isComplete && onStepClick;
        return (
          <div key={label} className="flex items-center gap-1">
            {idx > 0 && (
              <div className={`h-0.5 w-4 md:w-8 ${isComplete ? "bg-blue-500" : "bg-slate-200"}`} />
            )}
            <div
              className={`flex items-center gap-1.5 ${isClickable ? "cursor-pointer group" : ""}`}
              onClick={() => { if (isClickable) onStepClick(stepNum); }}
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                  isActive ? "bg-blue-600 text-white" :
                  isComplete ? "bg-blue-500 text-white group-hover:bg-blue-600" :
                  "bg-slate-200 text-muted-foreground"
                }`}
                data-testid={`step-circle-${stepNum}`}
              >
                {isComplete ? <Check className="w-3.5 h-3.5" /> : stepNum}
              </div>
              <span className={`text-xs hidden md:inline transition-colors ${
                isActive ? "font-semibold text-blue-700" :
                isComplete ? "text-muted-foreground group-hover:text-blue-600" :
                "text-muted-foreground"
              }`}>
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface FileUploadResult {
  file: File;
  status: "pending" | "uploading" | "success" | "error";
  runId?: number;
  preview?: any;
  error?: string;
  sectionsFound?: number;
}

function UploadStep({
  onUploaded,
  onBatchUploaded,
}: {
  onUploaded: (runId: number, preview: any) => void;
  onBatchUploaded?: (results: FileUploadResult[]) => void;
}) {
  const [files, setFiles] = useState<FileUploadResult[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const addFiles = (fileList: FileList | File[]) => {
    const newFiles: FileUploadResult[] = [];
    const arr = Array.from(fileList);
    for (const f of arr) {
      const ext = f.name.split(".").pop()?.toLowerCase();
      if (ext !== "xlsx" && ext !== "xlsm") continue;
      if (files.some(existing => existing.file.name === f.name && existing.file.size === f.size)) continue;
      newFiles.push({ file: f, status: "pending" });
    }
    if (newFiles.length === 0 && arr.length > 0) {
      setError("No valid Excel files found (.xlsx or .xlsm)");
      return;
    }
    setFiles(prev => [...prev, ...newFiles]);
    setError(null);
  };

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const clearAll = () => {
    setFiles([]);
    setError(null);
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);

    const isBatch = files.length > 1;
    const updatedFiles = [...files];
    setBatchProgress({ current: 0, total: files.length });

    for (let i = 0; i < updatedFiles.length; i++) {
      const entry = updatedFiles[i];
      if (entry.status === "success") continue;
      entry.status = "uploading";
      setFiles([...updatedFiles]);
      setBatchProgress({ current: i + 1, total: files.length });

      try {
        const formData = new FormData();
        formData.append("file", entry.file);
        const res = await fetch("/api/smart-import/upload", {
          method: "POST",
          headers: getAuthHeaders(),
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Upload failed" }));
          throw new Error(err.error || `Upload failed (${res.status})`);
        }
        const data = await res.json();
        entry.status = "success";
        entry.runId = data.runId;
        entry.preview = data.preview;
        entry.sectionsFound = data.preview?.detection?.sections?.length || 0;
        setFiles([...updatedFiles]);
      } catch (err: any) {
        entry.status = "error";
        entry.error = err.message || "Upload failed";
        setFiles([...updatedFiles]);
      }
    }

    setUploading(false);

    const successful = updatedFiles.filter(f => f.status === "success");
    const failed = updatedFiles.filter(f => f.status === "error");

    if (isBatch) {
      toast({
        title: "Batch Upload Complete",
        description: `${successful.length} of ${updatedFiles.length} files processed${failed.length > 0 ? `, ${failed.length} failed` : ""}`,
        variant: failed.length > 0 ? "destructive" : "default",
      });
      if (onBatchUploaded) {
        onBatchUploaded(updatedFiles);
      }
    } else if (successful.length === 1) {
      toast({ title: "Upload Complete", description: "File analyzed successfully" });
      onUploaded(successful[0].runId!, successful[0].preview);
    }
  };

  const singleMode = files.length <= 1;
  const hasSuccessful = files.some(f => f.status === "success");

  return (
    <Card className="bg-card rounded-xl shadow-sm" data-testid="upload-step">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Upload className="w-5 h-5 text-blue-600" />
          Upload Excel Trackers
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm"
          multiple
          className="hidden"
          data-testid="input-file"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={folderRef}
          type="file"
          accept=".xlsx,.xlsm"
          className="hidden"
          data-testid="input-folder"
          {...{ webkitdirectory: "", directory: "" } as any}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragging ? "border-blue-500 bg-blue-50" :
            files.length > 0 ? "border-emerald-300 bg-emerald-50" :
            "border-border hover:border-blue-400 hover:bg-blue-50/50"
          }`}
          data-testid="dropzone"
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          {files.length > 0 ? (
            <div className="flex flex-col items-center gap-2">
              <FileSpreadsheet className="w-10 h-10 text-emerald-500" />
              <p className="text-sm font-medium text-emerald-700">
                {files.length} file{files.length > 1 ? "s" : ""} selected
              </p>
              <p className="text-xs text-muted-foreground">
                {(files.reduce((sum, f) => sum + f.file.size, 0) / 1024).toFixed(0)} KB total
              </p>
              <div className="flex gap-2 mt-1">
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="btn-add-more"
                  onClick={() => inputRef.current?.click()}
                >
                  + Add Files
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="btn-clear-files"
                  onClick={() => clearAll()}
                >
                  <X className="w-3.5 h-3.5 mr-1" />
                  Clear All
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <Upload className="w-10 h-10 text-slate-500" />
              <p className="text-sm text-muted-foreground">Drag & drop Excel trackers here</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="btn-browse-files"
                  onClick={() => inputRef.current?.click()}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />
                  Browse Files
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="btn-browse-folder"
                  onClick={() => folderRef.current?.click()}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />
                  Browse Folder
                </Button>
              </div>
              <p className="text-xs text-slate-500">.xlsx and .xlsm files supported</p>
            </div>
          )}
        </div>

        {files.length > 0 && (
          <div className="border rounded-lg divide-y max-h-64 overflow-y-auto" data-testid="file-list">
            {files.map((entry, idx) => (
              <div key={idx} data-testid={`file-row-${idx}`}>
                <div className="flex items-center gap-2 px-3 py-2 text-sm">
                  <FileSpreadsheet className={`w-4 h-4 flex-shrink-0 ${
                    entry.status === "success" ? "text-emerald-500" :
                    entry.status === "error" ? "text-red-500" :
                    entry.status === "uploading" ? "text-blue-500" :
                    "text-slate-500"
                  }`} />
                  <span className="flex-1 truncate">{entry.file.name}</span>
                  <span className="text-xs text-slate-500 flex-shrink-0">
                    {(entry.file.size / 1024).toFixed(0)} KB
                  </span>
                  {entry.status === "success" && (
                    <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0">
                      {entry.sectionsFound} sections
                    </Badge>
                  )}
                  {entry.status === "error" && (
                    <Badge className="bg-red-50 text-red-700 border-red-200 text-[10px] px-1.5 py-0">
                      Failed
                    </Badge>
                  )}
                  {entry.status === "uploading" && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                  )}
                  {(entry.status === "pending" || entry.status === "error") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => removeFile(idx)}
                      data-testid={`btn-remove-file-${idx}`}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
                {entry.status === "error" && entry.error && (
                  <div className="mx-3 mb-2 rounded-md bg-red-50 border border-red-200 p-2.5 text-xs space-y-1.5" data-testid={`file-error-detail-${idx}`}>
                    <div className="flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                      <div className="space-y-1">
                        <p className="font-medium text-red-700">Why it failed</p>
                        <p className="text-red-600">{entry.error}</p>
                      </div>
                    </div>
                    <div className="border-t border-red-200 pt-1.5 mt-1.5">
                      <p className="font-medium text-red-700 mb-1">How to fix</p>
                      <ul className="text-red-600 space-y-0.5 list-disc list-inside">
                        {entry.error.toLowerCase().includes("no file") && (
                          <li>The file may not have been sent correctly. Try uploading again.</li>
                        )}
                        {(entry.error.toLowerCase().includes("format") || entry.error.toLowerCase().includes("xlsx") || entry.error.toLowerCase().includes("corrupt") || entry.error.toLowerCase().includes("load")) && (
                          <>
                            <li>Open the file in Excel, save as a fresh .xlsx file, and re-upload.</li>
                            <li>Ensure the file is not password-protected or corrupted.</li>
                          </>
                        )}
                        {(entry.error.toLowerCase().includes("section") || entry.error.toLowerCase().includes("detect") || entry.error.toLowerCase().includes("no section")) && (
                          <>
                            <li>The system could not find recognisable data sections (e.g. Expenses, Inflows, Plan).</li>
                            <li>Check that your tracker follows the standard Emergent template layout.</li>
                          </>
                        )}
                        {(entry.error.toLowerCase().includes("timeout") || entry.error.toLowerCase().includes("network") || entry.error.toLowerCase().includes("fetch")) && (
                          <li>Check your internet connection and try again.</li>
                        )}
                        {(entry.error.toLowerCase().includes("401") || entry.error.toLowerCase().includes("auth") || entry.error.toLowerCase().includes("403")) && (
                          <li>Your session may have expired. Refresh the page and log in again.</li>
                        )}
                        {(entry.error.toLowerCase().includes("500") || entry.error.toLowerCase().includes("server") || entry.error.toLowerCase().includes("internal")) && (
                          <>
                            <li>The server encountered an error processing this file.</li>
                            <li>Try re-saving the file from Excel and uploading again.</li>
                            <li>If the issue persists, the file structure may not match expected formats.</li>
                          </>
                        )}
                        {!(
                          entry.error.toLowerCase().includes("no file") ||
                          entry.error.toLowerCase().includes("format") ||
                          entry.error.toLowerCase().includes("xlsx") ||
                          entry.error.toLowerCase().includes("corrupt") ||
                          entry.error.toLowerCase().includes("load") ||
                          entry.error.toLowerCase().includes("section") ||
                          entry.error.toLowerCase().includes("detect") ||
                          entry.error.toLowerCase().includes("timeout") ||
                          entry.error.toLowerCase().includes("network") ||
                          entry.error.toLowerCase().includes("fetch") ||
                          entry.error.toLowerCase().includes("401") ||
                          entry.error.toLowerCase().includes("auth") ||
                          entry.error.toLowerCase().includes("403") ||
                          entry.error.toLowerCase().includes("500") ||
                          entry.error.toLowerCase().includes("server") ||
                          entry.error.toLowerCase().includes("internal")
                        ) && (
                          <>
                            <li>Open the file in Excel, confirm data is visible, and save as a new .xlsx file.</li>
                            <li>Ensure the tracker follows the standard Emergent layout with named sections.</li>
                            <li>If the problem continues, contact support with the file name and error above.</li>
                          </>
                        )}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {uploading && batchProgress.total > 1 && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Processing file {batchProgress.current} of {batchProgress.total}</span>
              <span>{Math.round((batchProgress.current / batchProgress.total) * 100)}%</span>
            </div>
            <Progress value={(batchProgress.current / batchProgress.total) * 100} className="h-1.5" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-red-600 text-sm" data-testid="text-upload-error">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={files.length === 0 || uploading}
            onClick={handleUpload}
            data-testid="btn-upload"
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {files.length > 1 ? `Processing ${batchProgress.current}/${batchProgress.total}...` : "Uploading & Analyzing..."}
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                {files.length > 1 ? `Upload & Analyze ${files.length} Files` : "Upload & Analyze"}
              </>
            )}
          </Button>
        </div>

        {hasSuccessful && files.length > 1 && !uploading && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 space-y-2" data-testid="batch-results">
            <p className="text-sm font-medium text-emerald-700">
              Batch complete: {files.filter(f => f.status === "success").length} files ready
            </p>
            <p className="text-xs text-emerald-600">
              Select a file below to review its import, or continue to review each one:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {files.filter(f => f.status === "success").map((entry, idx) => (
                <Button
                  key={idx}
                  variant="outline"
                  size="sm"
                  className="text-xs border-emerald-300 hover:bg-emerald-100"
                  data-testid={`btn-review-file-${idx}`}
                  onClick={() => onUploaded(entry.runId!, entry.preview)}
                >
                  <FileSpreadsheet className="w-3 h-3 mr-1" />
                  {entry.file.name.replace(/\.(xlsx|xlsm)$/i, "")}
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EditableField({
  label,
  value,
  fieldKey,
  testId,
  type = "text",
  onSave,
}: {
  label: string;
  value: string | null;
  fieldKey: string;
  testId: string;
  type?: "text" | "date" | "currency";
  onSave: (key: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");

  useEffect(() => {
    if (!editing) setDraft(value || "");
  }, [value, editing]);

  function formatDisplay() {
    if (!value) return "—";
    if (type === "date") {
      try {
        const d = new Date(value);
        return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
      } catch { return value; }
    }
    if (type === "currency") {
      const n = Number(value);
      return isNaN(n) ? value : `R ${n.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
    }
    return value;
  }

  function handleSave() {
    onSave(fieldKey, draft);
    setEditing(false);
  }

  if (editing) {
    return (
      <div>
        <span className="text-muted-foreground text-xs">{label}</span>
        <div className="flex items-center gap-1 mt-0.5">
          <Input
            className="h-7 text-xs px-2"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
            autoFocus
            type={type === "date" ? "date" : "text"}
            data-testid={`input-${testId}`}
          />
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleSave} data-testid={`btn-save-${testId}`}>
            <Check className="w-3.5 h-3.5 text-emerald-600" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setEditing(false)} data-testid={`btn-cancel-${testId}`}>
            <X className="w-3.5 h-3.5 text-slate-500" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="flex items-center gap-1">
        <p className="font-medium text-xs" data-testid={testId}>{formatDisplay()}</p>
        <button
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => { setDraft(value || ""); setEditing(true); }}
          data-testid={`btn-edit-${testId}`}
        >
          <Pencil className="w-3 h-3 text-slate-500 hover:text-blue-500" />
        </button>
      </div>
    </div>
  );
}

function SectionDetectionStep({
  preview,
  runId,
  onContinue,
  onBack,
  onProjectInfoUpdated,
}: {
  preview: any;
  runId: number | null;
  onContinue: () => void;
  onBack: () => void;
  onProjectInfoUpdated?: (updatedInfo: any) => void;
}) {
  const sections = preview?.detection?.sections || preview?.sections || [];
  const unmatchedSheets = preview?.detection?.unmatched || preview?.unmatchedSheets || [];
  const projectInfo = preview?.detection?.projectInfo || preview?.projectInfo || {};
  const hasProjectInfo = Object.values(projectInfo).some(v => v != null && v !== "");
  const { toast } = useToast();

  const handleFieldSave = async (key: string, value: string) => {
    if (preview?.detection?.projectInfo) {
      preview.detection.projectInfo[key] = value || null;
    }

    if (runId) {
      try {
        const res = await fetch(`/api/smart-import/${runId}/project-info`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ [key]: value || null }),
        });
        if (res.ok) {
          const data = await res.json();
          onProjectInfoUpdated?.(data.projectInfo);
          toast({ title: "Saved", description: `Updated ${key}` });
        }
      } catch {
          toast({ title: "Error", description: "Failed to save project info", variant: "destructive" });
        }
    }
    onProjectInfoUpdated?.(preview?.detection?.projectInfo);
  };

  const metaFields = [
    { label: "Project Name", key: "name", testId: "text-project-name", type: "text" as const },
    { label: "Size (kWp)", key: "sizeKwp", testId: "text-project-size", type: "text" as const },
    { label: "Project Developer", key: "pd", testId: "text-project-pd", type: "text" as const },
    { label: "Project Manager", key: "pm", testId: "text-project-pm", type: "text" as const },
    { label: "Contract Value", key: "contractValue", testId: "text-contract-value", type: "currency" as const },
    { label: "Execution Phase", key: "phase", testId: "text-project-phase", type: "text" as const },
  ];

  const dateFields = [
    { label: "PD Handover", key: "pdHandoverDate", testId: "text-pd-handover" },
    { label: "Construction Start", key: "constructionStartDate", testId: "text-construction-start" },
    { label: "Commissioning", key: "commissioningDate", testId: "text-commissioning" },
    { label: "O&M Handover", key: "omHandoverDate", testId: "text-om-handover" },
    { label: "Client Handover", key: "clientHandoverDate", testId: "text-client-handover" },
  ];

  return (
    <div className="space-y-4" data-testid="section-detection-step">
      {hasProjectInfo && (
        <Card className="bg-card rounded-xl shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Project Info (from sheet header)</CardTitle>
              <span className="text-[10px] text-slate-500">Hover to edit</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {metaFields.map(f => (
                <EditableField
                  key={f.key}
                  label={f.label}
                  value={projectInfo[f.key]}
                  fieldKey={f.key}
                  testId={f.testId}
                  type={f.type}
                  onSave={handleFieldSave}
                />
              ))}
            </div>

            <div>
              <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wide mb-1.5">Key Dates</p>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {dateFields.map(d => (
                  <EditableField
                    key={d.key}
                    label={d.label}
                    value={projectInfo[d.key]}
                    fieldKey={d.key}
                    testId={d.testId}
                    type="date"
                    onSave={handleFieldSave}
                  />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sections.map((section: any, idx: number) => (
          <Card key={idx} className="bg-card rounded-xl shadow-sm" data-testid={`card-section-${section.section || section.name || idx}`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm">{section.section || section.name}</span>
                {section.confidence != null && confidenceBadge(section.confidence)}
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                {section.sheetName && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sheet</span>
                    <span data-testid={`text-sheet-${idx}`}>{section.sheetName}</span>
                  </div>
                )}
                {section.headerRow != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Header Row</span>
                    <span data-testid={`text-header-row-${idx}`}>{section.headerRow}</span>
                  </div>
                )}
                {section.dataRows != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Data Rows</span>
                    <span data-testid={`text-data-rows-${idx}`}>{section.dataRows}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {detection?.multiProject?.isMultiProject && detection.multiProject.subProjects?.length > 0 && (
        <Card className="border-blue-200 bg-blue-50" data-testid="multi-project-summary">
          <CardContent className="p-4">
            <div className="flex items-start gap-2 mb-2">
              <span className="font-semibold text-sm text-blue-800">Multi-Project Tracker</span>
              <span className="text-xs bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full">{detection.multiProject.subProjects.length} sub-projects</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {detection.multiProject.subProjects.map((sp: string) => (
                <span key={sp} className="text-xs bg-white border border-blue-200 text-blue-700 px-2 py-0.5 rounded">{sp}</span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {unmatchedSheets.length > 0 && (
        <Card className="bg-card rounded-xl shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Unmatched Sheets</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {unmatchedSheets.map((sheet: any, idx: number) => (
                <li key={idx} className="flex items-center gap-2" data-testid={`unmatched-sheet-${idx}`}>
                  <X className="w-3 h-3 text-slate-500" />
                  <span className="font-medium">{typeof sheet === "string" ? sheet : sheet.name || sheet.sheetName}</span>
                  {sheet.reason && <span className="text-slate-500">— {sheet.reason}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {sections.length === 0 && (
        <Card className="bg-card rounded-xl shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-2">
            <AlertCircle className="w-8 h-8 text-amber-500" />
            <p className="text-sm text-muted-foreground">No sections detected in the uploaded file.</p>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} data-testid="btn-back-sections">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button onClick={onContinue} data-testid="btn-continue-sections">
          Looks Good
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  task_name: "Task Name", task_no: "Task #", start_date: "Start Date", end_date: "End Date",
  duration: "Duration", actual_start: "Actual Start", actual_end: "Actual End", actual_duration: "Actual Duration",
  pct_complete: "% Complete", expected_pct: "Expected %", owner: "Owner", predecessor: "Predecessor", phase: "Phase", comment: "Comment",
  milestone_name: "Milestone", milestone_no: "Milestone #", percent: "Percent", amount_ex_vat: "Amount (ex VAT)",
  vat: "VAT", invoice_number: "Invoice #", invoice_date: "Invoice Date", planned_payment_date: "Planned Payment",
  payment_received_date: "Payment Received", in_bank_date: "In Bank Date", requirements: "Requirements", documents: "Documents",
  cost_category: "Cost Category", description: "Description", counterparty: "Counterparty", budget_qty: "Budget Qty",
  budget_rate: "Budget Rate", budget_total: "Budget Total", actual_total: "Actual Total", po_number: "PO #",
  approved_date: "Approved Date", payment_date: "Payment Date", forecast_payment_date: "Forecast Payment",
  budget_cos: "Budget COS", actual_cos: "Actual COS",
  // camelCase keys from normalized data objects
  budgetQty: "Budget Qty", budgetRate: "Budget Rate", budgetTotal: "Budget Total", budgetCos: "Budget COS",
  actualCos: "Actual COS", revenueRecognitionAmount: "Revenue Recognition", forecastPaymentDate: "Forecast Payment",
  subProjectName: "Sub-Project", amountExVat: "Amount (ex VAT)", costCategory: "Cost Category",
  counterpartyName: "Counterparty", invoiceNumber: "Invoice #", invoiceDate: "Invoice Date",
  poNumber: "PO #", paidDate: "Paid Date", taskName: "Task Name", taskNo: "Task #",
  milestoneName: "Milestone", expectedPaymentDate: "Expected Payment",
};

const DB_TABLE_MAP: Record<string, string> = {
  PLAN: "normalized_plan_tasks",
  REVENUE: "normalized_revenue_lines",
  EXPENDITURE: "normalized_cost_lines",
};

function ColumnMappingStep({
  runId,
  preview,
  onContinue,
  onBack,
  onPreviewUpdate,
}: {
  runId: number;
  preview: any;
  onContinue: () => void;
  onBack: () => void;
  onPreviewUpdate: (p: any) => void;
}) {
  const detectedSections = useMemo(() => preview?.detection?.sections || [], [preview]);
  const mappingResults = useMemo(() => preview?.mappings || [], [preview]);
  const normalization = useMemo(() => preview?.normalization || {}, [preview]);

  const sectionNames = useMemo(() => detectedSections.map((s: any) => s.section).filter(Boolean), [detectedSections]);
  const [activeTab, setActiveTab] = useState(sectionNames[0] || "PLAN");
  const [saving, setSaving] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  const getMappingForSection = (sectionName: string) => {
    return mappingResults.find((m: any) => m.section === sectionName);
  };

  const getDetectionForSection = (sectionName: string) => {
    return detectedSections.find((s: any) => s.section === sectionName);
  };

  const getPreviewData = (sectionName: string) => {
    if (sectionName === "PLAN") return normalization.planTasks || [];
    if (sectionName === "REVENUE") return normalization.revenueLines || [];
    if (sectionName === "EXPENDITURE") return normalization.costLines || [];
    return [];
  };

  const handleMappingChange = async (section: string, colIndex: number, canonicalField: string) => {
    setSaving(`${section}-${colIndex}`);
    try {
      const res = await fetch(`/api/smart-import/${runId}/mapping`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ section, colIndex, canonicalField }),
      });
      if (res.ok) {
        const refreshRes = await fetch(`/api/smart-import/${runId}`, { headers: getAuthHeaders() });
        if (refreshRes.ok) {
          const data = await refreshRes.json();
          if (data.preview) onPreviewUpdate(data.preview);
        }
        toast({ title: "Mapping Updated", description: `Column mapped to ${FIELD_LABELS[canonicalField] || canonicalField}` });
      } else {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        toast({ title: "Error", description: err.error || "Failed to update mapping", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="column-mapping-step">
      {sectionNames.length > 0 ? (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList data-testid="mapping-tabs">
            {sectionNames.map((name: string) => {
              const mapping = getMappingForSection(name);
              const mappedCount = mapping?.mappings?.length || 0;
              const unmappedCount = mapping?.unmappedHeaders?.length || 0;
              return (
                <TabsTrigger key={name} value={name} data-testid={`tab-${name}`} className="gap-1.5">
                  {name}
                  <Badge className="bg-emerald-50 text-emerald-700 text-[10px] px-1 py-0 ml-1">
                    {mappedCount}
                  </Badge>
                  {unmappedCount > 0 && (
                    <Badge className="bg-amber-50 text-amber-700 text-[10px] px-1 py-0">
                      +{unmappedCount}
                    </Badge>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {sectionNames.map((sectionName: string) => {
            const mapping = getMappingForSection(sectionName);
            const detection = getDetectionForSection(sectionName);
            const fields = CANONICAL_FIELDS[sectionName] || [];
            const allMappings = mapping?.mappings || [];
            const unmappedHeaders = mapping?.unmappedHeaders || [];
            const overallConfidence = mapping?.overallConfidence ?? null;
            const missingRequired = mapping?.missingRequired || [];
            const previewData = getPreviewData(sectionName);
            const dbTable = DB_TABLE_MAP[sectionName] || "—";

            return (
              <TabsContent key={sectionName} value={sectionName}>
                <Card className="bg-card rounded-xl shadow-sm">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {overallConfidence != null && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-muted-foreground">Confidence:</span>
                            {confidenceBadge(overallConfidence)}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">Sheet:</span>
                          <span className="text-xs font-medium">{detection?.sheetName || "—"}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">Rows:</span>
                          <span className="text-xs font-medium">
                            {detection ? (detection.dataEndRowIndex - detection.dataStartRowIndex + 1) : 0}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-500">Destination:</span>
                        <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] px-1.5 py-0 font-mono">
                          {dbTable}
                        </Badge>
                      </div>
                    </div>

                    {missingRequired.length > 0 && (
                      <div className="flex items-center gap-2 p-2 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-700">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                        Missing required fields: {missingRequired.map((f: string) => FIELD_LABELS[f] || f).join(", ")}
                      </div>
                    )}

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs" data-testid={`mapping-table-${sectionName}`}>
                        <thead>
                          <tr className="bg-muted border-b">
                            <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Excel Column</th>
                            <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Maps To Field</th>
                            <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Match</th>
                            <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Confidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allMappings.map((col: any) => {
                            const colIdx = col.colIndex;
                            const isSaving = saving === `${sectionName}-${colIdx}`;
                            return (
                              <tr key={colIdx} className="border-b border-border hover:bg-muted/50">
                                <td className="px-3 py-2 font-medium" data-testid={`text-header-${sectionName}-${colIdx}`}>
                                  {col.rawHeader}
                                </td>
                                <td className="px-3 py-2">
                                  <SearchableSelect
                                    value={col.canonicalField || ""}
                                    onValueChange={(val) => handleMappingChange(sectionName, colIdx, val)}
                                    placeholder="Select field..."
                                    triggerClassName="h-7 text-xs w-[180px]"
                                    data-testid={`select-mapping-${sectionName}-${colIdx}`}
                                    options={fields.map((f) => ({
                                      value: f,
                                      label: FIELD_LABELS[f] || f,
                                    }))}
                                  />
                                  {isSaving && <Loader2 className="w-3 h-3 animate-spin text-blue-500 inline ml-1" />}
                                </td>
                                <td className="px-3 py-2">
                                  <Badge className={`text-[10px] px-1.5 py-0 ${
                                    col.matchType === "exact" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                                    col.matchType === "synonym" ? "bg-blue-50 text-blue-700 border-blue-200" :
                                    col.matchType === "learned" ? "bg-purple-50 text-purple-700 border-purple-200" :
                                    "bg-amber-50 text-amber-700 border-amber-200"
                                  }`}>
                                    {col.matchType}
                                  </Badge>
                                </td>
                                <td className="px-3 py-2">
                                  {col.confidence != null && confidenceBadge(col.confidence)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {unmappedHeaders.length > 0 && (
                      <div className="mt-3">
                        <h4 className="text-xs font-semibold text-muted-foreground mb-2">
                          Unmapped Columns ({unmappedHeaders.length})
                        </h4>
                        <div className="space-y-1.5">
                          {unmappedHeaders.map((col: any) => {
                            const colIdx = col.colIndex;
                            const isSaving = saving === `${sectionName}-${colIdx}`;
                            return (
                              <div
                                key={colIdx}
                                className="flex items-center gap-3 p-2 bg-muted border border-border rounded-md"
                                data-testid={`unmapped-col-${sectionName}-${colIdx}`}
                              >
                                <span className="text-xs font-medium flex-1 text-muted-foreground">
                                  {col.rawHeader}
                                </span>
                                <SearchableSelect
                                  value=""
                                  onValueChange={(val) => {
                                    if (val === "__ignore__") return;
                                    handleMappingChange(sectionName, colIdx, val);
                                  }}
                                  placeholder="Map to..."
                                  triggerClassName="h-7 text-xs w-[180px]"
                                  data-testid={`select-unmapped-${sectionName}-${colIdx}`}
                                  options={[
                                    { value: "__ignore__", label: "— Ignore —" },
                                    ...fields.map((f) => ({
                                      value: f,
                                      label: FIELD_LABELS[f] || f,
                                    })),
                                  ]}
                                />
                                {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="mt-4 border-t pt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => setShowPreview(p => ({ ...p, [sectionName]: !p[sectionName] }))}
                        data-testid={`btn-toggle-preview-${sectionName}`}
                      >
                        {showPreview[sectionName] ? <ChevronUp className="w-3.5 h-3.5 mr-1.5" /> : <ChevronDown className="w-3.5 h-3.5 mr-1.5" />}
                        {showPreview[sectionName] ? "Hide" : "Show"} Data Preview ({previewData.length} rows)
                      </Button>

                      {showPreview[sectionName] && previewData.length > 0 && (
                        <div className="mt-2 overflow-x-auto border rounded-lg">
                          <table className="w-full text-[11px]" data-testid={`preview-table-${sectionName}`}>
                            <thead>
                              <tr className="bg-blue-50 border-b">
                                <th className="text-left px-2 py-1.5 text-[10px] font-semibold text-blue-600 uppercase">Row</th>
                                {Object.keys(previewData[0] || {}).filter(k => !["sourceSheet", "sourceRow"].includes(k)).slice(0, 10).map(key => {
                                  const isBudgetCol = key.startsWith("budget") || key === "forecastPaymentDate";
                                  return (
                                    <th key={key} className={`text-left px-2 py-1.5 text-[10px] font-semibold uppercase whitespace-nowrap ${isBudgetCol ? "bg-slate-100 text-slate-500" : "text-blue-600"}`}>
                                      {FIELD_LABELS[key] || key.replace(/([A-Z])/g, " $1").trim()}
                                    </th>
                                  );
                                })}
                              </tr>
                            </thead>
                            <tbody>
                              {previewData.slice(0, 8).map((row: any, idx: number) => {
                                const isMs = row.isMilestone === true;
                                const indent = row.indentLevel || 0;
                                return (
                                <tr key={idx} className={`border-b border-border ${isMs ? "bg-amber-50/60 font-semibold" : "hover:bg-muted/50"}`}>
                                  <td className="px-2 py-1 text-slate-500">{row.sourceRow || idx + 1}</td>
                                  {Object.entries(row).filter(([k]) => !["sourceSheet", "sourceRow", "isMilestone", "parentTaskNo", "indentLevel"].includes(k)).slice(0, 10).map(([key, val]) => {
                                    const isBudgetCell = key.startsWith("budget") || key === "forecastPaymentDate";
                                    return (
                                    <td key={key} className={`px-2 py-1 max-w-[120px] truncate ${isBudgetCell ? "bg-slate-50 text-slate-500" : ""}`} title={String(val ?? "")}>
                                      {key === "taskName" && indent > 0 ? (
                                        <span style={{ paddingLeft: `${indent * 12}px` }}>{isMs ? "◆ " : ""}{val != null ? String(val) : <span className="text-slate-600">—</span>}</span>
                                      ) : key === "taskName" && isMs ? (
                                        <span className="text-amber-800">◆ {val != null ? String(val) : "—"}</span>
                                      ) : (
                                        val != null ? String(val) : <span className="text-slate-600">—</span>
                                      )}
                                    </td>
                                    );
                                  })}
                                </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {previewData.length > 8 && (
                            <div className="text-center py-1.5 text-[10px] text-slate-500 bg-muted">
                              ... and {previewData.length - 8} more rows
                            </div>
                          )}
                        </div>
                      )}

                      {showPreview[sectionName] && previewData.length === 0 && (
                        <p className="mt-2 text-xs text-slate-500">No data rows extracted for this section.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            );
          })}
        </Tabs>
      ) : (
        <Card className="bg-card rounded-xl shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-2">
            <Info className="w-8 h-8 text-slate-500" />
            <p className="text-sm text-muted-foreground">No column mappings available.</p>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} data-testid="btn-back-mapping">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button onClick={onContinue} data-testid="btn-continue-mapping">
          Continue
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

const IssueRowDetail = memo(function IssueRowDetail({ issue, normalization }: { issue: any; normalization: any }) {
  const payload = issue.payloadJson || {};
  const section = (issue.section || "").toUpperCase();
  const row = payload.row;

  const getRowData = () => {
    if (!row) return null;
    if (section === "REVENUE") {
      return (normalization?.revenueLines || []).find((r: any) => r.sourceRow === row);
    }
    if (section === "EXPENDITURE") {
      return (normalization?.costLines || []).find((r: any) => r.sourceRow === row);
    }
    if (section === "PLAN") {
      return (normalization?.planTasks || []).find((r: any) => r.sourceRow === row);
    }
    return null;
  };

  const getDuplicateRows = () => {
    if (!payload.invoiceNumber) return [];
    const data = section === "REVENUE"
      ? (normalization?.revenueLines || [])
      : section === "EXPENDITURE"
        ? (normalization?.costLines || [])
        : [];
    return data.filter((r: any) => r.invoiceNumber === payload.invoiceNumber);
  };

  const isDuplicate = (issue.message || "").toLowerCase().includes("duplicate");
  const isDateSwap = (issue.message || "").toLowerCase().includes("after paid date") || (issue.message || "").toLowerCase().includes("dates are swapped");

  if (isDuplicate) {
    const rows = getDuplicateRows();
    if (rows.length === 0) return <p className="text-[10px] text-muted-foreground italic">No matching rows found in preview data.</p>;

    const fields = section === "REVENUE"
      ? [
          { key: "milestoneName", label: "Milestone" },
          { key: "invoiceNumber", label: "Invoice #" },
          { key: "amountExVat", label: "Amount" },
          { key: "invoiceDate", label: "Invoice Date" },
          { key: "paidDate", label: "Paid Date" },
          { key: "status", label: "Status" },
        ]
      : [
          { key: "description", label: "Description" },
          { key: "counterpartyName", label: "Counterparty" },
          { key: "invoiceNumber", label: "Invoice #" },
          { key: "amountExVat", label: "Amount" },
          { key: "invoiceDate", label: "Invoice Date" },
          { key: "paidDate", label: "Paid Date" },
          { key: "status", label: "Status" },
        ];

    return (
      <div className="mt-2 space-y-1">
        <p className="text-[10px] font-medium text-muted-foreground mb-1">Matching rows with invoice "{payload.invoiceNumber}":</p>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="bg-muted">
                <th className="px-2 py-1 text-left border border-border font-medium text-muted-foreground">Row</th>
                {fields.map(f => (
                  <th key={f.key} className="px-2 py-1 text-left border border-border font-medium text-muted-foreground">{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, idx: number) => (
                <tr key={idx} className={idx % 2 === 0 ? "bg-card" : "bg-muted"}>
                  <td className="px-2 py-1 border border-border font-mono">{r.sourceRow}</td>
                  {fields.map(f => (
                    <td key={f.key} className={`px-2 py-1 border border-border ${f.key === "invoiceNumber" ? "font-semibold text-amber-700 bg-amber-50" : ""}`}>
                      {r[f.key] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (isDateSwap) {
    const rowData = getRowData();
    if (!rowData) return <p className="text-[10px] text-muted-foreground italic">Row {row}: No matching data in preview.</p>;

    const fields = section === "REVENUE"
      ? [
          { key: "milestoneName", label: "Milestone" },
          { key: "invoiceNumber", label: "Invoice #" },
          { key: "amountExVat", label: "Amount" },
          { key: "invoiceDate", label: "Invoice Date", highlight: true },
          { key: "paidDate", label: "Paid Date", highlight: true },
        ]
      : [
          { key: "description", label: "Description" },
          { key: "counterpartyName", label: "Counterparty" },
          { key: "invoiceNumber", label: "Invoice #" },
          { key: "amountExVat", label: "Amount" },
          { key: "invoiceDate", label: "Invoice Date", highlight: true },
          { key: "paidDate", label: "Paid Date", highlight: true },
        ];

    return (
      <div className="mt-2">
        <p className="text-[10px] font-medium text-muted-foreground mb-1">Row {row} details:</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 bg-card rounded border border-border p-2">
          {fields.map(f => (
            <div key={f.key}>
              <span className="text-[9px] text-slate-500 uppercase">{f.label}</span>
              <p className={`text-[11px] ${(f as any).highlight ? "font-semibold text-red-600 bg-red-50 px-1 rounded" : "text-foreground"}`}>
                {rowData[f.key] ?? "—"}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const rowData = getRowData();
  if (!rowData) {
    if (row) return <p className="text-[10px] text-muted-foreground italic">Row {row}: No matching data in preview.</p>;
    return null;
  }

  const allFields = Object.entries(rowData).filter(([k]) => !["sourceSheet", "sourceRow"].includes(k));
  return (
    <div className="mt-2">
      <p className="text-[10px] font-medium text-muted-foreground mb-1">Row {row} details:</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 bg-card rounded border border-border p-2">
        {allFields.map(([key, val]) => (
          <div key={key}>
            <span className="text-[9px] text-slate-500 uppercase">{key.replace(/([A-Z])/g, " $1").trim()}</span>
            <p className="text-[11px] text-foreground">{val != null ? String(val) : "—"}</p>
          </div>
        ))}
      </div>
    </div>
  );
});

function IssuesStep({
  runId,
  issues,
  normalization,
  onContinue,
  onBack,
  onIssuesUpdate,
}: {
  runId: number;
  issues: any[];
  normalization: any;
  onContinue: () => void;
  onBack: () => void;
  onIssuesUpdate: (issues: any[]) => void;
}) {
  const [resolving, setResolving] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [cpState, setCpState] = useState<Record<number, { name: string; type: string }>>({});
  const [creatingCp, setCreatingCp] = useState<number | null>(null);
  const [applyingPrior, setApplyingPrior] = useState(false);
  const [ignoringAll, setIgnoringAll] = useState(false);
  const [allowingAll, setAllowingAll] = useState(false);
  const [editingOverride, setEditingOverride] = useState<number | null>(null);
  const [overrideFields, setOverrideFields] = useState<Record<string, string>>({});
  const [sectionFilter, setSectionFilter] = useState<string>("ALL");
  const [severityFilter, setSeverityFilter] = useState<string>("ALL");
  const [showResolved, setShowResolved] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const ISSUES_PER_PAGE = 20;
  const { toast } = useToast();

  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const isAdmin = ["COO_ADMIN", "CEO_ADMIN", "admin"].includes(companyRole || "");

  const issuesWithPriorRules = issues.filter((i: any) => i.matchedRuleId && !i.resolved && !i.autoResolved);
  const autoResolvedCount = issues.filter((i: any) => i.autoResolved).length;

  const getSeverity = (i: any) => (i.severity || "").toUpperCase();
  const blockers = issues.filter((i) => { const s = getSeverity(i); return s === "BLOCKER" || s === "ERROR"; });
  const warnings = issues.filter((i) => { const s = getSeverity(i); return s === "WARNING" || s === "WARN"; });
  const infos = issues.filter((i) => { const s = getSeverity(i); return s === "INFO"; });

  const unresolvedBlockers = blockers.filter((i) => !i.resolved);

  // Section counts for filter badges
  const sectionCounts = issues.reduce<Record<string, number>>((acc, i) => {
    const sec = (i.section || "OTHER").toUpperCase();
    acc[sec] = (acc[sec] || 0) + 1;
    return acc;
  }, {});
  const availableSections = Object.keys(sectionCounts).sort();

  // Apply filters
  const applyFilters = (items: any[]) => {
    let filtered = items;
    if (sectionFilter !== "ALL") {
      filtered = filtered.filter(i => (i.section || "OTHER").toUpperCase() === sectionFilter);
    }
    if (!showResolved) {
      filtered = filtered.filter(i => !i.resolved && !i.autoResolved);
    }
    return filtered;
  };

  const filteredBlockers = applyFilters(blockers);
  const filteredWarnings = applyFilters(warnings);
  const filteredInfos = applyFilters(infos);

  // Combine all filtered issues for pagination
  const allFilteredIssues = [...filteredBlockers, ...filteredWarnings, ...filteredInfos];
  const totalPages = Math.max(1, Math.ceil(allFilteredIssues.length / ISSUES_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedIssues = allFilteredIssues.slice((safePage - 1) * ISSUES_PER_PAGE, safePage * ISSUES_PER_PAGE);

  // Split paginated issues back into severity groups for rendering
  const paginatedBlockers = paginatedIssues.filter(i => { const s = getSeverity(i); return s === "BLOCKER" || s === "ERROR"; });
  const paginatedWarnings = paginatedIssues.filter(i => { const s = getSeverity(i); return s === "WARNING" || s === "WARN"; });
  const paginatedInfos = paginatedIssues.filter(i => { const s = getSeverity(i); return s === "INFO"; });

  const resolvedCount = issues.filter(i => i.resolved || i.autoResolved).length;

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleResolve = async (issueId: number, resolved: boolean, resolution?: string) => {
    setResolving(issueId);
    try {
      const res = await fetch(`/api/smart-import/${runId}/issue/${issueId}/resolve`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ resolved, resolution, rememberDecision: resolved ? true : false }),
      });
      if (res.ok) {
        const updated = await res.json();
        onIssuesUpdate(issues.map((i) => (i.id === issueId ? updated : i)));
        toast({ title: resolved ? "Resolved" : "Reopened" });
      } else {
        toast({ title: "Error", description: "Failed to update issue", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    } finally {
      setResolving(null);
    }
  };

  const handleApplyPriorResolutions = async () => {
    setApplyingPrior(true);
    try {
      const res = await fetch(`/api/smart-import/${runId}/apply-prior-resolutions`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        onIssuesUpdate(data.issues);
        toast({ title: "Applied", description: `${data.applied} issue(s) resolved from prior decisions` });
      } else {
        toast({ title: "Error", description: "Failed to apply resolutions", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    } finally {
      setApplyingPrior(false);
    }
  };

  const handleIgnoreAllBlockers = async () => {
    setIgnoringAll(true);
    try {
      const res = await fetch(`/api/smart-import/${runId}/ignore-all-blockers`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        onIssuesUpdate(data.issues);
        toast({ title: "Blockers Ignored", description: `${data.ignored} blocker(s) ignored` });
      } else {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        toast({ title: "Error", description: err.error || "Failed to ignore blockers", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    } finally {
      setIgnoringAll(false);
    }
  };

  const handleAllowAll = async () => {
    setAllowingAll(true);
    try {
      const res = await fetch(`/api/smart-import/${runId}/allow-all`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        onIssuesUpdate(data.issues);
        toast({ title: "All Allowed", description: `${data.allowed} issue(s) resolved — all data will be imported as-is` });
      } else {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        toast({ title: "Error", description: err.error || "Failed to allow all", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    } finally {
      setAllowingAll(false);
    }
  };

  const getCpState = (issueId: number) => cpState[issueId] || { name: "", type: "subcontractor" };
  const setCpField = (issueId: number, field: "name" | "type", value: string) => {
    setCpState(prev => ({ ...prev, [issueId]: { ...getCpState(issueId), [field]: value } }));
  };

  const handleCreateCounterparty = async (issueId: number) => {
    const cp = getCpState(issueId);
    if (!cp.name.trim()) return;
    setCreatingCp(issueId);
    try {
      const res = await fetch("/api/counterparties", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ nameCanonical: cp.name.trim(), typeDefault: cp.type, isCore: false }),
      });
      if (res.ok) {
        toast({ title: "Counterparty Created", description: `${cp.name} added` });
        setCpState(prev => { const next = { ...prev }; delete next[issueId]; return next; });
        await handleResolve(issueId, true, "ACCEPTED");
      } else {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        toast({ title: "Error", description: err.error || "Failed to create counterparty", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    } finally {
      setCreatingCp(null);
    }
  };

  const renderIssueGroup = (
    title: string,
    items: any[],
    icon: React.ReactNode,
    bgClass: string,
    borderClass: string,
  ) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title} ({items.length})
        </h3>
        {items.map((issue: any) => {
          const isExpanded = expanded.has(issue.id);
          const isCounterpartyIssue = issue.type === "counterparty" ||
            (issue.message || "").toLowerCase().includes("counterparty");
          const isDuplicate = (issue.message || "").toLowerCase().includes("duplicate");
          const isDateSwap = (issue.message || "").toLowerCase().includes("after paid date");
          return (
            <Card
              key={issue.id}
              className={`${bgClass} border ${borderClass} rounded-lg`}
              data-testid={`issue-card-${issue.id}`}
            >
              <CardContent className="p-3 space-y-0">
                <div
                  className="flex items-start justify-between gap-2 cursor-pointer"
                  onClick={() => toggleExpand(issue.id)}
                  data-testid={`issue-toggle-${issue.id}`}
                >
                  <div className="flex items-start gap-2 flex-1">
                    <ChevronDown className={`w-3.5 h-3.5 mt-0.5 text-slate-500 shrink-0 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {issue.section && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-medium">
                            {(issue.section || "").toUpperCase()}
                          </Badge>
                        )}
                        <p className="text-xs font-medium" data-testid={`text-issue-msg-${issue.id}`}>
                          {issue.message}
                        </p>
                      </div>
                      {issue.autoResolved && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded mt-0.5">
                          <CheckCircle2 className="w-2.5 h-2.5" /> Auto-resolved from prior decision
                        </span>
                      )}
                      {issue.matchedRuleId && !issue.resolved && !issue.autoResolved && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-violet-600 bg-violet-100 px-1.5 py-0.5 rounded mt-0.5">
                          <History className="w-2.5 h-2.5" /> Previously resolved — click Accept to apply
                        </span>
                      )}
                      {issue.suggestedAction && !issue.autoResolved && (
                        <p className="text-[10px] text-muted-foreground mt-0.5" data-testid={`text-issue-action-${issue.id}`}>
                          Suggested: {issue.suggestedAction}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {issue.resolved ? (
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className={`text-[10px] h-5 ${
                          issue.resolution === "IGNORED" ? "border-border text-muted-foreground bg-muted" :
                          issue.resolution === "OVERRIDE" ? "border-blue-300 text-blue-600 bg-blue-50" :
                          issue.resolution === "ALLOW_ALL" ? "border-blue-300 text-blue-600 bg-blue-50" :
                          "border-emerald-300 text-emerald-600 bg-emerald-50"
                        }`}>
                          {issue.resolution === "IGNORED" ? "Ignored" : issue.resolution === "OVERRIDE" ? "Overridden" : issue.resolution === "ALLOW_ALL" ? "Allowed" : "Accepted"}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-slate-500 hover:text-muted-foreground"
                          disabled={resolving === issue.id}
                          onClick={() => handleResolve(issue.id, false)}
                          data-testid={`btn-reopen-${issue.id}`}
                        >
                          {resolving === issue.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                          disabled={resolving === issue.id}
                          onClick={() => handleResolve(issue.id, true, "ACCEPTED")}
                          data-testid={`btn-accept-${issue.id}`}
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2 border-blue-300 text-blue-700 hover:bg-blue-50"
                          disabled={resolving === issue.id}
                          onClick={() => {
                            setEditingOverride(issue.id);
                            setExpanded(prev => { const next = new Set(prev); next.add(issue.id); return next; });
                            const payload = issue.payloadJson as any || {};
                            const row = payload?.row;
                            const section = issue.section;
                            let normRow: any = null;
                            if (row != null && normalization) {
                              if (section === "PLAN") normRow = normalization.planTasks?.find((t: any) => t.sourceRow === row);
                              else if (section === "REVENUE") normRow = normalization.revenueLines?.find((r: any) => r.sourceRow === row);
                              else if (section === "EXPENDITURE") normRow = normalization.costLines?.find((c: any) => c.sourceRow === row);
                            }
                            if (normRow) {
                              const editable: Record<string, string> = {};
                              for (const [k, v] of Object.entries(normRow)) {
                                if (k === "sourceSheet" || k === "sourceRow") continue;
                                editable[k] = v != null ? String(v) : "";
                              }
                              setOverrideFields(editable);
                            } else {
                              setOverrideFields({ ...payload });
                            }
                          }}
                          data-testid={`btn-override-${issue.id}`}
                        >
                          Override
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2 border-border text-muted-foreground hover:bg-muted"
                          disabled={resolving === issue.id}
                          onClick={() => handleResolve(issue.id, true, "IGNORED")}
                          data-testid={`btn-ignore-${issue.id}`}
                        >
                          Ignore
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-2 pt-2 border-t border-border">
                    <IssueRowDetail issue={issue} normalization={normalization} />

                    {editingOverride === issue.id && !issue.resolved && (
                      <div className="pt-2 mt-2 border-t border-blue-200 bg-blue-50/50 rounded p-2 space-y-2" data-testid={`override-form-${issue.id}`}>
                        <p className="text-[10px] font-semibold text-blue-700">Edit fields to override this data line:</p>
                        <div className="grid grid-cols-2 gap-2">
                          {Object.entries(overrideFields)
                            .filter(([key]) => key !== "row")
                            .map(([key, val]) => (
                              <div key={key}>
                                <Label className="text-[10px] text-blue-600 capitalize">{key.replace(/([A-Z])/g, " $1")}</Label>
                                <Input
                                  className="h-7 text-xs"
                                  value={val || ""}
                                  onChange={(e) => setOverrideFields(prev => ({ ...prev, [key]: e.target.value }))}
                                  data-testid={`input-override-${key}-${issue.id}`}
                                />
                              </div>
                            ))}
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] px-2"
                            onClick={() => setEditingOverride(null)}
                            data-testid={`btn-cancel-override-${issue.id}`}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            className="h-6 text-[10px] px-2 bg-blue-600 hover:bg-blue-700 text-white"
                            disabled={resolving === issue.id}
                            onClick={async () => {
                              const cleanOverride: Record<string, any> = {};
                              for (const [k, v] of Object.entries(overrideFields)) {
                                if (k !== "row") cleanOverride[k] = v;
                              }
                              setResolving(issue.id);
                              try {
                                const res = await fetch(`/api/smart-import/${runId}/issue/${issue.id}/resolve`, {
                                  method: "PATCH",
                                  headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
                                  body: JSON.stringify({ resolved: true, resolution: "OVERRIDE", overrideData: cleanOverride, rememberDecision: true }),
                                });
                                if (res.ok) {
                                  const updated = await res.json();
                                  onIssuesUpdate(issues.map((i) => (i.id === issue.id ? updated : i)));
                                  setEditingOverride(null);
                                  toast({ title: "Override saved" });
                                }
                              } catch {
                                toast({ title: "Error", variant: "destructive" });
                              } finally {
                                setResolving(null);
                              }
                            }}
                            data-testid={`btn-save-override-${issue.id}`}
                          >
                            {resolving === issue.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save Override"}
                          </Button>
                        </div>
                      </div>
                    )}

                    {isCounterpartyIssue && !issue.resolved && editingOverride !== issue.id && (
                      <div className="flex items-end gap-2 pt-2 mt-2 border-t border-border">
                        <div className="flex-1">
                          <Label className="text-[10px]">Name</Label>
                          <Input
                            className="h-7 text-xs"
                            value={getCpState(issue.id).name}
                            onChange={(e) => setCpField(issue.id, "name", e.target.value)}
                            placeholder="Counterparty name..."
                            data-testid={`input-cp-name-${issue.id}`}
                          />
                        </div>
                        <div className="w-[140px]">
                          <Label className="text-[10px]">Type</Label>
                          <SearchableSelect
                            value={getCpState(issue.id).type}
                            onValueChange={(v) => setCpField(issue.id, "type", v)}
                            triggerClassName="h-7 text-xs"
                            data-testid={`select-trigger-cp-type-${issue.id}`}
                            options={[
                              { value: "subcontractor", label: "Subcontractor" },
                              { value: "supplier", label: "Supplier" },
                              { value: "consultant", label: "Consultant" },
                              { value: "client", label: "Client" },
                              { value: "other", label: "Other" },
                            ]}
                          />
                        </div>
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          disabled={!getCpState(issue.id).name.trim() || creatingCp === issue.id}
                          onClick={() => handleCreateCounterparty(issue.id)}
                          data-testid={`btn-create-cp-${issue.id}`}
                        >
                          {creatingCp === issue.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Create"}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-4" data-testid="issues-step">
      {autoResolvedCount > 0 && (
        <Card className="bg-emerald-50 border border-emerald-200 rounded-xl shadow-sm" data-testid="auto-resolved-banner">
          <CardContent className="p-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <p className="text-xs text-emerald-700 flex-1">
              <span className="font-semibold">{autoResolvedCount}</span> issue(s) auto-resolved based on your prior decisions
            </p>
          </CardContent>
        </Card>
      )}

      {issuesWithPriorRules.length > 0 && (
        <Card className="bg-violet-50 border border-violet-200 rounded-xl shadow-sm" data-testid="prior-resolutions-banner">
          <CardContent className="p-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-violet-600 shrink-0" />
              <p className="text-xs text-violet-700">
                <span className="font-semibold">{issuesWithPriorRules.length}</span> issue(s) match prior resolution patterns
              </p>
            </div>
            <Button
              size="sm"
              className="h-7 text-xs bg-violet-600 hover:bg-violet-700 text-white"
              disabled={applyingPrior}
              onClick={handleApplyPriorResolutions}
              data-testid="btn-apply-prior-resolutions"
            >
              {applyingPrior ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              Apply All Suggestions
            </Button>
          </CardContent>
        </Card>
      )}

      {issues.length > 0 && issues.some((i: any) => !i.resolved) && (
        <Card className="bg-blue-50 border border-blue-200 rounded-xl shadow-sm" data-testid="allow-all-banner">
          <CardContent className="p-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
              <div>
                <p className="text-xs text-blue-700 font-medium">
                  Allow All — import everything as-is
                </p>
                <p className="text-[10px] text-blue-500 mt-0.5">
                  Resolves all issues and imports all data rows without skipping any
                </p>
              </div>
            </div>
            <Button
              size="sm"
              className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white"
              disabled={allowingAll}
              onClick={handleAllowAll}
              data-testid="btn-allow-all"
            >
              {allowingAll ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
              Allow All
            </Button>
          </CardContent>
        </Card>
      )}

      {issues.length === 0 ? (
        <Card className="bg-card rounded-xl shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            <p className="text-sm text-muted-foreground">No issues detected — looking good!</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Filter bar */}
          <Card className="bg-card rounded-xl shadow-sm" data-testid="issues-filter-bar">
            <CardContent className="p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground mr-1">Section:</span>
                <button
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${sectionFilter === "ALL" ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                  onClick={() => { setSectionFilter("ALL"); setCurrentPage(1); }}
                  data-testid="filter-section-all"
                >
                  All ({issues.length})
                </button>
                {availableSections.map(sec => (
                  <button
                    key={sec}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${sectionFilter === sec ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                    onClick={() => { setSectionFilter(sec); setCurrentPage(1); }}
                    data-testid={`filter-section-${sec}`}
                  >
                    {sec} ({sectionCounts[sec]})
                  </button>
                ))}

                <div className="w-px h-5 bg-border mx-1 hidden sm:block" />

                <span className="text-xs font-medium text-muted-foreground mr-1">Severity:</span>
                {[
                  { key: "ALL", label: "All" },
                  { key: "BLOCKER", label: "Blockers", count: blockers.length },
                  { key: "WARNING", label: "Warnings", count: warnings.length },
                  { key: "INFO", label: "Info", count: infos.length },
                ].map(opt => (
                  <button
                    key={opt.key}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${severityFilter === opt.key ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                    onClick={() => { setSeverityFilter(opt.key); setCurrentPage(1); }}
                    data-testid={`filter-severity-${opt.key}`}
                  >
                    {opt.label}{opt.count != null ? ` (${opt.count})` : ""}
                  </button>
                ))}

                <div className="w-px h-5 bg-border mx-1 hidden sm:block" />

                <button
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${showResolved ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                  onClick={() => { setShowResolved(!showResolved); setCurrentPage(1); }}
                  data-testid="filter-show-resolved"
                >
                  {showResolved ? "Hide" : "Show"} Resolved ({resolvedCount})
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Issue groups (filtered + paginated) */}
          {severityFilter === "ALL" || severityFilter === "BLOCKER" ? renderIssueGroup(
            "Blockers",
            paginatedBlockers,
            <AlertCircle className="w-4 h-4 text-red-500" />,
            "bg-red-50/50",
            "border-red-200",
          ) : null}
          {severityFilter === "ALL" || severityFilter === "WARNING" ? renderIssueGroup(
            "Warnings",
            paginatedWarnings,
            <AlertTriangle className="w-4 h-4 text-amber-500" />,
            "bg-amber-50/50",
            "border-amber-200",
          ) : null}
          {severityFilter === "ALL" || severityFilter === "INFO" ? renderIssueGroup(
            "Info",
            paginatedInfos,
            <Info className="w-4 h-4 text-blue-500" />,
            "bg-blue-50/50",
            "border-blue-200",
          ) : null}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between" data-testid="issues-pagination">
              <span className="text-xs text-muted-foreground">
                Showing {(safePage - 1) * ISSUES_PER_PAGE + 1}–{Math.min(safePage * ISSUES_PER_PAGE, allFilteredIssues.length)} of {allFilteredIssues.length} issues
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2"
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  data-testid="btn-prev-page"
                >
                  <ArrowLeft className="w-3 h-3" />
                </Button>
                <span className="text-xs text-muted-foreground px-2">
                  Page {safePage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2"
                  disabled={safePage >= totalPages}
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  data-testid="btn-next-page"
                >
                  <ArrowRight className="w-3 h-3" />
                </Button>
              </div>
            </div>
          )}

          {allFilteredIssues.length === 0 && issues.length > 0 && (
            <Card className="bg-card rounded-xl shadow-sm">
              <CardContent className="flex flex-col items-center justify-center py-8 gap-2">
                <Info className="w-6 h-6 text-slate-400" />
                <p className="text-sm text-muted-foreground">No issues match the current filters</p>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => { setSectionFilter("ALL"); setSeverityFilter("ALL"); setShowResolved(true); }}>
                  Clear Filters
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {unresolvedBlockers.length > 0 && (
        <Card className="bg-red-50 border border-red-200 rounded-xl shadow-sm" data-testid="admin-questions-panel">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Questions for Admin
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-red-600 mb-2">
              The following blockers must be resolved before committing:
            </p>
            <ul className="space-y-1">
              {unresolvedBlockers.map((b: any) => (
                <li key={b.id} className="text-xs text-red-700 flex items-center gap-1.5" data-testid={`admin-blocker-${b.id}`}>
                  <X className="w-3 h-3" />
                  {b.message}
                </li>
              ))}
            </ul>
            {isAdmin && (
              <div className="mt-3 pt-3 border-t border-red-200">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-red-300 text-red-700 hover:bg-red-100"
                  disabled={ignoringAll}
                  onClick={handleIgnoreAllBlockers}
                  data-testid="btn-ignore-all-blockers"
                >
                  {ignoringAll ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
                  Ignore All Blockers ({unresolvedBlockers.length})
                </Button>
                <p className="text-[10px] text-red-500 mt-1">
                  Data rows with blockers will be skipped during import
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <InvoiceClassificationPanel runId={runId} normalization={normalization} />

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} data-testid="btn-back-issues">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button
          onClick={onContinue}
          disabled={unresolvedBlockers.length > 0}
          data-testid="btn-continue-issues"
        >
          Continue
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}

function InvoiceClassificationPanel({ runId, normalization }: { runId: number; normalization: any }) {
  const [classifications, setClassifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [classified, setClassified] = useState(false);
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [rowOverrides, setRowOverrides] = useState<Record<number, { type: string; reason: string }>>({});
  const [applyToSimilar, setApplyToSimilar] = useState(false);
  const { toast } = useToast();

  const getRowOverride = (row: number) => rowOverrides[row] || { type: "OTHER", reason: "" };
  const setRowOverride = (row: number, field: "type" | "reason", value: string) => {
    setRowOverrides(prev => ({ ...prev, [row]: { ...getRowOverride(row), [field]: value } }));
  };

  const costLines = normalization?.costLines || [];
  const hasExpenditure = costLines.length > 0;

  const runClassification = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/smart-import/${runId}/classify`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (res.ok) {
        setClassifications(data.classifications || []);
        setClassified(true);
      } else {
        toast({ title: "Classification failed", description: data.error, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setLoading(false);
  };

  const handleReview = async (sourceRow: number, action: string) => {
    setReviewing(sourceRow);
    try {
      const rowOv = getRowOverride(sourceRow);
      const body: any = { sourceRow, action, applyToSimilar };
      if (action === "override") {
        body.selectedType = rowOv.type;
        body.overrideReason = rowOv.reason;
      }
      const res = await fetch(`/api/smart-import/${runId}/classify-review`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setClassifications(data.classifications || classifications);
        setRowOverrides(prev => { const next = { ...prev }; delete next[sourceRow]; return next; });
        toast({ title: action === "confirm" ? "Confirmed" : "Overridden", description: "Classification updated" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setReviewing(null);
  };

  if (!hasExpenditure) return null;

  const needsReview = classifications.filter(c => c.outcome === "UNRESOLVED" && c.confidenceScore >= 50);
  const unresolved = classifications.filter(c => c.outcome === "UNRESOLVED" && c.confidenceScore < 50);
  const autoApplied = classifications.filter(c => c.outcome === "AUTO_APPLIED" || c.outcome === "USER_CONFIRMED");

  return (
    <Card className="bg-card rounded-xl shadow-sm mt-4" data-testid="invoice-classification-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-purple-600" />
          Invoice Pattern Classification
          {classified && (
            <span className="text-[10px] font-normal text-muted-foreground ml-2">
              {autoApplied.length} auto-classified, {needsReview.length} need review, {unresolved.length} unresolved
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!classified ? (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground mb-3">
              Classify {costLines.length} expenditure lines by invoice number pattern to determine
              counterparty type (Installer / Supplier / Other).
            </p>
            <Button onClick={runClassification} disabled={loading} data-testid="btn-run-classify">
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
              Run Classification
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {autoApplied.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-2">
                <p className="text-xs text-green-700 font-medium">
                  <CheckCircle2 className="w-3 h-3 inline mr-1" />
                  {autoApplied.length} lines auto-classified (confidence {"\u2265"} 85%)
                </p>
              </div>
            )}

            {(needsReview.length > 0 || unresolved.length > 0) && (
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted border-b border-border">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Row</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Invoice #</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Suggested Type</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Confidence</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Pattern</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...needsReview, ...unresolved].map((cl) => (
                      <tr key={cl.sourceRow} className="border-b border-border hover:bg-muted" data-testid={`classify-row-${cl.sourceRow}`}>
                        <td className="px-3 py-2 font-mono text-muted-foreground">{cl.sourceRow}</td>
                        <td className="px-3 py-2 font-mono">{cl.invoiceNumberRaw || "—"}</td>
                        <td className="px-3 py-2">
                          <Badge variant={cl.inferredType === "INSTALLER" ? "default" : cl.inferredType === "SUPPLIER" ? "secondary" : "outline"}
                            className="text-[10px]">
                            {cl.inferredType}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`font-medium ${cl.confidenceScore >= 70 ? "text-amber-600" : "text-red-500"}`}>
                            {cl.confidenceScore}%
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground text-[10px]">{cl.patternInfo || "—"}</td>
                        <td className="px-3 py-2">
                          {reviewing === cl.sourceRow ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : cl.outcome === "UNRESOLVED" ? (
                            <div className="flex flex-wrap gap-1 items-center">
                              {cl.confidenceScore >= 50 && (
                                <Button size="sm" variant="outline" className="h-6 text-[10px] px-2"
                                  onClick={() => handleReview(cl.sourceRow, "confirm")}
                                  data-testid={`btn-confirm-${cl.sourceRow}`}>
                                  Confirm
                                </Button>
                              )}
                              <SearchableSelect
                                value={getRowOverride(cl.sourceRow).type}
                                onValueChange={(v) => setRowOverride(cl.sourceRow, "type", v)}
                                triggerClassName="h-6 text-[10px] w-24"
                                data-testid={`select-type-${cl.sourceRow}`}
                                options={[
                                  { value: "INSTALLER", label: "Installer" },
                                  { value: "SUPPLIER", label: "Supplier" },
                                  { value: "OTHER", label: "Other" },
                                ]}
                              />
                              <Input
                                placeholder="Reason..."
                                className="h-6 text-[10px] w-28 min-w-0"
                                value={getRowOverride(cl.sourceRow).reason}
                                onChange={(e) => setRowOverride(cl.sourceRow, "reason", e.target.value)}
                                data-testid={`input-reason-${cl.sourceRow}`}
                              />
                              <Button size="sm" variant="default" className="h-6 text-[10px] px-2"
                                onClick={() => handleReview(cl.sourceRow, "override")}
                                disabled={!getRowOverride(cl.sourceRow).reason.trim()}
                                data-testid={`btn-override-${cl.sourceRow}`}>
                                Override
                              </Button>
                            </div>
                          ) : (
                            <Badge className="text-[10px] bg-green-50 text-green-700">{cl.outcome}</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(needsReview.length > 0 || unresolved.length > 0) && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={applyToSimilar} onChange={e => setApplyToSimilar(e.target.checked)}
                  data-testid="checkbox-apply-similar" />
                Apply to all similar invoices (same prefix pattern)
              </label>
            )}

            <Button variant="outline" size="sm" onClick={runClassification} disabled={loading}
              data-testid="btn-reclassify">
              {loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
              Re-run Classification
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PreviewCommitStep({
  runId,
  preview,
  onBack,
}: {
  runId: number;
  preview: any;
  onBack: () => void;
}) {
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [commitResult, setCommitResult] = useState<any>(null);
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [manualEditsWarning, setManualEditsWarning] = useState<{
    message: string;
    count: number;
    conflicts?: Array<{
      sourceRow: number;
      description: string;
      costCategory: string;
      field: string;
      currentValue: string;
      importValue: string;
    }>;
  } | null>(null);
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, "keep" | "import">>({});
  const [previouslyDeletedWarning, setPreviouslyDeletedWarning] = useState<{ message: string; deletedBy: string; deletedAt: string } | null>(null);
  const [recencyWarning, setRecencyWarning] = useState<{ message: string; error: string } | null>(null);
  const [blockerWarning, setBlockerWarning] = useState<{
    message: string;
    unresolvedBlockers: Array<{
      id: number;
      section: string;
      message: string;
      issueType?: string | null;
      rowReference?: string | number | null;
      field?: string | null;
      reason?: string | null;
      expected?: string | null;
    }>;
  } | null>(null);
  const [planEditConflict, setPlanEditConflict] = useState<{
    message: string;
    unresolvedCount: number;
    conflicts: Array<{ id: number; taskName: string; editType: string; fieldName: string; oldValue: string; newValue: string }>;
  } | null>(null);
  const [duplicateProjectWarning, setDuplicateProjectWarning] = useState<{
    message: string;
    matchCandidates: Array<{ projectId: number; projectName: string; confidence: number; matchReason: string }>;
  } | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const normalization = preview?.normalization || {};
  const detectedSections = preview?.detection?.sections || [];

  const planRows = normalization.planTasks || [];
  const revenueRows = normalization.revenueLines || [];
  const costRows = normalization.costLines || [];
  const executionPhases = normalization.executionPhases || [];
  const counterpartyNames = normalization.counterpartyNames || [];

  const planDetection = detectedSections.find((s: any) => s.section === "PLAN");
  const revenueDetection = detectedSections.find((s: any) => s.section === "REVENUE");
  const expenditureDetection = detectedSections.find((s: any) => s.section === "EXPENDITURE");

  const doCommit = async (extraBody: Record<string, any> = {}) => {
    setCommitting(true);
    try {
      const res = await fetch(`/api/smart-import/${runId}/commit`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(extraBody),
      });
      if (res.ok) {
        const data = await res.json();
        setCommitted(true);
        setCommitResult(data);
        setManualEditsWarning(null);
        setPreviouslyDeletedWarning(null);
        setRecencyWarning(null);
        setBlockerWarning(null);
        setPlanEditConflict(null);
        setDuplicateProjectWarning(null);
        toast({ title: "Import Committed!", description: "Data has been imported successfully" });
      } else {
        const err = await res.json().catch(() => ({ error: "Commit failed" }));
        if (err.error === "manual_edits_warning") {
          setManualEditsWarning({ message: err.message, count: err.manualEditCount, conflicts: err.conflicts || [] });
          if (err.conflicts) {
            const defaults: Record<string, "keep" | "import"> = {};
            for (const c of err.conflicts) {
              defaults[`${c.sourceRow}::${c.field}`] = "keep";
            }
            setConflictResolutions(defaults);
          }
        } else if (err.error === "previously_deleted") {
          setPreviouslyDeletedWarning({ message: err.message, deletedBy: err.deletedBy, deletedAt: err.deletedAt });
        } else if (err.error === "import_older_than_existing" || err.error === "import_equal_date") {
          setRecencyWarning({ message: err.message, error: err.error });
        } else if (err.error === "unresolved_blockers") {
          setBlockerWarning({
            message: err.message || "Resolve the remaining blocker rows before committing.",
            unresolvedBlockers: err.unresolvedBlockers || [],
          });
        } else if (err.error === "plan_edit_conflict_block") {
          setPlanEditConflict({
            message: err.message || "Unresolved front-end plan edits must be resolved before committing.",
            unresolvedCount: err.unresolvedCount || 0,
            conflicts: err.conflicts || [],
          });
        } else if (err.error === "duplicate_project_candidate") {
          setDuplicateProjectWarning({
            message: err.message || "A similar project already exists.",
            matchCandidates: err.matchCandidates || [],
          });
        } else {
          toast({ title: "Error", description: err.message || err.error || "Commit failed", variant: "destructive" });
        }
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    } finally {
      setCommitting(false);
    }
  };

  const handleCommit = () => doCommit({});
  const handleCommitForce = () => doCommit({ acknowledgeManualEdits: true });
  const handleCommitPreserve = () => doCommit({ preserveManualEdits: true });
  const handleCommitWithResolutions = () => doCommit({ conflictResolutions });
  const handleCommitRecreate = () => doCommit({ forceRecreate: true });
  const handleCommitConfirmNewProject = () => doCommit({ confirmNewProject: true });
  const handleCommitSelectProject = (projectId: number) => doCommit({ projectId });

  const toggleTable = (key: string) => {
    setExpandedTables((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (committed) {
    const projectName = preview?.detection?.projectInfo?.name || preview?.detection?.projectInfo?.projectName || preview?.projectInfo?.name || "";
    return (
      <Card className="bg-card rounded-xl shadow-sm" data-testid="commit-success">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-600" />
          </div>
          <h3 className="text-lg font-semibold text-emerald-700">Import Successful!</h3>
          {commitResult && (
            <div className="text-center text-sm text-muted-foreground space-y-1">
              {commitResult.summary && (
                <div className="mb-3 p-3 rounded-lg bg-muted/50 text-left max-w-md mx-auto">
                  <p className="font-medium text-foreground mb-1">Import Summary</p>
                  <p>File: {commitResult.summary.fileName}</p>
                  <p>Timestamp: {new Date(commitResult.summary.timestamp).toLocaleString()}</p>
                  <p>Rows written: {commitResult.summary.rowsWritten}</p>
                  {commitResult.summary.rowsSkipped > 0 && (
                    <p className="text-amber-600">Rows skipped: {commitResult.summary.rowsSkipped}</p>
                  )}
                  {commitResult.summary.conflictsDetected > 0 && (
                    <p className="text-blue-600">Conflicts detected: {commitResult.summary.conflictsDetected} (resolved: {commitResult.summary.conflictsResolved})</p>
                  )}
                </div>
              )}
              {commitResult.counts?.planTasks != null && <p>{commitResult.counts.planTasks} plan tasks imported</p>}
              {commitResult.counts?.revenueLines != null && <p>{commitResult.counts.revenueLines} revenue lines imported</p>}
              {commitResult.counts?.costLines != null && <p>{commitResult.counts.costLines} cost lines imported</p>}
              {commitResult.counts?.executionPhases != null && <p>{commitResult.counts.executionPhases} execution phases</p>}
              {commitResult.counts?.counterparties != null && <p>{commitResult.counts.counterparties} new counterparties</p>}
              {commitResult.preservedManualEdits != null && commitResult.preservedManualEdits > 0 && (
                <p className="text-emerald-600 font-medium">{commitResult.preservedManualEdits} manual edit(s) preserved</p>
              )}
            </div>
          )}
          {projectName && (
            <Button
              onClick={() => navigate(`/project/${encodeURIComponent(projectName)}`)}
              data-testid="btn-view-project"
            >
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              View Project
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="preview-commit-step">
      <Card className="bg-card rounded-xl shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Import Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-muted rounded-lg p-3 text-center">
              <div className="text-lg font-bold" data-testid="text-plan-count">
                {planRows.length}
              </div>
              <div className="text-[10px] text-muted-foreground">Plan Tasks</div>
            </div>
            <div className="bg-muted rounded-lg p-3 text-center">
              <div className="text-lg font-bold" data-testid="text-revenue-count">
                {revenueRows.length}
              </div>
              <div className="text-[10px] text-muted-foreground">Revenue Lines</div>
            </div>
            <div className="bg-muted rounded-lg p-3 text-center">
              <div className="text-lg font-bold" data-testid="text-cost-count">
                {costRows.length}
              </div>
              <div className="text-[10px] text-muted-foreground">Cost Lines</div>
            </div>
            <div className="bg-muted rounded-lg p-3 text-center">
              <div className="text-lg font-bold" data-testid="text-phase-count">
                {executionPhases.length}
              </div>
              <div className="text-[10px] text-muted-foreground">Execution Phases</div>
            </div>
            <div className="bg-muted rounded-lg p-3 text-center">
              <div className="text-lg font-bold" data-testid="text-cp-count">
                {counterpartyNames.length}
              </div>
              <div className="text-[10px] text-muted-foreground">New Counterparties</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Budget vs Actual summary card */}
      {normalization.costedSummary && (
        <Card className="bg-card rounded-xl shadow-sm" data-testid="budget-actual-summary">
          <CardContent className="p-4">
            <p className="text-sm font-semibold mb-3">Costed Summary</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {[
                { label: "Revenue", planned: normalization.costedSummary.plannedRevenue, actual: normalization.costedSummary.actualRevenue },
                { label: "Expenditure", planned: normalization.costedSummary.plannedExpenditure, actual: normalization.costedSummary.actualExpenditure },
                { label: "Profit", planned: normalization.costedSummary.plannedProfit, actual: normalization.costedSummary.actualProfit },
                { label: "Margin", planned: normalization.costedSummary.plannedMargin, actual: normalization.costedSummary.actualMargin },
              ].map(({ label, planned, actual }) => {
                const isMargin = label === "Margin";
                const fmt = (v: number | null) => {
                  if (v == null) return "—";
                  return isMargin ? `${(v * 100).toFixed(1)}%` : `R ${Number(v).toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
                };
                const variance = planned != null && actual != null ? actual - planned : null;
                return (
                  <div key={label} className="border rounded-lg p-2.5">
                    <div className="font-medium text-muted-foreground mb-1">{label}</div>
                    <div className="flex justify-between items-baseline">
                      <div>
                        <div className="text-[10px] text-slate-400">Budget</div>
                        <div className="font-semibold text-slate-600 bg-slate-50 px-1 rounded">{fmt(planned)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-400">Actual</div>
                        <div className="font-semibold">{fmt(actual)}</div>
                      </div>
                    </div>
                    {variance != null && !isMargin && (
                      <div className={`text-[10px] mt-1 text-right ${variance >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {variance >= 0 ? "+" : ""}{fmt(variance)} variance
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Budget line totals vs actual totals */}
      {costRows.length > 0 && costRows.some((r: any) => r.budgetTotal) && (
        <Card className="bg-card rounded-xl shadow-sm" data-testid="budget-line-summary">
          <CardContent className="p-4">
            <p className="text-sm font-semibold mb-2">Expenditure: Budget vs Actual</p>
            <div className="grid grid-cols-3 gap-3 text-xs">
              {(() => {
                const totalBudget = costRows.reduce((s: number, r: any) => s + (parseFloat(r.budgetTotal) || 0), 0);
                const totalActual = costRows.reduce((s: number, r: any) => s + (parseFloat(r.amountExVat) || 0), 0);
                const variance = totalActual - totalBudget;
                const fmt = (v: number) => `R ${v.toLocaleString("en-ZA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
                return (
                  <>
                    <div className="bg-slate-50 rounded-lg p-2.5 text-center">
                      <div className="text-[10px] text-slate-400">Total Budget</div>
                      <div className="font-bold text-slate-600">{fmt(totalBudget)}</div>
                    </div>
                    <div className="bg-muted rounded-lg p-2.5 text-center">
                      <div className="text-[10px] text-slate-400">Total Actual</div>
                      <div className="font-bold">{fmt(totalActual)}</div>
                    </div>
                    <div className={`rounded-lg p-2.5 text-center ${variance >= 0 ? "bg-red-50" : "bg-emerald-50"}`}>
                      <div className="text-[10px] text-slate-400">Variance</div>
                      <div className={`font-bold ${variance >= 0 ? "text-red-600" : "text-emerald-600"}`}>
                        {variance >= 0 ? "+" : ""}{fmt(variance)}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </CardContent>
        </Card>
      )}

      {planRows.length > 0 && (
        <Card className="bg-card rounded-xl shadow-sm">
          <CardHeader
            className="pb-2 cursor-pointer flex flex-row items-center justify-between"
            onClick={() => toggleTable("plan")}
            data-testid="toggle-plan-preview"
          >
            <div className="flex items-center gap-3">
              <CardTitle className="text-sm">Plan Tasks Preview</CardTitle>
              {(() => {
                const milestones = planRows.filter((r: any) => r.isMilestone);
                const subtasks = planRows.filter((r: any) => r.parentTaskNo);
                return (
                  <div className="flex items-center gap-2 text-[10px]">
                    <Badge className="bg-amber-50 text-amber-700 border-amber-200 px-1.5 py-0">{milestones.length} milestones</Badge>
                    <Badge className="bg-blue-50 text-blue-700 border-blue-200 px-1.5 py-0">{subtasks.length} subtasks</Badge>
                  </div>
                );
              })()}
            </div>
            {expandedTables["plan"] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </CardHeader>
          {expandedTables["plan"] && (
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" data-testid="table-plan-preview">
                  <thead>
                    <tr className="bg-muted border-b">
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase">No.</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase">Task Name</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase">Start Date</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase">End Date</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase">% Complete</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {planRows.slice(0, 15).map((row: any, idx: number) => {
                      const isMs = row.isMilestone === true;
                      const indent = row.indentLevel || 0;
                      return (
                      <tr key={idx} className={`border-b border-border ${isMs ? "bg-amber-50/60 font-semibold" : ""}`}>
                        <td className="px-3 py-1.5 text-muted-foreground font-mono text-[10px]">{row.taskNo || "—"}</td>
                        <td className="px-3 py-1.5">
                          <span style={{ paddingLeft: `${indent * 16}px` }} className={isMs ? "text-amber-800" : ""}>
                            {isMs ? "◆ " : indent > 0 ? "└ " : ""}{row.taskName || row.task_name || "—"}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">{row.startDate || row.start_date || "—"}</td>
                        <td className="px-3 py-1.5">{row.endDate || row.end_date || "—"}</td>
                        <td className="px-3 py-1.5">{row.pctComplete != null ? `${Math.round(row.pctComplete * 100)}%` : "—"}</td>
                        <td className="px-3 py-1.5">{row.status || "—"}</td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                {planRows.length > 15 && (
                  <div className="text-center py-1.5 text-[10px] text-slate-500 bg-muted">
                    ... and {planRows.length - 15} more tasks
                  </div>
                )}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {revenueRows.length > 0 && (
        <Card className="bg-card rounded-xl shadow-sm">
          <CardHeader
            className="pb-2 cursor-pointer flex flex-row items-center justify-between"
            onClick={() => toggleTable("revenue")}
            data-testid="toggle-revenue-preview"
          >
            <CardTitle className="text-sm">Revenue Lines Preview</CardTitle>
            {expandedTables["revenue"] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </CardHeader>
          {expandedTables["revenue"] && (
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" data-testid="table-revenue-preview">
                  <thead>
                    <tr className="bg-muted border-b">
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase">Milestone</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase">Amount</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenueRows.slice(0, 10).map((row: any, idx: number) => (
                      <tr key={idx} className="border-b border-border">
                        <td className="px-3 py-1.5">{row.milestoneName || row.description || "—"}</td>
                        <td className="px-3 py-1.5">{row.amountExVat || "—"}</td>
                        <td className="px-3 py-1.5">{row.status || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {costRows.length > 0 && (
        <Card className="bg-card rounded-xl shadow-sm">
          <CardHeader
            className="pb-2 cursor-pointer flex flex-row items-center justify-between"
            onClick={() => toggleTable("cost")}
            data-testid="toggle-cost-preview"
          >
            <CardTitle className="text-sm">Cost Lines Preview</CardTitle>
            {expandedTables["cost"] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </CardHeader>
          {expandedTables["cost"] && (
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" data-testid="table-cost-preview">
                  <thead>
                    <tr className="bg-muted border-b">
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase">Category</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase">Counterparty</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase">Amount</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costRows.slice(0, 10).map((row: any, idx: number) => (
                      <tr key={idx} className="border-b border-border">
                        <td className="px-3 py-1.5">{row.costCategory || "—"}</td>
                        <td className="px-3 py-1.5">{row.counterpartyName || "—"}</td>
                        <td className="px-3 py-1.5">{row.amountExVat || "—"}</td>
                        <td className="px-3 py-1.5">{row.status || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {previouslyDeletedWarning && (
        <Card className="border-red-300 bg-red-50" data-testid="previously-deleted-warning">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
              <div className="flex-1 space-y-2">
                <p className="text-sm font-medium text-red-800">{previouslyDeletedWarning.message}</p>
                <p className="text-xs text-red-600">This project was previously deleted from the system. Proceeding will create a brand new project with this name and import all the data from this file.</p>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPreviouslyDeletedWarning(null)}
                    data-testid="btn-cancel-recreate"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="bg-red-600 hover:bg-red-700 text-white"
                    onClick={handleCommitRecreate}
                    disabled={committing}
                    data-testid="btn-confirm-recreate"
                  >
                    {committing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                    Re-create & Import
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {manualEditsWarning && (
        <Card className="border-amber-300 bg-amber-50" data-testid="manual-edits-warning">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1 space-y-3">
                <p className="text-sm font-medium text-amber-800">{manualEditsWarning.message}</p>
                <p className="text-xs text-amber-600">Choose how to handle your existing manual changes below.</p>

                {manualEditsWarning.conflicts && manualEditsWarning.conflicts.length > 0 && (
                  <div className="mt-2 border border-amber-200 rounded-lg overflow-hidden bg-white">
                    <div className="px-3 py-2 bg-amber-100/50 border-b border-amber-200">
                      <p className="text-xs font-semibold text-amber-800">Manual edits detected — choose which to keep</p>
                    </div>
                    <div className="max-h-[320px] overflow-y-auto">
                      <table className="w-full text-xs" data-testid="table-conflicts">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="text-left px-3 py-1.5 font-medium text-slate-600">Row</th>
                            <th className="text-left px-3 py-1.5 font-medium text-slate-600">Item</th>
                            <th className="text-left px-3 py-1.5 font-medium text-slate-600">Field</th>
                            <th className="text-left px-3 py-1.5 font-medium text-slate-600">Manual Value</th>
                            <th className="text-left px-3 py-1.5 font-medium text-slate-600">Excel Value</th>
                            <th className="text-left px-3 py-1.5 font-medium text-slate-600 hidden md:table-cell">Edited By</th>
                            <th className="text-center px-3 py-1.5 font-medium text-slate-600">Decision</th>
                          </tr>
                        </thead>
                        <tbody>
                          {manualEditsWarning.conflicts.map((c: any, i: number) => {
                            const key = `${c.sourceRow}::${c.field}`;
                            const isKeep = conflictResolutions[key] === "keep";
                            return (
                              <tr key={i} className={`border-b border-slate-100 ${isKeep ? "bg-emerald-50/30" : "bg-red-50/20"}`}>
                                <td className="px-3 py-1.5 text-slate-500 font-mono">{c.sourceRow}</td>
                                <td className="px-3 py-1.5 text-slate-700 max-w-[160px] truncate" title={`${c.costCategory}: ${c.description}`}>
                                  {c.description || c.costCategory}
                                </td>
                                <td className="px-3 py-1.5 text-slate-600">{c.field}</td>
                                <td className="px-3 py-1.5 text-emerald-700 font-medium">{c.currentValue}</td>
                                <td className="px-3 py-1.5 text-slate-500">{c.importValue}</td>
                                <td className="px-3 py-1.5 text-slate-400 text-[10px] hidden md:table-cell">
                                  {c.editedByName && <span className="block">{c.editedByName}</span>}
                                  {c.editedAt && <span className="block">{new Date(c.editedAt).toLocaleDateString()}</span>}
                                </td>
                                <td className="px-3 py-1.5 text-center">
                                  <button
                                    className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                                      isKeep
                                        ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                                        : "bg-red-100 text-red-600 hover:bg-red-200"
                                    }`}
                                    onClick={() => {
                                      setConflictResolutions(prev => ({
                                        ...prev,
                                        [key]: isKeep ? "import" : "keep",
                                      }));
                                    }}
                                    data-testid={`btn-toggle-conflict-${i}`}
                                  >
                                    {isKeep ? "Keep Manual" : "Overwrite with Excel"}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 flex items-center gap-3">
                      <span className="text-[10px] text-slate-500 font-medium">Apply to All:</span>
                      <button
                        className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded transition-colors"
                        onClick={() => {
                          const all: Record<string, "keep" | "import"> = {};
                          for (const c of manualEditsWarning.conflicts || []) {
                            all[`${c.sourceRow}::${c.field}`] = "keep";
                          }
                          setConflictResolutions(all);
                        }}
                        data-testid="btn-keep-all"
                      >
                        Keep All Manual Edits
                      </button>
                      <button
                        className="text-[10px] font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded transition-colors"
                        onClick={() => {
                          const all: Record<string, "keep" | "import"> = {};
                          for (const c of manualEditsWarning.conflicts || []) {
                            all[`${c.sourceRow}::${c.field}`] = "import";
                          }
                          setConflictResolutions(all);
                        }}
                        data-testid="btn-use-all-import"
                      >
                        Overwrite All with Excel
                      </button>
                      <span className="text-[10px] text-slate-400 ml-auto">You can still change individual fields after applying</span>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setManualEditsWarning(null); setConflictResolutions({}); }}
                    data-testid="btn-cancel-overwrite"
                  >
                    Cancel
                  </Button>
                  {manualEditsWarning.conflicts && manualEditsWarning.conflicts.length > 0 ? (
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700"
                      onClick={handleCommitWithResolutions}
                      disabled={committing}
                      data-testid="btn-commit-resolved"
                    >
                      {committing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                      Confirm and Apply
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700"
                        onClick={handleCommitPreserve}
                        disabled={committing}
                        data-testid="btn-preserve-manual"
                      >
                        {committing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                        Keep Manual Edits & Commit
                      </Button>
                      <Button
                        size="sm"
                        className="bg-amber-600 hover:bg-amber-700"
                        onClick={handleCommitForce}
                        disabled={committing}
                        data-testid="btn-confirm-overwrite"
                      >
                        {committing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                        Overwrite & Commit
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {recencyWarning && (
        <Card className="border-amber-300 bg-amber-50" data-testid="recency-warning">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1 space-y-2">
                <p className="text-sm font-medium text-amber-800">{recencyWarning.message}</p>
                <p className="text-xs text-amber-600">
                  {recencyWarning.error === "import_equal_date"
                    ? "The uploaded file has the same date as the existing data. You may proceed if the file contains corrections."
                    : "The uploaded file appears older than the existing data. Proceeding may overwrite newer data with older values."}
                </p>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRecencyWarning(null)}
                    data-testid="btn-cancel-recency"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={() => { setRecencyWarning(null); doCommit({ acknowledgeEqualDate: true, forceCommit: true }); }}
                    disabled={committing}
                    data-testid="btn-force-recency"
                  >
                    {committing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                    Import Anyway
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {planEditConflict && (
        <Card className="border-amber-300 bg-amber-50" data-testid="plan-edit-conflict-warning">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-800">{planEditConflict.message}</p>
                <p className="text-xs text-amber-600">{planEditConflict.unresolvedCount} unresolved plan edit(s) must be reviewed before this import can be committed.</p>
              </div>
            </div>
            {planEditConflict.conflicts.length > 0 && (
              <div className="space-y-2">
                {planEditConflict.conflicts.map((c) => (
                  <div key={c.id} className="rounded-lg border border-amber-200 bg-white p-3 text-xs text-slate-700">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{c.taskName}</Badge>
                      <Badge variant="outline">{c.editType}</Badge>
                      {c.fieldName && <Badge variant="outline">{c.fieldName}</Badge>}
                    </div>
                    {(c.oldValue || c.newValue) && (
                      <p className="mt-2 text-slate-600">
                        {c.oldValue && <span>Old: <strong>{c.oldValue}</strong></span>}
                        {c.oldValue && c.newValue && " → "}
                        {c.newValue && <span>New: <strong>{c.newValue}</strong></span>}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPlanEditConflict(null)}>
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {duplicateProjectWarning && (
        <Card className="border-amber-300 bg-amber-50" data-testid="duplicate-project-warning">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-800">{duplicateProjectWarning.message}</p>
                <p className="text-xs text-amber-600">
                  {duplicateProjectWarning.matchCandidates?.some((m: any) => m.matchReason === "same_project_different_phase")
                    ? "This file appears to be a different phase of an existing project. Please confirm which project to map to."
                    : "Select an existing project to map to, or confirm creating a new one."}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {duplicateProjectWarning.matchCandidates.map((m) => (
                <div key={m.projectId} className="rounded-lg border border-amber-200 bg-white p-3 text-xs text-slate-700 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-900">{m.projectName}</p>
                    <p className="text-slate-500">{m.matchReason} — {Math.round(m.confidence * 100)}% match</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => { setDuplicateProjectWarning(null); handleCommitSelectProject(m.projectId); }}>
                    Use This Project
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setDuplicateProjectWarning(null)}>
                Cancel
              </Button>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { setDuplicateProjectWarning(null); handleCommitConfirmNewProject(); }}>
                Create New Project
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {blockerWarning && (
        <Card className="border-red-300 bg-red-50" data-testid="blocker-warning">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start gap-3">
              <XCircle className="w-5 h-5 text-red-600 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-red-800">{blockerWarning.message}</p>
                <p className="text-xs text-red-600">Fix these rows in the Issues step, then retry the commit.</p>
              </div>
            </div>
            <div className="space-y-2">
              {blockerWarning.unresolvedBlockers.map((blocker) => (
                <div key={blocker.id} className="rounded-lg border border-red-200 bg-white p-3 text-xs text-slate-700">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{blocker.section}</Badge>
                    {blocker.rowReference != null ? <Badge variant="outline">Row {blocker.rowReference}</Badge> : null}
                    {blocker.field ? <Badge variant="outline">{blocker.field}</Badge> : null}
                  </div>
                  <p className="mt-2 font-medium text-slate-900">{blocker.message}</p>
                  {blocker.reason ? <p className="mt-1">Reason: {blocker.reason}</p> : null}
                  {blocker.expected ? <p className="mt-1">Expected: {blocker.expected}</p> : null}
                </div>
              ))}
            </div>
            <div className="flex justify-between">
              <Button variant="outline" size="sm" onClick={() => setBlockerWarning(null)}>
                Dismiss
              </Button>
              <Button size="sm" onClick={onBack}>
                Return to Issues
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} data-testid="btn-back-commit">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button
          onClick={handleCommit}
          disabled={committing}
          className="bg-emerald-600 hover:bg-emerald-700"
          data-testid="btn-commit"
        >
          {committing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Committing...
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Commit Import
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

interface PendingRun {
  id: number;
  projectName: string;
  status: string;
  uploadedAt: string;
  sourceFileName: string;
  blockerCount: number;
  warningCount: number;
  totalIssues: number;
  resolvedIssues: number;
}

interface BulkCommitResult {
  runId: number;
  projectName: string;
  status: "committed" | "skipped" | "failed";
  counts?: any;
  error?: string;
}

interface SmartImportRunHistoryItem {
  id: number;
  projectName: string;
  sourceFileName: string;
  status: string;
  uploadedAt: string;
  committedAt: string | null;
  uploaderName: string | null;
  recordsAttempted: number;
  recordsSucceeded: number;
  recordsFailed: number;
  totalIssues: number;
  unresolvedBlockers: number;
  unresolvedWarnings: number;
  resolvedIssues: number;
}

function BulkCommitPanel({ onBack, onSwitchToWizard }: {
  onBack: () => void;
  onSwitchToWizard: (runId: number) => void;
}) {
  const [pendingRuns, setPendingRuns] = useState<PendingRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitDone, setCommitDone] = useState(false);
  const [commitResults, setCommitResults] = useState<BulkCommitResult[]>([]);
  const [progress, setProgress] = useState(0);
  const [ignoringAllBlockers, setIgnoringAllBlockers] = useState(false);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const isAdmin = ["COO_ADMIN", "CEO_ADMIN", "admin"].includes(companyRole || "");

  const loadPendingRuns = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/smart-import/pending-runs", { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setPendingRuns(data);
      } else {
        const err = await res.json().catch(() => ({ error: "Pending imports could not be loaded." }));
        setPendingRuns([]);
        setLoadError(err.error || "Pending imports could not be loaded.");
      }
    } catch {
      setPendingRuns([]);
      setLoadError("Pending imports could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPendingRuns(); }, [loadPendingRuns]);

  const committableRuns = pendingRuns.filter(r => r.blockerCount === 0);
  const blockedRuns = pendingRuns.filter(r => r.blockerCount > 0);

  const handleIgnoreAllBlockers = async () => {
    if (blockedRuns.length === 0) return;
    setIgnoringAllBlockers(true);
    try {
      let totalIgnored = 0;
      for (const run of blockedRuns) {
        const res = await fetch(`/api/smart-import/${run.id}/ignore-all-blockers`, {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        });
        if (res.ok) {
          const data = await res.json();
          totalIgnored += data.ignored;
        }
      }
      toast({ title: "Blockers Ignored", description: `${totalIgnored} blocker(s) ignored across ${blockedRuns.length} files` });
      await loadPendingRuns();
    } catch {
      toast({ title: "Error", description: "Failed to ignore blockers", variant: "destructive" });
    } finally {
      setIgnoringAllBlockers(false);
    }
  };

  const [resolvingAllWarnings, setResolvingAllWarnings] = useState(false);
  const runsWithWarnings = pendingRuns.filter(r => r.warningCount > 0);

  const handleResolveAllWarnings = async () => {
    if (runsWithWarnings.length === 0) return;
    setResolvingAllWarnings(true);
    try {
      let totalResolved = 0;
      for (const run of runsWithWarnings) {
        const res = await fetch(`/api/smart-import/${run.id}/allow-all`, {
          method: "POST",
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        });
        if (res.ok) {
          const data = await res.json();
          totalResolved += data.allowed;
        }
      }
      toast({ title: "Warnings Resolved", description: `${totalResolved} warning(s) resolved across ${runsWithWarnings.length} files` });
      await loadPendingRuns();
    } catch {
      toast({ title: "Error", description: "Failed to resolve warnings", variant: "destructive" });
    } finally {
      setResolvingAllWarnings(false);
    }
  };

  const handleBulkCommit = async () => {
    if (committableRuns.length === 0) return;
    setCommitting(true);
    setProgress(0);

    const results: BulkCommitResult[] = [];
    let committed = 0;
    let failed = 0;
    const total = committableRuns.length;
    const BATCH_SIZE = 3;

    for (let i = 0; i < committableRuns.length; i += BATCH_SIZE) {
      const batch = committableRuns.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(async (run) => {
          try {
            const res = await fetch(`/api/smart-import/${run.id}/commit`, {
              method: "POST",
              headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
              body: JSON.stringify({ preserveManualEdits: true, forceCommit: true, acknowledgeEqualDate: true, forceRecreate: true }),
            });
            if (res.ok) {
              const data = await res.json();
              return { runId: run.id, projectName: run.projectName, status: "committed" as const, counts: data.counts };
            } else {
              const err = await res.json().catch(() => ({ error: "Commit failed" }));
              return { runId: run.id, projectName: run.projectName, status: "failed" as const, error: err.error || "Commit failed" };
            }
          } catch {
            return { runId: run.id, projectName: run.projectName, status: "failed" as const, error: "Network error" };
          }
        })
      );

      for (const result of batchResults) {
        const val = result.status === "fulfilled" ? result.value : { runId: 0, projectName: "Unknown", status: "failed" as const, error: "Unexpected error" };
        results.push(val);
        if (val.status === "committed") committed++;
        else failed++;
      }
      setProgress(Math.round(((i + batch.length) / total) * 100));
    }

    setProgress(100);
    setCommitDone(true);
    setCommitResults(results);
    toast({
      title: "Bulk Commit Complete",
      description: `${committed} committed, ${failed} failed out of ${total}`,
    });
    setCommitting(false);
  };

  if (loading) {
    return (
      <Card className="bg-card rounded-xl shadow-sm">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500 mr-2" />
          <span className="text-sm text-muted-foreground">Loading pending imports...</span>
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card className="bg-card rounded-xl shadow-sm">
        <CardContent className="py-6">
          <AdminQueryState
            isLoading={false}
            error={loadError}
            onRetry={() => { void loadPendingRuns(); }}
          >
            <div />
          </AdminQueryState>
        </CardContent>
      </Card>
    );
  }

  if (commitDone) {
    const committed = commitResults.filter(r => r.status === "committed");
    const failed = commitResults.filter(r => r.status === "failed");
    const skipped = commitResults.filter(r => r.status === "skipped");
    return (
      <div className="space-y-4" data-testid="bulk-commit-results">
        <Card className="bg-card rounded-xl shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-10 gap-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-600" />
            </div>
            <h3 className="text-lg font-semibold text-emerald-700" data-testid="text-bulk-success">
              Bulk Import Complete
            </h3>
            <div className="flex gap-4 text-sm">
              <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 px-3 py-1" data-testid="badge-committed-count">
                {committed.length} Committed
              </Badge>
              {skipped.length > 0 && (
                <Badge className="bg-amber-50 text-amber-700 border-amber-200 px-3 py-1" data-testid="badge-skipped-count">
                  {skipped.length} Skipped
                </Badge>
              )}
              {failed.length > 0 && (
                <Badge className="bg-red-50 text-red-700 border-red-200 px-3 py-1" data-testid="badge-failed-count">
                  {failed.length} Failed
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {commitResults.length > 0 && (
          <Card className="bg-card rounded-xl shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Results by Project</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y" data-testid="bulk-results-list">
                {commitResults.map((r, idx) => (
                  <div key={idx} className="flex items-center gap-3 py-2.5" data-testid={`bulk-result-${idx}`}>
                    {r.status === "committed" ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                    ) : r.status === "skipped" ? (
                      <SkipForward className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    )}
                    <span className="text-sm font-medium flex-1 truncate">{r.projectName}</span>
                    {r.status === "committed" && r.counts && (
                      <span className="text-xs text-muted-foreground">
                        {[
                          r.counts.planTasks && `${r.counts.planTasks} tasks`,
                          r.counts.revenueLines && `${r.counts.revenueLines} revenue`,
                          r.counts.costLines && `${r.counts.costLines} costs`,
                        ].filter(Boolean).join(", ")}
                      </span>
                    )}
                    {(r.status === "skipped" || r.status === "failed") && r.error && (
                      <span className="text-xs text-red-500 max-w-[200px] truncate">{r.error}</span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/projects")} data-testid="btn-view-projects">
            View Projects
          </Button>
          <Button onClick={() => { setCommitDone(false); setCommitResults([]); loadPendingRuns(); onBack(); }} data-testid="btn-import-more">
            Import More Files
          </Button>
        </div>
      </div>
    );
  }

  if (pendingRuns.length === 0) {
    return (
      <Card className="bg-card rounded-xl shadow-sm" data-testid="no-pending-runs">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
          <CheckCircle2 className="w-10 h-10 text-slate-600" />
          <p className="text-sm text-muted-foreground">No pending imports to commit</p>
          <Button variant="outline" onClick={onBack} data-testid="btn-back-to-upload">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Upload Files
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="bulk-commit-panel">
      <Card className="bg-card rounded-xl shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="w-4 h-4 text-blue-600" />
            Pending Imports ({pendingRuns.length} files)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center gap-3 text-sm">
            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 px-2.5 py-1" data-testid="badge-ready-count">
              {committableRuns.length} ready to commit
            </Badge>
            {blockedRuns.length > 0 && (
              <Badge className="bg-red-50 text-red-700 border-red-200 px-2.5 py-1" data-testid="badge-blocked-count">
                {blockedRuns.length} have blockers
              </Badge>
            )}
          </div>

          <div className="border rounded-lg divide-y max-h-[400px] overflow-y-auto" data-testid="pending-runs-list">
            {pendingRuns.map((run) => (
              <div
                key={run.id}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted transition-colors"
                data-testid={`pending-run-${run.id}`}
              >
                {run.blockerCount > 0 ? (
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                ) : run.warningCount > 0 ? (
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" data-testid={`pending-name-${run.id}`}>
                    {run.projectName}
                  </p>
                  <p className="text-[10px] text-slate-500 truncate">{run.sourceFileName}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {run.totalIssues > 0 && (
                    <span className="text-[10px] text-slate-500">
                      {run.resolvedIssues}/{run.totalIssues} resolved
                    </span>
                  )}
                  {run.blockerCount > 0 && (
                    <Badge className="bg-red-50 text-red-700 border-red-200 text-[10px] px-1.5 py-0">
                      {run.blockerCount} blocker{run.blockerCount > 1 ? "s" : ""}
                    </Badge>
                  )}
                  {run.warningCount > 0 && run.blockerCount === 0 && (
                    <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] px-1.5 py-0">
                      {run.warningCount} warning{run.warningCount > 1 ? "s" : ""}
                    </Badge>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7 px-2"
                  onClick={() => onSwitchToWizard(run.id)}
                  data-testid={`btn-review-${run.id}`}
                >
                  Review
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {committing && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Committing {committableRuns.length} files...</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack} data-testid="btn-back-upload">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>
        <Button
          className="flex-1"
          disabled={committableRuns.length === 0 || committing}
          onClick={handleBulkCommit}
          data-testid="btn-bulk-commit"
        >
          {committing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Committing... {progress}% ({Math.round(committableRuns.length * progress / 100)}/{committableRuns.length})
            </>
          ) : (
            <>
              <Zap className="w-4 h-4 mr-2" />
              Commit All ({committableRuns.length} files)
            </>
          )}
        </Button>
      </div>

      {blockedRuns.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3" data-testid="blocked-runs-notice">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800">
                {blockedRuns.length} file{blockedRuns.length > 1 ? "s have" : " has"} unresolved blockers
              </p>
              <p className="text-xs text-amber-600 mt-0.5">
                Click "Review" on those files to resolve issues before committing.
                Non-blocker warnings will be auto-resolved during bulk commit.
              </p>
              {isAdmin && (
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-red-300 text-red-700 hover:bg-red-100 bg-card"
                    disabled={ignoringAllBlockers}
                    onClick={handleIgnoreAllBlockers}
                    data-testid="btn-ignore-all-blockers-bulk"
                  >
                    {ignoringAllBlockers ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
                    Ignore All Blockers ({blockedRuns.length} files)
                  </Button>
                  <p className="text-[10px] text-amber-600 mt-1">
                    Blocked rows will be skipped during import. All files will become committable.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {runsWithWarnings.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3" data-testid="warnings-resolve-notice">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-800">
                {runsWithWarnings.length} file{runsWithWarnings.length > 1 ? "s have" : " has"} unresolved warnings
              </p>
              <p className="text-xs text-blue-600 mt-0.5">
                Non-blocker warnings can be resolved in bulk before committing.
              </p>
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-100 bg-card"
                  disabled={resolvingAllWarnings}
                  onClick={handleResolveAllWarnings}
                  data-testid="btn-resolve-all-warnings-bulk"
                >
                  {resolvingAllWarnings ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                  Resolve All Warnings ({runsWithWarnings.length} files)
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SmartImportGovernancePanel({
  pendingRuns,
  pendingRunsLoading,
  pendingRunsError,
  retryPendingRuns,
  recentRuns,
  recentRunsLoading,
  recentRunsError,
  retryRecentRuns,
}: {
  pendingRuns: PendingRun[];
  pendingRunsLoading: boolean;
  pendingRunsError: string | null;
  retryPendingRuns: () => void;
  recentRuns: SmartImportRunHistoryItem[];
  recentRunsLoading: boolean;
  recentRunsError: string | null;
  retryRecentRuns: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const recentAttentionRuns = recentRuns.filter((run) => run.status !== "COMMITTED" || run.unresolvedBlockers > 0 || run.unresolvedWarnings > 0 || run.recordsFailed > 0).slice(0, 5);

  const withWarnings = pendingRuns.filter((run) => run.warningCount > 0).length;
  const blocked = pendingRuns.filter((run) => run.blockerCount > 0).length;
  const recentCommitted = recentRuns.filter(r => r.status === "COMMITTED").length;

  return (
    <Card data-testid="governance-panel">
      {/* Compact summary bar - always visible */}
      <CardContent className="p-3">
        <div
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setExpanded(!expanded)}
          data-testid="governance-toggle"
        >
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-semibold">Import Governance</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-muted text-foreground border-border text-[10px] px-2 py-0.5">
              {pendingRuns.length} pending
            </Badge>
            {withWarnings > 0 && (
              <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] px-2 py-0.5">
                {withWarnings} warnings
              </Badge>
            )}
            {blocked > 0 && (
              <Badge className="bg-red-50 text-red-700 border-red-200 text-[10px] px-2 py-0.5">
                {blocked} blocked
              </Badge>
            )}
            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] px-2 py-0.5">
              {recentCommitted} committed
            </Badge>
            {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-3 pt-3 border-t border-border grid gap-4 xl:grid-cols-[minmax(0,1.1fr),minmax(0,0.9fr)]">
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Pending Queue</h4>
              <AdminQueryState
                isLoading={pendingRunsLoading}
                error={pendingRunsError}
                onRetry={retryPendingRuns}
                empty={pendingRuns.length === 0}
                emptyTitle="No runs need review"
                emptyDescription="New uploads appear here before commit."
                loadingLabel="Loading..."
              >
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                  {pendingRuns.slice(0, 5).map((run) => (
                    <div key={run.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/70 p-2 text-xs">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{run.projectName}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{run.sourceFileName}</p>
                      </div>
                      {run.blockerCount > 0 ? <Badge className="bg-red-50 text-red-700 border-red-200 text-[10px] px-1.5 py-0">{run.blockerCount} blockers</Badge> :
                       run.warningCount > 0 ? <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] px-1.5 py-0">{run.warningCount} warnings</Badge> :
                       <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0">Ready</Badge>}
                    </div>
                  ))}
                </div>
              </AdminQueryState>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Recent History</h4>
              <AdminQueryState
                isLoading={recentRunsLoading}
                error={recentRunsError}
                onRetry={retryRecentRuns}
                empty={recentRuns.length === 0}
                emptyTitle="No history yet"
                emptyDescription="Completed runs appear here."
                loadingLabel="Loading..."
              >
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                  {(recentAttentionRuns.length > 0 ? recentAttentionRuns : recentRuns.slice(0, 5)).map((run) => (
                    <div key={run.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/70 p-2 text-xs">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{run.projectName}</p>
                        <p className="text-[10px] text-muted-foreground">{new Date(run.uploadedAt).toLocaleDateString()} — {run.recordsSucceeded}/{run.recordsAttempted} rows</p>
                      </div>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${run.status === "COMMITTED" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : run.status === "FAILED" ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                        {run.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  ))}
                </div>
              </AdminQueryState>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SmartImportPage() {
  const [step, setStep] = useState(1);
  const [runId, setRunId] = useState<number | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [issues, setIssues] = useState<any[]>([]);
  const [loadingRun, setLoadingRun] = useState(false);
  const [runLoadError, setRunLoadError] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [cameFromBulk, setCameFromBulk] = useState(false);
  const pendingRunsQuery = useQuery<PendingRun[], Error>({
    queryKey: ["smart-import-pending-governance"],
    queryFn: async () => {
      const res = await fetch("/api/smart-import/pending-runs", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("The pending import queue could not be loaded.");
      return res.json();
    },
    refetchInterval: 30000,
  });
  const recentRunsQuery = useQuery<SmartImportRunHistoryItem[], Error>({
    queryKey: ["smart-import-run-history"],
    queryFn: async () => {
      const res = await fetch("/api/smart-import/runs", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Recent import history could not be loaded.");
      return res.json();
    },
    refetchInterval: 30000,
  });
  const pendingRuns = pendingRunsQuery.data ?? [];
  const recentRuns = recentRunsQuery.data ?? [];
  const recentCommittedRuns = recentRuns.filter((run) => run.status === "COMMITTED");
  const recentFailedRuns = recentRuns.filter((run) => run.status === "FAILED");
  const shellStatuses = [
    pendingRuns.length > 0
      ? { label: `${pendingRuns.length} runs awaiting review`, tone: "warning" as const }
      : { label: "Import queue clear", tone: "success" as const },
    { label: "Excel governance surfaced here", tone: "info" as const },
  ];

  const returnToBulkPanel = useCallback(() => {
    setCameFromBulk(false);
    setBulkMode(true);
    setStep(1);
    setRunId(null);
    setPreview(null);
    setIssues([]);
    setRunLoadError(null);
  }, []);

  const loadRunData = useCallback(async (id: number) => {
    setLoadingRun(true);
    setRunLoadError(null);
    try {
      const res = await fetch(`/api/smart-import/${id}`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data.preview) setPreview(data.preview);
        if (data.issues) setIssues(data.issues);
      } else {
        const err = await res.json().catch(() => ({ error: "Import details could not be loaded." }));
        setRunLoadError(err.error || "Import details could not be loaded.");
      }
    } catch {
      setRunLoadError("Import details could not be loaded.");
    } finally {
      setLoadingRun(false);
    }
  }, []);

  const handleUploaded = (newRunId: number, newPreview: any) => {
    setRunId(newRunId);
    setPreview(newPreview);
    setRunLoadError(null);
    setBulkMode(false);
    setCameFromBulk(false);
    setStep(2);
    loadRunData(newRunId);
  };

  const handleBatchUploaded = (results: FileUploadResult[]) => {
    const successful = results.filter(r => r.status === "success");
    if (successful.length === 1) {
      handleUploaded(successful[0].runId!, successful[0].preview);
    } else if (successful.length > 1) {
      setBulkMode(true);
    }
  };

  const handleSwitchToWizard = (wizardRunId: number) => {
    setBulkMode(false);
    setCameFromBulk(true);
    setRunId(wizardRunId);
    setStep(2);
    setIssues([]);
    setRunLoadError(null);
    loadRunData(wizardRunId);
  };

  return (
    <AdminPageShell
      surfaceId="smart-import"
      title="Smart Import"
      description="Govern Excel tracker intake, review unresolved issues, and commit reconciled project data with clear operational visibility."
      statuses={shellStatuses}
      metrics={[
        { label: "Pending Review", value: pendingRuns.length, helper: "Preview runs awaiting action" },
        { label: "Committed Runs", value: recentCommittedRuns.length, helper: "Recent successful imports" },
        { label: "Failed Runs", value: recentFailedRuns.length, helper: "Recent runs needing attention" },
        { label: "Last Run", value: recentRuns[0]?.uploadedAt ? new Date(recentRuns[0].uploadedAt).toLocaleDateString() : "No data", helper: "Most recent upload" },
      ]}
    >
    <div className="space-y-4 max-w-5xl" data-testid="smart-import-page">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-smart-import-title">Smart Import Wizard</h1>
        <p className="text-muted-foreground text-sm">Upload and review Excel tracker imports step by step</p>
      </div>

      <SmartImportGovernancePanel
        pendingRuns={pendingRuns}
        pendingRunsLoading={pendingRunsQuery.isLoading}
        pendingRunsError={pendingRunsQuery.error?.message || null}
        retryPendingRuns={() => { void pendingRunsQuery.refetch(); }}
        recentRuns={recentRuns}
        recentRunsLoading={recentRunsQuery.isLoading}
        recentRunsError={recentRunsQuery.error?.message || null}
        retryRecentRuns={() => { void recentRunsQuery.refetch(); }}
      />

      {!bulkMode && <StepIndicator currentStep={step} onStepClick={(s) => { if (s < step) setStep(s); }} />}

      {/* Contextual status line */}
      {!bulkMode && step > 1 && preview && !loadingRun && (
        <div className="flex items-center gap-2 -mt-4 mb-2 text-xs text-muted-foreground" data-testid="step-context">
          <Info className="w-3.5 h-3.5 shrink-0" />
          {step === 2 && (
            <span>
              {(preview?.detection?.sections || []).length} section(s) found
              {preview?.detection?.projectInfo?.name ? ` in "${preview.detection.projectInfo.name}"` : ""}
            </span>
          )}
          {step === 3 && (() => {
            const mappings = preview?.mappings || [];
            const totalMapped = mappings.reduce((sum: number, m: any) => sum + (m.mappings?.length || 0), 0);
            const totalUnmapped = mappings.reduce((sum: number, m: any) => sum + (m.unmappedHeaders?.length || 0), 0);
            const total = totalMapped + totalUnmapped;
            return <span>{totalMapped} of {total} columns mapped{total > 0 ? ` (${Math.round((totalMapped / total) * 100)}%)` : ""}</span>;
          })()}
          {step === 4 && (
            <span>
              {issues.filter(i => !i.resolved && !i.autoResolved).length} unresolved of {issues.length} total issues
            </span>
          )}
          {step === 5 && (() => {
            const n = preview?.normalization || {};
            const parts = [
              (n.planTasks?.length || 0) > 0 && `${n.planTasks.length} plan tasks`,
              (n.revenueLines?.length || 0) > 0 && `${n.revenueLines.length} revenue lines`,
              (n.costLines?.length || 0) > 0 && `${n.costLines.length} cost lines`,
            ].filter(Boolean);
            return <span>Ready to import: {parts.join(", ") || "no data"}</span>;
          })()}
        </div>
      )}

      {loadingRun && step > 1 && !bulkMode && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500 mr-2" />
          <span className="text-sm text-muted-foreground">Loading import data...</span>
        </div>
      )}

      {runLoadError && !loadingRun && !bulkMode && (
        <AdminQueryState
          isLoading={false}
          error={runLoadError}
          onRetry={runId ? () => { void loadRunData(runId); } : undefined}
        >
          <div />
        </AdminQueryState>
      )}

      {bulkMode ? (
        <BulkCommitPanel
          onBack={() => { setBulkMode(false); setStep(1); }}
          onSwitchToWizard={handleSwitchToWizard}
        />
      ) : (
        <>
          {cameFromBulk && step >= 2 && (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2" data-testid="back-to-bulk-banner">
              <Button
                variant="ghost"
                size="sm"
                className="text-blue-700 hover:text-blue-800 hover:bg-blue-100 h-7 px-2 text-xs font-medium"
                onClick={returnToBulkPanel}
                data-testid="btn-back-to-bulk"
              >
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                Back to Bulk Panel
              </Button>
              <span className="text-xs text-blue-600">Reviewing individual file — resolve issues then return to commit all</span>
            </div>
          )}

          {step === 1 && (
            <UploadStep onUploaded={handleUploaded} onBatchUploaded={handleBatchUploaded} />
          )}

          {step === 2 && preview && (
            <SectionDetectionStep
              preview={preview}
              runId={runId}
              onContinue={() => setStep(3)}
              onBack={() => setStep(1)}
              onProjectInfoUpdated={(updatedInfo) => {
                if (preview?.detection) {
                  setPreview({ ...preview, detection: { ...preview.detection, projectInfo: updatedInfo } });
                }
              }}
            />
          )}

          {step === 3 && runId && preview && (
            <ColumnMappingStep
              runId={runId}
              preview={preview}
              onContinue={() => setStep(4)}
              onBack={() => setStep(2)}
              onPreviewUpdate={setPreview}
            />
          )}

          {step === 4 && runId && (
            <IssuesStep
              runId={runId}
              issues={issues}
              normalization={preview?.normalization}
              onContinue={() => setStep(5)}
              onBack={() => setStep(3)}
              onIssuesUpdate={setIssues}
            />
          )}

          {step === 5 && runId && preview && (
            <PreviewCommitStep
              runId={runId}
              preview={preview}
              onBack={() => setStep(4)}
            />
          )}
        </>
      )}
    </div>
    </AdminPageShell>
  );
}
