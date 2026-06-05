/**
 * D6 Phase 2 — Document Management admin (folder taxonomy + approval
 * requirements editor).
 *
 * Super-user only. Mounted at /admin/document-management. Lets COO/CEO
 * (or any user with the documents_admin permission) edit the canonical
 * Active Clients folder taxonomy and the approval requirements that
 * attach to it.
 */

import type { ReactNode } from "react";
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
import { SharepointRootPicker, type PickedRoot } from "@/components/admin/SharepointRootPicker";
import {
  useFolderTaxonomy,
  useCreateTaxonomyRow,
  useUpdateTaxonomyRow,
  useDeactivateTaxonomyRow,
  useApprovalRequirements,
  useCreateRequirement,
  useUpdateRequirement,
  useDeactivateRequirement,
  useProvisionProjectFolders,
  useProjectFolders,
  useVerifyProjectFolders,
  useCompanySharepointRoots,
  useUpsertCompanyRoot,
  useTestCompanyRoot,
  type CreateTaxonomyPayload,
  type CreateRequirementPayload,
  type ProvisionResult,
  type CompanySharepointRoot,
  type CompanyRootTestResult,
} from "@/hooks/use-document-management-admin";
import { useProjectsSummary } from "@/hooks/use-projects-summary";
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
import {
  Plus, Pencil, PowerOff, AlertTriangle, FolderTree, ShieldCheck, Loader2,
  HardDriveUpload, RefreshCw, CheckCircle2, XCircle, FolderPlus, Link as LinkIcon,
} from "lucide-react";

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
        <TabsList className="grid w-full grid-cols-3 max-w-2xl">
          <TabsTrigger value="taxonomy" data-testid="tab-doc-taxonomy">
            <FolderTree className="h-4 w-4 mr-2" />
            Folder taxonomy
          </TabsTrigger>
          <TabsTrigger value="requirements" data-testid="tab-doc-requirements">
            <ShieldCheck className="h-4 w-4 mr-2" />
            Approval requirements
          </TabsTrigger>
          <TabsTrigger value="provisioning" data-testid="tab-doc-provisioning">
            <HardDriveUpload className="h-4 w-4 mr-2" />
            Provisioning
          </TabsTrigger>
        </TabsList>

        <TabsContent value="taxonomy" className="mt-4">
          <TaxonomyTab />
        </TabsContent>

        <TabsContent value="requirements" className="mt-4">
          <RequirementsTab />
        </TabsContent>

        <TabsContent value="provisioning" className="mt-4">
          <ProvisioningTab />
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

// =========================================================================
// Provisioning tab
// =========================================================================

