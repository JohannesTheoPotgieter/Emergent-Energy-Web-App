import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import UserPicker from "@/components/UserPicker";
import { apiRequest } from "@/lib/queryClient";
import type { BoardRow } from "@/lib/execution-types";

/** Trim a date string to YYYY-MM-DD for <input type="date">. */
function dateValue(v: string | null): string {
  return v ? String(v).slice(0, 10) : "";
}

/**
 * Edit Project Info modal — name, PD, PM, size, and the key dates. Writes
 * through the existing admin-gated `PATCH /api/project-info/:id` endpoint (the
 * split-table sync routes the key dates to project_execution_state). Phase is
 * NOT edited here — it is the canonical lifecycle phase, edited inline on the
 * board (and the lifecycle board) so it correlates through every lens.
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

  const [pmUserId, setPmUserId] = useState<number | null>(row?.pmUserId ?? null);

  const [form, setForm] = useState(() => ({
    projectName: row?.projectName ?? "",
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
    setPmUserId(row.pmUserId ?? null);
    setForm({
      projectName: row.projectName,
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
      await apiRequest("PATCH", `/api/project-info/${row.projectId}`, {
        projectName: form.projectName.trim() || row.projectName,
        pd: form.pd.trim() || null,
        sizeKwp: form.sizeKwp.trim() ? String(Number(form.sizeKwp)) : null,
        constructionStartDate: form.constructionStartDate || null,
        commissioningDate: form.commissioningDate || null,
        omHandoverDate: form.omHandoverDate || null,
        clientHandoverDate: form.clientHandoverDate || null,
      });
      // PM is linked via the dedicated assign-pm endpoint — the project-info
      // PATCH schema carries the `pm` text but cannot set `pmUserId` (the FK to
      // users). assign-pm writes both, keeping the PM link canonical.
      await apiRequest("PATCH", `/api/project-info/${row.projectId}/assign-pm`, {
        pm: form.pm.trim(),
        pmUserId,
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
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">Size kWp</Label>
            <Input type="number" value={form.sizeKwp} onChange={(e) => set("sizeKwp", e.target.value)} data-testid="input-edit-size-kwp" />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">PD</Label>
            <Input value={form.pd} onChange={(e) => set("pd", e.target.value)} data-testid="input-edit-pd" />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">PM</Label>
            <UserPicker
              value={pmUserId}
              valueType="internal_user"
              restrictTo="internal"
              onValueChange={(id, name) => {
                setPmUserId(id);
                set("pm", name ?? "");
              }}
              placeholder="Select PM..."
              label="Assign PM"
              data-testid="select-edit-pm"
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
