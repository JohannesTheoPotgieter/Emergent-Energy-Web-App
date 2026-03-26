/**
 * Project-level Construction tab — shows snags, inspections, and site activities
 * scoped to the current project.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { PageEmpty } from "@/components/ui/page-states";
import { HardHat, Plus, AlertTriangle, ClipboardCheck } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface Props { projectId: number; projectName: string; }

interface SnagRow { id: number; title: string; severity: string; status: string; location: string | null; dueDate: string | null; }

const SEVERITIES = ["critical", "major", "minor", "observation"];

export function ProjectConstructionTab({ projectId, projectName }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", severity: "minor", location: "", dueDate: "" });

  const { data: snags = [], isLoading } = useQuery<SnagRow[]>({
    queryKey: ["/api/construction/snags", projectId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/construction/snags?projectId=${projectId}`);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/construction/snags", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/construction/snags", projectId] });
      toast({ title: "Snag created" });
      setShowCreate(false);
      setForm({ title: "", severity: "minor", location: "", dueDate: "" });
    },
  });

  const openSnags = snags.filter(s => s.status === "open" || s.status === "in_progress");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardHat className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{openSnags.length} open snags</span>
        </div>
        <Button size="sm" className="gap-1 text-xs" onClick={() => setShowCreate(true)}>
          <Plus className="h-3 w-3" /> New Snag
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!isLoading && snags.length === 0 && (
        <PageEmpty icon={ClipboardCheck} title="No snags" description="No construction snags recorded for this project." />
      )}

      <div className="space-y-1.5">
        {snags.map(snag => (
          <Card key={snag.id} className="hover:shadow-sm transition-shadow">
            <CardContent className="p-2.5 flex items-center gap-2">
              <Badge variant="outline" className={`text-[10px] ${snag.severity === "critical" ? "border-red-300 text-red-700" : snag.severity === "major" ? "border-amber-300 text-amber-700" : "border-border"}`}>
                {snag.severity}
              </Badge>
              <span className="text-sm flex-1 truncate">{snag.title}</span>
              {snag.location && <span className="text-[10px] text-muted-foreground">{snag.location}</span>}
              <Badge variant="secondary" className="text-[10px]">{snag.status}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>New Snag</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Title *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Severity</Label><SearchableSelect value={form.severity} onValueChange={v => setForm(f => ({ ...f, severity: v }))} options={SEVERITIES.map(s => ({ value: s, label: s }))} /></div>
              <div><Label className="text-xs">Location</Label><Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} /></div>
            </div>
            <div><Label className="text-xs">Due Date</Label><Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate({ projectId, title: form.title, severity: form.severity, location: form.location || null, dueDate: form.dueDate || null })} disabled={!form.title.trim() || createMutation.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
