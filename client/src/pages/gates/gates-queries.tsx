import { useMemo, useState } from "react";
import { useGatesQueries } from "@/hooks/use-collaboration-workflow";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import { Search, MessageSquare, Clock, AlertCircle } from "lucide-react";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search queries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        {staleCount > 0 && (
          <Badge className="bg-red-100 text-red-700">
            <AlertCircle className="mr-1 h-3 w-3" /> {staleCount} overdue ({'>'}3 days)
          </Badge>
        )}
        <Badge variant="secondary">{filtered.length} open queries</Badge>
      </div>

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-3 py-2 text-left font-medium">Subject</th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-left font-medium">Assigned To</th>
              <th className="px-3 py-2 text-left font-medium">Priority</th>
              <th className="px-3 py-2 text-left font-medium">Age</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((q: any) => {
              const statusBadge = STATUS_BADGES[q.status] || STATUS_BADGES.open;
              return (
                <tr
                  key={q.id}
                  className={`border-b hover:bg-muted/30 cursor-pointer ${q.isStale ? "bg-red-50" : ""}`}
                  onClick={() => navigate(`/project/${q.projectId}`)}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{q.subject}</div>
                    {q.description && <div className="text-xs text-muted-foreground line-clamp-1">{q.description}</div>}
                  </td>
                  <td className="px-3 py-2">{q.queryType}</td>
                  <td className="px-3 py-2">{q.assignedToDepartment}</td>
                  <td className="px-3 py-2">
                    {q.priority === "urgent" && <Badge className="bg-red-100 text-red-700">Urgent</Badge>}
                    {q.priority === "normal" && <span className="text-muted-foreground">Normal</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`flex items-center gap-1 ${q.isStale ? "text-red-600 font-medium" : ""}`}>
                      <Clock className="h-3 w-3" /> {q.ageDays}d
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge className={statusBadge.color}>{statusBadge.label}</Badge>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  No open queries found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
