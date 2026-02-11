import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ChevronDown, Plus, Copy, RotateCcw, Trash2, Layers } from "lucide-react";

interface Scenario {
  id: number;
  name: string;
  description: string | null;
  isDefault: boolean;
  createdAt: string;
}

interface ScenarioSelectorProps {
  selectedScenarioId: number | null;
  onScenarioChange: (id: number | null) => void;
}

export default function ScenarioSelector({ selectedScenarioId, onScenarioChange }: ScenarioSelectorProps) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [dupSourceId, setDupSourceId] = useState<number | null>(null);

  const { data } = useQuery<{ scenarios: Scenario[] }>({
    queryKey: ["/api/scenarios"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const scenarios = data?.scenarios || [];
  const selected = scenarios.find(s => s.id === selectedScenarioId);

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/scenarios", { name });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios"] });
      onScenarioChange(data.id);
      setCreateOpen(false);
      setNewName("");
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      const res = await apiRequest("POST", `/api/scenarios/${id}/duplicate`, { name });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios"] });
      onScenarioChange(data.id);
      setDupOpen(false);
      setNewName("");
    },
  });

  const resetMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/scenarios/${id}/reset`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/scenarios/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scenarios"] });
      onScenarioChange(null);
    },
  });

  return (
    <>
      <div className="flex items-center gap-2" data-testid="scenario-selector">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1" data-testid="button-scenario-select">
              {selected ? selected.name : "Baseline"}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem
              onClick={() => onScenarioChange(null)}
              className={!selectedScenarioId ? "bg-accent" : ""}
              data-testid="scenario-baseline"
            >
              Baseline (imported data)
            </DropdownMenuItem>
            {scenarios.length > 0 && <DropdownMenuSeparator />}
            {scenarios.map(s => (
              <DropdownMenuItem
                key={s.id}
                onClick={() => onScenarioChange(s.id)}
                className={selectedScenarioId === s.id ? "bg-accent" : ""}
                data-testid={`scenario-item-${s.id}`}
              >
                {s.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setCreateOpen(true)} data-testid="button-create-scenario">
              <Plus className="h-4 w-4 mr-2" />
              Create scenario
            </DropdownMenuItem>
            {selectedScenarioId && (
              <>
                <DropdownMenuItem onClick={() => { setDupSourceId(selectedScenarioId); setDupOpen(true); }} data-testid="button-duplicate-scenario">
                  <Copy className="h-4 w-4 mr-2" />
                  Duplicate scenario
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => resetMutation.mutate(selectedScenarioId)} data-testid="button-reset-scenario">
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reset overrides
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => deleteMutation.mutate(selectedScenarioId)} className="text-destructive" data-testid="button-delete-scenario">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete scenario
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {selectedScenarioId && (
          <span className="text-xs text-amber-600 font-medium px-2 py-0.5 bg-amber-50 rounded">
            Scenario mode
          </span>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Scenario</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Scenario name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            data-testid="input-scenario-name"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate(newName)} disabled={!newName.trim()} data-testid="button-confirm-create">
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dupOpen} onOpenChange={setDupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Duplicate Scenario</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="New scenario name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            data-testid="input-duplicate-name"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDupOpen(false)}>Cancel</Button>
            <Button onClick={() => dupSourceId && duplicateMutation.mutate({ id: dupSourceId, name: newName })} disabled={!newName.trim()} data-testid="button-confirm-duplicate">
              Duplicate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
