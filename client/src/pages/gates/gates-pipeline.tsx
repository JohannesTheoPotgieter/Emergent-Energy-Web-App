import { useState, useMemo } from "react";
import { useGatesPipeline, type GateProjectCard } from "@/hooks/use-gates";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { Search, LayoutGrid, Table, Loader2, AlertCircle, Clock, ArrowRight } from "lucide-react";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { STAGE_CODES } from "@shared/schema/stage-lifecycle";

const STAGE_LABELS: Record<string, string> = {
  S01_FIRST_ASSESSMENT: "First Assessment",
  S02_DESIGN_COST_PROPOSAL: "Design & Cost Proposal",
  S03_SIGNATURE_FINANCIAL_CLOSE: "Signature & Financial Close",
  S04_PD_PM_HANDOVER: "PD-PM Handover",
  S05_FINANCIAL_REVIEW: "Financial Review",
  S06_CONSTRUCTION: "Construction",
  S07_COMMISSIONING: "Commissioning",
  S08_OM_HANDOVER: "O&M Handover",
  S09_CLIENT_HANDOVER: "Client Handover",
  S10_POST_HANDOVER_REVIEW: "Post-Handover Review",
};

function gateStatusColor(status: string | null) {
  switch (status) {
    case "PROGRESSED":
    case "APPROVED": return "bg-emerald-100 text-emerald-800";
    case "READY_FOR_REVIEW": return "bg-blue-100 text-blue-800";
    case "IN_PROGRESS": return "bg-amber-100 text-amber-800";
    case "BLOCKED": return "bg-red-100 text-red-800";
    case "EXCEPTION_APPROVED": return "bg-orange-100 text-orange-800";
    default: return "bg-gray-100 text-gray-600";
  }
}

function ProjectCard({ project, onClick }: { project: GateProjectCard; onClick: () => void }) {
  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow border-l-4"
      style={{
        borderLeftColor:
          project.gateStatus === "BLOCKED" ? "#ef4444" :
          project.gateStatus === "READY_FOR_REVIEW" ? "#3b82f6" :
          project.gateStatus === "APPROVED" ? "#10b981" :
          "#d1d5db",
      }}
      onClick={onClick}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{project.projectName}</p>
            {project.clientName && (
              <p className="text-xs text-muted-foreground truncate">{project.clientName}</p>
            )}
          </div>
          <Badge variant="outline" className={`text-[10px] shrink-0 ${gateStatusColor(project.gateStatus)}`}>
            {project.gateStatus || "N/A"}
          </Badge>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <div className="h-1.5 w-12 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full"
                style={{ width: `${project.gateReadinessPct}%` }}
              />
            </div>
            {project.gateReadinessPct}%
          </span>
          {project.daysInStage > 0 && (
            <span className="flex items-center gap-0.5">
              <Clock className="h-3 w-3" /> {project.daysInStage}d
            </span>
          )}
          {project.openExceptionCount > 0 && (
            <span className="flex items-center gap-0.5 text-orange-600">
              <AlertCircle className="h-3 w-3" /> {project.openExceptionCount}
            </span>
          )}
        </div>

        {project.waitingOnDepartment && (
          <p className="text-[10px] text-orange-600">
            Waiting on: {project.waitingOnDepartment}
          </p>
        )}
        {project.pm && (
          <p className="text-[10px] text-muted-foreground">PM: {project.pm}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function GatesPipelinePage() {
  const { data, isLoading, error } = useGatesPipeline();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [, navigate] = useLocation();

  const filtered = useMemo(() => {
    if (!data?.projects) return [];
    if (!search) return data.projects;
    const term = search.toLowerCase();
    return data.projects.filter((p) =>
      p.projectName.toLowerCase().includes(term) ||
      (p.clientName || "").toLowerCase().includes(term) ||
      (p.pm || "").toLowerCase().includes(term)
    );
  }, [data?.projects, search]);

  const stageGroups = useMemo(() => {
    const groups: Record<string, GateProjectCard[]> = {};
    for (const code of STAGE_CODES) groups[code] = [];
    for (const p of filtered) {
      const code = p.currentStageCode || "S01_FIRST_ASSESSMENT";
      if (groups[code]) groups[code].push(p);
    }
    return groups;
  }, [filtered]);

  if (isLoading) return <PageSkeleton />;
  if (error) return <PageError message="Failed to load gates pipeline" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex gap-1 border rounded-md p-0.5">
          <Button
            size="sm"
            variant={view === "kanban" ? "default" : "ghost"}
            className="h-7 px-2"
            onClick={() => setView("kanban")}
          >
            <LayoutGrid className="h-3.5 w-3.5 mr-1" /> Kanban
          </Button>
          <Button
            size="sm"
            variant={view === "table" ? "default" : "ghost"}
            className="h-7 px-2"
            onClick={() => setView("table")}
          >
            <Table className="h-3.5 w-3.5 mr-1" /> Table
          </Button>
        </div>
        <span className="text-sm text-muted-foreground">
          {filtered.length} project{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {view === "kanban" ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {STAGE_CODES.map((code) => (
            <div key={code} className="flex-shrink-0 w-64">
              <div className="flex items-center gap-2 mb-2 px-1">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide truncate">
                  {STAGE_LABELS[code] || code}
                </h3>
                <Badge variant="secondary" className="text-[10px] h-4 min-w-[20px] justify-center">
                  {stageGroups[code]?.length || 0}
                </Badge>
              </div>
              <div className="space-y-2 min-h-[100px]">
                {(stageGroups[code] || []).map((p) => (
                  <ProjectCard
                    key={p.projectId}
                    project={p}
                    onClick={() => navigate(`/project/${encodeURIComponent(p.projectName)}`)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="border rounded-lg overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-2 font-medium">Project</th>
                <th className="text-left p-2 font-medium">Client</th>
                <th className="text-left p-2 font-medium">Stage</th>
                <th className="text-left p-2 font-medium">Status</th>
                <th className="text-right p-2 font-medium">Readiness</th>
                <th className="text-left p-2 font-medium">Waiting On</th>
                <th className="text-right p-2 font-medium">Days</th>
                <th className="text-right p-2 font-medium">Exc.</th>
                <th className="text-left p-2 font-medium">PM</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.projectId}
                  className="border-b hover:bg-muted/30 cursor-pointer"
                  onClick={() => navigate(`/project/${encodeURIComponent(p.projectName)}`)}
                >
                  <td className="p-2 font-medium">{p.projectName}</td>
                  <td className="p-2 text-muted-foreground">{p.clientName || "-"}</td>
                  <td className="p-2">
                    <span className="text-xs">{STAGE_LABELS[p.currentStageCode || ""] || p.currentStageCode || "-"}</span>
                  </td>
                  <td className="p-2">
                    <Badge variant="outline" className={`text-[10px] ${gateStatusColor(p.gateStatus)}`}>
                      {p.gateStatus || "N/A"}
                    </Badge>
                  </td>
                  <td className="p-2 text-right">{p.gateReadinessPct}%</td>
                  <td className="p-2 text-muted-foreground">{p.waitingOnDepartment || "-"}</td>
                  <td className="p-2 text-right">{p.daysInStage}</td>
                  <td className="p-2 text-right">{p.openExceptionCount || "-"}</td>
                  <td className="p-2 text-muted-foreground">{p.pm || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
