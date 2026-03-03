import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Users, Building2, Pencil, X, Check, ChevronDown, ChevronRight, Link2, Unlink, ChevronsUpDown } from "lucide-react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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

interface ProjectSummary {
  project_info_id: number;
  project_name: string;
  client_id: number | null;
  phase: string | null;
}

export default function ClientsPage() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignClientId, setAssignClientId] = useState<number | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [projectPopoverOpen, setProjectPopoverOpen] = useState(false);
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

  const { data: allProjects = [] } = useQuery<ProjectSummary[]>({
    queryKey: ["projects-summary-for-clients"],
    queryFn: () => qFetch("/api/projects-summary").then((data: any[]) =>
      data.map((p: any) => ({
        project_info_id: p.project_info_id,
        project_name: p.project_name,
        client_id: p.client_id,
        phase: p.phase,
      }))
    ),
  });

  const projectCountMap = new Map(
    projectCounts.map((pc) => [pc.clientId, pc.count])
  );

  const clientProjects = useMemo(() => {
    if (expandedId === null) return [];
    return allProjects.filter(p => p.client_id === expandedId);
  }, [expandedId, allProjects]);

  const unassignedProjects = useMemo(() => {
    return allProjects
      .filter(p => p.client_id === null)
      .sort((a, b) => a.project_name.localeCompare(b.project_name));
  }, [allProjects]);

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

  const assignProjectMutation = useMutation({
    mutationFn: ({ projectInfoId, clientId }: { projectInfoId: number; clientId: number | null }) =>
      qFetch(`/api/project-info/${projectInfoId}`, {
        method: "PATCH",
        body: JSON.stringify({ clientId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["clients-project-counts"] });
      queryClient.invalidateQueries({ queryKey: ["projects-summary-for-clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects-summary"] });
      setAssignOpen(false);
      setSelectedProjectId("");
      toast({ title: "Project assigned successfully" });
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

  const toggleExpand = (id: number) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const openAssignDialog = (clientId: number) => {
    setAssignClientId(clientId);
    setSelectedProjectId("");
    setAssignOpen(true);
  };

  const handleAssignProject = () => {
    if (!selectedProjectId || assignClientId === null) return;
    assignProjectMutation.mutate({
      projectInfoId: Number(selectedProjectId),
      clientId: assignClientId,
    });
  };

  const handleUnassignProject = (projectInfoId: number) => {
    assignProjectMutation.mutate({
      projectInfoId,
      clientId: null,
    });
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
              <TableHead className="w-10" />
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
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  Loading clients...
                </TableCell>
              </TableRow>
            ) : clients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  {search ? "No clients match your search" : "No clients yet. Create your first client."}
                </TableCell>
              </TableRow>
            ) : (
              clients.map((client) => {
                const isExpanded = expandedId === client.id;
                const count = projectCountMap.get(client.id) ?? 0;
                return (
                  <> 
                    <TableRow
                      key={client.id}
                      data-testid={`row-client-${client.id}`}
                      className="cursor-pointer hover:bg-muted/50"
                    >
                      <TableCell className="w-10 px-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => toggleExpand(client.id)}
                          data-testid={`button-expand-${client.id}`}
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </Button>
                      </TableCell>
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
                          <span
                            className="font-medium"
                            data-testid={`text-client-name-${client.id}`}
                            onClick={() => startEdit(client)}
                          >
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
                          {count}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
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
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${client.id}-expanded`}>
                        <TableCell colSpan={6} className="bg-muted/30 p-0">
                          <div className="px-6 py-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-semibold text-muted-foreground">
                                Linked Projects ({clientProjects.length})
                              </h4>
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5"
                                onClick={() => openAssignDialog(client.id)}
                                data-testid={`button-assign-project-${client.id}`}
                              >
                                <Link2 className="w-3.5 h-3.5" />
                                Assign Project
                              </Button>
                            </div>
                            {clientProjects.length === 0 ? (
                              <p className="text-sm text-muted-foreground py-2">
                                No projects linked to this client yet.
                              </p>
                            ) : (
                              <div className="space-y-1">
                                {clientProjects.map((p) => (
                                  <div
                                    key={p.project_info_id}
                                    className="flex items-center justify-between py-2 px-3 rounded-md bg-background border"
                                    data-testid={`linked-project-${p.project_info_id}`}
                                  >
                                    <div className="flex items-center gap-3">
                                      <span className="font-medium text-sm">{p.project_name}</span>
                                      {p.phase && (
                                        <Badge variant="outline" className="text-xs">
                                          {p.phase}
                                        </Badge>
                                      )}
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-muted-foreground hover:text-red-500"
                                      onClick={() => handleUnassignProject(p.project_info_id)}
                                      disabled={assignProjectMutation.isPending}
                                      data-testid={`button-unlink-${p.project_info_id}`}
                                    >
                                      <Unlink className="w-3.5 h-3.5" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })
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

      <Dialog open={assignOpen} onOpenChange={(open) => { if (!open) { setAssignOpen(false); setSelectedProjectId(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Project to Client</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Search and select a project to link to this client. Only unassigned projects are shown.
            </p>
            <Popover open={projectPopoverOpen} onOpenChange={setProjectPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={projectPopoverOpen}
                  className="w-full justify-between font-normal"
                  data-testid="select-assign-project"
                >
                  {selectedProjectId
                    ? unassignedProjects.find(p => String(p.project_info_id) === selectedProjectId)?.project_name || "Select a project..."
                    : "Search and select a project..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search projects..." data-testid="input-search-assign-project" />
                  <CommandList>
                    <CommandEmpty>No projects found.</CommandEmpty>
                    <CommandGroup>
                      {unassignedProjects.map((p) => (
                        <CommandItem
                          key={p.project_info_id}
                          value={p.project_name}
                          onSelect={() => {
                            setSelectedProjectId(String(p.project_info_id));
                            setProjectPopoverOpen(false);
                          }}
                          data-testid={`option-project-${p.project_info_id}`}
                        >
                          <Check className={`mr-2 h-4 w-4 ${selectedProjectId === String(p.project_info_id) ? "opacity-100" : "opacity-0"}`} />
                          {p.project_name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setAssignOpen(false); setSelectedProjectId(""); }}
              data-testid="button-cancel-assign"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAssignProject}
              disabled={!selectedProjectId || assignProjectMutation.isPending}
              data-testid="button-confirm-assign"
            >
              {assignProjectMutation.isPending ? "Assigning..." : "Assign Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
