import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search, Network, FileText, GitBranch, ChevronRight, ArrowRight,
  Edit2, Save, X, Plus, Trash2, Loader2, BookOpen, Users, Wrench,
  FileCheck, HelpCircle, Circle, RefreshCw, Shield, Zap
} from "lucide-react";

interface EeNode {
  id: string;
  slug: string;
  title: string;
  contentMarkdown: string | null;
  status: string;
  category: string;
  tags: string[];
  flowEnabled: boolean;
  flowLane: string | null;
  flowStepCode: string | null;
  nextSlugs: string[];
  prevSlugs: string[];
  gateConditions: string[];
  blockingConditions: string[];
  responsibleRole: string | null;
  escalationRole: string | null;
  createdAt: string;
  updatedAt: string;
}

interface EeEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType: string;
}

interface EeNodeDetail extends EeNode {
  assets: { id: string; filename: string; mimeType: string }[];
  outboundEdges: { id: string; toNodeId: string; edgeType: string; targetNode?: { slug: string; title: string; category: string } }[];
  inboundEdges: { id: string; fromNodeId: string; edgeType: string; sourceNode?: { slug: string; title: string; category: string } }[];
}

const categoryIcons: Record<string, React.ReactNode> = {
  role: <Users className="h-3.5 w-3.5" />,
  process: <GitBranch className="h-3.5 w-3.5" />,
  tool: <Wrench className="h-3.5 w-3.5" />,
  template: <FileCheck className="h-3.5 w-3.5" />,
  governance: <Shield className="h-3.5 w-3.5" />,
  other: <BookOpen className="h-3.5 w-3.5" />,
  unknown: <HelpCircle className="h-3.5 w-3.5" />,
};

const categoryColors: Record<string, string> = {
  role: "bg-blue-100 text-blue-700 border-blue-200",
  process: "bg-green-100 text-green-700 border-green-200",
  tool: "bg-purple-100 text-purple-700 border-purple-200",
  template: "bg-amber-100 text-amber-700 border-amber-200",
  governance: "bg-red-100 text-red-700 border-red-200",
  other: "bg-slate-100 text-slate-700 border-slate-200",
  unknown: "bg-gray-100 text-gray-500 border-gray-200",
};

const graphNodeColors: Record<string, string> = {
  role: "#3b82f6",
  process: "#22c55e",
  tool: "#a855f7",
  template: "#f59e0b",
  governance: "#ef4444",
  other: "#64748b",
  unknown: "#9ca3af",
};

function renderMarkdown(content: string): string {
  let html = content;
  html = html.replace(/!\[\[([^\]]+)\]\]/g, (_, filename) => {
    if (/\.(png|jpg|jpeg|webp|gif|svg)$/i.test(filename)) {
      return `<img src="/api/ee-info/assets/${encodeURIComponent(filename)}" alt="${filename}" class="max-w-full rounded my-2" />`;
    }
    return `<a href="#" class="text-blue-600">[Embed: ${filename}]</a>`;
  });
  html = html.replace(/(?<!!)\[\[([^\]]+)\]\]/g, (_, name) => {
    const slug = name.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-");
    return `<a href="#" data-wiki-link="${slug}" class="text-blue-600 hover:underline cursor-pointer font-medium">[[${name}]]</a>`;
  });
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-4 mb-2">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold mt-5 mb-2">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-5 mb-3">$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li class="ml-4 list-decimal">$1</li>');
  html = html.replace(/^[-•]\s+(.+)$/gm, '<li class="ml-4 list-disc">$1</li>');
  html = html.replace(/\n/g, "<br/>");
  return html;
}

