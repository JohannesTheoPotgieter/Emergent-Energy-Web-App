import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAdminFetch } from "@/hooks/use-admin-fetch";
import { AdminQueryState } from "@/components/admin/admin-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Users, LogOut, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getQueryError } from "./cc-utils";
import type { SessionData } from "./cc-types";

export function CcActiveSessionsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const sessionsQuery = useAdminFetch<SessionData>(
    "/api/admin/control-center/active-sessions",
    ["admin-control-sessions"],
  );
  const sessions = sessionsQuery.data ?? { count: 0, sessions: [] };

  const forceLogout = useMutation({
    mutationFn: async (sid: string) => {
      const token = localStorage.getItem("auth_token");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/admin/control-center/sessions/${encodeURIComponent(sid)}`, {
        method: "DELETE",
        headers,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to terminate session");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-control-sessions"] });
      toast({ title: "Session terminated", description: "User has been logged out." });
    },
  });

  return (
    <Card data-testid="card-active-sessions">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-indigo-600" />
          Active Sessions
          {sessions.count > 0 && (
            <Badge variant="outline" className="ml-2">{sessions.count}</Badge>
          )}
        </CardTitle>
        <CardDescription>Currently logged-in users</CardDescription>
      </CardHeader>
      <CardContent>
        <AdminQueryState
          isLoading={sessionsQuery.isLoading}
          error={sessionsQuery.error ? getQueryError(sessionsQuery.error, "Active session data could not be loaded.") : null}
          onRetry={() => { void sessionsQuery.refetch(); }}
          empty={sessions.sessions.length === 0}
          emptyTitle="No active sessions found"
          emptyDescription="When users are signed in, their current sessions will appear here."
          loadingLabel="Loading active sessions..."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="w-[80px]">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.sessions.map((session) => (
                <TableRow key={session.sid} data-testid={`row-session-${session.sid}`}>
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium" data-testid={`text-session-user-${session.sid}`}>
                        {session.userName || "Unknown"}
                      </p>
                      <p className="text-xs text-muted-foreground">{session.username || `ID: ${session.userId}`}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{session.userRole || "—"}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(session.expiresAt).toLocaleString()}
                    </div>
                  </TableCell>
                  <TableCell>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 text-red-600 hover:text-red-700 hover:bg-red-50" data-testid={`button-force-logout-${session.sid}`}>
                          <LogOut className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Force Logout?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will terminate {session.userName || "this user"}'s session immediately.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => forceLogout.mutate(session.sid)}
                            className="bg-red-600 hover:bg-red-700"
                            data-testid={`button-confirm-force-logout-${session.sid}`}
                          >
                            Force Logout
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </AdminQueryState>
      </CardContent>
    </Card>
  );
}
