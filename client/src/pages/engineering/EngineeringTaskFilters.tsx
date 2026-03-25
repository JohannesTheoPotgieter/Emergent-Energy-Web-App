import { useState, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import {
  ListTodo,
  PauseCircle,
  MessageSquare,
  ShieldCheck,
  UserCheck,
  Paperclip,
  ExternalLink,
} from "lucide-react";
import type {
  EngineeringDueDateFilter,
  EngineeringWorkloadStateFilter,
  EngineeringLinkedSourceFilter,
} from "@/hooks/useEngineeringTaskFilters";

// ── Filter option constants ──────────────────────────────────────────────────

export const PRIORITIES = ["Critical", "Urgent", "High", "Medium", "Low"];

export const DUE_DATE_FILTER_OPTIONS: { value: EngineeringDueDateFilter; label: string }[] = [
  { value: "all", label: "All Due Dates" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due Today" },
  { value: "this_week", label: "Due In 7 Days" },
  { value: "no_due_date", label: "No Due Date" },
];

export const WORKLOAD_STATE_OPTIONS: { value: EngineeringWorkloadStateFilter; label: string }[] = [
  { value: "all", label: "All Work States" },
  { value: "unassigned", label: "Unassigned" },
  { value: "blocked", label: "Blocked" },
  { value: "review", label: "Review Needed" },
  { value: "approval", label: "Approval Pending" },
  { value: "deliverable", label: "Project Deliverables" },
  { value: "microsoft_action", label: "Microsoft Actions" },
];

export const LINKED_SOURCE_OPTIONS: { value: EngineeringLinkedSourceFilter; label: string }[] = [
  { value: "all", label: "All Linked Sources" },
  { value: "project_linked", label: "Project Linked" },
  { value: "project_unlinked", label: "No Project Link" },
  { value: "microsoft_linked", label: "Microsoft Linked" },
  { value: "microsoft_action_required", label: "Microsoft Action Required" },
];

export const priorityColors: Record<string, string> = {
  Critical: "bg-red-600 text-white",
  Urgent: "bg-orange-100 text-orange-700",
  High: "bg-amber-100 text-amber-700",
  Medium: "bg-blue-100 text-blue-700",
  Low: "bg-muted text-muted-foreground",
};

export const priorityBorderColors: Record<string, string> = {
  Critical: "border-l-red-600",
  Urgent: "border-l-orange-500",
  High: "border-l-amber-500",
  Medium: "border-l-blue-400",
  Low: "border-l-gray-300",
};

export const SAVED_FILTERS: {
  label: string;
  filter: {
    status?: string;
    dueDateFilter?: EngineeringDueDateFilter;
    workloadStateFilter?: EngineeringWorkloadStateFilter;
    linkedSourceFilter?: EngineeringLinkedSourceFilter;
  };
}[] = [
  { label: "Overdue", filter: { dueDateFilter: "overdue" } },
  { label: "Unassigned", filter: { workloadStateFilter: "unassigned" } },
  { label: "Blocked", filter: { workloadStateFilter: "blocked" } },
  { label: "Review Needed", filter: { workloadStateFilter: "review" } },
  { label: "Approval Pending", filter: { workloadStateFilter: "approval" } },
  { label: "Deliverables", filter: { workloadStateFilter: "deliverable" } },
  { label: "Microsoft Linked", filter: { linkedSourceFilter: "microsoft_linked" } },
];

// ── Local storage helpers ────────────────────────────────────────────────────

export type { EngineeringDueDateFilter, EngineeringWorkloadStateFilter, EngineeringLinkedSourceFilter };

import type { EngDefaultView } from "@/components/tasks/types";

export function getSavedMyName(): string {
  return localStorage.getItem("eng_my_name") || "";
}

export function setSavedMyName(name: string) {
  localStorage.setItem("eng_my_name", name);
}

function getEngViewKey(userId?: number): string {
  return `eng_default_view_${userId || "default"}`;
}

export function getSavedEngDefaultView(userId?: number): EngDefaultView | null {
  try {
    const raw = localStorage.getItem(getEngViewKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const validViews = ["board", "list", "projects", "mytasks"];
    if (!validViews.includes(parsed.viewMode)) parsed.viewMode = "board";
    return parsed;
  } catch { return null; }
}

export function saveEngDefaultView(view: EngDefaultView, userId?: number) {
  localStorage.setItem(getEngViewKey(userId), JSON.stringify(view));
}

export function clearEngDefaultView(userId?: number) {
  localStorage.removeItem(getEngViewKey(userId));
}

// ── Workload strip component ─────────────────────────────────────────────────

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
