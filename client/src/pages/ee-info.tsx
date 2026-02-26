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
  Search, Network, FileText, GitBranch, ChevronRight, ChevronDown, ArrowRight,
  Edit2, Save, X, Plus, Minus, Trash2, Loader2, BookOpen, Users, Wrench,
  FileCheck, HelpCircle, Circle, RefreshCw, Shield, Zap, GraduationCap,
  Clock, ExternalLink, CheckCircle2, CircleDot, Lightbulb,
} from "lucide-react";
import { useLocation } from "wouter";
import { WALKTHROUGHS, WALKTHROUGH_CATEGORIES, type Walkthrough } from "@/data/walkthroughs";

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

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem('auth_token');
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...opts,
    credentials: "include",
    headers: { ...authHeaders(), ...(opts.headers || {}) },
  });
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

const graphNodeGlow: Record<string, string> = {
  role: "rgba(59,130,246,0.5)",
  process: "rgba(34,197,94,0.5)",
  tool: "rgba(168,85,247,0.5)",
  template: "rgba(245,158,11,0.5)",
  governance: "rgba(239,68,68,0.5)",
  other: "rgba(100,116,139,0.4)",
  unknown: "rgba(156,163,175,0.3)",
};

function GraphTab({ nodes, edges, onSelectNode, userRole }: { nodes: EeNode[]; edges: EeEdge[]; onSelectNode: (slug: string) => void; userRole: string | null }) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<EeNode | null>(null);
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState("process");
  const [newContent, setNewContent] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editNodeDetail, setEditNodeDetail] = useState<EeNodeDetail | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const isCOO = userRole === "COO_ADMIN" || userRole === "admin" || userRole === "CEO_ADMIN";

  const VB_W = 2000;
  const VB_H = 1500;

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
    if (filtered.length === 0) { setPositions(new Map()); return; }
    const pos = new Map<string, { x: number; y: number }>();
    const width = VB_W;
    const height = VB_H;
    const cats = [...new Set(filtered.map(n => n.category))];

    filtered.forEach((n) => {
      const catIdx = cats.indexOf(n.category);
      const nodesInCat = filtered.filter(nn => nn.category === n.category);
      const idxInCat = nodesInCat.indexOf(n);
      const angle = (2 * Math.PI * idxInCat) / Math.max(nodesInCat.length, 1);
      const catAngle = (2 * Math.PI * catIdx) / Math.max(cats.length, 1);
      const catRadius = Math.min(width, height) * 0.3;
      const nodeRadius = 60 + nodesInCat.length * 14;
      const cx = width / 2 + Math.cos(catAngle) * catRadius;
      const cy = height / 2 + Math.sin(catAngle) * catRadius;
      pos.set(n.id, {
        x: cx + Math.cos(angle) * nodeRadius,
        y: cy + Math.sin(angle) * nodeRadius,
      });
    });

    for (let iter = 0; iter < 100; iter++) {
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
          const repulsion = 30000 / (dist * dist);
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
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const spring = (dist - 250) * 0.005;
        const fa = forces.get(e.fromNodeId)!;
        const fb = forces.get(e.toNodeId)!;
        if (fa) { fa.fx += (dx / dist) * spring; fa.fy += (dy / dist) * spring; }
        if (fb) { fb.fx -= (dx / dist) * spring; fb.fy -= (dy / dist) * spring; }
      });

      filtered.forEach(n => {
        const p = pos.get(n.id)!;
        const f = forces.get(n.id)!;
        p.x += Math.max(-10, Math.min(10, f.fx));
        p.y += Math.max(-10, Math.min(10, f.fy));
        p.x = Math.max(100, Math.min(width - 100, p.x));
        p.y = Math.max(100, Math.min(height - 100, p.y));
      });
    }

    setPositions(pos);
  }, [filtered, filteredEdges]);

  const categories = useMemo(() => [...new Set(nodes.map(n => n.category))].sort(), [nodes]);

  const hoveredConnectedIds = useMemo(() => {
    if (!hoveredNode) return new Set<string>();
    const ids = new Set<string>();
    ids.add(hoveredNode);
    edges.forEach(e => {
      if (e.fromNodeId === hoveredNode) ids.add(e.toNodeId);
      if (e.toNodeId === hoveredNode) ids.add(e.fromNodeId);
    });
    return ids;
  }, [hoveredNode, edges]);

  const hoveredEdgeIds = useMemo(() => {
    if (!hoveredNode) return new Set<string>();
    const ids = new Set<string>();
    edges.forEach(e => {
      if (e.fromNodeId === hoveredNode || e.toNodeId === hoveredNode) ids.add(e.id);
    });
    return ids;
  }, [hoveredNode, edges]);

  const createMutation = useMutation({
    mutationFn: async (data: { title: string; category: string; contentMarkdown: string }) => {
      const res = await authFetch("/api/ee-info/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create node");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ee-info-nodes"] });
      queryClient.invalidateQueries({ queryKey: ["ee-info-graph"] });
      setShowCreateDialog(false);
      setNewTitle("");
      setNewCategory("process");
      setNewContent("");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await authFetch(`/api/ee-info/nodes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ee-info-nodes"] });
      queryClient.invalidateQueries({ queryKey: ["ee-info-graph"] });
      queryClient.invalidateQueries({ queryKey: ["ee-info-node"] });
      setShowEditDialog(false);
      setSelectedNode(null);
      setEditNodeDetail(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`/api/ee-info/nodes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete node");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ee-info-nodes"] });
      queryClient.invalidateQueries({ queryKey: ["ee-info-graph"] });
      queryClient.invalidateQueries({ queryKey: ["ee-info-node"] });
      setShowDeleteDialog(false);
      setSelectedNode(null);
    },
  });

  const handleNodeClick = (node: EeNode) => {
    if (selectedNode?.id === node.id) {
      setSelectedNode(null);
    } else {
      setSelectedNode(node);
    }
  };

  const openEditDialog = async (node: EeNode) => {
    try {
      const res = await authFetch(`/api/ee-info/nodes/${node.slug}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const detail = await res.json();
      setEditNodeDetail(detail);
      setEditTitle(detail.title);
      setEditCategory(detail.category);
      setEditContent(detail.contentMarkdown || "");
      setShowEditDialog(true);
    } catch {
      setEditTitle(node.title);
      setEditCategory(node.category);
      setEditContent(node.contentMarkdown || "");
      setEditNodeDetail(null);
      setShowEditDialog(true);
    }
  };

  const connectedEdges = useMemo(() => {
    if (!selectedNode) return [];
    return edges.filter(e => e.fromNodeId === selectedNode.id || e.toNodeId === selectedNode.id);
  }, [selectedNode, edges]);

  const connectedNodes = useMemo(() => {
    if (!selectedNode) return [];
    const ids = new Set<string>();
    connectedEdges.forEach(e => {
      if (e.fromNodeId !== selectedNode.id) ids.add(e.fromNodeId);
      if (e.toNodeId !== selectedNode.id) ids.add(e.toNodeId);
    });
    return nodes.filter(n => ids.has(n.id));
  }, [selectedNode, connectedEdges, nodes]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(prev => Math.max(0.3, Math.min(3, prev * delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0 && !(e.target as HTMLElement).closest("g")) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
  }, [panOffset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setPanOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    }
  }, [isPanning, panStart]);

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  const resetView = useCallback(() => { setZoom(1); setPanOffset({ x: 0, y: 0 }); }, []);

  const activeNodeId = hoveredNode || selectedNode?.id || null;

  return (
    <div className="space-y-0" data-testid="graph-tab">
      <div className="flex items-center gap-2 flex-wrap px-1 py-2 bg-gradient-to-r from-slate-900/5 via-transparent to-slate-900/5 rounded-t-xl border-b border-slate-200/80">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <Input placeholder="Search nodes..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-xs bg-white/80 backdrop-blur-sm border-slate-200" data-testid="graph-search" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[150px] h-8 text-xs bg-white/80 backdrop-blur-sm" data-testid="graph-category-filter">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(c => (
              <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1 bg-white/80" onClick={resetView} data-testid="graph-btn-reset">
          <RefreshCw className="h-3 w-3" /> Reset View
        </Button>
        {isCOO && (
          <Button size="sm" className="h-8 text-xs gap-1 bg-indigo-600 hover:bg-indigo-700 text-white" onClick={() => setShowCreateDialog(true)} data-testid="graph-btn-create">
            <Plus className="h-3.5 w-3.5" /> Add Node
          </Button>
        )}
        <div className="flex gap-2 ml-auto items-center">
          {Object.entries(graphNodeColors).filter(([k]) => k !== "unknown").map(([cat, color]) => (
            <button
              key={cat}
              className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border transition-all ${categoryFilter === cat ? "bg-white shadow-sm border-slate-300 font-semibold" : "border-transparent text-slate-500 hover:text-slate-700"}`}
              onClick={() => setCategoryFilter(categoryFilter === cat ? "all" : cat)}
              data-testid={`graph-legend-${cat}`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}40` }} />
              <span className="capitalize">{cat}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-0 relative">
        <div
          ref={svgContainerRef}
          className="flex-1 min-w-0 rounded-b-xl overflow-hidden relative"
          style={{ height: "calc(100vh - 220px)", minHeight: 500, background: "linear-gradient(135deg, #0f172a 0%, #1e293b 40%, #0f172a 100%)" }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ opacity: 0.06 }}>
            <svg width="100%" height="100%"><defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="#94a3b8" strokeWidth="0.5" /></pattern></defs><rect width="100%" height="100%" fill="url(#grid)" /></svg>
          </div>

          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            className="w-full h-full"
            style={{ cursor: isPanning ? "grabbing" : "grab", transform: `scale(${zoom}) translate(${panOffset.x / zoom}px, ${panOffset.y / zoom}px)`, transformOrigin: "center center", transition: isPanning ? "none" : "transform 0.1s ease-out" }}
            data-testid="graph-canvas"
          >
            <defs>
              {Object.entries(graphNodeColors).map(([cat, color]) => (
                <radialGradient key={cat} id={`glow-${cat}`} cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor={color} stopOpacity="0.8" />
                  <stop offset="100%" stopColor={color} stopOpacity="0" />
                </radialGradient>
              ))}
              <filter id="node-glow">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <filter id="edge-glow">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {positions.size > 0 && filteredEdges.map(e => {
              const from = positions.get(e.fromNodeId);
              const to = positions.get(e.toNodeId);
              if (!from || !to) return null;
              const isHoverHighlight = hoveredEdgeIds.has(e.id);
              const isSelectedHighlight = selectedNode && (e.fromNodeId === selectedNode.id || e.toNodeId === selectedNode.id);
              const isActive = isHoverHighlight || isSelectedHighlight;
              const dimmed = activeNodeId && !isActive;
              const fromColor = graphNodeColors[filtered.find(n => n.id === e.fromNodeId)?.category || "unknown"] || "#9ca3af";
              const toColor = graphNodeColors[filtered.find(n => n.id === e.toNodeId)?.category || "unknown"] || "#9ca3af";
              const gradId = `edge-grad-${e.id}`;
              return (
                <React.Fragment key={e.id}>
                  {isActive && (
                    <line
                      x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                      stroke={isHoverHighlight ? "#06b6d4" : "#3b82f6"}
                      strokeWidth={6}
                      opacity={0.25}
                      filter="url(#edge-glow)"
                    />
                  )}
                  <defs>
                    <linearGradient id={gradId} x1={from.x} y1={from.y} x2={to.x} y2={to.y} gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor={isActive ? (isHoverHighlight ? "#06b6d4" : "#60a5fa") : fromColor} />
                      <stop offset="100%" stopColor={isActive ? (isHoverHighlight ? "#06b6d4" : "#60a5fa") : toColor} />
                    </linearGradient>
                  </defs>
                  <line
                    x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    stroke={`url(#${gradId})`}
                    strokeWidth={isActive ? 2.5 : 0.8}
                    opacity={dimmed ? 0.08 : (isActive ? 0.9 : 0.2)}
                    style={{ transition: "opacity 0.3s, stroke-width 0.3s" }}
                  />
                </React.Fragment>
              );
            })}

            {positions.size > 0 && filtered.map(n => {
              const p = positions.get(n.id);
              if (!p) return null;
              const color = graphNodeColors[n.category] || "#9ca3af";
              const glow = graphNodeGlow[n.category] || "rgba(156,163,175,0.3)";
              const isHovered = hoveredNode === n.id;
              const isSelected = selectedNode?.id === n.id;
              const isHoverConnected = hoveredConnectedIds.has(n.id);
              const isSelectedConnected = selectedNode && connectedNodes.some(cn => cn.id === n.id);
              const isActive = isHovered || isSelected || isHoverConnected || isSelectedConnected;
              const dimmed = activeNodeId && !isActive;
              const baseR = n.status === "stub" ? 7 : 11;
              const radius = isSelected ? 18 : (isHovered ? 16 : (isHoverConnected ? 14 : baseR));
              const label = n.title.length > 28 ? n.title.slice(0, 26) + "..." : n.title;
              return (
                <g
                  key={n.id}
                  onClick={() => handleNodeClick(n)}
                  onMouseEnter={() => setHoveredNode(n.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{ cursor: "pointer", transition: "opacity 0.3s" }}
                  opacity={dimmed ? 0.12 : 1}
                >
                  {(isActive) && (
                    <circle cx={p.x} cy={p.y} r={radius + 18} fill={`url(#glow-${n.category})`} opacity={0.5} />
                  )}
                  {isSelected && (
                    <circle
                      cx={p.x} cy={p.y} r={radius + 6}
                      fill="none" stroke="#06b6d4" strokeWidth={1.5}
                      strokeDasharray="6 3"
                      style={{ animation: "spin 8s linear infinite", transformOrigin: `${p.x}px ${p.y}px` }}
                    />
                  )}
                  {isHoverConnected && !isHovered && !isSelected && (
                    <circle cx={p.x} cy={p.y} r={radius + 4} fill="none" stroke="#06b6d4" strokeWidth={1} opacity={0.6} />
                  )}
                  <circle
                    cx={p.x} cy={p.y} r={radius}
                    fill={n.status === "stub" ? color + "55" : color}
                    stroke={isSelected ? "#06b6d4" : (isHovered ? "#e2e8f0" : color + "88")}
                    strokeWidth={isSelected ? 3 : (isHovered ? 2 : 1)}
                    filter={isActive ? "url(#node-glow)" : undefined}
                    style={{ transition: "r 0.2s, stroke-width 0.2s" }}
                  />
                  <text
                    x={p.x} y={p.y + radius + 16}
                    textAnchor="middle"
                    fill={dimmed ? "#475569" : (isActive ? "#e2e8f0" : "#94a3b8")}
                    fontSize={isActive ? 13 : 11}
                    fontWeight={isActive ? 600 : 400}
                    fontFamily="system-ui, -apple-system, sans-serif"
                    style={{ transition: "fill 0.3s, font-size 0.2s", textShadow: isActive ? "0 0 8px rgba(6,182,212,0.4)" : "none" }}
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </svg>

          <div className="absolute bottom-3 left-3 flex items-center gap-1.5 bg-slate-900/70 backdrop-blur-md rounded-lg px-3 py-1.5 border border-slate-700/50">
            <span className="text-[11px] text-slate-400 font-mono">{filtered.length} nodes</span>
            <span className="text-slate-600">|</span>
            <span className="text-[11px] text-slate-400 font-mono">{filteredEdges.length} edges</span>
            <span className="text-slate-600">|</span>
            <span className="text-[11px] text-slate-400 font-mono">{Math.round(zoom * 100)}%</span>
          </div>

          <div className="absolute bottom-3 right-3 flex gap-1">
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 bg-slate-900/70 backdrop-blur-md border border-slate-700/50 text-slate-300 hover:text-white hover:bg-slate-800/80" onClick={() => setZoom(z => Math.min(3, z * 1.2))} data-testid="graph-zoom-in">
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 bg-slate-900/70 backdrop-blur-md border border-slate-700/50 text-slate-300 hover:text-white hover:bg-slate-800/80" onClick={() => setZoom(z => Math.max(0.3, z * 0.8))} data-testid="graph-zoom-out">
              <Minus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {selectedNode && (
          <div className="w-80 shrink-0 bg-slate-900/95 backdrop-blur-xl border-l border-slate-700/50 overflow-y-auto" style={{ height: "calc(100vh - 220px)", minHeight: 500 }} data-testid="graph-node-panel">
            <div className="p-4 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-white truncate">{selectedNode.title}</h3>
                  <Badge className={`mt-1.5 text-[10px] ${categoryColors[selectedNode.category] || ""}`}>
                    {selectedNode.category}
                  </Badge>
                </div>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-slate-400 hover:text-white shrink-0" onClick={() => setSelectedNode(null)} data-testid="graph-panel-close">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>

              {selectedNode.contentMarkdown ? (
                <p className="text-xs text-slate-400 line-clamp-5 leading-relaxed">
                  {selectedNode.contentMarkdown.replace(/[#*\[\]]/g, "").slice(0, 250)}
                </p>
              ) : (
                <p className="text-xs text-slate-500 italic">No content yet.</p>
              )}

              {connectedNodes.length > 0 && (
                <div>
                  <p className="text-[11px] font-medium text-slate-300 mb-2">{connectedNodes.length} connected node{connectedNodes.length !== 1 ? "s" : ""}</p>
                  <div className="space-y-1">
                    {connectedNodes.slice(0, 10).map(cn => (
                      <button
                        key={cn.id}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left hover:bg-slate-800/80 transition-colors group"
                        onClick={() => handleNodeClick(cn)}
                        data-testid={`graph-panel-link-${cn.slug}`}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: graphNodeColors[cn.category] || "#9ca3af", boxShadow: `0 0 4px ${graphNodeColors[cn.category] || "#9ca3af"}44` }} />
                        <span className="text-xs text-slate-300 group-hover:text-white truncate flex-1">
                          {cn.title.length > 25 ? cn.title.slice(0, 23) + "..." : cn.title}
                        </span>
                        <ChevronRight className="h-3 w-3 text-slate-600 group-hover:text-slate-400 shrink-0" />
                      </button>
                    ))}
                    {connectedNodes.length > 10 && (
                      <p className="text-[10px] text-slate-500 pl-2.5">+{connectedNodes.length - 10} more</p>
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-700/50">
                <Button size="sm" className="w-full h-8 text-xs gap-1.5 bg-cyan-600 hover:bg-cyan-700 text-white" onClick={() => onSelectNode(selectedNode.slug)} data-testid="graph-panel-view-detail">
                  <FileText className="h-3.5 w-3.5" /> View Details
                </Button>
                {isCOO && (
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" className="flex-1 h-8 text-xs gap-1 border-slate-600 text-slate-300 hover:bg-slate-800 hover:text-white" onClick={() => openEditDialog(selectedNode)} data-testid="graph-panel-edit">
                      <Edit2 className="h-3 w-3" /> Edit
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 w-8 p-0 border-red-800/50 text-red-400 hover:bg-red-900/30 hover:text-red-300" onClick={() => setShowDeleteDialog(true)} data-testid="graph-panel-delete">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Node</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Title</label>
              <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Node title..." className="h-8 text-sm" data-testid="graph-create-title" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Category</label>
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger className="h-8 text-sm" data-testid="graph-create-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["role", "process", "governance", "tool", "template", "other"].map(c => (
                    <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Content (Markdown)</label>
              <Textarea value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="Enter content..." className="min-h-[120px] font-mono text-xs" data-testid="graph-create-content" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={() => createMutation.mutate({ title: newTitle, category: newCategory, contentMarkdown: newContent })} disabled={!newTitle.trim() || createMutation.isPending} data-testid="graph-create-submit">
              {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={(open) => { if (!open) { setShowEditDialog(false); setEditNodeDetail(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Node</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Title</label>
              <Input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="h-8 text-sm" data-testid="graph-edit-title" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Category</label>
              <Select value={editCategory} onValueChange={setEditCategory}>
                <SelectTrigger className="h-8 text-sm" data-testid="graph-edit-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["role", "process", "governance", "tool", "template", "other", "unknown"].map(c => (
                    <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Content (Markdown)</label>
              <Textarea value={editContent} onChange={e => setEditContent(e.target.value)} className="min-h-[200px] font-mono text-xs" data-testid="graph-edit-content" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => { setShowEditDialog(false); setEditNodeDetail(null); }}>Cancel</Button>
            <Button size="sm" onClick={() => {
              const id = editNodeDetail?.id || selectedNode?.id;
              if (!id) return;
              updateMutation.mutate({ id, data: { title: editTitle, contentMarkdown: editContent, category: editCategory } });
            }} disabled={!editTitle.trim() || updateMutation.isPending} data-testid="graph-edit-submit">
              {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Node</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{selectedNode?.title}</strong>? This will also remove all edges and assets linked to this node. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button size="sm" variant="destructive" onClick={() => selectedNode && deleteMutation.mutate(selectedNode.id)} disabled={deleteMutation.isPending} data-testid="graph-delete-confirm">
              {deleteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState("process");
  const [newContent, setNewContent] = useState("");
  const queryClient = useQueryClient();
  const isCOO = userRole === "COO_ADMIN" || userRole === "admin" || userRole === "CEO_ADMIN";

  const { data: nodeDetail, isLoading } = useQuery<EeNodeDetail>({
    queryKey: ["ee-info-node", selectedSlug],
    queryFn: async () => {
      const res = await authFetch(`/api/ee-info/nodes/${selectedSlug}`);
      if (!res.ok) throw new Error("Failed to fetch node");
      return res.json();
    },
    enabled: !!selectedSlug,
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await authFetch(`/api/ee-info/nodes/${nodeDetail!.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ee-info-node", selectedSlug] });
      queryClient.invalidateQueries({ queryKey: ["ee-info-nodes"] });
      queryClient.invalidateQueries({ queryKey: ["ee-info-graph"] });
      setEditMode(false);
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { title: string; category: string; contentMarkdown: string }) => {
      const res = await authFetch("/api/ee-info/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create node");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ee-info-nodes"] });
      queryClient.invalidateQueries({ queryKey: ["ee-info-graph"] });
      setShowCreateDialog(false);
      setNewTitle("");
      setNewCategory("process");
      setNewContent("");
      onSelectNode(data.slug);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`/api/ee-info/nodes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete node");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ee-info-nodes"] });
      queryClient.invalidateQueries({ queryKey: ["ee-info-graph"] });
      setShowDeleteDialog(false);
      onSelectNode("");
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
        <div className="flex gap-1 mb-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Search pages..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-xs" data-testid="detail-search" />
          </div>
          {isCOO && (
            <Button size="sm" variant="outline" className="h-8 w-8 p-0 shrink-0" onClick={() => setShowCreateDialog(true)} title="Create new node" data-testid="btn-create-node">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          )}
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
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setEditMode(true); setEditContent(nodeDetail.contentMarkdown || ""); setEditCategory(nodeDetail.category); setEditResponsibleRole(nodeDetail.responsibleRole || ""); setEditEscalationRole(nodeDetail.escalationRole || ""); setEditGateConditions((nodeDetail.gateConditions || []).join("\n")); setEditBlockingConditions((nodeDetail.blockingConditions || []).join("\n")); }} data-testid="detail-edit-btn">
                      <Edit2 className="h-3 w-3" /> Edit
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setShowDeleteDialog(true)} data-testid="detail-delete-btn">
                      <Trash2 className="h-3 w-3" /> Delete
                    </Button>
                  </div>
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

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Node</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Title</label>
              <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Node title..." className="h-8 text-sm" data-testid="create-node-title" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Category</label>
              <Select value={newCategory} onValueChange={setNewCategory}>
                <SelectTrigger className="h-8 text-sm" data-testid="create-node-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["role", "process", "governance", "tool", "template", "other"].map(c => (
                    <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Content (Markdown)</label>
              <Textarea value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="Enter content..." className="min-h-[120px] font-mono text-xs" data-testid="create-node-content" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={() => createMutation.mutate({ title: newTitle, category: newCategory, contentMarkdown: newContent })} disabled={!newTitle.trim() || createMutation.isPending} data-testid="create-node-submit">
              {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Node</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{nodeDetail?.title}</strong>? This will also remove all edges and assets linked to this node. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button size="sm" variant="destructive" onClick={() => nodeDetail && deleteMutation.mutate(nodeDetail.id)} disabled={deleteMutation.isPending} data-testid="delete-node-confirm">
              {deleteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FlowTab({ nodes, onSelectNode }: { nodes: EeNode[]; onSelectNode: (slug: string) => void }) {
  const { data: flowNodes = [], isLoading } = useQuery<EeNode[]>({
    queryKey: ["ee-info-flow"],
    queryFn: async () => {
      const res = await authFetch("/api/ee-info/flow");
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

function WalkthroughTab() {
  const [, navigate] = useLocation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [completedSteps, setCompletedSteps] = useState<Record<string, Set<number>>>(() => {
    try {
      const saved = localStorage.getItem("walkthrough-progress");
      if (saved) {
        const parsed = JSON.parse(saved);
        const result: Record<string, Set<number>> = {};
        for (const [k, v] of Object.entries(parsed)) {
          result[k] = new Set(v as number[]);
        }
        return result;
      }
    } catch {}
    return {};
  });
  const [expandedTips, setExpandedTips] = useState<Set<string>>(new Set());

  const saveProgress = useCallback((walkthroughId: string, stepNum: number, checked: boolean) => {
    setCompletedSteps(prev => {
      const next = { ...prev };
      const steps = new Set(prev[walkthroughId] || []);
      if (checked) steps.add(stepNum);
      else steps.delete(stepNum);
      next[walkthroughId] = steps;
      const toSave: Record<string, number[]> = {};
      for (const [k, v] of Object.entries(next)) {
        toSave[k] = Array.from(v);
      }
      localStorage.setItem("walkthrough-progress", JSON.stringify(toSave));
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    let items = WALKTHROUGHS;
    if (categoryFilter !== "all") items = items.filter(w => w.category === categoryFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(w =>
        w.title.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q)
      );
    }
    return items;
  }, [categoryFilter, search]);

  const selected = selectedId ? WALKTHROUGHS.find(w => w.id === selectedId) : null;

  const toggleTip = (key: string) => {
    setExpandedTips(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (selected) {
    const stepsCompleted = completedSteps[selected.id]?.size || 0;
    const totalSteps = selected.steps.length;
    const pct = Math.round((stepsCompleted / totalSteps) * 100);
    const catConfig = WALKTHROUGH_CATEGORIES[selected.category];

    return (
      <div className="space-y-4" data-testid="walkthrough-detail">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={() => setSelectedId(null)} data-testid="walkthrough-back">
            <ChevronRight className="h-3.5 w-3.5 rotate-180" /> Back to all walkthroughs
          </Button>
        </div>

        <Card className="shadow-sm overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-slate-50 to-white border-b px-6 py-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className={`text-[10px] ${catConfig?.color || ""}`}>
                    {catConfig?.label || selected.category}
                  </Badge>
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <Clock className="h-3 w-3" /> ~{selected.estimatedMinutes} min
                  </span>
                </div>
                <CardTitle className="text-xl font-bold tracking-tight">{selected.title}</CardTitle>
                <p className="text-sm text-slate-500 mt-1">{selected.description}</p>
              </div>
              <div className="text-right shrink-0 ml-4">
                <p className="text-2xl font-bold font-mono text-slate-900">{pct}%</p>
                <p className="text-xs text-slate-400">{stepsCompleted}/{totalSteps} steps</p>
              </div>
            </div>
            <div className="mt-3 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-100">
              {selected.steps.map((step) => {
                const isCompleted = completedSteps[selected.id]?.has(step.stepNumber) || false;
                const tipKey = `${selected.id}-${step.stepNumber}`;
                const tipExpanded = expandedTips.has(tipKey);

                return (
                  <div key={step.stepNumber} className={`px-6 py-4 transition-colors ${isCompleted ? "bg-green-50/30" : "bg-white"}`} data-testid={`walkthrough-step-${step.stepNumber}`}>
                    <div className="flex items-start gap-4">
                      <button
                        type="button"
                        className="mt-0.5 shrink-0"
                        onClick={() => saveProgress(selected.id, step.stepNumber, !isCompleted)}
                        data-testid={`walkthrough-check-${step.stepNumber}`}
                      >
                        {isCompleted ? (
                          <CheckCircle2 className="h-6 w-6 text-green-600" />
                        ) : (
                          <CircleDot className="h-6 w-6 text-slate-300 hover:text-slate-400 transition-colors" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-slate-800 text-white text-[10px] font-bold shrink-0">
                            {step.stepNumber}
                          </span>
                          <h4 className={`text-sm font-semibold ${isCompleted ? "text-green-700 line-through decoration-green-300" : "text-slate-900"}`}>
                            {step.title}
                          </h4>
                        </div>
                        <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line ml-7">{step.description}</p>

                        {step.tip && (
                          <div className="ml-7 mt-2">
                            <button
                              type="button"
                              className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 transition-colors"
                              onClick={() => toggleTip(tipKey)}
                              data-testid={`walkthrough-tip-toggle-${step.stepNumber}`}
                            >
                              <Lightbulb className="h-3 w-3" />
                              {tipExpanded ? "Hide tip" : "Show tip"}
                            </button>
                            {tipExpanded && (
                              <div className="mt-1.5 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 leading-relaxed">
                                {step.tip}
                              </div>
                            )}
                          </div>
                        )}

                        {step.targetPage && (
                          <div className="ml-7 mt-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1 text-blue-600 border-blue-200 hover:bg-blue-50"
                              onClick={() => navigate(step.targetPage!)}
                              data-testid={`walkthrough-goto-${step.stepNumber}`}
                            >
                              <ExternalLink className="h-3 w-3" /> Go to page
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const categories = ["all", ...Object.keys(WALKTHROUGH_CATEGORIES)];

  return (
    <div className="space-y-4" data-testid="walkthrough-tab">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search walkthroughs..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
            data-testid="walkthrough-search"
          />
        </div>
        <div className="flex gap-1.5">
          {categories.map(cat => {
            const config = cat === "all" ? null : WALKTHROUGH_CATEGORIES[cat];
            const isActive = categoryFilter === cat;
            return (
              <Button
                key={cat}
                size="sm"
                variant={isActive ? "default" : "outline"}
                className={`h-8 text-xs ${!isActive && config ? config.color : ""}`}
                onClick={() => setCategoryFilter(cat)}
                data-testid={`walkthrough-filter-${cat}`}
              >
                {cat === "all" ? "All" : config?.label || cat}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(w => {
          const catConfig = WALKTHROUGH_CATEGORIES[w.category];
          const stepsCompleted = completedSteps[w.id]?.size || 0;
          const pct = Math.round((stepsCompleted / w.steps.length) * 100);
          return (
            <Card
              key={w.id}
              className="shadow-sm hover:shadow-md transition-all cursor-pointer group"
              onClick={() => setSelectedId(w.id)}
              data-testid={`walkthrough-card-${w.id}`}
            >
              <CardContent className="pt-5 pb-4 px-5">
                <div className="flex items-start justify-between mb-3">
                  <Badge variant="outline" className={`text-[10px] ${catConfig?.color || ""}`}>
                    {catConfig?.label || w.category}
                  </Badge>
                  <span className="flex items-center gap-1 text-xs text-slate-400">
                    <Clock className="h-3 w-3" /> {w.estimatedMinutes} min
                  </span>
                </div>
                <h3 className="font-semibold text-sm text-slate-900 group-hover:text-blue-600 transition-colors mb-1.5">
                  {w.title}
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 mb-3">
                  {w.description}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">{w.steps.length} steps</span>
                  {stepsCompleted > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] text-green-600 font-medium">{pct}%</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">No walkthroughs match your search.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function EeInfoPage() {
  const [activeTab, setActiveTab] = useState("graph");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const { data: user } = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const res = await authFetch("/api/auth/me");
      if (!res.ok) return null;
      return res.json();
    },
  });

  const userRole = user?.role || user?.companyRole || null;

  const { data: nodes = [], isLoading: nodesLoading } = useQuery<EeNode[]>({
    queryKey: ["ee-info-nodes"],
    queryFn: async () => {
      const res = await authFetch("/api/ee-info/nodes");
      if (!res.ok) throw new Error("Failed to fetch nodes");
      return res.json();
    },
  });

  const { data: graphData, isLoading: graphLoading } = useQuery<{ nodes: EeNode[]; edges: EeEdge[] }>({
    queryKey: ["ee-info-graph"],
    queryFn: async () => {
      const res = await authFetch("/api/ee-info/graph");
      if (!res.ok) throw new Error("Failed to fetch graph");
      return res.json();
    },
  });

  const queryClient = useQueryClient();
  const isCOO = userRole === "COO_ADMIN" || userRole === "admin" || userRole === "CEO_ADMIN";

  const alignMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/ee-info/post-seed-align", {
        method: "POST",
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
          <TabsTrigger value="walkthroughs" className="gap-1 text-xs" data-testid="tab-walkthroughs">
            <GraduationCap className="h-3.5 w-3.5" /> Walkthroughs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="graph" className="mt-3">
          {graphData && !graphLoading ? (
            <GraphTab nodes={graphData.nodes} edges={graphData.edges} onSelectNode={handleSelectNode} userRole={userRole} />
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

        <TabsContent value="walkthroughs" className="mt-3">
          <WalkthroughTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
