import { useMemo, useState } from "react";
import { useGatesHandovers } from "@/hooks/use-gates";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { Search, Handshake, Clock } from "lucide-react";
import { PageError, PageSkeleton } from "@/components/ui/page-states";

export default function GatesHandoversPage() {
  const { data, isLoading, error } = useGatesHandovers();
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

  const omHandovers = filtered.filter((p) => p.currentStageCode === "S08_OM_HANDOVER");
  const clientHandovers = filtered.filter((p) => p.currentStageCode === "S09_CLIENT_HANDOVER");

  if (isLoading) return <PageSkeleton />;
  if (error) return <PageError message="Failed to load handover queue" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search handover projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <span className="text-sm text-muted-foreground">{filtered.length} in handover</span>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Handshake className="h-8 w-8 mx-auto mb-2" />
          <p>No projects in handover stages.</p>
        </div>
      ) : (
        <>
          {omHandovers.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                O&M Handover Queue
                <Badge variant="secondary">{omHandovers.length}</Badge>
              </h3>
              <HandoverTable projects={omHandovers} onNavigate={navigate} />
            </div>
          )}

          {clientHandovers.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                Client Handover Queue
                <Badge variant="secondary">{clientHandovers.length}</Badge>
              </h3>
              <HandoverTable projects={clientHandovers} onNavigate={navigate} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function HandoverTable({ projects, onNavigate }: { projects: any[]; onNavigate: (path: string) => void }) {
  return (
    <div className="border rounded-lg overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left p-2 font-medium">Project</th>
            <th className="text-left p-2 font-medium">Client</th>
            <th className="text-left p-2 font-medium">Status</th>
            <th className="text-right p-2 font-medium">Readiness</th>
            <th className="text-left p-2 font-medium">Waiting On</th>
            <th className="text-right p-2 font-medium">Days</th>
            <th className="text-left p-2 font-medium">PM</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr
              key={p.projectId}
              className="border-b hover:bg-muted/30 cursor-pointer"
              onClick={() => onNavigate(`/project/${encodeURIComponent(p.projectName)}`)}
            >
              <td className="p-2 font-medium">{p.projectName}</td>
              <td className="p-2 text-muted-foreground">{p.clientName || "-"}</td>
              <td className="p-2">
                <Badge variant="outline" className="text-[10px]">{p.gateStatus || "N/A"}</Badge>
              </td>
              <td className="p-2 text-right">{p.gateReadinessPct}%</td>
              <td className="p-2 text-muted-foreground">{p.waitingOnDepartment || "-"}</td>
              <td className="p-2 text-right">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {p.daysInStage}
                </span>
              </td>
              <td className="p-2 text-muted-foreground">{p.pm || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
