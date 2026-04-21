import { useMemo, useState } from "react";
import { useGatesHandovers } from "@/hooks/use-gates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { Search, Handshake, Clock } from "lucide-react";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout, TableLayout } from "@/components/layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

  const subtitle = filtered.length === 0
    ? "No projects in this handover view"
    : `${filtered.length} project${filtered.length !== 1 ? "s" : ""} in the ${VIEW_TABS.find((t) => t.key === activeView)?.label.toLowerCase()} view`;

  const viewTabsRow = (
    <div className="flex items-center gap-1 overflow-x-auto pb-1 w-full">
      {VIEW_TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => setActiveView(tab.key)}
          className={`px-2.5 py-1 text-xs rounded-full whitespace-nowrap transition-colors ${
            activeView === tab.key
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
          data-testid={`tab-handover-${tab.key}`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  const toolbar = (
    <div className="flex items-center gap-3 w-full">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search handover projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
          data-testid="input-search-gates-handovers"
        />
      </div>
      <span className="text-sm text-muted-foreground whitespace-nowrap" data-testid="text-handover-count">
        {filtered.length} project{filtered.length !== 1 ? "s" : ""}
      </span>
    </div>
  );

  const emptyRow = (
    <TableRow>
      <TableCell colSpan={11} className="py-12 text-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Handshake className="h-8 w-8" />
          <p className="text-sm font-medium">No projects in this handover view</p>
        </div>
      </TableCell>
    </TableRow>
  );

  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Project</TableHead>
          <TableHead>Client</TableHead>
          <TableHead>PM</TableHead>
          <TableHead>CM</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="text-right">Pack %</TableHead>
          <TableHead className="text-right">Snags</TableHead>
          <TableHead>Acceptance</TableHead>
          <TableHead>SLA</TableHead>
          <TableHead className="text-right">Days</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filtered.length === 0 ? emptyRow : filtered.map((p: any) => (
          <TableRow key={p.projectId} data-testid={`row-handover-${p.projectId}`}>
            <TableCell
              className="font-medium cursor-pointer hover:underline"
              onClick={() => navigate(`/project/${encodeURIComponent(p.projectName)}`)}
            >
              {p.projectName}
            </TableCell>
            <TableCell className="text-muted-foreground">{p.clientName || "-"}</TableCell>
            <TableCell className="text-muted-foreground text-xs">{p.pm || "-"}</TableCell>
            <TableCell className="text-muted-foreground text-xs">{p.constructionManager || "-"}</TableCell>
            <TableCell>
              <Badge variant="outline" className="text-[10px]">{p.handoverType}</Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <span className={p.packCompletenessPct < 100 ? "text-amber-600 font-medium" : "text-green-600"}>
                {p.packCompletenessPct}%
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {p.openSnags > 0 ? (
                <span className="text-red-600 font-medium">{p.openSnags}</span>
              ) : (
                <span className="text-muted-foreground">0</span>
              )}
            </TableCell>
            <TableCell className="text-xs">{p.acceptanceStatus || "pending"}</TableCell>
            <TableCell>
              <Badge variant="outline" className={`text-[10px] ${slaStatusBadge(p.slaStatus)}`}>
                {p.slaStatus}
              </Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <span className="inline-flex items-center gap-1 text-xs">
                <Clock className="h-3 w-3" /> {p.daysWaiting}
              </span>
            </TableCell>
            <TableCell>
              <Button
                variant="ghost" size="sm" className="h-6 px-2 text-[10px]"
                onClick={() => navigate(`/project/${encodeURIComponent(p.projectName)}`)}
              >
                Open
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <PageLayout
      data-testid="gates-handovers-page"
      header={
        <PageHeader
          title="Handover Queue"
          subtitle={subtitle}
        />
      }
    >
      {viewTabsRow}
      <TableLayout
        toolbar={toolbar}
        table={table}
      />
    </PageLayout>
  );
}
