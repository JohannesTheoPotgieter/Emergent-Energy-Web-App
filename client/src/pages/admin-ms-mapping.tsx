import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
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
  Clock,
  Mail,
  Link2,
  Unlink,
} from "lucide-react";

interface UserMapping {
  id: number;
  name: string;
  username: string;
  email: string | null;
  role: string;
  microsoftId: string | null;
}

type LinkStatus = "linked" | "ready" | "not_configured";

function getUserStatus(u: UserMapping): LinkStatus {
  if (u.microsoftId) return "linked";
  if (u.email) return "ready";
  return "not_configured";
}

const statusConfig: Record<LinkStatus, { label: string; className: string; icon: React.ReactNode }> = {
  linked: {
    label: "Linked",
    className: "bg-green-100 text-green-700",
    icon: <CheckCircle2 className="h-3 w-3 mr-0.5" />,
  },
  ready: {
    label: "Awaiting Login",
    className: "bg-amber-100 text-amber-700",
    icon: <Clock className="h-3 w-3 mr-0.5" />,
  },
  not_configured: {
    label: "No Email",
    className: "bg-gray-100 text-gray-500",
    icon: <XCircle className="h-3 w-3 mr-0.5" />,
  },
};

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

  const unlinkMutation = useMutation({
    mutationFn: ({ userId, email }: { userId: number; email: string }) =>
      apiRequest("PATCH", `/api/admin/users/${userId}/microsoft-id`, { microsoftId: "", email }),
    onSuccess: () => {
      toast({ title: "Microsoft link removed" });
      setEditingUser(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users/microsoft-mapping"] });
    },
    onError: (err: any) =>
      toast({ title: "Unlink failed", description: err.message, variant: "destructive" }),
  });

  const filtered = users.filter(u => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) || u.role.toLowerCase().includes(q);
  });

  const linkedCount = users.filter(u => getUserStatus(u) === "linked").length;
  const readyCount = users.filter(u => getUserStatus(u) === "ready").length;
  const unconfiguredCount = users.filter(u => getUserStatus(u) === "not_configured").length;

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
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Badge variant="outline" className="text-[10px] gap-1">
            <CheckCircle2 className="h-3 w-3 text-green-600" />
            {linkedCount} linked
          </Badge>
          <Badge variant="outline" className="text-[10px] gap-1">
            <Clock className="h-3 w-3 text-amber-500" />
            {readyCount} awaiting
          </Badge>
          <Badge variant="outline" className="text-[10px] gap-1">
            <XCircle className="h-3 w-3 text-gray-400" />
            {unconfiguredCount} no email
          </Badge>
        </div>
      </div>

      <Card className="border-blue-200/50 bg-blue-50/30">
        <CardContent className="p-3 text-sm text-blue-800 space-y-1.5">
          <p className="font-medium">How it works:</p>
          <ol className="list-decimal list-inside text-xs space-y-0.5 text-blue-700">
            <li>Set each user's <strong>email address</strong> to match their Microsoft 365 email</li>
            <li>When the user signs in with Microsoft for the first time, the system <strong>automatically links</strong> their account</li>
            <li>No need to manually set the Microsoft ID — it is captured on first login</li>
          </ol>
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
                <th className="text-left p-2.5">
                  <div className="flex items-center gap-1">
                    <Mail className="h-3 w-3" /> Email
                  </div>
                </th>
                <th className="text-left p-2.5">Status</th>
                <th className="text-left p-2.5 w-20">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => {
                const status = getUserStatus(u);
                const cfg = statusConfig[status];
                return (
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
                    <td className="p-2.5 text-xs">
                      {u.email ? (
                        <span className="text-slate-700">{u.email}</span>
                      ) : (
                        <span className="text-gray-300 italic">Not set</span>
                      )}
                    </td>
                    <td className="p-2.5">
                      <Badge className={`text-[10px] ${cfg.className}`}>
                        {cfg.icon}
                        {cfg.label}
                      </Badge>
                      {status === "linked" && (
                        <span className="block text-[9px] text-muted-foreground mt-0.5 font-mono truncate max-w-[140px]" title={u.microsoftId || undefined}>
                          ID: {u.microsoftId?.substring(0, 12)}...
                        </span>
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
                );
              })}
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
                Must match the user's Microsoft 365 email. When they sign in via Microsoft for the first time, their account will be linked automatically.
              </p>
            </div>

            {editingUser?.microsoftId ? (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Microsoft ID (auto-linked)</Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2 bg-muted/50 rounded-md border text-xs font-mono text-muted-foreground truncate">
                    {editMsId || "Not linked"}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 gap-1"
                    onClick={() => {
                      if (editingUser) {
                        unlinkMutation.mutate({ userId: editingUser.id, email: editEmail.trim() });
                      }
                    }}
                    disabled={unlinkMutation.isPending}
                    data-testid="button-unlink-ms"
                  >
                    <Unlink className="h-3 w-3" />
                    Unlink
                  </Button>
                </div>
                <p className="text-[10px] text-green-600 flex items-center gap-1">
                  <Link2 className="h-3 w-3" />
                  Linked — captured automatically on Microsoft sign-in
                </p>
              </div>
            ) : (
              <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-md">
                <p className="text-[10px] text-amber-700 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Microsoft ID will be captured automatically when the user signs in with Microsoft for the first time
                </p>
              </div>
            )}
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
