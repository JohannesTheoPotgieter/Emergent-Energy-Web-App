import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertCircle, AlertTriangle,
  Info, ArrowRight, ArrowLeft, Loader2, X, Check, ChevronDown, ChevronUp,
  Pencil, History, Zap, SkipForward,
} from "lucide-react";
import { useLocation } from "wouter";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("company_role_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

const STEP_LABELS = ["Upload", "Sections", "Mapping", "Issues", "Commit"];

const CANONICAL_FIELDS: Record<string, string[]> = {
  PLAN: [
    "task_name", "task_no", "start_date", "end_date", "duration",
    "pct_complete", "expected_pct", "owner", "phase",
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

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center gap-1 mb-6" data-testid="step-indicator">
      {STEP_LABELS.map((label, idx) => {
        const stepNum = idx + 1;
        const isActive = stepNum === currentStep;
        const isComplete = stepNum < currentStep;
        return (
          <div key={label} className="flex items-center gap-1">
            {idx > 0 && (
              <div className={`h-0.5 w-4 md:w-8 ${isComplete ? "bg-blue-500" : "bg-slate-200"}`} />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                  isActive ? "bg-blue-600 text-white" :
                  isComplete ? "bg-blue-500 text-white" :
                  "bg-slate-200 text-slate-500"
                }`}
                data-testid={`step-circle-${stepNum}`}
              >
                {isComplete ? <Check className="w-3.5 h-3.5" /> : stepNum}
              </div>
              <span className={`text-xs hidden md:inline ${isActive ? "font-semibold text-blue-700" : "text-slate-500"}`}>
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
    <Card className="bg-white rounded-xl shadow-sm" data-testid="upload-step">
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
            "border-slate-300 hover:border-blue-400 hover:bg-blue-50/50"
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
              <p className="text-xs text-slate-500">
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
              <Upload className="w-10 h-10 text-slate-400" />
              <p className="text-sm text-slate-600">Drag & drop Excel trackers here</p>
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
              <p className="text-xs text-slate-400">.xlsx and .xlsm files supported</p>
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
                    "text-slate-400"
                  }`} />
                  <span className="flex-1 truncate">{entry.file.name}</span>
                  <span className="text-xs text-slate-400 flex-shrink-0">
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
            <div className="flex justify-between text-xs text-slate-500">
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
        <span className="text-slate-500 text-xs">{label}</span>
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
            <X className="w-3.5 h-3.5 text-slate-400" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group">
      <span className="text-slate-500 text-xs">{label}</span>
      <div className="flex items-center gap-1">
        <p className="font-medium text-xs" data-testid={testId}>{formatDisplay()}</p>
        <button
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => { setDraft(value || ""); setEditing(true); }}
          data-testid={`btn-edit-${testId}`}
        >
          <Pencil className="w-3 h-3 text-slate-400 hover:text-blue-500" />
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
  const hasProjectInfo = true;
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
      } catch {}
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
        <Card className="bg-white rounded-xl shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Project Info (from sheet header)</CardTitle>
              <span className="text-[10px] text-slate-400">Hover to edit</span>
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
              <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide mb-1.5">Key Dates</p>
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
          <Card key={idx} className="bg-white rounded-xl shadow-sm" data-testid={`card-section-${section.section || section.name || idx}`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm">{section.section || section.name}</span>
                {section.confidence != null && confidenceBadge(section.confidence)}
              </div>
              <div className="space-y-1 text-xs text-slate-600">
                {section.sheetName && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Sheet</span>
                    <span data-testid={`text-sheet-${idx}`}>{section.sheetName}</span>
                  </div>
                )}
                {section.headerRow != null && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Header Row</span>
                    <span data-testid={`text-header-row-${idx}`}>{section.headerRow}</span>
                  </div>
                )}
                {section.dataRows != null && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Data Rows</span>
                    <span data-testid={`text-data-rows-${idx}`}>{section.dataRows}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {unmatchedSheets.length > 0 && (
        <Card className="bg-white rounded-xl shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-600">Unmatched Sheets</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs text-slate-500">
              {unmatchedSheets.map((sheet: any, idx: number) => (
                <li key={idx} className="flex items-center gap-2" data-testid={`unmatched-sheet-${idx}`}>
                  <X className="w-3 h-3 text-slate-400" />
                  <span className="font-medium">{typeof sheet === "string" ? sheet : sheet.name || sheet.sheetName}</span>
                  {sheet.reason && <span className="text-slate-400">— {sheet.reason}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {sections.length === 0 && (
        <Card className="bg-white rounded-xl shadow-sm">
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
  pct_complete: "% Complete", expected_pct: "Expected %", owner: "Owner", phase: "Phase", comment: "Comment",
  milestone_name: "Milestone", milestone_no: "Milestone #", percent: "Percent", amount_ex_vat: "Amount (ex VAT)",
  vat: "VAT", invoice_number: "Invoice #", invoice_date: "Invoice Date", planned_payment_date: "Planned Payment",
  payment_received_date: "Payment Received", in_bank_date: "In Bank Date", requirements: "Requirements", documents: "Documents",
  cost_category: "Cost Category", description: "Description", counterparty: "Counterparty", budget_qty: "Budget Qty",
  budget_rate: "Budget Rate", budget_total: "Budget Total", actual_total: "Actual Total", po_number: "PO #",
  approved_date: "Approved Date", payment_date: "Payment Date", forecast_payment_date: "Forecast Payment",
  budget_cos: "Budget COS", actual_cos: "Actual COS",
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
  const detectedSections = preview?.detection?.sections || [];
  const mappingResults = preview?.mappings || [];
  const normalization = preview?.normalization || {};

  const sectionNames = detectedSections.map((s: any) => s.section).filter(Boolean);
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
                <Card className="bg-white rounded-xl shadow-sm">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {overallConfidence != null && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-slate-500">Confidence:</span>
                            {confidenceBadge(overallConfidence)}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-slate-500">Sheet:</span>
                          <span className="text-xs font-medium">{detection?.sheetName || "—"}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-slate-500">Rows:</span>
                          <span className="text-xs font-medium">
                            {detection ? (detection.dataEndRowIndex - detection.dataStartRowIndex + 1) : 0}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-400">Destination:</span>
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
                          <tr className="bg-slate-50 border-b">
                            <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase">Excel Column</th>
                            <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase">Maps To Field</th>
                            <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase">Match</th>
                            <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase">Confidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allMappings.map((col: any) => {
                            const colIdx = col.colIndex;
                            const isSaving = saving === `${sectionName}-${colIdx}`;
                            return (
                              <tr key={colIdx} className="border-b border-slate-100 hover:bg-slate-50/50">
                                <td className="px-3 py-2 font-medium" data-testid={`text-header-${sectionName}-${colIdx}`}>
                                  {col.rawHeader}
                                </td>
                                <td className="px-3 py-2">
                                  <Select
                                    value={col.canonicalField || ""}
                                    onValueChange={(val) => handleMappingChange(sectionName, colIdx, val)}
                                  >
                                    <SelectTrigger className="h-7 text-xs w-[180px]" data-testid={`select-mapping-${sectionName}-${colIdx}`}>
                                      <SelectValue placeholder="Select field...">
                                        {col.canonicalField ? (FIELD_LABELS[col.canonicalField] || col.canonicalField) : "Select field..."}
                                      </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                      {fields.map((f) => (
                                        <SelectItem key={f} value={f}>
                                          {FIELD_LABELS[f] || f}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
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
                        <h4 className="text-xs font-semibold text-slate-500 mb-2">
                          Unmapped Columns ({unmappedHeaders.length})
                        </h4>
                        <div className="space-y-1.5">
                          {unmappedHeaders.map((col: any) => {
                            const colIdx = col.colIndex;
                            const isSaving = saving === `${sectionName}-${colIdx}`;
                            return (
                              <div
                                key={colIdx}
                                className="flex items-center gap-3 p-2 bg-slate-50 border border-slate-200 rounded-md"
                                data-testid={`unmapped-col-${sectionName}-${colIdx}`}
                              >
                                <span className="text-xs font-medium flex-1 text-slate-600">
                                  {col.rawHeader}
                                </span>
                                <Select
                                  value=""
                                  onValueChange={(val) => {
                                    if (val === "__ignore__") return;
                                    handleMappingChange(sectionName, colIdx, val);
                                  }}
                                >
                                  <SelectTrigger className="h-7 text-xs w-[180px]" data-testid={`select-unmapped-${sectionName}-${colIdx}`}>
                                    <SelectValue placeholder="Map to..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__ignore__">
                                      — Ignore —
                                    </SelectItem>
                                    {fields.map((f) => (
                                      <SelectItem key={f} value={f}>
                                        {FIELD_LABELS[f] || f}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
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
                                {Object.keys(previewData[0] || {}).filter(k => !["sourceSheet", "sourceRow"].includes(k)).slice(0, 8).map(key => (
                                  <th key={key} className="text-left px-2 py-1.5 text-[10px] font-semibold text-blue-600 uppercase whitespace-nowrap">
                                    {FIELD_LABELS[key] || key.replace(/([A-Z])/g, " $1").trim()}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {previewData.slice(0, 8).map((row: any, idx: number) => (
                                <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50/50">
                                  <td className="px-2 py-1 text-slate-400">{row.sourceRow || idx + 1}</td>
                                  {Object.entries(row).filter(([k]) => !["sourceSheet", "sourceRow"].includes(k)).slice(0, 8).map(([key, val]) => (
                                    <td key={key} className="px-2 py-1 max-w-[120px] truncate" title={String(val ?? "")}>
                                      {val != null ? String(val) : <span className="text-slate-300">—</span>}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {previewData.length > 8 && (
                            <div className="text-center py-1.5 text-[10px] text-slate-400 bg-slate-50">
                              ... and {previewData.length - 8} more rows
                            </div>
                          )}
                        </div>
                      )}

                      {showPreview[sectionName] && previewData.length === 0 && (
                        <p className="mt-2 text-xs text-slate-400">No data rows extracted for this section.</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            );
          })}
        </Tabs>
      ) : (
        <Card className="bg-white rounded-xl shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-2">
            <Info className="w-8 h-8 text-slate-400" />
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

function IssueRowDetail({ issue, normalization }: { issue: any; normalization: any }) {
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
    if (rows.length === 0) return <p className="text-[10px] text-slate-500 italic">No matching rows found in preview data.</p>;

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
        <p className="text-[10px] font-medium text-slate-600 mb-1">Matching rows with invoice "{payload.invoiceNumber}":</p>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="bg-slate-100">
                <th className="px-2 py-1 text-left border border-slate-200 font-medium text-slate-600">Row</th>
                {fields.map(f => (
                  <th key={f.key} className="px-2 py-1 text-left border border-slate-200 font-medium text-slate-600">{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, idx: number) => (
                <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                  <td className="px-2 py-1 border border-slate-200 font-mono">{r.sourceRow}</td>
                  {fields.map(f => (
                    <td key={f.key} className={`px-2 py-1 border border-slate-200 ${f.key === "invoiceNumber" ? "font-semibold text-amber-700 bg-amber-50" : ""}`}>
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
    if (!rowData) return <p className="text-[10px] text-slate-500 italic">Row {row}: No matching data in preview.</p>;

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
        <p className="text-[10px] font-medium text-slate-600 mb-1">Row {row} details:</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 bg-white rounded border border-slate-200 p-2">
          {fields.map(f => (
            <div key={f.key}>
              <span className="text-[9px] text-slate-400 uppercase">{f.label}</span>
              <p className={`text-[11px] ${(f as any).highlight ? "font-semibold text-red-600 bg-red-50 px-1 rounded" : "text-slate-700"}`}>
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
    if (row) return <p className="text-[10px] text-slate-500 italic">Row {row}: No matching data in preview.</p>;
    return null;
  }

  const allFields = Object.entries(rowData).filter(([k]) => !["sourceSheet", "sourceRow"].includes(k));
  return (
    <div className="mt-2">
      <p className="text-[10px] font-medium text-slate-600 mb-1">Row {row} details:</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 bg-white rounded border border-slate-200 p-2">
        {allFields.map(([key, val]) => (
          <div key={key}>
            <span className="text-[9px] text-slate-400 uppercase">{key.replace(/([A-Z])/g, " $1").trim()}</span>
            <p className="text-[11px] text-slate-700">{val != null ? String(val) : "—"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  const [cpName, setCpName] = useState("");
  const [cpType, setCpType] = useState("subcontractor");
  const [creatingCp, setCreatingCp] = useState<number | null>(null);
  const [applyingPrior, setApplyingPrior] = useState(false);
  const [editingOverride, setEditingOverride] = useState<number | null>(null);
  const [overrideFields, setOverrideFields] = useState<Record<string, string>>({});
  const { toast } = useToast();

  const issuesWithPriorRules = issues.filter((i: any) => i.matchedRuleId && !i.resolved && !i.autoResolved);
  const autoResolvedCount = issues.filter((i: any) => i.autoResolved).length;

  const blockers = issues.filter((i) => i.severity === "BLOCKER" || i.severity === "blocker" || i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "WARNING" || i.severity === "warning" || i.severity === "warn");
  const infos = issues.filter((i) => i.severity === "INFO" || i.severity === "info");

  const unresolvedBlockers = blockers.filter((i) => !i.resolved);

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

  const handleCreateCounterparty = async (issueId: number) => {
    if (!cpName.trim()) return;
    setCreatingCp(issueId);
    try {
      const res = await fetch("/api/counterparties", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ nameCanonical: cpName.trim(), typeDefault: cpType, isCore: false }),
      });
      if (res.ok) {
        toast({ title: "Counterparty Created", description: `${cpName} added` });
        setCpName("");
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
                    <ChevronDown className={`w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
                    <div className="flex-1">
                      <p className="text-xs font-medium" data-testid={`text-issue-msg-${issue.id}`}>
                        {issue.message}
                      </p>
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
                        <p className="text-[10px] text-slate-500 mt-0.5" data-testid={`text-issue-action-${issue.id}`}>
                          Suggested: {issue.suggestedAction}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {issue.resolved ? (
                      <div className="flex items-center gap-1">
                        <Badge variant="outline" className={`text-[10px] h-5 ${
                          issue.resolution === "IGNORED" ? "border-slate-300 text-slate-600 bg-slate-50" :
                          issue.resolution === "OVERRIDE" ? "border-blue-300 text-blue-600 bg-blue-50" :
                          "border-emerald-300 text-emerald-600 bg-emerald-50"
                        }`}>
                          {issue.resolution === "IGNORED" ? "Ignored" : issue.resolution === "OVERRIDE" ? "Overridden" : "Accepted"}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-slate-400 hover:text-slate-600"
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
                          className="h-6 text-[10px] px-2 border-slate-300 text-slate-600 hover:bg-slate-50"
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
                  <div className="mt-2 pt-2 border-t border-slate-200">
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
                      <div className="flex items-end gap-2 pt-2 mt-2 border-t border-slate-200">
                        <div className="flex-1">
                          <Label className="text-[10px]">Name</Label>
                          <Input
                            className="h-7 text-xs"
                            value={cpName}
                            onChange={(e) => setCpName(e.target.value)}
                            placeholder="Counterparty name..."
                            data-testid={`input-cp-name-${issue.id}`}
                          />
                        </div>
                        <div className="w-[140px]">
                          <Label className="text-[10px]">Type</Label>
                          <Select value={cpType} onValueChange={setCpType}>
                            <SelectTrigger className="h-7 text-xs" data-testid={`select-trigger-cp-type-${issue.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="subcontractor">Subcontractor</SelectItem>
                              <SelectItem value="supplier">Supplier</SelectItem>
                              <SelectItem value="consultant">Consultant</SelectItem>
                              <SelectItem value="client">Client</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          disabled={!cpName.trim() || creatingCp === issue.id}
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

      {issues.length === 0 ? (
        <Card className="bg-white rounded-xl shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            <p className="text-sm text-muted-foreground">No issues detected — looking good!</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {renderIssueGroup(
            "Blockers",
            blockers,
            <AlertCircle className="w-4 h-4 text-red-500" />,
            "bg-red-50/50",
            "border-red-200",
          )}
          {renderIssueGroup(
            "Warnings",
            warnings,
            <AlertTriangle className="w-4 h-4 text-amber-500" />,
            "bg-amber-50/50",
            "border-amber-200",
          )}
          {renderIssueGroup(
            "Info",
            infos,
            <Info className="w-4 h-4 text-blue-500" />,
            "bg-blue-50/50",
            "border-blue-200",
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
    <Card className="bg-white rounded-xl shadow-sm mt-4" data-testid="invoice-classification-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileSpreadsheet className="w-4 h-4 text-purple-600" />
          Invoice Pattern Classification
          {classified && (
            <span className="text-[10px] font-normal text-slate-500 ml-2">
              {autoApplied.length} auto-classified, {needsReview.length} need review, {unresolved.length} unresolved
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!classified ? (
          <div className="text-center py-4">
            <p className="text-sm text-slate-600 mb-3">
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
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left px-3 py-2 font-medium text-slate-600">Row</th>
                      <th className="text-left px-3 py-2 font-medium text-slate-600">Invoice #</th>
                      <th className="text-left px-3 py-2 font-medium text-slate-600">Suggested Type</th>
                      <th className="text-left px-3 py-2 font-medium text-slate-600">Confidence</th>
                      <th className="text-left px-3 py-2 font-medium text-slate-600">Pattern</th>
                      <th className="text-left px-3 py-2 font-medium text-slate-600">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...needsReview, ...unresolved].map((cl) => (
                      <tr key={cl.sourceRow} className="border-b border-slate-100 hover:bg-slate-50" data-testid={`classify-row-${cl.sourceRow}`}>
                        <td className="px-3 py-2 font-mono text-slate-500">{cl.sourceRow}</td>
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
                        <td className="px-3 py-2 text-slate-500 text-[10px]">{cl.patternInfo || "—"}</td>
                        <td className="px-3 py-2">
                          {reviewing === cl.sourceRow ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : cl.outcome === "UNRESOLVED" ? (
                            <div className="flex gap-1 items-center">
                              {cl.confidenceScore >= 50 && (
                                <Button size="sm" variant="outline" className="h-6 text-[10px] px-2"
                                  onClick={() => handleReview(cl.sourceRow, "confirm")}
                                  data-testid={`btn-confirm-${cl.sourceRow}`}>
                                  Confirm
                                </Button>
                              )}
                              <Select value={getRowOverride(cl.sourceRow).type} onValueChange={(v) => setRowOverride(cl.sourceRow, "type", v)}>
                                <SelectTrigger className="h-6 text-[10px] w-24" data-testid={`select-type-${cl.sourceRow}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="INSTALLER">Installer</SelectItem>
                                  <SelectItem value="SUPPLIER">Supplier</SelectItem>
                                  <SelectItem value="OTHER">Other</SelectItem>
                                </SelectContent>
                              </Select>
                              <Input
                                placeholder="Reason..."
                                className="h-6 text-[10px] w-28"
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
              <label className="flex items-center gap-2 text-xs text-slate-600">
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
  const [manualEditsWarning, setManualEditsWarning] = useState<{ message: string; count: number } | null>(null);
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
        toast({ title: "Import Committed!", description: "Data has been imported successfully" });
      } else {
        const err = await res.json().catch(() => ({ error: "Commit failed" }));
        if (err.error === "manual_edits_warning") {
          setManualEditsWarning({ message: err.message, count: err.manualEditCount });
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

  const toggleTable = (key: string) => {
    setExpandedTables((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (committed) {
    const projectName = preview?.detection?.projectInfo?.name || preview?.detection?.projectInfo?.projectName || preview?.projectInfo?.name || "";
    return (
      <Card className="bg-white rounded-xl shadow-sm" data-testid="commit-success">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-600" />
          </div>
          <h3 className="text-lg font-semibold text-emerald-700">Import Successful!</h3>
          {commitResult && (
            <div className="text-center text-sm text-slate-600 space-y-1">
              {commitResult.planTasks != null && <p>{commitResult.planTasks} plan tasks imported</p>}
              {commitResult.revenueLines != null && <p>{commitResult.revenueLines} revenue lines imported</p>}
              {commitResult.costLines != null && <p>{commitResult.costLines} cost lines imported</p>}
              {commitResult.executionPhases != null && <p>{commitResult.executionPhases} execution phases</p>}
              {commitResult.counterparties != null && <p>{commitResult.counterparties} new counterparties</p>}
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
      <Card className="bg-white rounded-xl shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Import Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold" data-testid="text-plan-count">
                {planRows.length}
              </div>
              <div className="text-[10px] text-slate-500">Plan Tasks</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold" data-testid="text-revenue-count">
                {revenueRows.length}
              </div>
              <div className="text-[10px] text-slate-500">Revenue Lines</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold" data-testid="text-cost-count">
                {costRows.length}
              </div>
              <div className="text-[10px] text-slate-500">Cost Lines</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold" data-testid="text-phase-count">
                {executionPhases.length}
              </div>
              <div className="text-[10px] text-slate-500">Execution Phases</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold" data-testid="text-cp-count">
                {counterpartyNames.length}
              </div>
              <div className="text-[10px] text-slate-500">New Counterparties</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {planRows.length > 0 && (
        <Card className="bg-white rounded-xl shadow-sm">
          <CardHeader
            className="pb-2 cursor-pointer flex flex-row items-center justify-between"
            onClick={() => toggleTable("plan")}
            data-testid="toggle-plan-preview"
          >
            <CardTitle className="text-sm">Plan Tasks Preview</CardTitle>
            {expandedTables["plan"] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </CardHeader>
          {expandedTables["plan"] && (
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs" data-testid="table-plan-preview">
                  <thead>
                    <tr className="bg-slate-50 border-b">
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">Task Name</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">Start Date</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">End Date</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {planRows.slice(0, 10).map((row: any, idx: number) => (
                      <tr key={idx} className="border-b border-slate-100">
                        <td className="px-3 py-1.5">{row.taskName || row.task_name || "—"}</td>
                        <td className="px-3 py-1.5">{row.startDate || row.start_date || "—"}</td>
                        <td className="px-3 py-1.5">{row.endDate || row.end_date || "—"}</td>
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

      {revenueRows.length > 0 && (
        <Card className="bg-white rounded-xl shadow-sm">
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
                    <tr className="bg-slate-50 border-b">
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">Milestone</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">Amount</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenueRows.slice(0, 10).map((row: any, idx: number) => (
                      <tr key={idx} className="border-b border-slate-100">
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
        <Card className="bg-white rounded-xl shadow-sm">
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
                    <tr className="bg-slate-50 border-b">
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">Category</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">Counterparty</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">Amount</th>
                      <th className="text-left px-3 py-1.5 text-[10px] font-semibold text-slate-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costRows.slice(0, 10).map((row: any, idx: number) => (
                      <tr key={idx} className="border-b border-slate-100">
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

      {manualEditsWarning && (
        <Card className="border-amber-300 bg-amber-50" data-testid="manual-edits-warning">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1 space-y-2">
                <p className="text-sm font-medium text-amber-800">{manualEditsWarning.message}</p>
                <p className="text-xs text-amber-600">Proceeding will overwrite these manual changes. You can review them in the Change Audit first.</p>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setManualEditsWarning(null)}
                    data-testid="btn-cancel-overwrite"
                  >
                    Cancel
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
                </div>
              </div>
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

function BulkCommitPanel({ onBack, onSwitchToWizard }: {
  onBack: () => void;
  onSwitchToWizard: (runId: number) => void;
}) {
  const [pendingRuns, setPendingRuns] = useState<PendingRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [commitDone, setCommitDone] = useState(false);
  const [commitResults, setCommitResults] = useState<BulkCommitResult[]>([]);
  const [progress, setProgress] = useState(0);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const loadPendingRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/smart-import/pending-runs", { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setPendingRuns(data);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPendingRuns(); }, [loadPendingRuns]);

  const committableRuns = pendingRuns.filter(r => r.blockerCount === 0);
  const blockedRuns = pendingRuns.filter(r => r.blockerCount > 0);

  const handleBulkCommit = async () => {
    if (committableRuns.length === 0) return;
    setCommitting(true);
    setProgress(0);

    const progressInterval = setInterval(() => {
      setProgress(prev => Math.min(prev + 2, 95));
    }, 500);

    try {
      const res = await fetch("/api/smart-import/bulk-commit", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          runIds: committableRuns.map(r => r.id),
          acknowledgeManualEdits: true,
          forceCommit: true,
        }),
      });
      clearInterval(progressInterval);
      setProgress(100);

      if (res.ok) {
        const data = await res.json();
        setCommitDone(true);
        setCommitResults(data.results || []);
        toast({
          title: "Bulk Commit Complete",
          description: `${data.committed} committed, ${data.skipped || 0} skipped, ${data.failed || 0} failed`,
        });
      } else {
        const err = await res.json().catch(() => ({ error: "Bulk commit failed" }));
        toast({ title: "Error", description: err.error || "Bulk commit failed", variant: "destructive" });
      }
    } catch {
      clearInterval(progressInterval);
      toast({ title: "Error", description: "Network error during bulk commit", variant: "destructive" });
    } finally {
      setCommitting(false);
    }
  };

  if (loading) {
    return (
      <Card className="bg-white rounded-xl shadow-sm">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500 mr-2" />
          <span className="text-sm text-slate-500">Loading pending imports...</span>
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
        <Card className="bg-white rounded-xl shadow-sm">
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
          <Card className="bg-white rounded-xl shadow-sm">
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
                      <span className="text-xs text-slate-500">
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
      <Card className="bg-white rounded-xl shadow-sm" data-testid="no-pending-runs">
        <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
          <CheckCircle2 className="w-10 h-10 text-slate-300" />
          <p className="text-sm text-slate-500">No pending imports to commit</p>
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
      <Card className="bg-white rounded-xl shadow-sm">
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
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors"
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
                  <p className="text-[10px] text-slate-400 truncate">{run.sourceFileName}</p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {run.totalIssues > 0 && (
                    <span className="text-[10px] text-slate-400">
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
          <div className="flex justify-between text-xs text-slate-500">
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
              Committing {committableRuns.length} files...
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
            <div>
              <p className="text-sm font-medium text-amber-800">
                {blockedRuns.length} file{blockedRuns.length > 1 ? "s have" : " has"} unresolved blockers
              </p>
              <p className="text-xs text-amber-600 mt-0.5">
                Click "Review" on those files to resolve issues before committing.
                Non-blocker warnings will be auto-resolved during bulk commit.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SmartImportPage() {
  const [step, setStep] = useState(1);
  const [runId, setRunId] = useState<number | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [issues, setIssues] = useState<any[]>([]);
  const [loadingRun, setLoadingRun] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [cameFromBulk, setCameFromBulk] = useState(false);

  const returnToBulkPanel = useCallback(() => {
    setCameFromBulk(false);
    setBulkMode(true);
    setStep(1);
    setRunId(null);
    setPreview(null);
    setIssues([]);
  }, []);

  const loadRunData = useCallback(async (id: number) => {
    setLoadingRun(true);
    try {
      const res = await fetch(`/api/smart-import/${id}`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data.preview) setPreview(data.preview);
        if (data.issues) setIssues(data.issues);
      }
    } catch {
    } finally {
      setLoadingRun(false);
    }
  }, []);

  const handleUploaded = (newRunId: number, newPreview: any) => {
    setRunId(newRunId);
    setPreview(newPreview);
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
    loadRunData(wizardRunId);
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto" data-testid="smart-import-page">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-smart-import-title">Smart Import Wizard</h1>
        <p className="text-muted-foreground text-sm">Upload and review Excel tracker imports step by step</p>
      </div>

      {!bulkMode && <StepIndicator currentStep={step} />}

      {loadingRun && step > 1 && !bulkMode && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500 mr-2" />
          <span className="text-sm text-slate-500">Loading import data...</span>
        </div>
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
  );
}