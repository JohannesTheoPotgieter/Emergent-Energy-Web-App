import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { PHASES } from "@shared/phases";
import type { LinkedProject } from "@/lib/priority-types";

export type ProgressSourceType =
  | "manual"
  | "project_phase"
  | "project_percent"
  | "milestone_revenue"
  | "tasks_rollup";

export interface ProgressSourceRef {
  projectId?: number;
  phaseCode?: string;
  milestoneId?: number;
  workItemIds?: number[];
}

export interface ProgressSourceValue {
  type: ProgressSourceType;
  ref: ProgressSourceRef | null;
  /** Manual % entered by the user when type === "manual". String to match
   *  the existing form-state convention. */
  manualProgress: string;
}

interface OptionsResponse {
  projectId: number | null;
  milestones: Array<{
    id: number;
    name: string | null;
    no: string | null;
    paidDate: string | null;
    invoiceNumber: string | null;
  }>;
  workItems: Array<{
    id: number;
    title: string | null;
    status: string | null;
    percentComplete: number;
  }>;
}

interface Props {
  value: ProgressSourceValue;
  onChange: (next: ProgressSourceValue) => void;
  /** Linked projects on the priority — drives the project dropdown. */
  linkedProjects: LinkedProject[];
}

const TYPE_LABEL: Record<ProgressSourceType, string> = {
  manual: "Manual %",
  project_phase: "Project phase reached",
  project_percent: "Project overall % complete",
  milestone_revenue: "Revenue milestone",
  tasks_rollup: "Tasks roll-up",
};

export function ProgressSourcePicker({ value, onChange, linkedProjects }: Props) {
  const ref = value.ref || {};
  const [projectId, setProjectId] = useState<number | undefined>(ref.projectId);

  // Keep local projectId in sync when caller swaps value (e.g. dialog reopen).
  useEffect(() => {
    setProjectId(value.ref?.projectId);
  }, [value.ref?.projectId, value.type]);

  const needsOptions =
    value.type === "milestone_revenue" || value.type === "tasks_rollup";

  const { data: options } = useQuery<OptionsResponse>({
    queryKey: ["/api/priorities/progress-source-options", projectId],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/priorities/progress-source-options?projectId=${projectId}`,
      );
      return res.json();
    },
    enabled: !!projectId && needsOptions,
  });

  const projectOptions = useMemo(() => {
    return linkedProjects
      .filter((p) => Number.isFinite(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name || `Project #${p.id}`,
      }));
  }, [linkedProjects]);

  // Auto-select the only linked project when a non-manual source is chosen
  // and no project is set yet — saves a click in the common single-project case.
  useEffect(() => {
    if (value.type === "manual") return;
    if (ref.projectId) return;
    if (projectOptions.length !== 1) return;
    const only = projectOptions[0].id;
    setProjectId(only);
    onChange({ ...value, ref: { ...(value.ref || {}), projectId: only } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.type, projectOptions.length, ref.projectId]);

  function setType(t: ProgressSourceType) {
    if (t === "manual") {
      onChange({ ...value, type: "manual", ref: null });
    } else {
      // Preserve projectId between non-manual types so the user doesn't
      // have to reselect when switching from "phase" to "milestone".
      onChange({ ...value, type: t, ref: { projectId: ref.projectId } });
    }
  }

  function patchRef(patch: Partial<ProgressSourceRef>) {
    onChange({ ...value, ref: { ...(value.ref || {}), ...patch } });
  }

  function selectProject(idStr: string) {
    const id = parseInt(idStr, 10);
    setProjectId(id);
    // Reset downstream fields that depend on the project.
    onChange({
      ...value,
      ref: { projectId: id },
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Progress source</Label>
        <Select value={value.type} onValueChange={(v) => setType(v as ProgressSourceType)}>
          <SelectTrigger data-testid="select-progress-source-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(TYPE_LABEL) as ProgressSourceType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {TYPE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {value.type === "manual" && (
        <div>
          <Label className="text-xs">Manual progress %</Label>
          <Input
            type="number"
            min={0}
            max={100}
            value={value.manualProgress}
            onChange={(e) => onChange({ ...value, manualProgress: e.target.value })}
            data-testid="input-manual-progress"
          />
        </div>
      )}

      {value.type !== "manual" && (
        <div>
          <Label className="text-xs">Project</Label>
          {projectOptions.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              Link a project to this priority first to use a non-manual source.
            </p>
          ) : (
            <Select
              value={ref.projectId ? String(ref.projectId) : ""}
              onValueChange={selectProject}
            >
              <SelectTrigger data-testid="select-progress-source-project">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projectOptions.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {value.type === "project_phase" && ref.projectId && (
        <div>
          <Label className="text-xs">Phase to reach</Label>
          <Select
            value={ref.phaseCode || ""}
            onValueChange={(v) => patchRef({ phaseCode: v })}
          >
            <SelectTrigger data-testid="select-progress-source-phase">
              <SelectValue placeholder="Select phase" />
            </SelectTrigger>
            <SelectContent>
              {PHASES.map((p) => (
                <SelectItem key={p.code} value={p.code}>
                  {p.displayNumber}. {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1">
            100% once project reaches or passes this phase.
          </p>
        </div>
      )}

      {value.type === "milestone_revenue" && ref.projectId && (
        <div>
          <Label className="text-xs">Milestone</Label>
          {options && options.milestones.length > 0 ? (
            <Select
              value={ref.milestoneId ? String(ref.milestoneId) : ""}
              onValueChange={(v) => patchRef({ milestoneId: parseInt(v, 10) })}
            >
              <SelectTrigger data-testid="select-progress-source-milestone">
                <SelectValue placeholder="Select milestone" />
              </SelectTrigger>
              <SelectContent>
                {options.milestones.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.no ? `${m.no} · ` : ""}{m.name || `Milestone #${m.id}`}
                    {m.paidDate ? " (paid)" : m.invoiceNumber ? " (invoiced)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-xs text-muted-foreground py-2">
              {options ? "No milestones found for this project." : "Loading…"}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground mt-1">
            0% planned · 60% invoiced · 100% paid.
          </p>
        </div>
      )}

      {value.type === "tasks_rollup" && ref.projectId && (
        <div>
          <Label className="text-xs">Tasks (averaged)</Label>
          {options && options.workItems.length > 0 ? (
            <div className="max-h-48 overflow-y-auto border rounded p-2 space-y-1">
              {options.workItems.map((w) => {
                const checked = (ref.workItemIds || []).includes(w.id);
                return (
                  <label
                    key={w.id}
                    className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/40 rounded px-1 py-0.5"
                    data-testid={`row-progress-source-task-${w.id}`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(c) => {
                        const cur = new Set(ref.workItemIds || []);
                        if (c) cur.add(w.id); else cur.delete(w.id);
                        patchRef({ workItemIds: Array.from(cur) });
                      }}
                    />
                    <span className="flex-1 truncate">{w.title || `Task #${w.id}`}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {w.percentComplete}%
                    </Badge>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-2">
              {options ? "No tasks found for this project." : "Loading…"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
