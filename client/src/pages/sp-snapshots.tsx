import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FileText, Filter, Clock, AlertTriangle, Database } from "lucide-react";
import { format } from "date-fns";

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  try {
    return format(new Date(d), "MMM d, yyyy h:mm a");
  } catch {
    return d;
  }
}

export default function SpSnapshotsPage() {
  const [, setLocation] = useLocation();
  const [fileId, setFileId] = useState<string>("all");

  const qs = fileId !== "all" ? `?fileId=${fileId}` : "";

  const { data: snapshots = [], isLoading, isError } = useQuery<any[]>({
    queryKey: [`/api/snapshots${qs}`],
  });

  const { data: spFiles = [] } = useQuery<any[]>({
    queryKey: ["/api/sp-files"],
  });

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-snapshots-title">
            <Database className="h-6 w-6" />
            SharePoint Snapshots
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Browse imported file snapshots and their metadata.
          </p>
        </div>

        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Filter by file:</span>
              </div>
              <Select value={fileId} onValueChange={setFileId}>
                <SelectTrigger className="w-[200px]" data-testid="select-snapshot-file">
                  <SelectValue placeholder="All Files" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Files</SelectItem>
                  {spFiles.map((f: any) => (
                    <SelectItem key={f.id} value={String(f.id)}>{f.name || f.fileName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          {isLoading ? (
            <CardContent className="py-12 text-center text-muted-foreground">
              <Clock className="h-8 w-8 mx-auto mb-2 animate-pulse" />
              Loading snapshots...
            </CardContent>
          ) : isError ? (
            <CardContent className="py-12 text-center text-muted-foreground">
              <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-red-500" />
              Failed to load snapshots.
            </CardContent>
          ) : snapshots.length === 0 ? (
            <CardContent className="py-12 text-center text-muted-foreground">
              <Database className="h-8 w-8 mx-auto mb-2 opacity-30" />
              No snapshots found.
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>File Name</TableHead>
                  <TableHead>Imported At</TableHead>
                  <TableHead>Content Hash</TableHead>
                  <TableHead>Row Count</TableHead>
                  <TableHead>Parser Version</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshots.map((snap: any) => (
                  <TableRow
                    key={snap.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setLocation(`/admin/sp-snapshots/${snap.id}`)}
                    data-testid={`row-snapshot-${snap.id}`}
                  >
                    <TableCell className="font-mono" data-testid={`text-snapshot-id-${snap.id}`}>
                      #{snap.id}
                    </TableCell>
                    <TableCell className="font-medium" data-testid={`text-snapshot-file-${snap.id}`}>
                      {snap.fileName || "—"}
                    </TableCell>
                    <TableCell data-testid={`text-snapshot-date-${snap.id}`}>
                      {formatDate(snap.importedAt || snap.createdAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs" data-testid={`text-snapshot-hash-${snap.id}`}>
                      {snap.contentHash ? snap.contentHash.slice(0, 12) + "..." : "—"}
                    </TableCell>
                    <TableCell data-testid={`text-snapshot-rows-${snap.id}`}>
                      {snap.rowCount ?? "—"}
                    </TableCell>
                    <TableCell data-testid={`text-snapshot-parser-${snap.id}`}>
                      <Badge variant="outline">{snap.parserVersion || "—"}</Badge>
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