function GraphTab({ nodes, edges, onSelectNode }: { nodes: EeNode[]; edges: EeEdge[]; onSelectNode: (slug: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [dragNode, setDragNode] = useState<string | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const animRef = useRef<number>(0);

  const filtered = useMemo(() => {
    let f = nodes;
    if (categoryFilter !== "all") f = f.filter(n => n.category === categoryFilter);
    if (search) {
      const q = search.toLowerCase();
      f = f.filter(n => n.title.toLowerCase().includes(q));
    }
    return f;
  }, [nodes, categoryFilter, search]);

  const filteredIds = useMemo(() => new Set(filtered.map(n => n.id)), [filtered]);
  const filteredEdges = useMemo(() => edges.filter(e => filteredIds.has(e.fromNodeId) && filteredIds.has(e.toNodeId)), [edges, filteredIds]);

  useEffect(() => {
    if (filtered.length === 0) return;
    const pos = new Map<string, { x: number; y: number }>();
    const width = 900;
    const height = 600;
    const cats = [...new Set(filtered.map(n => n.category))];

    filtered.forEach((n, i) => {
      const catIdx = cats.indexOf(n.category);
      const nodesInCat = filtered.filter(nn => nn.category === n.category);
      const idxInCat = nodesInCat.indexOf(n);
      const angle = (2 * Math.PI * idxInCat) / Math.max(nodesInCat.length, 1);
      const catAngle = (2 * Math.PI * catIdx) / Math.max(cats.length, 1);
      const catRadius = 180;
      const nodeRadius = 60 + nodesInCat.length * 8;
      const cx = width / 2 + Math.cos(catAngle) * catRadius;
      const cy = height / 2 + Math.sin(catAngle) * catRadius;
      pos.set(n.id, {
        x: cx + Math.cos(angle) * nodeRadius,
        y: cy + Math.sin(angle) * nodeRadius,
      });
    });

    for (let iter = 0; iter < 50; iter++) {
      const forces = new Map<string, { fx: number; fy: number }>();
      filtered.forEach(n => forces.set(n.id, { fx: 0, fy: 0 }));

      filtered.forEach((a, i) => {
        filtered.forEach((b, j) => {
          if (i >= j) return;
          const pa = pos.get(a.id)!;
          const pb = pos.get(b.id)!;
          const dx = pb.x - pa.x;
          const dy = pb.y - pa.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const repulsion = 5000 / (dist * dist);
          const fa = forces.get(a.id)!;
          const fb = forces.get(b.id)!;
          fa.fx -= (dx / dist) * repulsion;
          fa.fy -= (dy / dist) * repulsion;
          fb.fx += (dx / dist) * repulsion;
          fb.fy += (dy / dist) * repulsion;
        });
      });

      filteredEdges.forEach(e => {
        const pa = pos.get(e.fromNodeId);
        const pb = pos.get(e.toNodeId);
        if (!pa || !pb) return;
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const spring = (dist - 120) * 0.01;
        const fa = forces.get(e.fromNodeId)!;
        const fb = forces.get(e.toNodeId)!;
        if (fa) { fa.fx += (dx / dist) * spring; fa.fy += (dy / dist) * spring; }
        if (fb) { fb.fx -= (dx / dist) * spring; fb.fy -= (dy / dist) * spring; }
      });

      filtered.forEach(n => {
        const p = pos.get(n.id)!;
        const f = forces.get(n.id)!;
        p.x += Math.max(-5, Math.min(5, f.fx));
        p.y += Math.max(-5, Math.min(5, f.fy));
        p.x = Math.max(30, Math.min(width - 30, p.x));
        p.y = Math.max(30, Math.min(height - 30, p.y));
      });
    }

    setPositions(pos);
  }, [filtered, filteredEdges]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || positions.size === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(offset.x, offset.y);
      ctx.scale(zoom, zoom);

      filteredEdges.forEach(e => {
        const from = positions.get(e.fromNodeId);
        const to = positions.get(e.toNodeId);
        if (!from || !to) return;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = e.edgeType === "embed" ? "#f59e0b88" : "#94a3b844";
        ctx.lineWidth = e.edgeType === "embed" ? 2 : 1;
        ctx.stroke();
      });

      filtered.forEach(n => {
        const p = positions.get(n.id);
        if (!p) return;
        const color = graphNodeColors[n.category] || "#9ca3af";
        const isHovered = hoveredNode === n.id;
        const radius = isHovered ? 10 : (n.status === "stub" ? 5 : 7);

        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = n.status === "stub" ? color + "44" : color;
        ctx.fill();
        if (isHovered) {
          ctx.strokeStyle = "#000";
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        ctx.fillStyle = "#334155";
        ctx.font = isHovered ? "bold 11px sans-serif" : "10px sans-serif";
        ctx.textAlign = "center";
        const label = n.title.length > 20 ? n.title.slice(0, 18) + "..." : n.title;
        ctx.fillText(label, p.x, p.y + radius + 12);
      });

      ctx.restore();
    };

    draw();
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [positions, filtered, filteredEdges, hoveredNode, offset, zoom]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left - offset.x) / zoom;
    const my = (e.clientY - rect.top - offset.y) / zoom;

    for (const n of filtered) {
      const p = positions.get(n.id);
      if (!p) continue;
      const dx = mx - p.x;
      const dy = my - p.y;
      if (dx * dx + dy * dy < 200) {
        onSelectNode(n.slug);
        return;
      }
    }
  }, [filtered, positions, offset, zoom, onSelectNode]);

  const handleCanvasMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left - offset.x) / zoom;
    const my = (e.clientY - rect.top - offset.y) / zoom;

    let found: string | null = null;
    for (const n of filtered) {
      const p = positions.get(n.id);
      if (!p) continue;
      const dx = mx - p.x;
      const dy = my - p.y;
      if (dx * dx + dy * dy < 200) {
        found = n.id;
        break;
      }
    }
    setHoveredNode(found);
    canvas.style.cursor = found ? "pointer" : "default";
  }, [filtered, positions, offset, zoom]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setZoom(z => Math.max(0.3, Math.min(3, z - e.deltaY * 0.001)));
  }, []);

  const categories = useMemo(() => [...new Set(nodes.map(n => n.category))].sort(), [nodes]);

  return (
    <div className="space-y-3" data-testid="graph-tab">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search nodes..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-xs" data-testid="graph-search" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="graph-category-filter">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(c => (
              <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-1.5 ml-auto">
          {Object.entries(graphNodeColors).filter(([k]) => k !== "unknown").map(([cat, color]) => (
            <div key={cat} className="flex items-center gap-1 text-xs text-muted-foreground">
              <Circle className="h-2.5 w-2.5" fill={color} stroke={color} />
              <span className="capitalize">{cat}</span>
            </div>
          ))}
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <canvas
            ref={canvasRef}
            width={900}
            height={600}
            className="w-full border rounded-lg"
            style={{ height: 600 }}
            onClick={handleCanvasClick}
            onMouseMove={handleCanvasMove}
            onWheel={handleWheel}
            data-testid="graph-canvas"
          />
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground text-center">
        {filtered.length} nodes, {filteredEdges.length} edges. Click a node to view details. Scroll to zoom.
      </p>
    </div>
  );
}

