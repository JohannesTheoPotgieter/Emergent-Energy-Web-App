/**
 * Quality Task Board — minimal first cut.
 *
 * Lists open quality work items (source/discipline = quality) in a single
 * filterable table. Uses the existing /api/eng/tasks endpoint and filters
 * client-side for quality-sourced rows so the page works on the current
 * server architecture (no new endpoint required). A dedicated
 * /api/quality/tasks endpoint can replace this in a follow-up without
 * changing the page shape.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { engFetch } from "@/lib/eng-fetch";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout } from "@/components/layout";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search } from "lucide-react";
import { Link } from "wouter";

interface RawTask {
  id: number;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  source?: string | null;
  discipline?: string | null;
  dueDate?: string | null;
  projectId?: number | null;
  projectName?: string | null;
  assigneeId?: number | null;
  assigneeName?: string | null;
}

function isQualityTask(t: RawTask): boolean {
  const src = (t.source || "").toLowerCase();
  const disc = (t.discipline || "").toLowerCase();
  return src.includes("quality") || disc.includes("quality") || src === "ncr" || src === "qa";
}

function statusVariant(status?: string | null) {
  const s = (status || "").toLowerCase();
  if (s.includes("done") || s.includes("closed")) return "secondary" as const;
  if (s.includes("block") || s.includes("hold")) return "destructive" as const;
  if (s.includes("progress")) return "default" as const;
  return "outline" as const;
}

export default function QualityTasksPage() {
  const tasksQuery = useQuery<RawTask[]>({
    queryKey: ["quality-tasks"],
    queryFn: async () => {
      const data = await engFetch("/api/eng/tasks");
      const list: RawTask[] = Array.isArray(data) ? data : (data?.tasks ?? data?.items ?? []);
      return list.filter(isQualityTask);
    },
    staleTime: 30_000,
  });

  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasksQuery.data ?? [];
    return (tasksQuery.data ?? []).filter((t) =>
      [t.title, t.description, t.projectName, t.assigneeName].some(
        (v) => typeof v === "string" && v.toLowerCase().includes(q),
      ),
    );
  }, [tasksQuery.data, search]);

  if (tasksQuery.isLoading) {
    return (
      <PageLayout>
        <PageHeader title="Quality Task Board" />
        <PageSkeleton />
      </PageLayout>
    );
  }

  if (tasksQuery.isError) {
    return (
      <PageLayout>
        <PageHeader title="Quality Task Board" />
        <PageError
          title="Could not load quality tasks"
          message={tasksQuery.error instanceof Error ? tasksQuery.error.message : "Unknown error"}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PageHeader
        title="Quality Task Board"
        subtitle="Open quality and NCR work items across the program. Click a task to open it in the engineering task drawer."
      />
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-0 sm:min-w-[240px] sm:max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search title, project, assignee…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
                data-testid="input-quality-task-search"
              />
            </div>
            <div className="ml-auto text-xs sm:text-sm text-muted-foreground whitespace-nowrap">
              {filtered.length} of {tasksQuery.data?.length ?? 0} task{(tasksQuery.data?.length ?? 0) === 1 ? "" : "s"}
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead className="hidden md:table-cell">Project</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Priority</TableHead>
                <TableHead className="hidden lg:table-cell">Assignee</TableHead>
                <TableHead className="hidden md:table-cell">Due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                    No quality tasks match your filter.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((t) => (
                  <TableRow key={t.id} data-testid={`row-quality-task-${t.id}`}>
                    <TableCell className="font-medium">
                      <Link href={`/engineering/tasks?task=${t.id}`} className="hover:underline">
                        {t.title || `Task #${t.id}`}
                      </Link>
                      {/* On mobile, surface project + due inline under the title */}
                      <div className="md:hidden mt-0.5 text-[11px] text-muted-foreground flex flex-wrap gap-x-2">
                        {t.projectName && <span>{t.projectName}</span>}
                        {t.dueDate && <span>· Due {new Date(t.dueDate).toLocaleDateString()}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{t.projectName ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(t.status)}>{t.status ?? "—"}</Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{t.priority ?? "—"}</TableCell>
                    <TableCell className="hidden lg:table-cell">{t.assigneeName ?? "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">{t.dueDate ? new Date(t.dueDate).toLocaleDateString() : "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PageLayout>
  );
}
