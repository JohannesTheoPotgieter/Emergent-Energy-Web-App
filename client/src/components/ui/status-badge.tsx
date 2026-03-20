import * as React from "react";
import { cn } from "@/lib/utils";
import { normalizeToUniversalStatus, UNIVERSAL_STATUS_META, type UniversalDisplayStatus } from "@shared/task-status";
import { RAG_COLORS, type RagLevel } from "@/lib/status-colors";

// ─── Universal Status Badge ──────────────────────────────────────────────────

export interface StatusBadgeProps {
  /** Raw status string from any source — will be normalized automatically */
  status: string | null | undefined;
  /** Show dot indicator instead of full badge */
  dotOnly?: boolean;
  /** Size variant */
  size?: "sm" | "md";
  className?: string;
}

/**
 * Universal status badge that normalizes any task status string (from Plan, Engineering,
 * MyTool, or Operational tasks) to a consistent visual appearance.
 */
export function StatusBadge({ status, dotOnly, size = "md", className }: StatusBadgeProps) {
  const normalized = normalizeToUniversalStatus(status);
  const meta = UNIVERSAL_STATUS_META[normalized];

  if (dotOnly) {
    return (
      <span
        className={cn("inline-block rounded-full", meta.dotColor, size === "sm" ? "w-2 h-2" : "w-2.5 h-2.5", className)}
        title={meta.label}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium",
        meta.badgeClass,
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
        className,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", meta.dotColor)} />
      {meta.label}
    </span>
  );
}

// ─── RAG Badge ───────────────────────────────────────────────────────────────

export interface RagBadgeProps {
  rag: RagLevel | string | null | undefined;
  /** Show as dot only */
  dotOnly?: boolean;
  /** Show label text */
  showLabel?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/** RAG (Red/Amber/Green) status indicator badge */
export function RagBadge({ rag, dotOnly, showLabel = true, size = "md", className }: RagBadgeProps) {
  const level = (rag || "").toLowerCase() as RagLevel;
  const colors = RAG_COLORS[level];

  if (!colors) {
    return (
      <span className={cn("inline-block rounded-full bg-gray-300", size === "sm" ? "w-2 h-2" : "w-2.5 h-2.5", className)} />
    );
  }

  if (dotOnly) {
    return (
      <span
        className={cn("inline-block rounded-full", colors.dot, size === "sm" ? "w-2 h-2" : "w-2.5 h-2.5", className)}
        title={level.charAt(0).toUpperCase() + level.slice(1)}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium",
        colors.bg, colors.text, colors.border,
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
        className,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", colors.dot)} />
      {showLabel && (level.charAt(0).toUpperCase() + level.slice(1))}
    </span>
  );
}

// ─── Priority Badge ──────────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<string, { badge: string; dot: string; label: string }> = {
  critical: { badge: "bg-red-100 text-red-700 border-red-200", dot: "bg-red-500", label: "Critical" },
  high:     { badge: "bg-orange-100 text-orange-700 border-orange-200", dot: "bg-orange-500", label: "High" },
  normal:   { badge: "bg-blue-100 text-blue-700 border-blue-200", dot: "bg-blue-500", label: "Normal" },
  low:      { badge: "bg-green-100 text-green-700 border-green-200", dot: "bg-green-500", label: "Low" },
};

export interface PriorityBadgeProps {
  priority: string | null | undefined;
  size?: "sm" | "md";
  className?: string;
}

export function PriorityBadge({ priority, size = "md", className }: PriorityBadgeProps) {
  const p = (priority || "normal").toLowerCase();
  const normalized = p === "urgent" || p === "p1" ? "critical" : p === "p2" ? "high" : p === "p4" ? "low" : PRIORITY_STYLES[p] ? p : "normal";
  const style = PRIORITY_STYLES[normalized];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium",
        style.badge,
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
        className,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", style.dot)} />
      {style.label}
    </span>
  );
}
