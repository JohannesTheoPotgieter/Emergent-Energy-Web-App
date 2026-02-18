import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Users, Loader2 } from "lucide-react";

async function engFetch(url: string) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers, credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

interface TeamMember {
  id: number;
  projectName: string;
  userId: number;
  roleOnProject: string;
  userName?: string;
  userEmail?: string;
  createdAt: string;
}

interface UserInfo {
  id: number;
  name: string;
  email: string;
  role: string;
}

export default function EngineeringTeamsPage() {
  const { data: users = [], isLoading: usersLoading } = useQuery<UserInfo[]>({
    queryKey: ["eng-users"],
    queryFn: () => engFetch("/api/eng/users"),
  });

  return (
    <div data-testid="eng-teams-page" className="space-y-6">
      <div className="flex items-center gap-3">
        <Users className="h-8 w-8 text-emerald-500" />
        <div>
          <h2 className="text-2xl sm:text-3xl font-heading font-bold" data-testid="text-teams-title">Project Teams</h2>
          <p className="text-sm text-muted-foreground">Manage team assignments and project roles</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Team Members</CardTitle>
        </CardHeader>
        <CardContent>
          {usersLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground" data-testid="text-teams-empty">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg font-medium">No team members</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>System Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map(user => (
                    <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                      <TableCell className="font-medium" data-testid={`text-user-name-${user.id}`}>{user.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground" data-testid={`text-user-email-${user.id}`}>{user.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] capitalize" data-testid={`badge-user-role-${user.id}`}>
                          {user.role.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
