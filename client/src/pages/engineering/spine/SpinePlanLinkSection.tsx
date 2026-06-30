/**
 * Project-plan link section for the spine TaskDrawer.
 *
 * Links an engineering task to a project-plan task (a plan-kind work_item on the
 * same project). The engineering task's due date is DERIVED from the plan task:
 *   - 'before' (leads):   due = plan start − leadDays
 *   - 'after'  (follows): due = plan end   + leadDays
 * The derived due date is persisted on link and re-derived at read time, so it
 * stays correct if the plan task's date later moves.
 *
 * Spine endpoints:
 *   GET   /api/engineering/tasks/:id/plan-candidates -> { candidates }
 *   PATCH /api/engineering/tasks/:id/plan-link        { planItemId, relation?, leadDays? }
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarClock, Link2, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { formatDateShort, daysLabel } from "@/lib/task-formatters";
import type { useToast } from "@/hooks/use-toast";
import type {
  SpinePlanCandidate,
  SpinePlanCandidatesResponse,
  SpinePlanLinkRelation,
} from "./spine-task-types";

type ToastFn = ReturnType<typeof useToast>["toast"];

const PICK_PLACEHOLDER = "__pick__";
const DEFAULT_LEAD_DAYS = 5;

/** Current plan-link state for the open task, read off the list row. */
export interface PlanLinkState {
  planLinkItemId: number | null;
  planLinkRelation: string | null;
  planLinkLeadDays: number | null;
  planItemTitle: string | null;
  planAnchorDate: string | null;
  planLinkUrgent: boolean;
  /** Read-time derived due date (already synced server-side). */
  derivedDue: string | null;
  status: string;
}

/** Preview the derived due date for a candidate + relation + leadDays. */
function previewDerivedDue(
  candidate: SpinePlanCandidate | undefined,
  relation: SpinePlanLinkRelation,
  leadDays: number,
): { due: string | null; anchorMissing: boolean } {
  if (!candidate) return { due: null, anchorMissing: false };
  const anchor = relation === "before" ? candidate.startDate : candidate.endDate;
  if (!anchor) return { due: null, anchorMissing: true };
  const [y, m, d] = anchor.split("-").map(Number);
  const base = Date.UTC(y, (m ?? 1) - 1, d ?? 1);
  const shifted = new Date(base + (relation === "before" ? -leadDays : leadDays) * 86400000);
  return {
    due: `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(
      shifted.getUTCDate(),
    ).padStart(2, "0")}`,
    anchorMissing: false,
  };
}

function relationLabel(relation: string | null): string {
  if (relation === "before") return "Leads — due 5 days before start";
  if (relation === "after") return "Follows — due 5 days after end";
  return "—";
}

