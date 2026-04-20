import { Link } from "wouter";
import { AlertTriangle, ArrowUp, CheckCircle2, Clock, RefreshCw, User, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { departmentLabel } from "@shared/config/priorities";
import type { PriorityRow } from "@/lib/priority-types";

const HEALTH_COLORS: Record<string, string> = {
  critical: "border-l-red-500",
  at_risk: "border-l-amber-500",
  healthy: "border-l-emerald-500",
};

const HEALTH_DOT_COLORS: Record<string, string> = {
  critical: "bg-red-500",
  at_risk: "bg-amber-500",
  healthy: "bg-emerald-500",
};

const SEVERITY_BADGE: Record<string, { label: string; className: string }> = {
  critical: { label: "Critical", className: "bg-red-100 text-red-700 hover:bg-red-100" },
  important: { label: "High", className: "bg-amber-100 text-amber-700 hover:bg-amber-100" },
  normal: { label: "Normal", className: "bg-gray-100 text-gray-600 hover:bg-gray-100" },
};

/**
 * Date-only diff in days between `dateStr` (YYYY-MM-DD) and today. Uses
 * ISO string comparison to avoid the UTC-vs-local off-by-one problem that
 * surfaced in the pre-Tier 1 audit.
 */
function daysRemaining(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const due = Date.parse(dateStr + "T00:00:00Z");
  const today = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(due) || Number.isNaN(today)) return null;
  return Math.ceil((due - today) / 86_400_000);
}

