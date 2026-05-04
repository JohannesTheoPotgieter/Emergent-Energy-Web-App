import React, { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Plus, Save, Shield, ShieldCheck, Trash2, UserCheck, X } from "lucide-react";
import { COMPANY_ROLES, WORKSTREAM_KEYS, WORKSTREAM_VISIBILITY_DEFAULTS, ROLE_DEPARTMENT_MAP } from "@shared/schema";
import * as api from "../settings-api";
import type { PdVisConfig, UserSummary, WorkstreamVisConfig } from "../settings-types";

const PD_TICKET_TYPE_OPTIONS = [
  { value: "pd", label: "Project Development Tickets", description: "Cost Proposals and other non-engineering tickets" },
  { value: "engineering", label: "Engineering Tickets", description: "Feasibility Study, Design Review, IFC Planning, Grid Application, Battery Assessment, Site Assessment, Full EPC" },
];

const PD_SCOPE_OPTIONS = [
  { value: "all", label: "All Tickets", description: "Can see all tickets matching the type filter" },
  { value: "own", label: "Own Tickets Only", description: "Can only see tickets they created or are assigned to" },
];

// Derived from COMPANY_ROLES so new roles are automatically included.
const PD_CONFIGURABLE_ROLES = COMPANY_ROLES;

// Derived from WORKSTREAM_KEYS so new workstreams are automatically included.
const ALL_WORKSTREAMS = WORKSTREAM_KEYS;

const WORKSTREAM_LABELS: Record<string, string> = {
  PD: "Project Development", ENG: "Engineering", QUALITY: "Quality", PM: "Project Management",
  FINANCE: "Finance", GOVERNANCE: "Governance", PERSONAL: "Personal",
};

const WORKSTREAM_COLORS: Record<string, string> = {
  PD: "bg-blue-100 text-blue-700 border-blue-200", ENG: "bg-purple-100 text-purple-700 border-purple-200",
  QUALITY: "bg-teal-100 text-teal-700 border-teal-200", PM: "bg-orange-100 text-orange-700 border-orange-200",
  FINANCE: "bg-emerald-100 text-emerald-700 border-emerald-200", GOVERNANCE: "bg-gray-100 text-gray-700 border-gray-200",
  PERSONAL: "bg-pink-100 text-pink-700 border-pink-200",
};

const DEPARTMENT_COLORS: Record<string, string> = {
  ADMIN: "bg-red-50 border-red-200", LEADERSHIP: "bg-amber-50 border-amber-200",
  ENGINEERING: "bg-purple-50 border-purple-200", PROJECT_DEVELOPMENT: "bg-blue-50 border-blue-200",
  PROJECT_MANAGEMENT: "bg-orange-50 border-orange-200", FINANCE: "bg-emerald-50 border-emerald-200",
};

export function VisibilitySection() {
  return (
    <div className="space-y-10" data-testid="section-visibility">
      <section data-testid="section-pd-visibility">
        <h2
          className="text-lg font-semibold text-gray-900 mb-3 pb-2 border-b border-gray-200"
          data-testid="heading-pd-visibility"
        >
          PD Inbox visibility
        </h2>
        <PdVisibilityView />
      </section>

      <section data-testid="section-workstream-visibility">
        <h2
          className="text-lg font-semibold text-gray-900 mb-3 pb-2 border-b border-gray-200"
          data-testid="heading-workstream-visibility"
        >
          Workstream visibility
        </h2>
        <WorkstreamVisibilityView />
      </section>
    </div>
  );
}

// ── PD Visibility ──

