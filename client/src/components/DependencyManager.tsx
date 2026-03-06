import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { X, Plus, ArrowRight, ArrowLeft } from "lucide-react";

interface DependencyManagerProps {
  taskId: number;
  projectId: number;
}

interface Dependency {
  id: number;
  predecessorId: number;
  successorId: number;
  depType: string;
  lagDays: number;
  predecessorTitle: string;
  successorTitle: string;
}

interface WorkItemOption {
  id: number;
  title: string;
}

export default function DependencyManager({ taskId, projectId }: DependencyManagerProps) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [predecessorId, setPredecessorId] = useState("");
  const [depType, setDepType] = useState("FS");
  const [lagDays, setLagDays] = useState(0);

  const { data: depsData, isLoading: depsLoading } = useQuery<{ dependencies: Dependency[] }>({
    queryKey: ["dependencies", projectId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/dependencies/project/${projectId}`);
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: workItems } = useQuery<WorkItemOption[]>({
    queryKey: ["work-items", projectId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/work-items?projectId=${projectId}`);
      return res.json();
    },
    enabled: dialogOpen && !!projectId,
  });

  const allDeps = depsData?.dependencies || [];
  const predecessors = allDeps.filter((d) => d.successorId === taskId);
  const successors = allDeps.filter((d) => d.predecessorId === taskId);

  const addMutation = useMutation({
    mutationFn: async (body: { predecessorId: number; successorId: number; depType: string; lagDays: number }) => {
      await apiRequest("POST", "/api/dependencies", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dependencies", projectId] });
      setDialogOpen(false);
      setPredecessorId("");
      setDepType("FS");
      setLagDays(0);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (depId: number) => {
      await apiRequest("DELETE", `/api/dependencies/${depId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dependencies", projectId] });
    },
  });

  const taskOptions = (workItems || [])
    .filter((w) => w.id !== taskId)
    .map((w) => ({ value: String(w.id), label: w.title }));

  const depTypeOptions = [
    { value: "FS", label: "Finish-to-Start (FS)" },
    { value: "SS", label: "Start-to-Start (SS)" },
    { value: "FF", label: "Finish-to-Finish (FF)" },
    { value: "SF", label: "Start-to-Finish (SF)" },
  ];

  const handleAdd = () => {
    if (!predecessorId) return;
    addMutation.mutate({
      predecessorId: parseInt(predecessorId),
      successorId: taskId,
      depType,
      lagDays,
    });
  };

  if (depsLoading) {
    return <div className="text-sm text-muted-foreground" data-testid="dependency-loading">Loading dependencies…</div>;
  }

  return (
    <div data-testid="dependency-manager">
      {predecessors.length > 0 && (
        <div className="mb-3" data-testid="dependency-predecessors">
          <label className="text-xs text-muted-foreground font-medium mb-1 block">Predecessors</label>
          <div className="flex flex-wrap gap-1.5">
            {predecessors.map((dep) => (
              <Badge
                key={dep.id}
                variant="secondary"
                className="bg-white border border-[#16A34A]/30 text-[#16A34A] text-xs gap-1 pr-1"
                data-testid={`badge-predecessor-${dep.id}`}
              >
                <ArrowLeft className="h-3 w-3" />
                {dep.predecessorTitle}
                <span className="text-[10px] opacity-70 ml-0.5">{dep.depType}{dep.lagDays ? ` +${dep.lagDays}d` : ""}</span>
                <button
                  className="ml-0.5 hover:bg-red-100 rounded p-0.5"
                  onClick={() => deleteMutation.mutate(dep.id)}
                  data-testid={`button-delete-dep-${dep.id}`}
                >
                  <X className="h-3 w-3 text-red-500" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {successors.length > 0 && (
        <div className="mb-3" data-testid="dependency-successors">
          <label className="text-xs text-muted-foreground font-medium mb-1 block">Successors</label>
          <div className="flex flex-wrap gap-1.5">
            {successors.map((dep) => (
              <Badge
                key={dep.id}
                variant="secondary"
                className="bg-white border border-blue-300 text-blue-700 text-xs gap-1 pr-1"
                data-testid={`badge-successor-${dep.id}`}
              >
                <ArrowRight className="h-3 w-3" />
                {dep.successorTitle}
                <span className="text-[10px] opacity-70 ml-0.5">{dep.depType}{dep.lagDays ? ` +${dep.lagDays}d` : ""}</span>
                <button
                  className="ml-0.5 hover:bg-red-100 rounded p-0.5"
                  onClick={() => deleteMutation.mutate(dep.id)}
                  data-testid={`button-delete-dep-${dep.id}`}
                >
                  <X className="h-3 w-3 text-red-500" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {predecessors.length === 0 && successors.length === 0 && (
        <p className="text-xs text-muted-foreground mb-2" data-testid="text-no-dependencies">No dependencies</p>
      )}

      <Button
        variant="outline"
        size="sm"
        className="text-xs border-[#16A34A]/30 text-[#16A34A] hover:bg-[#16A34A]/5"
        onClick={() => setDialogOpen(true)}
        data-testid="button-add-dependency"
      >
        <Plus className="h-3 w-3 mr-1" /> Add Dependency
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-white sm:max-w-md" data-testid="dialog-add-dependency">
          <DialogHeader>
            <DialogTitle>Add Dependency</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Predecessor Task</label>
              <SearchableSelect
                options={taskOptions}
                value={predecessorId}
                onValueChange={setPredecessorId}
                placeholder="Select predecessor…"
                searchPlaceholder="Search tasks…"
                emptyText="No tasks found"
                data-testid="select-predecessor"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Dependency Type</label>
              <SearchableSelect
                options={depTypeOptions}
                value={depType}
                onValueChange={setDepType}
                placeholder="Select type…"
                data-testid="select-dep-type"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Lag Days</label>
              <Input
                type="number"
                value={lagDays}
                onChange={(e) => setLagDays(parseInt(e.target.value) || 0)}
                className="h-8 bg-white"
                data-testid="input-lag-days"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(false)}
              data-testid="button-cancel-dependency"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-[#16A34A] hover:bg-[#16A34A]/90 text-white"
              onClick={handleAdd}
              disabled={!predecessorId || addMutation.isPending}
              data-testid="button-save-dependency"
            >
              {addMutation.isPending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
