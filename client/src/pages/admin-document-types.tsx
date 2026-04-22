import { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { PageLayout, TableLayout } from "@/components/layout";
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
import { toast } from "@/hooks/use-toast";
import {
  useAllDocumentTypes, useCreateDocumentType, useDeactivateDocumentType, useUpdateDocumentType,
  type CreateDocumentTypePayload,
} from "@/hooks/use-admin-document-types";
import { isSuperAdmin } from "@/lib/access-control";
import type { ControlledDocumentType } from "@shared/schema";
import { ApiError } from "@/lib/api-error";
import { Plus, Pencil, PowerOff, AlertTriangle, CheckCircle2, Power, Loader2 } from "lucide-react";

const APPROVER_ROLE_OPTIONS = [
  "CEO_ADMIN", "COO_ADMIN", "CFO", "PROGRAM_MANAGER", "PROGRAM_FINANCE_MANAGER",
  "CONSTRUCTION_MANAGER", "ENGINEERING_MANAGER", "QUALITY_MANAGER",
  "KEY_ACCOUNTS_MANAGER", "HSE_MANAGER", "SSEG_MANAGER", "ACCOUNTANT",
] as const;

/**
 * D5.2 — Document type taxonomy editor.
 *
 * Super-user surface (COO_ADMIN / CEO_ADMIN) for adding / editing /
 * deactivating document types. Typeclass is the taxonomy that drives
 * every DocumentStrip row, approver matrix, and SharePoint sub-folder.
 */
export default function AdminDocumentTypesPage() {
  const companyRole = localStorage.getItem("company_role");
  const tokenRole = localStorage.getItem("user_role");
  if (!isSuperAdmin(tokenRole, companyRole)) {
    return (
      <PageLayout header={<PageHeader title="Document types" subtitle="Access denied." />}>
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="py-10 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-amber-500 mb-2" />
            <p className="text-sm font-medium">Only COO and CEO admins can edit document types.</p>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  return <AdminDocumentTypesContent />;
}

function AdminDocumentTypesContent() {
  const { data, isLoading, error } = useAllDocumentTypes();
  const [editing, setEditing] = useState<ControlledDocumentType | null>(null);
  const [creating, setCreating] = useState(false);

  const types = data?.types ?? [];
  const activeCount = types.filter((t) => t.active).length;

  if (isLoading) return <PageSkeleton />;
  if (error) return <PageError message="Failed to load document types" />;

  const toolbar = (
    <div className="flex items-center gap-3 w-full">
      <div className="text-sm text-muted-foreground">
        {activeCount} active · {types.length - activeCount} inactive
      </div>
      <Button size="sm" className="ml-auto" onClick={() => setCreating(true)} data-testid="btn-add-doc-type">
        <Plus className="h-3.5 w-3.5 mr-1" />
        Add document type
      </Button>
    </div>
  );

  const table = (
    <Table data-testid="admin-doc-types-table">
      <TableHeader>
        <TableRow>
          <TableHead>Type key</TableHead>
          <TableHead>Display name</TableHead>
          <TableHead>Folder sub-path</TableHead>
          <TableHead>Default approvers</TableHead>
          <TableHead className="text-center">Multi-approver</TableHead>
          <TableHead className="text-center">Active</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {types.map((t) => (
          <TableRow key={t.typeKey} data-testid={`doc-type-row-${t.typeKey}`}>
            <TableCell className="font-mono text-xs">{t.typeKey}</TableCell>
            <TableCell>
              <div>
                <p className="text-sm font-medium">{t.displayName}</p>
                {t.description && (
                  <p className="text-[11px] text-muted-foreground truncate max-w-sm">{t.description}</p>
                )}
              </div>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground font-mono">{t.folderSubPath}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {(t.defaultApproverRoles ?? []).map((r) => (
                  <Badge key={r} variant="outline" className="text-[10px]">{r}</Badge>
                ))}
              </div>
            </TableCell>
            <TableCell className="text-center">
              {t.requiresAllApprovers ? (
                <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700">All required</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">Any one</Badge>
              )}
            </TableCell>
            <TableCell className="text-center">
              {t.active ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 mx-auto" />
              ) : (
                <PowerOff className="h-4 w-4 text-muted-foreground mx-auto" />
              )}
            </TableCell>
            <TableCell className="text-right">
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(t)} data-testid={`btn-edit-${t.typeKey}`}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
        {types.length === 0 && (
          <TableRow>
            <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
              No document types yet.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );

  return (
    <PageLayout
      data-testid="admin-doc-types-page"
      header={
        <PageHeader
          title="Document types"
          subtitle="Edit the taxonomy that drives every project's controlled documents + approval matrix."
        />
      }
    >
      <TableLayout toolbar={toolbar} table={table} />

      {creating && (
        <DocumentTypeFormDialog
          open={creating}
          onOpenChange={setCreating}
          mode="create"
          onClosed={() => setCreating(false)}
        />
      )}
      {editing && (
        <DocumentTypeFormDialog
          open={editing !== null}
          onOpenChange={(o) => { if (!o) setEditing(null); }}
          mode="edit"
          existing={editing}
          onClosed={() => setEditing(null)}
        />
      )}
    </PageLayout>
  );
}

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  existing?: ControlledDocumentType;
  onClosed?: () => void;
}

function DocumentTypeFormDialog({ open, onOpenChange, mode, existing, onClosed }: FormDialogProps) {
  const [typeKey, setTypeKey] = useState(existing?.typeKey ?? "");
  const [displayName, setDisplayName] = useState(existing?.displayName ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [folderSubPath, setFolderSubPath] = useState(existing?.folderSubPath ?? "");
  const [roles, setRoles] = useState<string[]>(existing?.defaultApproverRoles ?? []);
  const [requiresAllApprovers, setRequiresAllApprovers] = useState(existing?.requiresAllApprovers ?? false);
  const [active, setActive] = useState(existing?.active ?? true);
  const [sortOrder, setSortOrder] = useState<number>(existing?.sortOrder ?? 999);

  const createMut = useCreateDocumentType();
  const updateMut = useUpdateDocumentType();
  const deactivateMut = useDeactivateDocumentType();
  const busy = createMut.isPending || updateMut.isPending || deactivateMut.isPending;

  const canSubmit =
    displayName.trim().length > 0 &&
    folderSubPath.trim().length > 0 &&
    roles.length > 0 &&
    (mode === "edit" || /^[a-z0-9_]+$/.test(typeKey.trim()));

  const toggleRole = (role: string) => {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  const handleSubmit = async () => {
    try {
      if (mode === "create") {
        const payload: CreateDocumentTypePayload = {
          typeKey: typeKey.trim(),
          displayName: displayName.trim(),
          description: description.trim() || null,
          folderSubPath: folderSubPath.trim(),
          defaultApproverRoles: roles,
          requiresAllApprovers,
          sortOrder,
        };
        await createMut.mutateAsync(payload);
        toast({ title: "Document type created", description: displayName });
      } else if (existing) {
        await updateMut.mutateAsync({
          typeKey: existing.typeKey,
          patch: {
            displayName: displayName.trim(),
            description: description.trim() || null,
            folderSubPath: folderSubPath.trim(),
            defaultApproverRoles: roles,
            requiresAllApprovers,
            active,
            sortOrder,
          },
        });
        toast({ title: "Document type updated", description: displayName });
      }
      onOpenChange(false);
      onClosed?.();
    } catch (err) {
      toast({
        title: mode === "create" ? "Create failed" : "Update failed",
        description: err instanceof ApiError ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDeactivate = async () => {
    if (!existing) return;
    try {
      await deactivateMut.mutateAsync({ typeKey: existing.typeKey });
      toast({ title: "Document type deactivated", description: existing.displayName });
      onOpenChange(false);
      onClosed?.();
    } catch (err) {
      toast({
        title: "Deactivate failed",
        description: err instanceof ApiError ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" data-testid="doc-type-dialog">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Add document type" : `Edit: ${existing?.displayName}`}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Define a new controlled document type. It becomes available on every project's DocumentStrip."
              : "Change the approver matrix, folder path or description. typeKey cannot be changed."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">
                Type key {mode === "edit" && <span className="text-[10px] text-muted-foreground">(immutable)</span>}
              </Label>
              <Input
                value={typeKey}
                onChange={(e) => setTypeKey(e.target.value.toLowerCase())}
                placeholder="e.g. site_survey"
                disabled={mode === "edit"}
                data-testid="input-type-key"
              />
              <p className="text-[10px] text-muted-foreground">Lowercase, numbers, underscores only.</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Display name</Label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Site Survey"
                data-testid="input-display-name"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description shown in the submit dialog."
              rows={2}
              data-testid="input-description"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Folder sub-path (under project SharePoint root)</Label>
            <Input
              value={folderSubPath}
              onChange={(e) => setFolderSubPath(e.target.value)}
              placeholder="e.g. BD/Cost Proposal/Site Survey"
              className="font-mono text-xs"
              data-testid="input-folder-sub-path"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Default approver roles ({roles.length} selected)</Label>
            <div className="grid grid-cols-3 gap-1.5 rounded-md border p-2">
              {APPROVER_ROLE_OPTIONS.map((role) => (
                <label key={role} className="flex items-center gap-1.5 cursor-pointer text-xs">
                  <Checkbox
                    checked={roles.includes(role)}
                    onCheckedChange={() => toggleRole(role)}
                    data-testid={`role-checkbox-${role}`}
                  />
                  <span className="font-mono">{role}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox
                checked={requiresAllApprovers}
                onCheckedChange={(v) => setRequiresAllApprovers(v === true)}
                data-testid="checkbox-requires-all"
              />
              Requires ALL approvers (multi-approver)
            </label>
            {mode === "edit" && (
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox
                  checked={active}
                  onCheckedChange={(v) => setActive(v === true)}
                  data-testid="checkbox-active"
                />
                Active
              </label>
            )}
            <div className="flex items-center gap-1.5">
              <Label className="text-xs">Sort order</Label>
              <Input
                type="number"
                className="w-20 h-8"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
                data-testid="input-sort-order"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          {mode === "edit" && existing?.active && (
            <Button
              variant="outline"
              className="mr-auto text-red-700 hover:text-red-700"
              onClick={handleDeactivate}
              disabled={busy}
              data-testid="btn-deactivate"
            >
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <PowerOff className="h-4 w-4 mr-1" />}
              Deactivate
            </Button>
          )}
          {mode === "edit" && !existing?.active && (
            <Badge variant="outline" className="mr-auto text-[10px] text-muted-foreground">
              <PowerOff className="h-3 w-3 mr-1" /> Inactive
            </Badge>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || busy} data-testid="btn-save-doc-type">
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Power className="h-4 w-4 mr-1" />}
            {mode === "create" ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
