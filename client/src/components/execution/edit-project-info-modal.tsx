import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useApiMutation } from "@/hooks/use-api-mutation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { apiRequest } from "@/lib/queryClient";
import { CANONICAL_LIFECYCLE_PHASES, TERMINAL_LIFECYCLE_PHASES } from "@shared/schema";
import type { BoardRow } from "@/lib/execution-types";

// Execution-phase options — sourced from the canonical lifecycle so the UI
// cannot drift from the model. Mirrors the retired /projects modal.
const EXECUTION_PHASES: readonly string[] = [
  ...CANONICAL_LIFECYCLE_PHASES,
  ...TERMINAL_LIFECYCLE_PHASES,
];

type PmUser = { id: number; name: string };

/** Trim a date string to YYYY-MM-DD for <input type="date">. */
function dateValue(v: string | null): string {
  return v ? String(v).slice(0, 10) : "";
}

/**
 * Edit Project Info modal — migrated from the retired /projects page (#15).
 * Writes through the existing admin-gated `PATCH /api/project-info/:id`
 * endpoint (which routes the execution-state fields — phase + key dates — to
 * project_execution_state via the split-table sync). On success it invalidates
 * the board query so the row reflects the change.
 */
export function EditProjectInfoModal({
  row,
  open,
  onOpenChange,
}: {
  row: BoardRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();

  const { data: pmUsers = [] } = useQuery<PmUser[]>({
    queryKey: ["/api/pm-assignable-users"],
    enabled: open,
    staleTime: 60_000,
  });

  const [form, setForm] = useState(() => ({
    projectName: row?.projectName ?? "",
    phase: row?.phase ?? "",
    pd: row?.pdName ?? "",
    pm: row?.pmName ?? "",
    sizeKwp: row?.sizeKwp != null ? String(row.sizeKwp) : "",
    constructionStartDate: dateValue(row?.constructionStartDate ?? null),
    commissioningDate: dateValue(row?.commissioningDate ?? null),
    omHandoverDate: dateValue(row?.omHandoverDate ?? null),
    clientHandoverDate: dateValue(row?.clientHandoverDate ?? null),
  }));

  // Re-seed the form whenever a different project is opened.
  useEffect(() => {
    if (!row) return;
    setForm({
      projectName: row.projectName,
      phase: row.phase ?? "",
      pd: row.pdName ?? "",
      pm: row.pmName ?? "",
      sizeKwp: row.sizeKwp != null ? String(row.sizeKwp) : "",
      constructionStartDate: dateValue(row.constructionStartDate),
      commissioningDate: dateValue(row.commissioningDate),
      omHandoverDate: dateValue(row.omHandoverDate),
      clientHandoverDate: dateValue(row.clientHandoverDate),
    });
  }, [row]);

  const set = (field: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const mutation = useApiMutation({
    mutationFn: async () => {
      if (!row) return;
      const phaseVal = form.phase && form.phase !== "__blank" ? form.phase : null;
      await apiRequest("PATCH", `/api/project-info/${row.projectId}`, {
        projectName: form.projectName.trim() || row.projectName,
        executionPhase: phaseVal,
        pd: form.pd.trim() || null,
        pm: form.pm.trim() || null,
        sizeKwp: form.sizeKwp.trim() ? String(Number(form.sizeKwp)) : null,
        constructionStartDate: form.constructionStartDate || null,
        commissioningDate: form.commissioningDate || null,
        omHandoverDate: form.omHandoverDate || null,
        clientHandoverDate: form.clientHandoverDate || null,
      });
    },
    successToast: "Project updated",
    errorToast: "Could not update project",
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/execution-review/board"] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-edit-project-info">
        <DialogHeader>
          <DialogTitle>Edit Project Info</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
          <div className="col-span-1 sm:col-span-2">
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">Project Name</Label>
            <Input value={form.projectName} onChange={(e) => set("projectName", e.target.value)} data-testid="input-edit-project-name" />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">Execution Phase</Label>
            <SearchableSelect
              value={form.phase}
              onValueChange={(v) => set("phase", v)}
              placeholder="Select execution phase"
              data-testid="select-edit-phase"
              options={[
                { value: "__blank", label: "(blank)" },
                ...EXECUTION_PHASES.map((p) => ({ value: p, label: p })),
              ]}
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">Size kWp</Label>
            <Input type="number" value={form.sizeKwp} onChange={(e) => set("sizeKwp", e.target.value)} data-testid="input-edit-size-kwp" />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">PD</Label>
            <Input value={form.pd} onChange={(e) => set("pd", e.target.value)} data-testid="input-edit-pd" />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">PM</Label>
            <SearchableSelect
              value={form.pm || "__unassigned"}
              onValueChange={(val) => set("pm", val === "__unassigned" ? "" : val)}
              placeholder="Select PM..."
              data-testid="select-edit-pm"
              options={[
                { value: "__unassigned", label: "Unassigned" },
                ...pmUsers.map((u) => ({ value: u.name, label: u.name })),
              ]}
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">Construction Start</Label>
            <Input type="date" value={form.constructionStartDate} onChange={(e) => set("constructionStartDate", e.target.value)} data-testid="input-edit-construction-start" />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">Commissioning</Label>
            <Input type="date" value={form.commissioningDate} onChange={(e) => set("commissioningDate", e.target.value)} data-testid="input-edit-commissioning" />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">O&amp;M Handover</Label>
            <Input type="date" value={form.omHandoverDate} onChange={(e) => set("omHandoverDate", e.target.value)} data-testid="input-edit-om-handover" />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">Client Handover</Label>
            <Input type="date" value={form.clientHandoverDate} onChange={(e) => set("clientHandoverDate", e.target.value)} data-testid="input-edit-client-handover" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-2 border-t">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} data-testid="btn-cancel-edit">Cancel</Button>
          <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending} data-testid="btn-save-edit">
            {mutation.isPending ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Saving…</> : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
