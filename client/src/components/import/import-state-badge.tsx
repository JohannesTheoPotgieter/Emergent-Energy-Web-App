/**
 * Shared state badge + tone helpers for the Smart Import "friendly setup"
 * surfaces. Keeps the colour mapping (up to date = emerald, needs review =
 * amber, failed = red, in progress = neutral) consistent across the
 * per-project status card and the attention queue.
 */

import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import type { ImportState } from "@/hooks/use-import-config";

interface StateMeta {
  label: string;
  badgeClassName: string;
  tone: { border: string; bg: string; text: string };
}

const STATE_META: Record<ImportState, StateMeta> = {
  up_to_date: {
    label: "Up to date",
    badgeClassName: "bg-emerald-50 text-emerald-700 border-emerald-200",
    tone: { border: "border-emerald-200", bg: "bg-emerald-50/40", text: "text-emerald-800" },
  },
  needs_review: {
    label: "Needs review",
    badgeClassName: "bg-amber-50 text-amber-800 border-amber-200",
    tone: { border: "border-amber-300", bg: "bg-amber-50/50", text: "text-amber-900" },
  },
  failed: {
    label: "Failed",
    badgeClassName: "bg-rose-50 text-rose-700 border-rose-200",
    tone: { border: "border-rose-300", bg: "bg-rose-50/50", text: "text-rose-900" },
  },
  in_progress: {
    label: "In progress",
    badgeClassName: "bg-muted text-foreground",
    tone: { border: "border-muted", bg: "bg-muted/30", text: "text-foreground" },
  },
};

export function getImportStateMeta(state: ImportState): StateMeta {
  return STATE_META[state];
}

export function ImportStateIcon({
  state,
  className = "h-4 w-4",
}: {
  state: ImportState;
  className?: string;
}) {
  if (state === "up_to_date") {
    return <CheckCircle2 className={`${className} text-emerald-600`} />;
  }
  if (state === "needs_review") {
    return <AlertTriangle className={`${className} text-amber-600`} />;
  }
  if (state === "failed") {
    return <XCircle className={`${className} text-rose-600`} />;
  }
  return <Loader2 className={`${className} text-muted-foreground animate-spin`} />;
}

export function ImportStateBadge({ state }: { state: ImportState }) {
  const meta = STATE_META[state];
  return (
    <Badge
      variant="outline"
      className={`text-[10px] gap-1 ${meta.badgeClassName}`}
      data-testid={`import-state-badge-${state}`}
    >
      <ImportStateIcon state={state} className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}
