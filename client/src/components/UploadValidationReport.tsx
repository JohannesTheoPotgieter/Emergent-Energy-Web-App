import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, AlertTriangle, FileSpreadsheet, X } from "lucide-react";
import { UploadResult } from "@/lib/api";

interface UploadValidationReportProps {
  result: UploadResult;
  onDismiss: () => void;
}

export function UploadValidationReport({ result, onDismiss }: UploadValidationReportProps) {
  const successCount = result.results.filter(r => r.status === "success").length;
  const errorCount = result.results.filter(r => r.status === "error").length;
  const totalRecords = result.results.reduce((sum, r) => 
    sum + (r.expensesParsed || 0) + (r.inflowsParsed || 0) + (r.planParsed || 0) + 
    (r.cashflowParsed || 0) + (r.financeRevenueParsed || 0) + (r.financeCosParsed || 0), 0);

  return (
    <Card className="border-emerald-200 bg-emerald-50/50 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
              Upload Validation Report
            </CardTitle>
            <CardDescription>
              {successCount} of {result.results.length} file(s) processed • {totalRecords} total records ingested
            </CardDescription>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-6 w-6 -mt-1 -mr-2"
            onClick={onDismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {result.results.map((fileResult, idx) => (
          <div key={idx} className="rounded-lg border bg-card p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {fileResult.status === "success" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate" title={fileResult.file}>
                    {fileResult.file}
                  </p>
                  {fileResult.project_name && (
                    <p className="text-xs text-muted-foreground">
                      Project: {fileResult.project_name}
                    </p>
                  )}
                </div>
              </div>
              <Badge variant={fileResult.status === "success" ? "default" : "destructive"} className="shrink-0">
                {fileResult.status}
              </Badge>
            </div>

            {fileResult.status === "success" && (
              <div className="flex gap-2 flex-wrap text-xs text-muted-foreground">
                {fileResult.infoParsed && (
                  <Badge variant="outline" className="bg-blue-50 border-blue-200">
                    ✓ Project Info
                  </Badge>
                )}
                {(fileResult.expensesParsed ?? 0) > 0 && (
                  <Badge variant="outline" className="bg-purple-50 border-purple-200">
                    {fileResult.expensesParsed} Expenses
                  </Badge>
                )}
                {(fileResult.inflowsParsed ?? 0) > 0 && (
                  <Badge variant="outline" className="bg-emerald-50 border-emerald-200">
                    {fileResult.inflowsParsed} Inflows
                  </Badge>
                )}
                {(fileResult.planParsed ?? 0) > 0 && (
                  <Badge variant="outline" className="bg-amber-50 border-amber-200">
                    {fileResult.planParsed} Tasks
                  </Badge>
                )}
                {(fileResult.cashflowParsed ?? 0) > 0 && (
                  <Badge variant="outline" className="bg-cyan-50 border-cyan-200">
                    {fileResult.cashflowParsed} Cashflow
                  </Badge>
                )}
                {(fileResult.financeRevenueParsed ?? 0) > 0 && (
                  <Badge variant="outline" className="bg-green-50 border-green-200">
                    {fileResult.financeRevenueParsed} Revenue
                  </Badge>
                )}
                {(fileResult.financeCosParsed ?? 0) > 0 && (
                  <Badge variant="outline" className="bg-rose-50 border-rose-200">
                    {fileResult.financeCosParsed} COS
                  </Badge>
                )}
              </div>
            )}

            {fileResult.message && fileResult.status === "error" && (
              <Alert className="bg-rose-50 border-rose-200">
                <AlertDescription className="text-xs">
                  {fileResult.message}
                </AlertDescription>
              </Alert>
            )}

            {fileResult.warnings && fileResult.warnings.length > 0 && (
              <Alert className="bg-amber-50 border-amber-200">
                <AlertTriangle className="h-3 w-3" />
                <AlertDescription className="text-xs ml-2">
                  <strong>Warnings:</strong> {fileResult.warnings.join(", ")}
                </AlertDescription>
              </Alert>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
