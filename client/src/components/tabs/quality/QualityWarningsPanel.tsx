import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertTriangle, ChevronDown } from "lucide-react";

function getRiskSeverityColor(severity: string) {
  switch (severity?.toLowerCase()) {
    case "high": return "text-red-500 bg-red-50 border-red-500/20";
    case "medium": return "text-orange-500 bg-orange-50 border-orange-500/20";
    case "low": return "text-yellow-500 bg-yellow-500/10 border-yellow-500/20";
    default: return "text-muted-foreground bg-muted/50 border-border";
  }
}

interface Warning {
  id: number;
  severity: string;
  title?: string;
  description?: string;
  warningType?: string;
  status: string;
}

interface QualityWarningsPanelProps {
  warnings: Warning[];
}

export function QualityWarningsPanel({ warnings }: QualityWarningsPanelProps) {
  if (warnings.length === 0) return null;

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <div className="rounded-lg border border-red-200 bg-red-50/60 px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-red-100/60 transition-colors" data-testid="quality-warnings">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-sm font-semibold text-red-700 flex-1">
            {warnings.length} Active Warning{warnings.length !== 1 ? "s" : ""}
          </p>
          <ChevronDown className="w-4 h-4 text-red-600" />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border border-t-0 border-red-200 rounded-b-lg px-4 py-3 space-y-2 bg-red-50/30">
          {warnings.map((w) => (
            <div key={w.id} className="flex items-center gap-2 text-xs text-muted-foreground" data-testid={`warning-item-${w.id}`}>
              <Badge className={getRiskSeverityColor(w.severity)} variant="outline">{w.severity}</Badge>
              <span className="flex-1">{w.title || w.description || w.warningType}</span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
