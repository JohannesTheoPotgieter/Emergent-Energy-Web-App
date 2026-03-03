import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Users, Building2, Pencil, X, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

async function qFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

interface Client {
  id: number;
  clientId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  createdBy: number | null;
  updatedBy: number | null;
}

interface ProjectCount {
  clientId: number;
  count: number;
}

export default function ClientsPage() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ["clients", search],
    queryFn: () =>
      qFetch(`/api/pd/clients${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  });

  const { data: projectCounts = [] } = useQuery<ProjectCount[]>({
    queryKey: ["clients-project-counts"],
    queryFn: () => qFetch("/api/pd/clients/project-counts"),
    retry: false,
    placeholderData: [],
  });

  const projectCountMap = new Map(
    projectCounts.map((pc) => [pc.clientId, pc.count])
  );

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      qFetch("/api/pd/clients", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["clients-project-counts"] });
      setCreateOpen(false);
      setNewName("");
      toast({ title: "Client created successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      qFetch(`/api/pd/clients/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setEditingId(null);
      setEditName("");
      toast({ title: "Client updated successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleCreate = () => {
    if (!newName.trim()) return;
    createMutation.mutate(newName.trim());
  };

  const startEdit = (client: Client) => {
    setEditingId(client.id);
    setEditName(client.name);
  };

  const handleEdit = () => {
    if (!editName.trim() || editingId === null) return;
    editMutation.mutate({ id: editingId, name: editName.trim() });
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shadow-lg">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">
              Clients
            </h1>
            <p className="text-sm text-muted-foreground" data-testid="text-client-count">
              {clients.length} client{clients.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          data-testid="button-new-client"
          className="gap-2"
        >
          <Plus className="w-4 h-4" />
          New Client
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search clients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
          data-testid="input-search-clients"
        />
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Client ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="w-36">Created</TableHead>
              <TableHead className="w-32 text-center">Projects</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                  Loading clients...
                </TableCell>
              </TableRow>
            ) : clients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                  {search ? "No clients match your search" : "No clients yet. Create your first client."}
                </TableCell>
              </TableRow>
            ) : (
              clients.map((client) => (
                <TableRow
                  key={client.id}
                  data-testid={`row-client-${client.id}`}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => {
                    if (editingId !== client.id) startEdit(client);
                  }}
                >
                  <TableCell>
                    <Badge variant="outline" data-testid={`text-client-id-${client.id}`}>
                      {client.clientId}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {editingId === client.id ? (
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleEdit();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="h-8 max-w-xs"
                          autoFocus
                          data-testid={`input-edit-client-${client.id}`}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleEdit}
                          disabled={editMutation.isPending}
                          data-testid={`button-save-client-${client.id}`}
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingId(null)}
                          data-testid={`button-cancel-edit-${client.id}`}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <span className="font-medium" data-testid={`text-client-name-${client.id}`}>
                        {client.name}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm" data-testid={`text-client-created-${client.id}`}>
                    {client.createdAt ? format(new Date(client.createdAt), "dd MMM yyyy") : "—"}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant="secondary"
                      data-testid={`text-client-projects-${client.id}`}
                    >
                      <Users className="w-3 h-3 mr-1" />
                      {projectCountMap.get(client.id) ?? 0}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {editingId !== client.id && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(client);
                        }}
                        data-testid={`button-edit-client-${client.id}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Client</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Input
              placeholder="Client name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
              autoFocus
              data-testid="input-new-client-name"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              data-testid="button-cancel-create"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || createMutation.isPending}
              data-testid="button-confirm-create"
            >
              {createMutation.isPending ? "Creating..." : "Create Client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
