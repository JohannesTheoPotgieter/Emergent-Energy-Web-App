// Task #107 — "Manage account" side drawer reachable from the People right panel.
//
// Folds the legacy GlobalUsersView CRUD (department, password reset, delete)
// into a focused per-user drawer that keeps the main canvas uncluttered.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Lock, Trash2, UserCog, Loader2 } from "lucide-react";
import * as api from "../admin-settings/settings-api";
import { DEPARTMENTS } from "../admin-settings/settings-types";
import type { UserSummary } from "../admin-settings/settings-types";

interface ManageAccountDrawerProps {
  user: UserSummary | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDeleted?: (userId: number) => void;
}

export function ManageAccountDrawer({ user, open, onOpenChange, onDeleted }: ManageAccountDrawerProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [department, setDepartment] = useState<string>("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Permission gate — read-only viewers can see the drawer but cannot mutate.
  const permsQ = useQuery({
    queryKey: ["/api/auth/permissions"],
    queryFn: api.fetchPermissions,
    staleTime: 60_000,
    enabled: open,
  });
  const canManage = Boolean(permsQ.data?.canManageUsers);

  useEffect(() => {
    setDepartment(user?.department ?? "");
    setNewPassword("");
    setShowPassword(false);
    setConfirmDelete(false);
  }, [user?.id]);

  const deptM = useMutation({
    mutationFn: async (dep: string) => {
      if (!user) throw new Error("No user");
      const r = await api.updateUserDepartment(user.id, dep);
      if (!r.ok) throw new Error("Failed to update department");
      return r.data?.department ?? dep;
    },
    onSuccess: (dep) => {
      toast({ title: "Department updated", description: `Set to ${dep}` });
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const pwM = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("No user");
      if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");
      const r = await api.resetUserPassword(user.id, newPassword);
      if (!r.ok) throw new Error(r.error || "Password reset failed");
    },
    onSuccess: () => {
      toast({ title: "Password reset", description: `New password saved for ${user?.name}` });
      setNewPassword("");
      setShowPassword(false);
    },
    onError: (e: Error) => toast({ title: "Reset failed", description: e.message, variant: "destructive" }),
  });

  const delM = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("No user");
      const r = await api.deleteUser(user.id);
      if (!r.ok) throw new Error(r.error || "Delete failed");
      return user.id;
    },
    onSuccess: (id) => {
      toast({ title: "User deleted" });
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
      onDeleted?.(id);
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" data-testid="manage-account-drawer">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5 text-emerald-600" />
            Manage account
          </SheetTitle>
          {user && (
            <p className="text-xs text-muted-foreground">
              {user.name} <span className="text-gray-400">·</span> {user.email}
            </p>
          )}
          {user && !canManage && !permsQ.isLoading && (
            <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800" data-testid="text-account-readonly">
              View-only — you cannot make changes here.
            </p>
          )}
        </SheetHeader>

        {!user ? (
          <div className="py-8 text-center text-sm text-gray-400">No user selected.</div>
        ) : (
          <div className="mt-6 space-y-6">
            {/* Department */}
            <section className="space-y-2" data-testid="account-section-department">
              <Label className="text-xs font-medium text-gray-600">Department</Label>
              <div className="flex gap-2">
                <SearchableSelect
                  options={[
                    ...DEPARTMENTS.map((d) => ({ value: d, label: d })),
                    ...(user.department && !DEPARTMENTS.includes(user.department) ? [{ value: user.department, label: user.department }] : []),
                  ]}
                  value={department}
                  onValueChange={setDepartment}
                  placeholder="Select department"
                  disabled={!canManage}
                />
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  disabled={!canManage || !department || department === (user.department ?? "") || deptM.isPending}
                  onClick={() => deptM.mutate(department)}
                  data-testid="button-save-department"
                >
                  {deptM.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Changing the department updates this user's home dashboard but does not change their role or permissions.
              </p>
            </section>

            {/* Reset password */}
            <section className="space-y-2 border-t border-gray-100 pt-4" data-testid="account-section-password">
              <Label className="flex items-center gap-1 text-xs font-medium text-gray-600">
                <Lock className="h-3 w-3" /> Reset password
              </Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  data-testid="input-new-password"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                size="sm"
                className="w-full bg-emerald-600 hover:bg-emerald-700"
                disabled={!canManage || newPassword.length < 8 || pwM.isPending}
                onClick={() => pwM.mutate()}
                data-testid="button-reset-password"
              >
                {pwM.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Reset password"}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                The user will need this new password to sign in next time.
              </p>
            </section>

            {/* Delete */}
            <section className="space-y-2 border-t border-gray-100 pt-4" data-testid="account-section-delete">
              <Label className="flex items-center gap-1 text-xs font-medium text-red-600">
                <Trash2 className="h-3 w-3" /> Delete account
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Permanently removes the account and all of their personal preferences. This cannot be undone.
              </p>
              {!confirmDelete ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full border-red-200 text-red-600 hover:bg-red-50"
                  disabled={!canManage}
                  onClick={() => setConfirmDelete(true)}
                  data-testid="button-delete-prompt"
                >
                  Delete this user…
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => setConfirmDelete(false)} data-testid="button-cancel-delete">
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="flex-1"
                    disabled={!canManage || delM.isPending}
                    onClick={() => delM.mutate()}
                    data-testid="button-confirm-delete"
                  >
                    {delM.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Yes, delete"}
                  </Button>
                </div>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
