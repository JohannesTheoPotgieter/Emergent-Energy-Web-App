import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Copy, Plus } from "lucide-react";

interface CreateRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (key: string, label: string) => void;
  canManageRoles: boolean;
  isPending: boolean;
}

export function CreateRoleDialog({ open, onOpenChange, onConfirm, canManageRoles, isPending }: CreateRoleDialogProps) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");

  const handleClose = () => { onOpenChange(false); setKey(""); setLabel(""); };
  const handleConfirm = () => { onConfirm(key.trim(), label.trim()); };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Create New Role</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs font-medium text-gray-600">Role Key *</Label>
            <Input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="e.g. SITE_MANAGER" data-testid="input-create-role-key" />
          </div>
          <div>
            <Label className="text-xs font-medium text-gray-600">Display Name *</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Site Manager" data-testid="input-create-role-label" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} data-testid="button-cancel-create">Cancel</Button>
          <Button onClick={handleConfirm} disabled={!canManageRoles || !key.trim() || !label.trim() || isPending} className="bg-emerald-600 hover:bg-emerald-700" data-testid="button-confirm-create">
            {isPending ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CloneRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (key: string, label: string) => void;
  sourceLabel: string;
  isPending: boolean;
}

export function CloneRoleDialog({ open, onOpenChange, onConfirm, sourceLabel, isPending }: CloneRoleDialogProps) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState(`${sourceLabel} (Copy)`);

  const handleClose = () => { onOpenChange(false); setKey(""); setLabel(""); };
  const handleConfirm = () => { onConfirm(key.trim(), label.trim()); };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-5 w-5 text-emerald-600" /> Clone Role
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-600">
          Create a new role with all navigation sections and permissions copied from <strong>{sourceLabel}</strong>.
        </p>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs font-medium text-gray-600">New Role Key *</Label>
            <Input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="e.g. SITE_MANAGER" data-testid="input-clone-role-key" />
          </div>
          <div>
            <Label className="text-xs font-medium text-gray-600">Display Name *</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Site Manager" data-testid="input-clone-role-label" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!key.trim() || !label.trim() || isPending} className="bg-emerald-600 hover:bg-emerald-700" data-testid="button-confirm-clone">
            {isPending ? "Cloning..." : "Clone Role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ArchiveRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  roleLabel: string;
  userCount: number;
  isPending: boolean;
}

export function ArchiveRoleDialog({ open, onOpenChange, onConfirm, roleLabel, userCount, isPending }: ArchiveRoleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            Archive Role
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-600 py-2">
          Archive <strong>{roleLabel}</strong>? This will disable data editing for users with this role. The role can be unarchived later.
        </p>
        {userCount > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 flex items-start gap-2">
            <span>This role has {userCount} assigned user{userCount !== 1 ? "s" : ""}. They will lose edit access.</span>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onConfirm} disabled={isPending} className="bg-amber-600 hover:bg-amber-700 text-white" data-testid="button-confirm-archive">
            {isPending ? "Archiving..." : "Archive Role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DeleteRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  roleLabel: string;
  userCount: number;
  isPending: boolean;
}

export function DeleteRoleDialog({ open, onOpenChange, onConfirm, roleLabel, userCount, isPending }: DeleteRoleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            Delete Role
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-600 py-2">
          Permanently delete <strong>{roleLabel}</strong>? This action cannot be undone.
        </p>
        {userCount > 0 && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 flex items-start gap-2">
            <span>This role has {userCount} assigned user{userCount !== 1 ? "s" : ""}. They will need to be reassigned.</span>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending} data-testid="button-confirm-delete-role">
            {isPending ? "Deleting..." : "Delete Role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
