import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { apiRequest } from "@/lib/queryClient";
import { DEPARTMENT_OPTIONS } from "@shared/config/priorities";
import { useUserOptions, useProjectOptions } from "./usePriorityPickers";

const emptyForm = {
  title: "",
  description: "",
  department: "",
  severity: "normal",
  horizon: "quarter",
  due_date: "",
  target_outcome: "",
  next_action: "",
  definition_of_done: "",
  manual_health: "",
  manual_progress: "",
  scope: "company" as string,
  department_key: "",
  owner_user_id: "" as string,
  accountable_exec_id: "" as string,
  assigned_user_id: "" as string,
  parent_id: "" as string,
  project_ids: [] as number[],
};

type FormState = typeof emptyForm;

export function CreatePriorityDialog({
  open,
  onOpenChange,
  defaultScope,
  defaultDepartment,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultScope?: string;
  defaultDepartment?: string;
}) {
  const [form, setForm] = useState<FormState>({
    ...emptyForm,
    scope: defaultScope || "company",
    department_key: defaultDepartment || "",
  });
  const [projectSearch, setProjectSearch] = useState("");
  const queryClient = useQueryClient();

  const userOptions = useUserOptions(open);
  const projectOptions = useProjectOptions(open);

  const filteredProjects = useMemo(() => {
    const needle = projectSearch.trim().toLowerCase();
    if (!needle) return projectOptions;
    return projectOptions.filter((p) => p.label.toLowerCase().includes(needle));
  }, [projectOptions, projectSearch]);

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/priorities", {
        title: form.title,
        description: form.description || null,
        department: form.department || null,
        severity: form.severity,
        horizon: form.horizon,
        due_date: form.due_date || null,
        target_outcome: form.target_outcome || null,
        next_action: form.next_action || null,
        definition_of_done: form.definition_of_done || null,
        manual_health: form.manual_health || null,
        manual_progress: form.manual_progress ? parseInt(form.manual_progress, 10) : null,
        scope: form.scope,
        department_key: form.department_key || null,
        owner_user_id: form.owner_user_id ? parseInt(form.owner_user_id, 10) : null,
        accountable_exec_id: form.accountable_exec_id ? parseInt(form.accountable_exec_id, 10) : null,
        assigned_user_id: form.assigned_user_id ? parseInt(form.assigned_user_id, 10) : null,
        parent_id: form.parent_id ? parseInt(form.parent_id, 10) : null,
        project_ids: form.project_ids.length > 0 ? form.project_ids : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/priorities"] });
      setForm({ ...emptyForm, scope: defaultScope || "company", department_key: defaultDepartment || "" });
      setProjectSearch("");
      onOpenChange(false);
    },
  });

  const toggleProjectId = (id: number) => {
    setForm((prev) => ({
      ...prev,
      project_ids: prev.project_ids.includes(id)
        ? prev.project_ids.filter((x) => x !== id)
        : [...prev.project_ids, id],
    }));
  };

  const patch = (delta: Partial<FormState>) => setForm((prev) => ({ ...prev, ...delta }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Priority</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="cp-title" className="text-xs">Title *</Label>
            <Input id="cp-title" value={form.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Priority title" />
          </div>
          <div>
            <Label htmlFor="cp-description" className="text-xs">Description</Label>
            <Textarea id="cp-description" value={form.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Brief description" rows={2} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Scope</Label>
              <Select value={form.scope} onValueChange={(v) => patch({ scope: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="company">Company</SelectItem>
                  <SelectItem value="department">Department</SelectItem>
                  <SelectItem value="role">Role / Individual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="cp-severity" className="text-xs">Severity</Label>
              <Select value={form.severity} onValueChange={(v) => patch({ severity: v })}>
                <SelectTrigger id="cp-severity"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="important">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="cp-horizon" className="text-xs">Horizon</Label>
              <Select value={form.horizon} onValueChange={(v) => patch({ horizon: v })}>
                <SelectTrigger id="cp-horizon"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="week">This week</SelectItem>
                  <SelectItem value="month">This month</SelectItem>
                  <SelectItem value="quarter">This quarter</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {(form.scope === "department" || form.scope === "role") && (
            <div>
              <Label className="text-xs">Department</Label>
              <Select value={form.department_key} onValueChange={(v) => patch({ department_key: v })}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {DEPARTMENT_OPTIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Label htmlFor="cp-due-date" className="text-xs">Due Date</Label>
              <Input id="cp-due-date" type="date" value={form.due_date} onChange={(e) => patch({ due_date: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="cp-manual-health" className="text-xs">Health</Label>
              <Select value={form.manual_health || "none"} onValueChange={(v) => patch({ manual_health: v === "none" ? "" : v })}>
                <SelectTrigger id="cp-manual-health"><SelectValue placeholder="Auto" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Auto</SelectItem>
                  <SelectItem value="healthy">Healthy</SelectItem>
                  <SelectItem value="at_risk">At Risk</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="cp-target-outcome" className="text-xs">Target Outcome</Label>
            <Textarea id="cp-target-outcome" value={form.target_outcome} onChange={(e) => patch({ target_outcome: e.target.value })} placeholder="What does success look like?" rows={2} />
          </div>
          <div>
            <Label htmlFor="cp-next-action" className="text-xs">Next action</Label>
            <Input id="cp-next-action" value={form.next_action} onChange={(e) => patch({ next_action: e.target.value })} placeholder="Concrete next step" />
          </div>
          <div>
            <Label htmlFor="cp-dod" className="text-xs">Definition of done</Label>
            <Textarea id="cp-dod" value={form.definition_of_done} onChange={(e) => patch({ definition_of_done: e.target.value })} placeholder="Checklist / acceptance criteria" rows={2} />
          </div>

          <div>
            <Label className="text-xs">Link projects (optional)</Label>
            <Input
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
              placeholder="Search projects..."
              className="mb-1"
              aria-label="Search projects"
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
                    aria-label={`Select ${p.label}`}
                  />
                  <span>{p.label}</span>
                </label>
              ))}
              {filteredProjects.length > 50 && (
                <p className="text-[10px] text-muted-foreground py-1 text-center">Showing first 50 — refine search</p>
              )}
            </div>
            {form.project_ids.length > 0 && (
              <p className="text-[10px] text-muted-foreground mt-1">
                {form.project_ids.length} project{form.project_ids.length === 1 ? "" : "s"} selected
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => createMutation.mutate()} disabled={!form.title.trim() || createMutation.isPending}>
            {createMutation.isPending ? "Creating..." : "Create Priority"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
