import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { engFetch } from "@/lib/eng-fetch";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Activity, Search, ChevronDown, ChevronRight, Loader2, Users, Clock,
  Calendar, BarChart3, RefreshCw,
} from "lucide-react";

// --- Types ---

interface AuditEntry {
  id: string;
  category: string;
  actionType: string;
  summary: string;
  detail: string;
  actorName: string;
  projectName: string | null;
  timestamp: string;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  categoryCounts: Record<string, number>;
}

interface AuditStats {
  total: number;
  today: number;
  thisWeek: number;
  byAction: { actionType: string; count: number }[];
  topActors: { actorId: number; actorName: string; count: number }[];
}

// --- Constants ---

const CATEGORIES = [
  { value: "all", label: "All Categories" },
  { value: "task_changes", label: "Task Changes" },
  { value: "phase_changes", label: "Phase Changes" },
  { value: "data_imports", label: "Data Imports" },
  { value: "writebacks", label: "Writebacks" },
  { value: "template_applications", label: "Template Applications" },
];

const CATEGORY_COLORS: Record<string, string> = {
  task_changes: "bg-blue-100 text-blue-700",
  phase_changes: "bg-purple-100 text-purple-700",
  data_imports: "bg-green-100 text-green-700",
  writebacks: "bg-amber-100 text-amber-700",
  template_applications: "bg-teal-100 text-teal-700",
};

const PAGE_SIZE = 50;

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString("en-ZA", {
      timeZone: "Africa/Johannesburg",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

// --- Stats Panel ---

function StatsPanel({ stats, isLoading }: { stats?: AuditStats; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map(i => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-4">
              <div className="h-4 bg-muted rounded w-20 mb-2" />
              <div className="h-8 bg-muted rounded w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const topActor = stats.topActors?.[0];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card>
        <CardContent className="p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
            <BarChart3 className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Actions</p>
            <p className="text-2xl font-bold">{stats.total.toLocaleString()}</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
            <Clock className="h-4 w-4 text-green-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Today</p>
            <p className="text-2xl font-bold">{stats.today}</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
            <Calendar className="h-4 w-4 text-purple-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">This Week</p>
            <p className="text-2xl font-bold">{stats.thisWeek}</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
            <Users className="h-4 w-4 text-amber-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Top Actor</p>
            <p className="text-lg font-bold truncate">{topActor?.actorName || "—"}</p>
            {topActor && <p className="text-xs text-muted-foreground">{topActor.count} actions</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Expandable Row ---

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
        data-testid={`audit-row-${entry.id}`}
      >
        <TableCell className="text-xs text-muted-foreground whitespace-nowrap w-[160px]">
          {formatTimestamp(entry.timestamp)}
        </TableCell>
        <TableCell className="text-xs font-medium w-[120px]">
          {entry.actorName || "System"}
        </TableCell>
        <TableCell className="w-[130px]">
          <Badge className={`text-[10px] ${CATEGORY_COLORS[entry.category] || "bg-muted text-muted-foreground"}`}>
            {entry.category.replace(/_/g, " ")}
          </Badge>
        </TableCell>
        <TableCell className="text-xs max-w-[300px] truncate">
          {entry.summary}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground truncate max-w-[150px]">
          {entry.projectName || "—"}
        </TableCell>
        <TableCell className="w-8">
          {entry.detail ? (
            expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
          ) : null}
        </TableCell>
      </TableRow>
      {expanded && entry.detail && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/30 border-b">
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono p-2 max-h-40 overflow-auto">
              {entry.detail}
            </pre>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// --- Main Page ---

export default function EngineeringAuditPage() {
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);

  // Debounce search
  const searchTimeout = useMemo(() => {
    return (value: string) => {
      const id = setTimeout(() => setDebouncedSearch(value), 300);
      return () => clearTimeout(id);
    };
  }, []);

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(0);
    searchTimeout(value);
  };

  // Queries
  const { data: stats, isLoading: statsLoading } = useQuery<AuditStats>({
    queryKey: ["eng-audit-stats"],
    queryFn: () => engFetch("/api/eng/audit-log/stats"),
    staleTime: 30000,
  });

  const queryParams = new URLSearchParams();
  if (category !== "all") queryParams.set("category", category);
  if (debouncedSearch) queryParams.set("search", debouncedSearch);
  queryParams.set("limit", String(PAGE_SIZE));
  queryParams.set("offset", String(page * PAGE_SIZE));

  const { data, isLoading, error, refetch } = useQuery<AuditResponse>({
    queryKey: ["eng-unified-audit", category, debouncedSearch, page],
    queryFn: () => engFetch(`/api/eng/unified-audit?${queryParams.toString()}`),
    staleTime: 10000,
  });

  const entries = data?.entries || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const categoryCounts = data?.categoryCounts || {};

  return (
    <ErrorBoundary>
    <div className="space-y-4 p-4 md:p-6" data-testid="engineering-audit-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center shadow-sm">
            <Activity className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-heading font-bold">Engineering Audit Log</h2>
            <p className="text-xs text-muted-foreground">Complete audit trail of all engineering module actions.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <StatsPanel stats={stats} isLoading={statsLoading} />

      {/* Category Quick Filters */}
      {Object.keys(categoryCounts).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map(c => {
            const count = c.value === "all" ? total : (categoryCounts[c.value] || 0);
            const isActive = category === c.value;
            return (
              <Button
                key={c.value}
                variant={isActive ? "default" : "outline"}
                size="sm"
                className="h-7 text-[11px] gap-1"
                onClick={() => { setCategory(c.value); setPage(0); }}
              >
                {c.label}
                <span className={`text-[10px] ${isActive ? "opacity-80" : "text-muted-foreground"}`}>
                  ({count})
                </span>
              </Button>
            );
          })}
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search actions, actors, projects..."
            className="pl-9 h-9 text-sm"
            value={search}
            onChange={e => handleSearch(e.target.value)}
            data-testid="audit-search"
          />
        </div>
        <SearchableSelect
          value={category}
          onValueChange={(v) => { setCategory(v); setPage(0); }}
          placeholder="Category"
          triggerClassName="w-[180px] h-9 text-xs"
          options={CATEGORIES}
          data-testid="audit-filter-category"
        />
      </div>

      {/* Table */}
      <Card className="shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-16 text-sm text-destructive">
              <p className="font-medium">Failed to load audit log</p>
              <p className="text-xs mt-1">{(error as Error).message}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
                <RefreshCw className="h-3 w-3 mr-1.5" /> Retry
              </Button>
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-16">
              <Activity className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">No audit entries found</p>
              {(debouncedSearch || category !== "all") && (
                <p className="text-xs text-muted-foreground/70 mt-1">Try adjusting your filters.</p>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs w-[160px]">Timestamp</TableHead>
                  <TableHead className="text-xs w-[120px]">Actor</TableHead>
                  <TableHead className="text-xs w-[130px]">Category</TableHead>
                  <TableHead className="text-xs">Summary</TableHead>
                  <TableHead className="text-xs w-[150px]">Project</TableHead>
                  <TableHead className="text-xs w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map(entry => (
                  <AuditRow key={entry.id} entry={entry} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <p>
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </p>
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={page === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}
