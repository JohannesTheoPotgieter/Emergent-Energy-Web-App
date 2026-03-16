import React, { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Copy, Plus, Save, Search, Shield, ShieldAlert, Users } from "lucide-react";
import type { PermissionAction, PermissionEntity } from "@shared/schema";

const ACTIONS: PermissionAction[] = ["view", "create", "edit", "approve", "override", "delete"];
const NAV_SECTIONS = ["MY_WORK", "PROJECTS", "PROJECT_DEVELOPMENT", "DELIVERY", "GOVERNANCE", "MONEY", "INFORMATION", "SETTINGS"];
const SCOPE_OPTIONS = ["none", "own", "assigned", "department", "assigned_projects", "managed_projects", "all_department", "company_wide", "finance_only", "admin_only"];

type RoleRow = {
  role: string;
  label: string;
  description: string | null;
  sections: string[];
  entityPermissions: Record<string, Record<string, boolean>> | null;
  canManageUsers: boolean;
  canManageRoles: boolean;
  canEditData: boolean;
  isSystem: boolean;
  userCount?: number;
  configuredResources?: number;
  protected?: boolean;
};

type UserRow = { id: number; name: string; email: string; role: string; department?: string; status?: string };

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("auth_token");
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

export default function AdminRolesPage() {
  const companyRole = localStorage.getItem("company_role");
  if (!["COO_ADMIN", "CEO_ADMIN"].includes(companyRole || "")) {
    return <div className="min-h-[60vh] flex items-center justify-center"><Card><CardContent className="py-12 px-16 text-center"><AlertTriangle className="mx-auto mb-3 text-amber-500" /><p>Access denied.</p></CardContent></Card></div>;
  }

  return (
    <div className="space-y-4 max-w-[1700px] mx-auto" data-testid="admin-roles-page">
      <h1 className="text-2xl font-bold flex items-center gap-2"><Shield className="h-5 w-5" />Roles & Permissions</h1>
      <Tabs defaultValue="roles">
        <TabsList className="grid grid-cols-2 w-full max-w-[360px]"><TabsTrigger value="roles">Roles / Permissions</TabsTrigger><TabsTrigger value="users">Users</TabsTrigger></TabsList>
        <TabsContent value="roles"><RolesControlCenter /></TabsContent>
        <TabsContent value="users"><GlobalUsersView /></TabsContent>
      </Tabs>
    </div>
  );
}

