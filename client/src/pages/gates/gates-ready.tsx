import { useMemo, useState } from "react";
import { useGatesReady } from "@/hooks/use-gates";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { Search, CheckCircle } from "lucide-react";
import { PageError, PageSkeleton } from "@/components/ui/page-states";

const STAGE_LABELS: Record<string, string> = {
  S01_FIRST_ASSESSMENT: "First Assessment",
  S02_DESIGN_COST_PROPOSAL: "Design & Cost Proposal",
  S03_SIGNATURE_FINANCIAL_CLOSE: "Financial Close",
  S04_PD_PM_HANDOVER: "PD-PM Handover",
  S05_FINANCIAL_REVIEW: "Financial Review",
  S06_CONSTRUCTION: "Construction",
  S07_COMMISSIONING: "Commissioning",
  S08_OM_HANDOVER: "O&M Handover",
  S09_CLIENT_HANDOVER: "Client Handover",
  S10_POST_HANDOVER_REVIEW: "Post-Handover",
};

export default function GatesReadyPage() {
  const { data, isLoading, error } = useGatesReady();
  const [search, setSearch] = useState("");
  const [, navigate] = useLocation();

  const filtered = useMemo(() => {
    if (!data?.projects) return [];
    if (!search) return data.projects;
    const term = search.toLowerCase();
    return data.projects.filter((p) =>
      p.projectName.toLowerCase().includes(term) ||
      (p.clientName || "").toLowerCase().includes(term)
    );
  }, [data?.projects, search]);

  if (isLoading) return <PageSkeleton />;
  if (error) return <PageError message="Failed to load ready gates" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search ready projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Badge className="bg-blue-100 text-blue-800">{filtered.length} ready</Badge>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <CheckCircle className="h-8 w-8 mx-auto mb-2" />
          <p>No projects ready for review right now.</p>
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
                <th className="text-left p-2 font-medium">PM</th>
                <th className="text-left p-2 font-medium">PD</th>
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
                  <td className="p-2 text-xs">{STAGE_LABELS[p.currentStageCode || ""] || "-"}</td>
                  <td className="p-2">
                    <Badge variant="outline" className="text-[10px] bg-blue-100 text-blue-800">
                      {p.gateStatus}
                    </Badge>
                  </td>
                  <td className="p-2 text-right font-medium text-emerald-600">{p.gateReadinessPct}%</td>
                  <td className="p-2 text-muted-foreground">{p.pm || "-"}</td>
                  <td className="p-2 text-muted-foreground">{p.pd || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
