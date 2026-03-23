import { ChevronLeft, ChevronRight, Download, FileText, RefreshCw, CheckCircle, Send, RotateCcw, History, GitCompare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ReportHeaderProps {
  title: string;
  month: string;
  onMonthChange: (month: string) => void;
  status: string;
  generatedAt?: string;
  regeneratedAt?: string;
  reportId?: number;
  onRegenerate?: () => void;
  onReview?: () => void;
  onPublish?: () => void;
  onRevert?: () => void;
  onExportPdf?: () => void;
  onExportExcel?: () => void;
  onCompare?: () => void;
  onHistory?: () => void;
  isLoading?: boolean;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: "bg-amber-100 text-amber-800 border-amber-200",
    reviewed: "bg-blue-100 text-blue-800 border-blue-200",
    published: "bg-emerald-100 text-emerald-800 border-emerald-200",
  };
  return (
    <Badge variant="outline" className={`text-xs ${colors[status] || "text-slate-500"}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function getMonthOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
    options.push({ value, label });
  }
  return options;
}

function navigateMonth(month: string, direction: -1 | 1): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + direction, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function ReportHeader({
  title, month, onMonthChange, status, generatedAt, regeneratedAt, reportId,
  onRegenerate, onReview, onPublish, onRevert, onExportPdf, onExportExcel,
  onCompare, onHistory, isLoading,
}: ReportHeaderProps) {
  const monthOptions = getMonthOptions();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <FileText className="w-6 h-6 text-emerald-700" />
          <h1 className="text-2xl font-bold">{title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onMonthChange(navigateMonth(month, -1))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Select value={month} onValueChange={onMonthChange}>
            <SelectTrigger className="w-[200px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onMonthChange(navigateMonth(month, 1))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <StatusBadge status={status} />
          {generatedAt && <span>Generated: {new Date(generatedAt).toLocaleString("en-ZA")}</span>}
          {regeneratedAt && <span>Last regenerated: {new Date(regeneratedAt).toLocaleString("en-ZA")}</span>}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {status === "draft" && onRegenerate && (
            <Button variant="outline" size="sm" onClick={onRegenerate} disabled={isLoading} className="gap-1.5 text-xs">
              <RefreshCw className="w-3.5 h-3.5" /> Regenerate
            </Button>
          )}
          {status === "draft" && onReview && (
            <Button variant="outline" size="sm" onClick={onReview} disabled={isLoading} className="gap-1.5 text-xs text-blue-600 border-blue-200 hover:bg-blue-50">
              <CheckCircle className="w-3.5 h-3.5" /> Mark Reviewed
            </Button>
          )}
          {status === "reviewed" && onRevert && (
            <Button variant="outline" size="sm" onClick={onRevert} disabled={isLoading} className="gap-1.5 text-xs">
              <RotateCcw className="w-3.5 h-3.5" /> Revert to Draft
            </Button>
          )}
          {status === "reviewed" && onPublish && (
            <Button variant="outline" size="sm" onClick={onPublish} disabled={isLoading} className="gap-1.5 text-xs text-emerald-600 border-emerald-200 hover:bg-emerald-50">
              <Send className="w-3.5 h-3.5" /> Publish
            </Button>
          )}
          {onExportPdf && (
            <Button variant="outline" size="sm" onClick={onExportPdf} disabled={isLoading} className="gap-1.5 text-xs">
              <Download className="w-3.5 h-3.5" /> PDF
            </Button>
          )}
          {onExportExcel && (
            <Button variant="outline" size="sm" onClick={onExportExcel} disabled={isLoading} className="gap-1.5 text-xs">
              <Download className="w-3.5 h-3.5" /> Excel
            </Button>
          )}
          {onCompare && (
            <Button variant="outline" size="sm" onClick={onCompare} disabled={isLoading} className="gap-1.5 text-xs">
              <GitCompare className="w-3.5 h-3.5" /> Compare
            </Button>
          )}
          {onHistory && (
            <Button variant="outline" size="sm" onClick={onHistory} disabled={isLoading} className="gap-1.5 text-xs">
              <History className="w-3.5 h-3.5" /> History
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
