import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Download, Upload, Loader2, CheckCircle, AlertTriangle, Database, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";

const QM_PROJECTS = [
  "25 Superior Road",
  "De Drift",
  "PnP Bethal",
  "Swellengrebel",
];

export default function AdminDataSyncPage() {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exportResult, setExportResult] = useState<any>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const [selectedQmProjects, setSelectedQmProjects] = useState<string[]>([...QM_PROJECTS]);
  const [creatingChecklists, setCreatingChecklists] = useState(false);
  const [checklistResult, setChecklistResult] = useState<{ project: string; status: string }[] | null>(null);

  const handleExport = async () => {
    setExporting(true);
    setExportResult(null);
    try {
      const res = await apiRequest("GET", "/api/admin/data-export");
      const data = await res.json();
      setExportResult(data.counts);

      const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `epm-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      toast({ title: "Export complete", description: "Data file downloaded successfully." });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const handleCreateChecklists = async () => {
    if (selectedQmProjects.length === 0) {
      toast({ title: "No projects selected", description: "Select at least one project.", variant: "destructive" });
      return;
    }
    setCreatingChecklists(true);
    setChecklistResult(null);
    try {
      const res = await apiRequest("POST", "/api/quality/admin/bulk-create-checklists", { projectNames: selectedQmProjects });
      const data = await res.json();
      setChecklistResult(data.results);
      toast({ title: "Checklists created", description: `Processed ${data.results.length} projects.` });
    } catch (err: any) {
      toast({ title: "Failed to create checklists", description: err.message, variant: "destructive" });
    } finally {
      setCreatingChecklists(false);
    }
  };

  const toggleQmProject = (name: string) => {
    setSelectedQmProjects(prev =>
      prev.includes(name) ? prev.filter(p => p !== name) : [...prev, name]
    );
  };

  const handleImport = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setImporting(true);
      setImportResult(null);
      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!data.tables || !data.version) {
          throw new Error("Invalid export file format");
        }

        const res = await apiRequest("POST", "/api/admin/data-import", { tables: data.tables });
        const result = await res.json();
        setImportResult(result.imported);

        toast({ title: "Import complete", description: "Data synced successfully. Refresh the page to see updated values." });
      } catch (err: any) {
        toast({ title: "Import failed", description: err.message, variant: "destructive" });
      } finally {
        setImporting(false);
      }
    };
    input.click();
  };

  return (
    <div className="container mx-auto py-8 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Database Sync</h1>
        <p className="text-muted-foreground mt-1">
          Export data from one environment and import into another to keep dev and production in sync.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            How it works
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>Dev and production use separate databases. When you import Excel files via Smart Import on dev, that data only goes to the dev database.</p>
          <p>To sync production with dev:</p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li><strong>Export</strong> from the dev environment (downloads a JSON file)</li>
            <li><strong>Import</strong> the same file on the production environment</li>
          </ol>
          <p className="text-amber-600 font-medium mt-3">Warning: Import replaces ALL existing data in the target tables. This cannot be undone.</p>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Export Data
            </CardTitle>
            <CardDescription>Download all project and financial data as a JSON file</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={handleExport} disabled={exporting} className="w-full" data-testid="button-export">
              {exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              {exporting ? "Exporting..." : "Export Data"}
            </Button>
            {exportResult && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-sm font-medium">Export successful</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(exportResult).map(([table, count]) => (
                    <Badge key={table} variant="secondary" data-testid={`badge-export-${table}`}>
                      {table}: {count as number}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import Data
            </CardTitle>
            <CardDescription>Upload a previously exported JSON file to replace current data</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={importing} className="w-full" data-testid="button-import">
                  {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  {importing ? "Importing..." : "Import Data"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    Confirm Data Import
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This will replace ALL existing data in the project, expense, inflow, plan, and normalized tables. This action cannot be undone. Are you sure?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleImport}>Yes, Import Data</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            {importResult && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-sm font-medium">Import successful</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(importResult).map(([table, count]) => (
                    <Badge key={table} variant="secondary" data-testid={`badge-import-${table}`}>
                      {table}: {count as number}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Create Quality Checklists
          </CardTitle>
          <CardDescription>Initialize quality management checklists for selected projects. Safe to run multiple times — existing checklists are skipped.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {QM_PROJECTS.map((name) => (
              <label key={name} className="flex items-center gap-2 cursor-pointer" data-testid={`checkbox-qm-${name}`}>
                <Checkbox
                  checked={selectedQmProjects.includes(name)}
                  onCheckedChange={() => toggleQmProject(name)}
                />
                <span className="text-sm">{name}</span>
              </label>
            ))}
          </div>
          <Button onClick={handleCreateChecklists} disabled={creatingChecklists || selectedQmProjects.length === 0} data-testid="button-create-checklists">
            {creatingChecklists ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            {creatingChecklists ? "Creating..." : `Create Checklists (${selectedQmProjects.length})`}
          </Button>
          {checklistResult && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle className="h-4 w-4" />
                <span className="text-sm font-medium">Done</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {checklistResult.map((r) => (
                  <Badge key={r.project} variant={r.status === "created" ? "default" : "secondary"} data-testid={`badge-qm-${r.project}`}>
                    {r.project}: {r.status}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
