import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  RefreshCw,
  FileSpreadsheet,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  User,
} from "lucide-react";

interface SpFile {
  id: number;
  siteId: string;
  driveId: string;
  itemId: string;
  fileName: string;
  path: string | null;
  lastSeenEtag: string | null;
  lastSeenCtag: string | null;
  spLastModifiedAt: string | null;
  spLastModifiedByName: string | null;
  spLastModifiedByEmail: string | null;
  isActive: boolean;
  firstSeenAt: string;
  lastCheckedAt: string;
}

interface SpSettings {
  siteId: string;
  driveId: string;
  folderItemId: string;
  folderPath: string;
  intervalMinutes: number;
  enabled: boolean;
  lastRunAt: string | null;
}

export default function SpFileRefreshPage() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [refreshingFileId, setRefreshingFileId] = useState<string | null>(null);

  const { data: files, isLoading } = useQuery<SpFile[]>({
    queryKey: ["/api/sp-files"],
    queryFn: async () => {
      const res = await fetch("/api/sp-files", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load files");
      return res.json();
    },
  });

  const { data: settings } = useQuery<SpSettings>({
    queryKey: ["/api/admin/sp-settings"],
    queryFn: async () => {
      const res = await fetch("/api/admin/sp-settings", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load settings");
      return res.json();
    },
    enabled: isAdmin,
  });

  const refreshMutation = useMutation({
    mutationFn: async (file: SpFile) => {
      setRefreshingFileId(file.itemId);
      const res = await fetch("/api/admin/import/single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          driveId: file.driveId,
          siteId: file.siteId,
          itemId: file.itemId,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Import failed");
      }
      return res.json();
    },
    onSuccess: (result) => {
      setRefreshingFileId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/sp-files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/snapshots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/import/runs"] });
      const status = result.summary?.importStatus;
      if (status === "imported") {
        toast({
          title: "File refreshed",
          description: `${result.summary?.fileName} imported successfully.`,
        });
      } else if (status === "skipped") {
        toast({
          title: "No changes detected",
          description: `${result.summary?.fileName} content is unchanged from last snapshot.`,
        });
      } else {
        toast({
          title: "Import issue",
          description: `${result.summary?.fileName}: ${status}`,
          variant: "destructive",
        });
      }
    },
    onError: (err: Error) => {
      setRefreshingFileId(null);
      toast({ title: "Refresh failed", description: err.message, variant: "destructive" });
    },
  });

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Card className="max-w-md w-full">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2" data-testid="text-access-denied">Access Denied</h2>
            <p className="text-muted-foreground">You do not have admin privileges to access this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const activeFiles = (files || []).filter(f => f.isActive);
  const isExcel = (name: string) =>
    name.endsWith(".xlsx") || name.endsWith(".xlsm") || name.endsWith(".xls");

  return (
    <div className="space-y-6 max-w-[900px] mx-auto" data-testid="sp-file-refresh-page">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50 flex items-center gap-2" data-testid="text-page-title">
          <RefreshCw className="h-7 w-7 text-blue-600" />
          File Refresh
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Re-import individual tracker files from SharePoint
        </p>
      </header>

      {!settings?.siteId && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-900/10">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm font-medium">SharePoint not configured. Set up connection in SP Settings first.</span>
            </div>
          </CardContent>
        </Card>
      )}

      {activeFiles.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileSpreadsheet className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-600 mb-2" data-testid="text-no-files">No tracked files</h3>
            <p className="text-sm text-muted-foreground">
              Run a full import first to detect files in the SharePoint folder.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {activeFiles.length} tracked file{activeFiles.length !== 1 ? "s" : ""}
            </p>
          </div>

          {activeFiles.map((file) => (
            <Card key={file.id} className="hover:shadow-sm transition-shadow" data-testid={`file-card-${file.id}`}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <FileSpreadsheet
                      className={`h-8 w-8 shrink-0 ${
                        isExcel(file.fileName) ? "text-green-600" : "text-gray-400"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate" data-testid={`text-filename-${file.id}`}>
                        {file.fileName}
                      </p>
                      {file.path && (
                        <p className="text-xs text-muted-foreground truncate">
                          {file.path}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        {file.spLastModifiedAt && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(file.spLastModifiedAt).toLocaleDateString()}
                          </span>
                        )}
                        {file.spLastModifiedByName && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {file.spLastModifiedByName}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-xs">
                      {file.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => refreshMutation.mutate(file)}
                      disabled={refreshMutation.isPending}
                      data-testid={`button-refresh-${file.id}`}
                    >
                      {refreshMutation.isPending && refreshingFileId === file.itemId ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-1" />
                      )}
                      Refresh
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