export interface PriorityCardProps {
  priority: PriorityRow;
  showEscalate?: boolean;
  onEscalate?: () => void;
  showMarkComplete?: boolean;
  onMarkComplete?: () => void;
  showDeptActions?: boolean;
  onAssign?: () => void;
  showReopen?: boolean;
  onReopen?: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export function PriorityCard({
  priority,
  showEscalate,
  onEscalate,
  showMarkComplete,
  onMarkComplete,
  showDeptActions,
  onAssign,
  showReopen,
  onReopen,
  selectable,
  selected,
  onToggleSelect,
}: PriorityCardProps) {
  const days = daysRemaining(priority.dueDate);
  const healthColor = HEALTH_COLORS[priority.effectiveHealth] || HEALTH_COLORS.healthy;
  const dotColor = HEALTH_DOT_COLORS[priority.effectiveHealth] || HEALTH_DOT_COLORS.healthy;
  const sev = SEVERITY_BADGE[priority.severity] || SEVERITY_BADGE.normal;
  const isDone = priority.status === "complete" || priority.status === "closed";
  const healthTooltip = priority.healthReasons && priority.healthReasons.length > 0
    ? `Health: ${priority.effectiveHealth} — ${priority.healthReasons.join("; ")}`
    : `Health: ${priority.effectiveHealth}`;

  const showActionRow =
    showMarkComplete ||
    (showEscalate && priority.scope !== "company") ||
    showDeptActions ||
    showReopen;

  return (
    <Card className={`border-l-4 ${healthColor} hover:shadow-md transition-shadow relative ${selected ? "ring-2 ring-primary" : ""}`}>
      <CardContent className="p-4">
        {selectable && (
          <div className="absolute top-2 right-2 z-10">
            <input
              type="checkbox"
              checked={!!selected}
              onChange={(e) => { e.stopPropagation(); onToggleSelect?.(); }}
              className="rounded cursor-pointer"
              aria-label={`Select ${priority.title}`}
              title={`Select ${priority.title}`}
            />
          </div>
        )}

        {priority.escalated && (
          <div className="flex items-center gap-1 mb-2">
            <Badge variant="destructive" className="text-[10px]">
              <AlertTriangle className="w-3 h-3 mr-0.5" />
              Escalated{priority.escalationReason ? ` — ${priority.escalationReason}` : ""}
            </Badge>
          </div>
        )}

        <div className="flex items-center gap-2 mb-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${dotColor} shrink-0`}
            title={healthTooltip}
            aria-label={healthTooltip}
          />
          <Link href={`/priorities/${priority.id}`}>
            <span className="text-sm font-semibold text-foreground hover:text-primary hover:underline cursor-pointer truncate">
              {priority.title}
            </span>
          </Link>
          <Badge variant="secondary" className={`text-[10px] ml-auto shrink-0 ${sev.className}`}>
            {sev.label}
          </Badge>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2 flex-wrap">
          {priority.assignedUser && (
            <span>
              <User className="w-3 h-3 inline mr-0.5" />
              {priority.assignedUser.name}
            </span>
          )}
          {!priority.assignedUser && priority.owner && <span>{priority.owner.name}</span>}
          {!priority.assignedUser && !priority.owner && priority.assignedTo && (
            <span>{priority.assignedTo}</span>
          )}
          {priority.dueDate && (
            <span
              className={
                days != null && days <= 7 ? "text-red-600 font-medium"
                  : days != null && days <= 14 ? "text-amber-600 font-medium"
                  : ""
              }
            >
              <Clock className="w-3 h-3 inline mr-0.5" />
              {days != null && days < 0
                ? `${Math.abs(days)}d overdue`
                : days != null
                  ? `${days}d`
                  : priority.dueDate}
            </span>
          )}
          {priority.blockerCount > 0 && (
            <span className="text-red-600 font-medium">
              <AlertTriangle className="w-3 h-3 inline mr-0.5" />
              {priority.blockerCount} blocker{priority.blockerCount > 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="mb-2">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">
              {priority.effectiveProgress}%{!priority.hasProjects && " (manual)"}
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                priority.effectiveHealth === "critical" ? "bg-red-500"
                  : priority.effectiveHealth === "at_risk" ? "bg-amber-500"
                  : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(priority.effectiveProgress, 100)}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div>
            {priority.parentTitle && (
              <Link href={`/priorities/${priority.parentId}`}>
                <span className="text-primary hover:underline cursor-pointer">
                  Part of: {priority.parentTitle}
                </span>
              </Link>
            )}
            {!priority.parentTitle && priority.departmentKey && (
              <span>{departmentLabel(priority.departmentKey)}</span>
            )}
            {!priority.parentTitle && !priority.departmentKey && priority.department && (
              <span>{priority.department}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {priority.childCount > 0 && (
              <span>
                {priority.childCount} sub-priorit{priority.childCount === 1 ? "y" : "ies"}
              </span>
            )}
            {priority.hasProjects && (
              <span>
                {priority.projectCount} project{priority.projectCount !== 1 ? "s" : ""}
                {priority.atRiskProjectCount > 0 && (
                  <span className="text-red-600 ml-1">· {priority.atRiskProjectCount} at risk</span>
                )}
              </span>
            )}
            {!priority.hasProjects && priority.childCount === 0 && (
              <span className="italic">Standalone</span>
            )}
          </div>
        </div>

        {showActionRow && (
          <div className="mt-2 pt-2 border-t flex items-center gap-2 flex-wrap">
            {showMarkComplete && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={onMarkComplete}
                disabled={isDone}
                aria-label={isDone ? "Priority already completed" : "Mark priority complete"}
              >
                <CheckCircle2 className="w-3 h-3 mr-1" />
                {isDone ? "Completed" : "Mark Complete"}
              </Button>
            )}
            {showDeptActions && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={onAssign}
                aria-label={priority.assignedUser ? "Reassign priority" : "Assign priority"}
              >
                <Users className="w-3 h-3 mr-1" />
                {priority.assignedUser ? "Reassign" : "Assign Priority"}
              </Button>
            )}
            {showReopen && (priority.status === "closed" || priority.status === "complete") && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                onClick={onReopen}
                aria-label="Reopen priority"
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Reopen
              </Button>
            )}
            {showEscalate && priority.scope !== "company" && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7 text-orange-700 border-orange-200 hover:bg-orange-50"
                onClick={onEscalate}
                disabled={isDone}
                aria-label={showDeptActions ? "Escalate priority to company scope" : "Escalate priority"}
              >
                <ArrowUp className="w-3 h-3 mr-1" />
                {showDeptActions ? "Escalate to Company" : "Escalate"}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
