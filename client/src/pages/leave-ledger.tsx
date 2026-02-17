import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookOpen, Search, Filter, Calendar, CalendarDays, List, Clock, CheckCircle, XCircle, AlertTriangle, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface LeaveLedgerEntry {
  id: number;
  runId: number;
  externalLeaveId: string;
  eventType: string;
  detectedAt: string;
  effectiveStartDate: string | null;
  effectiveEndDate: string | null;
  employeeDisplayName: string | null;
  approvedBy: string | null;
  importStatus: string;
  errorMessage: string | null;
  oldHash: string | null;
  newHash: string | null;
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  created: "bg-green-100 text-green-700 border-green-200",
  modified: "bg-blue-100 text-blue-700 border-blue-200",
  cancelled: "bg-red-100 text-red-700 border-red-200",
};

const IMPORT_STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700 border-gray-200",
  applied: "bg-green-100 text-green-700 border-green-200",
  failed: "bg-red-100 text-red-700 border-red-200",
  skipped: "bg-yellow-100 text-yellow-700 border-yellow-200",
};

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return format(new Date(d), "dd MMM yyyy");
  } catch {
    return d;
  }
}

function formatDateTime(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return format(new Date(d), "MMM d, yyyy h:mm a");
  } catch {
    return d;
  }
}

export default function LeaveLedgerPage() {
  const [eventType, setEventType] = useState<string>("all");
  const [importStatus, setImportStatus] = useState<string>("all");
  const [employee, setEmployee] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const queryParams = new URLSearchParams();
  if (eventType !== "all") queryParams.set("eventType", eventType);
  if (importStatus !== "all") queryParams.set("importStatus", importStatus);
  if (employee.trim()) queryParams.set("employee", employee.trim());
  if (fromDate) queryParams.set("from", fromDate);
  if (toDate) queryParams.set("to", toDate);
  const qs = queryParams.toString();

  const { data: entries = [], isLoading, isError } = useQuery<LeaveLedgerEntry[]>({
    queryKey: [`/api/leave/ledger${qs ? `?${qs}` : ""}`],
  });

  const hasFilters = eventType !== "all" || importStatus !== "all" || employee.trim() !== "" || fromDate !== "" || toDate !== "";

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-leave-ledger-title">
            <BookOpen className="h-6 w-6" />
            Leave Change Ledger
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track all leave change events and their import status.
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
            <Button variant="ghost" size="sm" data-testid="link-leave-list">
              <List className="h-4 w-4 mr-1" />
              List
            </Button>
          </Link>
          <Link href="/leave/ledger">
            <Button variant="default" size="sm" data-testid="link-leave-ledger">
              <BookOpen className="h-4 w-4 mr-1" />
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
              <Select value={eventType} onValueChange={setEventType}>
                <SelectTrigger className="w-[160px]" data-testid="select-event-type">
                  <SelectValue placeholder="Event Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Events</SelectItem>
                  <SelectItem value="created">Created</SelectItem>
                  <SelectItem value="modified">Modified</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Select value={importStatus} onValueChange={setImportStatus}>
                <SelectTrigger className="w-[160px]" data-testid="select-import-status">
                  <SelectValue placeholder="Import Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="applied">Applied</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="skipped">Skipped</SelectItem>
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search employee..."
                  value={employee}
                  onChange={(e) => setEmployee(e.target.value)}
                  className="pl-8 w-[200px]"
                  data-testid="input-employee-search"
                />
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-[150px]"
                  data-testid="input-from-date"
                  placeholder="From"
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-[150px]"
                  data-testid="input-to-date"
                  placeholder="To"
                />
              </div>
              {hasFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setEventType("all"); setImportStatus("all"); setEmployee(""); setFromDate(""); setToDate(""); }}
                  data-testid="button-clear-filters"
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          {isLoading ? (
            <CardContent className="py-12 text-center text-muted-foreground">
              <Clock className="h-8 w-8 mx-auto mb-2 animate-pulse" />
              Loading ledger entries...
            </CardContent>
          ) : isError ? (
            <CardContent className="py-12 text-center text-muted-foreground">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-red-500" />
              Failed to load ledger entries.
            </CardContent>
          ) : entries.length === 0 ? (
            <CardContent className="py-12 text-center text-muted-foreground">
              <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-30" />
              No ledger entries found.
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Detected At</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead>Approved By</TableHead>
                  <TableHead>Import Status</TableHead>
                  <TableHead>Run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id} data-testid={`row-leave-ledger-${entry.id}`}>
                    <TableCell data-testid={`text-detected-at-${entry.id}`}>
                      {formatDateTime(entry.detectedAt)}
                    </TableCell>
                    <TableCell className="font-medium" data-testid={`text-employee-${entry.id}`}>
                      {entry.employeeDisplayName || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={EVENT_TYPE_COLORS[entry.eventType] || "bg-gray-100 text-gray-700 border-gray-200"}
                        data-testid={`badge-event-type-${entry.id}`}
                      >
                        {entry.eventType}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid={`text-start-date-${entry.id}`}>
                      {formatDate(entry.effectiveStartDate)}
                    </TableCell>
                    <TableCell data-testid={`text-end-date-${entry.id}`}>
                      {formatDate(entry.effectiveEndDate)}
                    </TableCell>
                    <TableCell data-testid={`text-approved-by-${entry.id}`}>
                      {entry.approvedBy || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={IMPORT_STATUS_COLORS[entry.importStatus] || ""}
                        data-testid={`badge-import-status-${entry.id}`}
                      >
                        {entry.importStatus === "applied" && <CheckCircle className="h-3 w-3 mr-1" />}
                        {entry.importStatus === "failed" && <XCircle className="h-3 w-3 mr-1" />}
                        {entry.importStatus === "pending" && <Clock className="h-3 w-3 mr-1" />}
                        {entry.importStatus === "skipped" && <AlertTriangle className="h-3 w-3 mr-1" />}
                        {entry.importStatus}
                      </Badge>
                      {entry.importStatus === "failed" && entry.errorMessage && (
                        <p className="text-xs text-red-500 mt-1" data-testid={`text-error-${entry.id}`}>
                          {entry.errorMessage}
                        </p>
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-run-${entry.id}`}>
                      {entry.runId ? (
                        <Link href={`/admin/sp-import-runs`}>
                          <Button variant="ghost" size="sm" data-testid={`link-run-${entry.id}`}>
                            <ExternalLink className="h-3 w-3 mr-1" />
                            #{entry.runId}
                          </Button>
                        </Link>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}
