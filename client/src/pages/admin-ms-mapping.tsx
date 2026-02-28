import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Users,
  Search,
  Loader2,
  CheckCircle2,
  XCircle,
  Pencil,
  Shield,
} from "lucide-react";

interface UserMapping {
  id: number;
  name: string;
  username: string;
  email: string | null;
  role: string;
  microsoftId: string | null;
}

export default function AdminMsMappingPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [editingUser, setEditingUser] = useState<UserMapping | null>(null);
  const [editMsId, setEditMsId] = useState("");
  const [editEmail, setEditEmail] = useState("");

  const { data: users = [], isLoading } = useQuery<UserMapping[]>({
    queryKey: ["/api/admin/users/microsoft-mapping"],
  });

  const updateMutation = useMutation({
    mutationFn: ({ userId, microsoftId, email }: { userId: number; microsoftId: string; email: string }) =>
      apiRequest("PATCH", `/api/admin/users/${userId}/microsoft-id`, { microsoftId, email }),
    onSuccess: () => {
      toast({ title: "Microsoft mapping updated" });
      setEditingUser(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users/microsoft-mapping"] });
    },
    onError: (err: any) =>
      toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const filtered = users.filter(u => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) || u.role.toLowerCase().includes(q);
  });

  const linkedCount = users.filter(u => u.microsoftId).length;
  const unlinkedCount = users.filter(u => !u.microsoftId).length;

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4" data-testid="admin-ms-mapping-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Shield className="h-5 w-5 text-blue-600" />
            Microsoft Account Mapping
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Link users to their Microsoft 365 accounts for SSO login
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-xs gap-1">
            <CheckCircle2 className="h-3 w-3 text-green-600" />
            {linkedCount} linked
          </Badge>
          <Badge variant="outline" className="text-xs gap-1">
            <XCircle className="h-3 w-3 text-gray-400" />
            {unlinkedCount} unlinked
          </Badge>
        </div>
      </div>

      <Card className="border-blue-200/50 bg-blue-50/30">
        <CardContent className="p-3 text-sm text-blue-800">
          <p>
            Set each user's <strong>Microsoft ID</strong> (their Azure AD Object ID) and <strong>email</strong> to enable Microsoft 365 login.
            When a user signs in with Microsoft, the system matches them by Microsoft ID or email address.
          </p>
        </CardContent>
      </Card>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search users..."
          className="pl-9 h-8 text-xs"
          value={search}
          onChange={e => setSearch(e.target.value)}
          data-testid="input-search-users"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm" data-testid="users-mapping-table">
            <thead>
              <tr className="bg-muted/40 border-b text-[11px] text-muted-foreground">
                <th className="text-left p-2.5 pl-3">User</th>
                <th className="text-left p-2.5">Role</th>
                <th className="text-left p-2.5">Email</th>
                <th className="text-left p-2.5">Microsoft ID</th>
                <th className="text-left p-2.5">Status</th>
                <th className="text-left p-2.5 w-20">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} className="border-b hover:bg-muted/10 transition-colors" data-testid={`user-row-${u.id}`}>
                  <td className="p-2.5 pl-3">
                    <div>
                      <p className="font-medium">{u.name}</p>
                      <p className="text-[10px] text-muted-foreground">{u.username}</p>
                    </div>
                  </td>
                  <td className="p-2.5">
                    <Badge variant="outline" className="text-[10px]">{u.role}</Badge>
                  </td>
                  <td className="p-2.5 text-muted-foreground text-xs">
                    {u.email || <span className="text-gray-300">Not set</span>}
                  </td>
                  <td className="p-2.5 font-mono text-[10px] text-muted-foreground max-w-[200px] truncate">
                    {u.microsoftId || <span className="text-gray-300">Not linked</span>}
                  </td>
                  <td className="p-2.5">
                    {u.microsoftId ? (
                      <Badge className="bg-green-100 text-green-700 text-[10px]">
                        <CheckCircle2 className="h-3 w-3 mr-0.5" />
                        Linked
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-gray-400">
                        Unlinked
                      </Badge>
                    )}
                  </td>
                  <td className="p-2.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => {
                        setEditingUser(u);
                        setEditMsId(u.microsoftId || "");
                        setEditEmail(u.email || "");
                      }}
                      data-testid={`button-edit-${u.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!editingUser} onOpenChange={v => { if (!v) setEditingUser(null); }}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-edit-ms-mapping">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-600" />
              Edit Microsoft Mapping — {editingUser?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Email Address</Label>
              <Input
                value={editEmail}
                onChange={e => setEditEmail(e.target.value)}
                placeholder="user@emergentenergy.co.za"
                data-testid="input-edit-email"
              />
              <p className="text-[10px] text-muted-foreground">
                Must match the user's Microsoft 365 email for SSO to work
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Microsoft ID (Azure AD Object ID)</Label>
              <Input
                value={editMsId}
                onChange={e => setEditMsId(e.target.value)}
                placeholder="e.g. a1b2c3d4-e5f6-..."
                className="font-mono text-xs"
                data-testid="input-edit-ms-id"
              />
              <p className="text-[10px] text-muted-foreground">
                Found in Azure AD user profile. Leave blank to unlink.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (editingUser) {
                  updateMutation.mutate({
                    userId: editingUser.id,
                    microsoftId: editMsId.trim(),
                    email: editEmail.trim(),
                  });
                }
              }}
              disabled={updateMutation.isPending}
              data-testid="button-save-ms-mapping"
            >
              {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
