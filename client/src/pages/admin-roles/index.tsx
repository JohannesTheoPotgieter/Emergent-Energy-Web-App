// Task #107 — Roles & Permissions, ONE single screen.
//
// Layout:
//   ┌──────────────────────────────────────────────────────────────────┐
//   │ Header: title · "Change history" · "Visibility settings →"       │
//   ├──────────────────────────────────────────────────────────────────┤
//   │  PickerRail (320px)  │  Right detail panel (flex-1, scrolls)     │
//   │  – mode toggle       │  – user OR role view                      │
//   │  – search            │                                           │
//   │  – list              │                                           │
//   └──────────────────────────────────────────────────────────────────┘
//
// All CRUD is folded into per-context drawers (Manage account from People,
// audit from header). Visibility is delegated to /admin/settings.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ShieldCheck, History, Eye, ExternalLink, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdminPageShell } from "@/components/admin/admin-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import * as api from "../admin-settings/settings-api";
import type { RoleSummary, UserSummary } from "../admin-settings/settings-types";
import { DEPARTMENTS } from "../admin-settings/settings-types";
import { PickerRail, type PickerMode } from "./picker-rail";
import { RightPanelUser } from "./right-panel-user";
import { RightPanelRole } from "./right-panel-role";
import { AuditLogDrawer } from "./audit-log-drawer";
import { ManageAccountDrawer } from "./manage-account-drawer";

// Deep-link contract:
//   /admin/roles?user=<id>   → People mode, user <id> selected
//   /admin/roles?role=<KEY>  → Roles mode, role <KEY> selected
//   /admin/roles             → People mode, nothing selected
// `?user` and `?role` are mutually exclusive — the param implies the mode.
const PARAM_USER = "user";
const PARAM_ROLE = "role";

function readInitial(): { mode: PickerMode; selected: string | null } {
  if (typeof window === "undefined") return { mode: "people", selected: null };
  const url = new URL(window.location.href);
  const userId = url.searchParams.get(PARAM_USER);
  const roleKey = url.searchParams.get(PARAM_ROLE);
  if (roleKey) return { mode: "roles", selected: roleKey };
  if (userId) return { mode: "people", selected: userId };
  return { mode: "people", selected: null };
}

function writeUrl(mode: PickerMode, selected: string | null, replace: boolean) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  // Always clear the other side so the params stay mutually exclusive.
  url.searchParams.delete(PARAM_USER);
  url.searchParams.delete(PARAM_ROLE);
  if (selected) {
    url.searchParams.set(mode === "people" ? PARAM_USER : PARAM_ROLE, selected);
  }
  const next = url.toString();
  if (next === window.location.href) return;
  if (replace) window.history.replaceState({}, "", next);
  else window.history.pushState({}, "", next);
}

