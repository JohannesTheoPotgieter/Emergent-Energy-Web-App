/**
 * RequirementDialog — create/edit an approval requirement on either basis:
 * browse-and-bind (discipline + optional subfolder) or the legacy taxonomy
 * folder. Extracted from admin-document-management.tsx (file-size split,
 * EE-QA-015).
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import {
  useCreateRequirement,
  useUpdateRequirement,
  useDeactivateRequirement,
  type CreateRequirementPayload,
} from "@/hooks/use-document-management-admin";
import {
  COMPANY_ROLES,
  LIFECYCLE_DEPARTMENTS,
  type FolderTaxonomy,
  type DocumentApprovalRequirement,
} from "@shared/schema";
import { Loader2, PowerOff } from "lucide-react";

export function RequirementDialog(props: {
  taxonomyOptions: FolderTaxonomy[];
  initial?: DocumentApprovalRequirement;
  onClose: () => void;
}) {
  const { taxonomyOptions, initial, onClose } = props;
  const isEditing = Boolean(initial);

  const [form, setForm] = useState<CreateRequirementPayload>({
    taxonomyKey: initial?.taxonomyKey ?? "",
    discipline: initial?.discipline ?? null,
    subfolderPattern: initial?.subfolderPattern ?? null,
    fileNamePattern: initial?.fileNamePattern ?? null,
    displayName: initial?.displayName ?? "",
    description: initial?.description ?? "",
    approverRoles: (initial?.approverRoles as string[]) ?? [],
    requiresAllApprovers: initial?.requiresAllApprovers ?? false,
    extractSpec: (initial?.extractSpec as CreateRequirementPayload["extractSpec"]) ?? null,
    sortOrder: initial?.sortOrder ?? 0,
    active: initial?.active ?? true,
  });
  // New rules default to the browse-and-bind (discipline) basis; legacy rows
  // edit on whichever basis they were created with.
  const [basis, setBasis] = useState<"discipline" | "taxonomy">(
    initial?.taxonomyKey ? "taxonomy" : "discipline",
  );

  const create = useCreateRequirement();
  const update = useUpdateRequirement();
  const deactivate = useDeactivateRequirement();
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);

  const isPending = create.isPending || update.isPending || deactivate.isPending;

  function toggleApprover(role: string) {
    setForm((s) => ({
      ...s,
      approverRoles: s.approverRoles.includes(role)
        ? s.approverRoles.filter((r) => r !== role)
        : [...s.approverRoles, role],
    }));
  }

  async function handleSubmit() {
    // Exactly one basis; give a friendly message before the server 400s.
    if (basis === "taxonomy" && !form.taxonomyKey) {
      toast({ title: "Pick a folder", description: "Choose a taxonomy folder, or switch the basis to discipline.", variant: "destructive" });
      return;
    }
    if (basis === "discipline" && !form.discipline) {
      toast({ title: "Pick a discipline", description: "Choose a discipline, or switch the basis to taxonomy folder.", variant: "destructive" });
      return;
    }
    const payload: CreateRequirementPayload = {
      ...form,
      taxonomyKey: basis === "taxonomy" ? form.taxonomyKey || null : null,
      discipline: basis === "discipline" ? form.discipline || null : null,
      subfolderPattern: basis === "discipline" ? form.subfolderPattern || null : null,
    };
    try {
      if (isEditing) {
        await update.mutateAsync({ id: initial!.id, patch: payload });
        toast({ title: "Updated", description: payload.displayName });
      } else {
        await create.mutateAsync(payload);
        toast({ title: "Created", description: payload.displayName });
      }
      onClose();
    } catch (err) {
      toast({
        title: isEditing ? "Update failed" : "Create failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function handleDeactivate() {
    if (!initial) return;
    try {
      await deactivate.mutateAsync(initial.id);
      toast({ title: "Deactivated", description: initial.displayName });
      onClose();
    } catch (err) {
      toast({
        title: "Deactivate failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit approval requirement" : "Add approval requirement"}</DialogTitle>
          <DialogDescription>
            When a file matching this rule lands in the target — a bound discipline folder
            (browse-and-bind) or a legacy taxonomy folder — an approval is triggered using the
            existing approvals engine.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1 col-span-2">
            <Label>Rule basis</Label>
            <Select value={basis} onValueChange={(v) => setBasis(v as "discipline" | "taxonomy")}>
              <SelectTrigger data-testid="select-requirement-basis">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="discipline">By discipline (browse-and-bind)</SelectItem>
                <SelectItem value="taxonomy">By taxonomy folder (legacy)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {basis === "discipline" ? (
            <>
              <div className="space-y-1">
                <Label>Discipline</Label>
                <Select
                  value={form.discipline ?? ""}
                  onValueChange={(v) => setForm((s) => ({ ...s, discipline: v }))}
                >
                  <SelectTrigger data-testid="select-requirement-discipline">
                    <SelectValue placeholder="Choose a discipline" />
                  </SelectTrigger>
                  <SelectContent>
                    {LIFECYCLE_DEPARTMENTS.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Subfolder pattern (regex, optional)</Label>
                <Input
                  value={form.subfolderPattern ?? ""}
                  onChange={(e) => setForm((s) => ({ ...s, subfolderPattern: e.target.value || null }))}
                  placeholder="^IFC"
                  data-testid="input-requirement-subfolder-pattern"
                />
                <p className="text-[11px] text-muted-foreground">
                  Empty = anywhere in the bound folder.
                </p>
              </div>
            </>
          ) : (
            <div className="space-y-1 col-span-2">
              <Label>Folder (taxonomy key)</Label>
              <Select
                value={form.taxonomyKey ?? ""}
                onValueChange={(v) => setForm((s) => ({ ...s, taxonomyKey: v }))}
              >
                <SelectTrigger data-testid="select-requirement-taxonomy">
                  <SelectValue placeholder="Choose a folder" />
                </SelectTrigger>
                <SelectContent>
                  {taxonomyOptions
                    .filter((o) => o.active)
                    .map((o) => (
                      <SelectItem key={o.internalKey} value={o.internalKey}>
                        {o.internalKey} — {o.displayName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            <Label>Display name</Label>
            <Input
              value={form.displayName}
              onChange={(e) => setForm((s) => ({ ...s, displayName: e.target.value }))}
              placeholder="Costing Excel"
              data-testid="input-requirement-display-name"
            />
          </div>
          <div className="space-y-1">
            <Label>File pattern (regex, optional)</Label>
            <Input
              value={form.fileNamePattern ?? ""}
              onChange={(e) =>
                setForm((s) => ({ ...s, fileNamePattern: e.target.value || null }))
              }
              placeholder="^costing.*\.xlsx$"
              data-testid="input-requirement-file-pattern"
            />
            <p className="text-[11px] text-muted-foreground">
              Empty = every file in the folder requires this approval.
            </p>
          </div>

          <div className="col-span-2 space-y-1">
            <Label>Approver roles</Label>
            <div className="flex flex-wrap gap-2">
              {COMPANY_ROLES.map((r) => (
                <label key={r} className="flex items-center gap-1 cursor-pointer">
                  <Checkbox
                    checked={form.approverRoles.includes(r)}
                    onCheckedChange={() => toggleApprover(r)}
                    data-testid={`checkbox-requirement-approver-${r}`}
                  />
                  <span className="text-xs">{r}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="col-span-2 flex items-center gap-2">
            <Checkbox
              checked={Boolean(form.requiresAllApprovers)}
              onCheckedChange={(c) =>
                setForm((s) => ({ ...s, requiresAllApprovers: Boolean(c) }))
              }
              data-testid="checkbox-requirement-all-approvers"
            />
            <Label className="cursor-pointer">All listed approvers must sign off</Label>
          </div>

          <div className="col-span-2 space-y-1">
            <Label>Description</Label>
            <Textarea
              value={form.description ?? ""}
              onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
              rows={2}
              data-testid="textarea-requirement-description"
            />
          </div>

          <div className="space-y-1">
            <Label>Sort order</Label>
            <Input
              type="number"
              value={form.sortOrder ?? 0}
              onChange={(e) => setForm((s) => ({ ...s, sortOrder: Number(e.target.value) || 0 }))}
              data-testid="input-requirement-sort-order"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={form.active ?? true}
              onCheckedChange={(c) => setForm((s) => ({ ...s, active: Boolean(c) }))}
              data-testid="checkbox-requirement-active"
            />
            <Label className="cursor-pointer">Active</Label>
          </div>
        </div>

        <DialogFooter className="gap-2">
          {isEditing && initial?.active && (
            <Button
              variant="outline"
              onClick={() => setConfirmingDeactivate(true)}
              disabled={isPending}
              data-testid="btn-requirement-deactivate"
            >
              <PowerOff className="h-3.5 w-3.5 mr-1" />
              Deactivate
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending} data-testid="btn-requirement-submit">
            {isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            {isEditing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog
        open={confirmingDeactivate}
        onOpenChange={(open) => !open && setConfirmingDeactivate(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate approval requirement?</AlertDialogTitle>
            <AlertDialogDescription>
              Files matching <strong>{initial?.displayName}</strong> will no longer trigger an
              approval. Existing in-flight approvals are not affected; the requirement can be
              re-activated by editing it. This action is audit-logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirmingDeactivate(false);
                await handleDeactivate();
              }}
              data-testid="btn-requirement-deactivate-confirm"
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
