/**
 * D6 Phase 2 — Document Management admin (folder taxonomy + approval
 * requirements editor).
 *
 * Super-user only. Mounted at /admin/document-management. Lets COO/CEO
 * (or any user with the documents_admin permission) edit the canonical
 * Active Clients folder taxonomy and the approval requirements that
 * attach to it.
 */

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { PageLayout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import {
  useFolderTaxonomy,
  useCreateTaxonomyRow,
  useUpdateTaxonomyRow,
  useDeactivateTaxonomyRow,
  useApprovalRequirements,
  useCreateRequirement,
  useUpdateRequirement,
  useDeactivateRequirement,
  type CreateTaxonomyPayload,
  type CreateRequirementPayload,
} from "@/hooks/use-document-management-admin";
import { isSuperAdmin } from "@/lib/access-control";
import {
  COMPANY_ROLES,
  LIFECYCLE_DEPARTMENTS,
  FOLDER_LIFECYCLE_MODES,
  STAGE_CODES,
  type FolderTaxonomy,
  type DocumentApprovalRequirement,
  type FolderLifecycleMode,
} from "@shared/schema";
import { Plus, Pencil, PowerOff, AlertTriangle, FolderTree, ShieldCheck, Loader2 } from "lucide-react";

const LIFECYCLE_LABELS: Record<FolderLifecycleMode, string> = {
  pre_construction: "Pre-construction",
  full_lifecycle: "Full lifecycle",
  both: "Both",
};

export default function AdminDocumentManagementPage() {
  const companyRole = localStorage.getItem("company_role");
  const tokenRole = localStorage.getItem("user_role");
  if (!isSuperAdmin(tokenRole, companyRole)) {
    return (
      <PageLayout
        header={
          <PageHeader
            title="Document Management Administration"
            subtitle="Folder taxonomy + approval requirements"
          />
        }
      >
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="py-10 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-amber-500 mb-2" />
            <p className="text-sm font-medium">
              Only COO and CEO admins can edit the document management taxonomy.
            </p>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      header={
        <PageHeader
          title="Document Management Administration"
          subtitle="Edit the Active Clients folder taxonomy + approval requirements"
        />
      }
    >
      <Tabs defaultValue="taxonomy" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="taxonomy" data-testid="tab-doc-taxonomy">
            <FolderTree className="h-4 w-4 mr-2" />
            Folder taxonomy
          </TabsTrigger>
          <TabsTrigger value="requirements" data-testid="tab-doc-requirements">
            <ShieldCheck className="h-4 w-4 mr-2" />
            Approval requirements
          </TabsTrigger>
        </TabsList>

        <TabsContent value="taxonomy" className="mt-4">
          <TaxonomyTab />
        </TabsContent>

        <TabsContent value="requirements" className="mt-4">
          <RequirementsTab />
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}

// =========================================================================
// Taxonomy tab
// =========================================================================

function TaxonomyTab() {
  const { data, isLoading, error } = useFolderTaxonomy();
  const [editing, setEditing] = useState<FolderTaxonomy | null>(null);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => data?.taxonomy ?? [], [data]);
  const activeCount = rows.filter((r) => r.active).length;

  if (isLoading) return <PageSkeleton />;
  if (error) return <PageError message="Failed to load folder taxonomy" />;

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground">
            {activeCount} active · {rows.length - activeCount} inactive
          </div>
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => setCreating(true)}
            data-testid="btn-add-taxonomy"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add folder
          </Button>
        </div>

        <Table data-testid="taxonomy-table">
          <TableHeader>
            <TableRow>
              <TableHead>Internal key</TableHead>
              <TableHead>Display</TableHead>
              <TableHead>Parent</TableHead>
              <TableHead>Lifecycle</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Disciplines</TableHead>
              <TableHead className="text-center">Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.internalKey} data-testid={`taxonomy-row-${r.internalKey}`}>
                <TableCell className="font-mono text-xs">{r.internalKey}</TableCell>
                <TableCell className="text-sm font-medium">{r.displayName}</TableCell>
                <TableCell className="text-xs text-muted-foreground font-mono">
                  {r.parentKey ?? "—"}
                </TableCell>
                <TableCell className="text-xs">{LIFECYCLE_LABELS[r.lifecycleMode]}</TableCell>
                <TableCell className="text-xs font-mono">{r.stageCode ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(r.disciplines ?? []).map((d) => (
                      <Badge key={d} variant="outline" className="text-[10px]">
                        {d}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  {r.active ? (
                    <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700">
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] bg-muted">
                      Inactive
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setEditing(r)}
                    data-testid={`btn-edit-taxonomy-${r.internalKey}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                  No taxonomy rows yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      {creating && (
        <TaxonomyDialog
          allRows={rows}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <TaxonomyDialog
          allRows={rows}
          initial={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function TaxonomyDialog(props: {
  allRows: FolderTaxonomy[];
  initial?: FolderTaxonomy;
  onClose: () => void;
}) {
  const { allRows, initial, onClose } = props;
  const isEditing = Boolean(initial);

  const [form, setForm] = useState<CreateTaxonomyPayload>({
    internalKey: initial?.internalKey ?? "",
    displayName: initial?.displayName ?? "",
    parentKey: initial?.parentKey ?? null,
    lifecycleMode: initial?.lifecycleMode ?? "full_lifecycle",
    stageCode: initial?.stageCode ?? null,
    disciplines: (initial?.disciplines as string[]) ?? [],
    description: initial?.description ?? "",
    sortOrder: initial?.sortOrder ?? 0,
    active: initial?.active ?? true,
  });

  const create = useCreateTaxonomyRow();
  const update = useUpdateTaxonomyRow();
  const deactivate = useDeactivateTaxonomyRow();
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);

  const isPending = create.isPending || update.isPending || deactivate.isPending;

  const candidateParents = useMemo(
    () => allRows.filter((r) => r.internalKey !== initial?.internalKey && r.active),
    [allRows, initial],
  );

  function toggleDiscipline(code: string) {
    setForm((s) => ({
      ...s,
      disciplines: s.disciplines.includes(code)
        ? s.disciplines.filter((d) => d !== code)
        : [...s.disciplines, code],
    }));
  }

  async function handleSubmit() {
    try {
      if (isEditing) {
        await update.mutateAsync({ internalKey: initial!.internalKey, patch: form });
        toast({ title: "Updated", description: form.displayName });
      } else {
        await create.mutateAsync(form);
        toast({ title: "Created", description: form.displayName });
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
      await deactivate.mutateAsync(initial.internalKey);
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
          <DialogTitle>{isEditing ? "Edit folder" : "Add folder"}</DialogTitle>
          <DialogDescription>
            Folders mirror the SharePoint Active Clients tree. Disciplines drive which department
            pages surface this folder.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Internal key</Label>
            <Input
              value={form.internalKey}
              onChange={(e) => setForm((s) => ({ ...s, internalKey: e.target.value }))}
              disabled={isEditing}
              placeholder="07_construction"
              data-testid="input-taxonomy-internal-key"
            />
            <p className="text-[11px] text-muted-foreground">
              lowercase letters, numbers, underscore, '/'
            </p>
          </div>
          <div className="space-y-1">
            <Label>Display name</Label>
            <Input
              value={form.displayName}
              onChange={(e) => setForm((s) => ({ ...s, displayName: e.target.value }))}
              placeholder="07_Construction"
              data-testid="input-taxonomy-display-name"
            />
          </div>

          <div className="space-y-1">
            <Label>Parent</Label>
            <Select
              value={form.parentKey ?? "__root__"}
              onValueChange={(v) =>
                setForm((s) => ({ ...s, parentKey: v === "__root__" ? null : v }))
              }
            >
              <SelectTrigger data-testid="select-taxonomy-parent">
                <SelectValue placeholder="Top-level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__root__">Top-level (no parent)</SelectItem>
                {candidateParents.map((p) => (
                  <SelectItem key={p.internalKey} value={p.internalKey}>
                    {p.internalKey}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Lifecycle mode</Label>
            <Select
              value={form.lifecycleMode}
              onValueChange={(v) => setForm((s) => ({ ...s, lifecycleMode: v as FolderLifecycleMode }))}
            >
              <SelectTrigger data-testid="select-taxonomy-lifecycle">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FOLDER_LIFECYCLE_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {LIFECYCLE_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Stage code (optional)</Label>
            <Select
              value={form.stageCode ?? "__none__"}
              onValueChange={(v) =>
                setForm((s) => ({ ...s, stageCode: v === "__none__" ? null : v }))
              }
            >
              <SelectTrigger data-testid="select-taxonomy-stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None (cross-stage)</SelectItem>
                {STAGE_CODES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Sort order</Label>
            <Input
              type="number"
              value={form.sortOrder ?? 0}
              onChange={(e) => setForm((s) => ({ ...s, sortOrder: Number(e.target.value) || 0 }))}
              data-testid="input-taxonomy-sort-order"
            />
          </div>

          <div className="col-span-2 space-y-1">
            <Label>Disciplines</Label>
            <div className="flex flex-wrap gap-2">
              {LIFECYCLE_DEPARTMENTS.map((d) => (
                <label key={d} className="flex items-center gap-1 cursor-pointer">
                  <Checkbox
                    checked={form.disciplines.includes(d)}
                    onCheckedChange={() => toggleDiscipline(d)}
                    data-testid={`checkbox-taxonomy-discipline-${d}`}
                  />
                  <span className="text-xs">{d}</span>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Empty = shared/all. Multi-select supported.
            </p>
          </div>

          <div className="col-span-2 space-y-1">
            <Label>Description</Label>
            <Textarea
              value={form.description ?? ""}
              onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))}
              rows={2}
              data-testid="textarea-taxonomy-description"
            />
          </div>

          <div className="col-span-2 flex items-center gap-2">
            <Checkbox
              checked={form.active ?? true}
              onCheckedChange={(c) => setForm((s) => ({ ...s, active: Boolean(c) }))}
              data-testid="checkbox-taxonomy-active"
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
              data-testid="btn-taxonomy-deactivate"
            >
              <PowerOff className="h-3.5 w-3.5 mr-1" />
              Deactivate
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending} data-testid="btn-taxonomy-submit">
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
            <AlertDialogTitle>Deactivate folder?</AlertDialogTitle>
            <AlertDialogDescription>
              Hides <strong>{initial?.displayName}</strong> from new submissions and discipline
              panels. Existing project_folders rows pointing at it stay intact and the row can be
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
              data-testid="btn-taxonomy-deactivate-confirm"
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

// =========================================================================
// Approval requirements tab
// =========================================================================

function RequirementsTab() {
  const { data, isLoading, error } = useApprovalRequirements();
  const taxonomy = useFolderTaxonomy();

  const [editing, setEditing] = useState<DocumentApprovalRequirement | null>(null);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => data?.requirements ?? [], [data]);
  const activeCount = rows.filter((r) => r.active).length;

  if (isLoading || taxonomy.isLoading) return <PageSkeleton />;
  if (error) return <PageError message="Failed to load approval requirements" />;

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="text-sm text-muted-foreground">
            {activeCount} active · {rows.length - activeCount} inactive
          </div>
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => setCreating(true)}
            data-testid="btn-add-requirement"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add requirement
          </Button>
        </div>

        <Table data-testid="requirements-table">
          <TableHeader>
            <TableRow>
              <TableHead>Folder</TableHead>
              <TableHead>File pattern</TableHead>
              <TableHead>Display name</TableHead>
              <TableHead>Approver roles</TableHead>
              <TableHead className="text-center">All required</TableHead>
              <TableHead className="text-center">Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} data-testid={`requirement-row-${r.id}`}>
                <TableCell className="font-mono text-xs">{r.taxonomyKey}</TableCell>
                <TableCell className="font-mono text-xs">{r.fileNamePattern ?? "(any file)"}</TableCell>
                <TableCell className="text-sm font-medium">{r.displayName}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {(r.approverRoles ?? []).map((role) => (
                      <Badge key={role} variant="outline" className="text-[10px]">
                        {role}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  {r.requiresAllApprovers ? (
                    <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700">
                      All
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">Any one</Badge>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  {r.active ? (
                    <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700">
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] bg-muted">
                      Inactive
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setEditing(r)}
                    data-testid={`btn-edit-requirement-${r.id}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                  No approval requirements configured.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      {creating && (
        <RequirementDialog
          taxonomyOptions={taxonomy.data?.taxonomy ?? []}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && (
        <RequirementDialog
          taxonomyOptions={taxonomy.data?.taxonomy ?? []}
          initial={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function RequirementDialog(props: {
  taxonomyOptions: FolderTaxonomy[];
  initial?: DocumentApprovalRequirement;
  onClose: () => void;
}) {
  const { taxonomyOptions, initial, onClose } = props;
  const isEditing = Boolean(initial);

  const [form, setForm] = useState<CreateRequirementPayload>({
    taxonomyKey: initial?.taxonomyKey ?? "",
    fileNamePattern: initial?.fileNamePattern ?? null,
    displayName: initial?.displayName ?? "",
    description: initial?.description ?? "",
    approverRoles: (initial?.approverRoles as string[]) ?? [],
    requiresAllApprovers: initial?.requiresAllApprovers ?? false,
    extractSpec: (initial?.extractSpec as CreateRequirementPayload["extractSpec"]) ?? null,
    sortOrder: initial?.sortOrder ?? 0,
    active: initial?.active ?? true,
  });

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
    try {
      if (isEditing) {
        await update.mutateAsync({ id: initial!.id, patch: form });
        toast({ title: "Updated", description: form.displayName });
      } else {
        await create.mutateAsync(form);
        toast({ title: "Created", description: form.displayName });
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
            When a file lands in the chosen folder (and matches the optional regex), an approval is
            triggered using the existing approvals engine.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1 col-span-2">
            <Label>Folder (taxonomy key)</Label>
            <Select
              value={form.taxonomyKey}
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
