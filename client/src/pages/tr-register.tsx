import { useState, useMemo, useCallback, DragEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ClipboardList, Plus, Loader2, Check, Link2, Unlink, Wand2,
  CheckCircle2, XCircle, EyeOff, Search, Pencil, Database, GripVertical,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem("auth_token");
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

interface TrItem {
  id: number;
  trId: string;
  department: string;
  actionDescription: string;
  ragStatus: string;
  owners: string[];
  support: string[];
  dateRaised: string | null;
  dueDate: string | null;
  status: string;
  dateCompleted: string | null;
  outcomeComments: string | null;
  supportingInfo: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  linkedProjectCount?: number;
}

interface TrItemDetail extends TrItem {
  linkedProjects: LinkedProject[];
}

interface LinkedProject {
  id: number;
  trItemId: number;
  projectId: number;
  autoCreatedPmTaskId: number | null;
  linkStatus: string | null;
  createdAt: string;
  createdBy: string | null;
  projectName: string | null;
  pm: string | null;
}

interface Suggestion {
  projectId: number;
  projectName: string;
  score: number;
  rationale: string[];
}

interface ProjectSummary {
  id: number;
  projectName: string;
  pm: string | null;
}

const RAG_STYLES: Record<string, string> = {
  Red: "bg-red-100 text-red-700",
  Amber: "bg-amber-100 text-amber-700",
  Green: "bg-emerald-100 text-emerald-700",
};

const STATUS_STYLES: Record<string, string> = {
  Active: "bg-blue-100 text-blue-700",
  Completed: "bg-gray-100 text-gray-700",
};

function formatDate(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

function isOverdue(item: TrItem): boolean {
  if (item.status !== "Active" || !item.dueDate) return false;
  return new Date(item.dueDate) < new Date();
}

const MANAGER_ROLES = ["COO_ADMIN", "CEO_ADMIN", "PROGRAM_MANAGER", "admin"];

export default function TrRegisterPage() {
  const { user } = useAuth();
  const companyRole = typeof window !== "undefined" ? localStorage.getItem("company_role") : null;
  const effectiveRole = companyRole || user?.role || "";
  const canManage = MANAGER_ROLES.includes(effectiveRole);
  const canAdmin = ["COO_ADMIN", "CEO_ADMIN", "admin"].includes(effectiveRole);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState("list");
  const [statusFilter, setStatusFilter] = useState("active");
  const [ragFilter, setRagFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [overdueFilter, setOverdueFilter] = useState(false);
  const [linkedFilter, setLinkedFilter] = useState("all");

  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const [linkConfirm, setLinkConfirm] = useState<{ trItem: TrItemDetail; project: ProjectSummary } | null>(null);
  const [showLinkSearch, setShowLinkSearch] = useState(false);
  const [linkSearchQuery, setLinkSearchQuery] = useState("");

  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestionConfirm, setSuggestionConfirm] = useState<{ trItem: TrItemDetail; suggestion: Suggestion; project: ProjectSummary | null } | null>(null);

  const [createForm, setCreateForm] = useState({
    trId: "", department: "", actionDescription: "", ragStatus: "Green",
    owners: "", support: "", dueDate: "", outcomeComments: "", supportingInfo: "",
  });

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter === "active" ? "Active" : "Completed");
    if (ragFilter !== "all") params.set("ragStatus", ragFilter);
    if (deptFilter) params.set("department", deptFilter);
    if (ownerFilter) params.set("owner", ownerFilter);
    if (overdueFilter) params.set("overdue", "true");
    if (linkedFilter === "linked") params.set("linked", "true");
    if (linkedFilter === "unlinked") params.set("linked", "false");
    return params.toString();
  }, [statusFilter, ragFilter, deptFilter, ownerFilter, overdueFilter, linkedFilter]);

  const { data: items = [], isLoading } = useQuery<TrItem[]>({
    queryKey: ["/api/tr-register", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/tr-register?${queryParams}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch TR items");
      return res.json();
    },
  });

  const { data: boardItems = [], isLoading: boardLoading } = useQuery<TrItem[]>({
    queryKey: ["/api/tr-register", "board-all"],
    queryFn: async () => {
      const res = await fetch(`/api/tr-register`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch TR items");
      return res.json();
    },
    enabled: activeTab === "board",
  });

  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const { data: itemDetail, isLoading: detailLoading } = useQuery<TrItemDetail>({
    queryKey: ["/api/tr-register", selectedItemId],
    queryFn: async () => {
      const res = await fetch(`/api/tr-register/${selectedItemId}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch TR item detail");
      return res.json();
    },
    enabled: !!selectedItemId,
  });

  const { data: projectsRaw = [] } = useQuery<any>({
    queryKey: ["/api/projects-summary"],
    queryFn: async () => {
      const res = await fetch("/api/projects-summary", { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const projects: ProjectSummary[] = useMemo(() => {
    const arr = Array.isArray(projectsRaw) ? projectsRaw : projectsRaw?.projects || [];
    return arr.map((p: any) => ({
      id: p.id,
      projectName: p.projectName || p.project_name || "",
      pm: p.pm || null,
    }));
  }, [projectsRaw]);

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });
  }, [items]);

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/tr-register/seed", { credentials: "include", method: "POST", headers: getAuthHeaders() });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Seed failed"); }
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tr-register"] });
      toast({ title: "Seed Complete", description: data.message || `${data.count || 0} items seeded` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await fetch("/api/tr-register", { credentials: "include", method: "POST", headers: getAuthHeaders(), body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Create failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tr-register"] });
      toast({ title: "TR Item Created" });
      setCreateDialogOpen(false);
      setCreateForm({ trId: "", department: "", actionDescription: "", ragStatus: "Green", owners: "", support: "", dueDate: "", outcomeComments: "", supportingInfo: "" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await fetch(`/api/tr-register/${id}`, { credentials: "include", method: "PATCH", headers: getAuthHeaders(), body: JSON.stringify(data) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Update failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tr-register"] });
      setEditField(null);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const completeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/tr-register/${id}/complete`, { credentials: "include", method: "PATCH", headers: getAuthHeaders() });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Complete failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tr-register"] });
      toast({ title: "TR Item Completed" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const linkMutation = useMutation({
    mutationFn: async ({ trItemId, projectId }: { trItemId: number; projectId: number }) => {
      const res = await fetch(`/api/tr-register/${trItemId}/link`, { credentials: "include", method: "POST", headers: getAuthHeaders(), body: JSON.stringify({ projectId }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Link failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tr-register"] });
      toast({ title: "Project Linked" });
      setLinkConfirm(null);
      setShowLinkSearch(false);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const unlinkMutation = useMutation({
    mutationFn: async ({ trItemId, linkId }: { trItemId: number; linkId: number }) => {
      const res = await fetch(`/api/tr-register/${trItemId}/link/${linkId}`, { credentials: "include", method: "DELETE", headers: getAuthHeaders() });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Unlink failed"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tr-register"] });
      toast({ title: "Project Unlinked" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const suggestionDecisionMutation = useMutation({
    mutationFn: async ({ trItemId, projectId, decision }: { trItemId: number; projectId: number; decision: string }) => {
      const res = await fetch(`/api/tr-register/${trItemId}/suggestion-decision`, { credentials: "include", method: "POST", headers: getAuthHeaders(), body: JSON.stringify({ projectId, decision }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Decision failed"); }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tr-register"] });
      if (variables.decision === "Accepted") {
        toast({ title: "Suggestion Accepted & Linked" });
        setSuggestionConfirm(null);
      } else if (variables.decision === "Rejected") {
        toast({ title: "Suggestion Rejected" });
      } else {
        toast({ title: "Suggestion Suppressed" });
      }
      setSuggestions(prev => prev.filter(s => s.projectId !== variables.projectId));
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const openDrawer = (id: number) => {
    setSelectedItemId(id);
    setDrawerOpen(true);
    setSuggestions([]);
    setShowLinkSearch(false);
    setEditField(null);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setSelectedItemId(null);
    setSuggestions([]);
    setShowLinkSearch(false);
    setEditField(null);
  };

  const handleInlineEdit = (field: string, currentValue: any) => {
    if (!canManage) return;
    setEditField(field);
    if (field === "owners" || field === "support") {
      setEditValue(Array.isArray(currentValue) ? currentValue.join(", ") : (currentValue || ""));
    } else {
      setEditValue(currentValue || "");
    }
  };

  const commitEdit = () => {
    if (!editField || !itemDetail) return;
    let value: any = editValue;
    if (editField === "owners" || editField === "support") {
      value = editValue.split(",").map((s: string) => s.trim()).filter(Boolean);
    }
    updateMutation.mutate({ id: itemDetail.id, data: { [editField]: value } });
  };

  const handleCreate = () => {
    const body: any = {
      trId: createForm.trId.trim(),
      department: createForm.department.trim(),
      actionDescription: createForm.actionDescription.trim(),
      ragStatus: createForm.ragStatus,
      owners: createForm.owners.split(",").map((s: string) => s.trim()).filter(Boolean),
      support: createForm.support.split(",").map((s: string) => s.trim()).filter(Boolean),
      dueDate: createForm.dueDate || null,
      outcomeComments: createForm.outcomeComments.trim() || null,
      supportingInfo: createForm.supportingInfo.trim() || null,
      status: "Active",
    };
    createMutation.mutate(body);
  };

  const generateSuggestions = async () => {
    if (!selectedItemId) return;
    setSuggestLoading(true);
    try {
      const res = await fetch(`/api/tr-register/${selectedItemId}/suggest-links`, { credentials: "include", method: "POST", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to generate suggestions");
      const data = await res.json();
      setSuggestions(data);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSuggestLoading(false);
    }
  };

  const filteredProjects = useMemo(() => {
    if (!linkSearchQuery) return projects.slice(0, 20);
    const q = linkSearchQuery.toLowerCase();
    return projects.filter(p => p.projectName.toLowerCase().includes(q)).slice(0, 20);
  }, [projects, linkSearchQuery]);

  const activeItems = sortedItems.filter(i => i.status === "Active");
  const completedItems = sortedItems.filter(i => i.status === "Completed");

  const boardSorted = useMemo(() => {
    return [...boardItems].sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });
  }, [boardItems]);

  const boardActiveItems = boardSorted.filter(i => i.status === "Active");
  const boardCompletedItems = boardSorted.filter(i => i.status === "Completed");

  const handleDragStart = useCallback((e: DragEvent<HTMLDivElement>, item: TrItem) => {
    e.dataTransfer.setData("text/plain", String(item.id));
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>, column: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(column);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverColumn(null);
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>, targetStatus: string) => {
    e.preventDefault();
    setDragOverColumn(null);
    const itemId = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (isNaN(itemId)) return;
    const item = boardItems.find(i => i.id === itemId);
    if (!item || item.status === targetStatus) return;
    if (targetStatus === "Completed") {
      completeMutation.mutate(itemId);
    } else {
      updateMutation.mutate({ id: itemId, data: { status: "Active", dateCompleted: null } });
    }
  }, [boardItems, completeMutation, updateMutation]);

  return (
    <div className="space-y-4" data-testid="tr-register-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-page-title">
            TR Register
          </h1>
          <p className="text-sm text-muted-foreground mt-1" data-testid="text-page-subtitle">
            Track and resolve programme-level actions across departments
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <Button size="sm" onClick={() => setCreateDialogOpen(true)} data-testid="button-new-tr-item">
              <Plus className="h-4 w-4 mr-1" />
              New TR Item
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="tabs-view">
        <TabsList data-testid="tabs-list">
          <TabsTrigger value="list" data-testid="tab-list-view">List View</TabsTrigger>
          <TabsTrigger value="board" data-testid="tab-board-view">Board View</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-3 mt-3">
          <Card data-testid="filters-card">
            <CardContent className="py-3 px-4">
              <div className="flex flex-wrap items-center gap-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 w-32 text-xs" data-testid="select-status-filter">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={ragFilter} onValueChange={setRagFilter}>
                  <SelectTrigger className="h-8 w-28 text-xs" data-testid="select-rag-filter">
                    <SelectValue placeholder="RAG" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All RAG</SelectItem>
                    <SelectItem value="Red">Red</SelectItem>
                    <SelectItem value="Amber">Amber</SelectItem>
                    <SelectItem value="Green">Green</SelectItem>
                  </SelectContent>
                </Select>

                <Input
                  placeholder="Department"
                  value={deptFilter}
                  onChange={e => setDeptFilter(e.target.value)}
                  className="h-8 w-32 text-xs"
                  data-testid="input-department-filter"
                />

                <Input
                  placeholder="Owner"
                  value={ownerFilter}
                  onChange={e => setOwnerFilter(e.target.value)}
                  className="h-8 w-28 text-xs"
                  data-testid="input-owner-filter"
                />

                <Button
                  variant={overdueFilter ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setOverdueFilter(!overdueFilter)}
                  data-testid="toggle-overdue-filter"
                >
                  Overdue
                </Button>

                <Select value={linkedFilter} onValueChange={setLinkedFilter}>
                  <SelectTrigger className="h-8 w-28 text-xs" data-testid="select-linked-filter">
                    <SelectValue placeholder="Link" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="linked">Linked</SelectItem>
                    <SelectItem value="unlinked">Unlinked</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {isLoading ? (
            <div className="flex justify-center py-16" data-testid="loading-spinner">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : sortedItems.length === 0 ? (
            <Card data-testid="empty-state">
              <CardContent className="flex flex-col items-center py-16">
                <ClipboardList className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground text-sm">No TR items found.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="border rounded-lg overflow-auto" data-testid="tr-table-container">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs w-20">TR ID</TableHead>
                    <TableHead className="text-xs w-28">Department</TableHead>
                    <TableHead className="text-xs">Action/Description</TableHead>
                    <TableHead className="text-xs w-20">RAG</TableHead>
                    <TableHead className="text-xs w-28">Owner(s)</TableHead>
                    <TableHead className="text-xs w-28">Support</TableHead>
                    <TableHead className="text-xs w-24">Date Raised</TableHead>
                    <TableHead className="text-xs w-24">Due Date</TableHead>
                    <TableHead className="text-xs w-24">Status</TableHead>
                    <TableHead className="text-xs w-20">Linked</TableHead>
                    <TableHead className="text-xs w-28">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedItems.map(item => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openDrawer(item.id)}
                      data-testid={`tr-row-${item.id}`}
                    >
                      <TableCell className="text-xs font-medium" data-testid={`text-trid-${item.id}`}>{item.trId}</TableCell>
                      <TableCell className="text-xs" data-testid={`text-dept-${item.id}`}>{item.department}</TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate" data-testid={`text-desc-${item.id}`}>{item.actionDescription}</TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${RAG_STYLES[item.ragStatus] || "bg-gray-100 text-gray-700"}`} data-testid={`badge-rag-${item.id}`}>
                          {item.ragStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs" data-testid={`text-owners-${item.id}`}>{(item.owners || []).join(", ")}</TableCell>
                      <TableCell className="text-xs" data-testid={`text-support-${item.id}`}>{(item.support || []).join(", ")}</TableCell>
                      <TableCell className="text-xs" data-testid={`text-raised-${item.id}`}>{formatDate(item.dateRaised)}</TableCell>
                      <TableCell className={`text-xs ${isOverdue(item) ? "text-red-600 font-semibold" : ""}`} data-testid={`text-due-${item.id}`}>
                        {formatDate(item.dueDate)}
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${STATUS_STYLES[item.status] || "bg-gray-100 text-gray-700"}`} data-testid={`badge-status-${item.id}`}>
                          {item.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-center" data-testid={`text-linked-count-${item.id}`}>
                        {item.linkedProjectCount || 0}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                          {canManage && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => openDrawer(item.id)}
                              data-testid={`button-link-${item.id}`}
                              title="Link project"
                            >
                              <Link2 className="h-3 w-3" />
                            </Button>
                          )}
                          {canManage && item.status === "Active" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => completeMutation.mutate(item.id)}
                              data-testid={`button-complete-${item.id}`}
                              title="Mark complete"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="board" className="mt-3">
          {boardLoading ? (
            <div className="flex justify-center py-16" data-testid="board-loading-spinner">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="board-view">
            <div
              onDragOver={e => handleDragOver(e, "Active")}
              onDragLeave={handleDragLeave}
              onDrop={e => handleDrop(e, "Active")}
              className={`min-h-[200px] rounded-lg p-2 transition-colors ${dragOverColumn === "Active" ? "bg-blue-50 ring-2 ring-blue-300" : ""}`}
              data-testid="board-column-active"
            >
              <h3 className="text-sm font-semibold mb-2 text-blue-700" data-testid="text-board-active-heading">
                Active ({boardActiveItems.length})
              </h3>
              <div className="space-y-2">
                {boardActiveItems.map(item => (
                  <Card
                    key={item.id}
                    draggable={canManage}
                    onDragStart={e => handleDragStart(e, item)}
                    className={`cursor-pointer hover:shadow-md transition-shadow ${canManage ? "cursor-grab active:cursor-grabbing" : ""}`}
                    onClick={() => openDrawer(item.id)}
                    data-testid={`board-card-${item.id}`}
                  >
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          {canManage && <GripVertical className="h-3 w-3 text-muted-foreground/50" />}
                          <span className="text-xs font-bold" data-testid={`board-trid-${item.id}`}>{item.trId}</span>
                        </div>
                        <Badge className={`text-[10px] ${RAG_STYLES[item.ragStatus] || ""}`} data-testid={`board-rag-${item.id}`}>
                          {item.ragStatus}
                        </Badge>
                      </div>
                      {item.department && (
                        <Badge variant="secondary" className="text-[10px]" data-testid={`board-dept-${item.id}`}>
                          {item.department}
                        </Badge>
                      )}
                      <p className="text-xs text-muted-foreground line-clamp-2" data-testid={`board-desc-${item.id}`}>
                        {item.actionDescription}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span className={isOverdue(item) ? "text-red-600 font-semibold" : ""} data-testid={`board-due-${item.id}`}>
                          Due: {formatDate(item.dueDate)}
                        </span>
                        <span data-testid={`board-linked-${item.id}`}>{item.linkedProjectCount || 0} linked</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(item.owners || []).map((o, i) => (
                          <Badge key={i} variant="outline" className="text-[10px]" data-testid={`board-owner-${item.id}-${i}`}>{o}</Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {boardActiveItems.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-8">No active items</p>
                )}
              </div>
            </div>

            <div
              onDragOver={e => handleDragOver(e, "Completed")}
              onDragLeave={handleDragLeave}
              onDrop={e => handleDrop(e, "Completed")}
              className={`min-h-[200px] rounded-lg p-2 transition-colors ${dragOverColumn === "Completed" ? "bg-green-50 ring-2 ring-green-300" : ""}`}
              data-testid="board-column-completed"
            >
              <h3 className="text-sm font-semibold mb-2 text-gray-500" data-testid="text-board-completed-heading">
                Completed ({boardCompletedItems.length})
              </h3>
              <div className="space-y-2">
                {boardCompletedItems.map(item => (
                  <Card
                    key={item.id}
                    draggable={canManage}
                    onDragStart={e => handleDragStart(e, item)}
                    className={`cursor-pointer hover:shadow-md transition-shadow opacity-80 ${canManage ? "cursor-grab active:cursor-grabbing" : ""}`}
                    onClick={() => openDrawer(item.id)}
                    data-testid={`board-card-${item.id}`}
                  >
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          {canManage && <GripVertical className="h-3 w-3 text-muted-foreground/50" />}
                          <span className="text-xs font-bold" data-testid={`board-trid-${item.id}`}>{item.trId}</span>
                        </div>
                        <Badge className={`text-[10px] ${RAG_STYLES[item.ragStatus] || ""}`} data-testid={`board-rag-${item.id}`}>
                          {item.ragStatus}
                        </Badge>
                      </div>
                      {item.department && (
                        <Badge variant="secondary" className="text-[10px]" data-testid={`board-dept-${item.id}`}>
                          {item.department}
                        </Badge>
                      )}
                      <p className="text-xs text-muted-foreground line-clamp-2" data-testid={`board-desc-${item.id}`}>
                        {item.actionDescription}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span data-testid={`board-due-${item.id}`}>Due: {formatDate(item.dueDate)}</span>
                        <span data-testid={`board-linked-${item.id}`}>{item.linkedProjectCount || 0} linked</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(item.owners || []).map((o, i) => (
                          <Badge key={i} variant="outline" className="text-[10px]" data-testid={`board-owner-${item.id}-${i}`}>{o}</Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {boardCompletedItems.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-8">No completed items</p>
                )}
              </div>
            </div>
          </div>
          )}
        </TabsContent>
      </Tabs>

      <Sheet open={drawerOpen} onOpenChange={open => { if (!open) closeDrawer(); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto" data-testid="detail-drawer">
          <SheetHeader>
            <SheetTitle data-testid="drawer-title">
              {itemDetail?.trId || "Loading..."}
            </SheetTitle>
          </SheetHeader>

          {detailLoading || !itemDetail ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <div className="space-y-5 mt-4">
              <div className="space-y-3">
                <DrawerField
                  label="Department" field="department" value={itemDetail.department}
                  editField={editField} editValue={editValue} setEditValue={setEditValue}
                  onEdit={() => handleInlineEdit("department", itemDetail.department)}
                  onCommit={commitEdit} onCancel={() => setEditField(null)}
                  canEdit={canManage}
                />
                <DrawerField
                  label="Action/Description" field="actionDescription" value={itemDetail.actionDescription}
                  editField={editField} editValue={editValue} setEditValue={setEditValue}
                  onEdit={() => handleInlineEdit("actionDescription", itemDetail.actionDescription)}
                  onCommit={commitEdit} onCancel={() => setEditField(null)}
                  canEdit={canManage}
                />

                <div>
                  <span className="text-xs text-muted-foreground">RAG Status</span>
                  {editField === "ragStatus" ? (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Select value={editValue} onValueChange={v => { setEditValue(v); }}>
                        <SelectTrigger className="h-7 text-xs w-28" data-testid="select-edit-rag">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Red">Red</SelectItem>
                          <SelectItem value="Amber">Amber</SelectItem>
                          <SelectItem value="Green">Green</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={commitEdit} data-testid="button-save-rag">
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      </Button>
                    </div>
                  ) : (
                    <div
                      className={`flex items-center gap-1.5 ${canManage ? "cursor-pointer" : ""}`}
                      onClick={() => handleInlineEdit("ragStatus", itemDetail.ragStatus)}
                      data-testid="text-detail-rag"
                    >
                      <Badge className={`text-[10px] ${RAG_STYLES[itemDetail.ragStatus] || ""}`}>{itemDetail.ragStatus}</Badge>
                      {canManage && <Pencil className="h-3 w-3 text-muted-foreground" />}
                    </div>
                  )}
                </div>

                <DrawerField
                  label="Owner(s)" field="owners" value={(itemDetail.owners || []).join(", ")}
                  editField={editField} editValue={editValue} setEditValue={setEditValue}
                  onEdit={() => handleInlineEdit("owners", itemDetail.owners)}
                  onCommit={commitEdit} onCancel={() => setEditField(null)}
                  canEdit={canManage}
                />
                <DrawerField
                  label="Support" field="support" value={(itemDetail.support || []).join(", ")}
                  editField={editField} editValue={editValue} setEditValue={setEditValue}
                  onEdit={() => handleInlineEdit("support", itemDetail.support)}
                  onCommit={commitEdit} onCancel={() => setEditField(null)}
                  canEdit={canManage}
                />
                <DrawerField
                  label="Due Date" field="dueDate" value={itemDetail.dueDate || ""}
                  editField={editField} editValue={editValue} setEditValue={setEditValue}
                  onEdit={() => handleInlineEdit("dueDate", itemDetail.dueDate ? new Date(itemDetail.dueDate).toISOString().split("T")[0] : "")}
                  onCommit={commitEdit} onCancel={() => setEditField(null)}
                  canEdit={canManage} inputType="date"
                />

                <div>
                  <span className="text-xs text-muted-foreground">Status</span>
                  <div className="flex items-center gap-2" data-testid="text-detail-status">
                    <Badge className={`text-[10px] ${STATUS_STYLES[itemDetail.status] || ""}`}>{itemDetail.status}</Badge>
                    {itemDetail.dateCompleted && (
                      <span className="text-[10px] text-muted-foreground">Completed: {formatDate(itemDetail.dateCompleted)}</span>
                    )}
                  </div>
                </div>

                <div>
                  <span className="text-xs text-muted-foreground">Date Raised</span>
                  <p className="text-sm" data-testid="text-detail-raised">{formatDate(itemDetail.dateRaised)}</p>
                </div>

                <DrawerTextarea
                  label="Outcome / Comments" field="outcomeComments" value={itemDetail.outcomeComments || ""}
                  editField={editField} editValue={editValue} setEditValue={setEditValue}
                  onEdit={() => handleInlineEdit("outcomeComments", itemDetail.outcomeComments)}
                  onCommit={commitEdit} onCancel={() => setEditField(null)}
                  canEdit={canManage}
                />
                <DrawerField
                  label="Supporting Info" field="supportingInfo" value={itemDetail.supportingInfo || ""}
                  editField={editField} editValue={editValue} setEditValue={setEditValue}
                  onEdit={() => handleInlineEdit("supportingInfo", itemDetail.supportingInfo)}
                  onCommit={commitEdit} onCancel={() => setEditField(null)}
                  canEdit={canManage}
                />
              </div>

              <div className="border-t pt-4" data-testid="linked-projects-section">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold">Linked Projects</h4>
                  {canManage && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setShowLinkSearch(!showLinkSearch)}
                      data-testid="button-add-link"
                    >
                      <Link2 className="h-3 w-3 mr-1" />
                      Add Link
                    </Button>
                  )}
                </div>

                {showLinkSearch && (
                  <div className="mb-3 space-y-2 p-2 bg-muted/30 rounded-lg" data-testid="link-search-panel">
                    <div className="relative">
                      <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search projects..."
                        value={linkSearchQuery}
                        onChange={e => setLinkSearchQuery(e.target.value)}
                        className="h-8 pl-7 text-xs"
                        data-testid="input-link-search"
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {filteredProjects.map(p => (
                        <button
                          key={p.id}
                          className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted transition-colors"
                          onClick={() => setLinkConfirm({ trItem: itemDetail, project: p })}
                          data-testid={`button-select-project-${p.id}`}
                        >
                          <span className="font-medium">{p.projectName}</span>
                          {p.pm && <span className="text-muted-foreground ml-1">({p.pm})</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {itemDetail.linkedProjects.length === 0 ? (
                  <p className="text-xs text-muted-foreground" data-testid="text-no-links">No linked projects</p>
                ) : (
                  <div className="space-y-2">
                    {itemDetail.linkedProjects.map(lp => (
                      <div key={lp.id} className="flex items-center justify-between p-2 bg-muted/20 rounded" data-testid={`linked-project-${lp.id}`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate" data-testid={`text-linked-name-${lp.id}`}>{lp.projectName}</p>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            {lp.pm && <span data-testid={`text-linked-pm-${lp.id}`}>PM: {lp.pm}</span>}
                            {lp.linkStatus && (
                              <Badge variant="outline" className="text-[9px]" data-testid={`badge-link-status-${lp.id}`}>{lp.linkStatus}</Badge>
                            )}
                            {lp.autoCreatedPmTaskId && (
                              <span data-testid={`text-task-link-${lp.id}`}>Task #{lp.autoCreatedPmTaskId}</span>
                            )}
                          </div>
                        </div>
                        {canManage && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => unlinkMutation.mutate({ trItemId: itemDetail.id, linkId: lp.id })}
                            data-testid={`button-unlink-${lp.id}`}
                          >
                            <Unlink className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t pt-4" data-testid="suggestions-section">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold">Auto Link Suggestions</h4>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={generateSuggestions}
                    disabled={suggestLoading}
                    data-testid="button-generate-suggestions"
                  >
                    {suggestLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wand2 className="h-3 w-3 mr-1" />}
                    Generate Suggestions
                  </Button>
                </div>

                {suggestions.length > 0 && (
                  <div className="space-y-2">
                    {suggestions.filter(s => s.score > 0).map(s => (
                      <Card key={s.projectId} className="p-2" data-testid={`suggestion-card-${s.projectId}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium" data-testid={`suggestion-name-${s.projectId}`}>{s.projectName}</span>
                          <Badge className={`text-[10px] ${s.score >= 50 ? "bg-emerald-100 text-emerald-700" : s.score >= 20 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-700"}`} data-testid={`suggestion-score-${s.projectId}`}>
                            {s.score}
                          </Badge>
                        </div>
                        <ul className="text-[10px] text-muted-foreground mb-2 space-y-0.5">
                          {s.rationale.map((r, i) => (
                            <li key={i} data-testid={`suggestion-rationale-${s.projectId}-${i}`}>• {r}</li>
                          ))}
                        </ul>
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-[10px] text-emerald-700"
                            onClick={() => {
                              const proj = projects.find(p => p.id === s.projectId) || null;
                              setSuggestionConfirm({ trItem: itemDetail, suggestion: s, project: proj });
                            }}
                            data-testid={`button-accept-${s.projectId}`}
                          >
                            <CheckCircle2 className="h-3 w-3 mr-0.5" />
                            Accept
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px]"
                            onClick={() => suggestionDecisionMutation.mutate({ trItemId: itemDetail.id, projectId: s.projectId, decision: "Rejected" })}
                            data-testid={`button-reject-${s.projectId}`}
                          >
                            <XCircle className="h-3 w-3 mr-0.5" />
                            Reject
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[10px]"
                            onClick={() => suggestionDecisionMutation.mutate({ trItemId: itemDetail.id, projectId: s.projectId, decision: "Suppressed" })}
                            data-testid={`button-suppress-${s.projectId}`}
                          >
                            <EyeOff className="h-3 w-3 mr-0.5" />
                            Suppress
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!linkConfirm} onOpenChange={open => { if (!open) setLinkConfirm(null); }}>
        <AlertDialogContent data-testid="link-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="text-confirm-title">Confirm Link</AlertDialogTitle>
            <AlertDialogDescription data-testid="text-confirm-description">
              Link {linkConfirm?.trItem.trId} to {linkConfirm?.project.projectName} and create a High Priority task
              {linkConfirm?.project.pm ? ` assigned to ${linkConfirm.project.pm}` : ""}
              {linkConfirm?.trItem.dueDate ? ` due ${formatDate(linkConfirm.trItem.dueDate)}` : ""}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-confirm-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (linkConfirm) linkMutation.mutate({ trItemId: linkConfirm.trItem.id, projectId: linkConfirm.project.id });
              }}
              data-testid="button-confirm-link"
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!suggestionConfirm} onOpenChange={open => { if (!open) setSuggestionConfirm(null); }}>
        <AlertDialogContent data-testid="suggestion-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="text-suggestion-confirm-title">Accept Suggestion</AlertDialogTitle>
            <AlertDialogDescription data-testid="text-suggestion-confirm-description">
              Link {suggestionConfirm?.trItem.trId} to {suggestionConfirm?.suggestion.projectName} and create a High Priority task
              {suggestionConfirm?.project?.pm ? ` for ${suggestionConfirm.project.pm}` : ""}
              {suggestionConfirm?.trItem.dueDate ? ` due ${formatDate(suggestionConfirm.trItem.dueDate)}` : ""}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-suggestion-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (suggestionConfirm) {
                  suggestionDecisionMutation.mutate({
                    trItemId: suggestionConfirm.trItem.id,
                    projectId: suggestionConfirm.suggestion.projectId,
                    decision: "Accepted",
                  });
                }
              }}
              data-testid="button-suggestion-confirm"
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-md" data-testid="create-dialog">
          <DialogHeader>
            <DialogTitle data-testid="text-create-title">New TR Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">TR ID</label>
              <Input
                value={createForm.trId}
                onChange={e => setCreateForm(f => ({ ...f, trId: e.target.value }))}
                placeholder="TR001"
                className="h-8 text-sm"
                data-testid="input-create-trid"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Department</label>
              <Input
                value={createForm.department}
                onChange={e => setCreateForm(f => ({ ...f, department: e.target.value }))}
                placeholder="Finance"
                className="h-8 text-sm"
                data-testid="input-create-department"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Action / Description</label>
              <Textarea
                value={createForm.actionDescription}
                onChange={e => setCreateForm(f => ({ ...f, actionDescription: e.target.value }))}
                className="text-sm"
                rows={2}
                data-testid="input-create-description"
              />
            </div>
            <div>
              <label className="text-xs font-medium">RAG Status</label>
              <Select value={createForm.ragStatus} onValueChange={v => setCreateForm(f => ({ ...f, ragStatus: v }))}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-create-rag">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Red">Red</SelectItem>
                  <SelectItem value="Amber">Amber</SelectItem>
                  <SelectItem value="Green">Green</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium">Owners (comma-separated)</label>
              <Input
                value={createForm.owners}
                onChange={e => setCreateForm(f => ({ ...f, owners: e.target.value }))}
                placeholder="John, Jane"
                className="h-8 text-sm"
                data-testid="input-create-owners"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Support (comma-separated)</label>
              <Input
                value={createForm.support}
                onChange={e => setCreateForm(f => ({ ...f, support: e.target.value }))}
                className="h-8 text-sm"
                data-testid="input-create-support"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Due Date</label>
              <Input
                type="date"
                value={createForm.dueDate}
                onChange={e => setCreateForm(f => ({ ...f, dueDate: e.target.value }))}
                className="h-8 text-sm"
                data-testid="input-create-duedate"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)} data-testid="button-create-cancel">
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending || !createForm.trId.trim() || !createForm.actionDescription.trim()}
              data-testid="button-create-submit"
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DrawerField({
  label, field, value, editField, editValue, setEditValue,
  onEdit, onCommit, onCancel, canEdit, inputType = "text",
}: {
  label: string; field: string; value: string;
  editField: string | null; editValue: string; setEditValue: (v: string) => void;
  onEdit: () => void; onCommit: () => void; onCancel: () => void;
  canEdit: boolean; inputType?: string;
}) {
  if (editField === field) {
    return (
      <div>
        <span className="text-xs text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1 mt-0.5">
          <Input
            className="h-7 text-xs px-2"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") onCommit(); if (e.key === "Escape") onCancel(); }}
            autoFocus
            type={inputType}
            data-testid={`input-edit-${field}`}
          />
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onCommit} data-testid={`button-save-${field}`}>
            <Check className="w-3.5 h-3.5 text-emerald-600" />
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div
        className={`flex items-center gap-1.5 text-sm ${canEdit ? "cursor-pointer hover:text-primary" : ""}`}
        onClick={onEdit}
        data-testid={`text-detail-${field}`}
      >
        <span>{value || "—"}</span>
        {canEdit && <Pencil className="h-3 w-3 text-muted-foreground" />}
      </div>
    </div>
  );
}

function DrawerTextarea({
  label, field, value, editField, editValue, setEditValue,
  onEdit, onCommit, onCancel, canEdit,
}: {
  label: string; field: string; value: string;
  editField: string | null; editValue: string; setEditValue: (v: string) => void;
  onEdit: () => void; onCommit: () => void; onCancel: () => void;
  canEdit: boolean;
}) {
  if (editField === field) {
    return (
      <div>
        <span className="text-xs text-muted-foreground">{label}</span>
        <div className="mt-0.5">
          <Textarea
            className="text-xs"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            rows={3}
            autoFocus
            data-testid={`textarea-edit-${field}`}
          />
          <Button variant="ghost" size="sm" className="h-7 mt-1 text-xs" onClick={onCommit} data-testid={`button-save-${field}`}>
            <Check className="w-3.5 h-3.5 mr-1 text-emerald-600" />
            Save
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div
        className={`text-sm whitespace-pre-wrap ${canEdit ? "cursor-pointer hover:text-primary" : ""}`}
        onClick={onEdit}
        data-testid={`text-detail-${field}`}
      >
        {value || "—"}
        {canEdit && <Pencil className="h-3 w-3 text-muted-foreground inline ml-1" />}
      </div>
    </div>
  );
}
