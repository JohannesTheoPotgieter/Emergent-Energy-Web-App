import { useMemo, useState } from "react";
import { useGatesBlocked } from "@/hooks/use-gates";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { Search, Clock, AlertCircle } from "lucide-react";
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

export default function GatesBlockedPage() {
  const { data, isLoading, error } = useGatesBlocked();
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
  if (error) return <PageError message="Failed to load blocked gates" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search blocked projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Badge variant="destructive">{filtered.length} blocked</Badge>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <AlertCircle className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
          <p>No blocked gates. All projects are progressing.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-2 font-medium">Project</th>
                <th className="text-left p-2 font-medium">Client</th>
                <th className="text-left p-2 font-medium">Stage</th>
                <th className="text-left p-2 font-medium">Waiting On</th>
                <th className="text-right p-2 font-medium">Days Blocked</th>
                <th className="text-right p-2 font-medium">Exceptions</th>
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
                  <td className="p-2 text-xs">{STAGE_LABELS[p.currentStageCode || ""] || "-"}</td>
                  <td className="p-2 text-orange-600">{p.waitingOnDepartment || "-"}</td>
                  <td className="p-2 text-right font-medium text-red-600">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {p.daysInStage}
                    </span>
                  </td>
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
