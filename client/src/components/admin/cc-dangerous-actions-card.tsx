import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { AlertTriangle, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function CcDangerousActionsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [clearDays, setClearDays] = useState("90");

  const clearSessions = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/admin/control-center/dangerous/clear-sessions", {
        method: "POST",
        headers,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to clear sessions");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sessions cleared", description: "All user sessions have been cleared." });
    },
  });

  const clearAuditLog = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/admin/control-center/dangerous/clear-audit-log", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ olderThanDays: parseInt(clearDays) || 90 }),
      });
      if (!res.ok) throw new Error("Failed to clear audit log");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-control-health"] });
      toast({ title: "Audit log trimmed", description: `Entries older than ${clearDays} days removed.` });
    },
  });

  return (
    <Card className="border-red-200" data-testid="card-dangerous-actions">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 text-red-700">
          <AlertTriangle className="h-4 w-4" />
          Dangerous Actions
        </CardTitle>
        <CardDescription>These actions can affect all users. Use with caution.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-3 rounded-lg border border-red-100 bg-red-50/50">
          <div>
            <p className="text-sm font-medium">Clear All Sessions</p>
            <p className="text-xs text-muted-foreground">Force all users to re-login</p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" data-testid="button-clear-sessions">
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Clear
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear All Sessions?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will force all users to re-authenticate. You will also be logged out.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-cancel-clear-sessions">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => clearSessions.mutate()}
                  className="bg-red-600 hover:bg-red-700"
                  data-testid="button-confirm-clear-sessions"
                >
                  {clearSessions.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  Clear Sessions
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg border border-red-100 bg-red-50/50">
          <div>
            <p className="text-sm font-medium">Trim Audit Log</p>
            <p className="text-xs text-muted-foreground">Remove old audit entries</p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={clearDays}
              onChange={(e) => setClearDays(e.target.value)}
              className="w-20 h-8 text-sm"
              placeholder="90"
              data-testid="input-clear-days"
            />
            <span className="text-xs text-muted-foreground whitespace-nowrap">days old</span>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" data-testid="button-clear-audit">
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Trim
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Trim Audit Log?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete audit events older than {clearDays} days. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-clear-audit">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => clearAuditLog.mutate()}
                    className="bg-red-600 hover:bg-red-700"
                    data-testid="button-confirm-clear-audit"
                  >
                    {clearAuditLog.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Trim Audit Log
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
