import { useMemo, useState } from "react";
import { useGatesBlocked } from "@/hooks/use-gates";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { Search, Clock, AlertCircle } from "lucide-react";
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

// Stage labels derive from the canonical lifecycle (shared/phases.ts)
// to keep this screen in lock-step with the single source of truth.
// Deprecated codes (S04_PD_PM_HANDOVER, S05_FINANCIAL_REVIEW) are
// added afterwards so historical project rows still render a label.
const STAGE_LABELS: Record<string, string> = {
  ...Object.fromEntries(PHASES.map((p) => [p.code, p.label])),
  S04_PD_PM_HANDOVER: "PD-PM Handover",
  S05_FINANCIAL_REVIEW: "Financial Review",
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

  const blockedCount = filtered.length;
  const subtitle = blockedCount === 0
    ? "All projects are progressing — no gates currently blocked"
    : `${blockedCount} project${blockedCount !== 1 ? "s" : ""} with blocked gate state`;

  const toolbar = (
    <div className="flex items-center gap-3 w-full">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search blocked projects..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
          data-testid="input-search-gates-blocked"
        />
      </div>
      <Badge variant="destructive" data-testid="badge-blocked-count">{blockedCount} blocked</Badge>
    </div>
  );

  const emptyRow = (
    <TableRow>
      <TableCell colSpan={7} className="py-12 text-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <AlertCircle className="h-8 w-8 text-emerald-500" />
          <p className="text-sm font-medium">No blocked gates</p>
          <p className="text-xs">All projects are progressing.</p>
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
          <TableHead>Waiting On</TableHead>
          <TableHead className="text-right">Days Blocked</TableHead>
          <TableHead className="text-right">Exceptions</TableHead>
          <TableHead>PM</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filtered.length === 0 ? emptyRow : filtered.map((p) => (
          <TableRow
            key={p.projectId}
            className="cursor-pointer"
            onClick={() => navigate(`/project/${encodeURIComponent(p.projectName)}`)}
            data-testid={`row-blocked-${p.projectId}`}
          >
            <TableCell className="font-medium">{p.projectName}</TableCell>
            <TableCell className="text-muted-foreground">{p.clientName || "-"}</TableCell>
            <TableCell className="text-xs">{STAGE_LABELS[p.currentStageCode || ""] || "-"}</TableCell>
            <TableCell className="text-orange-600">{p.waitingOnDepartment || "-"}</TableCell>
            <TableCell className="text-right font-medium text-red-600 tabular-nums">
              <span className="inline-flex items-center gap-1 justify-end">
                <Clock className="h-3 w-3" /> {p.daysInStage}
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums">{p.openExceptionCount || "-"}</TableCell>
            <TableCell className="text-muted-foreground">{p.pm || "-"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <PageLayout
      data-testid="gates-blocked-page"
      header={
        <PageHeader
          title="Blocked Gates"
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
