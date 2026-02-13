import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Calendar, CheckCircle2, AlertCircle, Loader2, ArrowRight,
} from "lucide-react";

interface KeyDatesPanelProps {
  projectName: string;
}

interface ResolvedKeyDate {
  id: number;
  keyDateName: string;
  sourceTaskNameMatch: string | null;
  dateField: string;
  sortOrder: number;
  matchedTaskId: number | null;
  matchedTaskTitle: string | null;
  matchedTaskNumber: string | null;
  plannedDate: string | null;
  actualDate: string | null;
  effectiveDate: string | null;
  mappingValid: boolean;
  source: string;
}

const formatDate = (d: string | null): string => {
  if (!d) return "—";
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return d;
  }
};

export default function KeyDatesPanel({ projectName }: KeyDatesPanelProps) {
  const { data: keyDates = [], isLoading } = useQuery<ResolvedKeyDate[]>({
    queryKey: ["key-dates", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/key-dates/${encodeURIComponent(projectName)}`, {
        credentials: 'include',
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const validCount = keyDates.filter(d => d.mappingValid).length;
  const totalCount = keyDates.length;

  return (
    <Card className="shadow-sm" data-testid="key-dates-panel">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-blue-600" />
            <CardTitle className="text-base">Key Project Dates</CardTitle>
            {totalCount > 0 && (
              <Badge variant="outline" className="text-[9px] bg-blue-50 text-blue-700 border-blue-300">
                {validCount}/{totalCount} linked
              </Badge>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground">Auto-detected from project plan</span>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : keyDates.length === 0 ? (
          <div className="text-center py-4 text-sm text-muted-foreground">
            <p>No project plan tasks found.</p>
            <p className="text-xs mt-1">Upload an Excel file with plan data to see key dates here.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {keyDates.map((kd) => (
              <div key={kd.id} className={`flex items-center justify-between p-2.5 rounded-md border ${kd.mappingValid ? "bg-white border-slate-200" : "bg-slate-50 border-slate-200"}`}
                data-testid={`key-date-${kd.keyDateName.replace(/\s+/g, '-').toLowerCase()}`}>
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  {kd.mappingValid ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-slate-400 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{kd.keyDateName}</span>
                      {kd.mappingValid && kd.matchedTaskNumber && (
                        <Badge variant="outline" className="text-[8px] px-1 py-0 bg-green-50 text-green-700 border-green-300">
                          Task {kd.matchedTaskNumber}
                        </Badge>
                      )}
                    </div>
                    {kd.mappingValid ? (
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                        <span className="truncate max-w-[180px]" title={kd.matchedTaskTitle || ""}>
                          {kd.matchedTaskTitle}
                        </span>
                        <ArrowRight className="h-3 w-3 shrink-0 text-slate-400" />
                        <span className="text-[10px]">
                          {kd.dateField === 'startDate' ? 'Start Date' : 'Due Date'}
                        </span>
                      </div>
                    ) : (
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        No matching task found
                        {kd.sourceTaskNameMatch && <span className="italic"> (looking for: {kd.sourceTaskNameMatch})</span>}
                      </p>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  {kd.effectiveDate ? (
                    <span className="text-sm font-semibold text-blue-700" data-testid={`date-${kd.keyDateName.replace(/\s+/g, '-').toLowerCase()}`}>
                      {formatDate(kd.effectiveDate)}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
