import { useMemo, useState } from "react";
import { useGatesQueries } from "@/hooks/use-collaboration-workflow";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { Search, MessageSquare, Clock, AlertCircle } from "lucide-react";
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
import type { ProjectQuery } from "@shared/schema";

const STATUS_BADGES: Record<string, { label: string; color: string }> = {
  open: { label: "Open", color: "bg-blue-100 text-blue-700" },
  in_progress: { label: "In Progress", color: "bg-amber-100 text-amber-700" },
  answered: { label: "Answered", color: "bg-green-100 text-green-700" },
  closed: { label: "Closed", color: "bg-gray-100 text-gray-500" },
};

export default function GatesQueriesPage() {
  const { data, isLoading, error } = useGatesQueries();
  const [search, setSearch] = useState("");
  const [, navigate] = useLocation();

  const queries = useMemo(() => {
    if (!data?.queries) return [];
    return data.queries.map((q: ProjectQuery) => ({
      ...q,
      ageDays: Math.floor((Date.now() - new Date(q.createdAt).getTime()) / 86400000),
      isStale: Math.floor((Date.now() - new Date(q.createdAt).getTime()) / 86400000) > 3,
    }));
  }, [data?.queries]);

  const filtered = useMemo(() => {
    if (!search) return queries;
    const term = search.toLowerCase();
    return queries.filter((q: any) =>
      (q.subject || "").toLowerCase().includes(term) ||
      (q.queryType || "").toLowerCase().includes(term) ||
      (q.assignedToDepartment || "").toLowerCase().includes(term)
    );
  }, [queries, search]);

  if (isLoading) return <PageSkeleton />;
  if (error) return <PageError message="Failed to load queries" />;

  const staleCount = filtered.filter((q: any) => q.isStale).length;
  const subtitle = filtered.length === 0
    ? "No open queries found"
    : `${filtered.length} open quer${filtered.length !== 1 ? "ies" : "y"}${staleCount > 0 ? ` · ${staleCount} overdue (>3 days)` : ""}`;

  const toolbar = (
    <div className="flex items-center gap-3 w-full">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search queries..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          data-testid="input-search-gates-queries"
        />
      </div>
      {staleCount > 0 && (
        <Badge className="bg-red-100 text-red-700" data-testid="badge-stale-count">
          <AlertCircle className="mr-1 h-3 w-3" /> {staleCount} overdue
        </Badge>
      )}
    </div>
  );

  const emptyRow = (
    <TableRow>
      <TableCell colSpan={6} className="py-12 text-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <MessageSquare className="h-8 w-8" />
          <p className="text-sm font-medium">No open queries found</p>
        </div>
      </TableCell>
    </TableRow>
  );

  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Subject</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Assigned To</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Age</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filtered.length === 0 ? emptyRow : filtered.map((q: any) => {
          const statusBadge = STATUS_BADGES[q.status] || STATUS_BADGES.open;
          return (
            <TableRow
              key={q.id}
              className={`cursor-pointer ${q.isStale ? "bg-red-50" : ""}`}
              onClick={() => navigate(`/project/${q.projectId}`)}
              data-testid={`row-query-${q.id}`}
            >
              <TableCell>
                <div className="font-medium">{q.subject}</div>
                {q.description && <div className="text-xs text-muted-foreground line-clamp-1">{q.description}</div>}
              </TableCell>
              <TableCell>{q.queryType}</TableCell>
              <TableCell>{q.assignedToDepartment}</TableCell>
              <TableCell>
                {q.priority === "urgent" && <Badge className="bg-red-100 text-red-700">Urgent</Badge>}
                {q.priority === "normal" && <span className="text-muted-foreground">Normal</span>}
              </TableCell>
              <TableCell>
                <span className={`flex items-center gap-1 tabular-nums ${q.isStale ? "text-red-600 font-medium" : ""}`}>
                  <Clock className="h-3 w-3" /> {q.ageDays}d
                </span>
              </TableCell>
              <TableCell>
                <Badge className={statusBadge.color}>{statusBadge.label}</Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );

  return (
    <PageLayout
      data-testid="gates-queries-page"
      header={
        <PageHeader
          title="Open Queries"
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
