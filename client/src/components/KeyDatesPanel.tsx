import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Calendar, Plus, Trash2, CheckCircle2, AlertCircle, Settings2, Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface KeyDatesPanelProps {
  projectName: string;
}

interface ResolvedKeyDate {
  id: number;
  keyDateName: string;
  sourceTaskId: number | null;
  sourceTaskCode: string | null;
  sourceTaskNameMatch: string | null;
  dateField: string;
  precedenceRule: string;
  sortOrder: number;
  matchedTaskId: number | null;
  matchedTaskTitle: string | null;
  matchedTaskNumber: string | null;
  plannedDate: string | null;
  actualDate: string | null;
  effectiveDate: string | null;
  mappingValid: boolean;
}

const formatDate = (d: string | null): string => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return d;
  }
};

const DEFAULT_KEY_DATES = [
  "PD Handover",
  "Construction Start",
  "Module Installation Start",
  "Module Installation End",
  "Commissioning",
  "Practical Completion",
  "O&M Handover",
  "Client Handover",
];

export default function KeyDatesPanel({ projectName }: KeyDatesPanelProps) {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [newMapping, setNewMapping] = useState({
    keyDateName: "",
    sourceTaskNameMatch: "",
    sourceTaskCode: "",
    dateField: "dueDate",
    precedenceRule: "actual_over_planned",
  });

  const { data: keyDates = [], isLoading } = useQuery<ResolvedKeyDate[]>({
    queryKey: ["key-dates", projectName],
    queryFn: async () => {
      const res = await fetch(`/api/key-dates/${encodeURIComponent(projectName)}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch("/api/key-date-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, projectName }),
      });
      if (!res.ok) throw new Error("Failed to create");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["key-dates", projectName] });
      setAddOpen(false);
      setNewMapping({ keyDateName: "", sourceTaskNameMatch: "", sourceTaskCode: "", dateField: "dueDate", precedenceRule: "actual_over_planned" });
      toast({ title: "Key date mapping added" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/key-date-mappings/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["key-dates", projectName] });
      toast({ title: "Mapping removed" });
    },
  });

  const validCount = keyDates.filter(d => d.mappingValid).length;
  const invalidCount = keyDates.filter(d => !d.mappingValid).length;

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-blue-600" />
            <CardTitle className="text-base">Key Project Dates</CardTitle>
            {keyDates.length > 0 && (
              <div className="flex gap-1 ml-2">
                <Badge variant="outline" className="text-[9px] bg-green-50 text-green-700 border-green-300">
                  {validCount} mapped
                </Badge>
                {invalidCount > 0 && (
                  <Badge variant="outline" className="text-[9px] bg-red-50 text-red-700 border-red-300">
                    {invalidCount} missing
                  </Badge>
                )}
              </div>
            )}
          </div>
          {isAdmin && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setAddOpen(true)} data-testid="button-add-key-date">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Mapping
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : keyDates.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            <p>No key date mappings configured.</p>
            <p className="text-xs mt-1">Add mappings to link project tasks to milestone dates.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {keyDates.map((kd) => (
              <div key={kd.id} className={`flex items-center justify-between p-2 rounded-md border ${kd.mappingValid ? "bg-white border-slate-200" : "bg-amber-50 border-amber-200"}`}
                data-testid={`key-date-${kd.id}`}>
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {kd.mappingValid ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{kd.keyDateName}</span>
                      {kd.matchedTaskNumber && (
                        <Badge variant="outline" className="text-[8px] px-1 py-0">#{kd.matchedTaskNumber}</Badge>
                      )}
                    </div>
                    {kd.mappingValid ? (
                      <div className="flex gap-3 text-[11px] text-muted-foreground mt-0.5">
                        <span>Planned: <span className="font-medium text-foreground">{formatDate(kd.plannedDate)}</span></span>
                        {kd.actualDate && (
                          <span>Actual: <span className="font-medium text-emerald-700">{formatDate(kd.actualDate)}</span></span>
                        )}
                        <span className="text-[10px] italic truncate max-w-[140px]" title={kd.matchedTaskTitle || ""}>
                          Task: {kd.matchedTaskTitle || "—"}
                        </span>
                      </div>
                    ) : (
                      <p className="text-[10px] text-amber-600 mt-0.5">
                        No matching task found
                        {kd.sourceTaskNameMatch && ` (pattern: "${kd.sourceTaskNameMatch}")`}
                        {kd.sourceTaskCode && ` (code: ${kd.sourceTaskCode})`}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {kd.effectiveDate && (
                    <span className="text-sm font-semibold text-blue-700">{formatDate(kd.effectiveDate)}</span>
                  )}
                  {isAdmin && (
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600"
                      onClick={() => deleteMutation.mutate(kd.id)} data-testid={`button-delete-kd-${kd.id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Key Date Mapping</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Key Date Name</Label>
              <Select value={newMapping.keyDateName} onValueChange={v => setNewMapping(m => ({ ...m, keyDateName: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select or type a name" /></SelectTrigger>
                <SelectContent>
                  {DEFAULT_KEY_DATES.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
              {!DEFAULT_KEY_DATES.includes(newMapping.keyDateName) && (
                <Input className="h-8 text-xs mt-1" placeholder="Custom name..." value={newMapping.keyDateName}
                  onChange={e => setNewMapping(m => ({ ...m, keyDateName: e.target.value }))}
                  data-testid="input-kd-custom-name" />
              )}
            </div>
            <div>
              <Label className="text-xs">Match Task By Name (contains)</Label>
              <Input className="h-8 text-xs" placeholder="e.g. commissioning, handover..."
                value={newMapping.sourceTaskNameMatch}
                onChange={e => setNewMapping(m => ({ ...m, sourceTaskNameMatch: e.target.value }))}
                data-testid="input-kd-name-match" />
            </div>
            <div>
              <Label className="text-xs">Or Match By Task Code</Label>
              <Input className="h-8 text-xs" placeholder="e.g. 4.3"
                value={newMapping.sourceTaskCode}
                onChange={e => setNewMapping(m => ({ ...m, sourceTaskCode: e.target.value }))}
                data-testid="input-kd-code" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Date Field</Label>
                <Select value={newMapping.dateField} onValueChange={v => setNewMapping(m => ({ ...m, dateField: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dueDate">End Date</SelectItem>
                    <SelectItem value="startDate">Start Date</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Precedence</Label>
                <Select value={newMapping.precedenceRule} onValueChange={v => setNewMapping(m => ({ ...m, precedenceRule: v }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="actual_over_planned">Actual overrides Planned</SelectItem>
                    <SelectItem value="planned_only">Planned only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button size="sm" data-testid="button-submit-kd"
              disabled={!newMapping.keyDateName || (!newMapping.sourceTaskNameMatch && !newMapping.sourceTaskCode) || createMutation.isPending}
              onClick={() => createMutation.mutate(newMapping)}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add Mapping"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
