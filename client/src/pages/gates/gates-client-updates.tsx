import { useMemo, useState } from "react";
import { useGatesClientUpdates } from "@/hooks/use-gates";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { Search, CalendarCheck, AlertCircle } from "lucide-react";
import { PageError, PageSkeleton } from "@/components/ui/page-states";

const STAGE_LABELS: Record<string, string> = {
  S04_PD_PM_HANDOVER: "PD-PM Handover",
  S04_PLANNING: "Planning",
  S9B_COMPLIANCE_HANDOVER: "Compliance Handover",
  S05_FINANCIAL_REVIEW: "Financial Review",
  S06_CONSTRUCTION: "Construction",
  S07_COMMISSIONING: "Commissioning",
  S08_OM_HANDOVER: "O&M Handover",
  S09_CLIENT_HANDOVER: "Client Handover",
};

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

export default function GatesClientUpdatesPage() {
  const { data, isLoading, error } = useGatesClientUpdates();
  const [search, setSearch] = useState("");
  const [, navigate] = useLocation();

  const projects = useMemo(() => {
    if (!data?.projects) return [];
    return data.projects.map((p: any) => ({
      ...p,
      daysSinceUpdate: daysSince(p.last_review_date),
      isOverdue: daysSince(p.last_review_date) === null || (daysSince(p.last_review_date) ?? 0) > 7,
    }));
  }, [data?.projects]);

  const filtered = useMemo(() => {
    if (!search) return projects;
    const term = search.toLowerCase();
    return projects.filter((p: any) =>
      (p.project_name || "").toLowerCase().includes(term) ||
      (p.pm || "").toLowerCase().includes(term)
    );
  }, [projects, search]);

  if (isLoading) return <PageSkeleton />;
  if (error) return <PageError message="Failed to load client updates" />;

  const overdueCount = filtered.filter((p: any) => p.isOverdue).length;

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
        {overdueCount > 0 && (
          <Badge variant="destructive">{overdueCount} overdue</Badge>
        )}
        <span className="text-sm text-muted-foreground">{filtered.length} projects in active execution</span>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <CalendarCheck className="h-8 w-8 mx-auto mb-2" />
          <p>No projects requiring client updates.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-2 font-medium">Project</th>
                <th className="text-left p-2 font-medium">Client</th>
                <th className="text-left p-2 font-medium">Stage</th>
                <th className="text-left p-2 font-medium">PM</th>
                <th className="text-left p-2 font-medium">Last Update</th>
                <th className="text-right p-2 font-medium">Days Ago</th>
                <th className="text-left p-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p: any) => (
                <tr
                  key={p.project_id}
                  className="border-b hover:bg-muted/30 cursor-pointer"
                  onClick={() => navigate(`/project/${encodeURIComponent(p.project_name)}`)}
                >
                  <td className="p-2 font-medium">{p.project_name}</td>
                  <td className="p-2 text-muted-foreground">{p.client_name || "-"}</td>
                  <td className="p-2 text-xs">{STAGE_LABELS[p.current_stage_code] || p.current_stage_code || "-"}</td>
                  <td className="p-2 text-muted-foreground">{p.pm || "-"}</td>
                  <td className="p-2 text-xs">
                    {p.last_review_date ? new Date(p.last_review_date).toLocaleDateString() : "Never"}
                  </td>
                  <td className="p-2 text-right">
                    {p.daysSinceUpdate !== null ? `${p.daysSinceUpdate}d` : "-"}
                  </td>
                  <td className="p-2">
                    {p.isOverdue ? (
                      <Badge variant="destructive" className="text-[10px]">
                        <AlertCircle className="h-3 w-3 mr-0.5" /> Overdue
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] bg-emerald-100 text-emerald-800">
                        On Track
                      </Badge>
                    )}
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
