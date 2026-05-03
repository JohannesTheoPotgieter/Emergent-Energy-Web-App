import { useMemo, useState } from "react";
import { useGatesReady } from "@/hooks/use-gates";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { Search, CheckCircle } from "lucide-react";
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
import { PHASES } from "@shared/phases";

// Stage labels derive from the canonical lifecycle (shared/phases.ts).
// Deprecated codes are appended for historical row rendering only.
const STAGE_LABELS: Record<string, string> = {
  ...Object.fromEntries(PHASES.map((p) => [p.code, p.label])),
  S04_PD_PM_HANDOVER: "PD-PM Handover",
  S05_FINANCIAL_REVIEW: "Financial Review",
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

  const readyCount = filtered.length;
  const subtitle = readyCount === 0
    ? "No projects ready for review right now"
    : `${readyCount} project${readyCount !== 1 ? "s" : ""} ready for gate review`;

  const toolbar = (
    <div className="flex items-center gap-3 w-full">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search ready projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
          data-testid="input-search-gates-ready"
        />
      </div>
      <Badge className="bg-blue-100 text-blue-800" data-testid="badge-ready-count">{readyCount} ready</Badge>
    </div>
  );

  const emptyRow = (
    <TableRow>
      <TableCell colSpan={7} className="py-12 text-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <CheckCircle className="h-8 w-8" />
          <p className="text-sm font-medium">No projects ready for review</p>
          <p className="text-xs">Check back after teams mark their gates ready.</p>
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
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Readiness</TableHead>
          <TableHead>PM</TableHead>
          <TableHead>PD</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filtered.length === 0 ? emptyRow : filtered.map((p) => (
          <TableRow
            key={p.projectId}
            className="cursor-pointer"
            onClick={() => navigate(`/project/${encodeURIComponent(p.projectName)}`)}
            data-testid={`row-ready-${p.projectId}`}
          >
            <TableCell className="font-medium">{p.projectName}</TableCell>
            <TableCell className="text-muted-foreground">{p.clientName || "-"}</TableCell>
            <TableCell className="text-xs">{STAGE_LABELS[p.currentStageCode || ""] || "-"}</TableCell>
            <TableCell>
              <Badge variant="outline" className="text-[10px] bg-blue-100 text-blue-800">
                {p.gateStatus}
              </Badge>
            </TableCell>
            <TableCell className="text-right font-medium text-emerald-600 tabular-nums">{p.gateReadinessPct}%</TableCell>
            <TableCell className="text-muted-foreground">{p.pm || "-"}</TableCell>
            <TableCell className="text-muted-foreground">{p.pd || "-"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <PageLayout
      data-testid="gates-ready-page"
      header={
        <PageHeader
          title="Ready Gates"
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
