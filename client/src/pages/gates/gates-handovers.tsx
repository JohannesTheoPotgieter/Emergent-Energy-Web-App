import { useMemo, useState } from "react";
import { useGatesHandovers } from "@/hooks/use-gates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { Search, Handshake, Clock, AlertTriangle, FileText, CheckCircle } from "lucide-react";
import { PageError, PageSkeleton } from "@/components/ui/page-states";

type HandoverView = "all" | "om_queue" | "client_queue" | "missing_docs" | "sseg_pending" | "accepted" | "waiting_matriarch" | "waiting_client";

const VIEW_TABS: { key: HandoverView; label: string }[] = [
  { key: "all", label: "All" },
  { key: "om_queue", label: "O&M Queue" },
  { key: "client_queue", label: "Client Queue" },
  { key: "missing_docs", label: "Missing Docs" },
  { key: "sseg_pending", label: "SSEG Pending" },
  { key: "accepted", label: "Accepted" },
  { key: "waiting_matriarch", label: "Waiting Matriarch" },
  { key: "waiting_client", label: "Waiting Client" },
];

function slaStatusBadge(sla: string) {
  switch (sla) {
    case "overdue": return "bg-red-100 text-red-800";
    case "approaching": return "bg-amber-100 text-amber-800";
    case "within": return "bg-green-100 text-green-800";
    case "accepted": return "bg-blue-100 text-blue-800";
    default: return "bg-gray-100 text-gray-600";
  }
}

export default function GatesHandoversPage() {
  const [activeView, setActiveView] = useState<HandoverView>("all");
  const { data, isLoading, error } = useGatesHandovers(activeView === "all" ? undefined : activeView);
  const [search, setSearch] = useState("");
  const [, navigate] = useLocation();

  const filtered = useMemo(() => {
    if (!data?.projects) return [];
    if (!search) return data.projects;
    const term = search.toLowerCase();
    return data.projects.filter((p: any) =>
      (p.projectName || "").toLowerCase().includes(term) ||
      (p.clientName || "").toLowerCase().includes(term) ||
      (p.pm || "").toLowerCase().includes(term)
    );
  }, [data?.projects, search]);

  if (isLoading) return <PageSkeleton />;
  if (error) return <PageError message="Failed to load handover queue" />;

  return (
    <div className="space-y-4">
      {/* View tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveView(tab.key)}
            className={`px-2.5 py-1 text-xs rounded-full whitespace-nowrap transition-colors ${
              activeView === tab.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
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
        <span className="text-sm text-muted-foreground">{filtered.length} project{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Handshake className="h-8 w-8 mx-auto mb-2" />
          <p>No projects in this handover view.</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-2 font-medium">Project</th>
                <th className="text-left p-2 font-medium">Client</th>
                <th className="text-left p-2 font-medium">PM</th>
                <th className="text-left p-2 font-medium">CM</th>
                <th className="text-left p-2 font-medium">Type</th>
                <th className="text-right p-2 font-medium">Pack %</th>
                <th className="text-right p-2 font-medium">Snags</th>
                <th className="text-left p-2 font-medium">Acceptance</th>
                <th className="text-left p-2 font-medium">SLA</th>
                <th className="text-right p-2 font-medium">Days</th>
                <th className="text-left p-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p: any) => (
                <tr
                  key={p.projectId}
                  className="border-b hover:bg-muted/30"
                >
                  <td
                    className="p-2 font-medium cursor-pointer hover:underline"
                    onClick={() => navigate(`/project/${encodeURIComponent(p.projectName)}`)}
                  >
                    {p.projectName}
                  </td>
                  <td className="p-2 text-muted-foreground">{p.clientName || "-"}</td>
                  <td className="p-2 text-muted-foreground text-xs">{p.pm || "-"}</td>
                  <td className="p-2 text-muted-foreground text-xs">{p.constructionManager || "-"}</td>
                  <td className="p-2">
                    <Badge variant="outline" className="text-[10px]">{p.handoverType}</Badge>
                  </td>
                  <td className="p-2 text-right">
                    <span className={p.packCompletenessPct < 100 ? "text-amber-600 font-medium" : "text-green-600"}>
                      {p.packCompletenessPct}%
                    </span>
                  </td>
                  <td className="p-2 text-right">
                    {p.openSnags > 0 ? (
                      <span className="text-red-600 font-medium">{p.openSnags}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="p-2 text-xs">{p.acceptanceStatus || "pending"}</td>
                  <td className="p-2">
                    <Badge variant="outline" className={`text-[10px] ${slaStatusBadge(p.slaStatus)}`}>
                      {p.slaStatus}
                    </Badge>
                  </td>
                  <td className="p-2 text-right">
                    <span className="inline-flex items-center gap-1 text-xs">
                      <Clock className="h-3 w-3" /> {p.daysWaiting}
                    </span>
                  </td>
                  <td className="p-2">
                    <Button
                      variant="ghost" size="sm" className="h-6 px-2 text-[10px]"
                      onClick={() => navigate(`/project/${encodeURIComponent(p.projectName)}`)}
                    >
                      Open
                    </Button>
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
