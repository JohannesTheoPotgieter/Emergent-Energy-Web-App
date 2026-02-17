import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Clock, Database, AlertTriangle } from "lucide-react";
import { format } from "date-fns";

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  try {
    return format(new Date(d), "MMM d, yyyy h:mm a");
  } catch {
    return d;
  }
}

export default function SpSnapshotDetailPage() {
  const [, params] = useRoute("/admin/sp-snapshots/:id");
  const id = params?.id;

  const { data, isLoading, isError } = useQuery<any>({
    queryKey: [`/api/snapshots/${id}`],
    enabled: !!id,
  });

  const snapshot = data?.snapshot || data;
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

  if (isError || !snapshot) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto">
          <Link to="/admin/sp-snapshots">
            <Button variant="ghost" size="sm" data-testid="button-back-snapshots">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to Snapshots
            </Button>
          </Link>
          <Card className="mt-4">
            <CardContent className="py-12 text-center text-muted-foreground">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-red-500" />
              Snapshot not found.
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
          <Link to="/admin/sp-snapshots">
            <Button variant="ghost" size="sm" data-testid="button-back-snapshots">
              <ArrowLeft className="h-4 w-4 mr-1" /> Back to Snapshots
            </Button>
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-snapshot-detail-title">
            <Database className="h-6 w-6" />
            Snapshot #{snapshot.id}
          </h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Snapshot Metadata</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">File</p>
                <p className="font-medium" data-testid="text-detail-file">{snapshot.fileName || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Imported At</p>
                <p data-testid="text-detail-imported-at">{formatDate(snapshot.importedAt || snapshot.createdAt)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">ETag</p>
                <p className="font-mono text-xs" data-testid="text-detail-etag">{snapshot.etag || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Content Hash</p>
                <p className="font-mono text-xs" data-testid="text-detail-hash">{snapshot.contentHash || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Row Count</p>
                <p data-testid="text-detail-rows">{snapshot.rowCount ?? "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Parser Version</p>
                <p data-testid="text-detail-parser">{snapshot.parserVersion || "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {metrics.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Metrics</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
        )}

        {previousSnapshot && previousMetrics.length > 0 && metrics.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>What Changed</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                Comparing with previous snapshot #{previousSnapshot.id} from {formatDate(previousSnapshot.importedAt || previousSnapshot.createdAt)}
              </p>
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
