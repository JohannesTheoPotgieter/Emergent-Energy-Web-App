import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Package,
  Plus,
  Filter,
  Loader2,
  Search,
  FileText,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

async function engFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

const DELIVERABLE_STATUSES = ["DRAFT", "IN REVIEW", "APPROVED", "REJECTED", "SUPERSEDED", "ON HOLD", "ARCHIVED"];

const statusColors: Record<string, string> = {
  "DRAFT": "bg-gray-100 text-gray-700",
  "IN REVIEW": "bg-amber-100 text-amber-700",
  "APPROVED": "bg-green-100 text-green-700",
  "REJECTED": "bg-red-100 text-red-700",
  "SUPERSEDED": "bg-purple-100 text-purple-700",
  "ON HOLD": "bg-orange-100 text-orange-700",
  "ARCHIVED": "bg-slate-100 text-slate-600",
};

interface Deliverable {
  id: number;
  projectName: string;
  title: string;
  deliverableType: string;
  status: string;
  currentVersion: number;
  description: string | null;
  createdAt: string;
}

export default function EngineeringDeliverablesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newDel, setNewDel] = useState({
    projectName: "",
    title: "",
    deliverableType: "drawing",
    description: "",
  });

  const { data: deliverables = [], isLoading } = useQuery<Deliverable[]>({
    queryKey: ["eng-deliverables", statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      return engFetch(`/api/deliverables?${params}`);
    },
    refetchOnMount: "always",
    staleTime: 0,
  });

  const createMutation = useMutation({
    mutationFn: (del: typeof newDel) => engFetch("/api/deliverables", {
      method: "POST",
      body: JSON.stringify(del),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["eng-deliverables"] });
      setCreateOpen(false);
      setNewDel({ projectName: "", title: "", deliverableType: "drawing", description: "" });
      toast({ title: "Deliverable created" });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const filtered = deliverables.filter(d => {
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return d.title.toLowerCase().includes(term) || d.projectName.toLowerCase().includes(term);
    }
    return true;
  });

  return (
    <div data-testid="eng-deliverables-page" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Package className="h-8 w-8 text-indigo-500" />
          <div>
            <h2 className="text-2xl sm:text-3xl font-heading font-bold" data-testid="text-deliverables-title">Deliverables Register</h2>
            <p className="text-sm text-muted-foreground">Track engineering deliverables, versions, and approvals</p>
          </div>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-indigo-600 hover:bg-indigo-700" data-testid="button-create-deliverable">
              <Plus className="h-4 w-4 mr-2" />
              New Deliverable
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Create Deliverable</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Project Name</Label>
                <Input
                  data-testid="input-del-project"
                  value={newDel.projectName}
                  onChange={e => setNewDel(p => ({ ...p, projectName: e.target.value }))}
                  placeholder="e.g. Riverside Mall"
                />
              </div>
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  data-testid="input-del-title"
                  value={newDel.title}
                  onChange={e => setNewDel(p => ({ ...p, title: e.target.value }))}
                  placeholder="Deliverable title"
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={newDel.deliverableType} onValueChange={v => setNewDel(p => ({ ...p, deliverableType: v }))}>
                  <SelectTrigger data-testid="select-del-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="drawing">Drawing</SelectItem>
                    <SelectItem value="report">Report</SelectItem>
                    <SelectItem value="specification">Specification</SelectItem>
                    <SelectItem value="calculation">Calculation</SelectItem>
                    <SelectItem value="certificate">Certificate</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  data-testid="input-del-description"
                  value={newDel.description}
                  onChange={e => setNewDel(p => ({ ...p, description: e.target.value }))}
                  placeholder="Optional description"
                />
              </div>
              <Button
                className="w-full bg-indigo-600 hover:bg-indigo-700"
                data-testid="button-submit-deliverable"
                disabled={!newDel.projectName || !newDel.title || createMutation.isPending}
                onClick={() => createMutation.mutate(newDel)}
              >
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Create Deliverable
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                data-testid="input-del-search"
                placeholder="Search deliverables..."
                className="pl-9"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]" data-testid="filter-del-status">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {DELIVERABLE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground" data-testid="text-deliverables-empty">
              <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg font-medium">No deliverables found</p>
              <p className="text-sm mt-1">Create a new deliverable or adjust your filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Version</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(del => (
                    <TableRow key={del.id} data-testid={`row-deliverable-${del.id}`}>
                      <TableCell className="font-medium max-w-[250px]" data-testid={`text-del-title-${del.id}`}>
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="truncate">{del.title}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground" data-testid={`text-del-project-${del.id}`}>
                        {del.projectName?.replace(/_Tracker.*$/i, "").replace(/_/g, " ")}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] capitalize" data-testid={`badge-del-type-${del.id}`}>
                          {del.deliverableType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[10px] ${statusColors[del.status] || "bg-gray-100 text-gray-700"}`} data-testid={`badge-del-status-${del.id}`}>
                          {del.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center text-sm font-mono" data-testid={`text-del-version-${del.id}`}>
                        v{del.currentVersion}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground" data-testid={`text-del-created-${del.id}`}>
                        {new Date(del.createdAt).toLocaleDateString()}
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