export function SpinePlanLinkSection({
  taskId,
  open,
  toast,
  state,
  canEdit,
  onChanged,
}: {
  taskId: number;
  open: boolean;
  toast: ToastFn;
  state: PlanLinkState;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const linked = state.planLinkItemId != null;
  const [editing, setEditing] = useState(false);
  const [pick, setPick] = useState(PICK_PLACEHOLDER);
  const [relation, setRelation] = useState<SpinePlanLinkRelation>("after");
  const [leadDays, setLeadDays] = useState(DEFAULT_LEAD_DAYS);

  const showPicker = !linked || editing;

  const candidatesQuery = useQuery<SpinePlanCandidatesResponse>({
    queryKey: ["/api/engineering/tasks", taskId, "plan-candidates"],
    enabled: open && showPicker,
  });
  const candidates = candidatesQuery.data?.candidates ?? [];
  const selectedCandidate = candidates.find((c) => String(c.id) === pick);
  const preview = useMemo(
    () => previewDerivedDue(selectedCandidate, relation, leadDays),
    [selectedCandidate, relation, leadDays],
  );

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["/api/engineering/tasks", taskId, "plan-candidates"] });
    qc.invalidateQueries({ queryKey: ["/api/engineering/tasks"] });
    onChanged();
  }

  const setMutation = useMutation({
    mutationFn: async (body: { planItemId: number | null; relation?: SpinePlanLinkRelation; leadDays?: number }) =>
      apiRequest("PATCH", `/api/engineering/tasks/${taskId}/plan-link`, body),
    onSuccess: () => {
      setEditing(false);
      setPick(PICK_PLACEHOLDER);
      setRelation("after");
      setLeadDays(DEFAULT_LEAD_DAYS);
      invalidate();
    },
    onError: (e: unknown) =>
      toast({
        title: "Couldn't update plan link",
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  const urgentOverdue = state.derivedDue ? daysLabel(state.derivedDue)?.toLowerCase().includes("ago") : false;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5" />
          Project plan link
        </Label>
        {state.planLinkUrgent ? (
          <Badge
            variant="outline"
            className={
              "text-[10px] " +
              (urgentOverdue
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-amber-200 bg-amber-50 text-amber-700")
            }
            data-testid="plan-link-urgent-badge"
          >
            {urgentOverdue ? "Overdue" : `Urgent — plan in ${daysLabel(state.derivedDue) ?? "soon"}`}
          </Badge>
        ) : null}
      </div>

      {linked ? (
        <div
          className="space-y-1 rounded border border-border/60 px-2 py-2 text-xs"
          data-testid="plan-link-current"
        >
          <div className="flex items-center gap-1.5">
            <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
            <Badge variant="outline" className="border-indigo-200 bg-indigo-50 px-1 py-0 text-[9px] text-indigo-700">
              Plan
            </Badge>
            <span className="truncate font-medium">{state.planItemTitle ?? `Plan task #${state.planLinkItemId}`}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">{relationLabel(state.planLinkRelation)}</p>
          {state.derivedDue ? (
            <p className="text-[11px]">
              Derived due:{" "}
              <span className="font-medium tabular-nums">{formatDateShort(state.derivedDue)}</span>
            </p>
          ) : (
            <p className="text-[11px] italic text-amber-700" data-testid="plan-link-no-date">
              Plan task has no date — due date not derived.
            </p>
          )}
          {canEdit ? (
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() => setEditing((v) => !v)}
                data-testid="plan-link-change"
              >
                {editing ? "Cancel" : "Change"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-red-600"
                disabled={setMutation.isPending}
                onClick={() => setMutation.mutate({ planItemId: null })}
                data-testid="plan-link-unlink"
              >
                <X className="h-3 w-3" />
                Unlink
              </Button>
            </div>
          ) : null}
        </div>
      ) : canEdit ? (
        <p className="text-xs text-muted-foreground">Link to a plan task to drive this task's due date.</p>
      ) : (
        <p className="text-xs text-muted-foreground">Not linked to a plan task.</p>
      )}

      {canEdit && showPicker ? (
        <div className="space-y-2 rounded border border-border/60 p-2" data-testid="plan-link-editor">
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger className="h-8" data-testid="plan-link-picker">
              <SelectValue placeholder="Pick a plan task…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PICK_PLACEHOLDER} disabled>
                Pick a plan task…
              </SelectItem>
              {candidates.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2">
            <Select value={relation} onValueChange={(v) => setRelation(v as SpinePlanLinkRelation)}>
              <SelectTrigger className="h-8" data-testid="plan-link-relation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="before">Before (leads)</SelectItem>
                <SelectItem value="after">After (follows)</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5">
              <Label htmlFor="plan-link-lead" className="whitespace-nowrap text-[11px] text-muted-foreground">
                Lead days
              </Label>
              <Input
                id="plan-link-lead"
                type="number"
                min={0}
                max={365}
                value={leadDays}
                onChange={(e) => setLeadDays(Math.max(0, Math.min(365, Number(e.target.value) || 0)))}
                className="h-8 w-16"
                data-testid="plan-link-lead-days"
              />
            </div>
          </div>

          {selectedCandidate ? (
            <p className="text-[11px] text-muted-foreground" data-testid="plan-link-preview">
              {preview.anchorMissing ? (
                <span className="italic text-amber-700">
                  Plan task has no {relation === "before" ? "start" : "end"} date — due date won't be derived.
                </span>
              ) : (
                <>
                  Derived due:{" "}
                  <span className="font-medium tabular-nums">{formatDateShort(preview.due)}</span>{" "}
                  ({relation === "before" ? "lead before start" : "follow after end"})
                </>
              )}
            </p>
          ) : null}

          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={pick === PICK_PLACEHOLDER || setMutation.isPending}
            onClick={() => setMutation.mutate({ planItemId: Number(pick), relation, leadDays })}
            data-testid="plan-link-save"
          >
            {linked ? "Update link" : "Link to plan task"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
