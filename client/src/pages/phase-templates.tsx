import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Copy, CheckCircle, Loader2, Trash2, Edit, Eye, Power, History, ChevronDown, ChevronRight } from "lucide-react";

interface PhaseTemplateData {
  id: number;
  phase: string;
  name: string;
  version: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TemplateItemData {
  id: number;
  templateId: number;
  itemKey: string;
  itemType: string;
  title: string;
  description: string | null;
  primaryWorkstream: string | null;
  defaultStatus: string | null;
  defaultPriority: string | null;
  offsetDaysFromPhaseStart: number | null;
  requiresApproval: boolean;
  approverRole: string | null;
  linkTargetType: string;
  linkTargetKey: string | null;
  deliverableTypeKey: string | null;
  requiresQcApproval: boolean;
  requiresOperationalApproval: boolean;
  qualityItemKey: string | null;
  evidenceRequired: boolean;
  viewKey: string | null;
  sortOrder: number;
  isDeleted: boolean;
}

interface TemplateConstants {
  itemTypes: string[];
  workstreams: string[];
  linkTargetTypes: string[];
  projectPhases: string[];
  projectPhaseLabels: Record<string, string>;
}

const authFetch = async (url: string, opts: RequestInit = {}) => {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts.headers as any || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...opts, headers, credentials: "include" });
};

