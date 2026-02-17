import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Search, Filter, List, ArrowUpDown, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Link } from "wouter";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface LeaveEvent {
  id: number;
  externalLeaveId: string;
  employeeDisplayName: string;
  leaveType: string | null;
  startDate: string;
  endDate: string;
  isAllDay: boolean;
  status: string;
  approvedBy: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  approved: "bg-green-100 text-green-700 border-green-200",
  pending: "bg-yellow-100 text-yellow-700 border-yellow-200",
  declined: "bg-red-100 text-red-700 border-red-200",
  cancelled: "bg-gray-100 text-gray-700 border-gray-200",
};

function getStatusColor(status: string): string {
  return STATUS_COLORS[status.toLowerCase()] || "bg-gray-100 text-gray-700 border-gray-200";
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return format(parseISO(d), "dd MMM yyyy");
  } catch {
    return d;
  }
}

const PAGE_SIZE = 25;

export default function LeaveListPage() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [sortField, setSortField] = useState<"startDate" | "endDate" | "employeeDisplayName">("startDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const queryParams = new URLSearchParams();
  if (fromDate) queryParams.set("from", fromDate);
  if (toDate) queryParams.set("to", toDate);
  if (employeeSearch.trim()) queryParams.set("employee", employeeSearch.trim());
  if (statusFilter !== "all") queryParams.set("status", statusFilter);
  const qs = queryParams.toString();

  const { data: events = [], isLoading, isError } = useQuery<LeaveEvent[]>({
    queryKey: ["/api/leave/events", fromDate, toDate, employeeSearch, statusFilter],
    queryFn: async () => {
      const res = await fetch(`/api/leave/events${qs ? `?${qs}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load leave events");
      return res.json();
    },
  });

  const sorted = [...events].sort((a, b) => {
    let cmp = 0;
    if (sortField === "employeeDisplayName") {
      cmp = a.employeeDisplayName.localeCompare(b.employeeDisplayName);
    } else {
      cmp = a[sortField].localeCompare(b[sortField]);
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = sorted.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  function toggleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
    setPage(0);
  }

  function clearFilters() {
    setFromDate("");
    setToDate("");
    setEmployeeSearch("");
    setStatusFilter("all");
    setPage(0);
  }

  const hasActiveFilters = fromDate || toDate || employeeSearch.trim() || statusFilter !== "all";

  return (
    <div className="space-y-6 max-w-[1200px] mx-auto" data-testid="leave-list-page">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50 flex items-center gap-2" data-testid="text-page-title">
          <List className="h-7 w-7 text-blue-600" />
          Leave List
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Browse all leave events in a table view
        </p>
      </header>

      <nav className="flex items-center gap-1 border-b pb-2" data-testid="nav-leave-tabs">
        <Link href="/leave">
          <Button variant="ghost" size="sm" data-testid="link-leave-calendar">
            <CalendarDays className="h-4 w-4 mr-1" />
            Calendar
          </Button>
        </Link>
        <Link href="/leave/list">
          <Button variant="default" size="sm" data-testid="link-leave-list">
            <List className="h-4 w-4 mr-1" />
            List
          </Button>
        </Link>
        <Link href="/leave/ledger">
          <Button variant="ghost" size="sm" data-testid="link-leave-ledger">
            <Calendar className="h-4 w-4 mr-1" />
            Ledger
          </Button>
        </Link>
      </nav>

      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filters:</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">From</label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); setPage(0); }}
                className="w-[150px] h-9"
                data-testid="input-from-date"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">To</label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => { setToDate(e.target.value); setPage(0); }}
                className="w-[150px] h-9"
                data-testid="input-to-date"
              />
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search employee..."
                value={employeeSearch}
                onChange={(e) => { setEmployeeSearch(e.target.value); setPage(0); }}
                className="pl-8 w-[200px] h-9"
                data-testid="input-employee-search"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[150px] h-9" data-testid="select-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="declined">Declined</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                data-testid="button-clear-filters"
              >
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        {isLoading ? (
          <CardContent className="py-12 text-center text-muted-foreground">
            <div className="animate-pulse space-y-2">
              <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>Loading leave events...</p>
            </div>
          </CardContent>
        ) : isError ? (
          <CardContent className="py-12 text-center text-muted-foreground">
            <Calendar className="h-8 w-8 mx-auto mb-2 text-red-500" />
            <p>Failed to load leave events.</p>
          </CardContent>
        ) : events.length === 0 ? (
          <CardContent className="py-12 text-center text-muted-foreground">
            <Calendar className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p data-testid="text-empty-state">No leave events found.</p>
          </CardContent>
        ) : (
          <>
            <Table data-testid="table-leave-events">
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 -ml-2 font-medium"
                      onClick={() => toggleSort("employeeDisplayName")}
                      data-testid="button-sort-employee"
                    >
                      Employee
                      <ArrowUpDown className="h-3 w-3 ml-1" />
                    </Button>
                  </TableHead>
                  <TableHead>Leave Type</TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 -ml-2 font-medium"
                      onClick={() => toggleSort("startDate")}
                      data-testid="button-sort-start-date"
                    >
                      Start Date
                      <ArrowUpDown className="h-3 w-3 ml-1" />
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 -ml-2 font-medium"
                      onClick={() => toggleSort("endDate")}
                      data-testid="button-sort-end-date"
                    >
                      End Date
                      <ArrowUpDown className="h-3 w-3 ml-1" />
                    </Button>
                  </TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Approved By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((event) => (
                  <TableRow key={event.id} data-testid={`row-leave-${event.id}`}>
                    <TableCell className="font-medium" data-testid={`text-employee-${event.id}`}>
                      {event.employeeDisplayName}
                    </TableCell>
                    <TableCell data-testid={`text-leave-type-${event.id}`}>
                      {event.leaveType || "—"}
                    </TableCell>
                    <TableCell data-testid={`text-start-date-${event.id}`}>
                      {formatDate(event.startDate)}
                    </TableCell>
                    <TableCell data-testid={`text-end-date-${event.id}`}>
                      {formatDate(event.endDate)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={getStatusColor(event.status)}
                        data-testid={`badge-status-${event.id}`}
                      >
                        {event.status}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid={`text-approved-by-${event.id}`}>
                      {event.approvedBy || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between px-4 py-3 border-t" data-testid="pagination-controls">
              <p className="text-sm text-muted-foreground" data-testid="text-result-count">
                Showing {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, sorted.length)} of {sorted.length} events
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground" data-testid="text-page-info">
                  Page {currentPage + 1} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages - 1}
                  onClick={() => setPage(currentPage + 1)}
                  data-testid="button-next-page"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