function PdVisibilityView() {
  const { toast } = useToast();
  const [configs, setConfigs] = useState<PdVisConfig[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showUserForm, setShowUserForm] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [userTicketTypes, setUserTicketTypes] = useState<string[]>(["pd", "engineering"]);
  const [userScope, setUserScope] = useState("all");

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [c, u] = await Promise.all([api.fetchPdVisibility(), api.fetchUsers()]);
    setConfigs(c); setUsers(u); setLoading(false);
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const roleConfigs = configs.filter(c => c.role && !c.userId);
  const userConfigs = configs.filter(c => c.userId);

  const handleSaveRole = async (role: string, ticketTypes: string[], scope: string) => {
    setSaving(true);
    const result = await api.savePdVisibilityRole(role, ticketTypes, scope);
    if (result.ok) { toast({ title: "Saved", description: `Visibility config for ${role} updated.` }); loadAll(); }
    else toast({ title: "Error", description: result.error, variant: "destructive" });
    setSaving(false);
  };

  const handleSaveUser = async () => {
    if (!selectedUserId) return;
    setSaving(true);
    const result = await api.savePdVisibilityUser(selectedUserId, userTicketTypes, userScope);
    if (result.ok) { toast({ title: "Saved" }); setShowUserForm(false); loadAll(); }
    else toast({ title: "Error", description: result.error, variant: "destructive" });
    setSaving(false);
  };

  const handleDelete = async (configId: number) => {
    const ok = await api.deletePdVisibilityConfig(configId);
    if (ok) { toast({ title: "Removed" }); loadAll(); }
  };

  if (loading) return <div className="py-8 text-center text-gray-400">Loading...</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-blue-600" /> Role-Level PD Visibility</CardTitle>
          <p className="text-sm text-muted-foreground">Configure which PD ticket types each role can see and whether they see all tickets or only their own.</p>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Role</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Ticket Types</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Scope</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {PD_CONFIGURABLE_ROLES.map(role => {
                  const config = roleConfigs.find(c => c.role === role);
                  return <RoleVisibilityRow key={role} role={role} config={config} saving={saving} onSave={handleSaveRole} onDelete={handleDelete} />;
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UserCheck className="h-5 w-5 text-blue-600" /> User-Level PD Visibility Overrides</CardTitle>
          <p className="text-sm text-muted-foreground">Override PD visibility for specific users. User overrides take precedence over role-level configs.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => setShowUserForm(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add User Override
          </Button>
          {userConfigs.length > 0 ? (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50"><tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">User</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Ticket Types</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Scope</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">Actions</th>
                </tr></thead>
                <tbody>
                  {userConfigs.map(config => {
                    const user = users.find(u => u.id === config.userId);
                    return (
                      <tr key={config.id} className="border-t hover:bg-gray-50/50">
                        <td className="px-4 py-2"><div>{user?.name || `User #${config.userId}`}</div><div className="text-xs text-gray-400">{user?.role || ""}</div></td>
                        <td className="px-4 py-2"><div className="flex gap-1 flex-wrap">{(config.ticketTypes || []).map(t => (<Badge key={t} variant="outline" className="text-xs">{t === "pd" ? "PD" : "Engineering"}</Badge>))}</div></td>
                        <td className="px-4 py-2"><Badge variant={config.scope === "all" ? "default" : "secondary"} className={config.scope === "all" ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-amber-100 text-amber-700 border-amber-200"}>{config.scope === "all" ? "All Tickets" : "Own Only"}</Badge></td>
                        <td className="px-4 py-2 text-right"><Button variant="ghost" size="sm" onClick={() => handleDelete(config.id)}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className="text-center py-6 text-gray-400 text-sm">No user-level overrides configured.</div>}
        </CardContent>
      </Card>

      <Dialog open={showUserForm} onOpenChange={setShowUserForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add User Visibility Override</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label className="text-xs">User</Label><SearchableSelect options={users.map(u => ({ value: String(u.id), label: `${u.name} (${u.role})` }))} value={selectedUserId ? String(selectedUserId) : ""} onValueChange={v => setSelectedUserId(v ? Number(v) : null)} placeholder="Select user..." /></div>
            <div><Label className="text-xs mb-2 block">Ticket Types</Label>{PD_TICKET_TYPE_OPTIONS.map(opt => (<div key={opt.value} className="flex items-center gap-2 py-1"><Switch checked={userTicketTypes.includes(opt.value)} onCheckedChange={checked => setUserTicketTypes(prev => checked ? [...prev, opt.value] : prev.filter(t => t !== opt.value))} /><div><span className="text-sm font-medium">{opt.label}</span><span className="text-xs text-gray-400 ml-2">{opt.description}</span></div></div>))}</div>
            <div><Label className="text-xs mb-2 block">Scope</Label>{PD_SCOPE_OPTIONS.map(opt => (<div key={opt.value} className="flex items-center gap-2 py-1"><input type="radio" name="userScope" value={opt.value} checked={userScope === opt.value} onChange={() => setUserScope(opt.value)} className="h-4 w-4 text-blue-600" /><div><span className="text-sm font-medium">{opt.label}</span><span className="text-xs text-gray-400 ml-2">{opt.description}</span></div></div>))}</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUserForm(false)}>Cancel</Button>
            <Button onClick={handleSaveUser} disabled={saving || !selectedUserId || userTicketTypes.length === 0} className="bg-blue-600 hover:bg-blue-700">{saving ? "Saving..." : "Save Override"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoleVisibilityRow({ role, config, saving, onSave, onDelete }: {
  role: string; config: PdVisConfig | undefined; saving: boolean;
  onSave: (role: string, ticketTypes: string[], scope: string) => void;
  onDelete: (id: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [ticketTypes, setTicketTypes] = useState<string[]>(config?.ticketTypes || ["pd", "engineering"]);
  const [scope, setScope] = useState(config?.scope || "all");

  useEffect(() => { setTicketTypes(config?.ticketTypes || ["pd", "engineering"]); setScope(config?.scope || "all"); }, [config]);

  const hasChanges = config ? JSON.stringify(ticketTypes.sort()) !== JSON.stringify([...(config.ticketTypes || [])].sort()) || scope !== config.scope : true;

  return (
    <tr className="border-t hover:bg-gray-50/50">
      <td className="px-4 py-3 font-medium">{role.replace(/_/g, " ")}</td>
      <td className="px-4 py-3">{editing ? (
        <div className="flex gap-3">{PD_TICKET_TYPE_OPTIONS.map(opt => (<label key={opt.value} className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={ticketTypes.includes(opt.value)} onChange={e => setTicketTypes(prev => e.target.checked ? [...prev, opt.value] : prev.filter(t => t !== opt.value))} className="h-3.5 w-3.5 rounded text-blue-600" />{opt.label}</label>))}</div>
      ) : (<div className="flex gap-1 flex-wrap">{config ? (config.ticketTypes || []).map(t => (<Badge key={t} variant="outline" className="text-xs">{t === "pd" ? "PD" : "Engineering"}</Badge>)) : <span className="text-xs text-gray-400 italic">System default</span>}</div>)}</td>
      <td className="px-4 py-3">{editing ? (
        <div className="flex gap-3">{PD_SCOPE_OPTIONS.map(opt => (<label key={opt.value} className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="radio" name={`scope-${role}`} value={opt.value} checked={scope === opt.value} onChange={() => setScope(opt.value)} className="h-3.5 w-3.5 text-blue-600" />{opt.label}</label>))}</div>
      ) : config ? (<Badge variant={config.scope === "all" ? "default" : "secondary"} className={config.scope === "all" ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-amber-100 text-amber-700 border-amber-200"}>{config.scope === "all" ? "All Tickets" : "Own Only"}</Badge>) : <span className="text-xs text-gray-400 italic">System default</span>}</td>
      <td className="px-4 py-3 text-right">{editing ? (
        <div className="flex gap-1 justify-end">
          <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setTicketTypes(config?.ticketTypes || ["pd", "engineering"]); setScope(config?.scope || "all"); }}><X className="h-3.5 w-3.5" /></Button>
          <Button size="sm" disabled={saving || ticketTypes.length === 0 || !hasChanges} className="bg-blue-600 hover:bg-blue-700" onClick={() => { onSave(role, ticketTypes, scope); setEditing(false); }}><Save className="h-3.5 w-3.5 mr-1" /> Save</Button>
        </div>
      ) : (
        <div className="flex gap-1 justify-end">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5 text-blue-500" /></Button>
          {config && <Button variant="ghost" size="sm" onClick={() => onDelete(config.id)}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>}
        </div>
      )}</td>
    </tr>
  );
}

// ── Workstream Visibility ──

function WorkstreamVisibilityView() {
  const { toast } = useToast();
  const [configs, setConfigs] = useState<WorkstreamVisConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [editWorkstreams, setEditWorkstreams] = useState<string[]>([]);
  const [editTicketTypes, setEditTicketTypes] = useState<string[]>([]);
  const [editScope, setEditScope] = useState("all");

  const loadAll = useCallback(async () => {
    setLoading(true);
    const data = await api.fetchWorkstreamVisibility();
    setConfigs(data); setLoading(false);
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const roleConfigs = configs.filter(c => c.role && !c.userId);
  const userConfigs = configs.filter(c => c.userId);

  const getEffectiveConfig = (role: string) => {
    const dbConfig = roleConfigs.find(c => c.role === role);
    if (dbConfig) return { ...dbConfig, source: "configured" as const };
    const defaults = WORKSTREAM_VISIBILITY_DEFAULTS[role];
    if (defaults) return { ...defaults, source: "default" as const, id: 0 };
    return null;
  };

  const startEdit = (role: string) => {
    const config = getEffectiveConfig(role);
    setEditingRole(role);
    setEditWorkstreams(config?.workstreams || [...ALL_WORKSTREAMS]);
    setEditTicketTypes(config?.ticketTypes || ["pd", "engineering"]);
    setEditScope(config?.scope || "all");
  };

  const handleSave = async () => {
    if (!editingRole) return;
    setSaving(true);
    const result = await api.saveWorkstreamVisibilityRole(editingRole, editWorkstreams, editTicketTypes, editScope);
    if (result.ok) { toast({ title: "Saved", description: `Workstream visibility for ${editingRole.replace(/_/g, " ")} updated.` }); setEditingRole(null); loadAll(); }
    else toast({ title: "Error", description: result.error, variant: "destructive" });
    setSaving(false);
  };

  const handleReset = async (configId: number) => {
    const ok = await api.deleteWorkstreamVisibilityConfig(configId);
    if (ok) { toast({ title: "Reset", description: "Reverted to system defaults." }); loadAll(); }
  };

  if (loading) return <div className="py-8 text-center text-gray-400">Loading...</div>;

  const departments = new Map<string, string[]>();
  for (const role of COMPANY_ROLES) {
    const dept = ROLE_DEPARTMENT_MAP[role] || "OTHER";
    if (!departments.has(dept)) departments.set(dept, []);
    departments.get(dept)!.push(role);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-blue-600" /> Workstream Visibility by Role</CardTitle>
          <p className="text-sm text-muted-foreground">Controls which task workstreams each role can see in the unified task hub. Roles are grouped by department.</p>
        </CardHeader>
        <CardContent>
          {Array.from(departments.entries()).map(([dept, roles]) => (
            <div key={dept} className="mb-6">
              <div className={`px-3 py-2 rounded-t-lg border font-semibold text-sm ${DEPARTMENT_COLORS[dept] || "bg-gray-50 border-gray-200"}`}>{dept.replace(/_/g, " ")}</div>
              <div className="border border-t-0 rounded-b-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50"><tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 w-48">Role</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Workstreams</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 w-28">Scope</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600 w-24">Source</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600 w-28">Actions</th>
                  </tr></thead>
                  <tbody>
                    {roles.map(role => {
                      const config = getEffectiveConfig(role);
                      const isEditing = editingRole === role;

                      if (isEditing) {
                        return (
                          <tr key={role} className="border-t bg-blue-50/30">
                            <td className="px-4 py-3 font-medium">{role.replace(/_/g, " ")}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-2">
                                {ALL_WORKSTREAMS.map(ws => (
                                  <label key={ws} className="flex items-center gap-1.5 text-xs cursor-pointer">
                                    <input type="checkbox" checked={editWorkstreams.includes(ws)} onChange={e => setEditWorkstreams(prev => e.target.checked ? [...prev, ws] : prev.filter(w => w !== ws))} className="h-3.5 w-3.5 rounded text-blue-600" />
                                    <span className={`px-1.5 py-0.5 rounded text-xs border ${WORKSTREAM_COLORS[ws]}`}>{ws}</span>
                                  </label>
                                ))}
                              </div>
                              <div className="flex gap-3 mt-2">{PD_TICKET_TYPE_OPTIONS.map(opt => (
                                <label key={opt.value} className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="checkbox" checked={editTicketTypes.includes(opt.value)} onChange={e => setEditTicketTypes(prev => e.target.checked ? [...prev, opt.value] : prev.filter(t => t !== opt.value))} className="h-3.5 w-3.5 rounded text-blue-600" />{opt.label}</label>
                              ))}</div>
                            </td>
                            <td className="px-4 py-3"><div className="flex flex-col gap-1">{PD_SCOPE_OPTIONS.map(opt => (<label key={opt.value} className="flex items-center gap-1.5 text-xs cursor-pointer"><input type="radio" name={`ws-scope-${role}`} value={opt.value} checked={editScope === opt.value} onChange={() => setEditScope(opt.value)} className="h-3.5 w-3.5 text-blue-600" />{opt.label}</label>))}</div></td>
                            <td className="px-4 py-3"><Badge variant="outline" className="text-xs bg-blue-50 text-blue-600 border-blue-200">Editing</Badge></td>
                            <td className="px-4 py-3 text-right"><div className="flex gap-1 justify-end"><Button size="sm" variant="ghost" onClick={() => setEditingRole(null)}><X className="h-3.5 w-3.5" /></Button><Button size="sm" className="bg-blue-600 hover:bg-blue-700 h-7 text-xs" onClick={handleSave} disabled={saving}><Save className="h-3.5 w-3.5 mr-1" />{saving ? "..." : "Save"}</Button></div></td>
                          </tr>
                        );
                      }

                      return (
                        <tr key={role} className="border-t hover:bg-gray-50/50">
                          <td className="px-4 py-3 font-medium">{role.replace(/_/g, " ")}</td>
                          <td className="px-4 py-3"><div className="flex gap-1 flex-wrap">{(config?.workstreams || []).map(ws => (<Badge key={ws} variant="outline" className={`text-xs ${WORKSTREAM_COLORS[ws] || ""}`}>{ws}</Badge>))}</div></td>
                          <td className="px-4 py-3"><Badge variant={config?.scope === "all" ? "default" : "secondary"} className={config?.scope === "all" ? "bg-emerald-100 text-emerald-700 border-emerald-200 text-xs" : "bg-amber-100 text-amber-700 border-amber-200 text-xs"}>{config?.scope === "all" ? "All" : "Own"}</Badge></td>
                          <td className="px-4 py-3"><Badge variant="outline" className={`text-xs ${config?.source === "configured" ? "bg-blue-50 text-blue-600 border-blue-200" : "bg-gray-50 text-gray-500 border-gray-200"}`}>{config?.source === "configured" ? "Custom" : "Default"}</Badge></td>
                          <td className="px-4 py-3 text-right"><div className="flex gap-1 justify-end"><Button variant="ghost" size="sm" onClick={() => startEdit(role)}><Pencil className="h-3.5 w-3.5" /></Button>{config?.source === "configured" && config.id > 0 && (<Button variant="ghost" size="sm" onClick={() => handleReset(config.id)}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>)}</div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {userConfigs.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><UserCheck className="h-5 w-5 text-blue-600" /> User-Level Workstream Overrides</CardTitle></CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50"><tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">User</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Workstreams</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Scope</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">Actions</th>
                </tr></thead>
                <tbody>
                  {userConfigs.map(config => (
                    <tr key={config.id} className="border-t hover:bg-gray-50/50">
                      <td className="px-4 py-2">User #{config.userId}</td>
                      <td className="px-4 py-2"><div className="flex gap-1 flex-wrap">{config.workstreams.map(ws => (<Badge key={ws} variant="outline" className={`text-xs ${WORKSTREAM_COLORS[ws] || ""}`}>{ws}</Badge>))}</div></td>
                      <td className="px-4 py-2"><Badge className={config.scope === "all" ? "bg-emerald-100 text-emerald-700 border-emerald-200 text-xs" : "bg-amber-100 text-amber-700 border-amber-200 text-xs"}>{config.scope === "all" ? "All" : "Own"}</Badge></td>
                      <td className="px-4 py-2 text-right"><Button variant="ghost" size="sm" onClick={() => handleReset(config.id)}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
