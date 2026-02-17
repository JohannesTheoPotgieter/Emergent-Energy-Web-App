import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  FileText, ArrowLeft, Clock, User, CheckCircle, XCircle, AlertTriangle,
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

export default function SpLedgerDetailPage() {
  const [, params] = useRoute("/admin/sp-ledger/:id");
  const id = params?.id;

  const { data, isLoading, isError } = useQuery<any>({
    queryKey: [`/api/ledger/${id}`],
    enabled: !!id,
  });

  const entry = data?.entry || data;
  const snapshot = data?.snapshot;
  const metrics = data?.metrics || [];
  const previousSnapshot = data?.previousSnapshot;
  const previousMetrics = data?.previousMetrics || [];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6 flex items-center justify-center">
        <Clock className="h-8 w-8 animate-pulse text-muted-foreground" />
      </div>
    );
  }

  if (isError || !entry) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto">
          <Link to="/admin/sp-ledger">
            <Button variant="ghost" size="sm" data-testid="button-back-ledger">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to Ledger
            </Button>
          </Link>
          <Card className="mt-4">
            <CardContent className="py-12 text-center text-muted-foreground">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-red-500" />
              Ledger entry not found.
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Link to="/admin/sp-ledger">
            <Button variant="ghost" size="sm" data-testid="button-back-ledger">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to Ledger
            </Button>
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-detail-title">
            <FileText className="h-6 w-6" />
            Ledger Entry #{entry.id}
          </h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Event Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">File Name</p>
                <p className="font-medium" data-testid="text-detail-filename">{entry.fileName || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Event Type</p>
                <Badge variant="outline" className={EVENT_TYPE_COLORS[entry.eventType] || ""} data-testid="badge-detail-event">
                  {entry.eventType}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Modified By</p>
                <p className="flex items-center gap-1" data-testid="text-detail-modified-by">
                  <User className="h-3 w-3 text-muted-foreground" />
                  {entry.modifiedBy || "—"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Modified At</p>
                <p data-testid="text-detail-modified-at">{formatDate(entry.modifiedAt)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Old ETag</p>
                <p className="font-mono text-xs" data-testid="text-detail-old-etag">{entry.oldEtag || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">New ETag</p>
                <p className="font-mono text-xs" data-testid="text-detail-new-etag">{entry.newEtag || entry.etag || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Import Status</p>
                <Badge variant="outline" className={IMPORT_STATUS_COLORS[entry.importStatus] || ""} data-testid="badge-detail-import-status">
                  {entry.importStatus === "imported" && <CheckCircle className="h-3 w-3 mr-1" />}
                  {entry.importStatus === "failed" && <XCircle className="h-3 w-3 mr-1" />}
                  {entry.importStatus === "pending" && <Clock className="h-3 w-3 mr-1" />}
                  {entry.importStatus === "skipped" && <AlertTriangle className="h-3 w-3 mr-1" />}
                  {entry.importStatus}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Snapshot</p>
                <p data-testid="text-detail-snapshot">{entry.snapshotId ? `#${entry.snapshotId}` : "—"}</p>
              </div>
            </div>
            {entry.importStatus === "failed" && entry.errorMessage && (
              <div className="mt-4 p-3 rounded border border-red-200 bg-red-50">
                <div className="flex items-center gap-2 text-red-700 font-medium text-sm">
                  <XCircle className="h-4 w-4" />
                  Import Error
                </div>
                <p className="text-sm text-red-600 mt-1" data-testid="text-detail-error">{entry.errorMessage}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {snapshot && (
          <Card>
            <CardHeader>
              <CardTitle>Snapshot Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <p className="text-sm text-muted-foreground">Snapshot ID</p>
                  <p className="font-medium" data-testid="text-snapshot-id">#{snapshot.id}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Imported At</p>
                  <p data-testid="text-snapshot-imported-at">{formatDate(snapshot.importedAt || snapshot.createdAt)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Content Hash</p>
                  <p className="font-mono text-xs" data-testid="text-snapshot-hash">{snapshot.contentHash || "—"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Row Count</p>
                  <p data-testid="text-snapshot-rows">{snapshot.rowCount ?? "—"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Parser Version</p>
                  <p data-testid="text-snapshot-parser">{snapshot.parserVersion || "—"}</p>
                </div>
              </div>

              {metrics.length > 0 && (
                <>
                  <h3 className="font-semibold text-sm mb-2">Metrics</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sheet Name</TableHead>
                        <TableHead>Row Count</TableHead>
                        <TableHead>Checksum</TableHead>
                        <TableHead>Min Date</TableHead>
                        <TableHead>Max Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {metrics.map((m: any, i: number) => (
                        <TableRow key={i} data-testid={`row-metric-${i}`}>
                          <TableCell className="font-medium">{m.sheetName}</TableCell>
                          <TableCell>{m.rowCount ?? "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{m.checksum ? m.checksum.slice(0, 12) + "..." : "—"}</TableCell>
                          <TableCell>{m.minDate ? formatDate(m.minDate) : "—"}</TableCell>
                          <TableCell>{m.maxDate ? formatDate(m.maxDate) : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {previousSnapshot && previousMetrics.length > 0 && metrics.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>What Changed</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sheet Name</TableHead>
                    <TableHead>Row Count Delta</TableHead>
                    <TableHead>Checksum Changed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.map((m: any, i: number) => {
                    const prev = previousMetrics.find((pm: any) => pm.sheetName === m.sheetName);
                    const rowDelta = prev ? (m.rowCount ?? 0) - (prev.rowCount ?? 0) : null;
                    const checksumChanged = prev ? m.checksum !== prev.checksum : null;
                    return (
                      <TableRow key={i} data-testid={`row-change-${i}`}>
                        <TableCell className="font-medium">{m.sheetName}</TableCell>
                        <TableCell>
                          {rowDelta !== null ? (
                            <span className={rowDelta > 0 ? "text-green-600" : rowDelta < 0 ? "text-red-600" : ""}>
                              {rowDelta > 0 ? `+${rowDelta}` : rowDelta}
                            </span>
                          ) : "New sheet"}
                        </TableCell>
                        <TableCell>
                          {checksumChanged !== null ? (
                            checksumChanged ? (
                              <Badge variant="outline" className="bg-yellow-100 text-yellow-700">Yes</Badge>
                            ) : (
                              <Badge variant="outline" className="bg-green-100 text-green-700">No</Badge>
                            )
                          ) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
