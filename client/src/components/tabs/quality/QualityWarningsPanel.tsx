import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { getRiskSeverityColor } from "@/lib/quality-ui-helpers";

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
  highOnly?: boolean;
  onClearHighOnly?: () => void;
}

export function QualityWarningsPanel({ warnings, highOnly = false, onClearHighOnly }: QualityWarningsPanelProps) {
  const visibleWarnings = highOnly ? warnings.filter((w) => String(w.severity).toLowerCase() === "high") : warnings;

  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <div className="rounded-lg border border-red-200 bg-red-50/60 px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-red-100/60 transition-colors" data-testid="quality-warnings">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-sm font-semibold text-red-700 flex-1">
            {visibleWarnings.length} {highOnly ? "High Severity " : "Active "}Warning{visibleWarnings.length !== 1 ? "s" : ""}
          </p>
          <ChevronDown className="w-4 h-4 text-red-600" />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border border-t-0 border-red-200 rounded-b-lg px-4 py-3 space-y-2 bg-red-50/30">
          <p className="text-xs text-muted-foreground">Why shown: warnings are unresolved governance alerts requiring investigation or override.</p>
          {highOnly && onClearHighOnly && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onClearHighOnly}>Show all warnings</Button>
          )}
          {visibleWarnings.length === 0 ? (
            <p className="text-xs text-emerald-700">No open high-severity warnings right now.</p>
          ) : (
            visibleWarnings.map((w) => (
              <div key={w.id} className="flex items-center gap-2 text-xs text-muted-foreground" data-testid={`warning-item-${w.id}`}>
                <Badge className={getRiskSeverityColor(w.severity)} variant="outline">{w.severity}</Badge>
                <span className="flex-1">{w.title || w.description || w.warningType}</span>
              </div>
            ))
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
