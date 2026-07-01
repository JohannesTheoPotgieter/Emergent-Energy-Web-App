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
  // `chip` is the dark-safe icon-tile class (border+bg+text in one), keyed by
  // meaning; state cards fall back to a neutral tile when their count is zero.
  const cards = [
    {
      label: "Open Work",
      value: totalOpenWork,
      icon: <ListTodo className="w-3.5 h-3.5" />,
      chip: "ee-status-info",
      onClick: onReset,
      testId: "summary-open-work",
    },
    {
      label: "Unassigned",
      value: unassignedCount,
      icon: <UserCheck className="w-3.5 h-3.5" />,
      chip: "ee-status-neutral",
      onClick: () => onSelectWorkloadState("unassigned"),
      testId: "summary-unassigned",
    },
    {
      label: "Blocked",
      value: blockedCount,
      icon: <PauseCircle className="w-3.5 h-3.5" />,
      chip: blockedCount > 0 ? "ee-status-danger" : "ee-status-neutral",
      onClick: () => onSelectWorkloadState("blocked"),
      testId: "summary-blocked",
    },
    {
      label: "Review",
      value: reviewCount,
      icon: <MessageSquare className="w-3.5 h-3.5" />,
      chip: reviewCount > 0 ? "ee-status-accent" : "ee-status-neutral",
      onClick: () => onSelectWorkloadState("review"),
      testId: "summary-review",
    },
    {
      label: "Approval",
      value: approvalCount,
      icon: <ShieldCheck className="w-3.5 h-3.5" />,
      chip: approvalCount > 0 ? "ee-status-warning" : "ee-status-neutral",
      onClick: () => onSelectWorkloadState("approval"),
      testId: "summary-approval-pending",
    },
    {
      label: "Deliverables",
      value: deliverableCount,
      icon: <Paperclip className="w-3.5 h-3.5" />,
      chip: deliverableCount > 0 ? "ee-status-info" : "ee-status-neutral",
      onClick: () => onSelectWorkloadState("deliverable"),
      testId: "summary-deliverables",
    },
    {
      label: "MS Actions",
      value: microsoftActionCount,
      icon: <ExternalLink className="w-3.5 h-3.5" />,
      chip: microsoftActionCount > 0 ? "ee-status-info" : "ee-status-neutral",
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
            <div className={`w-8 h-8 rounded-lg border ${card.chip} flex items-center justify-center shrink-0`}>
              {card.icon}
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-semibold tabular-nums leading-none text-foreground">{card.value}</p>
              <p className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">{card.label}</p>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
