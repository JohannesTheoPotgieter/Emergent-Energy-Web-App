import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader2, ExternalLink } from "lucide-react";
import { useProgramData } from "@/hooks/use-program-data";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

export default function UploadPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [duplicateModal, setDuplicateModal] = useState<{
    show: boolean;
    projectName: string;
    file: File | null;
  }>({ show: false, projectName: "", file: null });
  const [resetOverrides, setResetOverrides] = useState(false);

  const { projectsSummary } = useProgramData();
  const existingProjects = (projectsSummary || []).map(p => p.project_name);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    const file = e.target.files[0];
    const fileName = file.name.replace(/\.(xlsx|xlsm|xls)$/i, "");
    
    // Check if project exists
    const existingProject = existingProjects.find(p => 
      p.toLowerCase().includes(fileName.toLowerCase()) || 
      fileName.toLowerCase().includes(p.toLowerCase().replace("_Tracker", ""))
    );

    if (existingProject) {
      setDuplicateModal({
        show: true,
        projectName: existingProject,
        file,
      });
    } else {
      await uploadFile(file, "create");
    }
  };

  const uploadFile = async (file: File, mode: "create" | "refresh" | "duplicate", resetOverridesFlag = false) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("trackers", file);
      formData.append("mode", mode);
      if (resetOverridesFlag) {
        formData.append("resetOverrides", "true");
      }

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || "Upload failed");
      }

      const result = await response.json();
      // Extract project name from first successful result
      const projectName = result.results?.[0]?.project_name || result.projectName;
      const uploadMode = result.results?.[0]?.mode || mode;
      setUploadResult({ ...result, projectName });
      queryClient.invalidateQueries({ queryKey: ["projects-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      
      toast({
        title: "Upload Successful",
        description: `${projectName || file.name} has been ${uploadMode === 'duplicate' ? 'duplicated' : 'processed'} successfully.`,
      });
    } catch (error: any) {
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload tracker file",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      setDuplicateModal({ show: false, projectName: "", file: null });
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRefresh = () => {
    if (duplicateModal.file) {
      uploadFile(duplicateModal.file, "refresh", resetOverrides);
    }
  };

  const handleDuplicate = () => {
    if (duplicateModal.file) {
      uploadFile(duplicateModal.file, "duplicate");
    }
  };

  const handleCancel = () => {
    setDuplicateModal({ show: false, projectName: "", file: null });
    setResetOverrides(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-heading font-bold text-foreground">Upload Tracker</h2>
        <p className="text-muted-foreground">
          Upload Excel tracker files to update project data. Supports .xlsx, .xlsm, and .xls formats.
        </p>
      </div>

      {/* Upload Area */}
      <Card className="border-2 border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xlsm,.xls"
            onChange={handleFileSelect}
            className="hidden"
            id="tracker-upload"
          />
          {isUploading ? (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-12 h-12 animate-spin text-primary" />
              <p className="text-lg font-medium">Processing tracker file...</p>
              <p className="text-sm text-muted-foreground">Parsing sheets and ingesting data</p>
            </div>
          ) : (
            <>
              <Upload className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Drop tracker file here or click to browse</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Supports Excel files with Project Plan, Revenue Tracking, Expenditure Breakdown, Finance-Revenue, Finance-COS, and Cashflow sheets
              </p>
              <Button onClick={() => fileInputRef.current?.click()}>
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                Select Tracker File
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Upload Summary */}
      {uploadResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              Upload Summary
            </CardTitle>
            <CardDescription>
              Project: {uploadResult.projectName || "Unknown"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Sheets Found */}
              <div>
                <h4 className="text-sm font-medium mb-2">Sheets Processed</h4>
                <div className="flex flex-wrap gap-2">
                  {uploadResult.sheets?.map((sheet: any) => (
                    <Badge key={sheet.name} variant={sheet.rowsIngested > 0 ? "default" : "secondary"}>
                      {sheet.name}: {sheet.rowsIngested} rows
                    </Badge>
                  )) || (
                    <>
                      <Badge variant="outline">Project Plan</Badge>
                      <Badge variant="outline">Revenue Tracking</Badge>
                      <Badge variant="outline">Expenditure Breakdown</Badge>
                      <Badge variant="outline">Finance-Revenue</Badge>
                      <Badge variant="outline">Finance-COS</Badge>
                      <Badge variant="outline">Cashflow</Badge>
                    </>
                  )}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="flex gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => setLocation(`/project/${encodeURIComponent(uploadResult.projectName)}`)}
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View Project Detail
                </Button>
                <Button variant="outline" onClick={() => setLocation("/projects")}>
                  Go to Projects Summary
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Duplicate Project Modal */}
      <Dialog open={duplicateModal.show} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Project Already Exists</DialogTitle>
            <DialogDescription>
              A project matching "{duplicateModal.projectName}" already exists. How would you like to proceed?
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4 space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox 
                id="reset-overrides" 
                checked={resetOverrides}
                onCheckedChange={(checked) => setResetOverrides(checked === true)}
              />
              <label htmlFor="reset-overrides" className="text-sm">
                Reset all planning overrides (clear previous edits)
              </label>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={handleDuplicate}>
              Duplicate as New Project
            </Button>
            <Button onClick={handleRefresh}>
              Refresh Existing Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
