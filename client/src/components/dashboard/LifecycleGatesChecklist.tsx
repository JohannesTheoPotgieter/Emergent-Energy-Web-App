/**
 * Lifecycle Gates Checklist — renders business-critical lifecycle checkpoints
 * as a prominent operational surface on role homepages.
 *
 * These gates are first-class operational surfaces, not hidden data fields:
 * - Cost Proposal & Design
 * - Signature & Financial Close
 * - PD to PM Handover
 * - Financial Review
 * - Weekly Client Communication
 * - Commissioning
 * - O&M Handover
 * - Client Handover
 */

import { Link } from "wouter";
import { LIFECYCLE_GATES } from "@shared/schema/role-based-upgrade";
import { CheckCircle, Circle, ArrowRight } from "lucide-react";

interface LifecycleGatesChecklistProps {
  /** Optional: highlight specific gates as complete/active/blocked */
  gateStatuses?: Record<string, "complete" | "active" | "blocked" | "pending">;
  /** Compact mode for smaller widgets */
  compact?: boolean;
}

const STATUS_STYLES = {
  complete: "text-emerald-600 dark:text-emerald-400",
  active: "text-amber-600 dark:text-amber-400",
  blocked: "text-red-600 dark:text-red-400",
  pending: "text-gray-400 dark:text-gray-500",
};

export function LifecycleGatesChecklist({ gateStatuses = {}, compact = false }: LifecycleGatesChecklistProps) {
  return (
    <div className={`space-y-1 ${compact ? "text-xs" : "text-sm"}`}>
      <h3 className="font-semibold text-foreground mb-2 flex items-center gap-2">
        <CheckCircle className="h-4 w-4 text-emerald-600" />
        Lifecycle Gates
      </h3>
      <div className={compact ? "space-y-0.5" : "space-y-1"}>
        {LIFECYCLE_GATES.map((gate) => {
          const status = gateStatuses[gate.key] || "pending";
          const statusClass = STATUS_STYLES[status];
          return (
            <Link
              key={gate.key}
              href={gate.path}
              className={`
                flex items-center gap-2 px-2 py-1.5 rounded-md
                hover:bg-gray-50 dark:hover:bg-gray-800/50
                transition-colors group cursor-pointer
              `}
            >
              {status === "complete" ? (
                <CheckCircle className={`h-3.5 w-3.5 flex-shrink-0 ${statusClass}`} />
              ) : (
                <Circle className={`h-3.5 w-3.5 flex-shrink-0 ${statusClass}`} />
              )}
              <span className={`flex-1 ${status === "complete" ? "text-muted-foreground line-through" : "text-foreground"}`}>
                {gate.label}
              </span>
              <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                status === "active" ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" :
                status === "blocked" ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300" :
                status === "complete" ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300" :
                "bg-gray-100 dark:bg-gray-800 text-gray-500"
              }`}>
                {status}
              </span>
              <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