export default function AdminRolesPage() {
  const initial = useMemo(readInitial, []);
  const [mode, setMode] = useState<PickerMode>(initial.mode);
  const [selected, setSelected] = useState<string | null>(initial.selected);
  const [search, setSearch] = useState("");
  const [auditOpen, setAuditOpen] = useState(false);
  const [accountDrawerOpen, setAccountDrawerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  // Track whether the next URL update should replace (initial / popstate) or push (user nav).
  const [shouldReplace, setShouldReplace] = useState(true);
  const { toast } = useToast();
  const qc = useQueryClient();

  // Permissions gate — used to decide whether to surface the "+ New user" affordance.
  const permsQ = useQuery({
    queryKey: ["/api/auth/permissions"],
    queryFn: api.fetchPermissions,
  });
  const canManageUsers = Boolean(permsQ.data?.canManageUsers);

  // Roles list — needed by the create-user dialog (role picker).
  const rolesQ = useQuery({
    queryKey: ["/api/roles/control-center"],
    queryFn: api.fetchRolesControlCenter,
  });

  // Keep the URL in sync so deep-links work and back-button is preserved.
  useEffect(() => {
    writeUrl(mode, selected, shouldReplace);
    if (shouldReplace) setShouldReplace(false);
  }, [mode, selected, shouldReplace]);

  // Honour browser back/forward by re-hydrating selection from the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      const next = readInitial();
      setShouldReplace(true);
      setMode(next.mode);
      setSelected(next.selected);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Reset selection when switching modes (a userId is meaningless in roles mode).
  function handleModeChange(next: PickerMode) {
    setMode(next);
    setSelected(null);
    setSearch("");
  }

  // The right panel needs the selected user object, so we fetch the users list
  // once at the page level and look up by id.
  const usersQ = useQuery<UserSummary[]>({
    queryKey: ["/api/admin/users"],
    queryFn: api.fetchUsers,
    enabled: mode === "people",
  });

  const selectedUser = useMemo<UserSummary | null>(() => {
    if (mode !== "people" || !selected) return null;
    const id = Number(selected);
    if (!Number.isFinite(id)) return null;
    return usersQ.data?.find((u) => u.id === id) ?? null;
  }, [mode, selected, usersQ.data]);

  return (
    <AdminPageShell
      surfaceId="roles"
      title="Roles & Permissions"
      description="Pick a person or a role on the left, edit on the right — backend-aligned access, authority, and role assignment control."
      metrics={[
        { label: "People", value: usersQ.data?.length ?? "—", helper: "Accounts in the directory" },
        { label: "Roles", value: rolesQ.data?.roles?.length ?? "—", helper: "Defined company roles" },
        { label: "Departments", value: DEPARTMENTS.length, helper: "Organisational departments" },
        { label: "Access model", value: "Backend-aligned", helper: "RBAC enforced server-side" },
      ]}
      actions={
        <>
          <Link
            href="/admin/settings?section=visibility"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="button-visibility-settings"
          >
            <Eye className="h-3.5 w-3.5" /> Visibility settings
            <ExternalLink className="h-3 w-3 text-gray-400" />
          </Link>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setAuditOpen(true)}
            data-testid="button-change-history"
          >
            <History className="h-3.5 w-3.5" /> Audit log
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="admin-roles-page">
        <p className="text-sm text-muted-foreground">
          Need to change who sees which workspaces or tickets? Use{" "}
          <Link
            href="/admin/settings?section=visibility"
            className="text-emerald-700 underline-offset-2 hover:underline"
            data-testid="link-visibility-settings"
          >
            Visibility settings
          </Link>
          .{" "}
          <a
            href="/docs/permissions"
            className="text-emerald-700 underline-offset-2 hover:underline"
            data-testid="link-docs-permissions"
          >
            Read the COO/CEO guide
          </a>
          .
        </p>

      {/* ── Two-column body (stacks on mobile, side-by-side on lg+) ──── */}
      <div className="flex flex-col lg:flex-row gap-4">
        <PickerRail
          mode={mode}
          onModeChange={handleModeChange}
          query={search}
          onQueryChange={setSearch}
          selectedKey={selected}
          onSelect={setSelected}
          onCreateUser={canManageUsers ? () => setCreateOpen(true) : undefined}
        />

        <div className="min-w-0 flex-1">
          {!selected ? (
            <Card className="border-dashed border-gray-200 shadow-none">
              <CardContent className="py-16 text-center">
                <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="text-base font-medium text-gray-700">
                  Pick a {mode === "people" ? "person" : "role"} from the list
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {mode === "people"
                    ? "Edit their role, apply a template, or open Manage account for password resets and deletes."
                    : "Edit the permission matrix, navigation access, and authority scope for the selected role."}
                </p>
              </CardContent>
            </Card>
          ) : mode === "people" ? (
            selectedUser ? (
              <RightPanelUser
                user={selectedUser}
                onOpenManageAccount={() => setAccountDrawerOpen(true)}
              />
            ) : usersQ.isError ? (
              // UI/UX audit X1 — a failed user fetch must not masquerade as an
              // endless "Loading person…". Surface an explicit, retryable error.
              <Card className="border-red-200 bg-red-50/40 shadow-sm" data-testid="user-lookup-error">
                <CardContent className="py-12 text-center">
                  <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-red-500" />
                  <p className="text-sm font-medium text-red-800">Couldn’t load this person</p>
                  <p className="mt-1 text-xs text-red-700">
                    This is a loading error, not a missing account. Check your connection and try again.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-4 border-red-300 text-red-700 hover:bg-red-100"
                    onClick={() => void usersQ.refetch()}
                    data-testid="button-retry-users"
                  >
                    Retry
                  </Button>
                </CardContent>
              </Card>
            ) : usersQ.isLoading ? (
              <Card className="border-gray-200 shadow-sm">
                <CardContent className="py-12 text-center text-sm text-gray-500">
                  Loading person…
                </CardContent>
              </Card>
            ) : (
              // Loaded successfully but no match → genuinely missing user.
              <Card className="border-gray-200 shadow-sm">
                <CardContent className="py-12 text-center">
                  <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                  <p className="text-sm font-medium text-gray-700">Person not found</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    No account matches this selection. Pick someone from the list.
                  </p>
                </CardContent>
              </Card>
            )
          ) : (
            <RightPanelRole
              roleKey={selected}
              onRoleDeleted={() => setSelected(null)}
            />
          )}
        </div>
      </div>

      {/* ── Drawers ─────────────────────────────────────────────────── */}
      <AuditLogDrawer open={auditOpen} onOpenChange={setAuditOpen} />
      <ManageAccountDrawer
        user={selectedUser}
        open={accountDrawerOpen}
        onOpenChange={setAccountDrawerOpen}
        onDeleted={() => setSelected(null)}
      />
      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        roles={rolesQ.data?.roles ?? []}
        onCreated={(id) => {
          qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
          setCreateOpen(false);
          // Open the new account in the right panel so the COO can immediately edit it.
          setMode("people");
          setSelected(String(id));
          toast({ title: "User created" });
        }}
      />
      </div>
    </AdminPageShell>
  );
}

// ───────────────────────────────────────────────────────────────────────
// CreateUserDialog — folded in here so it can share the page-level query
// invalidation hook and immediately select the new account on the rail.
// Only the fields exposed by the existing `api.createUser` contract are
// surfaced (username, name, email, password, role, department); broader
// HRIS-style fields (location, manager) are not part of the current data
// model and would require a schema change beyond the scope of Task #107.
// ───────────────────────────────────────────────────────────────────────
interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: RoleSummary[];
  onCreated: (newUserId: number) => void;
}

