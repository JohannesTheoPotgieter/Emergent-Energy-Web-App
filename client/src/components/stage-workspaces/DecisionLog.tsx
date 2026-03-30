import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useStageDecisions } from "@/hooks/use-stage-lifecycle";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, FileText } from "lucide-react";

interface DecisionLogProps {
  projectId: number;
  stageCode: string;
}

export function DecisionLog({ projectId, stageCode }: DecisionLogProps) {
  const { data } = useStageDecisions(projectId);
  const [showForm, setShowForm] = useState(false);
  const [summary, setSummary] = useState("");
  const [rationale, setRationale] = useState("");
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const decisions = (data?.decisions || []).filter(
    (d: any) => d.stageCode === stageCode
  );

  const handleAdd = async () => {
    if (!summary.trim()) return;
    setSaving(true);
    try {
      await apiRequest("POST", `/api/projects/${projectId}/stage-decisions`, {
        stageCode,
        decisionType: "GATE_PASS",
        decisionSummary: summary,
        rationale: rationale || undefined,
      });
      qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/stage-decisions`] });
      setSummary("");
      setRationale("");
      setShowForm(false);
    } catch {
      // toast handled by queryClient
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Decision Log</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}>
            <Plus className="mr-1 h-3 w-3" /> Add
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {showForm && (
          <div className="mb-3 space-y-2 rounded border p-2">
            <Input
              placeholder="Decision summary..."
              value={summary}
              onChange={e => setSummary(e.target.value)}
              className="h-8 text-sm"
            />
            <Textarea
              placeholder="Rationale (optional)..."
              value={rationale}
              onChange={e => setRationale(e.target.value)}
              className="text-sm min-h-[40px]"
              rows={2}
            />
            <Button size="sm" onClick={handleAdd} disabled={saving || !summary.trim()}>
              Save Decision
            </Button>
          </div>
        )}

        {decisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No decisions logged yet.</p>
        ) : (
          <div className="space-y-2">
            {decisions.map((d: any) => (
              <div key={d.id} className="flex gap-2 rounded border p-2 text-sm">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{d.decisionType}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(d.decidedDate).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="mt-1">{d.decisionSummary}</p>
                  {d.rationale && <p className="mt-1 text-xs text-muted-foreground">{d.rationale}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
