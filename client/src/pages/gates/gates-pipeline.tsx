import { useState, useMemo } from "react";
import { useGatesPipeline } from "@/hooks/use-gates";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { Search } from "lucide-react";
import { PageError, PageSkeleton } from "@/components/ui/page-states";

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

export default function GatesPipelinePage() {
  const { data, isLoading, error } = useGatesPipeline();
  const [search, setSearch] = useState("");
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
        <span className="text-sm text-muted-foreground">
          {filtered.length} project{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

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
    </div>
  );
}
