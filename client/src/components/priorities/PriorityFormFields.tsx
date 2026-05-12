import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { apiRequest } from "@/lib/queryClient";
import { DEPARTMENT_OPTIONS } from "@shared/config/priorities";
import { useUserOptions, useProjectOptions } from "./usePriorityPickers";
import {
  ProgressSourcePicker,
  type ProgressSourceValue,
} from "./ProgressSourcePicker";
import type { LinkedProject, PriorityRow } from "@/lib/priority-types";

/**
 * Shared form fields used by both the "Add Priority" and "Edit Priority"
 * dialogs so they always stay in lock-step. The two callers differ only in
 * the mutation they fire on submit and a couple of mode-conditional fields:
 *  - `status` is only meaningful on edit
 *  - `project_ids` picker is only shown on create (edit page has its own
 *    Link-project workflow)
 *  - `progressSource` picker shows on edit; on create we use a plain
 *    "Manual %" field (linked sources don't make sense until the priority
 *    has a project linked).
 */
export interface PriorityFormState {
  title: string;
  description: string;
  scope: string;
  severity: string;
  status: string;
  horizon: string;
  due_date: string;
  target_outcome: string;
  next_action: string;
  definition_of_done: string;
  manual_health: string;
  manual_progress: string;
  department_key: string;
  owner_user_id: string;
  accountable_exec_id: string;
  assigned_user_id: string;
  parent_id: string;
  project_ids: number[];
}

export const emptyPriorityForm: PriorityFormState = {
  title: "",
  description: "",
  scope: "company",
  severity: "normal",
  status: "active",
  horizon: "quarter",
  due_date: "",
  target_outcome: "",
  next_action: "",
  definition_of_done: "",
  manual_health: "",
  manual_progress: "",
  department_key: "",
  owner_user_id: "",
  accountable_exec_id: "",
  assigned_user_id: "",
  parent_id: "",
  project_ids: [],
};

interface Props {
  form: PriorityFormState;
  patch: (delta: Partial<PriorityFormState>) => void;
  mode: "create" | "edit";
  /** Required when mode === "edit" — drives the linked-source picker. */
  progressSource?: ProgressSourceValue;
  onProgressSourceChange?: (next: ProgressSourceValue) => void;
  /** Only used in edit mode to populate the Progress source project picker. */
  linkedProjects?: LinkedProject[];
  /** When editing, the priority's own id so we can exclude it from the parent
   *  picker (a priority can't be its own parent). */
  excludePriorityId?: number;
}

