import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { AlertTriangle, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function CcDangerousActionsCard() {
  const { toast } = useToast();

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

        {/* Audit log trimming has been permanently removed. The audit log is
            append-only and must not be destructible via the admin UI. */}
      </CardContent>
    </Card>
  );
}
