import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Slider } from "@/components/ui/slider";
import { Star, ClipboardCheck, Save, AlertCircle } from "lucide-react";

async function qFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { ...options, headers: { ...headers, ...options?.headers }, credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

interface PostMortemPanelProps {
  projectName: string;
  checklistId: number;
}

interface MetricValue {
  id: number;
  metricId?: number;
  templateMetricId?: number;
  metricName?: string;
  description?: string;
  weight?: number;
  score: number | null;
  notes?: string;
  inputValueNumber?: number | null;
  inputValueChoice?: string | null;
}

interface TemplateMetric {
  id: number;
  metricName: string;
  description?: string;
  metricGroup?: string;
  inputType?: string;
  weight?: number;
  scoringRuleJson?: any;
}

interface PostMortemData {
  postmortem: {
    id: number;
    projectName: string;
    completedAt?: string;
    completedByUserId?: number;
  } | null;
  metricValues: MetricValue[];
  metrics?: TemplateMetric[];
  summary?: {
    contractorQualityScore: number | null;
    engineeringQualityScore: number | null;
    redFlag: boolean;
  } | null;
}

interface LocalMetricState {
  score: number;
  notes: string;
  inputValueNumber: number | null;
  inputValueChoice: string | null;
}

export default function PostMortemPanel({ projectName, checklistId }: PostMortemPanelProps) {
  const queryClient = useQueryClient();
  const [localMetrics, setLocalMetrics] = useState<Record<number, LocalMetricState>>({});
  const [saving, setSaving] = useState(false);

  const { data, isLoading, refetch } = useQuery<PostMortemData>({
    queryKey: ["postmortem", projectName],
    queryFn: () => qFetch(`/api/quality/postmortem/${encodeURIComponent(projectName)}`),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      qFetch(`/api/quality/postmortem/${encodeURIComponent(projectName)}`, {
        method: "POST",
        body: JSON.stringify({ metricInputs: [] }),
      }),
    onSuccess: () => {
      refetch();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (metricInputs: any[]) =>
      qFetch(`/api/quality/postmortem/${encodeURIComponent(projectName)}`, {
        method: "POST",
        body: JSON.stringify({ metricInputs }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["postmortem", projectName] });
      setSaving(false);
    },
    onError: () => {
      setSaving(false);
    },
  });

  const handleSave = () => {
    if (!data?.metrics) return;
    setSaving(true);

    const metricInputs = data.metrics.map((metric) => {
      const local = localMetrics[metric.id];
      const existing = data.metricValues?.find(
        (v) => v.templateMetricId === metric.id
      );

      return {
        templateMetricId: metric.id,
        inputValueNumber: local?.inputValueNumber ?? existing?.inputValueNumber ?? (local?.score ?? existing?.score ?? null),
        inputValueChoice: local?.inputValueChoice ?? existing?.inputValueChoice ?? null,
      };
    });

    saveMutation.mutate(metricInputs);
  };

  const updateLocalMetric = (metricId: number, updates: Partial<LocalMetricState>) => {
    setLocalMetrics((prev) => ({
      ...prev,
      [metricId]: {
        ...(prev[metricId] || { score: 0, notes: "", inputValueNumber: null, inputValueChoice: null }),
        ...updates,
      },
    }));
  };

  if (isLoading) {
    return (
      <div data-testid="postmortem-panel" className="space-y-4">
        <Card className="animate-pulse">
          <CardContent className="p-6">
            <div className="h-24 bg-muted rounded" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data?.postmortem) {
    return (
      <div data-testid="postmortem-panel" className="space-y-4">
        <Card>
          <CardContent className="p-8 text-center">
            <ClipboardCheck className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Post-Mortem Review</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Start a post-mortem review to evaluate project quality metrics and generate a final score.
            </p>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              data-testid="postmortem-save"
            >
              {createMutation.isPending ? "Creating..." : "Start Post-Mortem Review"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const metrics = data.metrics || [];
  const metricValues = data.metricValues || [];
  const summary = data.summary;

  const contractorMetrics = metrics.filter((m) => m.metricGroup === "contractor_quality");
  const engineeringMetrics = metrics.filter((m) => m.metricGroup === "engineering_quality");
  const otherMetrics = metrics.filter(
    (m) => m.metricGroup !== "contractor_quality" && m.metricGroup !== "engineering_quality"
  );

  const renderMetricCard = (metric: TemplateMetric) => {
    const existing = metricValues.find((v) => v.templateMetricId === metric.id);
    const local = localMetrics[metric.id];
    const currentScore = local?.inputValueNumber ?? existing?.inputValueNumber ?? existing?.score ?? 0;
    const currentChoice = local?.inputValueChoice ?? existing?.inputValueChoice ?? null;

    return (
      <Card key={metric.id} data-testid={`postmortem-metric-${metric.id}`} className="border-border/50">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-sm">{metric.metricName}</h4>
              {metric.description && (
                <p className="text-xs text-muted-foreground mt-0.5">{metric.description}</p>
              )}
            </div>
            {existing?.score != null && (
              <Badge
                variant="outline"
                className={
                  existing.score >= 0.85
                    ? "bg-emerald-50 text-emerald-600 border-emerald-200"
                    : existing.score >= 0.5
                    ? "bg-amber-50 text-amber-600 border-amber-200"
                    : "bg-red-50 text-red-600 border-red-200"
                }
              >
                {Math.round(existing.score * 100)}%
              </Badge>
            )}
          </div>

          <div data-testid={`postmortem-score-${metric.id}`}>
            {metric.inputType === "choice" ? (
              <SearchableSelect
                value={currentChoice || ""}
                onValueChange={(val) =>
                  updateLocalMetric(metric.id, { inputValueChoice: val })
                }
                placeholder="Select an option"
                triggerClassName="w-full"
                options={(() => {
                  const rule = metric.scoringRuleJson;
                  if (rule?.choices) {
                    const descParts = (rule.description || "").split(",").map((s: string) => s.trim());
                    const labelMap: Record<string, string> = {};
                    descParts.forEach((part: string) => {
                      const match = part.match(/^(\d+)\s*=\s*(.+)/);
                      if (match) labelMap[match[1]] = match[2];
                    });
                    return Object.keys(rule.choices).map((key) => ({
                      value: key,
                      label: labelMap[key] ? `${key} — ${labelMap[key]}` : key,
                    }));
                  }
                  return [
                    { value: "none", label: "None" },
                    { value: "minor", label: "Minor" },
                    { value: "moderate", label: "Moderate" },
                    { value: "major", label: "Major" },
                    { value: "critical", label: "Critical" },
                  ];
                })()}
              />
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Score</span>
                  <span className="text-sm font-mono font-medium">{currentScore}</span>
                </div>
                <Slider
                  value={[Number(currentScore) || 0]}
                  onValueChange={([val]) =>
                    updateLocalMetric(metric.id, { inputValueNumber: val, score: val })
                  }
                  min={0}
                  max={5}
                  step={1}
                  className="w-full"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>0</span>
                  <span>1</span>
                  <span>2</span>
                  <span>3</span>
                  <span>4</span>
                  <span>5</span>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderMetricGroup = (title: string, groupMetrics: TemplateMetric[]) => {
    if (groupMetrics.length === 0) return null;
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {groupMetrics.map(renderMetricCard)}
        </div>
      </div>
    );
  };

  return (
    <div data-testid="postmortem-panel" className="space-y-6">
      {summary && (
        <Card className={summary.redFlag ? "border-red-500/50" : "border-emerald-200"}>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Star className="h-5 w-5 text-amber-500" />
              Post-Mortem Summary
              {summary.redFlag && (
                <Badge variant="destructive" className="ml-2">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  Red Flag
                </Badge>
              )}
              {data.postmortem.completedAt && (
                <Badge variant="outline" className="ml-auto bg-emerald-50 text-emerald-600 border-emerald-200 text-xs">
                  Completed
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-4 rounded-lg bg-muted/30">
                <p className="text-xs text-muted-foreground mb-1">Contractor Quality</p>
                <p className="text-2xl font-bold">
                  {summary.contractorQualityScore != null
                    ? `${Math.round(summary.contractorQualityScore * 100)}%`
                    : "—"}
                </p>
              </div>
              <div className="text-center p-4 rounded-lg bg-muted/30">
                <p className="text-xs text-muted-foreground mb-1">Engineering Quality</p>
                <p className="text-2xl font-bold">
                  {summary.engineeringQualityScore != null
                    ? `${Math.round(summary.engineeringQualityScore * 100)}%`
                    : "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {renderMetricGroup("Contractor Quality", contractorMetrics)}
      {renderMetricGroup("Engineering Quality", engineeringMetrics)}
      {renderMetricGroup("Other Metrics", otherMetrics)}

      {metrics.length > 0 && (
        <div className="flex justify-end">
          <Button
            data-testid="postmortem-save"
            onClick={handleSave}
            disabled={saving || saveMutation.isPending}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save Post-Mortem"}
          </Button>
        </div>
      )}
    </div>
  );
}
