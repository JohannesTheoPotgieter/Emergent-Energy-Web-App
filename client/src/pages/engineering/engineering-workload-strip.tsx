/**
 * EngineeringWorkloadStrip — extracted verbatim from EngineeringTasksPage
 * (UI/UX audit module split). Behaviour-preserving mechanical move.
 *
 * Self-contained, prop-driven summary strip with no orchestrator state deps.
 */
import {
  ListTodo,
  UserCheck,
  PauseCircle,
  MessageSquare,
  ShieldCheck,
  Paperclip,
  ExternalLink,
} from "lucide-react";
import { type EngineeringWorkloadStateFilter } from "@/hooks/useEngineeringTaskFilters";

export function EngineeringWorkloadStrip({
  totalOpenWork,
  unassignedCount,
  blockedCount,
  reviewCount,
  approvalCount,
  deliverableCount,
  microsoftActionCount,
  onReset,
  onSelectWorkloadState,
}: {
  totalOpenWork: number;
  unassignedCount: number;
  blockedCount: number;
  reviewCount: number;
  approvalCount: number;
  deliverableCount: number;
  microsoftActionCount: number;
  onReset: () => void;
  onSelectWorkloadState: (state: EngineeringWorkloadStateFilter) => void;
}) {
  const cards = [
    {
      label: "Open Work",
      value: totalOpenWork,
      icon: <ListTodo className="w-3.5 h-3.5" />,
      color: "text-blue-600",
      bg: "bg-blue-50",
      onClick: onReset,
      testId: "summary-open-work",
    },
    {
      label: "Unassigned",
      value: unassignedCount,
      icon: <UserCheck className="w-3.5 h-3.5" />,
      color: unassignedCount > 0 ? "text-slate-700" : "text-muted-foreground",
      bg: unassignedCount > 0 ? "bg-slate-100" : "bg-muted",
      onClick: () => onSelectWorkloadState("unassigned"),
      testId: "summary-unassigned",
    },
    {
      label: "Blocked",
      value: blockedCount,
      icon: <PauseCircle className="w-3.5 h-3.5" />,
      color: blockedCount > 0 ? "text-red-600" : "text-muted-foreground",
      bg: blockedCount > 0 ? "bg-red-50" : "bg-muted",
      onClick: () => onSelectWorkloadState("blocked"),
      testId: "summary-blocked",
    },
    {
      label: "Review",
      value: reviewCount,
      icon: <MessageSquare className="w-3.5 h-3.5" />,
      color: reviewCount > 0 ? "text-violet-600" : "text-muted-foreground",
      bg: reviewCount > 0 ? "bg-violet-50" : "bg-muted",
      onClick: () => onSelectWorkloadState("review"),
      testId: "summary-review",
    },
    {
      label: "Approval",
      value: approvalCount,
      icon: <ShieldCheck className="w-3.5 h-3.5" />,
      color: approvalCount > 0 ? "text-amber-700" : "text-muted-foreground",
      bg: approvalCount > 0 ? "bg-amber-50" : "bg-muted",
      onClick: () => onSelectWorkloadState("approval"),
      testId: "summary-approval-pending",
    },
    {
      label: "Deliverables",
      value: deliverableCount,
      icon: <Paperclip className="w-3.5 h-3.5" />,
      color: deliverableCount > 0 ? "text-blue-700" : "text-muted-foreground",
      bg: deliverableCount > 0 ? "bg-blue-50" : "bg-muted",
      onClick: () => onSelectWorkloadState("deliverable"),
      testId: "summary-deliverables",
    },
    {
      label: "MS Actions",
      value: microsoftActionCount,
      icon: <ExternalLink className="w-3.5 h-3.5" />,
      color: microsoftActionCount > 0 ? "text-cyan-700" : "text-muted-foreground",
      bg: microsoftActionCount > 0 ? "bg-cyan-50" : "bg-muted",
      onClick: () => onSelectWorkloadState("microsoft_action"),
      testId: "summary-microsoft-actions",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2" data-testid="engineering-workload-strip">
      {cards.map((card) => (
        <button
          key={card.label}
          onClick={card.onClick}
          className="rounded-lg border bg-card p-3 text-left transition-all hover:shadow-sm hover:border-border"
          data-testid={card.testId}
        >
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-lg ${card.bg} flex items-center justify-center shrink-0`}>
              <span className={card.color}>{card.icon}</span>
            </div>
            <div className="min-w-0">
              <p className={`text-lg font-semibold leading-none ${card.color}`}>{card.value}</p>
              <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider">{card.label}</p>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