export function PriorityFormFields({
  form,
  patch,
  mode,
  progressSource,
  onProgressSourceChange,
  linkedProjects,
  excludePriorityId,
}: Props) {
  const userOptions = useUserOptions(true);
  const projectOptions = useProjectOptions(true);
  const [projectSearch, setProjectSearch] = useState("");

  // Parent-priority picker — always available when scope is dept/role so
  // a department priority can be linked under a company one (and a role
  // priority under either). We pull company + department priorities and
  // filter client-side based on scope.
  const { data: parentCandidates = [] } = useQuery<PriorityRow[]>({
    queryKey: ["/api/priorities", "parent-candidates"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        "/api/priorities?scope=company&include_cancelled=false",
      );
      const company = (await res.json()) as PriorityRow[];
      const res2 = await apiRequest(
        "GET",
        "/api/priorities?scope=department&include_cancelled=false&include_team_roles=true",
      );
      const dept = (await res2.json()) as PriorityRow[];
      return [...company, ...dept];
    },
    enabled: form.scope !== "company",
    staleTime: 30_000,
  });

  const parentOptions = useMemo(() => {
    return parentCandidates
      .filter((p) => p.id !== excludePriorityId)
      .filter((p) => {
        // Department priority can attach to a company priority.
        // Role priority can attach to company OR a same-department dept priority.
        if (form.scope === "department") return p.scope === "company";
        if (form.scope === "role") {
          if (p.scope === "company") return true;
          if (p.scope === "department") {
            return !form.department_key || p.departmentKey === form.department_key;
          }
        }
        return false;
      })
      .map((p) => ({
        value: String(p.id),
        label: `${p.scope === "company" ? "Company" : "Dept"}: ${p.title}`,
      }));
  }, [parentCandidates, form.scope, form.department_key, excludePriorityId]);

  const filteredProjects = useMemo(() => {
    const needle = projectSearch.trim().toLowerCase();
    if (!needle) return projectOptions;
    return projectOptions.filter((p) => p.label.toLowerCase().includes(needle));
  }, [projectOptions, projectSearch]);

  const toggleProjectId = (id: number) => {
    patch({
      project_ids: form.project_ids.includes(id)
        ? form.project_ids.filter((x) => x !== id)
        : [...form.project_ids, id],
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Title *</Label>
        <Input
          value={form.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="Priority title"
          data-testid="input-priority-title"
        />
      </div>

      <div>
        <Label className="text-xs">Description</Label>
        <Textarea
          value={form.description}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder="Brief description"
          rows={2}
          data-testid="input-priority-description"
        />
      </div>

      <div className={mode === "edit" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" : "grid grid-cols-1 sm:grid-cols-3 gap-3"}>
        <div>
          <Label className="text-xs">Scope</Label>
          <Select value={form.scope} onValueChange={(v) => patch({ scope: v })}>
            <SelectTrigger data-testid="select-priority-scope"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="company">Company</SelectItem>
              <SelectItem value="department">Department</SelectItem>
              <SelectItem value="role">Role / Individual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Severity</Label>
          <Select value={form.severity} onValueChange={(v) => patch({ severity: v })}>
            <SelectTrigger data-testid="select-priority-severity"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="important">High</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Horizon</Label>
          <Select value={form.horizon} onValueChange={(v) => patch({ horizon: v })}>
            <SelectTrigger data-testid="select-priority-horizon"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This week</SelectItem>
              <SelectItem value="month">This month</SelectItem>
              <SelectItem value="quarter">This quarter</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {mode === "edit" && (
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={(v) => patch({ status: v })}>
              <SelectTrigger data-testid="select-priority-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="monitoring">Monitoring</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {(form.scope === "department" || form.scope === "role") && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Department</Label>
            <Select value={form.department_key} onValueChange={(v) => patch({ department_key: v })}>
              <SelectTrigger data-testid="select-priority-department">
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                {DEPARTMENT_OPTIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Parent priority (optional)</Label>
            {parentOptions.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                No higher-level priorities to link to.
              </p>
            ) : (
              <Select
                value={form.parent_id || "none"}
                onValueChange={(v) => patch({ parent_id: v === "none" ? "" : v })}
              >
                <SelectTrigger data-testid="select-priority-parent">
                  <SelectValue placeholder="Standalone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Standalone —</SelectItem>
                  {parentOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Owner</Label>
          <SearchableSelect
            options={userOptions}
            value={form.owner_user_id}
            onValueChange={(v) => patch({ owner_user_id: v })}
            placeholder="Who drives this?"
            searchPlaceholder="Search people..."
          />
        </div>
        <div>
          <Label className="text-xs">Accountable exec</Label>
          <SearchableSelect
            options={userOptions}
            value={form.accountable_exec_id}
            onValueChange={(v) => patch({ accountable_exec_id: v })}
            placeholder="Executive sponsor"
            searchPlaceholder="Search people..."
          />
        </div>
      </div>

      {form.scope === "role" && (
        <div>
          <Label className="text-xs">Assign to</Label>
          <SearchableSelect
            options={userOptions}
            value={form.assigned_user_id}
            onValueChange={(v) => patch({ assigned_user_id: v })}
            placeholder="Select person"
            searchPlaceholder="Search people..."
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Due Date</Label>
          <Input
            type="date"
            value={form.due_date}
            onChange={(e) => patch({ due_date: e.target.value })}
            data-testid="input-priority-due-date"
          />
        </div>
        <div>
          <Label className="text-xs">Manual health</Label>
          <Select
            value={form.manual_health || "none"}
            onValueChange={(v) => patch({ manual_health: v === "none" ? "" : v })}
          >
            <SelectTrigger data-testid="select-priority-health">
              <SelectValue placeholder="Auto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Auto</SelectItem>
              <SelectItem value="healthy">Healthy</SelectItem>
              <SelectItem value="at_risk">At Risk</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Progress: linked-source picker on edit, simple manual % on create. */}
      {mode === "edit" && progressSource && onProgressSourceChange ? (
        <ProgressSourcePicker
          value={progressSource}
          onChange={onProgressSourceChange}
          linkedProjects={linkedProjects || []}
        />
      ) : (
        <div>
          <Label className="text-xs">Manual progress %</Label>
          <Input
            type="number"
            min={0}
            max={100}
            value={form.manual_progress}
            onChange={(e) => patch({ manual_progress: e.target.value })}
            placeholder="Optional — link to a phase/milestone after creating"
            data-testid="input-priority-progress"
          />
        </div>
      )}

      <div>
        <Label className="text-xs">Target outcome</Label>
        <Textarea
          value={form.target_outcome}
          onChange={(e) => patch({ target_outcome: e.target.value })}
          placeholder="What does success look like?"
          rows={2}
        />
      </div>

      <div>
        <Label className="text-xs">Next action</Label>
        <Input
          value={form.next_action}
          onChange={(e) => patch({ next_action: e.target.value })}
          placeholder="Concrete next step"
        />
      </div>

      <div>
        <Label className="text-xs">Definition of done</Label>
        <Textarea
          value={form.definition_of_done}
          onChange={(e) => patch({ definition_of_done: e.target.value })}
          placeholder="Checklist / acceptance criteria"
          rows={2}
        />
      </div>

      {mode === "create" && (
        <div>
          <Label className="text-xs">Link projects (optional)</Label>
          <Input
            value={projectSearch}
            onChange={(e) => setProjectSearch(e.target.value)}
            placeholder="Search projects..."
            className="mb-1"
          />
          <div className="max-h-40 overflow-y-auto rounded border p-1 space-y-0.5">
            {filteredProjects.length === 0 && (
              <p className="text-xs text-muted-foreground py-1 text-center">No matching projects</p>
            )}
            {filteredProjects.slice(0, 50).map((p) => (
              <label
                key={p.value}
                className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted cursor-pointer text-xs"
              >
                <input
                  type="checkbox"
                  checked={form.project_ids.includes(p.value)}
                  onChange={() => toggleProjectId(p.value)}
                  className="rounded"
                />
                <span>{p.label}</span>
              </label>
            ))}
            {filteredProjects.length > 50 && (
              <p className="text-[10px] text-muted-foreground py-1 text-center">
                Showing first 50 — refine search
              </p>
            )}
          </div>
          {form.project_ids.length > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1">
              {form.project_ids.length} project{form.project_ids.length === 1 ? "" : "s"} selected
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Build the API payload from form state. Used by both create POST and
 *  update PUT — the latter only sends the fields it cares about. */
export function buildPriorityPayload(
  form: PriorityFormState,
  opts: { includeStatus?: boolean; includeProjectIds?: boolean } = {},
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: form.title,
    description: form.description || null,
    scope: form.scope,
    severity: form.severity,
    horizon: form.horizon,
    due_date: form.due_date || null,
    target_outcome: form.target_outcome || null,
    next_action: form.next_action || null,
    definition_of_done: form.definition_of_done || null,
    manual_health: form.manual_health || null,
    manual_progress: form.manual_progress ? parseInt(form.manual_progress, 10) : null,
    department_key: form.department_key || null,
    owner_user_id: form.owner_user_id ? parseInt(form.owner_user_id, 10) : null,
    accountable_exec_id: form.accountable_exec_id ? parseInt(form.accountable_exec_id, 10) : null,
    assigned_user_id: form.assigned_user_id ? parseInt(form.assigned_user_id, 10) : null,
    parent_id: form.parent_id ? parseInt(form.parent_id, 10) : null,
  };
  if (opts.includeStatus) payload.status = form.status;
  if (opts.includeProjectIds && form.project_ids.length > 0) {
    payload.project_ids = form.project_ids;
  }
  return payload;
}