function ProvisioningTab() {
  const { projectsSummary, isLoading: projectsLoading } = useProjectsSummary();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [lifecycleMode, setLifecycleMode] = useState<ProvisionResult["lifecycleMode"]>("full_lifecycle");
  const [lastResult, setLastResult] = useState<ProvisionResult | null>(null);

  const folders = useProjectFolders(projectId);
  const provision = useProvisionProjectFolders();
  const verify = useVerifyProjectFolders();
  const companyRoots = useCompanySharepointRoots();
  const activeProjectsRoot = (companyRoots.data?.roots ?? []).find(
    (r) => r.kind === "active_projects",
  );

  const projectName = useMemo(() => {
    if (!projectId || !projectsSummary) return null;
    const match = projectsSummary.find((p) => p.project_info_id === projectId);
    return match?.project_name ?? null;
  }, [projectId, projectsSummary]);

  async function handleProvision() {
    if (!projectId) return;
    try {
      const result = await provision.mutateAsync({ projectId, lifecycleMode });
      setLastResult(result);
      const total =
        result.summary.created + result.summary.alreadyPresent + result.summary.linkedExisting;
      toast({
        title: "Provisioning complete",
        description: `${total} folder${total === 1 ? "" : "s"} resolved · ${result.summary.errors} error${result.summary.errors === 1 ? "" : "s"}`,
        variant: result.summary.errors > 0 ? "destructive" : undefined,
      });
    } catch (err) {
      toast({
        title: "Provisioning failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function handleVerify() {
    if (!projectId) return;
    try {
      const result = await verify.mutateAsync(projectId);
      toast({
        title: "Verify complete",
        description: `${result.verified} verified · ${result.missing} missing`,
        variant: result.missing > 0 ? "destructive" : undefined,
      });
    } catch (err) {
      toast({
        title: "Verify failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-4">
      <CompanyRootCard root={activeProjectsRoot} isLoading={companyRoots.isLoading} />

      <Card>
        <CardContent className="pt-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>Project</Label>
            <Select
              value={projectId ? String(projectId) : ""}
              onValueChange={(v) => {
                setProjectId(Number(v));
                setLastResult(null);
              }}
              disabled={projectsLoading}
            >
              <SelectTrigger data-testid="select-provisioning-project">
                <SelectValue placeholder={projectsLoading ? "Loading..." : "Choose a project"} />
              </SelectTrigger>
              <SelectContent>
                {(projectsSummary ?? [])
                  .filter((p) => typeof p.project_info_id === "number")
                  .map((p) => (
                    <SelectItem
                      key={p.project_info_id as number}
                      value={String(p.project_info_id)}
                    >
                      {p.project_name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Tree to provision</Label>
            <Select
              value={lifecycleMode}
              onValueChange={(v) => setLifecycleMode(v as ProvisionResult["lifecycleMode"])}
            >
              <SelectTrigger data-testid="select-provisioning-lifecycle">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pre_construction">Pre-construction (PRE_*, PM)</SelectItem>
                <SelectItem value="full_lifecycle">Full lifecycle (01_…14_)</SelectItem>
                <SelectItem value="both">Both — pre + full</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={handleProvision}
            disabled={!projectId || provision.isPending}
            data-testid="btn-provision-folders"
          >
            {provision.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <FolderPlus className="h-3.5 w-3.5 mr-1" />
            )}
            Provision folders
          </Button>
          <Button
            variant="outline"
            onClick={handleVerify}
            disabled={!projectId || verify.isPending}
            data-testid="btn-verify-folders"
          >
            {verify.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
            )}
            Verify
          </Button>
          {projectName && (
            <span className="ml-auto text-xs text-muted-foreground">
              Target: <strong>{projectName}</strong>
            </span>
          )}
        </div>

        {lastResult && <ProvisioningResultPanel result={lastResult} />}

        {projectId && !lastResult && (
          <ProjectFoldersTable
            folders={folders.data?.folders ?? []}
            isLoading={folders.isLoading}
          />
        )}
        </CardContent>
      </Card>
    </div>
  );
}

function CompanyRootCard(props: {
  root: CompanySharepointRoot | undefined;
  isLoading: boolean;
}) {
  const { root, isLoading } = props;
  const upsert = useUpsertCompanyRoot();
  const testRoot = useTestCompanyRoot();
  const [testResult, setTestResult] = useState<CompanyRootTestResult | null>(null);
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [form, setForm] = useState({
    displayName: "Active Projects",
    rootPath: "01 - Clients/01 - active projects (1)",
    driveId: "",
    rootItemId: "",
  });

  const configured = Boolean(root?.driveId);

  function startEdit() {
    if (root) {
      setForm({
        displayName: root.displayName,
        rootPath: root.rootPath,
        driveId: root.driveId ?? "",
        rootItemId: root.rootItemId ?? "",
      });
    }
    setTestResult(null);
    setEditing(true);
  }

  function patchForm<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((s) => ({ ...s, [key]: value }));
    setTestResult(null);
  }

  function handlePicked(picked: PickedRoot) {
    setForm((s) => ({
      ...s,
      driveId: picked.driveId,
      rootItemId: picked.rootItemId,
      rootPath: picked.rootPath || s.rootPath,
      displayName: s.displayName.trim() ? s.displayName : picked.displayName,
    }));
    setTestResult(null);
    setEditing(true);
    toast({
      title: "SharePoint folder selected",
      description: `${picked.driveName}${picked.rootPath ? `/${picked.rootPath}` : ""} — review and Save.`,
    });
  }

  async function save() {
    try {
      await upsert.mutateAsync({
        kind: "active_projects",
        displayName: form.displayName,
        driveId: form.driveId.trim() || null,
        rootItemId: form.rootItemId.trim() || null,
        rootPath: form.rootPath,
      });
      toast({ title: "Saved", description: "Active Projects root updated." });
      setEditing(false);
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function testConnection() {
    if (!form.driveId.trim()) {
      toast({
        title: "Drive ID required",
        description: "Paste the Graph drive ID before testing this SharePoint root.",
        variant: "destructive",
      });
      return;
    }
    try {
      const result = await testRoot.mutateAsync({
        kind: "active_projects",
        driveId: form.driveId.trim() || null,
        rootItemId: form.rootItemId.trim() || null,
        rootPath: form.rootPath.trim() || null,
      });
      setTestResult(result);
      toast({
        title: result.ok ? "SharePoint root reachable" : "SharePoint root test failed",
        description: result.ok
          ? `${result.rootName ?? "Root"} returned ${result.childCount ?? 0} item${(result.childCount ?? 0) === 1 ? "" : "s"}.`
          : result.nextAction ?? result.message ?? "Check the SharePoint configuration.",
        variant: result.ok ? undefined : "destructive",
      });
    } catch (err) {
      toast({
        title: "SharePoint root test failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  return (
    <Card data-testid="active-projects-root-card">
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Active Projects SharePoint root</h3>
          {isLoading ? (
            <Badge variant="outline" className="ml-auto text-[10px]">
              Loading…
            </Badge>
          ) : configured ? (
            <Badge
              variant="outline"
              className="ml-auto text-[10px] bg-emerald-50 text-emerald-700"
              data-testid="active-projects-root-status"
            >
              Configured
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="ml-auto text-[10px] bg-amber-50 text-amber-800"
              data-testid="active-projects-root-status"
            >
              Not configured — provisioning blocked
            </Badge>
          )}
        </div>

        {!editing ? (
          <>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>
                <span className="font-medium">Path:</span>{" "}
                <span className="font-mono">{root?.rootPath ?? "—"}</span>
              </div>
              <div>
                <span className="font-medium">Drive ID:</span>{" "}
                <span className="font-mono">{root?.driveId ?? "—"}</span>
              </div>
              <div>
                <span className="font-medium">Root item ID:</span>{" "}
                <span className="font-mono">{root?.rootItemId ?? "—"}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => setPickerOpen(true)}
                data-testid="btn-browse-active-projects-root"
              >
                <FolderTree className="h-3.5 w-3.5 mr-1" />
                Browse SharePoint
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={startEdit}
                data-testid="btn-edit-active-projects-root"
              >
                <Pencil className="h-3.5 w-3.5 mr-1" />
                {configured ? "Edit" : "Configure"}
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Display name</Label>
                <Input
                  value={form.displayName}
                  onChange={(e) => patchForm("displayName", e.target.value)}
                  data-testid="input-active-projects-root-display-name"
                />
              </div>
              <div className="space-y-1">
                <Label>SharePoint path</Label>
                <Input
                  value={form.rootPath}
                  onChange={(e) => patchForm("rootPath", e.target.value)}
                  data-testid="input-active-projects-root-path"
                />
              </div>
              <div className="space-y-1">
                <Label>Graph drive ID</Label>
                <Input
                  value={form.driveId}
                  onChange={(e) => patchForm("driveId", e.target.value)}
                  placeholder="b!xxxxxx..."
                  data-testid="input-active-projects-root-drive-id"
                />
              </div>
              <div className="space-y-1">
                <Label>Graph item ID (parent folder)</Label>
                <Input
                  value={form.rootItemId}
                  onChange={(e) => patchForm("rootItemId", e.target.value)}
                  placeholder="01XXXXXXXXXXXXX..."
                  data-testid="input-active-projects-root-item-id"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Easiest: use <strong>Browse SharePoint</strong> to pick the folder and fill these in
              automatically. In dev (mock connector), placeholder IDs are auto-seeded.
            </p>
            {testResult && (
              <div
                className={`rounded-md border px-3 py-2 text-xs ${
                  testResult.ok
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-rose-200 bg-rose-50 text-rose-900"
                }`}
                data-testid="active-projects-root-test-result"
              >
                <div className="flex items-center gap-1.5 font-medium">
                  {testResult.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  )}
                  {testResult.ok ? "Connection OK" : "Connection failed"}
                  {!testResult.ok && testResult.failureCategory ? ` · ${testResult.failureCategory}` : ""}
                </div>
                {testResult.ok ? (
                  <p className="mt-1 text-emerald-800">
                    {testResult.rootName ?? "Root"} reachable · {testResult.childCount ?? 0} item{(testResult.childCount ?? 0) === 1 ? "" : "s"} found.
                  </p>
                ) : (
                  <>
                    {testResult.message && <p className="mt-1">{testResult.message}</p>}
                    {testResult.nextAction && (
                      <p className="mt-1 text-rose-700">{testResult.nextAction}</p>
                    )}
                  </>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={testConnection}
                disabled={testRoot.isPending || !form.driveId.trim()}
                data-testid="btn-test-active-projects-root"
              >
                {testRoot.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                )}
                Test
              </Button>
              <Button
                size="sm"
                onClick={save}
                disabled={upsert.isPending}
                data-testid="btn-save-active-projects-root"
              >
                {upsert.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <SharepointRootPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={handlePicked}
        />
      </CardContent>
    </Card>
  );
}

function ProvisioningResultPanel({ result }: { result: ProvisionResult }) {
  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Provisioning report</span>
        <span className="text-xs text-muted-foreground">{result.projectFolderPath}</span>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="outline" className="bg-emerald-50 text-emerald-700">
          {result.summary.created} created
        </Badge>
        <Badge variant="outline" className="bg-sky-50 text-sky-700">
          {result.summary.alreadyPresent} already present
        </Badge>
        <Badge variant="outline" className="bg-amber-50 text-amber-800">
          {result.summary.linkedExisting} linked existing
        </Badge>
        <Badge variant="outline">{result.summary.skipped} skipped</Badge>
        <Badge variant="outline" className="bg-rose-50 text-rose-700">
          {result.summary.errors} errors
        </Badge>
      </div>
      <Table data-testid="provisioning-result-table">
        <TableHeader>
          <TableRow>
            <TableHead>Folder</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>SharePoint path</TableHead>
            <TableHead>Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.map((r) => (
            <TableRow key={r.taxonomyKey}>
              <TableCell className="font-mono text-xs">{r.taxonomyKey}</TableCell>
              <TableCell>
                <ProvisionStatusBadge status={r.status} />
              </TableCell>
              <TableCell className="text-xs font-mono text-muted-foreground">
                {r.sharepointPath ?? "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.error ?? ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ProvisionStatusBadge({ status }: { status: ProvisionResult["rows"][number]["status"] }) {
  const map: Record<
    typeof status,
    { label: string; className: string; icon: ReactNode }
  > = {
    created: {
      label: "Created",
      className: "bg-emerald-50 text-emerald-700",
      icon: <FolderPlus className="h-3 w-3" />,
    },
    already_present: {
      label: "Already present",
      className: "bg-sky-50 text-sky-700",
      icon: <CheckCircle2 className="h-3 w-3" />,
    },
    linked_existing: {
      label: "Linked existing",
      className: "bg-amber-50 text-amber-800",
      icon: <LinkIcon className="h-3 w-3" />,
    },
    skipped: {
      label: "Skipped",
      className: "",
      icon: <XCircle className="h-3 w-3" />,
    },
    error: {
      label: "Error",
      className: "bg-rose-50 text-rose-700",
      icon: <XCircle className="h-3 w-3" />,
    },
  };
  const { label, className, icon } = map[status];
  return (
    <Badge variant="outline" className={`text-[10px] gap-1 ${className}`}>
      {icon}
      {label}
    </Badge>
  );
}

function ProjectFoldersTable(props: {
  folders: Array<{
    id: number;
    taxonomyKey: string;
    driveId: string | null;
    itemId: string | null;
    sharepointPath: string | null;
    provisionedAt: string | null;
    lastVerifiedAt: string | null;
    verifyError: string | null;
  }>;
  isLoading: boolean;
}) {
  const { folders, isLoading } = props;
  if (isLoading) {
    return (
      <div className="rounded-md border p-4 text-sm text-muted-foreground">
        <Loader2 className="inline-block h-3.5 w-3.5 mr-1 animate-spin" />
        Loading folders…
      </div>
    );
  }
  if (folders.length === 0) {
    return (
      <div className="rounded-md border p-4 text-sm text-muted-foreground">
        No folders provisioned for this project yet. Click <strong>Provision folders</strong> to
        create the canonical Active Clients tree on SharePoint.
      </div>
    );
  }
  return (
    <Table data-testid="project-folders-table">
      <TableHeader>
        <TableRow>
          <TableHead>Taxonomy key</TableHead>
          <TableHead>SharePoint path</TableHead>
          <TableHead>Provisioned</TableHead>
          <TableHead>Last verified</TableHead>
          <TableHead>Verify error</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {folders.map((f) => (
          <TableRow key={f.id} data-testid={`project-folder-row-${f.taxonomyKey}`}>
            <TableCell className="font-mono text-xs">{f.taxonomyKey}</TableCell>
            <TableCell className="text-xs font-mono text-muted-foreground">
              {f.sharepointPath ?? "—"}
            </TableCell>
            <TableCell className="text-xs">
              {f.provisionedAt ? new Date(f.provisionedAt).toLocaleString() : "—"}
            </TableCell>
            <TableCell className="text-xs">
              {f.lastVerifiedAt ? new Date(f.lastVerifiedAt).toLocaleString() : "—"}
            </TableCell>
            <TableCell className="text-xs text-rose-700">{f.verifyError ?? ""}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
