import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  FileText, Filter, Clock, User, CheckCircle, XCircle, AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";

const EVENT_TYPE_COLORS: Record<string, string> = {
  created: "bg-blue-100 text-blue-700 border-blue-200",
  modified: "bg-yellow-100 text-yellow-700 border-yellow-200",
  deleted: "bg-red-100 text-red-700 border-red-200",
  renamed: "bg-purple-100 text-purple-700 border-purple-200",
};

const IMPORT_STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700 border-gray-200",
  imported: "bg-green-100 text-green-700 border-green-200",
  failed: "bg-red-100 text-red-700 border-red-200",
  skipped: "bg-yellow-100 text-yellow-700 border-yellow-200",
};

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  try {
    return format(new Date(d), "MMM d, yyyy h:mm a");
  } catch {
    return d;
  }
}

export default function SpLedgerPage() {
  const [, setLocation] = useLocation();
  const [eventType, setEventType] = useState<string>("all");
  const [importStatus, setImportStatus] = useState<string>("all");
  const [fileId, setFileId] = useState<string>("all");

  const queryParams = new URLSearchParams();
  if (eventType !== "all") queryParams.set("eventType", eventType);
  if (importStatus !== "all") queryParams.set("importStatus", importStatus);
  if (fileId !== "all") queryParams.set("fileId", fileId);
  const qs = queryParams.toString();

  const { data: entries = [], isLoading, isError } = useQuery<any[]>({
    queryKey: [`/api/ledger${qs ? `?${qs}` : ""}`],
  });

  const { data: spFiles = [] } = useQuery<any[]>({
    queryKey: ["/api/sp-files"],
  });

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-ledger-title">
            <FileText className="h-6 w-6" />
            SharePoint Change Ledger
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track all file change events from SharePoint and their import status.
          </p>
        </div>

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
                  <SelectItem value="deleted">Deleted</SelectItem>
                  <SelectItem value="renamed">Renamed</SelectItem>
                </SelectContent>
              </Select>
              <Select value={importStatus} onValueChange={setImportStatus}>
                <SelectTrigger className="w-[160px]" data-testid="select-import-status">
                  <SelectValue placeholder="Import Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="imported">Imported</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="skipped">Skipped</SelectItem>
                </SelectContent>
              </Select>
              <Select value={fileId} onValueChange={setFileId}>
                <SelectTrigger className="w-[200px]" data-testid="select-file-filter">
                  <SelectValue placeholder="All Files" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Files</SelectItem>
                  {spFiles.map((f: any) => (
                    <SelectItem key={f.id} value={String(f.id)}>{f.name || f.fileName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(eventType !== "all" || importStatus !== "all" || fileId !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setEventType("all"); setImportStatus("all"); setFileId("all"); }}
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
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
              No ledger entries found.
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File Name</TableHead>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Modified By</TableHead>
                  <TableHead>Modified At</TableHead>
                  <TableHead>Import Status</TableHead>
                  <TableHead>Snapshot</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry: any) => (
                  <TableRow
                    key={entry.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setLocation(`/sp-ledger/${entry.id}`)}
                    data-testid={`row-ledger-${entry.id}`}
                  >
                    <TableCell className="font-medium" data-testid={`text-filename-${entry.id}`}>
                      {entry.fileName || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={EVENT_TYPE_COLORS[entry.eventType] || ""}
                        data-testid={`badge-event-${entry.id}`}
                      >
                        {entry.eventType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3 text-muted-foreground" />
                        {entry.modifiedBy || "—"}
                      </span>
                    </TableCell>
                    <TableCell data-testid={`text-modified-at-${entry.id}`}>
                      {formatDate(entry.modifiedAt)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={IMPORT_STATUS_COLORS[entry.importStatus] || ""}
                        data-testid={`badge-import-status-${entry.id}`}
                      >
                        {entry.importStatus === "imported" && <CheckCircle className="h-3 w-3 mr-1" />}
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
                    <TableCell data-testid={`text-snapshot-${entry.id}`}>
                      {entry.snapshotId ? `#${entry.snapshotId}` : "—"}
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
