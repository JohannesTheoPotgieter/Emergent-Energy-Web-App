/**
 * DocumentControlBadge — single source of truth for rendering a
 * deliverable's controlled-document state (draft → under review →
 * approved for review → issued for construction → as-built | superseded).
 *
 * Use this EVERYWHERE a deliverable's lifecycle is shown. Never render a
 * bare "Approved" pill yourself — that was the conflation that got us
 * here.
 */
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, CheckCircle2, Clock, Circle, XCircle, Ban } from "lucide-react";
import {
  CONTROL_STATE_META,
  deriveControlState,
  type ControlState,
} from "@/lib/engineering-control-state";

interface DocumentControlBadgeProps {
  /** Either a deliverable row or an explicit state. */
  row?: { releasedFor?: string | null; approvalStatus?: string | null };
  state?: ControlState;
  /** Render a smaller version for dense lists. */
  compact?: boolean;
  /** Optional data-testid for QA. */
  "data-testid"?: string;
}

const ICON_BY_STATE: Record<ControlState, React.ComponentType<{ className?: string }>> = {
  draft: Circle,
  under_review: Clock,
  approved_for_review: CheckCircle2,
  issued_for_construction: ShieldCheck,
  as_built: ShieldCheck,
  superseded: Ban,
};

export function DocumentControlBadge({
  row,
  state,
  compact = false,
  "data-testid": testId,
}: DocumentControlBadgeProps) {
  const control: ControlState = state ?? (row ? deriveControlState(row) : "draft");
  const meta = CONTROL_STATE_META[control];
  const Icon = ICON_BY_STATE[control];
  const sizeClass = compact ? "text-[9px] px-1 py-0 gap-0.5" : "text-[10px] px-1.5 py-0.5 gap-1";
  const iconSize = compact ? "h-2.5 w-2.5" : "h-3 w-3";
  return (
    <Badge
      className={`${meta.badgeClass} ${sizeClass} inline-flex items-center font-medium whitespace-nowrap`}
      title={meta.description}
      data-testid={testId ?? `doc-control-${control}`}
      data-control-state={control}
      data-construction-safe={meta.isConstructionSafe ? "true" : "false"}
    >
      <Icon className={iconSize} />
      <span>{meta.label}</span>
    </Badge>
  );
}

export default DocumentControlBadge;

/**
 * Guard rendered on a task row that says "this document has NOT been
 * issued for construction". Use on any site-facing list so that a
 * reviewed-but-not-released document cannot be mistaken for an IFC doc.
 */
export function NotForConstructionHint({ state }: { state: ControlState }) {
  if (CONTROL_STATE_META[state].isConstructionSafe) return null;
  if (state === "superseded") {
    return (
      <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
        <XCircle className="h-3 w-3" /> Do not use — superseded
      </span>
    );
  }
  return (
    <span className="text-[10px] text-amber-700 inline-flex items-center gap-1">
      <XCircle className="h-3 w-3" /> Not yet Issued For Construction
    </span>
  );
}
