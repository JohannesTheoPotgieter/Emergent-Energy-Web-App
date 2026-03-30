import { useMemo, useState } from "react";
import { useGatesExceptions } from "@/hooks/use-gates";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { Search, AlertTriangle } from "lucide-react";
import { PageError, PageSkeleton } from "@/components/ui/page-states";

function riskBadge(level: string) {
  switch (level) {
    case "CRITICAL": return "bg-red-100 text-red-800";
    case "HIGH": return "bg-orange-100 text-orange-800";
    case "MEDIUM": return "bg-amber-100 text-amber-800";
    case "LOW": return "bg-green-100 text-green-800";
    default: return "bg-gray-100 text-gray-600";
  }
}

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

export default function GatesExceptionsPage() {
  const { data, isLoading, error } = useGatesExceptions();
  const [search, setSearch] = useState("");
  const [, navigate] = useLocation();

  const filtered = useMemo(() => {
    if (!data?.exceptions) return [];
    if (!search) return data.exceptions;
    const term = search.toLowerCase();
    return data.exceptions.filter((e: any) =>
      (e.project_name || "").toLowerCase().includes(term) ||
      (e.reason_text || "").toLowerCase().includes(term)
    );
  }, [data?.exceptions, search]);

  if (isLoading) return <PageSkeleton />;
  if (error) return <PageError message="Failed to load exceptions" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search exceptions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Badge variant="outline" className="bg-orange-100 text-orange-800">
          {filtered.length} open
        </Badge>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
          <p>No open exceptions.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-2 font-medium">Project</th>
                <th className="text-left p-2 font-medium">Stage</th>
                <th className="text-left p-2 font-medium">Risk</th>
                <th className="text-left p-2 font-medium">Reason</th>
                <th className="text-left p-2 font-medium">Requested</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e: any) => (
                <tr
                  key={e.id}
                  className="border-b hover:bg-muted/30 cursor-pointer"
                  onClick={() => navigate(`/project/${encodeURIComponent(e.project_name)}`)}
                >
                  <td className="p-2 font-medium">{e.project_name}</td>
                  <td className="p-2 text-xs">{STAGE_LABELS[e.stage_code] || e.stage_code}</td>
                  <td className="p-2">
                    <Badge variant="outline" className={`text-[10px] ${riskBadge(e.risk_level)}`}>
                      {e.risk_level}
                    </Badge>
                  </td>
                  <td className="p-2 text-muted-foreground max-w-xs truncate">{e.reason_text}</td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {e.created_at ? new Date(e.created_at).toLocaleDateString() : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
