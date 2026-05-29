/**
 * Project-level Drawing Register tab — tracks design documents through revision lifecycle
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invalidateProjectV2Queries } from "@/hooks/use-project-v2";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { PageEmpty } from "@/components/ui/page-states";
import { FileText, Plus, ExternalLink } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface Props { projectId: number; projectName: string; }

interface DrawingRow { id: number; drawingNumber: string; title: string; discipline: string | null; currentRevision: string; status: string; sharepointLink: string | null; }

const DISCIPLINES = ["electrical", "structural", "mechanical", "civil", "architectural"];
// Drawing statuses are enforced server-side via DRAWING_STATUS_TRANSITIONS.
// Status changes are made through the Engineering Stages tab or API, not this tab.

function statusColor(s: string) {
  if (s === "ifc" || s === "as_built") return "bg-emerald-50 text-emerald-700";
  if (s === "approved") return "bg-emerald-50 text-emerald-700";
  if (s === "for_review" || s === "for_approval") return "bg-amber-50 text-amber-700";
  if (s === "superseded") return "bg-muted text-muted-foreground line-through";
  return "bg-muted text-muted-foreground";
}

export function DrawingRegisterTab({ projectId, projectName }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ drawingNumber: "", title: "", discipline: "", status: "draft", sharepointLink: "" });

  const { data: drawings = [], isLoading } = useQuery<DrawingRow[]>({
    queryKey: ["/api/drawings", projectId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/drawings?projectId=${projectId}`);
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/drawings", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drawings", projectId] });
      invalidateProjectV2Queries(queryClient, projectId);
      toast({ title: "Drawing registered" });
      setShowCreate(false);
      setForm({ drawingNumber: "", title: "", discipline: "", status: "draft", sharepointLink: "" });
    },
  });

  // NOTE: Drawing status transitions are managed through the Engineering
  // Stages tab or directly via the API with role-gated enforcement.
  // This tab is view + create only — it does not surface a status dropdown
  // because status changes require the DRAWING_STATUS_TRANSITIONS guard
  // on the server (e.g. you cannot skip from "draft" to "ifc").

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{drawings.length} drawings</span>
        </div>
        <Button size="sm" className="gap-1 text-xs" onClick={() => setShowCreate(true)}>
          <Plus className="h-3 w-3" /> Add Drawing
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {!isLoading && drawings.length === 0 && (
        <PageEmpty icon={FileText} title="No drawings" description="Register design drawings to track their revision lifecycle." />
      )}

      <div className="space-y-1.5">
        {drawings.map(d => (
          <Card key={d.id} className="hover:shadow-sm transition-shadow">
            <CardContent className="p-2.5 flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] font-mono shrink-0">{d.drawingNumber}</Badge>
              <span className="text-sm flex-1 truncate">{d.title}</span>
              {d.discipline && <Badge variant="secondary" className="text-[10px]">{d.discipline}</Badge>}
              <Badge variant="outline" className="text-[10px] font-mono">Rev {d.currentRevision}</Badge>
              <Badge className={`text-[10px] ${statusColor(d.status)}`}>{d.status.replace(/_/g, " ")}</Badge>
              {d.sharepointLink && (
                <a href={d.sharepointLink} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Register Drawing</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Drawing Number *</Label><Input value={form.drawingNumber} onChange={e => setForm(f => ({ ...f, drawingNumber: e.target.value }))} placeholder="DWG-001" /></div>
              <div><Label className="text-xs">Discipline</Label><SearchableSelect value={form.discipline || "__none__"} onValueChange={v => setForm(f => ({ ...f, discipline: v === "__none__" ? "" : v }))} options={[{ value: "__none__", label: "None" }, ...DISCIPLINES.map(d => ({ value: d, label: d }))]} /></div>
            </div>
            <div><Label className="text-xs">Title *</Label><Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Site Layout Plan" /></div>
            <div><Label className="text-xs">SharePoint Link</Label><Input value={form.sharepointLink} onChange={e => setForm(f => ({ ...f, sharepointLink: e.target.value }))} placeholder="https://sharepoint..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate({ projectId, drawingNumber: form.drawingNumber, title: form.title, discipline: form.discipline || null, status: form.status, sharepointLink: form.sharepointLink || null })} disabled={!form.drawingNumber.trim() || !form.title.trim() || createMutation.isPending}>Register</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
