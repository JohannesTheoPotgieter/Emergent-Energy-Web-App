import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";

export interface ActionQueueItem {
  id: string | number;
  label: string;
  detail?: string;
  severity?: "critical" | "high" | "medium" | "low";
  onClick?: () => void;
}

export interface ActionQueueProps {
  /** Queue title */
  title: string;
  /** Icon displayed next to the title */
  icon?: React.ReactNode;
  /** Items in the queue */
  items: ActionQueueItem[];
  /** Color accent for the left border */
  accentColor?: string;
  /** Background class */
  bgClass?: string;
  /** Maximum items to show before collapse */
  maxVisible?: number;
  /** Empty state message */
  emptyMessage?: string;
  className?: string;
}

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-amber-500",
  low: "bg-slate-400",
};

/**
 * Reusable action queue component — extracted from the dashboard Action Centre.
 * Displays a list of actionable items with collapse/expand, severity indicators,
 * and click handlers.
 */
export function ActionQueue({
  title,
  icon,
  items,
  accentColor = "border-l-slate-400",
  bgClass = "bg-slate-50/30",
  maxVisible = 3,
  emptyMessage,
  className,
}: ActionQueueProps) {
  const [expanded, setExpanded] = React.useState(false);
  const visibleItems = expanded ? items : items.slice(0, maxVisible);
  const hasMore = items.length > maxVisible;

  if (items.length === 0 && !emptyMessage) return null;

  return (
    <div
      className={cn(
        "rounded-lg border-l-4 border border-border/50 overflow-hidden",
        accentColor,
        bgClass,
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-xs font-semibold text-foreground">{title}</span>
          <span className="text-[10px] font-mono text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
            {items.length}
          </span>
        </div>
        {hasMore && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
          >
            {expanded ? (
              <>Show less <ChevronUp className="w-3 h-3" /></>
            ) : (
              <>+{items.length - maxVisible} more <ChevronDown className="w-3 h-3" /></>
            )}
          </button>
        )}
      </div>

      {/* Items */}
      {items.length === 0 ? (
        <div className="px-3 pb-2">
          <p className="text-[10px] text-muted-foreground">{emptyMessage}</p>
        </div>
      ) : (
        <div className="divide-y divide-border/30">
          {visibleItems.map((item) => (
            <div
              key={item.id}
              className={cn(
                "px-3 py-1.5 flex items-center gap-2 text-xs",
                item.onClick && "cursor-pointer hover:bg-muted/50 transition-colors",
              )}
              onClick={item.onClick}
            >
              {item.severity && (
                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", SEVERITY_DOT[item.severity] || SEVERITY_DOT.low)} />
              )}
              <span className="text-foreground truncate flex-1">{item.label}</span>
              {item.detail && (
                <span className="text-muted-foreground text-[10px] shrink-0">{item.detail}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
