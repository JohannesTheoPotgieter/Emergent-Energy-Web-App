import { useState } from "react";
import { ChevronRight, AlertTriangle, Info, Zap, ChevronDown, ChevronUp, User, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NextAction, BlockerInfo, OwnerInfo } from "@/hooks/use-guidance";

interface ActionBarProps {
  nextAction: NextAction | null;
  blockers?: BlockerInfo[];
  owners?: OwnerInfo[];
  className?: string;
}

export function ActionBar({ nextAction, blockers = [], owners = [], className = "" }: ActionBarProps) {
  const [expanded, setExpanded] = useState(false);

  if (!nextAction && blockers.length === 0) return null;

  const severityIcon = {
    info: <Info className="w-4 h-4 text-blue-500 shrink-0" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />,
    urgent: <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />,
  };

  const severityBg = {
    info: "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800",
    warning: "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800",
    urgent: "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800",
  };

  const severity = nextAction?.severity || "info";

  return (
    <div className={`rounded-lg border p-2.5 sm:p-3 ${severityBg[severity]} ${className}`} data-testid="action-bar">
      <div className="flex items-center gap-2 flex-wrap">
        {severityIcon[severity]}
        <div className="flex-1 min-w-0">
          {nextAction && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium" data-testid="action-bar-label">{nextAction.label}</span>
              {nextAction.action && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs px-2"
                  onClick={nextAction.action}
                  data-testid="action-bar-go"
                >
                  Go <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              )}
            </div>
          )}
        </div>
        {(blockers.length > 0 || owners.length > 0) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1"
            onClick={() => setExpanded(!expanded)}
            data-testid="action-bar-expand"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        )}
      </div>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-current/10 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {blockers.length > 0 && (
            <div>
              <span className="font-medium text-muted-foreground uppercase tracking-wide text-[10px]">Blocking</span>
              <ul className="mt-1 space-y-0.5">
                {blockers.map((b, i) => (
                  <li key={i} className="flex items-center gap-1">
                    <AlertTriangle className={`w-3 h-3 ${b.severity === "urgent" ? "text-red-500" : "text-amber-500"}`} />
                    <span>{b.label}</span>
                    {b.count !== undefined && <span className="text-muted-foreground">({b.count})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {owners.length > 0 && (
            <div>
              <span className="font-medium text-muted-foreground uppercase tracking-wide text-[10px]">Owners</span>
              <ul className="mt-1 space-y-0.5">
                {owners.map((o, i) => (
                  <li key={i} className="flex items-center gap-1">
                    <User className="w-3 h-3 text-muted-foreground" />
                    <span>{o.name}</span>
                    {o.role && <span className="text-muted-foreground">· {o.role}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
