import { useMemo, useState } from "react";
import { useGatesClientUpdates } from "@/hooks/use-gates";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { Search, CalendarCheck, AlertCircle } from "lucide-react";
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
  const subtitle = filtered.length === 0
    ? "No projects currently in active execution requiring client updates"
    : `${filtered.length} project${filtered.length !== 1 ? "s" : ""} in active execution${overdueCount > 0 ? ` · ${overdueCount} overdue for update` : ""}`;

  const toolbar = (
    <div className="flex items-center gap-3 w-full">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
          data-testid="input-search-gates-client-updates"
        />
      </div>
      {overdueCount > 0 && (
        <Badge variant="destructive" data-testid="badge-overdue-count">{overdueCount} overdue</Badge>
      )}
    </div>
  );

  const emptyRow = (
    <TableRow>
      <TableCell colSpan={7} className="py-12 text-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <CalendarCheck className="h-8 w-8" />
          <p className="text-sm font-medium">No projects requiring client updates</p>
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
          <TableHead>Stage</TableHead>
          <TableHead>PM</TableHead>
          <TableHead>Last Update</TableHead>
          <TableHead className="text-right">Days Ago</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filtered.length === 0 ? emptyRow : filtered.map((p: any) => (
          <TableRow
            key={p.project_id}
            className="cursor-pointer"
            onClick={() => navigate(`/project/${encodeURIComponent(p.project_name)}`)}
            data-testid={`row-client-update-${p.project_id}`}
          >
            <TableCell className="font-medium">{p.project_name}</TableCell>
            <TableCell className="text-muted-foreground">{p.client_name || "-"}</TableCell>
            <TableCell className="text-xs">{STAGE_LABELS[p.current_stage_code] || p.current_stage_code || "-"}</TableCell>
            <TableCell className="text-muted-foreground">{p.pm || "-"}</TableCell>
            <TableCell className="text-xs">
              {p.last_review_date ? new Date(p.last_review_date).toLocaleDateString() : "Never"}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {p.daysSinceUpdate !== null ? `${p.daysSinceUpdate}d` : "-"}
            </TableCell>
            <TableCell>
              {p.isOverdue ? (
                <Badge variant="destructive" className="text-[10px]">
                  <AlertCircle className="h-3 w-3 mr-0.5" /> Overdue
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] bg-emerald-100 text-emerald-800">
                  On Track
                </Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <PageLayout
      data-testid="gates-client-updates-page"
      header={
        <PageHeader
          title="Client Updates"
          subtitle={subtitle}
        />
      }
    >
      <TableLayout
        toolbar={toolbar}
        table={table}
      />
    </PageLayout>
  );
}
