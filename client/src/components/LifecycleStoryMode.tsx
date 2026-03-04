import React, { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ChevronRight, ChevronDown, ChevronLeft, ArrowRight, ArrowLeft,
  Loader2, Play, BookOpen, Map, Lightbulb, ExternalLink,
  CheckCircle2, CircleDot, AlertTriangle, FileText, FolderOpen,
  Users, Target, Wrench, Shield, Clock, Zap, Baby,
  LayoutList, ChevronUp, Link2, Award, GraduationCap,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

interface StoryNode {
  id: string;
  slug: string;
  title: string;
  contentMarkdown?: string;
  nodeType: string;
  stageCode?: string;
  sortOrder: number;
  status: string;
  parentNodeId?: string;
  nextNodeId?: string;
  primaryInstruction?: string;
  definitionOfDone?: string;
  ownerRoleId?: string;
  approverRoleId?: string;
  requiredLinks?: { label: string; url: string; type?: string }[];
  exampleArtifacts?: { label: string; url: string }[];
  exampleNotes?: string;
  commonPitfalls?: string[];
  sopData?: {
    purpose?: string;
    inputs?: string[];
    outputs?: string[];
    raci?: any[];
    tools?: { name: string; url?: string; type?: string }[];
    templates?: { name: string; slug?: string; url?: string }[];
  };
  childCount?: number;
  completedCount?: number;
  progressPct?: number;
  readyStatus?: string;
}

interface LifecycleStoryModeProps {
  isCOO: boolean;
  onOpenExploreMode?: (nodeId?: string) => void;
}

const STAGE_COLORS = [
  { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", accent: "bg-blue-500", light: "bg-blue-100" },
  { bg: "bg-indigo-50", border: "border-indigo-200", text: "text-indigo-700", accent: "bg-indigo-500", light: "bg-indigo-100" },
  { bg: "bg-violet-50", border: "border-violet-200", text: "text-violet-700", accent: "bg-violet-500", light: "bg-violet-100" },
  { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", accent: "bg-amber-500", light: "bg-amber-100" },
  { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", accent: "bg-emerald-500", light: "bg-emerald-100" },
  { bg: "bg-cyan-50", border: "border-cyan-200", text: "text-cyan-700", accent: "bg-cyan-500", light: "bg-cyan-100" },
  { bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-700", accent: "bg-rose-500", light: "bg-rose-100" },
  { bg: "bg-teal-50", border: "border-teal-200", text: "text-teal-700", accent: "bg-teal-500", light: "bg-teal-100" },
];

export default function LifecycleStoryMode({ isCOO, onOpenExploreMode }: LifecycleStoryModeProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [breadcrumb, setBreadcrumb] = useState<{ id: string; title: string }[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  const [demoIndex, setDemoIndex] = useState(0);
  const [newbieMode, setNewbieMode] = useState(() => {
    const stored = localStorage.getItem("ee-story-newbie-mode");
    if (stored !== null) return stored === "true";
    return !isCOO;
  });
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("ee-story-newbie-mode", String(newbieMode));
  }, [newbieMode]);

  const { data: stages = [], isLoading: stagesLoading } = useQuery<StoryNode[]>({
    queryKey: ["ee-info-story-stages"],
    queryFn: async () => {
      const res = await authFetch("/api/ee-info/story/stages");
      if (!res.ok) throw new Error("Failed to fetch stages");
      return res.json();
    },
  });

  const { data: seedStatus } = useQuery<{ hasStages: boolean; hasDemoData: boolean }>({
    queryKey: ["ee-info-story-seed-status"],
    queryFn: async () => {
      const res = await authFetch("/api/ee-info/story/check-seed");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const autoSeedMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/ee-info/story/auto-seed", { method: "POST" });
      if (!res.ok) throw new Error("Failed to seed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ee-info-story-stages"] });
      queryClient.invalidateQueries({ queryKey: ["ee-info-story-seed-status"] });
      toast({ title: "Lifecycle Data Seeded", description: "Story mode stages and processes created." });
    },
  });

  const seedDemoMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch("/api/ee-info/story/seed-demo", { method: "POST" });
      if (!res.ok) throw new Error("Failed to seed demo");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ee-info-story-demo"] });
      queryClient.invalidateQueries({ queryKey: ["ee-info-story-seed-status"] });
      toast({ title: "Demo Walkthrough Seeded", description: "15 demo steps created." });
    },
  });

  useEffect(() => {
    if (seedStatus && !seedStatus.hasStages && !autoSeedMutation.isPending) {
      autoSeedMutation.mutate();
    }
  }, [seedStatus]);

  const { data: nodeDetail, isLoading: nodeLoading } = useQuery({
    queryKey: ["ee-info-story-node", selectedNodeId],
    queryFn: async () => {
      const res = await authFetch(`/api/ee-info/story/node/${selectedNodeId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!selectedNodeId && !demoMode,
  });

  const { data: children = [], isLoading: childrenLoading } = useQuery<StoryNode[]>({
    queryKey: ["ee-info-story-children", selectedNodeId],
    queryFn: async () => {
      const res = await authFetch(`/api/ee-info/story/children/${selectedNodeId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!selectedNodeId && !demoMode,
  });

  const { data: demoNodes = [] } = useQuery<StoryNode[]>({
    queryKey: ["ee-info-story-demo"],
    queryFn: async () => {
      const res = await authFetch("/api/ee-info/story/demo");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: demoMode,
  });

  const selectNode = useCallback((id: string, title: string) => {
    setSelectedNodeId(id);
    setBreadcrumb(prev => {
      const existing = prev.findIndex(b => b.id === id);
      if (existing >= 0) return prev.slice(0, existing + 1);
      return [...prev, { id, title }];
    });
    setDemoMode(false);
  }, []);

  const navigateBack = useCallback(() => {
    if (breadcrumb.length > 1) {
      const newBc = breadcrumb.slice(0, -1);
      setBreadcrumb(newBc);
      setSelectedNodeId(newBc[newBc.length - 1].id);
    } else {
      setSelectedNodeId(null);
      setBreadcrumb([]);
    }
  }, [breadcrumb]);

  const navigateNext = useCallback(() => {
    if (demoMode) {
      if (demoIndex < demoNodes.length - 1) setDemoIndex(demoIndex + 1);
      return;
    }
    if (nodeDetail?.nextNode) {
      selectNode(nodeDetail.nextNode.id, nodeDetail.nextNode.title);
    }
  }, [demoMode, demoIndex, demoNodes, nodeDetail, selectNode]);

  const navigatePrev = useCallback(() => {
    if (demoMode) {
      if (demoIndex > 0) setDemoIndex(demoIndex - 1);
      return;
    }
    if (nodeDetail?.prevNode) {
      selectNode(nodeDetail.prevNode.id, nodeDetail.prevNode.title);
    } else {
      navigateBack();
    }
  }, [demoMode, demoIndex, nodeDetail, selectNode, navigateBack]);

  const startDemo = useCallback(() => {
    if (!seedStatus?.hasDemoData) {
      seedDemoMutation.mutate();
    }
    setDemoMode(true);
    setDemoIndex(0);
    setSelectedNodeId(null);
    setBreadcrumb([]);
  }, [seedStatus, seedDemoMutation]);

  const startTour = useCallback(() => {
    if (stages.length > 0) {
      selectNode(stages[0].id, stages[0].title);
    }
  }, [stages, selectNode]);

  if (stagesLoading || autoSeedMutation.isPending) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="story-loading">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
        <span className="ml-3 text-sm text-muted-foreground">Loading lifecycle map...</span>
      </div>
    );
  }

  const currentDemoNode = demoMode && demoNodes.length > 0 ? demoNodes[demoIndex] : null;
  const node = demoMode ? currentDemoNode : nodeDetail?.node;
  const showEmptyState = !selectedNodeId && !demoMode;

  return (
    <div className="space-y-3" data-testid="lifecycle-story-mode">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {demoMode && (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 gap-1">
              <GraduationCap className="h-3 w-3" /> Demo Walkthrough — Step {demoIndex + 1} of {demoNodes.length}
            </Badge>
          )}
          {breadcrumb.length > 0 && !demoMode && (
            <nav className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="story-breadcrumb">
              <button onClick={() => { setSelectedNodeId(null); setBreadcrumb([]); }} className="hover:text-green-600 transition-colors">
                Lifecycle
              </button>
              {breadcrumb.map((bc, i) => (
                <React.Fragment key={bc.id}>
                  <ChevronRight className="h-3 w-3" />
                  <button
                    onClick={() => { setBreadcrumb(breadcrumb.slice(0, i + 1)); setSelectedNodeId(bc.id); }}
                    className={`hover:text-green-600 transition-colors max-w-[150px] truncate ${i === breadcrumb.length - 1 ? "font-medium text-foreground" : ""}`}
                  >
                    {bc.title}
                  </button>
                </React.Fragment>
              ))}
            </nav>
          )}
        </div>
        <div className="flex items-center gap-3">
          {demoMode && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setDemoMode(false); setSelectedNodeId(null); setBreadcrumb([]); }} data-testid="exit-demo">
              Exit Demo
            </Button>
          )}
          <div className="flex items-center gap-1.5">
            <Baby className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">explain like i'm new</span>
            <Switch
              checked={newbieMode}
              onCheckedChange={setNewbieMode}
              className="data-[state=checked]:bg-green-500 h-4 w-7"
              data-testid="newbie-toggle"
            />
          </div>
        </div>
      </div>

      {showEmptyState && (
        <EmptyState
          onStartTour={startTour}
          onStartDemo={startDemo}
          hasStages={stages.length > 0}
          onSelectStage={(id, title) => selectNode(id, title)}
          stages={stages}
          seedDemoLoading={seedDemoMutation.isPending}
        />
      )}

      {(selectedNodeId || demoMode) && (
        <div className="grid grid-cols-12 gap-3" data-testid="story-panels">
          {!demoMode && (
            <div className="col-span-3 space-y-1.5" data-testid="story-left-panel">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Lifecycle Stages</h3>
              {stages.map((stage, idx) => {
                const color = STAGE_COLORS[idx % STAGE_COLORS.length];
                const isActive = breadcrumb.some(b => b.id === stage.id) || selectedNodeId === stage.id;
                return (
                  <button
                    key={stage.id}
                    onClick={() => selectNode(stage.id, stage.title)}
                    className={`w-full text-left rounded-lg border p-2.5 transition-all ${
                      isActive
                        ? `${color.bg} ${color.border} shadow-sm ring-1 ring-opacity-50`
                        : "border-border bg-card hover:bg-muted"
                    }`}
                    data-testid={`story-stage-${stage.stageCode}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-md ${color.accent} flex items-center justify-center text-white font-bold text-[10px] shrink-0`}>
                        {stage.stageCode}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{stage.title.replace(/^P\d\s*—\s*/, "")}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                            <div className={`h-full ${color.accent} rounded-full transition-all`} style={{ width: `${stage.progressPct || 0}%` }} />
                          </div>
                          <span className="text-[9px] text-muted-foreground">{stage.childCount || 0}</span>
                        </div>
                      </div>
                      <Badge variant="outline" className={`text-[9px] px-1 py-0 ${stage.readyStatus === "Ready" ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-500 border-gray-200"}`}>
                        {stage.readyStatus}
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className={demoMode ? "col-span-9" : "col-span-6"} data-testid="story-center-panel">
            {(nodeLoading || childrenLoading) && !demoMode ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-green-600" />
              </div>
            ) : node ? (
              <StepPlayer
                node={node}
                detail={demoMode ? null : nodeDetail?.detail}
                children={demoMode ? [] : children}
                nextNode={demoMode ? (demoIndex < demoNodes.length - 1 ? demoNodes[demoIndex + 1] : null) : nodeDetail?.nextNode}
                prevNode={demoMode ? (demoIndex > 0 ? demoNodes[demoIndex - 1] : null) : nodeDetail?.prevNode}
                newbieMode={newbieMode}
                demoMode={demoMode}
                onNext={navigateNext}
                onPrev={navigatePrev}
                onSelectChild={(id, title) => selectNode(id, title)}
                detailsOpen={detailsOpen}
                setDetailsOpen={setDetailsOpen}
                isCOO={isCOO}
              />
            ) : (
              <div className="text-center py-16 text-muted-foreground text-sm">
                Select a stage from the left to begin.
              </div>
            )}
          </div>

          {!demoMode && (
            <div className="col-span-3 space-y-3" data-testid="story-right-rail">
              {node?.sopData?.tools && node.sopData.tools.length > 0 && (
                <Card className="border-border">
                  <CardContent className="p-3">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1">
                      <Wrench className="h-3 w-3" /> Tools & Docs
                    </h4>
                    <div className="space-y-1">
                      {node.sopData.tools.map((tool: any, i: number) => (
                        <a
                          key={i}
                          href={tool.url || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 hover:underline py-0.5"
                          data-testid={`tool-link-${i}`}
                        >
                          <Link2 className="h-3 w-3 shrink-0" />
                          <span className="truncate">{tool.name}</span>
                        </a>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {nodeDetail?.relatedNodes?.length > 0 && (
                <Card className="border-border">
                  <CardContent className="p-3">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2 flex items-center gap-1">
                      <LayoutList className="h-3 w-3" /> Related
                    </h4>
                    <div className="space-y-1">
                      {nodeDetail.relatedNodes.map((rn: any) => (
                        <button
                          key={rn.id}
                          onClick={() => selectNode(rn.id, rn.title)}
                          className="flex items-center gap-1.5 text-xs text-foreground hover:text-green-600 py-0.5 w-full text-left"
                          data-testid={`related-node-${rn.id}`}
                        >
                          <CircleDot className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="truncate">{rn.title}</span>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {onOpenExploreMode && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs gap-1 h-7"
                  onClick={() => onOpenExploreMode(selectedNodeId || undefined)}
                  data-testid="open-explore-mode"
                >
                  <Map className="h-3 w-3" /> Open in Explore Mode
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  onStartTour,
  onStartDemo,
  hasStages,
  onSelectStage,
  stages,
  seedDemoLoading,
}: {
  onStartTour: () => void;
  onStartDemo: () => void;
  hasStages: boolean;
  onSelectStage: (id: string, title: string) => void;
  stages: StoryNode[];
  seedDemoLoading: boolean;
}) {
  const [showStageList, setShowStageList] = useState(false);

  return (
    <div className="py-8" data-testid="story-empty-state">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center mx-auto mb-4 shadow-lg">
          <Zap className="h-8 w-8 text-white" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-1">Company Lifecycle Map</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Follow the complete project lifecycle from first assessment to operations. Choose how you'd like to explore.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl mx-auto">
        <button
          onClick={onStartTour}
          disabled={!hasStages}
          className="group rounded-xl border-2 border-green-200 bg-green-50/50 hover:bg-green-50 hover:border-green-300 p-6 text-left transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="start-lifecycle-tour"
        >
          <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center mb-3 group-hover:bg-green-200 transition-colors">
            <Play className="h-5 w-5 text-green-700" />
          </div>
          <h3 className="font-semibold text-sm mb-1">Start Lifecycle Tour</h3>
          <p className="text-xs text-muted-foreground">Walk through all 8 stages from P0 to P7, step by step.</p>
        </button>

        <button
          onClick={() => setShowStageList(!showStageList)}
          disabled={!hasStages}
          className="group rounded-xl border-2 border-blue-200 bg-blue-50/50 hover:bg-blue-50 hover:border-blue-300 p-6 text-left transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="choose-a-stage"
        >
          <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center mb-3 group-hover:bg-blue-200 transition-colors">
            <BookOpen className="h-5 w-5 text-blue-700" />
          </div>
          <h3 className="font-semibold text-sm mb-1">Choose a Stage</h3>
          <p className="text-xs text-muted-foreground">Jump to any specific lifecycle stage to review its processes.</p>
        </button>

        <button
          onClick={onStartDemo}
          disabled={seedDemoLoading}
          className="group rounded-xl border-2 border-amber-200 bg-amber-50/50 hover:bg-amber-50 hover:border-amber-300 p-6 text-left transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="try-demo-walkthrough"
        >
          <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center mb-3 group-hover:bg-amber-200 transition-colors">
            {seedDemoLoading ? <Loader2 className="h-5 w-5 animate-spin text-amber-700" /> : <GraduationCap className="h-5 w-5 text-amber-700" />}
          </div>
          <h3 className="font-semibold text-sm mb-1">Try Demo Project Walkthrough</h3>
          <p className="text-xs text-muted-foreground">Follow 'Sunshine Park' — a 500kWp solar project from lead to handover.</p>
        </button>
      </div>

      {showStageList && hasStages && (
        <div className="mt-6 max-w-xl mx-auto" data-testid="stage-picker">
          <Card className="border-border">
            <CardContent className="p-4">
              <h4 className="text-sm font-semibold mb-3">Select a Stage</h4>
              <div className="space-y-1.5">
                {stages.map((stage, idx) => {
                  const color = STAGE_COLORS[idx % STAGE_COLORS.length];
                  return (
                    <button
                      key={stage.id}
                      onClick={() => onSelectStage(stage.id, stage.title)}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-lg border ${color.border} ${color.bg} hover:shadow-sm transition-all text-left`}
                      data-testid={`pick-stage-${stage.stageCode}`}
                    >
                      <div className={`w-8 h-8 rounded-md ${color.accent} flex items-center justify-center text-white font-bold text-xs shrink-0`}>
                        {stage.stageCode}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{stage.title}</p>
                        <p className="text-xs text-muted-foreground">{stage.childCount || 0} processes</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function StepPlayer({
  node,
  detail,
  children: childNodes,
  nextNode,
  prevNode,
  newbieMode,
  demoMode,
  onNext,
  onPrev,
  onSelectChild,
  detailsOpen,
  setDetailsOpen,
  isCOO,
}: {
  node: StoryNode;
  detail: any;
  children: StoryNode[];
  nextNode: any;
  prevNode: any;
  newbieMode: boolean;
  demoMode: boolean;
  onNext: () => void;
  onPrev: () => void;
  onSelectChild: (id: string, title: string) => void;
  detailsOpen: boolean;
  setDetailsOpen: (v: boolean) => void;
  isCOO: boolean;
}) {
  const purpose = node.sopData?.purpose || node.contentMarkdown || "";
  const inputs = node.sopData?.inputs || [];
  const outputs = node.sopData?.outputs || [];
  const dod = node.definitionOfDone || "";
  const owner = node.ownerRoleId || node.sopData?.raci?.find((r: any) => r.responsible)?.role || "";
  const approver = node.approverRoleId || node.sopData?.raci?.find((r: any) => r.accountable)?.role || "";
  const templates = node.sopData?.templates || [];
  const requiredLinks = node.requiredLinks || [];
  const primaryInstruction = node.primaryInstruction || "";

  return (
    <div className="space-y-3 transition-all duration-300 ease-in-out" data-testid="step-player">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground" data-testid="step-title">{node.title}</h2>
          {node.stageCode && node.stageCode !== "DEMO" && (
            <Badge variant="outline" className="text-[10px] mt-1">{node.stageCode} · {node.nodeType}</Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {node.status === "published" && (
            <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]">
              <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> Published
            </Badge>
          )}
        </div>
      </div>

      {newbieMode && primaryInstruction && (
        <Card className="border-green-200 bg-green-50/80 shadow-sm" data-testid="newbie-instruction-card">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                <Target className="h-4 w-4 text-green-700" />
              </div>
              <div>
                <p className="text-xs font-semibold text-green-800 uppercase tracking-wider mb-0.5">Do this now:</p>
                <p className="text-sm font-medium text-green-900">{primaryInstruction}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {newbieMode && (
        <div className="flex gap-2 flex-wrap" data-testid="newbie-chips">
          {owner && (
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 gap-1 text-xs py-1 px-2">
              <Users className="h-3 w-3" /> Owner: {owner}
            </Badge>
          )}
          {outputs.length > 0 && (
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1 text-xs py-1 px-2">
              <FileText className="h-3 w-3" /> Output: {outputs[0]}
            </Badge>
          )}
          {dod && (
            <Badge variant="outline" className={`gap-1 text-xs py-1 px-2 ${dod ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-gray-50 text-gray-500 border-gray-200"}`}>
              <Award className="h-3 w-3" /> Gate: {dod.slice(0, 60)}{dod.length > 60 ? "…" : ""}
            </Badge>
          )}
        </div>
      )}

      {demoMode && node.exampleNotes && (
        <Card className="border-amber-200 bg-amber-50/50" data-testid="demo-notes-card">
          <CardContent className="p-3">
            <div className="flex items-start gap-2">
              <Lightbulb className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-800 mb-0.5">Example Scenario</p>
                <p className="text-xs text-amber-900">{node.exampleNotes}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {demoMode && node.commonPitfalls && node.commonPitfalls.length > 0 && (
        <Card className="border-red-200 bg-red-50/50" data-testid="demo-pitfalls-card">
          <CardContent className="p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-red-800 mb-1">Common Pitfalls</p>
                <ul className="space-y-0.5">
                  {node.commonPitfalls.map((p, i) => (
                    <li key={i} className="text-xs text-red-900 flex items-start gap-1">
                      <span className="text-red-400 mt-0.5">•</span> {p}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {demoMode && node.exampleArtifacts && node.exampleArtifacts.length > 0 && (
        <div className="flex gap-2 flex-wrap" data-testid="demo-artifacts">
          {node.exampleArtifacts.map((a, i) => (
            <a
              key={i}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-md px-2 py-1 hover:bg-blue-100 transition-colors"
            >
              <ExternalLink className="h-3 w-3" /> {a.label}
            </a>
          ))}
        </div>
      )}

      {(!newbieMode || !primaryInstruction) && (
        <div className="space-y-3" data-testid="step-full-details">
          {purpose && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Purpose</h4>
              <p className="text-sm text-foreground">{purpose}</p>
            </div>
          )}

          {inputs.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Inputs</h4>
              <ul className="space-y-0.5">
                {inputs.map((inp: string, i: number) => (
                  <li key={i} className="text-sm text-foreground flex items-start gap-1.5">
                    <ArrowRight className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" /> {inp}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {outputs.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Outputs</h4>
              <ul className="space-y-0.5">
                {outputs.map((out: string, i: number) => (
                  <li key={i} className="text-sm text-foreground flex items-start gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" /> {out}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {dod && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Definition of Done</h4>
              <p className="text-sm text-foreground bg-amber-50 border border-amber-200 rounded-md p-2">{dod}</p>
            </div>
          )}

          {(owner || approver) && (
            <div className="flex gap-4">
              {owner && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Owner (R)</h4>
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">{owner}</Badge>
                </div>
              )}
              {approver && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Approver (A)</h4>
                  <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200">{approver}</Badge>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {newbieMode && primaryInstruction && (
        <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="show-details-toggle">
            {detailsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {detailsOpen ? "Hide details" : "Show details"}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-3 transition-all">
            {purpose && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Purpose</h4>
                <p className="text-sm text-foreground">{purpose}</p>
              </div>
            )}
            {inputs.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Inputs</h4>
                <ul className="space-y-0.5">
                  {inputs.map((inp: string, i: number) => (
                    <li key={i} className="text-sm text-foreground flex items-start gap-1.5">
                      <ArrowRight className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" /> {inp}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {outputs.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Outputs</h4>
                <ul className="space-y-0.5">
                  {outputs.map((out: string, i: number) => (
                    <li key={i} className="text-sm text-foreground flex items-start gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" /> {out}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {dod && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Definition of Done</h4>
                <p className="text-sm text-foreground bg-amber-50 border border-amber-200 rounded-md p-2">{dod}</p>
              </div>
            )}
            {(owner || approver) && (
              <div className="flex gap-4">
                {owner && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Owner (R)</h4>
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">{owner}</Badge>
                  </div>
                )}
                {approver && (
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Approver (A)</h4>
                    <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200">{approver}</Badge>
                  </div>
                )}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}

      {childNodes.length > 0 && !demoMode && (
        <div data-testid="child-processes">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {node.nodeType === "lifecycle_stage" ? "Processes" : "Steps"} ({childNodes.length})
          </h4>
          <div className="space-y-1.5">
            {childNodes.map((child, idx) => (
              <button
                key={child.id}
                onClick={() => onSelectChild(child.id, child.title)}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg border border-border bg-card hover:bg-muted hover:shadow-sm transition-all text-left group"
                data-testid={`child-node-${child.id}`}
              >
                <div className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-600 shrink-0">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate group-hover:text-green-700 transition-colors">{child.title}</p>
                  {child.ownerRoleId && (
                    <p className="text-[10px] text-muted-foreground">{child.ownerRoleId}</p>
                  )}
                </div>
                <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${child.status === "published" ? "bg-green-50 text-green-600 border-green-200" : "bg-gray-50 text-gray-500 border-gray-200"}`}>
                  {child.status}
                </Badge>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-green-600 transition-colors" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-border" data-testid="step-navigation">
        <div className="flex gap-2">
          {!newbieMode && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1"
              onClick={onPrev}
              disabled={demoMode ? demoMode && !prevNode : !prevNode}
              data-testid="nav-back"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
          )}
        </div>

        <div className="flex gap-2">
          {(templates.length > 0 || requiredLinks.filter(l => l.type === "template").length > 0) && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1"
              onClick={() => {
                const link = templates[0]?.url || requiredLinks.find(l => l.type === "template")?.url;
                if (link) window.open(link, "_blank");
              }}
              data-testid="open-template"
            >
              <FileText className="h-3.5 w-3.5" /> Open Required Template(s)
            </Button>
          )}

          {requiredLinks.filter(l => l.type === "folder").length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1"
              onClick={() => window.open(requiredLinks.find(l => l.type === "folder")!.url, "_blank")}
              data-testid="open-folder"
            >
              <FolderOpen className="h-3.5 w-3.5" /> Open SharePoint Folder
            </Button>
          )}

          <Button
            size="sm"
            className="h-8 text-xs gap-1 bg-green-600 hover:bg-green-700 text-white"
            onClick={onNext}
            disabled={!nextNode}
            data-testid="nav-next"
          >
            Next <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
