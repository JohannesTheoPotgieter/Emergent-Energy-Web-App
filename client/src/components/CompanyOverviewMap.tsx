import React, { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Search, Network, GitBranch, ChevronRight, ChevronDown,
  Edit2, Save, X, Plus, Trash2, Loader2, Users,
  Clock, Building2, Layers, Target, AlertCircle,
  Link2, Activity, MapPin, Eye, FileText, Shield,
  ArrowDown, CheckCircle2, Wrench, Scale, HardHat,
  Briefcase, ClipboardList, Cog, Truck, Factory,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CompanyOverviewMapProps {
  isCOO: boolean;
  userId?: number;
}

function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem("auth_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, {
    ...opts,
    credentials: "include",
    headers: { ...headers, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
}

const DEPT_ICONS: Record<string, React.ReactNode> = {
  "os-dept-exco": <Target className="h-3.5 w-3.5" />,
  "os-dept-engineering": <Wrench className="h-3.5 w-3.5" />,
  "os-dept-finance": <Scale className="h-3.5 w-3.5" />,
  "os-dept-project-management": <HardHat className="h-3.5 w-3.5" />,
  "os-dept-project-development": <Briefcase className="h-3.5 w-3.5" />,
  "os-dept-quality": <ClipboardList className="h-3.5 w-3.5" />,
  "os-dept-operations": <Cog className="h-3.5 w-3.5" />,
  "os-dept-procurement": <Truck className="h-3.5 w-3.5" />,
  "os-dept-project-delivery": <HardHat className="h-3.5 w-3.5" />,
  "os-dept-om": <Factory className="h-3.5 w-3.5" />,
};

const TYPE_COLORS: Record<string, string> = {
  department: "bg-blue-100 text-blue-700",
  lifecycle_stage: "bg-purple-100 text-purple-700",
  process: "bg-amber-100 text-amber-700",
  gate: "bg-red-100 text-red-700",
  step: "bg-green-100 text-green-700",
  content: "bg-muted text-foreground",
};

const STAGE_GRADIENT = [
  "from-blue-500 to-blue-600",
  "from-indigo-500 to-indigo-600",
  "from-violet-500 to-violet-600",
  "from-purple-500 to-purple-600",
  "from-amber-500 to-amber-600",
  "from-emerald-500 to-emerald-600",
  "from-cyan-500 to-cyan-600",
  "from-rose-500 to-rose-600",
  "from-teal-500 to-teal-600",
];

interface RaciRow {
  role: string;
  responsible?: boolean;
  accountable?: boolean;
  consulted?: boolean;
  informed?: boolean;
}

interface ToolDoc {
  name: string;
  url?: string;
  type?: string;
}

function LifecycleFlowPanel({
  selectedNodeId,
  onSelectNode,
}: {
  selectedNodeId: string | null;
  onSelectNode: (id: string, title: string, dept?: string) => void;
}) {
  const { data: lifecycle, isLoading } = useQuery<{
    stages: any[];
    allDepartments: any[];
    totalProcesses: number;
  }>({
    queryKey: ["ee-info-os-lifecycle"],
    queryFn: async () => {
      const res = await authFetch("/api/ee-info/os/lifecycle");
      if (!res.ok) throw new Error("Failed to fetch lifecycle");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const stages = lifecycle?.stages || [];
  const departments = lifecycle?.allDepartments || [];

  if (stages.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        <Layers className="h-8 w-8 mx-auto mb-3 opacity-50" />
        No lifecycle stages found. Seed the OS data first.
      </div>
    );
  }

  return (
    <div className="space-y-2 relative" data-testid="lifecycle-flow-panel">
      <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gradient-to-b from-blue-300 via-violet-300 to-emerald-300" />
      {stages.map((stage, idx) => {
        const isSelected = selectedNodeId === stage.id;
        const deptSlugSet = new Set((stage.processes || []).map((p: any) => p.departmentSlug).filter(Boolean));
        const deptSlugs = Array.from(deptSlugSet) as string[];
        const gradient = STAGE_GRADIENT[idx % STAGE_GRADIENT.length];

        return (
          <div key={stage.id} className="relative pl-10" data-testid={`lifecycle-stage-${stage.slug}`}>
            <div className="absolute left-3 top-4 w-4 h-4 rounded-full bg-card border-2 border-border z-10" />
            {idx < stages.length - 1 && (
              <ArrowDown className="absolute left-3.5 -bottom-2 h-3 w-3 text-slate-600 z-10" />
            )}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className={`w-full text-left rounded-lg border p-3 transition-all ${
                      isSelected
                        ? "border-blue-400 bg-blue-50/50 shadow-md ring-1 ring-blue-200"
                        : "border-border bg-card hover:bg-muted hover:shadow-sm"
                    }`}
                    onClick={() => onSelectNode(stage.id, stage.title)}
                    data-testid={`select-stage-${stage.slug}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-md bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold text-xs shadow-sm shrink-0`}>
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold truncate">{stage.title}</h4>
                        <p className="text-[10px] text-muted-foreground">
                          {(stage.processes || []).length} processes · {deptSlugs.length} depts
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {deptSlugs.slice(0, 3).map(ds => (
                          <span key={ds} className="p-1 rounded bg-muted text-muted-foreground">
                            {DEPT_ICONS[ds] || <Building2 className="h-3 w-3" />}
                          </span>
                        ))}
                        {deptSlugs.length > 3 && (
                          <span className="text-[10px] text-muted-foreground self-center">+{deptSlugs.length - 3}</span>
                        )}
                      </div>
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  <p className="font-semibold">{stage.title}</p>
                  <p>{(stage.processes || []).length} processes across {deptSlugs.length} departments</p>
                  {deptSlugs.map(ds => {
                    const dept = departments.find((d: any) => d.slug === ds);
                    return <p key={ds} className="text-muted-foreground">{dept?.title || ds}</p>;
                  })}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        );
      })}
    </div>
  );
}

function NetworkPanel({
  selectedNodeId,
  onSelectNode,
}: {
  selectedNodeId: string | null;
  onSelectNode: (id: string, title: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");

  const { data: allNodes = [], isLoading: nodesLoading } = useQuery<any[]>({
    queryKey: ["ee-info-nodes"],
    queryFn: async () => {
      const res = await authFetch("/api/ee-info/nodes");
      if (!res.ok) throw new Error("Failed to fetch nodes");
      return res.json();
    },
  });

  const { data: graphData } = useQuery<{ nodes: any[]; edges: any[] }>({
    queryKey: ["ee-info-graph"],
    queryFn: async () => {
      const res = await authFetch("/api/ee-info/graph");
      if (!res.ok) throw new Error("Failed to fetch graph");
      return res.json();
    },
  });

  const edges = graphData?.edges || [];
  const edgeCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of edges) {
      map[e.fromNodeId] = (map[e.fromNodeId] || 0) + 1;
      map[e.toNodeId] = (map[e.toNodeId] || 0) + 1;
    }
    return map;
  }, [edges]);

  const departments = useMemo(() => {
    const slugs = new Set(allNodes.map(n => n.departmentSlug).filter(Boolean));
    return Array.from(slugs);
  }, [allNodes]);

  const filtered = useMemo(() => {
    return allNodes.filter(n => {
      if (search && !n.title.toLowerCase().includes(search.toLowerCase()) && !n.slug.includes(search.toLowerCase())) return false;
      if (typeFilter !== "all" && n.nodeType !== typeFilter) return false;
      if (deptFilter !== "all" && n.departmentSlug !== deptFilter) return false;
      return true;
    });
  }, [allNodes, search, typeFilter, deptFilter]);

  if (nodesLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="network-panel">
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search nodes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
            data-testid="network-search"
          />
        </div>
        <div className="flex gap-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-8 text-xs flex-1" data-testid="filter-node-type">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="department">Department</SelectItem>
              <SelectItem value="lifecycle_stage">Lifecycle Stage</SelectItem>
              <SelectItem value="process">Process</SelectItem>
              <SelectItem value="gate">Gate</SelectItem>
            </SelectContent>
          </Select>
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="h-8 text-xs flex-1" data-testid="filter-department">
              <SelectValue placeholder="All Depts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map(ds => (
                <SelectItem key={ds} value={ds}>{ds.replace("os-dept-", "").replace(/-/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{filtered.length} nodes</p>
      <div className="space-y-1.5 max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
        {filtered.map(node => (
          <button
            key={node.id}
            className={`w-full text-left rounded-lg border p-2.5 transition-all ${
              selectedNodeId === node.id
                ? "border-blue-400 bg-blue-50/50 shadow-sm"
                : "border-border bg-card hover:bg-muted"
            }`}
            onClick={() => onSelectNode(node.id, node.title)}
            data-testid={`network-node-${node.slug}`}
          >
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{node.title}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge variant="outline" className={`text-[9px] ${TYPE_COLORS[node.nodeType] || TYPE_COLORS.content}`}>
                    {node.nodeType}
                  </Badge>
                  {node.departmentSlug && (
                    <span className="text-[10px] text-muted-foreground truncate">
                      {node.departmentSlug.replace("os-dept-", "").replace(/-/g, " ")}
                    </span>
                  )}
                </div>
              </div>
              {edgeCountMap[node.id] > 0 && (
                <Badge variant="outline" className="text-[9px] shrink-0">
                  <Link2 className="h-2.5 w-2.5 mr-0.5" />
                  {edgeCountMap[node.id]}
                </Badge>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function DetailSection({
  title,
  icon,
  children,
  defaultOpen = false,
  testId,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  testId: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          className="flex items-center gap-2 w-full py-2 text-sm font-medium hover:text-blue-600 transition-colors"
          data-testid={`section-toggle-${testId}`}
        >
          {icon}
          {title}
          <ChevronDown className={`h-3.5 w-3.5 ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function NodeDetailPanel({
  nodeId,
  isCOO,
  userId,
  breadcrumbParts,
}: {
  nodeId: string;
  isCOO: boolean;
  userId?: number;
  breadcrumbParts: string[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<{
    purpose: string;
    inputs: string;
    steps: string;
    outputs: string;
    risksFailureModes: string;
    raci: RaciRow[];
    toolsDocs: ToolDoc[];
  }>({ purpose: "", inputs: "", steps: "", outputs: "", risksFailureModes: "", raci: [], toolsDocs: [] });

  const { data: nodeInfo } = useQuery<any>({
    queryKey: ["ee-info-node", nodeId],
    queryFn: async () => {
      const res = await authFetch(`/api/ee-info/nodes/${nodeId}`);
      if (!res.ok) {
        const allNodes = await authFetch("/api/ee-info/nodes");
        const nodes = await allNodes.json();
        return nodes.find((n: any) => n.id === nodeId) || null;
      }
      return res.json();
    },
    enabled: !!nodeId,
  });

  const { data: details } = useQuery<any>({
    queryKey: ["ee-info-node-details", nodeId],
    queryFn: async () => {
      const res = await authFetch(`/api/ee-info/nodes/${nodeId}/details`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!nodeId,
  });

  const { data: liveMetrics } = useQuery<any>({
    queryKey: ["ee-info-node-metrics-live", nodeId],
    queryFn: async () => {
      const res = await authFetch(`/api/ee-info/nodes/${nodeId}/metrics/live`);
      if (!res.ok) return { metrics: [] };
      return res.json();
    },
    enabled: !!nodeId,
  });

  const { data: editors = [] } = useQuery<any[]>({
    queryKey: ["ee-info-node-editors", nodeId],
    queryFn: async () => {
      const res = await authFetch(`/api/ee-info/nodes/${nodeId}/editors`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!nodeId,
  });

  const { data: graphData } = useQuery<{ nodes: any[]; edges: any[] }>({
    queryKey: ["ee-info-graph"],
    queryFn: async () => {
      const res = await authFetch("/api/ee-info/graph");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const relatedNodes = useMemo(() => {
    if (!graphData) return [];
    const relatedIds = new Set<string>();
    for (const e of graphData.edges) {
      if (e.fromNodeId === nodeId) relatedIds.add(e.toNodeId);
      if (e.toNodeId === nodeId) relatedIds.add(e.fromNodeId);
    }
    return graphData.nodes.filter(n => relatedIds.has(n.id)).slice(0, 12);
  }, [graphData, nodeId]);

  const canEdit = isCOO || editors.some((e: any) => e.userId === userId && e.canEdit);

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await authFetch(`/api/ee-info/nodes/${nodeId}/details`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save details");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ee-info-node-details", nodeId] });
      toast({ title: "Saved", description: "Node details updated." });
      setEditMode(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save changes.", variant: "destructive" });
    },
  });

  const startEdit = useCallback(() => {
    setEditData({
      purpose: details?.purpose || "",
      inputs: details?.inputs || "",
      steps: details?.steps || "",
      outputs: details?.outputs || "",
      risksFailureModes: details?.risksFailureModes || "",
      raci: details?.raci || [],
      toolsDocs: details?.toolsDocs || [],
    });
    setEditMode(true);
  }, [details]);

  const handleSave = () => {
    saveMutation.mutate(editData);
  };

  const node = nodeInfo;
  if (!node) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
      </div>
    );
  }

  const metrics = liveMetrics?.metrics || [];

  return (
    <div className="space-y-4" data-testid="node-detail-panel">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap" data-testid="breadcrumb-trail">
        {breadcrumbParts.map((part, i) => (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRight className="h-3 w-3" />}
            <span className={i === breadcrumbParts.length - 1 ? "font-medium text-foreground" : ""}>{part}</span>
          </React.Fragment>
        ))}
      </div>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold" data-testid="node-title">{node.title}</h2>
          <div className="flex items-center gap-2 mt-1.5">
            <Badge className={TYPE_COLORS[node.nodeType] || TYPE_COLORS.content} data-testid="node-type-badge">
              {node.nodeType || node.category}
            </Badge>
            <Badge variant="outline" className={node.status === "published" ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-700 border-amber-200"} data-testid="node-status-badge">
              {node.status}
            </Badge>
            {node.updatedAt && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(node.updatedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        {canEdit && !editMode && (
          <Button size="sm" variant="outline" onClick={startEdit} className="gap-1.5" data-testid="btn-edit-node">
            <Edit2 className="h-3.5 w-3.5" /> Edit
          </Button>
        )}
      </div>

      {editMode && (
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending} className="gap-1" data-testid="btn-save-details">
            {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditMode(false)} data-testid="btn-cancel-edit">
            <X className="h-3.5 w-3.5 mr-1" /> Cancel
          </Button>
        </div>
      )}

      <div className="divide-y divide-slate-100">
        <DetailSection title="Purpose" icon={<Target className="h-4 w-4 text-blue-500" />} defaultOpen testId="purpose">
          {editMode ? (
            <Textarea
              value={editData.purpose}
              onChange={(e) => setEditData(prev => ({ ...prev, purpose: e.target.value }))}
              className="text-sm min-h-[80px]"
              data-testid="edit-purpose"
            />
          ) : (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{details?.purpose || "Not documented yet."}</p>
          )}
        </DetailSection>

        <DetailSection title="Inputs" icon={<FileText className="h-4 w-4 text-emerald-500" />} testId="inputs">
          {editMode ? (
            <Textarea
              value={editData.inputs}
              onChange={(e) => setEditData(prev => ({ ...prev, inputs: e.target.value }))}
              className="text-sm min-h-[60px]"
              data-testid="edit-inputs"
            />
          ) : (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{details?.inputs || "—"}</p>
          )}
        </DetailSection>

        <DetailSection title="Steps" icon={<GitBranch className="h-4 w-4 text-violet-500" />} testId="steps">
          {editMode ? (
            <Textarea
              value={editData.steps}
              onChange={(e) => setEditData(prev => ({ ...prev, steps: e.target.value }))}
              className="text-sm min-h-[80px]"
              data-testid="edit-steps"
            />
          ) : (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{details?.steps || "—"}</p>
          )}
        </DetailSection>

        <DetailSection title="Outputs" icon={<CheckCircle2 className="h-4 w-4 text-teal-500" />} testId="outputs">
          {editMode ? (
            <Textarea
              value={editData.outputs}
              onChange={(e) => setEditData(prev => ({ ...prev, outputs: e.target.value }))}
              className="text-sm min-h-[60px]"
              data-testid="edit-outputs"
            />
          ) : (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{details?.outputs || "—"}</p>
          )}
        </DetailSection>

        <DetailSection title="RACI" icon={<Users className="h-4 w-4 text-orange-500" />} testId="raci">
          {editMode ? (
            <div className="space-y-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Role</TableHead>
                    <TableHead className="text-xs w-10">R</TableHead>
                    <TableHead className="text-xs w-10">A</TableHead>
                    <TableHead className="text-xs w-10">C</TableHead>
                    <TableHead className="text-xs w-10">I</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {editData.raci.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Input
                          value={row.role}
                          onChange={(e) => {
                            const updated = [...editData.raci];
                            updated[i] = { ...updated[i], role: e.target.value };
                            setEditData(prev => ({ ...prev, raci: updated }));
                          }}
                          className="h-7 text-xs"
                          data-testid={`raci-role-${i}`}
                        />
                      </TableCell>
                      {(["responsible", "accountable", "consulted", "informed"] as const).map(field => (
                        <TableCell key={field}>
                          <input
                            type="checkbox"
                            checked={!!row[field]}
                            onChange={(e) => {
                              const updated = [...editData.raci];
                              updated[i] = { ...updated[i], [field]: e.target.checked };
                              setEditData(prev => ({ ...prev, raci: updated }));
                            }}
                            data-testid={`raci-${field}-${i}`}
                          />
                        </TableCell>
                      ))}
                      <TableCell>
                        <button
                          onClick={() => setEditData(prev => ({ ...prev, raci: prev.raci.filter((_, j) => j !== i) }))}
                          className="text-red-600 hover:text-red-600"
                          data-testid={`raci-delete-${i}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditData(prev => ({ ...prev, raci: [...prev.raci, { role: "" }] }))}
                className="text-xs gap-1"
                data-testid="btn-add-raci-row"
              >
                <Plus className="h-3 w-3" /> Add Role
              </Button>
            </div>
          ) : (
            <div>
              {(details?.raci && details.raci.length > 0) ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Role</TableHead>
                      <TableHead className="text-xs w-10">R</TableHead>
                      <TableHead className="text-xs w-10">A</TableHead>
                      <TableHead className="text-xs w-10">C</TableHead>
                      <TableHead className="text-xs w-10">I</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {details.raci.map((row: RaciRow, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{row.role}</TableCell>
                        <TableCell>{row.responsible ? "✓" : ""}</TableCell>
                        <TableCell>{row.accountable ? "✓" : ""}</TableCell>
                        <TableCell>{row.consulted ? "✓" : ""}</TableCell>
                        <TableCell>{row.informed ? "✓" : ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">No RACI defined.</p>
              )}
            </div>
          )}
        </DetailSection>

        <DetailSection title="Tools & Docs" icon={<Wrench className="h-4 w-4 text-cyan-500" />} testId="tools-docs">
          {editMode ? (
            <div className="space-y-2">
              {editData.toolsDocs.map((td, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input
                    value={td.name}
                    onChange={(e) => {
                      const updated = [...editData.toolsDocs];
                      updated[i] = { ...updated[i], name: e.target.value };
                      setEditData(prev => ({ ...prev, toolsDocs: updated }));
                    }}
                    placeholder="Tool name"
                    className="h-7 text-xs flex-1"
                    data-testid={`tool-name-${i}`}
                  />
                  <Input
                    value={td.url || ""}
                    onChange={(e) => {
                      const updated = [...editData.toolsDocs];
                      updated[i] = { ...updated[i], url: e.target.value };
                      setEditData(prev => ({ ...prev, toolsDocs: updated }));
                    }}
                    placeholder="URL"
                    className="h-7 text-xs flex-1"
                    data-testid={`tool-url-${i}`}
                  />
                  <button
                    onClick={() => setEditData(prev => ({ ...prev, toolsDocs: prev.toolsDocs.filter((_, j) => j !== i) }))}
                    className="text-red-600 hover:text-red-600"
                    data-testid={`tool-delete-${i}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditData(prev => ({ ...prev, toolsDocs: [...prev.toolsDocs, { name: "" }] }))}
                className="text-xs gap-1"
                data-testid="btn-add-tool"
              >
                <Plus className="h-3 w-3" /> Add Tool/Doc
              </Button>
            </div>
          ) : (
            <div>
              {(details?.toolsDocs && details.toolsDocs.length > 0) ? (
                <ul className="space-y-1">
                  {details.toolsDocs.map((td: ToolDoc, i: number) => (
                    <li key={i} className="text-sm flex items-center gap-1.5">
                      <Wrench className="h-3 w-3 text-muted-foreground" />
                      {td.url ? (
                        <a href={td.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{td.name}</a>
                      ) : (
                        <span>{td.name}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No tools/docs listed.</p>
              )}
            </div>
          )}
        </DetailSection>

        <DetailSection title="Risks & Failure Modes" icon={<AlertCircle className="h-4 w-4 text-red-500" />} testId="risks">
          {editMode ? (
            <Textarea
              value={editData.risksFailureModes}
              onChange={(e) => setEditData(prev => ({ ...prev, risksFailureModes: e.target.value }))}
              className="text-sm min-h-[60px]"
              data-testid="edit-risks"
            />
          ) : (
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{details?.risksFailureModes || "—"}</p>
          )}
        </DetailSection>
      </div>

      {metrics.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Activity className="h-4 w-4 text-blue-500" /> Live Metrics
          </h4>
          <div className="grid grid-cols-2 gap-2" data-testid="metrics-grid">
            {metrics.map((m: any, i: number) => (
              <Card key={i} className="p-2.5">
                <p className="text-[10px] text-muted-foreground">{m.metricKey}</p>
                <p className="text-lg font-bold" data-testid={`metric-value-${i}`}>{m.value ?? "—"}</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {relatedNodes.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Link2 className="h-4 w-4 text-violet-500" /> Related Nodes ({relatedNodes.length})
          </h4>
          <div className="space-y-1">
            {relatedNodes.map(rn => (
              <div key={rn.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted text-sm" data-testid={`related-node-${rn.slug}`}>
                <Badge variant="outline" className={`text-[9px] ${TYPE_COLORS[rn.nodeType || rn.category] || TYPE_COLORS.content}`}>
                  {rn.nodeType || rn.category}
                </Badge>
                <span className="truncate text-xs">{rn.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isCOO && (
        <EditorsPanel nodeId={nodeId} editors={editors} />
      )}
    </div>
  );
}

function EditorsPanel({ nodeId, editors }: { nodeId: string; editors: any[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [newUserId, setNewUserId] = useState("");

  const addEditorMutation = useMutation({
    mutationFn: async (userId: number) => {
      const res = await authFetch(`/api/ee-info/nodes/${nodeId}/editors`, {
        method: "POST",
        body: JSON.stringify({ userId, canEdit: true, canManageChildren: false }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ee-info-node-editors", nodeId] });
      toast({ title: "Editor added" });
      setNewUserId("");
    },
  });

  const removeEditorMutation = useMutation({
    mutationFn: async (editorId: number) => {
      const res = await authFetch(`/api/ee-info/nodes/${nodeId}/editors/${editorId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ee-info-node-editors", nodeId] });
      toast({ title: "Editor removed" });
    },
  });

  return (
    <div className="border-t pt-3 mt-3">
      <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
        <Shield className="h-4 w-4 text-indigo-500" /> Manage Editors (COO)
      </h4>
      {editors.length > 0 ? (
        <div className="space-y-1 mb-2">
          {editors.map((e: any) => (
            <div key={e.id} className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-muted text-xs">
              <span>User #{e.userId} {e.canEdit ? "(edit)" : "(view)"}</span>
              <button
                onClick={() => removeEditorMutation.mutate(e.id)}
                className="text-red-600 hover:text-red-600"
                data-testid={`remove-editor-${e.id}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground mb-2">No editors assigned.</p>
      )}
      <div className="flex gap-2">
        <Input
          value={newUserId}
          onChange={(e) => setNewUserId(e.target.value)}
          placeholder="User ID"
          className="h-7 text-xs w-24"
          data-testid="input-new-editor-id"
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          disabled={!newUserId || addEditorMutation.isPending}
          onClick={() => addEditorMutation.mutate(parseInt(newUserId))}
          data-testid="btn-add-editor"
        >
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>
    </div>
  );
}

function OverviewSummary() {
  const { data: allNodes = [] } = useQuery<any[]>({
    queryKey: ["ee-info-nodes"],
    queryFn: async () => {
      const res = await authFetch("/api/ee-info/nodes");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: graphData } = useQuery<{ nodes: any[]; edges: any[] }>({
    queryKey: ["ee-info-graph"],
    queryFn: async () => {
      const res = await authFetch("/api/ee-info/graph");
      if (!res.ok) return { nodes: [], edges: [] };
      return res.json();
    },
  });

  const edges = graphData?.edges || [];
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of allNodes) {
      const t = n.nodeType || "other";
      counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  }, [allNodes]);

  return (
    <div className="space-y-4 py-8" data-testid="overview-summary">
      <div className="text-center">
        <MapPin className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <h3 className="text-lg font-semibold">Company Overview Map</h3>
        <p className="text-sm text-muted-foreground mt-1">Select a node from the left panel to view details.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 max-w-xs mx-auto">
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold" data-testid="stat-total-nodes">{allNodes.length}</p>
          <p className="text-xs text-muted-foreground">Total Nodes</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-2xl font-bold" data-testid="stat-total-edges">{edges.length}</p>
          <p className="text-xs text-muted-foreground">Total Edges</p>
        </Card>
      </div>
      {Object.keys(typeCounts).length > 0 && (
        <div className="flex flex-wrap gap-1.5 justify-center">
          {Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
            <Badge key={type} variant="outline" className={`text-[10px] ${TYPE_COLORS[type] || TYPE_COLORS.content}`}>
              {type}: {count}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CompanyOverviewMap({ isCOO, userId }: CompanyOverviewMapProps) {
  const [viewMode, setViewMode] = useState<"lifecycle" | "network">("lifecycle");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<string[]>(["Company"]);

  const handleSelectNode = useCallback((id: string, title: string, dept?: string) => {
    setSelectedNodeId(id);
    const parts = ["Company"];
    if (dept) parts.push(dept.replace("os-dept-", "").replace(/-/g, " "));
    parts.push(title);
    setBreadcrumb(parts);
  }, []);

  return (
    <div className="flex gap-4 h-full min-h-[600px]" data-testid="company-overview-map">
      <div className="w-[380px] shrink-0 flex flex-col border rounded-xl bg-card overflow-hidden">
        <div className="p-3 border-b bg-muted/50">
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={viewMode === "lifecycle" ? "default" : "outline"}
              onClick={() => setViewMode("lifecycle")}
              className="flex-1 h-8 text-xs gap-1.5"
              data-testid="btn-view-lifecycle"
            >
              <Layers className="h-3.5 w-3.5" /> Lifecycle Flow
            </Button>
            <Button
              size="sm"
              variant={viewMode === "network" ? "default" : "outline"}
              onClick={() => setViewMode("network")}
              className="flex-1 h-8 text-xs gap-1.5"
              data-testid="btn-view-network"
            >
              <Network className="h-3.5 w-3.5" /> Network
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {viewMode === "lifecycle" ? (
            <LifecycleFlowPanel selectedNodeId={selectedNodeId} onSelectNode={handleSelectNode} />
          ) : (
            <NetworkPanel selectedNodeId={selectedNodeId} onSelectNode={handleSelectNode} />
          )}
        </div>
      </div>

      <div className="flex-1 border rounded-xl bg-card overflow-y-auto p-4">
        {selectedNodeId ? (
          <NodeDetailPanel
            nodeId={selectedNodeId}
            isCOO={isCOO}
            userId={userId}
            breadcrumbParts={breadcrumb}
          />
        ) : (
          <OverviewSummary />
        )}
      </div>
    </div>
  );
}