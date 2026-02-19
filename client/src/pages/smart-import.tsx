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
          <div className="border rounded-lg divide-y max-h-48 overflow-y-auto" data-testid="file-list">
            {files.map((entry, idx) => (
              <div key={idx} className="flex items-center gap-2 px-3 py-2 text-sm" data-testid={`file-row-${idx}`}>
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
                {entry.status === "pending" && (
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

function SectionDetectionStep({
  preview,
  onContinue,
  onBack,
}: {
  preview: any;
  onContinue: () => void;
  onBack: () => void;
}) {
  const sections = preview?.sections || [];
  const unmatchedSheets = preview?.unmatchedSheets || [];
  const projectInfo = preview?.projectInfo || {};

  return (
    <div className="space-y-4" data-testid="section-detection-step">
      {projectInfo && (projectInfo.name || projectInfo.projectName) && (
        <Card className="bg-white rounded-xl shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Project Info</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
              <div>
                <span className="text-slate-500">Name</span>
                <p className="font-medium" data-testid="text-project-name">{projectInfo.name || projectInfo.projectName || "—"}</p>
              </div>
              <div>
                <span className="text-slate-500">Size</span>
                <p className="font-medium" data-testid="text-project-size">{projectInfo.sizeKwp || projectInfo.size || "—"}</p>
              </div>
              <div>
                <span className="text-slate-500">PD</span>
                <p className="font-medium" data-testid="text-project-pd">{projectInfo.pd || "—"}</p>
              </div>
              <div>
                <span className="text-slate-500">PM</span>
                <p className="font-medium" data-testid="text-project-pm">{projectInfo.pm || "—"}</p>
              </div>
              <div>
                <span className="text-slate-500">Phase</span>
                <p className="font-medium" data-testid="text-project-phase">{projectInfo.phase || "—"}</p>
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
  const sections = preview?.sections || [];
  const sectionNames = sections.map((s: any) => s.section || s.name).filter(Boolean);
  const [activeTab, setActiveTab] = useState(sectionNames[0] || "PLAN");
  const [saving, setSaving] = useState<string | null>(null);
  const { toast } = useToast();

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
        toast({ title: "Mapping Updated", description: `Column mapped to ${canonicalField}` });
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

  const hasMissingRequired = sections.some((s: any) => {
    const mappings = s.columnMappings || s.columns || [];
    const requiredFields = CANONICAL_FIELDS[s.section || s.name]?.slice(0, 3) || [];
    const mapped = mappings
      .filter((m: any) => m.canonicalField || m.mappedTo)
      .map((m: any) => m.canonicalField || m.mappedTo);
    return requiredFields.some((f: string) => !mapped.includes(f));
  });

  return (
    <div className="space-y-4" data-testid="column-mapping-step">
      {sectionNames.length > 0 ? (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList data-testid="mapping-tabs">
            {sectionNames.map((name: string) => (
              <TabsTrigger key={name} value={name} data-testid={`tab-${name}`}>
                {name}
              </TabsTrigger>
            ))}
          </TabsList>

          {sections.map((section: any) => {
            const sectionName = section.section || section.name;
            const mappings = section.columnMappings || section.columns || [];
            const fields = CANONICAL_FIELDS[sectionName] || [];
            const overallConfidence = section.mappingConfidence ?? section.confidence ?? null;
            const mapped = mappings.filter((m: any) => m.canonicalField || m.mappedTo);
            const unmapped = mappings.filter((m: any) => !(m.canonicalField || m.mappedTo));

            return (
              <TabsContent key={sectionName} value={sectionName}>
                <Card className="bg-white rounded-xl shadow-sm">
                  <CardContent className="p-4 space-y-3">
                    {overallConfidence != null && (
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs text-slate-500">Section Confidence:</span>
                        {confidenceBadge(overallConfidence)}
                      </div>
                    )}

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs" data-testid={`mapping-table-${sectionName}`}>
                        <thead>
                          <tr className="bg-slate-50 border-b">
                            <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase">Excel Header</th>
                            <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase">Mapped To</th>
                            <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase">Confidence</th>
                            <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mapped.map((col: any, idx: number) => {
                            const colIdx = col.colIndex ?? col.index ?? idx;
                            const isSaving = saving === `${sectionName}-${colIdx}`;
                            return (
                              <tr key={colIdx} className="border-b border-slate-100 hover:bg-slate-50/50">
                                <td className="px-3 py-2 font-medium" data-testid={`text-header-${sectionName}-${colIdx}`}>
                                  {col.excelHeader || col.header || col.rawHeader || `Column ${colIdx}`}
                                </td>
                                <td className="px-3 py-2">
                                  <Select
                                    value={col.canonicalField || col.mappedTo || ""}
                                    onValueChange={(val) => handleMappingChange(sectionName, colIdx, val)}
                                    data-testid={`select-mapping-${sectionName}-${colIdx}`}
                                  >
                                    <SelectTrigger className="h-7 text-xs w-[160px]" data-testid={`select-trigger-mapping-${sectionName}-${colIdx}`}>
                                      <SelectValue placeholder="Select field..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {fields.map((f) => (
                                        <SelectItem key={f} value={f} data-testid={`select-item-${sectionName}-${f}`}>
                                          {f}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="px-3 py-2">
                                  {col.confidence != null && confidenceBadge(col.confidence)}
                                </td>
                                <td className="px-3 py-2">
                                  {isSaving ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                                  ) : (
                                    <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] px-1.5 py-0">
                                      <Check className="w-3 h-3 mr-0.5" />
                                      Mapped
                                    </Badge>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {unmapped.length > 0 && (
                      <div className="mt-3">
                        <h4 className="text-xs font-semibold text-slate-500 mb-2">Unmapped Columns</h4>
                        <div className="space-y-2">
                          {unmapped.map((col: any, idx: number) => {
                            const colIdx = col.colIndex ?? col.index ?? (mapped.length + idx);
                            const isSaving = saving === `${sectionName}-${colIdx}`;
                            return (
                              <div
                                key={colIdx}
                                className="flex items-center gap-3 p-2 bg-amber-50 border border-amber-200 rounded-md"
                                data-testid={`unmapped-col-${sectionName}-${colIdx}`}
                              >
                                <span className="text-xs font-medium flex-1">
                                  {col.excelHeader || col.header || col.rawHeader || `Column ${colIdx}`}
                                </span>
                                <Select
                                  value=""
                                  onValueChange={(val) => {
                                    if (val === "__ignore__") return;
                                    handleMappingChange(sectionName, colIdx, val);
                                  }}
                                >
                                  <SelectTrigger className="h-7 text-xs w-[160px]" data-testid={`select-trigger-unmapped-${sectionName}-${colIdx}`}>
                                    <SelectValue placeholder="Map to..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__ignore__" data-testid={`select-item-ignore-${sectionName}-${colIdx}`}>
                                      Ignore
                                    </SelectItem>
                                    {fields.map((f) => (
                                      <SelectItem key={f} value={f}>
                                        {f}
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

function IssuesStep({
  runId,
  issues,
  onContinue,
  onBack,
  onIssuesUpdate,
}: {
  runId: number;
  issues: any[];
  onContinue: () => void;
  onBack: () => void;
  onIssuesUpdate: (issues: any[]) => void;
}) {
  const [resolving, setResolving] = useState<number | null>(null);
  const [cpName, setCpName] = useState("");
  const [cpType, setCpType] = useState("subcontractor");
  const [creatingCp, setCreatingCp] = useState<number | null>(null);
  const { toast } = useToast();

  const blockers = issues.filter((i) => i.severity === "BLOCKER" || i.severity === "blocker" || i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "WARNING" || i.severity === "warning" || i.severity === "warn");
  const infos = issues.filter((i) => i.severity === "INFO" || i.severity === "info");

  const unresolvedBlockers = blockers.filter((i) => !i.resolved);

  const handleResolve = async (issueId: number, resolved: boolean) => {
    setResolving(issueId);
    try {
      const res = await fetch(`/api/smart-import/${runId}/issue/${issueId}/resolve`, {
        method: "PATCH",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ resolved }),
      });
      if (res.ok) {
        onIssuesUpdate(issues.map((i) => (i.id === issueId ? { ...i, resolved } : i)));
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
        await handleResolve(issueId, true);
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
          const isCounterpartyIssue = issue.type === "counterparty" ||
            (issue.message || "").toLowerCase().includes("counterparty");
          return (
            <Card
              key={issue.id}
              className={`${bgClass} border ${borderClass} rounded-lg`}
              data-testid={`issue-card-${issue.id}`}
            >
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="text-xs font-medium" data-testid={`text-issue-msg-${issue.id}`}>
                      {issue.message}
                    </p>
                    {issue.suggestedAction && (
                      <p className="text-[10px] text-slate-500 mt-0.5" data-testid={`text-issue-action-${issue.id}`}>
                        Suggested: {issue.suggestedAction}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={issue.resolved ? "outline" : "default"}
                    className="h-7 text-xs"
                    disabled={resolving === issue.id}
                    onClick={() => handleResolve(issue.id, !issue.resolved)}
                    data-testid={`btn-resolve-${issue.id}`}
                  >
                    {resolving === issue.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : issue.resolved ? (
                      <>
                        <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-500" />
                        Resolved
                      </>
                    ) : (
                      "Resolve"
                    )}
                  </Button>
                </div>

                {isCounterpartyIssue && !issue.resolved && (
                  <div className="flex items-end gap-2 pt-1 border-t border-slate-200">
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
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-4" data-testid="issues-step">
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
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const sections = preview?.sections || [];
  const planSection = sections.find((s: any) => (s.section || s.name) === "PLAN");
  const revenueSection = sections.find((s: any) => (s.section || s.name) === "REVENUE");
  const expenditureSection = sections.find((s: any) => (s.section || s.name) === "EXPENDITURE");

  const planRows = planSection?.sampleRows || planSection?.previewRows || planSection?.rows || [];
  const revenueRows = revenueSection?.sampleRows || revenueSection?.previewRows || revenueSection?.rows || [];
  const costRows = expenditureSection?.sampleRows || expenditureSection?.previewRows || expenditureSection?.rows || [];

  const summary = preview?.summary || {};

  const handleCommit = async () => {
    setCommitting(true);
    try {
      const res = await fetch(`/api/smart-import/${runId}/commit`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        setCommitted(true);
        setCommitResult(data);
        toast({ title: "Import Committed!", description: "Data has been imported successfully" });
      } else {
        const err = await res.json().catch(() => ({ error: "Commit failed" }));
        toast({ title: "Error", description: err.error || "Commit failed", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    } finally {
      setCommitting(false);
    }
  };

  const toggleTable = (key: string) => {
    setExpandedTables((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (committed) {
    const projectName = preview?.projectInfo?.name || preview?.projectInfo?.projectName || "";
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
                {summary.planTasks ?? planSection?.dataRows ?? planRows.length ?? 0}
              </div>
              <div className="text-[10px] text-slate-500">Plan Tasks</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold" data-testid="text-revenue-count">
                {summary.revenueLines ?? revenueSection?.dataRows ?? revenueRows.length ?? 0}
              </div>
              <div className="text-[10px] text-slate-500">Revenue Lines</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold" data-testid="text-cost-count">
                {summary.costLines ?? expenditureSection?.dataRows ?? costRows.length ?? 0}
              </div>
              <div className="text-[10px] text-slate-500">Cost Lines</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold" data-testid="text-phase-count">
                {summary.executionPhases ?? 0}
              </div>
              <div className="text-[10px] text-slate-500">Execution Phases</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold" data-testid="text-cp-count">
                {summary.counterparties ?? 0}
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
                        <td className="px-3 py-1.5">{row.task_name || row.taskName || row[0] || "—"}</td>
                        <td className="px-3 py-1.5">{row.start_date || row.startDate || row[1] || "—"}</td>
                        <td className="px-3 py-1.5">{row.end_date || row.endDate || row[2] || "—"}</td>
                        <td className="px-3 py-1.5">{row.status || row[3] || "—"}</td>
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
                        <td className="px-3 py-1.5">{row.milestone_name || row.milestoneName || row[0] || "—"}</td>
                        <td className="px-3 py-1.5">{row.amount || row[1] || "—"}</td>
                        <td className="px-3 py-1.5">{row.status || row[2] || "—"}</td>
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
                        <td className="px-3 py-1.5">{row.category || row[0] || "—"}</td>
                        <td className="px-3 py-1.5">{row.counterparty || row[1] || "—"}</td>
                        <td className="px-3 py-1.5">{row.amount || row[2] || "—"}</td>
                        <td className="px-3 py-1.5">{row.status || row[3] || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          )}
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

export default function SmartImportPage() {
  const [step, setStep] = useState(1);
  const [runId, setRunId] = useState<number | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [issues, setIssues] = useState<any[]>([]);
  const [loadingRun, setLoadingRun] = useState(false);
  const [batchResults, setBatchResults] = useState<FileUploadResult[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [batchIndex, setBatchIndex] = useState(0);

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
    setBatchMode(false);
    setStep(2);
    loadRunData(newRunId);
  };

  const handleBatchUploaded = (results: FileUploadResult[]) => {
    const successful = results.filter(r => r.status === "success");
    setBatchResults(successful);
    if (successful.length === 1) {
      handleUploaded(successful[0].runId!, successful[0].preview);
    } else if (successful.length > 1) {
      setBatchMode(true);
      setBatchIndex(0);
      setRunId(successful[0].runId!);
      setPreview(successful[0].preview);
      setStep(2);
      loadRunData(successful[0].runId!);
    }
  };

  const handleBatchNav = (idx: number) => {
    const entry = batchResults[idx];
    if (entry) {
      setBatchIndex(idx);
      setRunId(entry.runId!);
      setPreview(entry.preview);
      setStep(2);
      setIssues([]);
      loadRunData(entry.runId!);
    }
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto" data-testid="smart-import-page">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-smart-import-title">Smart Import Wizard</h1>
        <p className="text-muted-foreground text-sm">Upload and review Excel tracker imports step by step</p>
      </div>

      <StepIndicator currentStep={step} />

      {batchMode && step >= 2 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3" data-testid="batch-nav">
          <div className="flex items-center gap-2 mb-2">
            <FileSpreadsheet className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-medium text-blue-700">
              Reviewing file {batchIndex + 1} of {batchResults.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {batchResults.map((entry, idx) => (
              <Button
                key={idx}
                variant={idx === batchIndex ? "default" : "outline"}
                size="sm"
                className={`text-xs ${idx === batchIndex ? "" : "border-blue-300 hover:bg-blue-100"}`}
                data-testid={`btn-batch-file-${idx}`}
                onClick={() => handleBatchNav(idx)}
              >
                {entry.file.name.replace(/\.(xlsx|xlsm)$/i, "")}
              </Button>
            ))}
          </div>
        </div>
      )}

      {loadingRun && step > 1 && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500 mr-2" />
          <span className="text-sm text-slate-500">Loading import data...</span>
        </div>
      )}

      {step === 1 && (
        <UploadStep onUploaded={handleUploaded} onBatchUploaded={handleBatchUploaded} />
      )}

      {step === 2 && preview && (
        <SectionDetectionStep
          preview={preview}
          onContinue={() => setStep(3)}
          onBack={() => setStep(1)}
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
    </div>
  );
}