function RolesControlCenter() {
  const { toast } = useToast();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "system" | "custom">("all");
  const [draft, setDraft] = useState<Partial<RoleRow>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [createKey, setCreateKey] = useState("");
  const [createLabel, setCreateLabel] = useState("");
  const [effective, setEffective] = useState<any[]>([]);

  const load = async () => {
    const [roleRes, userRes] = await Promise.all([
      fetch("/api/roles/control-center", { headers: authHeaders(), credentials: "include" }),
      fetch("/api/admin/users", { headers: authHeaders(), credentials: "include" }),
    ]);
    const roleData = await roleRes.json();
    const userData = await userRes.json();
    setRoles(roleData.roles || []);
    setUsers(userData || []);
    if (!selectedRole && roleData.roles?.[0]?.role) setSelectedRole(roleData.roles[0].role);
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => { setDraft({}); }, [selectedRole]);

  const selected = useMemo(() => roles.find((r) => r.role === selectedRole), [roles, selectedRole]);
  const hasChanges = Object.keys(draft).length > 0;

  const filteredRoles = roles.filter((r) => {
    if (kindFilter === "system" && !r.isSystem) return false;
    if (kindFilter === "custom" && r.isSystem) return false;
    const q = filter.toLowerCase();
    return !q || r.role.toLowerCase().includes(q) || r.label.toLowerCase().includes(q);
  });

  const effectiveRole = { ...selected, ...draft } as RoleRow;
  const currentEp = (effectiveRole.entityPermissions || {}) as Record<string, Record<string, boolean>>;

  const updateEp = (entity: string, action: string, value: boolean) => {
    const next = { ...currentEp, [entity]: { ...(currentEp[entity] || {}), [action]: value } };
    if ((action === "edit" || action === "approve" || action === "delete") && value) next[entity].view = true;
    setDraft((d) => ({ ...d, entityPermissions: next }));
  };

  const save = async () => {
    if (!selected) return;
    const res = await fetch(`/api/roles/${selected.role}`, { method: "PUT", headers: authHeaders(), credentials: "include", body: JSON.stringify(draft) });
    if (!res.ok) return toast({ title: "Save failed", variant: "destructive" });
    setDraft({});
    await load();
    toast({ title: "Role updated" });
  };

  const createRole = async () => {
    const res = await fetch("/api/roles", { method: "POST", headers: authHeaders(), credentials: "include", body: JSON.stringify({ role: createKey.trim(), label: createLabel.trim(), sections: ["MY_WORK"], canEditData: true }) });
    if (!res.ok) return toast({ title: "Create role failed", variant: "destructive" });
    setShowCreate(false); setCreateKey(""); setCreateLabel(""); await load();
  };

  const cloneRole = async () => {
    if (!selected) return;
    const key = `${selected.role}_COPY_${Date.now().toString().slice(-4)}`;
    await fetch(`/api/roles/${selected.role}/clone`, { method: "POST", headers: authHeaders(), credentials: "include", body: JSON.stringify({ role: key, label: `${selected.label} Copy` }) });
    await load();
  };

  const archiveRole = async () => {
    if (!selected || selected.isSystem) return;
    await fetch(`/api/roles/${selected.role}/archive`, { method: "PATCH", headers: authHeaders(), credentials: "include", body: JSON.stringify({ archived: true }) });
    await load();
  };

  const loadEffective = async (userId?: number) => {
    const res = await fetch("/api/roles/effective-access", { method: "POST", headers: authHeaders(), credentials: "include", body: JSON.stringify({ role: selectedRole, userId }) });
    const data = await res.json();
    setEffective(data.matrix || []);
  };

  const resources = Object.keys(currentEp).sort();

  return (
    <div className="grid grid-cols-12 gap-4">
      <Card className="col-span-3"><CardHeader><CardTitle className="text-base flex items-center justify-between">Roles <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="h-3 w-3 mr-1" />Create</Button></CardTitle></CardHeader><CardContent className="space-y-2">
        <div className="relative"><Search className="h-3 w-3 absolute left-2 top-2.5" /><Input className="pl-7 h-8" placeholder="Search roles" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
        <div className="flex gap-1"><Button variant={kindFilter === "all" ? "default" : "outline"} size="sm" onClick={() => setKindFilter("all")}>All</Button><Button variant={kindFilter === "system" ? "default" : "outline"} size="sm" onClick={() => setKindFilter("system")}>System</Button><Button variant={kindFilter === "custom" ? "default" : "outline"} size="sm" onClick={() => setKindFilter("custom")}>Custom</Button></div>
        <div className="space-y-1 max-h-[70vh] overflow-auto">{filteredRoles.map((r) => <button key={r.role} className={`w-full text-left rounded border p-2 ${selectedRole === r.role ? "border-primary bg-primary/5" : ""}`} onClick={() => setSelectedRole(r.role)}><div className="font-medium text-sm flex items-center justify-between">{r.label} {r.isSystem && <Badge variant="secondary">System</Badge>}</div><div className="text-xs text-muted-foreground flex items-center gap-2"><Users className="h-3 w-3" />{r.userCount || 0} users {r.protected && <ShieldAlert className="h-3 w-3 text-amber-500" />}</div></button>)}</div>
      </CardContent></Card>

      <div className="col-span-9 space-y-3">
        {hasChanges && <div className="sticky top-2 z-20 rounded border bg-amber-50 px-3 py-2 flex items-center justify-between"><span className="text-sm">Unsaved changes</span><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setDraft({})}>Reset</Button><Button size="sm" onClick={save}><Save className="h-3 w-3 mr-1" />Save</Button></div></div>}
        <Card><CardHeader><CardTitle className="text-base flex items-center justify-between">{selected?.label || "Select role"}<div className="flex gap-2"><Button size="sm" variant="outline" onClick={cloneRole}><Copy className="h-3 w-3 mr-1" />Clone</Button><Button size="sm" variant="outline" disabled={selected?.isSystem} onClick={archiveRole}>Archive</Button></div></CardTitle></CardHeader><CardContent>
          <Tabs defaultValue="overview">
            <TabsList className="grid grid-cols-7 w-full">
              <TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="navigation">Navigation</TabsTrigger><TabsTrigger value="resources">Resources & Actions</TabsTrigger><TabsTrigger value="scope">Scope & Limits</TabsTrigger><TabsTrigger value="enforcement">Enforcement</TabsTrigger><TabsTrigger value="users">Users</TabsTrigger><TabsTrigger value="effective">Effective Access</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="space-y-3 mt-3"><div className="grid grid-cols-2 gap-3"><div><Label>Name</Label><Input value={effectiveRole.label || ""} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} /></div><div><Label>Description</Label><Input value={effectiveRole.description || ""} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} /></div></div><div className="text-sm text-muted-foreground">Type: {selected?.isSystem ? "System" : "Custom"} · Assigned users: {selected?.userCount || 0} · Configured resources: {selected?.configuredResources || 0}</div></TabsContent>
            <TabsContent value="navigation" className="mt-3"><p className="text-xs text-amber-700 mb-2">Navigation visibility only. This controls what appears in the UI navigation and route access, but authority must also be enforced in backend/API permission checks.</p><div className="grid grid-cols-2 gap-2">{NAV_SECTIONS.map((s) => <div key={s} className="rounded border p-2 flex items-center justify-between"><span>{s}</span><Switch checked={(effectiveRole.sections || []).includes(s)} onCheckedChange={(v) => setDraft((d) => ({ ...d, sections: v ? [...(effectiveRole.sections || []), s] : (effectiveRole.sections || []).filter((x) => x !== s) }))} /></div>)}</div></TabsContent>
            <TabsContent value="resources" className="mt-3 space-y-2"><Input placeholder="Search resources" onChange={(e) => setFilter(e.target.value)} /><div className="space-y-2 max-h-[50vh] overflow-auto">{resources.filter((r) => !filter || r.toLowerCase().includes(filter.toLowerCase())).map((entity) => <div key={entity} className="rounded border p-2"><div className="font-medium text-sm mb-2">{entity}</div><div className="flex gap-2 flex-wrap">{ACTIONS.map((a) => <label key={a} className="text-xs border rounded px-2 py-1 flex items-center gap-1"><input type="checkbox" checked={Boolean(currentEp[entity]?.[a])} onChange={(e) => updateEp(entity, a, e.target.checked)} />{a}</label>)}</div></div>)}</div></TabsContent>
            <TabsContent value="scope" className="mt-3"><Label>Default Data Scope</Label><select className="w-full border rounded h-9 px-2" value={(currentEp._scope?.default as any) || "none"} onChange={(e) => updateEp("_scope", "default", true) || setDraft((d) => ({ ...d, entityPermissions: { ...currentEp, _scope: { defaultValue: e.target.value } as any } }))}>{SCOPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}</select></TabsContent>
            <TabsContent value="enforcement" className="mt-3 space-y-2"><div className="text-sm">Backend-enforced guardrails</div>{["cannot_delete_protected", "cannot_edit_closed", "cannot_approve_own", "dual_approval_sensitive", "lock_financial_after_approval"].map((rule) => <div key={rule} className="flex items-center justify-between border rounded p-2"><span className="text-sm">{rule}</span><Switch checked={Boolean((currentEp._enforcement || {})[rule])} onCheckedChange={(v) => setDraft((d) => ({ ...d, entityPermissions: { ...currentEp, _enforcement: { ...(currentEp._enforcement || {}), [rule]: v } } }))} /></div>)}</TabsContent>
            <TabsContent value="users" className="mt-3"><div className="space-y-2">{users.filter((u) => u.role === selectedRole).map((u) => <div key={u.id} className="border rounded p-2 flex justify-between items-center"><div><div className="text-sm font-medium">{u.name}</div><div className="text-xs text-muted-foreground">{u.email}</div></div><Button size="sm" variant="outline" onClick={() => loadEffective(u.id)}>Inspect access</Button></div>)}</div></TabsContent>
            <TabsContent value="effective" className="mt-3"><Button size="sm" onClick={() => loadEffective()}>Refresh effective access</Button><div className="space-y-2 mt-2 max-h-[45vh] overflow-auto">{effective.map((row: any) => <div key={row.entity} className="rounded border p-2"><div className="font-medium text-sm mb-1">{row.entity}</div><div className="grid grid-cols-3 gap-1">{row.actions.map((a: any) => <div key={a.action} className={`text-xs rounded p-1 ${a.allowed ? "bg-green-50" : "bg-red-50"}`}>{a.action}: {a.allowed ? "Allowed" : "Blocked"}</div>)}</div></div>)}</div></TabsContent>
          </Tabs>
        </CardContent></Card>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}><DialogContent><DialogHeader><DialogTitle>Create role</DialogTitle></DialogHeader><div className="space-y-2"><Label>Role key</Label><Input value={createKey} onChange={(e) => setCreateKey(e.target.value.toUpperCase())} /><Label>Label</Label><Input value={createLabel} onChange={(e) => setCreateLabel(e.target.value)} /></div><DialogFooter><Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button><Button onClick={createRole}>Create</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

function GlobalUsersView() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [search, setSearch] = useState("");
  useEffect(() => { (async () => { const [u, r] = await Promise.all([fetch("/api/admin/users", { headers: authHeaders(), credentials: "include" }), fetch("/api/roles", { headers: authHeaders(), credentials: "include" })]); setUsers(await u.json()); setRoles(await r.json()); })(); }, []);

  const updateRole = async (id: number, role: string) => {
    await fetch(`/api/admin/users/${id}/role`, { method: "PATCH", headers: authHeaders(), credentials: "include", body: JSON.stringify({ role }) });
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
  };

  return <Card><CardHeader><CardTitle>Users</CardTitle></CardHeader><CardContent className="space-y-2"><Input placeholder="Search users" value={search} onChange={(e) => setSearch(e.target.value)} />{users.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(search.toLowerCase())).map((u) => <div key={u.id} className="border rounded p-2 flex items-center justify-between"><div><div className="font-medium text-sm">{u.name}</div><div className="text-xs text-muted-foreground">{u.email}</div></div><select className="h-8 border rounded px-2 text-sm" value={u.role} onChange={(e) => updateRole(u.id, e.target.value)}>{roles.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}</select></div>)}</CardContent></Card>;
}