function DetailTab({ nodes, selectedSlug, onSelectNode, userRole }: { nodes: EeNode[]; selectedSlug: string | null; onSelectNode: (slug: string) => void; userRole: string | null }) {
  const [search, setSearch] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editResponsibleRole, setEditResponsibleRole] = useState("");
  const [editEscalationRole, setEditEscalationRole] = useState("");
  const [editGateConditions, setEditGateConditions] = useState("");
  const [editBlockingConditions, setEditBlockingConditions] = useState("");
  const queryClient = useQueryClient();
  const isCOO = userRole === "COO_ADMIN" || userRole === "admin" || userRole === "CEO_ADMIN";

  const { data: nodeDetail, isLoading } = useQuery<EeNodeDetail>({
    queryKey: ["ee-info-node", selectedSlug],
    queryFn: async () => {
      const res = await fetch(`/api/ee-info/nodes/${selectedSlug}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch node");
      return res.json();
    },
    enabled: !!selectedSlug,
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch(`/api/ee-info/nodes/${nodeDetail!.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ee-info-node", selectedSlug] });
      queryClient.invalidateQueries({ queryKey: ["ee-info-nodes"] });
      setEditMode(false);
    },
  });

  const grouped = useMemo(() => {
    const groups: Record<string, EeNode[]> = {};
    let filtered = nodes.filter(n => n.status !== "stub");
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(n => n.title.toLowerCase().includes(q));
    }
    for (const n of filtered) {
      const cat = n.category || "unknown";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(n);
    }
    for (const cat of Object.keys(groups)) {
      groups[cat].sort((a, b) => a.title.localeCompare(b.title));
    }
    return groups;
  }, [nodes, search]);

  const handleSave = () => {
    if (!nodeDetail) return;
    updateMutation.mutate({
      contentMarkdown: editContent,
      category: editCategory,
      responsibleRole: editResponsibleRole || null,
      escalationRole: editEscalationRole || null,
      gateConditions: editGateConditions ? editGateConditions.split("\n").map(s => s.trim()).filter(Boolean) : [],
      blockingConditions: editBlockingConditions ? editBlockingConditions.split("\n").map(s => s.trim()).filter(Boolean) : [],
    });
  };

  const handleWikiClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const link = target.closest("[data-wiki-link]");
    if (link) {
      e.preventDefault();
      const slug = link.getAttribute("data-wiki-link");
      if (slug) onSelectNode(slug);
    }
  }, [onSelectNode]);

  const categoryOrder = ["process", "role", "governance", "tool", "template", "other", "unknown"];

  return (
    <div className="flex gap-4" style={{ minHeight: 600 }} data-testid="detail-tab">
      <div className="w-64 shrink-0">
        <div className="relative mb-2">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search pages..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-xs" data-testid="detail-search" />
        </div>
        <ScrollArea className="h-[560px]">
          {categoryOrder.filter(c => grouped[c]).map(cat => (
            <div key={cat} className="mb-3">
              <div className="flex items-center gap-1.5 mb-1 px-1">
                {categoryIcons[cat]}
                <span className="text-xs font-semibold capitalize text-muted-foreground">{cat}</span>
                <span className="text-xs text-muted-foreground">({grouped[cat].length})</span>
              </div>
              {grouped[cat].map(n => (
                <button
                  key={n.slug}
                  onClick={() => onSelectNode(n.slug)}
                  className={`w-full text-left px-2 py-1 text-xs rounded transition-colors ${
                    selectedSlug === n.slug ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted"
                  }`}
                  data-testid={`detail-nav-${n.slug}`}
                >
                  {n.title}
                </button>
              ))}
            </div>
          ))}
        </ScrollArea>
      </div>

      <div className="flex-1 min-w-0">
        {!selectedSlug ? (
          <Card>
            <CardContent className="flex items-center justify-center py-20">
              <p className="text-muted-foreground text-sm" data-testid="detail-empty">Select a page from the sidebar to view its content.</p>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : nodeDetail ? (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg">{nodeDetail.title}</CardTitle>
                  <Badge variant="outline" className={`text-[10px] ${categoryColors[nodeDetail.category] || ""}`}>
                    {nodeDetail.category}
                  </Badge>
                  {nodeDetail.status === "stub" && <Badge variant="outline" className="text-[10px] text-gray-500">Stub</Badge>}
                </div>
                {isCOO && !editMode && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setEditMode(true); setEditContent(nodeDetail.contentMarkdown || ""); setEditCategory(nodeDetail.category); setEditResponsibleRole(nodeDetail.responsibleRole || ""); setEditEscalationRole(nodeDetail.escalationRole || ""); setEditGateConditions((nodeDetail.gateConditions || []).join("\n")); setEditBlockingConditions((nodeDetail.blockingConditions || []).join("\n")); }} data-testid="detail-edit-btn">
                    <Edit2 className="h-3 w-3" /> Edit
                  </Button>
                )}
                {editMode && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="default" className="h-7 text-xs gap-1" onClick={handleSave} disabled={updateMutation.isPending} data-testid="detail-save-btn">
                      <Save className="h-3 w-3" /> Save
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditMode(false)} data-testid="detail-cancel-btn">
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {editMode ? (
                <div className="space-y-3">
                  <div className="flex gap-2 items-center">
                    <span className="text-xs font-medium">Category:</span>
                    <Select value={editCategory} onValueChange={setEditCategory}>
                      <SelectTrigger className="w-[140px] h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["role", "process", "governance", "tool", "template", "other", "unknown"].map(c => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Textarea value={editContent} onChange={e => setEditContent(e.target.value)} className="min-h-[300px] font-mono text-xs" data-testid="detail-edit-content" />
                  <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
                    <h4 className="text-xs font-semibold text-muted-foreground">Structured Metadata</h4>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground">Responsible Role</label>
                        <Input value={editResponsibleRole} onChange={e => setEditResponsibleRole(e.target.value)} className="h-7 text-xs" placeholder="e.g. Project Manager" data-testid="edit-responsible-role" />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Escalation Role</label>
                        <Input value={editEscalationRole} onChange={e => setEditEscalationRole(e.target.value)} className="h-7 text-xs" placeholder="e.g. COO" data-testid="edit-escalation-role" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Gate Conditions (one per line)</label>
                      <Textarea value={editGateConditions} onChange={e => setEditGateConditions(e.target.value)} className="min-h-[60px] font-mono text-xs" placeholder="PO number present&#10;Invoice number present" data-testid="edit-gate-conditions" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Blocking Conditions (one per line)</label>
                      <Textarea value={editBlockingConditions} onChange={e => setEditBlockingConditions(e.target.value)} className="min-h-[60px] font-mono text-xs" placeholder="No work before COO approval" data-testid="edit-blocking-conditions" />
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  {nodeDetail.contentMarkdown ? (
                    <div
                      className="prose prose-sm max-w-none text-sm leading-relaxed"
                      onClick={handleWikiClick}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(nodeDetail.contentMarkdown) }}
                      data-testid="detail-content"
                    />
                  ) : (
                    <p className="text-muted-foreground text-sm italic">No content yet. {isCOO ? "Click Edit to add content." : ""}</p>
                  )}

                  {(nodeDetail.responsibleRole || nodeDetail.escalationRole || (nodeDetail.gateConditions && nodeDetail.gateConditions.length > 0) || (nodeDetail.blockingConditions && nodeDetail.blockingConditions.length > 0)) && (
                    <div className="mt-4 pt-3 border-t space-y-2" data-testid="detail-metadata">
                      {(nodeDetail.responsibleRole || nodeDetail.escalationRole) && (
                        <div className="flex flex-wrap gap-3">
                          {nodeDetail.responsibleRole && (
                            <div className="flex items-center gap-1.5">
                              <Users className="h-3 w-3 text-blue-600" />
                              <span className="text-xs text-muted-foreground">Responsible:</span>
                              <span className="text-xs font-medium">{nodeDetail.responsibleRole}</span>
                            </div>
                          )}
                          {nodeDetail.escalationRole && (
                            <div className="flex items-center gap-1.5">
                              <Zap className="h-3 w-3 text-amber-600" />
                              <span className="text-xs text-muted-foreground">Escalation:</span>
                              <span className="text-xs font-medium">{nodeDetail.escalationRole}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {nodeDetail.gateConditions && nodeDetail.gateConditions.length > 0 && (
                        <div>
                          <span className="text-xs font-semibold text-green-700">Gate Conditions</span>
                          <ul className="mt-0.5 space-y-0.5">
                            {nodeDetail.gateConditions.map((g, i) => (
                              <li key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                                {g}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {nodeDetail.blockingConditions && nodeDetail.blockingConditions.length > 0 && (
                        <div>
                          <span className="text-xs font-semibold text-red-700">Blocking Conditions</span>
                          <ul className="mt-0.5 space-y-0.5">
                            {nodeDetail.blockingConditions.map((b, i) => (
                              <li key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                                {b}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {(nodeDetail.outboundEdges.length > 0 || nodeDetail.inboundEdges.length > 0) && (
                    <div className="mt-6 pt-4 border-t">
                      <h4 className="text-xs font-semibold text-muted-foreground mb-2">Linked Pages</h4>
                      <div className="flex flex-wrap gap-1.5">
                        {nodeDetail.outboundEdges.filter(e => e.targetNode).map(e => (
                          <Badge
                            key={e.id}
                            variant="outline"
                            className={`cursor-pointer text-xs hover:bg-muted ${categoryColors[e.targetNode!.category] || ""}`}
                            onClick={() => onSelectNode(e.targetNode!.slug)}
                            data-testid={`link-${e.targetNode!.slug}`}
                          >
                            {e.edgeType === "embed" ? "!" : ""}{e.targetNode!.title}
                          </Badge>
                        ))}
                        {nodeDetail.inboundEdges.filter(e => e.sourceNode).map(e => (
                          <Badge
                            key={e.id}
                            variant="outline"
                            className={`cursor-pointer text-xs hover:bg-muted border-dashed ${categoryColors[e.sourceNode!.category] || ""}`}
                            onClick={() => onSelectNode(e.sourceNode!.slug)}
                            data-testid={`backlink-${e.sourceNode!.slug}`}
                          >
                            {e.sourceNode!.title}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {nodeDetail.assets.length > 0 && (
                    <div className="mt-4 pt-4 border-t">
                      <h4 className="text-xs font-semibold text-muted-foreground mb-2">Assets</h4>
                      <div className="flex flex-wrap gap-2">
                        {nodeDetail.assets.map(a => (
                          <a key={a.id} href={`/api/ee-info/assets/${encodeURIComponent(a.filename)}`} target="_blank" rel="noopener" className="text-xs text-blue-600 hover:underline">
                            {a.filename}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function FlowTab({ nodes, onSelectNode }: { nodes: EeNode[]; onSelectNode: (slug: string) => void }) {
  const { data: flowNodes = [], isLoading } = useQuery<EeNode[]>({
    queryKey: ["ee-info-flow"],
    queryFn: async () => {
      const res = await fetch("/api/ee-info/flow", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch flow");
      return res.json();
    },
  });

  const nodeBySlug = useMemo(() => {
    const map = new Map<string, EeNode>();
    for (const n of nodes) map.set(n.slug, n);
    return map;
  }, [nodes]);

  const startNodes = useMemo(() => flowNodes.filter(n => !n.prevSlugs || n.prevSlugs.length === 0), [flowNodes]);

  const lanes = useMemo(() => {
    const laneMap = new Map<string, EeNode[]>();
    for (const n of flowNodes) {
      const lane = n.flowLane || "Main Flow";
      if (!laneMap.has(lane)) laneMap.set(lane, []);
      laneMap.get(lane)!.push(n);
    }
    return laneMap;
  }, [flowNodes]);

  if (isLoading) {
    return <Card><CardContent className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></CardContent></Card>;
  }

  if (flowNodes.length === 0) {
    return <Card><CardContent className="py-12"><p className="text-center text-muted-foreground text-sm">No flow-enabled nodes found. Flow is driven by explicit next/prev metadata.</p></CardContent></Card>;
  }

  return (
    <div className="space-y-4" data-testid="flow-tab">
      <div className="flex items-center gap-2 mb-2">
        <GitBranch className="h-4 w-4 text-green-600" />
        <span className="text-sm font-semibold">Process Flow</span>
        <span className="text-xs text-muted-foreground">({flowNodes.length} steps)</span>
      </div>

      {startNodes.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Start Here:</p>
          <div className="flex flex-wrap gap-2">
            {startNodes.map(n => (
              <Card key={n.slug} className="cursor-pointer hover:shadow-md transition-shadow bg-green-50 border-green-200" onClick={() => onSelectNode(n.slug)} data-testid={`flow-start-${n.slug}`}>
                <CardContent className="py-2 px-3">
                  <span className="text-xs font-medium text-green-700">{n.title}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {Array.from(lanes.entries()).map(([laneName, laneNodes]) => (
        <div key={laneName}>
          {lanes.size > 1 && <h3 className="text-xs font-semibold text-muted-foreground mb-2">{laneName}</h3>}
          <div className="space-y-2">
            {laneNodes.map((node, idx) => (
              <div key={node.slug} className="flex items-start gap-2">
                <Card className="flex-1 cursor-pointer hover:shadow-md transition-shadow" onClick={() => onSelectNode(node.slug)} data-testid={`flow-node-${node.slug}`}>
                  <CardContent className="py-2 px-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {node.flowStepCode && <Badge variant="outline" className="text-[10px] font-mono">{node.flowStepCode}</Badge>}
                        <span className="text-sm font-medium">{node.title}</span>
                        <Badge variant="outline" className={`text-[10px] ${categoryColors[node.category]}`}>{node.category}</Badge>
                      </div>
                      {node.nextSlugs && node.nextSlugs.length > 0 && (
                        <div className="flex items-center gap-1">
                          {node.nextSlugs.map(ns => {
                            const target = nodeBySlug.get(ns);
                            return (
                              <Button
                                key={ns}
                                size="sm"
                                variant="ghost"
                                className="h-6 text-xs gap-0.5 text-blue-600"
                                onClick={(e) => { e.stopPropagation(); onSelectNode(ns); }}
                                data-testid={`flow-next-${ns}`}
                              >
                                {target?.title || ns} <ArrowRight className="h-3 w-3" />
                              </Button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function EeInfoPage() {
  const [activeTab, setActiveTab] = useState("graph");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const { data: user } = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const userRole = user?.role || user?.companyRole || null;

  const { data: nodes = [], isLoading: nodesLoading } = useQuery<EeNode[]>({
    queryKey: ["ee-info-nodes"],
    queryFn: async () => {
      const res = await fetch("/api/ee-info/nodes", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch nodes");
      return res.json();
    },
  });

  const { data: graphData, isLoading: graphLoading } = useQuery<{ nodes: EeNode[]; edges: EeEdge[] }>({
    queryKey: ["ee-info-graph"],
    queryFn: async () => {
      const res = await fetch("/api/ee-info/graph", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch graph");
      return res.json();
    },
  });

  const queryClient = useQueryClient();
  const isCOO = userRole === "COO_ADMIN" || userRole === "admin" || userRole === "CEO_ADMIN";

  const alignMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ee-info/post-seed-align", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to run alignment");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ee-info-nodes"] });
      queryClient.invalidateQueries({ queryKey: ["ee-info-graph"] });
      queryClient.invalidateQueries({ queryKey: ["ee-info-flow"] });
    },
  });

  const handleSelectNode = useCallback((slug: string) => {
    setSelectedSlug(slug);
    setActiveTab("detail");
  }, []);

  if (nodesLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="ee-info-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Emergent Energy Info</h1>
          <p className="text-xs text-muted-foreground">{nodes.filter(n => n.status !== "stub").length} pages, {nodes.filter(n => n.status === "stub").length} stubs</p>
        </div>
        {isCOO && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1.5"
            onClick={() => alignMutation.mutate()}
            disabled={alignMutation.isPending}
            data-testid="btn-post-seed-align"
          >
            {alignMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {alignMutation.isPending ? "Aligning..." : "Align Structure"}
          </Button>
        )}
      </div>
      {alignMutation.isSuccess && alignMutation.data && (
        <div className="bg-green-50 border border-green-200 rounded-md px-3 py-2 text-xs text-green-800" data-testid="align-result">
          Alignment complete: {alignMutation.data.created?.length || 0} created, {alignMutation.data.updated?.length || 0} updated.
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="graph" className="gap-1 text-xs" data-testid="tab-graph">
            <Network className="h-3.5 w-3.5" /> Graph
          </TabsTrigger>
          <TabsTrigger value="detail" className="gap-1 text-xs" data-testid="tab-detail">
            <FileText className="h-3.5 w-3.5" /> Detail
          </TabsTrigger>
          <TabsTrigger value="flow" className="gap-1 text-xs" data-testid="tab-flow">
            <GitBranch className="h-3.5 w-3.5" /> Flow
          </TabsTrigger>
        </TabsList>

        <TabsContent value="graph" className="mt-3">
          {graphData && !graphLoading ? (
            <GraphTab nodes={graphData.nodes} edges={graphData.edges} onSelectNode={handleSelectNode} />
          ) : (
            <Card><CardContent className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin" /></CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="detail" className="mt-3">
          <DetailTab nodes={nodes} selectedSlug={selectedSlug} onSelectNode={setSelectedSlug} userRole={userRole} />
        </TabsContent>

        <TabsContent value="flow" className="mt-3">
          <FlowTab nodes={nodes} onSelectNode={handleSelectNode} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
