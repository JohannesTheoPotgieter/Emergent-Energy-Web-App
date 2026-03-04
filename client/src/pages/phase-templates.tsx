import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { usePermission } from "@/hooks/use-permissions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Copy, CheckCircle, Loader2, Trash2, Edit, Eye, Power, History, ChevronDown, ChevronRight, Shield, ListChecks, FileText, AlertTriangle, Users, Wrench } from "lucide-react";

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

const PHASE_TO_ENG_STAGES: Record<string, string[]> = {
  "First Assessment": ["First Assessment"],
  "Cost Proposal": ["Cost Proposal"],
  "Financial Close": ["Cost Proposal"],
  "Planning": ["IFC Planning"],
  "Construction": ["IFC Planning", "Construction Support"],
  "QA": ["Handover Pack"],
  "Handover": ["Handover Pack"],
  "Compliance Handover": ["Handover Pack"],
};

export default function PhaseTemplatesPage() {
  const { user, isAdmin } = useAuth();
  const { allowed: canView } = usePermission('phase_templates', 'view');
  const { toast } = useToast();
  const qc = useQueryClient();
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
  const [selectedPhaseForEng, setSelectedPhaseForEng] = useState<string | null>(null);
  const [expandedEngId, setExpandedEngId] = useState<number | null>(null);

  const { data: engData } = useQuery({
    queryKey: ["eng-stage-templates"],
    queryFn: async () => {
      const res = await authFetch("/api/eng-stages/templates");
      if (!res.ok) throw new Error("Failed to fetch eng templates");
      return res.json();
    },
  });
  const engTemplates: any[] = engData?.templates || [];

  const toggleEngActive = async (id: number, isActive: boolean) => {
    try {
      const res = await authFetch(`/api/eng-stages/templates/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !isActive }),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast({ title: `Engineering template ${isActive ? "deactivated" : "activated"}` });
      qc.invalidateQueries({ queryKey: ["eng-stage-templates"] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

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

  if (!canView) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="access-denied-container">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-access-denied">Access Denied</h2>
            <p className="text-muted-foreground">You don't have permission to view this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6" data-testid="phase-templates-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Phase Templates</h1>
          <p className="text-muted-foreground">Manage lifecycle phase templates and engineering stage templates that auto-generate tasks, deliverables, and quality items when projects advance</p>
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
              const linkedNames = PHASE_TO_ENG_STAGES[phase] || [];
              const linkedEng = engTemplates.filter((t: any) => linkedNames.includes(t.name));
              const engTaskTotal = linkedEng.reduce((sum: number, t: any) => sum + (t.taskCount || 0), 0);
              const totalCount = phaseTemplates.length + linkedEng.length;
              const expanded = expandedPhases.has(phase) || phaseTemplates.length > 0;
              return (
                <div key={phase} className={`border rounded-lg overflow-hidden ${selectedPhaseForEng === phase ? "ring-2 ring-primary/30" : ""}`}>
                  <button
                    className="w-full flex items-center justify-between px-3 py-2 bg-muted/50 hover:bg-muted text-sm font-medium"
                    onClick={() => { togglePhase(phase); setSelectedPhaseForEng(phase); }}
                    data-testid={`button-phase-toggle-${phase}`}
                  >
                    <span className="truncate flex items-center gap-1.5">
                      {phaseLabels[phase] || phase}
                      {linkedEng.length > 0 && <Wrench className="h-3 w-3 text-purple-500" />}
                    </span>
                    <span className="flex items-center gap-2">
                      {engTaskTotal > 0 && <Badge variant="outline" className="text-purple-600 border-purple-200 text-[10px]">{engTaskTotal} eng tasks</Badge>}
                      <Badge variant="secondary">{totalCount}</Badge>
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

            {(() => {
              const currentPhase = selectedTemplate
                ? (legacyToLifecycle[selectedTemplate.phase] || selectedTemplate.phase)
                : selectedPhaseForEng;
              const linkedStageNames = currentPhase ? (PHASE_TO_ENG_STAGES[currentPhase] || []) : [];
              const linkedEngTemplates = engTemplates.filter((t: any) => linkedStageNames.includes(t.name));

              if (linkedEngTemplates.length === 0 && !currentPhase) return null;

              return (
                <Card className="mt-4" data-testid="eng-stages-section">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <Wrench className="h-4 w-4 text-purple-600" />
                      <CardTitle className="text-base">Engineering Stage Templates</CardTitle>
                    </div>
                    <CardDescription>
                      {currentPhase && linkedStageNames.length > 0
                        ? `Engineering stages auto-generated when projects enter "${currentPhase}"`
                        : "No engineering stages are linked to this phase"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {linkedEngTemplates.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic py-2">No engineering stage templates are mapped to this phase.</p>
                    ) : (
                      linkedEngTemplates.map((et: any) => (
                        <EngStageInlineCard
                          key={et.id}
                          template={et}
                          expanded={expandedEngId === et.id}
                          onToggleExpand={() => setExpandedEngId(expandedEngId === et.id ? null : et.id)}
                          onToggleActive={() => toggleEngActive(et.id, et.isActive)}
                        />
                      ))
                    )}
                  </CardContent>
                </Card>
              );
            })()}
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
              <SearchableSelect
                value={newTemplate.phase}
                onValueChange={(v) => setNewTemplate(p => ({ ...p, phase: v }))}
                placeholder="Select phase"
                options={(constants?.projectPhases || []).map((p) => ({
                  value: p,
                  label: phaseLabels[p] || p,
                }))}
                data-testid="select-template-phase"
              />
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
              <SearchableSelect
                value={itemForm.itemType}
                onValueChange={(v) => setItemForm(f => ({ ...f, itemType: v }))}
                options={(constants?.itemTypes || []).map((t) => ({ value: t, label: t }))}
                data-testid="select-item-type"
              />
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
              <SearchableSelect
                value={itemForm.primaryWorkstream}
                onValueChange={(v) => setItemForm(f => ({ ...f, primaryWorkstream: v }))}
                placeholder="Select"
                options={[
                  { value: "", label: "None" },
                  ...(constants?.workstreams || []).map((w) => ({ value: w, label: w })),
                ]}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Default Priority</label>
              <SearchableSelect
                value={itemForm.defaultPriority}
                onValueChange={(v) => setItemForm(f => ({ ...f, defaultPriority: v }))}
                options={[
                  { value: "Low", label: "Low" },
                  { value: "Med", label: "Med" },
                  { value: "High", label: "High" },
                  { value: "Critical", label: "Critical" },
                ]}
              />
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
            <SearchableSelect
              value={cloneTarget}
              onValueChange={setCloneTarget}
              placeholder="Same phase"
              options={[
                { value: "", label: "Same phase" },
                ...(constants?.projectPhases || []).map((p) => ({
                  value: p,
                  label: phaseLabels[p] || p,
                })),
              ]}
            />
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

function EngStageInlineCard({ template, expanded, onToggleExpand, onToggleActive }: {
  template: any; expanded: boolean; onToggleExpand: () => void; onToggleActive: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editingDelId, setEditingDelId] = useState<number | null>(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showAddDel, setShowAddDel] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: "", description: "", isRequired: true, defaultOwnerRole: "" });
  const [delForm, setDelForm] = useState({ name: "", description: "", isRequired: true, requiredCount: 1 });

  const engAuthFetch = async (url: string, opts: RequestInit = {}) => {
    const token = localStorage.getItem("auth_token");
    const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts.headers as any || {}) };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return fetch(url, { ...opts, headers, credentials: "include" });
  };

  const { data: detail } = useQuery({
    queryKey: ["eng-stage-template-detail", template.id],
    queryFn: async () => {
      const res = await engAuthFetch(`/api/eng-stages/templates/${template.id}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: expanded,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["eng-stage-template-detail", template.id] });
    queryClient.invalidateQueries({ queryKey: ["eng-stage-templates"] });
  };

  const addTask = async () => {
    if (!taskForm.title.trim()) return;
    const res = await engAuthFetch(`/api/eng-stages/templates/${template.id}/tasks`, {
      method: "POST", body: JSON.stringify(taskForm),
    });
    if (res.ok) { toast({ title: "Task added" }); setShowAddTask(false); setTaskForm({ title: "", description: "", isRequired: true, defaultOwnerRole: "" }); invalidate(); }
    else { const err = await res.json(); toast({ title: "Error", description: err.error, variant: "destructive" }); }
  };

  const updateTask = async (taskId: number) => {
    const res = await engAuthFetch(`/api/eng-stages/template-tasks/${taskId}`, {
      method: "PATCH", body: JSON.stringify(taskForm),
    });
    if (res.ok) { toast({ title: "Task updated" }); setEditingTaskId(null); invalidate(); }
    else { const err = await res.json(); toast({ title: "Error", description: err.error, variant: "destructive" }); }
  };

  const deleteTask = async (taskId: number) => {
    const res = await engAuthFetch(`/api/eng-stages/template-tasks/${taskId}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "Task removed" }); invalidate(); }
  };

  const addDeliverable = async () => {
    if (!delForm.name.trim()) return;
    const res = await engAuthFetch(`/api/eng-stages/templates/${template.id}/deliverables`, {
      method: "POST", body: JSON.stringify(delForm),
    });
    if (res.ok) { toast({ title: "Deliverable added" }); setShowAddDel(false); setDelForm({ name: "", description: "", isRequired: true, requiredCount: 1 }); invalidate(); }
    else { const err = await res.json(); toast({ title: "Error", description: err.error, variant: "destructive" }); }
  };

  const updateDeliverable = async (delId: number) => {
    const res = await engAuthFetch(`/api/eng-stages/template-deliverables/${delId}`, {
      method: "PATCH", body: JSON.stringify(delForm),
    });
    if (res.ok) { toast({ title: "Deliverable updated" }); setEditingDelId(null); invalidate(); }
    else { const err = await res.json(); toast({ title: "Error", description: err.error, variant: "destructive" }); }
  };

  const deleteDeliverable = async (delId: number) => {
    const res = await engAuthFetch(`/api/eng-stages/template-deliverables/${delId}`, { method: "DELETE" });
    if (res.ok) { toast({ title: "Deliverable removed" }); invalidate(); }
  };

  const startEditTask = (task: any) => {
    setEditingTaskId(task.id);
    setTaskForm({ title: task.title, description: task.description || "", isRequired: task.isRequired, defaultOwnerRole: task.defaultOwnerRole || "" });
  };

  const startEditDel = (del: any) => {
    setEditingDelId(del.id);
    setDelForm({ name: del.name, description: del.description || "", isRequired: del.isRequired, requiredCount: del.requiredCount || 1 });
  };

  return (
    <div className={`border rounded-lg transition-all ${!template.isActive ? "opacity-60" : ""}`} data-testid={`eng-template-card-${template.id}`}>
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={onToggleExpand}>
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <div>
            <div className="text-sm font-medium">{template.name}</div>
            <p className="text-xs text-muted-foreground">{template.purpose}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><ListChecks className="h-3.5 w-3.5" /> {template.taskCount} tasks</span>
            <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> {template.deliverableCount} deliverables</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs">{template.isActive ? "Active" : "Inactive"}</span>
            <Switch checked={template.isActive} onCheckedChange={onToggleActive} data-testid={`toggle-eng-active-${template.id}`} />
          </div>
        </div>
      </div>

      {expanded && detail && (
        <div className="px-3 pb-3 space-y-3 border-t pt-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2 bg-blue-50 rounded">
              <span className="font-medium text-blue-800">Responsible:</span>
              <span className="ml-1 text-blue-600">{template.raciResponsible}</span>
            </div>
            <div className="p-2 bg-green-50 rounded">
              <span className="font-medium text-green-800">Accountable:</span>
              <span className="ml-1 text-green-600">{template.raciAccountable}</span>
            </div>
            <div className="p-2 bg-purple-50 rounded">
              <span className="font-medium text-purple-800">Consulted:</span>
              <span className="ml-1 text-purple-600">{template.raciConsulted}</span>
            </div>
            <div className="p-2 bg-muted rounded">
              <span className="font-medium text-foreground">Informed:</span>
              <span className="ml-1 text-muted-foreground">{template.raciInformed}</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium flex items-center gap-1">
                <ListChecks className="h-4 w-4" /> Tasks ({detail.tasks.length})
              </h4>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setTaskForm({ title: "", description: "", isRequired: true, defaultOwnerRole: "" }); setShowAddTask(true); }} data-testid={`button-add-eng-task-${template.id}`}>
                <Plus className="h-3 w-3 mr-1" /> Add Task
              </Button>
            </div>
            <div className="space-y-1">
              {detail.tasks.map((task: any) => (
                editingTaskId === task.id ? (
                  <div key={task.id} className="p-2 bg-muted/50 rounded border space-y-2">
                    <Input value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} placeholder="Task title" className="h-7 text-xs" data-testid={`input-edit-task-title-${task.id}`} />
                    <Input value={taskForm.description} onChange={e => setTaskForm(f => ({ ...f, description: e.target.value }))} placeholder="Description (optional)" className="h-7 text-xs" />
                    <div className="flex gap-2 items-center">
                      <Input value={taskForm.defaultOwnerRole} onChange={e => setTaskForm(f => ({ ...f, defaultOwnerRole: e.target.value }))} placeholder="Owner role" className="h-7 text-xs flex-1" />
                      <label className="flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={taskForm.isRequired} onChange={e => setTaskForm(f => ({ ...f, isRequired: e.target.checked }))} /> Required
                      </label>
                      <Button size="sm" className="h-7 text-xs" onClick={() => updateTask(task.id)} data-testid={`button-save-task-${task.id}`}>Save</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingTaskId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div key={task.id} className="flex items-center gap-2 text-xs p-1.5 bg-muted/30 rounded group" data-testid={`eng-task-row-${task.id}`}>
                    <span className="text-muted-foreground w-5 text-right">{task.sequence}.</span>
                    <span className="flex-1">{task.title}</span>
                    {task.isRequired && <Badge variant="secondary" className="text-[10px]">Required</Badge>}
                    <span className="text-muted-foreground text-[10px]">{task.defaultOwnerRole}</span>
                    <div className="opacity-0 group-hover:opacity-100 flex gap-0.5">
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => startEditTask(task)} data-testid={`button-edit-eng-task-${task.id}`}>
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => deleteTask(task.id)} data-testid={`button-delete-eng-task-${task.id}`}>
                        <Trash2 className="h-3 w-3 text-red-500" />
                      </Button>
                    </div>
                  </div>
                )
              ))}
              {showAddTask && (
                <div className="p-2 bg-blue-50/50 rounded border border-blue-200 space-y-2">
                  <Input value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} placeholder="New task title" className="h-7 text-xs" data-testid={`input-new-task-title-${template.id}`} />
                  <Input value={taskForm.description} onChange={e => setTaskForm(f => ({ ...f, description: e.target.value }))} placeholder="Description (optional)" className="h-7 text-xs" />
                  <div className="flex gap-2 items-center">
                    <Input value={taskForm.defaultOwnerRole} onChange={e => setTaskForm(f => ({ ...f, defaultOwnerRole: e.target.value }))} placeholder="Owner role" className="h-7 text-xs flex-1" />
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={taskForm.isRequired} onChange={e => setTaskForm(f => ({ ...f, isRequired: e.target.checked }))} /> Required
                    </label>
                    <Button size="sm" className="h-7 text-xs" onClick={addTask} data-testid={`button-save-new-task-${template.id}`}>Add</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAddTask(false)}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium flex items-center gap-1">
                <FileText className="h-4 w-4" /> Deliverables ({detail.deliverables.length})
              </h4>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setDelForm({ name: "", description: "", isRequired: true, requiredCount: 1 }); setShowAddDel(true); }} data-testid={`button-add-eng-del-${template.id}`}>
                <Plus className="h-3 w-3 mr-1" /> Add Deliverable
              </Button>
            </div>
            <div className="space-y-1">
              {detail.deliverables.map((del: any) => (
                editingDelId === del.id ? (
                  <div key={del.id} className="p-2 bg-muted/50 rounded border space-y-2">
                    <Input value={delForm.name} onChange={e => setDelForm(f => ({ ...f, name: e.target.value }))} placeholder="Deliverable name" className="h-7 text-xs" data-testid={`input-edit-del-name-${del.id}`} />
                    <Input value={delForm.description} onChange={e => setDelForm(f => ({ ...f, description: e.target.value }))} placeholder="Description (optional)" className="h-7 text-xs" />
                    <div className="flex gap-2 items-center">
                      <label className="flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={delForm.isRequired} onChange={e => setDelForm(f => ({ ...f, isRequired: e.target.checked }))} /> Required
                      </label>
                      <Input type="number" value={delForm.requiredCount} onChange={e => setDelForm(f => ({ ...f, requiredCount: parseInt(e.target.value) || 1 }))} className="h-7 text-xs w-16" min={1} />
                      <span className="text-xs text-muted-foreground">count</span>
                      <Button size="sm" className="h-7 text-xs" onClick={() => updateDeliverable(del.id)} data-testid={`button-save-del-${del.id}`}>Save</Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingDelId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div key={del.id} className="flex items-center gap-2 text-xs p-1.5 bg-muted/30 rounded group" data-testid={`eng-del-row-${del.id}`}>
                    <FileText className="h-3 w-3 text-muted-foreground" />
                    <span className="flex-1">{del.name}</span>
                    {del.isRequired && <Badge variant="secondary" className="text-[10px]">Required</Badge>}
                    <span className="text-muted-foreground text-[10px]">x{del.requiredCount}</span>
                    <div className="opacity-0 group-hover:opacity-100 flex gap-0.5">
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => startEditDel(del)} data-testid={`button-edit-eng-del-${del.id}`}>
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => deleteDeliverable(del.id)} data-testid={`button-delete-eng-del-${del.id}`}>
                        <Trash2 className="h-3 w-3 text-red-500" />
                      </Button>
                    </div>
                  </div>
                )
              ))}
              {showAddDel && (
                <div className="p-2 bg-purple-50/50 rounded border border-purple-200 space-y-2">
                  <Input value={delForm.name} onChange={e => setDelForm(f => ({ ...f, name: e.target.value }))} placeholder="Deliverable name" className="h-7 text-xs" data-testid={`input-new-del-name-${template.id}`} />
                  <Input value={delForm.description} onChange={e => setDelForm(f => ({ ...f, description: e.target.value }))} placeholder="Description (optional)" className="h-7 text-xs" />
                  <div className="flex gap-2 items-center">
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={delForm.isRequired} onChange={e => setDelForm(f => ({ ...f, isRequired: e.target.checked }))} /> Required
                    </label>
                    <Input type="number" value={delForm.requiredCount} onChange={e => setDelForm(f => ({ ...f, requiredCount: parseInt(e.target.value) || 1 }))} className="h-7 text-xs w-16" min={1} />
                    <span className="text-xs text-muted-foreground">count</span>
                    <Button size="sm" className="h-7 text-xs" onClick={addDeliverable} data-testid={`button-save-new-del-${template.id}`}>Add</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAddDel(false)}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {template.failureModes?.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-1 text-orange-700">
                <AlertTriangle className="h-4 w-4" /> Failure Modes
              </h4>
              <ul className="list-disc list-inside text-xs text-orange-600 space-y-0.5">
                {template.failureModes.map((fm: string, i: number) => <li key={i}>{fm}</li>)}
              </ul>
            </div>
          )}

          {template.stageGateRules && (
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                <Shield className="h-4 w-4" /> Stage Gate Rules
              </h4>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(template.stageGateRules as Record<string, boolean>).map(([key, val]) => (
                  <Badge key={key} variant={val ? "default" : "secondary"} className="text-[10px]">
                    {key.replace(/([A-Z])/g, " $1").trim()}: {val ? "Yes" : "No"}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
