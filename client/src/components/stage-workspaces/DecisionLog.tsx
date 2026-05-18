import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useStageDecisions } from "@/hooks/use-stage-lifecycle";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, FileText} from "lucide-react";
import { DECISION_CATEGORY_TYPES, LIFECYCLE_DEPARTMENTS, STAGE_CODES } from "@shared/schema";

const DECISION_TYPE_LABELS: Record<string, string> = {
  scope: "Scope Change",
  tariff: "Tariff Change",
  metering: "Metering Decision",
  commercial: "Commercial Deviation",
  technical: "Technical Change",
  contract: "Contract Amendment",
  design: "Design Change",
  procurement: "Material Substitution",
  GATE_PASS: "Gate Pass",
  GATE_FAIL: "Gate Fail",
  EXCEPTION_GRANTED: "Exception Granted",
  EXCEPTION_DENIED: "Exception Denied",
  STAGE_OVERRIDE: "Stage Override",
  STAGE_ROLLBACK: "Stage Rollback",
};

interface DecisionLogProps {
  projectId: number;
  stageCode: string;
  showUpstream?: boolean; // Show decisions from previous stages
}

export function DecisionLog({ projectId, stageCode, showUpstream = true }: DecisionLogProps) {
  const { data } = useStageDecisions(projectId);
  const [showForm, setShowForm] = useState(false);
  const [summary, setSummary] = useState("");
  const [rationale, setRationale] = useState("");
  const [decisionType, setDecisionType] = useState("scope");
  const [impactedDepts, setImpactedDepts] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [filterType, setFilterType] = useState<string>("");
  const qc = useQueryClient();

  // Get current stage index for upstream filtering
  const currentStageIdx = STAGE_CODES.indexOf(stageCode as any);

  const allDecisions = data?.decisions || [];

  // Show decisions from current stage + all previous stages (propagate forward)
  const decisions = useMemo(() => {
    let filtered = allDecisions.filter((d: any) => {
      if (showUpstream) {
        const dIdx = STAGE_CODES.indexOf(d.stageCode as any);
        return dIdx >= 0 && dIdx <= currentStageIdx;
      }
      return d.stageCode === stageCode;
    });

    if (filterType) {
      filtered = filtered.filter((d: any) => d.decisionType === filterType);
    }

    return filtered;
  }, [allDecisions, stageCode, currentStageIdx, showUpstream, filterType]);

  const toggleDept = (dept: string) => {
    setImpactedDepts(prev =>
      prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept]
    );
  };

  const handleAdd = async () => {
    if (!summary.trim()) return;
    setSaving(true);
    try {
      await apiRequest("POST", `/api/projects/${projectId}/stage-decisions`, {
        stageCode,
        decisionType,
        decisionSummary: summary,
        rationale: rationale || undefined,
        impactedDepartments: impactedDepts.length > 0 ? impactedDepts : undefined,
      });
      qc.invalidateQueries({ queryKey: [`/api/projects/${projectId}/stage-decisions`] });
      setSummary("");
      setRationale("");
      setDecisionType("scope");
      setImpactedDepts([]);
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
          <CardTitle className="text-sm">
            Decision Register
            {decisions.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">{decisions.length}</Badge>
            )}
          </CardTitle>
          <div className="flex gap-1">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="h-7 rounded border px-1 text-xs"
            >
              <option value="">All types</option>
              {DECISION_CATEGORY_TYPES.map((t) => (
                <option key={t} value={t}>{DECISION_TYPE_LABELS[t] || t}</option>
              ))}
            </select>
            <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}>
              <Plus className="mr-1 h-3 w-3" /> Add
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {showForm && (
          <div className="mb-3 space-y-2 rounded border p-2">
            <div className="flex gap-2">
              <select
                value={decisionType}
                onChange={(e) => setDecisionType(e.target.value)}
                className="h-8 rounded border px-2 text-xs flex-1"
              >
                {DECISION_CATEGORY_TYPES.map((t) => (
                  <option key={t} value={t}>{DECISION_TYPE_LABELS[t] || t}</option>
                ))}
              </select>
            </div>
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
            <div>
              <p className="text-xs text-muted-foreground mb-1">Impacted Departments:</p>
              <div className="flex flex-wrap gap-1">
                {LIFECYCLE_DEPARTMENTS.map((dept) => (
                  <Badge
                    key={dept}
                    variant={impactedDepts.includes(dept) ? "default" : "outline"}
                    className="cursor-pointer text-[10px]"
                    onClick={() => toggleDept(dept)}
                  >
                    {dept}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAdd} disabled={saving || !summary.trim()}>
                Save Decision
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {decisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No decisions logged yet.</p>
        ) : (
          <div className="space-y-2">
            {decisions.map((d: any) => {
              const isUpstream = d.stageCode !== stageCode;
              return (
                <div key={d.id} className={`flex gap-2 rounded border p-2 text-sm ${isUpstream ? "bg-muted/30" : ""}`}>
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px]">
                        {DECISION_TYPE_LABELS[d.decisionType] || d.decisionType}
                      </Badge>
                      {isUpstream && (
                        <Badge variant="secondary" className="text-[10px]">
                          {d.stageCode.replace(/_/g, " ").replace(/S\d+\s/, "")}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {new Date(d.decidedDate).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="mt-1">{d.decisionSummary}</p>
                    {d.rationale && <p className="mt-1 text-xs text-muted-foreground">{d.rationale}</p>}
                    {d.impactedDepartments && Array.isArray(d.impactedDepartments) && d.impactedDepartments.length > 0 && (
                      <div className="mt-1 flex gap-1">
                        {d.impactedDepartments.map((dept: string) => (
                          <Badge key={dept} variant="secondary" className="text-[10px]">{dept}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