function CreateUserDialog({ open, onOpenChange, roles, onCreated }: CreateUserDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    username: "",
    name: "",
    email: "",
    password: "",
    role: "",
    department: "",
  });

  // Reset form whenever the dialog re-opens so stale data does not leak across uses.
  useEffect(() => {
    if (open) setForm({ username: "", name: "", email: "", password: "", role: "", department: "" });
  }, [open]);

  // The /api/admin/users POST handler returns the new user record at the top
  // level on success (id, name, email, role, ...). Some legacy paths nest it
  // under a `user` key, so we narrow against both shapes without resorting to `any`.
  type CreateUserResponse =
    | { id: number; [k: string]: unknown }
    | { user: { id: number; [k: string]: unknown } };

  function extractNewUserId(payload: unknown): number | null {
    if (payload && typeof payload === "object") {
      const direct = (payload as { id?: unknown }).id;
      if (typeof direct === "number" && Number.isFinite(direct)) return direct;
      const nested = (payload as { user?: { id?: unknown } }).user?.id;
      if (typeof nested === "number" && Number.isFinite(nested)) return nested;
    }
    return null;
  }

  const createM = useMutation<CreateUserResponse | undefined>({
    mutationFn: async () => {
      const res = await api.createUser(form);
      if (!res.ok) throw new Error(res.error || "Create failed");
      return res.data as CreateUserResponse | undefined;
    },
    onSuccess: (data) => {
      const newId = extractNewUserId(data);
      if (newId !== null) onCreated(newId);
      else onOpenChange(false);
    },
    onError: (e: Error) =>
      toast({ title: "Create user failed", description: e.message, variant: "destructive" }),
  });

  const ready = Boolean(form.username && form.name && form.email && form.password.length >= 8);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-create-user" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create new user</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Full name *</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Jane Smith"
              data-testid="input-create-name"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Username *</Label>
            <Input
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              placeholder="jsmith"
              data-testid="input-create-username"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Email *</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="jane@company.com"
              data-testid="input-create-email"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Password * (min 8 chars)</Label>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="Set initial password"
              data-testid="input-create-password"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Role</Label>
            <SearchableSelect
              options={roles.map((r) => ({ value: r.role, label: r.label }))}
              value={form.role}
              onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}
              placeholder="Pick a role"
              searchPlaceholder="Search roles…"
              data-testid="select-create-role"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Department</Label>
            <SearchableSelect
              options={DEPARTMENTS.map((d) => ({ value: d, label: d }))}
              value={form.department}
              onValueChange={(v) => setForm((f) => ({ ...f, department: v }))}
              placeholder="Pick department"
              searchPlaceholder="Search departments…"
              data-testid="select-create-department"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-create-user">
            Cancel
          </Button>
          <Button
            onClick={() => createM.mutate()}
            disabled={!ready || createM.isPending}
            className="bg-emerald-600 hover:bg-emerald-700"
            data-testid="button-confirm-create-user"
          >
            {createM.isPending ? "Creating…" : "Create user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