export default function PhaseTemplatesPage() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<PhaseTemplateData[]>([]);
  const [constants, setConstants] = useState<TemplateConstants | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<(PhaseTemplateData & { items: TemplateItemData[] }) | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showItemDialog, setShowItemDialog] = useState(false);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<TemplateItemData | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ phase: "", name: "" });
  const [cloneTarget, setCloneTarget] = useState("");
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());

  const [itemForm, setItemForm] = useState({
    itemKey: "", itemType: "TASK", title: "", description: "",
    primaryWorkstream: "", defaultStatus: "TO DO", defaultPriority: "Med",
    offsetDaysFromPhaseStart: "", requiresApproval: false, approverRole: "",
    linkTargetType: "NONE", linkTargetKey: "", deliverableTypeKey: "",
    requiresQcApproval: false, requiresOperationalApproval: false,
    qualityItemKey: "", evidenceRequired: false, viewKey: "", sortOrder: "0",
  });

  const loadTemplates = useCallback(async () => {
    try {
      const [tRes, cRes] = await Promise.all([
        authFetch("/api/phase-templates"),
        authFetch("/api/template-constants"),
      ]);
      if (tRes.ok) setTemplates(await tRes.json());
      if (cRes.ok) setConstants(await cRes.json());
    } catch { } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  const loadTemplateDetail = async (id: number) => {
    const res = await authFetch(`/api/phase-templates/${id}`);
    if (res.ok) setSelectedTemplate(await res.json());
  };

  const createTemplate = async () => {
    if (!newTemplate.phase || !newTemplate.name) return;
    setSaving(true);
    const res = await authFetch("/api/phase-templates", { method: "POST", body: JSON.stringify(newTemplate) });
    if (res.ok) {
      toast({ title: "Template created" });
      setShowCreateDialog(false);
      setNewTemplate({ phase: "", name: "" });
      loadTemplates();
    } else {
      const err = await res.json();
      toast({ title: "Error", description: err.error, variant: "destructive" });
    }
    setSaving(false);
  };

  const activateTemplate = async (id: number) => {
    const res = await authFetch(`/api/phase-templates/${id}/activate`, { method: "PATCH" });
    if (res.ok) {
      toast({ title: "Template activated" });
      loadTemplates();
      if (selectedTemplate?.id === id) loadTemplateDetail(id);
    }
  };

  const cloneTemplate = async () => {
    if (!selectedTemplate) return;
    setSaving(true);
    const body = cloneTarget ? { targetPhase: cloneTarget } : {};
    const res = await authFetch(`/api/phase-templates/${selectedTemplate.id}/clone`, { method: "POST", body: JSON.stringify(body) });
    if (res.ok) {
      toast({ title: "Template cloned" });
      setShowCloneDialog(false);
      setCloneTarget("");
      loadTemplates();
    }
    setSaving(false);
  };

  const loadPreview = async () => {
    if (!selectedTemplate) return;
    const res = await authFetch(`/api/phase-templates/${selectedTemplate.id}/preview`);
    if (res.ok) {
      setPreview(await res.json());
      setShowPreviewDialog(true);
    }
  };

  const resetItemForm = () => {
    setItemForm({
      itemKey: "", itemType: "TASK", title: "", description: "",
      primaryWorkstream: "", defaultStatus: "TO DO", defaultPriority: "Med",
      offsetDaysFromPhaseStart: "", requiresApproval: false, approverRole: "",
      linkTargetType: "NONE", linkTargetKey: "", deliverableTypeKey: "",
      requiresQcApproval: false, requiresOperationalApproval: false,
      qualityItemKey: "", evidenceRequired: false, viewKey: "", sortOrder: "0",
    });
    setEditingItem(null);
  };

  const openItemDialog = (item?: TemplateItemData) => {
    if (item) {
      setEditingItem(item);
      setItemForm({
        itemKey: item.itemKey, itemType: item.itemType, title: item.title,
        description: item.description || "", primaryWorkstream: item.primaryWorkstream || "",
        defaultStatus: item.defaultStatus || "TO DO", defaultPriority: item.defaultPriority || "Med",
        offsetDaysFromPhaseStart: item.offsetDaysFromPhaseStart?.toString() || "",
        requiresApproval: item.requiresApproval, approverRole: item.approverRole || "",
        linkTargetType: item.linkTargetType, linkTargetKey: item.linkTargetKey || "",
        deliverableTypeKey: item.deliverableTypeKey || "",
        requiresQcApproval: item.requiresQcApproval,
        requiresOperationalApproval: item.requiresOperationalApproval,
        qualityItemKey: item.qualityItemKey || "", evidenceRequired: item.evidenceRequired,
        viewKey: item.viewKey || "", sortOrder: item.sortOrder.toString(),
      });
    } else {
      resetItemForm();
    }
    setShowItemDialog(true);
  };

  const saveItem = async () => {
    if (!selectedTemplate) return;
    setSaving(true);
    const body: any = {
      ...itemForm,
      offsetDaysFromPhaseStart: itemForm.offsetDaysFromPhaseStart ? parseInt(itemForm.offsetDaysFromPhaseStart) : null,
      sortOrder: parseInt(itemForm.sortOrder) || 0,
      primaryWorkstream: itemForm.primaryWorkstream || null,
      approverRole: itemForm.approverRole || null,
      linkTargetKey: itemForm.linkTargetKey || null,
      deliverableTypeKey: itemForm.deliverableTypeKey || null,
      qualityItemKey: itemForm.qualityItemKey || null,
      viewKey: itemForm.viewKey || null,
      description: itemForm.description || null,
    };

    let res;
    if (editingItem) {
      res = await authFetch(`/api/phase-template-items/${editingItem.id}`, { method: "PATCH", body: JSON.stringify(body) });
    } else {
      res = await authFetch(`/api/phase-templates/${selectedTemplate.id}/items`, { method: "POST", body: JSON.stringify(body) });
    }

    if (res.ok) {
      toast({ title: editingItem ? "Item updated" : "Item added" });
      setShowItemDialog(false);
      resetItemForm();
      loadTemplateDetail(selectedTemplate.id);
    } else {
      const err = await res.json();
      toast({ title: "Error", description: err.error, variant: "destructive" });
    }
    setSaving(false);
  };

  const deleteItem = async (itemId: number) => {
    if (!selectedTemplate) return;
    const res = await authFetch(`/api/phase-template-items/${itemId}`, { method: "DELETE" });
    if (res.ok) {
      toast({ title: "Item removed" });
      loadTemplateDetail(selectedTemplate.id);
    }
  };

  if (!isAdmin) return <div className="p-8 text-center text-muted-foreground">Admin access required</div>;

  const phaseLabels = constants?.projectPhaseLabels || {};
  const legacyToLifecycle: Record<string, string> = {
    P0_FIRST_ASSESSMENT: "First Assessment",
    P1_COST_PROPOSAL_DESIGN: "Cost Proposal",
    P2_PD_PM_HANDOVER: "Planning",
    P3_DETAILED_DESIGN_PROC_RELEASE: "Planning",
    P4_CONSTRUCTION_INSTALLATION: "Construction",
    P5_COMMISSIONING_TESTING: "QA",
    P6_HANDOVER_CLIENT_MATRIARCH: "Handover",
    P7_CLOSEOUT_POSTMORTEM: "Commercial Close Out",
  };
  const groupedByPhase = templates.reduce<Record<string, PhaseTemplateData[]>>((acc, t) => {
    const groupPhase = legacyToLifecycle[t.phase] || t.phase;
    if (!acc[groupPhase]) acc[groupPhase] = [];
    acc[groupPhase].push(t);
    return acc;
  }, {});

  const togglePhase = (phase: string) => {
    const next = new Set(expandedPhases);
    next.has(phase) ? next.delete(phase) : next.add(phase);
    setExpandedPhases(next);
  };

  const itemTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      TASK: "bg-blue-100 text-blue-800",
      DELIVERABLE: "bg-purple-100 text-purple-800",
      QUALITY_LINK: "bg-green-100 text-green-800",
      VIEW_SHORTCUT: "bg-amber-100 text-amber-800",
    };
    return <Badge className={colors[type] || ""}>{type}</Badge>;
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6" data-testid="phase-templates-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Phase Templates</h1>
          <p className="text-muted-foreground">Manage lifecycle phase templates that auto-generate tasks, deliverables, and quality items when projects advance</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="button-create-template">
          <Plus className="w-4 h-4 mr-2" /> New Template
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-4 space-y-2">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">Templates by Phase</h3>
            {(constants?.projectPhases || []).map((phase) => {
              const phaseTemplates = groupedByPhase[phase] || [];
              const expanded = expandedPhases.has(phase) || phaseTemplates.length > 0;
              return (
                <div key={phase} className="border rounded-lg overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-3 py-2 bg-muted/50 hover:bg-muted text-sm font-medium"
                    onClick={() => togglePhase(phase)}
                    data-testid={`button-phase-toggle-${phase}`}
                  >
                    <span className="truncate">{phaseLabels[phase] || phase}</span>
                    <span className="flex items-center gap-2">
                      <Badge variant="secondary">{phaseTemplates.length}</Badge>
                      {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </span>
                  </button>
                  {expanded && (
                    <>
                      {phaseTemplates.map((t) => (
                        <button
                          key={t.id}
                          className={`w-full text-left px-3 py-2 border-t text-sm hover:bg-accent/50 flex items-center justify-between ${selectedTemplate?.id === t.id ? "bg-accent" : ""}`}
                          onClick={() => loadTemplateDetail(t.id)}
                          data-testid={`button-template-${t.id}`}
                        >
                          <span className="truncate">
                            {t.name} <span className="text-muted-foreground">v{t.version}</span>
                            {legacyToLifecycle[t.phase] && <Badge variant="outline" className="ml-1 text-[10px] px-1">legacy</Badge>}
                          </span>
                          {t.isActive && <Badge className="bg-green-100 text-green-800 ml-2">Active</Badge>}
                        </button>
                      ))}
                      {phaseTemplates.length === 0 && (
                        <div className="px-3 py-2 border-t text-xs text-muted-foreground italic">No templates yet</div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className="col-span-8">
            {selectedTemplate ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">{selectedTemplate.name}</CardTitle>
                      <CardDescription>
                        {phaseLabels[selectedTemplate.phase] || selectedTemplate.phase} &middot; Version {selectedTemplate.version}
                        {selectedTemplate.isActive && <Badge className="ml-2 bg-green-100 text-green-800">Active</Badge>}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={loadPreview} data-testid="button-preview-template">
                        <Eye className="w-4 h-4 mr-1" /> Preview
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setShowCloneDialog(true)} data-testid="button-clone-template">
                        <Copy className="w-4 h-4 mr-1" /> Clone
                      </Button>
                      {!selectedTemplate.isActive && (
                        <Button size="sm" onClick={() => activateTemplate(selectedTemplate.id)} data-testid="button-activate-template">
                          <Power className="w-4 h-4 mr-1" /> Activate
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-sm">Items ({selectedTemplate.items?.length || 0})</h4>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => {
                        resetItemForm();
                        setItemForm(f => ({ ...f, itemType: "TASK", primaryWorkstream: "Engineering" }));
                        setShowItemDialog(true);
                      }} data-testid="button-add-eng-task" className="text-blue-600 border-blue-200 hover:bg-blue-50">
                        <Plus className="w-4 h-4 mr-1" /> Engineering Task
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openItemDialog()} data-testid="button-add-item">
                        <Plus className="w-4 h-4 mr-1" /> Add Item
                      </Button>
                    </div>
                  </div>
                  {(!selectedTemplate.items || selectedTemplate.items.length === 0) ? (
                    <p className="text-center text-muted-foreground py-8">No items yet. Add items to define what gets generated when this template is applied.</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedTemplate.items.map((item) => (
                        <div key={item.id} className="flex items-center justify-between border rounded-lg px-4 py-3 hover:bg-muted/30" data-testid={`row-template-item-${item.id}`}>
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-xs text-muted-foreground w-6 text-right">{item.sortOrder}</span>
                            {itemTypeBadge(item.itemType)}
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate">{item.title}</div>
                              <div className="text-xs text-muted-foreground flex gap-2">
                                <span>{item.itemKey}</span>
                                {item.primaryWorkstream && <span>&middot; {item.primaryWorkstream}</span>}
                                {item.requiresApproval && <Badge variant="outline" className="text-xs px-1">Approval</Badge>}
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openItemDialog(item)} data-testid={`button-edit-item-${item.id}`}>
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => deleteItem(item.id)} data-testid={`button-delete-item-${item.id}`}>
                              <Trash2 className="w-4 h-4 text-red-500" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card><CardContent className="py-12 text-center text-muted-foreground">Select a template from the list to view and edit its items</CardContent></Card>
            )}
          </div>
        </div>
      )}

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Phase Template</DialogTitle>
            <DialogDescription>Define a new template for a lifecycle phase</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Phase</label>
              <Select value={newTemplate.phase} onValueChange={(v) => setNewTemplate(p => ({ ...p, phase: v }))}>
                <SelectTrigger data-testid="select-template-phase"><SelectValue placeholder="Select phase" /></SelectTrigger>
                <SelectContent>
                  {(constants?.projectPhases || []).map((p) => (
                    <SelectItem key={p} value={p}>{phaseLabels[p] || p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Template Name</label>
              <Input value={newTemplate.name} onChange={(e) => setNewTemplate(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Standard P3 Engineering Package" data-testid="input-template-name" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button onClick={createTemplate} disabled={saving || !newTemplate.phase || !newTemplate.name} data-testid="button-save-template">
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showItemDialog} onOpenChange={(v) => { if (!v) resetItemForm(); setShowItemDialog(v); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingItem ? "Edit Item" : "Add Template Item"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Item Key</label>
              <Input value={itemForm.itemKey} onChange={(e) => setItemForm(f => ({ ...f, itemKey: e.target.value }))} placeholder="unique_key" disabled={!!editingItem} data-testid="input-item-key" />
            </div>
            <div>
              <label className="text-sm font-medium">Type</label>
              <Select value={itemForm.itemType} onValueChange={(v) => setItemForm(f => ({ ...f, itemType: v }))}>
                <SelectTrigger data-testid="select-item-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(constants?.itemTypes || []).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <label className="text-sm font-medium">Title</label>
              <Input value={itemForm.title} onChange={(e) => setItemForm(f => ({ ...f, title: e.target.value }))} placeholder="Task/deliverable title" data-testid="input-item-title" />
            </div>
            <div className="col-span-2">
              <label className="text-sm font-medium">Description</label>
              <Textarea value={itemForm.description} onChange={(e) => setItemForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description" rows={2} data-testid="input-item-description" />
            </div>
            <div>
              <label className="text-sm font-medium">Workstream</label>
              <Select value={itemForm.primaryWorkstream} onValueChange={(v) => setItemForm(f => ({ ...f, primaryWorkstream: v }))}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {(constants?.workstreams || []).map((w) => <SelectItem key={w} value={w}>{w}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Default Priority</label>
              <Select value={itemForm.defaultPriority} onValueChange={(v) => setItemForm(f => ({ ...f, defaultPriority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Low">Low</SelectItem>
                  <SelectItem value="Med">Med</SelectItem>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Offset Days</label>
              <Input type="number" value={itemForm.offsetDaysFromPhaseStart} onChange={(e) => setItemForm(f => ({ ...f, offsetDaysFromPhaseStart: e.target.value }))} placeholder="Days from phase start" />
            </div>
            <div>
              <label className="text-sm font-medium">Sort Order</label>
              <Input type="number" value={itemForm.sortOrder} onChange={(e) => setItemForm(f => ({ ...f, sortOrder: e.target.value }))} data-testid="input-item-sort" />
            </div>
            <div className="col-span-2 flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={itemForm.requiresApproval} onChange={(e) => setItemForm(f => ({ ...f, requiresApproval: e.target.checked }))} />
                Requires Approval
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={itemForm.requiresQcApproval} onChange={(e) => setItemForm(f => ({ ...f, requiresQcApproval: e.target.checked }))} />
                QC Approval
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={itemForm.evidenceRequired} onChange={(e) => setItemForm(f => ({ ...f, evidenceRequired: e.target.checked }))} />
                Evidence Required
              </label>
            </div>
            {itemForm.itemType === "DELIVERABLE" && (
              <div className="col-span-2">
                <label className="text-sm font-medium">Deliverable Type Key</label>
                <Input value={itemForm.deliverableTypeKey} onChange={(e) => setItemForm(f => ({ ...f, deliverableTypeKey: e.target.value }))} placeholder="e.g. detailed_design_package" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetItemForm(); setShowItemDialog(false); }}>Cancel</Button>
            <Button onClick={saveItem} disabled={saving || !itemForm.itemKey || !itemForm.title} data-testid="button-save-item">
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} {editingItem ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCloneDialog} onOpenChange={setShowCloneDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clone Template</DialogTitle>
            <DialogDescription>Create a copy of "{selectedTemplate?.name}". Optionally target a different phase.</DialogDescription>
          </DialogHeader>
          <div>
            <label className="text-sm font-medium">Target Phase (leave blank to clone to same phase)</label>
            <Select value={cloneTarget} onValueChange={setCloneTarget}>
              <SelectTrigger><SelectValue placeholder="Same phase" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Same phase</SelectItem>
                {(constants?.projectPhases || []).map((p) => (
                  <SelectItem key={p} value={p}>{phaseLabels[p] || p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCloneDialog(false)}>Cancel</Button>
            <Button onClick={cloneTemplate} disabled={saving} data-testid="button-confirm-clone">
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Clone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Template Preview</DialogTitle>
            <DialogDescription>Summary of items that would be generated</DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="border rounded p-2">
                  <div className="text-lg font-bold">{preview.counts.TASK}</div>
                  <div className="text-xs text-muted-foreground">Tasks</div>
                </div>
                <div className="border rounded p-2">
                  <div className="text-lg font-bold">{preview.counts.DELIVERABLE}</div>
                  <div className="text-xs text-muted-foreground">Deliverables</div>
                </div>
                <div className="border rounded p-2">
                  <div className="text-lg font-bold">{preview.counts.QUALITY_LINK}</div>
                  <div className="text-xs text-muted-foreground">Quality Links</div>
                </div>
                <div className="border rounded p-2">
                  <div className="text-lg font-bold">{preview.counts.VIEW_SHORTCUT}</div>
                  <div className="text-xs text-muted-foreground">View Shortcuts</div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{preview.totalItems} total items in this template</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
