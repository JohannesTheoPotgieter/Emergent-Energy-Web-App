/**
 * PM Workboard — Wave 2
 *
 * Project Management work board showing work packages and work items.
 * Reads from promoted schema via GET /api/projects/:id/work-packages and /work-items.
 * Supports creating and editing work items.
 *
 * Registered under Project Management department.
 */

import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/layout/page-shell";
import { ProjectWorkspaceHeader } from "@/components/project/ProjectWorkspaceHeader";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  Package, ListTodo, Plus, ChevronRight, CheckCircle, Clock, AlertCircle,
} from "lucide-react";

interface WorkPackage {
  id: number;
  workstream: string;
  title: string;
  description: string | null;
  sort_order: number;
  item_count: number;
  avg_completion: number | null;
}

interface WorkItem {
  id: number;
  legacy_work_item_id: number | null;
  work_package_id: number | null;
  workstream: string | null;
  title: string;
  description: string | null;
  status: string | null;
  priority: string | null;
  start_date: string | null;
  end_date: string | null;
  percent_complete: number | null;
  is_milestone: boolean;
  owner_name: string | null;
  assigned_to_party_id: number | null;
}

const STATUS_COLORS: Record<string, string> = {
  "Not Started": "bg-muted text-muted-foreground",
  "IN PROGRESS": "bg-blue-100 text-blue-700",
  "In Progress": "bg-blue-100 text-blue-700",
  "COMPLETE": "bg-emerald-100 text-emerald-700",
  "Complete": "bg-emerald-100 text-emerald-700",
  "Done": "bg-emerald-100 text-emerald-700",
  "HOLD": "bg-amber-100 text-amber-700",
  "NEEDS APPROVAL": "bg-violet-100 text-violet-700",
};

export default function PmWorkboardPage() {
  const [, params] = useRoute("/pm/workboard/:projectId");
  const projectId = params?.projectId ? parseInt(params.projectId) : undefined;
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newItem, setNewItem] = useState({ title: "", description: "", priority: "Med", status: "Not Started" });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: packages, isLoading: packagesLoading } = useQuery<WorkPackage[]>({
    queryKey: ["work-packages", projectId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/projects/${projectId}/work-packages`);
      return res.json();
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const { data: items, isLoading: itemsLoading } = useQuery<WorkItem[]>({
    queryKey: ["work-items-v2", projectId, selectedPackageId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedPackageId) params.set("workPackageId", String(selectedPackageId));
      const res = await apiRequest("GET", `/api/projects/${projectId}/work-items?${params}`);
      return res.json();
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newItem) => {
      const res = await apiRequest("POST", "/api/work-items", {
        projectInstanceId: projectId,
        workPackageId: selectedPackageId,
        ...data,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-items-v2", projectId] });
      queryClient.invalidateQueries({ queryKey: ["work-packages", projectId] });
      setCreateOpen(false);
      setNewItem({ title: "", description: "", priority: "Med", status: "Not Started" });
      toast({ title: "Work item created" });
    },
    onError: () => {
      toast({ title: "Failed to create work item", variant: "destructive" });
    },
  });

  if (!projectId) {
    return (
      <PageShell className="p-3 md:p-4">
        <div className="text-center py-8 text-muted-foreground">
          Select a project to view the workboard. Navigate from the Project List or PM Dashboard.
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell className="p-3 md:p-4">
      <ProjectWorkspaceHeader projectId={projectId} />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Work Packages sidebar */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Package className="h-4 w-4" />
                Work Packages
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {packagesLoading && (
                <>
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </>
              )}

              {/* All items button */}
              <button
                onClick={() => setSelectedPackageId(null)}
                className={cn(
                  "w-full text-left rounded-md border px-3 py-2 text-sm transition-colors",
                  selectedPackageId === null ? "bg-primary/10 border-primary" : "hover:bg-muted"
                )}
              >
                <div className="font-medium">All Work Items</div>
                <div className="text-xs text-muted-foreground">{items?.length ?? 0} items</div>
              </button>

              {packages?.map((pkg) => (
                <button
                  key={pkg.id}
                  onClick={() => setSelectedPackageId(pkg.id)}
                  className={cn(
                    "w-full text-left rounded-md border px-3 py-2 text-sm transition-colors",
                    selectedPackageId === pkg.id ? "bg-primary/10 border-primary" : "hover:bg-muted"
                  )}
                >
                  <div className="font-medium truncate">{pkg.title}</div>
                  <div className="flex items-center justify-between mt-1">
                    <Badge variant="secondary" className="text-xs">{pkg.workstream}</Badge>
                    <span className="text-xs text-muted-foreground">{pkg.item_count} items</span>
                  </div>
                  {pkg.avg_completion !== null && (
                    <Progress value={pkg.avg_completion} className="h-1 mt-1.5" />
                  )}
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Work Items list */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <ListTodo className="h-4 w-4" />
                  Work Items
                  {selectedPackageId && packages && (
                    <span className="font-normal text-muted-foreground">
                      — {packages.find((p) => p.id === selectedPackageId)?.title}
                    </span>
                  )}
                </CardTitle>
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Item
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {itemsLoading && (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              )}

              {items && items.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No work items found. Click "Add Item" to create one.
                </div>
              )}

              {items && items.length > 0 && (
                <div className="space-y-2">
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 rounded-md border px-3 py-2.5 hover:bg-muted/50 transition-colors">
                      {/* Status icon */}
                      {item.status === "COMPLETE" || item.status === "Complete" || item.status === "Done" ? (
                        <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" />
                      ) : item.status === "IN PROGRESS" || item.status === "In Progress" ? (
                        <Clock className="h-4 w-4 text-blue-600 shrink-0" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}

                      {/* Title & meta */}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{item.title}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {item.owner_name && (
                            <span className="text-xs text-muted-foreground">{item.owner_name}</span>
                          )}
                          {item.end_date && (
                            <span className="text-xs text-muted-foreground">Due: {item.end_date}</span>
                          )}
                        </div>
                      </div>

                      {/* Status badge */}
                      <Badge className={cn("text-xs shrink-0", STATUS_COLORS[item.status || ""] || "bg-muted")}>
                        {item.status || "—"}
                      </Badge>

                      {/* Priority */}
                      {item.priority && (
                        <Badge variant="outline" className="text-xs shrink-0">{item.priority}</Badge>
                      )}

                      {/* Completion */}
                      {item.percent_complete !== null && item.percent_complete > 0 && (
                        <span className="text-xs text-muted-foreground shrink-0 w-10 text-right">
                          {Math.round(item.percent_complete)}%
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Create Work Item Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Work Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Title *</Label>
              <Input value={newItem.title} onChange={(e) => setNewItem((i) => ({ ...i, title: e.target.value }))} placeholder="What needs to be done?" />
            </div>
            <div>
              <Label>Description</Label>
              <Input value={newItem.description} onChange={(e) => setNewItem((i) => ({ ...i, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Priority</Label>
                <Select value={newItem.priority} onValueChange={(v) => setNewItem((i) => ({ ...i, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Low">Low</SelectItem>
                    <SelectItem value="Med">Medium</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={newItem.status} onValueChange={(v) => setNewItem((i) => ({ ...i, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Not Started">Not Started</SelectItem>
                    <SelectItem value="IN PROGRESS">In Progress</SelectItem>
                    <SelectItem value="HOLD">On Hold</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate(newItem)} disabled={!newItem.title || createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
