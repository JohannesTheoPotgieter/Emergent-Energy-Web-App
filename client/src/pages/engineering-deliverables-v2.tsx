/**
 * Engineering Deliverables V2 — Wave 4
 *
 * Project deliverables view using promoted schema.
 * Shows definition info, status, owner, reviewer, resource count.
 */

import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/layout/page-shell";
import { ProjectWorkspaceHeader } from "@/components/project/ProjectWorkspaceHeader";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { FileCheck, Plus, CheckCircle, Clock, AlertCircle, Paperclip } from "lucide-react";

interface DeliverableInstance {
  id: number;
  definition_name: string | null;
  definition_code: string | null;
  title: string;
  status: string;
  current_version: number | null;
  owner_name: string | null;
  reviewer_name: string | null;
  phase_name: string | null;
  resource_count: number;
  completed_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-100 text-blue-700",
  submitted: "bg-indigo-100 text-indigo-700",
  under_review: "bg-amber-100 text-amber-700",
  revision_required: "bg-orange-100 text-orange-700",
  approved: "bg-emerald-100 text-emerald-700",
  complete: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
};

export default function EngineeringDeliverablesV2Page() {
  const [, params] = useRoute("/engineering/deliverables-v2/:projectId");
  const projectId = params?.projectId ? parseInt(params.projectId) : undefined;
  const [createOpen, setCreateOpen] = useState(false);
  const [newDeliverable, setNewDeliverable] = useState({ title: "", definitionId: "" });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: deliverables, isLoading } = useQuery<DeliverableInstance[]>({
    queryKey: ["deliverables-v2", projectId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/projects/${projectId}/deliverables`);
      return res.json();
    },
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const { data: definitions } = useQuery<Array<{ id: number; name: string; code: string }>>({
    queryKey: ["deliverable-definitions"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/deliverable-definitions");
      return res.json();
    },
    staleTime: 300_000,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { title: string; definitionId: string }) => {
      const res = await apiRequest("POST", "/api/deliverables", {
        projectInstanceId: projectId,
        title: data.title,
        definitionId: data.definitionId ? parseInt(data.definitionId) : undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deliverables-v2", projectId] });
      setCreateOpen(false);
      setNewDeliverable({ title: "", definitionId: "" });
      toast({ title: "Deliverable created" });
    },
    onError: () => {
      toast({ title: "Failed to create deliverable", variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await apiRequest("PATCH", `/api/deliverables/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deliverables-v2", projectId] });
      toast({ title: "Status updated" });
    },
  });

  if (!projectId) {
    return (
      <PageShell className="p-3 md:p-4">
        <div className="text-center py-8 text-muted-foreground">
          Select a project to view deliverables.
        </div>
      </PageShell>
    );
  }

  const pendingCount = deliverables?.filter((d) => !["approved", "complete"].includes(d.status)).length ?? 0;
  const approvedCount = deliverables?.filter((d) => ["approved", "complete"].includes(d.status)).length ?? 0;

  return (
    <PageShell className="p-3 md:p-4">
      <ProjectWorkspaceHeader projectId={projectId} compact />

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileCheck className="h-5 w-5" />
              Deliverables
              <Badge variant="secondary" className="text-xs">{deliverables?.length ?? 0} total</Badge>
              {approvedCount > 0 && <Badge className="text-xs bg-emerald-100 text-emerald-700">{approvedCount} approved</Badge>}
            </CardTitle>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add Deliverable
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          )}

          {deliverables && deliverables.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Reviewer</TableHead>
                  <TableHead className="text-right">Files</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliverables.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">
                      {d.title}
                      {d.current_version && d.current_version > 1 && (
                        <span className="text-xs text-muted-foreground ml-1">v{d.current_version}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">{d.definition_name || "Ad-hoc"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={cn("text-xs", STATUS_COLORS[d.status] || "bg-muted")}>{d.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{d.owner_name || "—"}</TableCell>
                    <TableCell className="text-sm">{d.reviewer_name || "—"}</TableCell>
                    <TableCell className="text-right">
                      {d.resource_count > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          <Paperclip className="h-3 w-3 mr-0.5" />
                          {d.resource_count}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {d.status === "pending" && (
                        <Button size="sm" variant="ghost" onClick={() => statusMutation.mutate({ id: d.id, status: "in_progress" })}>Start</Button>
                      )}
                      {d.status === "in_progress" && (
                        <Button size="sm" variant="ghost" onClick={() => statusMutation.mutate({ id: d.id, status: "submitted" })}>Submit</Button>
                      )}
                      {d.status === "under_review" && (
                        <Button size="sm" variant="ghost" onClick={() => statusMutation.mutate({ id: d.id, status: "approved" })}>Approve</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {deliverables && deliverables.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No deliverables yet. Click "Add Deliverable" to create one.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Deliverable</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Definition (template)</Label>
              <Select value={newDeliverable.definitionId} onValueChange={(v) => setNewDeliverable((d) => ({ ...d, definitionId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select template or leave blank for ad-hoc..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Ad-hoc (no template)</SelectItem>
                  {definitions?.map((def) => (
                    <SelectItem key={def.id} value={String(def.id)}>{def.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Title *</Label>
              <Input value={newDeliverable.title} onChange={(e) => setNewDeliverable((d) => ({ ...d, title: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate(newDeliverable)} disabled={!newDeliverable.title || createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
