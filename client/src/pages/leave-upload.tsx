import { useState, useRef, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Upload, Download, FileSpreadsheet, CheckCircle, AlertTriangle, X, File, Loader2 } from "lucide-react";

interface UploadResult {
  total: number;
  new: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

const ACCEPTED_EXTENSIONS = [".csv", ".xlsx", ".xls"];
const ACCEPTED_MIME_TYPES = [
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

export default function LeaveUploadPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  const isValidFile = (file: File) => {
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    return ACCEPTED_EXTENSIONS.includes(ext) || ACCEPTED_MIME_TYPES.includes(file.type);
  };

  const handleFileSelect = useCallback((file: File) => {
    if (!isValidFile(file)) {
      toast({
        title: "Invalid file type",
        description: "Please upload a .csv, .xlsx, or .xls file.",
        variant: "destructive",
      });
      return;
    }
    setSelectedFile(file);
    setUploadResult(null);
  }, [toast]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const clearFile = useCallback(() => {
    setSelectedFile(null);
    setUploadResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error("No file selected");
      const formData = new FormData();
      formData.append("file", selectedFile);
      const res = await fetch("/api/admin/leave/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message || "Upload failed");
      }
      return res.json() as Promise<UploadResult>;
    },
    onSuccess: (result) => {
      setUploadResult(result);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/leave"] });
      toast({
        title: "Upload complete",
        description: `Processed ${result.total} records: ${result.new} new, ${result.updated} updated.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Upload failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleDownloadTemplate = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/leave/template", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to download template");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "leave_upload_template.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast({
        title: "Download failed",
        description: "Could not download the template file.",
        variant: "destructive",
      });
    }
  }, [toast]);

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

  return (
    <div className="space-y-6 max-w-[900px] mx-auto" data-testid="leave-upload-page">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50 flex items-center gap-2" data-testid="text-page-title">
          <FileSpreadsheet className="h-7 w-7 text-blue-600" />
          Leave Data Upload
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Upload leave records from Excel or CSV files
        </p>
      </header>

      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={handleDownloadTemplate} data-testid="button-download-template">
          <Download className="h-4 w-4 mr-2" />
          Download Template
        </Button>
      </div>

      <Card data-testid="card-upload">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4 text-blue-600" />
            Upload File
          </CardTitle>
          <CardDescription>
            Drag and drop your file or click to browse. Accepted formats:{" "}
            <Badge variant="secondary" className="ml-1">.csv</Badge>{" "}
            <Badge variant="secondary">.xlsx</Badge>{" "}
            <Badge variant="secondary">.xls</Badge>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
              isDragging
                ? "border-blue-500 bg-blue-50 dark:bg-blue-900/10"
                : selectedFile
                ? "border-green-400 bg-green-50 dark:bg-green-900/10"
                : "border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            data-testid="dropzone-upload"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleInputChange}
              className="hidden"
              data-testid="input-file"
            />

            {selectedFile ? (
              <div className="flex flex-col items-center gap-2">
                <File className="h-10 w-10 text-green-600" />
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300" data-testid="text-selected-file">
                    {selectedFile.name}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      clearFile();
                    }}
                    className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    data-testid="button-clear-file"
                  >
                    <X className="h-4 w-4 text-gray-500" />
                  </button>
                </div>
                <span className="text-xs text-muted-foreground">
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-10 w-10 text-gray-400" />
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  Drag & drop your file here, or click to browse
                </p>
                <p className="text-xs text-muted-foreground">
                  Supports CSV, XLSX, and XLS files
                </p>
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => uploadMutation.mutate()}
              disabled={!selectedFile || uploadMutation.isPending}
              data-testid="button-upload"
            >
              {uploadMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              {uploadMutation.isPending ? "Uploading..." : "Upload File"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {uploadResult && (
        <Card data-testid="card-upload-results">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              Upload Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-4">
              <div className="text-center p-3 rounded-lg bg-gray-50 dark:bg-gray-800" data-testid="stat-total">
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-50">{uploadResult.total}</div>
                <div className="text-xs text-muted-foreground">Total Processed</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-green-50 dark:bg-green-900/10" data-testid="stat-new">
                <div className="text-2xl font-bold text-green-700 dark:text-green-400">{uploadResult.new}</div>
                <div className="text-xs text-muted-foreground">New</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-blue-50 dark:bg-blue-900/10" data-testid="stat-updated">
                <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{uploadResult.updated}</div>
                <div className="text-xs text-muted-foreground">Updated</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-gray-50 dark:bg-gray-800" data-testid="stat-unchanged">
                <div className="text-2xl font-bold text-gray-500">{uploadResult.unchanged}</div>
                <div className="text-xs text-muted-foreground">Unchanged</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-red-50 dark:bg-red-900/10" data-testid="stat-errors">
                <div className="text-2xl font-bold text-red-700 dark:text-red-400">{uploadResult.errors.length}</div>
                <div className="text-xs text-muted-foreground">Errors</div>
              </div>
            </div>

            {uploadResult.errors.length > 0 && (
              <div className="mt-4 p-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800" data-testid="error-list">
                <div className="flex items-center gap-2 mb-2 text-red-700 dark:text-red-400 font-medium text-sm">
                  <AlertTriangle className="h-4 w-4" />
                  Errors ({uploadResult.errors.length})
                </div>
                <ul className="space-y-1 text-sm text-red-600 dark:text-red-400">
                  {uploadResult.errors.map((error, i) => (
                    <li key={i} className="flex items-start gap-1" data-testid={`text-error-${i}`}>
                      <span className="mt-0.5">•</span>
                      <span>{error}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-instructions">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-blue-600" />
            File Format Instructions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <h3 className="font-medium text-gray-700 dark:text-gray-300 mb-2">Expected Columns</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse" data-testid="table-columns">
                <thead>
                  <tr className="border-b dark:border-gray-700">
                    <th className="py-2 pr-4 font-medium text-gray-600 dark:text-gray-400">Column</th>
                    <th className="py-2 pr-4 font-medium text-gray-600 dark:text-gray-400">Required</th>
                    <th className="py-2 font-medium text-gray-600 dark:text-gray-400">Notes</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b dark:border-gray-800">
                    <td className="py-2 pr-4">Leave ID</td>
                    <td className="py-2 pr-4"><Badge variant="secondary">Optional</Badge></td>
                    <td className="py-2">Used for matching existing records</td>
                  </tr>
                  <tr className="border-b dark:border-gray-800">
                    <td className="py-2 pr-4">Employee Number</td>
                    <td className="py-2 pr-4"><Badge variant="secondary">Optional</Badge></td>
                    <td className="py-2">Employee identifier from payroll system</td>
                  </tr>
                  <tr className="border-b dark:border-gray-800">
                    <td className="py-2 pr-4">First Name</td>
                    <td className="py-2 pr-4"><Badge variant="default">Required</Badge></td>
                    <td className="py-2">Employee first name</td>
                  </tr>
                  <tr className="border-b dark:border-gray-800">
                    <td className="py-2 pr-4">Surname</td>
                    <td className="py-2 pr-4"><Badge variant="default">Required</Badge></td>
                    <td className="py-2">Employee surname / last name</td>
                  </tr>
                  <tr className="border-b dark:border-gray-800">
                    <td className="py-2 pr-4">Leave Type</td>
                    <td className="py-2 pr-4"><Badge variant="default">Required</Badge></td>
                    <td className="py-2">e.g. Annual, Sick, Family Responsibility</td>
                  </tr>
                  <tr className="border-b dark:border-gray-800">
                    <td className="py-2 pr-4">Start Date</td>
                    <td className="py-2 pr-4"><Badge variant="default">Required</Badge></td>
                    <td className="py-2">Leave start date</td>
                  </tr>
                  <tr className="border-b dark:border-gray-800">
                    <td className="py-2 pr-4">End Date</td>
                    <td className="py-2 pr-4"><Badge variant="default">Required</Badge></td>
                    <td className="py-2">Leave end date</td>
                  </tr>
                  <tr className="border-b dark:border-gray-800">
                    <td className="py-2 pr-4">Status</td>
                    <td className="py-2 pr-4"><Badge variant="secondary">Optional</Badge></td>
                    <td className="py-2">Defaults to "Approved" if not provided</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4">Approved By</td>
                    <td className="py-2 pr-4"><Badge variant="secondary">Optional</Badge></td>
                    <td className="py-2">Name of the approving manager</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800" data-testid="note-date-formats">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-medium text-amber-800 dark:text-amber-400">Date Formats: </span>
                <span className="text-amber-700 dark:text-amber-500">
                  Supported formats are <code className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-xs">YYYY-MM-DD</code> and{" "}
                  <code className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-xs">DD/MM/YYYY</code>.
                  Ensure all date values in your file use one of these formats.
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}