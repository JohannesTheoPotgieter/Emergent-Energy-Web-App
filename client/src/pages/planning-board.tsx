import React, { useState, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertTriangle, Search, ArrowUpDown, Users, Calendar, Zap,
  Edit2, ChevronRight, ChevronDown, GripHorizontal,
} from "lucide-react";
import ScenarioSelector from "@/components/ScenarioSelector";

function formatRand(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "R 0";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}R ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}R ${Math.round(abs)}`;
}

interface ScenarioProject {
  projectName: string;
  pm: string | null;
  phase: string | null;
  sizeKwp: string | null;
  constructionStartDate: string | null;
  commissioningDate: string | null;
  omHandoverDate: string | null;
  clientHandoverDate: string | null;
  originalConstructionStart: string | null;
  originalCommissioning: string | null;
  originalOmHandover: string | null;
  originalClientHandover: string | null;
  hasOverride: boolean;
  isActive: boolean;
}

interface CapacityWeek {
  weekStart: string;
  demand: number;
  projects: string[];
  projectCount: number;
  capacity: number;
  overCapacity: boolean;
}

interface Clash {
  weekStart: string;
  demand: number;
  capacity: number;
  excess: number;
  projects: string[];
  message: string;
}

function formatDate(d: string | null): string {
  if (!d) return '';
  return d.substring(0, 10);
}


function GanttTimeline({ projects, scenarioId }: { projects: ScenarioProject[]; scenarioId: number | null }) {
  const timelineStart = new Date('2025-01-06');
  const numWeeks = 52;
  const weekWidth = 24;
  const rowHeight = 28;
  const labelWidth = 180;

  const weeks = useMemo(() => {
    const w = [];
    for (let i = 0; i < numWeeks; i++) {
      const d = new Date(timelineStart);
      d.setDate(d.getDate() + i * 7);
      w.push(d.toISOString().split('T')[0]);
    }
    return w;
  }, []);

  const activeProjects = projects.filter(p => p.isActive && p.constructionStartDate);

  const getBarPosition = (startDate: string | null, endDate: string | null) => {
    if (!startDate) return null;
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : new Date(start.getTime() + 90 * 86400000);

    const startWeek = Math.floor((start.getTime() - timelineStart.getTime()) / (7 * 86400000));
    const endWeek = Math.ceil((end.getTime() - timelineStart.getTime()) / (7 * 86400000));

    return {
      left: Math.max(0, startWeek) * weekWidth,
      width: Math.max(weekWidth, (Math.min(endWeek, numWeeks) - Math.max(0, startWeek)) * weekWidth),
    };
  };

  const [editProject, setEditProject] = useState<ScenarioProject | null>(null);

  const monthLabels = useMemo(() => {
    const labels: { label: string; left: number; width: number }[] = [];
    let currentMonth = -1;
    let monthStart = 0;

    weeks.forEach((w, i) => {
      const d = new Date(w);
      const m = d.getMonth();
      if (m !== currentMonth) {
        if (currentMonth !== -1) {
          labels.push({
            label: new Date(weeks[monthStart]).toLocaleString('default', { month: 'short' }),
            left: monthStart * weekWidth,
            width: (i - monthStart) * weekWidth,
          });
        }
        currentMonth = m;
        monthStart = i;
      }
    });
    labels.push({
      label: new Date(weeks[monthStart]).toLocaleString('default', { month: 'short' }),
      left: monthStart * weekWidth,
      width: (weeks.length - monthStart) * weekWidth,
    });

    return labels;
  }, [weeks]);

  return (
    <>
      <div className="overflow-x-auto border rounded-lg">
        <div className="relative" style={{ minWidth: labelWidth + numWeeks * weekWidth }}>
          <div className="flex border-b bg-muted/30 sticky top-0 z-10">
            <div className="shrink-0 border-r bg-background sticky left-0 z-20 px-2 py-1 text-xs font-medium" style={{ width: labelWidth }}>
              Project
            </div>
            <div className="relative" style={{ width: numWeeks * weekWidth }}>
              <div className="flex">
                {monthLabels.map((m, i) => (
                  <div key={i} className="text-center text-xs font-medium py-1 border-r" style={{ width: m.width, position: 'absolute', left: m.left }}>
                    {m.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {activeProjects.map((p, idx) => {
            const bar = getBarPosition(p.constructionStartDate, p.commissioningDate || p.clientHandoverDate);
            const colors = p.hasOverride ? 'bg-amber-400' : 'bg-blue-400';

            return (
              <div key={p.projectName} className="flex border-b hover:bg-muted/30" style={{ height: rowHeight }} data-testid={`gantt-row-${p.projectName}`}>
                <div
                  className="shrink-0 border-r bg-background sticky left-0 z-10 px-2 flex items-center text-xs truncate cursor-pointer hover:text-blue-600"
                  style={{ width: labelWidth }}
                  onClick={() => { if (scenarioId) setEditProject(p); }}
                >
                  <span className="truncate">{p.projectName}</span>
                  {p.hasOverride && <span className="ml-1 text-amber-500 text-[10px]">*</span>}
                </div>
                <div className="relative flex-1">
                  {bar && (
                    <div
                      className={`absolute top-1 rounded h-5 ${colors} opacity-80 flex items-center justify-center text-[9px] text-white font-medium cursor-pointer`}
                      style={{ left: bar.left, width: Math.max(bar.width, 8) }}
                      title={`${p.projectName}: ${formatDate(p.constructionStartDate)} → ${formatDate(p.commissioningDate || p.clientHandoverDate)}`}
                      onClick={() => { if (scenarioId) setEditProject(p); }}
                    >
                      {bar.width > 60 ? p.pm || '' : ''}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {editProject && scenarioId && (
        <ProjectKeyDateEditorDialog
          project={editProject}
          scenarioId={scenarioId}
          onClose={() => setEditProject(null)}
        />
      )}
    </>
  );
}

function CapacityHeatmapSection({ scenarioId, resourceType }: { scenarioId: number | null; resourceType: string }) {
  const { data, isLoading } = useQuery<{ capacity: CapacityWeek[]; clashes: Clash[]; resourceType: string }>({
    queryKey: [`/api/planning-board/scenario-capacity?scenarioId=${scenarioId || ''}&resourceType=${resourceType}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const [selectedClash, setSelectedClash] = useState<Clash | null>(null);

  if (isLoading) return <div className="p-4 text-center text-muted-foreground">Loading capacity data...</div>;

  const capacityData = data?.capacity ?? [];
  const clashes = data?.clashes ?? [];
  const maxDemand = Math.max(...capacityData.map(c => c.demand), 1);
  const defaultCapacity = capacityData[0]?.capacity ?? 5;

  const getHeatColor = (demand: number, capacity: number) => {
    const ratio = demand / Math.max(capacity, 1);
    if (demand === 0) return "bg-gray-50";
    if (ratio <= 0.5) return "bg-green-100";
    if (ratio <= 0.75) return "bg-green-300";
    if (ratio <= 1) return "bg-amber-200";
    return "bg-red-400 text-white";
  };

  const visibleWeeks = capacityData.filter((_, i) => i % 2 === 0);

  return (
    <div className="space-y-4">
      {clashes.length > 0 && (
        <Card className="border-red-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-600 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {clashes.length} Capacity Clash{clashes.length > 1 ? 'es' : ''}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {clashes.slice(0, 5).map((c, i) => (
              <div
                key={i}
                className="border rounded p-2 text-xs cursor-pointer hover:bg-red-50"
                onClick={() => setSelectedClash(c)}
                data-testid={`clash-${c.weekStart}`}
              >
                <div className="flex justify-between">
                  <span className="font-medium">{c.weekStart}</span>
                  <span className="text-red-600">Demand: {c.demand.toFixed(1)} / Capacity: {c.capacity}</span>
                </div>
                <p className="text-muted-foreground mt-1">{c.message}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{resourceType} Demand Heatmap (Capacity: {defaultCapacity})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="flex gap-0.5" style={{ minWidth: visibleWeeks.length * 30 }}>
              {visibleWeeks.map(w => (
                <div
                  key={w.weekStart}
                  className={`flex flex-col items-center cursor-pointer rounded ${getHeatColor(w.demand, w.capacity)}`}
                  style={{ width: 28, minHeight: 40 }}
                  title={`${w.weekStart}: ${w.projectCount} projects, demand=${w.demand.toFixed(1)}`}
                  onClick={() => {
                    if (w.overCapacity) {
                      const clash = clashes.find(c => c.weekStart === w.weekStart);
                      if (clash) setSelectedClash(clash);
                    }
                  }}
                >
                  <span className="text-[8px] leading-tight">{new Date(w.weekStart).toLocaleDateString('en', { day: '2-digit', month: 'short' }).replace(' ', '\n').split(' ')[0]}</span>
                  <span className="text-[10px] font-mono font-bold">{w.projectCount > 0 ? w.projectCount : ''}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedClash && (
        <Dialog open={!!selectedClash} onOpenChange={() => setSelectedClash(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Capacity Clash: {selectedClash.weekStart}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span>Demand</span>
                <span className="text-red-600 font-bold">{selectedClash.demand.toFixed(1)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Capacity</span>
                <span>{selectedClash.capacity}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Excess</span>
                <span className="text-red-600">{selectedClash.excess.toFixed(1)}</span>
              </div>
              <div className="border-t pt-2">
                <p className="text-sm font-medium mb-2">Projects causing overload:</p>
                <div className="space-y-1">
                  {selectedClash.projects.map((p, i) => (
                    <div key={i} className="text-sm text-muted-foreground border rounded p-2 flex justify-between">
                      <span>{p}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function KeyDateFieldEditor({ project, field, label, currentDate, originalDate, scenarioId }: {
  project: string;
  field: string;
  label: string;
  currentDate: string | null;
  originalDate: string | null;
  scenarioId: number;
}) {
  const [editing, setEditing] = useState(false);
  const [newDate, setNewDate] = useState(currentDate ? formatDate(currentDate) : "");
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/scenarios/${scenarioId}/overrides`, {
        entityType: "project_keydate",
        entityId: project,
        fieldName: field,
        originalDate: originalDate,
        overrideDate: newDate,
        reason,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setEditing(false);
    },
  });

  return (
    <div className="border rounded p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{currentDate ? formatDate(currentDate) : 'Not set'}</span>
          {originalDate && currentDate !== originalDate && (
            <span className="text-xs text-amber-500">(was {formatDate(originalDate)})</span>
          )}
          <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setEditing(!editing)} data-testid={`button-edit-${field}`}>
            <Edit2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      {editing && (
        <div className="space-y-2">
          <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="h-8" data-testid={`input-${field}`} />
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason" className="h-8" data-testid={`input-reason-${field}`} />
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!newDate || !reason || saveMutation.isPending} className="w-full" data-testid={`button-save-${field}`}>
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

function ProjectKeyDateEditorDialog({ project, scenarioId, onClose }: {
  project: ScenarioProject;
  scenarioId: number;
  onClose: () => void;
}) {
  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Key Dates: {project.projectName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <KeyDateFieldEditor project={project.projectName} field="construction_start" label="Construction Start" currentDate={project.constructionStartDate} originalDate={project.originalConstructionStart} scenarioId={scenarioId} />
          <KeyDateFieldEditor project={project.projectName} field="commissioning_date" label="Commissioning" currentDate={project.commissioningDate} originalDate={project.originalCommissioning} scenarioId={scenarioId} />
          <KeyDateFieldEditor project={project.projectName} field="om_handover_date" label="O&M Handover" currentDate={project.omHandoverDate} originalDate={project.originalOmHandover} scenarioId={scenarioId} />
          <KeyDateFieldEditor project={project.projectName} field="client_handover_date" label="Client Handover" currentDate={project.clientHandoverDate} originalDate={project.originalClientHandover} scenarioId={scenarioId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function PlanningBoardPage() {
  const [scenarioId, setScenarioId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("timeline");
  const [resourceType, setResourceType] = useState("PM");
  const [expandedProject, setExpandedProject] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ projects: ScenarioProject[] }>({
    queryKey: [`/api/planning-board/scenario-projects?scenarioId=${scenarioId || ''}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const projects = data?.projects ?? [];

  const filtered = useMemo(() => {
    let result = projects.filter(p => p.isActive);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(p => p.projectName.toLowerCase().includes(q) || (p.pm && p.pm.toLowerCase().includes(q)));
    }
    return result;
  }, [projects, search]);

  const summaryStats = useMemo(() => {
    const active = filtered.length;
    const withDates = filtered.filter(p => p.constructionStartDate && p.commissioningDate).length;
    const overridden = filtered.filter(p => p.hasOverride).length;
    const totalCapacity = filtered.reduce((s, p) => s + parseFloat(p.sizeKwp || '0'), 0);
    return { active, withDates, overridden, totalCapacity };
  }, [filtered]);

  const [editProject, setEditProject] = useState<ScenarioProject | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-heading font-bold">Planning Board</h2>
        <div className="p-12 text-center text-muted-foreground">Loading project data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="planning-board-page">
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
        <div>
          <h2 className="text-2xl font-heading font-bold">Planning Board</h2>
          <p className="text-sm text-muted-foreground">Project timeline, key dates, and resource capacity</p>
        </div>
        <div className="flex gap-3 items-center">
          <ScenarioSelector selectedScenarioId={scenarioId} onScenarioChange={setScenarioId} />
          <div className="relative">
            <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              className="pl-8 h-8 w-48"
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-search-planning"
            />
          </div>
        </div>
      </div>

      {!scenarioId && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
          Viewing baseline dates. Create a scenario to edit project dates and see capacity impact.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Active Projects</p>
            <p className="text-lg font-bold">{summaryStats.active}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">With Dates</p>
            <p className="text-lg font-bold">{summaryStats.withDates}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total Capacity</p>
            <p className="text-lg font-bold">{(summaryStats.totalCapacity / 1000).toFixed(1)} MWp</p>
          </CardContent>
        </Card>
        {scenarioId && (
          <Card>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Overridden</p>
              <p className="text-lg font-bold text-amber-600">{summaryStats.overridden}</p>
            </CardContent>
          </Card>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="timeline" data-testid="tab-timeline">Timeline</TabsTrigger>
          <TabsTrigger value="projects" data-testid="tab-projects">Key Dates</TabsTrigger>
          <TabsTrigger value="capacity" data-testid="tab-capacity">Capacity</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Project Timeline (Gantt)</CardTitle>
              {scenarioId && <p className="text-xs text-muted-foreground">Click a project bar to edit its key dates</p>}
            </CardHeader>
            <CardContent>
              <GanttTimeline projects={filtered} scenarioId={scenarioId} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="projects" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Project Key Dates</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b">
                    <tr>
                      <th className="p-2 text-left">Project</th>
                      <th className="p-2 text-left">PM</th>
                      <th className="p-2 text-right">Size</th>
                      <th className="p-2 text-left">Construction Start</th>
                      <th className="p-2 text-left">Commissioning</th>
                      <th className="p-2 text-left">O&M Handover</th>
                      <th className="p-2 text-left">Client Handover</th>
                      {scenarioId && <th className="p-2 text-center">Edit</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(p => (
                      <tr key={p.projectName} className={`border-b hover:bg-muted/50 ${p.hasOverride ? 'bg-amber-50/30' : ''}`} data-testid={`keydate-row-${p.projectName}`}>
                        <td className="p-2 font-medium text-xs truncate max-w-[160px]">{p.projectName}</td>
                        <td className="p-2 text-xs">{p.pm || '-'}</td>
                        <td className="p-2 text-right text-xs font-mono">{p.sizeKwp ? `${parseFloat(p.sizeKwp).toFixed(0)}` : '-'}</td>
                        <td className="p-2 text-xs">
                          {formatDate(p.constructionStartDate) || '-'}
                          {p.originalConstructionStart && p.constructionStartDate !== p.originalConstructionStart && (
                            <span className="text-amber-500 text-[10px] ml-1">(was {formatDate(p.originalConstructionStart)})</span>
                          )}
                        </td>
                        <td className="p-2 text-xs">
                          {formatDate(p.commissioningDate) || '-'}
                          {p.originalCommissioning && p.commissioningDate !== p.originalCommissioning && (
                            <span className="text-amber-500 text-[10px] ml-1">(was {formatDate(p.originalCommissioning)})</span>
                          )}
                        </td>
                        <td className="p-2 text-xs">{formatDate(p.omHandoverDate) || '-'}</td>
                        <td className="p-2 text-xs">{formatDate(p.clientHandoverDate) || '-'}</td>
                        {scenarioId && (
                          <td className="p-2 text-center">
                            <Button size="sm" variant="ghost" className="h-6" onClick={() => setEditProject(p)}>
                              <Edit2 className="h-3 w-3" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="capacity" className="mt-4">
          <div className="flex gap-2 mb-4">
            {['PM', 'Installer'].map(rt => (
              <Button
                key={rt}
                size="sm"
                variant={resourceType === rt ? "default" : "outline"}
                onClick={() => setResourceType(rt)}
                data-testid={`button-resource-${rt}`}
              >
                {rt}
              </Button>
            ))}
          </div>
          <CapacityHeatmapSection scenarioId={scenarioId} resourceType={resourceType} />
        </TabsContent>
      </Tabs>

      {editProject && scenarioId && (
        <ProjectKeyDateEditorDialog
          project={editProject}
          scenarioId={scenarioId}
          onClose={() => setEditProject(null)}
        />
      )}
    </div>
  );
}
