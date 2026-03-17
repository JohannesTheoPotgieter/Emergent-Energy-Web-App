import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Link } from "wouter";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Clock,
  Shield,
  FileWarning,
  Users,
  FolderOpen,
  ArrowRight,
  Filter,
  RotateCcw,
  ExternalLink,
  BarChart3,
  SlidersHorizontal,
  Layers3,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ChartType = "line" | "area" | "bar" | "composed";

type ChartMetric = {
  key: string;
  label: string;
  format: "currency" | "percent" | "number";
  color: string;
};

type ChartDataset = {
  id: string;
  label: string;
  description: string;
  dimensionKey: string;
  dimensionLabel: string;
  defaultChartType: ChartType;
  allowedChartTypes: ChartType[];
  metrics: ChartMetric[];
  rows: Array<Record<string, string | number | null>>;
};

type ChartPreset = {
  id: string;
  title: string;
  description: string;
  datasetId: string;
  chartType: ChartType;
  metricKeys: string[];
  stacked?: boolean;
};

type DashboardResponse = {
  meta: { fyStart: string; fyEnd: string };
  kpis: Record<string, number | null>;
  options: { portfolios: string[]; pms: string[]; pds: string[]; executionPhases: string[]; rags: string[] };
  projects: any[];
  actionCenter: Record<string, any[]>;
  charts?: {
    supportedChartTypes: ChartType[];
    presets: ChartPreset[];
    datasets: ChartDataset[];
  };
};

type BuilderState = {
  datasetId: string;
  chartType: ChartType;
  metricKeys: string[];
};

const GRAPH_BUILDER_STORAGE_KEY = "execution-dashboard-graph-builder-v1";
const tabs = ["Program", "COO", "Finance", "Construction"] as const;

const money = (n: number | null | undefined) =>
  `R ${(Number(n || 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const pct = (n: number | null | undefined) => (n == null ? "-" : `${Number(n).toFixed(1)}%`);

function formatMetricValue(value: number | null | undefined, format: ChartMetric["format"]) {
  const numeric = Number(value || 0);
  if (format === "currency") return `R ${numeric.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (format === "percent") return `${numeric.toFixed(1)}%`;
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function compactAxisTick(value: number) {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function severityStyle(severity: string) {
  const s = severity?.toLowerCase();
  if (s === "critical") return { bg: "bg-red-50 border-red-200", text: "text-red-700", dot: "bg-red-500" };
  if (s === "high") return { bg: "bg-orange-50 border-orange-200", text: "text-orange-700", dot: "bg-orange-500" };
  if (s === "medium") return { bg: "bg-amber-50 border-amber-200", text: "text-amber-700", dot: "bg-amber-500" };
  return { bg: "bg-slate-50 border-slate-200", text: "text-slate-600", dot: "bg-slate-400" };
}

function queueMeta(key: string) {
  switch (key) {
    case "projectsBehindPlan":
      return { icon: <Clock className="w-4 h-4 text-red-500" />, border: "border-l-red-500", bg: "bg-red-50/30" };
    case "inflowAtRisk":
      return { icon: <DollarSign className="w-4 h-4 text-blue-500" />, border: "border-l-blue-500", bg: "bg-blue-50/30" };
    case "expenditureAtRisk":
      return { icon: <TrendingDown className="w-4 h-4 text-orange-500" />, border: "border-l-orange-500", bg: "bg-orange-50/30" };
    case "engineeringBottlenecks":
      return { icon: <Shield className="w-4 h-4 text-violet-500" />, border: "border-l-violet-500", bg: "bg-violet-50/30" };
    case "qualityIssues":
      return { icon: <FileWarning className="w-4 h-4 text-amber-500" />, border: "border-l-amber-500", bg: "bg-amber-50/30" };
    case "pendingApprovalsDecisions":
      return { icon: <Users className="w-4 h-4 text-emerald-500" />, border: "border-l-emerald-500", bg: "bg-emerald-50/30" };
    default:
      return { icon: <AlertCircle className="w-4 h-4 text-slate-500" />, border: "border-l-slate-400", bg: "bg-slate-50/30" };
  }
}

function ragBadge(rag: string) {
  if (rag === "Red") return "bg-red-100 text-red-700 border-red-200";
  if (rag === "Amber") return "bg-amber-100 text-amber-700 border-amber-200";
  if (rag === "Green") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  return "bg-slate-100 text-slate-500 border-slate-200";
}

function ensureMetricKeys(dataset: ChartDataset | undefined, metricKeys: string[]) {
  if (!dataset) return [];
  const available = new Set(dataset.metrics.map((metric) => metric.key));
  const valid = metricKeys.filter((metricKey) => available.has(metricKey));
  if (valid.length > 0) return valid.slice(0, 3);
  return dataset.metrics.slice(0, Math.min(2, dataset.metrics.length)).map((metric) => metric.key);
}

function ExecutionChartCard({
  dataset,
  title,
  description,
  chartType,
  metricKeys,
  stacked = false,
  testId,
}: {
  dataset?: ChartDataset;
  title: string;
  description: string;
  chartType: ChartType;
  metricKeys: string[];
  stacked?: boolean;
  testId: string;
}) {
  const selectedMetrics = useMemo(
    () => (dataset?.metrics || []).filter((metric) => metricKeys.includes(metric.key)),
    [dataset, metricKeys],
  );

  if (!dataset || dataset.rows.length === 0 || selectedMetrics.length === 0) {
    return (
      <Card className="border-border" data-testid={testId}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="text-sm text-muted-foreground">{description}</p>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
            No imported data is available for this chart with the current filters.
          </div>
        </CardContent>
      </Card>
    );
  }

  const firstMetric = selectedMetrics[0];
  const tooltipFormatter = (value: number, name: string) => {
    const metric = selectedMetrics.find((item) => item.label === name || item.key === name) || firstMetric;
    return [formatMetricValue(value, metric?.format || "number"), metric?.label || name];
  };
  const tooltipLabelFormatter = (label: string) => `${dataset.dimensionLabel}: ${label}`;

  const commonChildren = (
    <>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.2)" />
      <XAxis dataKey={dataset.dimensionKey} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} height={42} />
      <YAxis tickLine={false} axisLine={false} width={68} tickFormatter={compactAxisTick} />
      <Tooltip formatter={tooltipFormatter} labelFormatter={tooltipLabelFormatter} />
      <Legend />
    </>
  );

  const chartProps = {
    data: dataset.rows,
    margin: { top: 8, right: 12, bottom: 0, left: 0 },
  };

  return (
    <Card className="border-border" data-testid={testId}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          </div>
          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
            {dataset.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            {chartType === "area" ? (
              <AreaChart {...chartProps}>
                {commonChildren}
                {selectedMetrics.map((metric) => (
                  <Area
                    key={metric.key}
                    type="monotone"
                    dataKey={metric.key}
                    name={metric.label}
                    stroke={metric.color}
                    fill={metric.color}
                    fillOpacity={0.18}
                    strokeWidth={2}
                    stackId={stacked ? "stack" : undefined}
                  />
                ))}
              </AreaChart>
            ) : chartType === "bar" ? (
              <BarChart {...chartProps}>
                {commonChildren}
                {selectedMetrics.map((metric) => (
                  <Bar
                    key={metric.key}
                    dataKey={metric.key}
                    name={metric.label}
                    fill={metric.color}
                    radius={[6, 6, 0, 0]}
                    stackId={stacked ? "stack" : undefined}
                  />
                ))}
              </BarChart>
            ) : chartType === "composed" ? (
              <ComposedChart {...chartProps}>
                {commonChildren}
                <Bar dataKey={selectedMetrics[0].key} name={selectedMetrics[0].label} fill={selectedMetrics[0].color} radius={[6, 6, 0, 0]} />
                {selectedMetrics.slice(1).map((metric) => (
                  <Line
                    key={metric.key}
                    type="monotone"
                    dataKey={metric.key}
                    name={metric.label}
                    stroke={metric.color}
                    strokeWidth={2.5}
                    dot={false}
                  />
                ))}
              </ComposedChart>
            ) : (
              <LineChart {...chartProps}>
                {commonChildren}
                {selectedMetrics.map((metric) => (
                  <Line
                    key={metric.key}
                    type="monotone"
                    dataKey={metric.key}
                    name={metric.label}
                    stroke={metric.color}
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                ))}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("Program");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [collapsedQueues, setCollapsedQueues] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState({
    search: "",
    portfolio: "all",
    pm: "all",
    pd: "all",
    executionPhase: "all",
    rag: "all",
    exceptionOnly: false,
    behindPlanOnly: false,
    inflowRiskOnly: false,
    outflowRiskOnly: false,
    engineeringBlockersOnly: false,
    qualityIssuesOnly: false,
    pendingApprovalsOnly: false,
    staleImportsOnly: false,
  });
  const [activePresetId, setActivePresetId] = useState<string>("forecast-2026");
  const [builderState, setBuilderState] = useState<BuilderState>(() => {
    if (typeof window === "undefined") {
      return { datasetId: "monthlyForecast", chartType: "line", metricKeys: ["plannedRevenue", "plannedCos"] };
    }
    try {
      const raw = window.localStorage.getItem(GRAPH_BUILDER_STORAGE_KEY);
      if (!raw) {
        return { datasetId: "monthlyForecast", chartType: "line", metricKeys: ["plannedRevenue", "plannedCos"] };
      }
      return JSON.parse(raw) as BuilderState;
    } catch {
      return { datasetId: "monthlyForecast", chartType: "line", metricKeys: ["plannedRevenue", "plannedCos"] };
    }
  });

  const query = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (typeof v === "boolean") {
        if (v) params.set(k, "true");
      } else if (v && v !== "all") {
        params.set(k, v);
      }
    });
    return params.toString();
  }, [filters]);

  const { data, isLoading } = useQuery<DashboardResponse>({
    queryKey: ["/api/program-dashboard", query],
    queryFn: async () => {
      const res = await fetch(`/api/program-dashboard${query ? `?${query}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const opts = data?.options || { portfolios: [], pms: [], pds: [], executionPhases: [], rags: [] };
  const chartDatasets = data?.charts?.datasets || [];
  const chartPresets = data?.charts?.presets || [];
  const datasetMap = useMemo(() => new Map(chartDatasets.map((dataset) => [dataset.id, dataset])), [chartDatasets]);
  const presetMap = useMemo(() => new Map(chartPresets.map((preset) => [preset.id, preset])), [chartPresets]);

  useEffect(() => {
    if (chartPresets.length === 0) return;
    if (!presetMap.has(activePresetId)) {
      setActivePresetId(chartPresets[0].id);
    }
  }, [activePresetId, chartPresets, presetMap]);

  useEffect(() => {
    if (chartDatasets.length === 0) return;
    const dataset = datasetMap.get(builderState.datasetId) || chartDatasets[0];
    const nextMetricKeys = ensureMetricKeys(dataset, builderState.metricKeys);
    const nextChartType = dataset.allowedChartTypes.includes(builderState.chartType)
      ? builderState.chartType
      : dataset.defaultChartType;

    if (
      dataset.id !== builderState.datasetId ||
      nextChartType !== builderState.chartType ||
      nextMetricKeys.join("|") !== builderState.metricKeys.join("|")
    ) {
      setBuilderState({
        datasetId: dataset.id,
        chartType: nextChartType,
        metricKeys: nextMetricKeys,
      });
    }
  }, [builderState, chartDatasets, datasetMap]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(GRAPH_BUILDER_STORAGE_KEY, JSON.stringify(builderState));
  }, [builderState]);

  const activePreset = presetMap.get(activePresetId) || chartPresets[0];
  const activePresetDataset = activePreset ? datasetMap.get(activePreset.datasetId) : undefined;
  const builderDataset = datasetMap.get(builderState.datasetId) || chartDatasets[0];

  const toggleQueue = (queue: string) => {
    setCollapsedQueues((prev) => {
      const next = new Set(prev);
      if (next.has(queue)) next.delete(queue);
      else next.add(queue);
      return next;
    });
  };

  const queueKeys: Array<[string, string]> = [
    ["projectsBehindPlan", "Projects Behind Plan"],
    ["inflowAtRisk", "Inflow at Risk"],
    ["expenditureAtRisk", "Expenditure / COS at Risk"],
    ["engineeringBottlenecks", "Engineering Bottlenecks"],
    ["qualityIssues", "Quality Issues"],
    ["pendingApprovalsDecisions", "Pending Approvals / Decisions"],
  ];

  const hasActiveFilters =
    filters.search ||
    filters.portfolio !== "all" ||
    filters.pm !== "all" ||
    filters.pd !== "all" ||
    filters.executionPhase !== "all" ||
    filters.rag !== "all" ||
    filters.exceptionOnly ||
    filters.behindPlanOnly ||
    filters.inflowRiskOnly ||
    filters.outflowRiskOnly ||
    filters.engineeringBlockersOnly ||
    filters.qualityIssuesOnly ||
    filters.pendingApprovalsOnly ||
    filters.staleImportsOnly;

  const totalActionItems = useMemo(() => {
    if (!data?.actionCenter) return 0;
    return queueKeys.reduce((sum, [k]) => sum + (data.actionCenter[k]?.length || 0), 0);
  }, [data?.actionCenter]);

  const financeDataset = datasetMap.get("monthlyForecast");
  const cashflowDataset = datasetMap.get("weeklyCashflow");
  const phaseDataset = datasetMap.get("phaseSummary");
  const timelineDataset = datasetMap.get("milestonePipeline");
  const constructionWindowDataset = datasetMap.get("constructionWindow");
  const pmDataset = datasetMap.get("pmSummary");

  return (
    <div className="ee-page p-0 pb-8" data-testid="execution-dashboard-page">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">
              <Activity className="w-5 h-5 text-emerald-600" />
            </div>
            Execution Dashboard
          </h1>
          {data?.meta && (
            <p className="text-muted-foreground text-sm mt-1.5 ml-[46px]">
              Financial year <span className="font-medium text-foreground">{data.meta.fyStart}</span> to{" "}
              <span className="font-medium text-foreground">{data.meta.fyEnd}</span>
            </p>
          )}
        </div>
        {hasActiveFilters && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setFilters({
                search: "",
                portfolio: "all",
                pm: "all",
                pd: "all",
                executionPhase: "all",
                rag: "all",
                exceptionOnly: false,
                behindPlanOnly: false,
                inflowRiskOnly: false,
                outflowRiskOnly: false,
                engineeringBlockersOnly: false,
                qualityIssuesOnly: false,
                pendingApprovalsOnly: false,
                staleImportsOnly: false,
              })
            }
            className="gap-1.5 text-muted-foreground"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Clear filters
          </Button>
        )}
      </div>

      <Card className="border-border">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Filters</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
            <Input
              placeholder="Search projects..."
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              className="h-9"
              data-testid="input-filter-search"
            />
            <SearchableSelect
              value={filters.portfolio}
              onValueChange={(v) => setFilters((f) => ({ ...f, portfolio: v }))}
              placeholder="Portfolio"
              options={[{ value: "all", label: "All Portfolios" }, ...opts.portfolios.map((v) => ({ value: v, label: v }))]}
            />
            <SearchableSelect
              value={filters.pm}
              onValueChange={(v) => setFilters((f) => ({ ...f, pm: v }))}
              placeholder="Project Manager"
              options={[{ value: "all", label: "All PMs" }, ...opts.pms.map((v) => ({ value: v, label: v }))]}
            />
            <SearchableSelect
              value={filters.pd}
              onValueChange={(v) => setFilters((f) => ({ ...f, pd: v }))}
              placeholder="Project Developer"
              options={[{ value: "all", label: "All PDs" }, ...opts.pds.map((v) => ({ value: v, label: v }))]}
            />
            <SearchableSelect
              value={filters.executionPhase}
              onValueChange={(v) => setFilters((f) => ({ ...f, executionPhase: v }))}
              placeholder="Execution Phase"
              options={[{ value: "all", label: "All Phases" }, ...opts.executionPhases.map((v) => ({ value: v, label: v }))]}
            />
            <SearchableSelect
              value={filters.rag}
              onValueChange={(v) => setFilters((f) => ({ ...f, rag: v }))}
              placeholder="RAG Status"
              options={[{ value: "all", label: "All RAG" }, ...opts.rags.map((v) => ({ value: v, label: v }))]}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["exceptionOnly", "Exceptions"],
                ["behindPlanOnly", "Behind plan"],
                ["inflowRiskOnly", "Inflow risk"],
                ["outflowRiskOnly", "Outflow risk"],
                ["engineeringBlockersOnly", "Eng. blockers"],
                ["qualityIssuesOnly", "Quality issues"],
                ["pendingApprovalsOnly", "Pending approvals"],
                ["staleImportsOnly", "Stale imports"],
              ] as const
            ).map(([key, label]) => {
              const active = Boolean((filters as any)[key]);
              return (
                <button
                  key={key}
                  onClick={() => setFilters((f) => ({ ...f, [key]: !active }))}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border transition-all ${
                    active
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "bg-background border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                  data-testid={`filter-toggle-${key}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                <FolderOpen className="w-4 h-4 text-blue-600" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">Portfolio</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <div>
                <p className="text-[10px] text-muted-foreground">Active Projects</p>
                <p className="text-lg font-bold">{Number(data?.kpis?.activeDashboardProjects || 0)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Behind Plan</p>
                <p className="text-lg font-bold text-red-700">{Number(data?.kpis?.projectsBehindPlan || 0)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Avg. Actual</p>
                <p className="text-sm font-semibold">{pct(data?.kpis?.averageActualProgressPct)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Avg. Expected</p>
                <p className="text-sm font-semibold">{pct(data?.kpis?.averageExpectedProgressPct)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">Revenue & Inflow</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <div>
                <p className="text-[10px] text-muted-foreground">Planned Revenue</p>
                <p className="text-sm font-semibold">{money(data?.kpis?.plannedRevenueFy)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Received</p>
                <p className="text-sm font-semibold text-emerald-600">{money(data?.kpis?.receivedInflowFy)}</p>
              </div>
              <div className="col-span-2">
                <p className="text-[10px] text-muted-foreground">Open Inflow</p>
                <p className="text-lg font-bold text-amber-600">{money(data?.kpis?.openInflowFy)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
                <TrendingDown className="w-4 h-4 text-orange-600" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">Expenditure</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <div>
                <p className="text-[10px] text-muted-foreground">Planned</p>
                <p className="text-sm font-semibold">{money(data?.kpis?.plannedExpenditureFy)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Paid</p>
                <p className="text-sm font-semibold text-emerald-600">{money(data?.kpis?.paidExpenditureFy)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Open</p>
                <p className="text-sm font-semibold text-amber-600">{money(data?.kpis?.openExpenditureFy)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">GP Margin</p>
                <p className="text-sm font-semibold">{pct(data?.kpis?.grossMarginPctFy ? data.kpis.grossMarginPctFy * 100 : null)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-red-700" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">Risks & Actions</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <div>
                <p className="text-[10px] text-muted-foreground">Eng. Blockers</p>
                <p className="text-sm font-semibold">{Number(data?.kpis?.openEngineeringBlockers || 0)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Quality Issues</p>
                <p className="text-sm font-semibold">{Number(data?.kpis?.openQualityWarnings || 0)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Pending Approvals</p>
                <p className="text-sm font-semibold">{Number(data?.kpis?.pendingApprovals || 0)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Stale Imports</p>
                <p className="text-sm font-semibold">{Number(data?.kpis?.staleImports || 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-1 border-b pb-0">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
            data-testid={`tab-${t}`}
          >
            {t}
          </button>
        ))}
      </div>

      {activeTab === "Program" && (
        <div className="space-y-4">
          <Card className="border-border bg-gradient-to-br from-emerald-50 via-white to-blue-50">
            <CardContent className="p-4 md:p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 text-emerald-700 mb-1">
                    <Layers3 className="w-4 h-4" />
                    <span className="text-xs font-semibold uppercase tracking-[0.18em]">Workbook-aligned Program Dashboard</span>
                  </div>
                  <h2 className="text-lg font-semibold text-foreground">Program Dashboard Views</h2>
                  <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
                    These preset charts mirror the live program dashboard logic from imported execution, finance, and milestone data.
                    Use them as the fast operational view, then switch to the graph builder below for custom combinations.
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                  Imported data only
                </Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {chartPresets.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => setActivePresetId(preset.id)}
                    className={`rounded-lg border px-3 py-2 text-left transition-all ${
                      activePreset?.id === preset.id
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800 shadow-sm"
                        : "border-border bg-background hover:bg-muted/50 text-foreground"
                    }`}
                    data-testid={`preset-${preset.id}`}
                  >
                    <div className="text-sm font-medium">{preset.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{preset.description}</div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <ExecutionChartCard
            dataset={activePresetDataset}
            title={activePreset?.title || "Program dashboard chart"}
            description={activePreset?.description || "Live chart from imported program data."}
            chartType={activePreset?.chartType || "line"}
            metricKeys={activePreset?.metricKeys || []}
            stacked={Boolean(activePreset?.stacked)}
            testId="program-preset-chart"
          />

          <Card className="border-border" data-testid="execution-graph-builder">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 text-blue-700 mb-1">
                    <SlidersHorizontal className="w-4 h-4" />
                    <span className="text-xs font-semibold uppercase tracking-[0.18em]">Graph Builder</span>
                  </div>
                  <CardTitle className="text-base">Build graphs from imported execution data</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Choose the dataset, chart type, and up to three metrics. The builder stays tied to the same filtered project population above.
                  </p>
                </div>
                {activePreset && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const presetDataset = datasetMap.get(activePreset.datasetId);
                      if (!presetDataset) return;
                      setBuilderState({
                        datasetId: presetDataset.id,
                        chartType: activePreset.chartType,
                        metricKeys: ensureMetricKeys(presetDataset, activePreset.metricKeys),
                      });
                    }}
                    className="gap-1.5"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                    Load current preset
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <SearchableSelect
                  value={builderState.datasetId}
                  onValueChange={(value) => {
                    const nextDataset = datasetMap.get(value);
                    if (!nextDataset) return;
                    setBuilderState({
                      datasetId: nextDataset.id,
                      chartType: nextDataset.defaultChartType,
                      metricKeys: ensureMetricKeys(nextDataset, []),
                    });
                  }}
                  placeholder="Dataset"
                  options={chartDatasets.map((dataset) => ({ value: dataset.id, label: dataset.label }))}
                />
                <SearchableSelect
                  value={builderState.chartType}
                  onValueChange={(value) => setBuilderState((current) => ({ ...current, chartType: value as ChartType }))}
                  placeholder="Chart Type"
                  options={(builderDataset?.allowedChartTypes || data?.charts?.supportedChartTypes || ["line", "area", "bar", "composed"]).map((type) => ({
                    value: type,
                    label: type[0].toUpperCase() + type.slice(1),
                  }))}
                />
                <div className="rounded-lg border border-border px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-medium">Dataset Source</div>
                  <div className="text-sm font-medium mt-1">{builderDataset?.label || "No dataset selected"}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{builderDataset?.description}</div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div>
                    <p className="text-sm font-medium">Metrics</p>
                    <p className="text-xs text-muted-foreground">Select up to 3 metrics for the chart.</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                    {builderState.metricKeys.length}/3 selected
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(builderDataset?.metrics || []).map((metric) => {
                    const selected = builderState.metricKeys.includes(metric.key);
                    return (
                      <button
                        key={metric.key}
                        onClick={() => {
                          setBuilderState((current) => {
                            const exists = current.metricKeys.includes(metric.key);
                            if (exists) {
                              if (current.metricKeys.length === 1) return current;
                              return { ...current, metricKeys: current.metricKeys.filter((metricKey) => metricKey !== metric.key) };
                            }
                            if (current.metricKeys.length >= 3) {
                              return { ...current, metricKeys: [...current.metricKeys.slice(1), metric.key] };
                            }
                            return { ...current, metricKeys: [...current.metricKeys, metric.key] };
                          });
                        }}
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all ${
                          selected
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                            : "border-border bg-background text-foreground hover:bg-muted/50"
                        }`}
                        data-testid={`builder-metric-${metric.key}`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: metric.color }} />
                        {metric.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <ExecutionChartCard
                dataset={builderDataset}
                title={builderDataset?.label || "Custom graph"}
                description={
                  builderDataset
                    ? `${builderDataset.description} X-axis: ${builderDataset.dimensionLabel}.`
                    : "Choose a dataset to build a custom graph."
                }
                chartType={builderState.chartType}
                metricKeys={builderState.metricKeys}
                testId="execution-builder-chart"
              />
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "COO" && (
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-500" />
                <h2 className="text-base font-semibold">Action Center</h2>
                <Badge variant="outline" className="text-xs ml-1">
                  {totalActionItems} items
                </Badge>
              </div>
            </div>

            <div className="space-y-3">
              {queueKeys.map(([k, title]) => {
                const rows = data?.actionCenter?.[k] || [];
                if (rows.length === 0) return null;
                const meta = queueMeta(k);
                const isCollapsed = collapsedQueues.has(k);
                const criticalCount = rows.filter((r: any) => r.severity?.toLowerCase() === "critical").length;

                return (
                  <div key={k} className={`rounded-lg border border-l-4 overflow-hidden ${meta.border} ${meta.bg}`}>
                    <button
                      onClick={() => toggleQueue(k)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/40 transition-colors"
                      data-testid={`queue-toggle-${k}`}
                    >
                      {meta.icon}
                      <span className="text-sm font-semibold flex-1">{title}</span>
                      <Badge variant="outline" className="text-[10px] font-medium">
                        {rows.length} {rows.length === 1 ? "issue" : "issues"}
                      </Badge>
                      {criticalCount > 0 && (
                        <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">{criticalCount} critical</Badge>
                      )}
                      {isCollapsed ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
                    </button>

                    {!isCollapsed && (
                      <div className="bg-white/60 border-t">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
                              <th className="text-left py-2 px-4 font-medium">Project</th>
                              <th className="text-left py-2 px-4 font-medium">Issue</th>
                              <th className="text-left py-2 px-4 font-medium">Severity</th>
                              <th className="text-left py-2 px-4 font-medium">Owner</th>
                              <th className="text-left py-2 px-4 font-medium">Due</th>
                              <th className="text-right py-2 px-4 font-medium w-16"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r: any, idx: number) => {
                              const sev = severityStyle(r.severity);
                              return (
                                <tr key={idx} className="border-t border-border/40 hover:bg-white/80 transition-colors">
                                  <td className="py-2.5 px-4 font-medium text-foreground">{r.project}</td>
                                  <td className="py-2.5 px-4 text-muted-foreground max-w-[300px] truncate">{r.issueTitle}</td>
                                  <td className="py-2.5 px-4">
                                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium border ${sev.bg} ${sev.text}`}>
                                      <span className={`w-1.5 h-1.5 rounded-md ${sev.dot}`} />
                                      {r.severity}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-4 text-muted-foreground">{r.owner || "-"}</td>
                                  <td className="py-2.5 px-4 text-muted-foreground tabular-nums">{r.dueDate || "-"}</td>
                                  <td className="py-2.5 px-4 text-right">
                                    {r.links?.project && (
                                      <Link href={r.links.project}>
                                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-emerald-600">
                                          <ArrowRight className="w-4 h-4" />
                                        </Button>
                                      </Link>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}

              {totalActionItems === 0 && (
                <div className="text-center py-8">
                  <div className="w-12 h-12 rounded-md bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                    <Activity className="w-6 h-6 text-emerald-500" />
                  </div>
                  <p className="text-sm text-muted-foreground">No action items to review</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "Finance" && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ExecutionChartCard
            dataset={financeDataset}
            title="2026 Forecast"
            description="Monthly forecast built from imported finance pivots, with tracker fallback when monthly pivots are unavailable."
            chartType="line"
            metricKeys={["plannedRevenue", "plannedCos", "grossProfit"]}
            testId="finance-forecast-chart"
          />
          <ExecutionChartCard
            dataset={cashflowDataset}
            title="Cashflow Current & Forecast"
            description="Weekly actual vs planned cashflow from imported cashflow series and finance-line fallback."
            chartType="line"
            metricKeys={["actualCashflow", "plannedCashflow"]}
            testId="finance-cashflow-chart"
          />
        </div>
      )}

      {activeTab === "Construction" && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ExecutionChartCard
            dataset={timelineDataset}
            title="Portfolio Timeline"
            description="Month-by-month milestone pipeline for PD handover, site establishment, commissioning, O&M handover, and client handover."
            chartType="bar"
            metricKeys={["pdHandovers", "siteEstablishment", "commissioning", "omHandover", "clientHandover"]}
            stacked
            testId="construction-timeline-chart"
          />
          <ExecutionChartCard
            dataset={constructionWindowDataset}
            title="Construction Window"
            description="Next 10 days, overdue, and completed milestone counts from imported project dates."
            chartType="bar"
            metricKeys={["next10Days", "overdue", "completed"]}
            testId="construction-window-chart"
          />
          <ExecutionChartCard
            dataset={phaseDataset}
            title="Count of Project Name by Phase"
            description="Execution phase mix for the currently visible project population."
            chartType="bar"
            metricKeys={["projectCount", "averageProgress"]}
            testId="construction-phase-chart"
          />
          <ExecutionChartCard
            dataset={pmDataset}
            title="PM Delivery Breakdown"
            description="Operational PM view of on-schedule rate and slipping projects."
            chartType="bar"
            metricKeys={["onScheduleRate", "behindPlanCount"]}
            testId="construction-pm-chart"
          />
        </div>
      )}

      <Card className="border-border">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5 text-blue-500" />
            <h2 className="text-base font-semibold">Project Portfolio</h2>
            <Badge variant="outline" className="text-xs ml-1">
              {(data?.projects || []).length} projects
            </Badge>
          </div>
          {isLoading ? (
            <div className="text-center py-10 text-sm text-muted-foreground">Loading projects...</div>
          ) : (
            <div className="rounded-lg border border-border">
              <table className="w-full text-sm" data-testid="execution-dashboard-table">
                <thead>
                  <tr className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left py-2.5 px-3 font-medium">Project</th>
                    <th className="text-left py-2.5 px-2 font-medium hidden lg:table-cell">PM</th>
                    <th className="text-center py-2.5 px-2 font-medium">RAG</th>
                    <th className="text-right py-2.5 px-2 font-medium">Progress</th>
                    <th className="text-right py-2.5 px-2 font-medium hidden md:table-cell">Variance</th>
                    <th className="text-right py-2.5 px-2 font-medium hidden lg:table-cell">Open Inflow</th>
                    <th className="text-right py-2.5 px-2 font-medium hidden lg:table-cell">Open Exp.</th>
                    <th className="text-right py-2.5 px-2 font-medium hidden md:table-cell">GP %</th>
                    <th className="text-center py-2.5 px-2 font-medium">Issues</th>
                    <th className="w-8 py-2.5 px-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.projects || []).map((p: any) => {
                    const isExpanded = expanded === p.projectId;
                    const variance = Number(p.scheduleVariancePct || 0);
                    return (
                      <Fragment key={p.projectId}>
                        <tr
                          className={`border-t border-border/40 cursor-pointer transition-colors ${isExpanded ? "bg-emerald-50/40" : "hover:bg-muted/30"}`}
                          onClick={() => setExpanded(isExpanded ? null : p.projectId)}
                          data-testid={`project-row-${p.projectId}`}
                        >
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-foreground truncate max-w-[200px]">{p.projectName}</div>
                            <div className="text-[11px] text-muted-foreground lg:hidden">{p.pm || "-"}</div>
                          </td>
                          <td className="py-2.5 px-2 text-muted-foreground text-xs hidden lg:table-cell">{p.pm || "-"}</td>
                          <td className="py-2.5 px-2 text-center">
                            <Badge className={`text-[10px] ${ragBadge(p.rag || "Unknown")}`}>{p.rag || "-"}</Badge>
                          </td>
                          <td className="py-2.5 px-2 text-right">
                            <span className="tabular-nums font-medium text-sm">{pct(p.actualProgressPct)}</span>
                            <div className="text-[10px] text-muted-foreground tabular-nums">of {pct(p.expectedProgressPct)}</div>
                          </td>
                          <td className={`py-2.5 px-2 text-right tabular-nums text-sm font-medium hidden md:table-cell ${variance < 0 ? "text-red-700" : variance > 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
                            {pct(p.scheduleVariancePct)}
                          </td>
                          <td className="py-2.5 px-2 text-right tabular-nums text-sm text-amber-600 hidden lg:table-cell">{money(p.openInflowFy)}</td>
                          <td className="py-2.5 px-2 text-right tabular-nums text-sm text-amber-600 hidden lg:table-cell">{money(p.openExpenditureFy)}</td>
                          <td className="py-2.5 px-2 text-right tabular-nums text-sm font-medium hidden md:table-cell">{pct((p.grossMarginPctFy || 0) * 100)}</td>
                          <td className="py-2.5 px-2 text-center">
                            {p.criticalActionCount > 0 ? (
                              <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px]">{p.criticalActionCount}</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">0</span>
                            )}
                          </td>
                          <td className="py-2.5 px-1 text-center">
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-muted/20 border-t border-border/40">
                            <td colSpan={10} className="p-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                                <div className="bg-white rounded-lg border p-3">
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Project Details</p>
                                  <div className="space-y-1.5 text-sm">
                                    <p><span className="text-muted-foreground">Portfolio:</span> <span className="font-medium">{p.portfolio || "-"}</span></p>
                                    <p><span className="text-muted-foreground">PM:</span> {p.pm || "-"}</p>
                                    <p><span className="text-muted-foreground">PD:</span> {p.pd || "-"}</p>
                                    <p><span className="text-muted-foreground">Phase:</span> {p.executionPhase || "-"}</p>
                                  </div>
                                </div>
                                <div className="bg-white rounded-lg border p-3">
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Progress</p>
                                  <div className="space-y-1.5 text-sm">
                                    <p><span className="text-muted-foreground">Actual:</span> <span className="font-medium">{pct(p.actualProgressPct)}</span></p>
                                    <p><span className="text-muted-foreground">Expected:</span> {pct(p.expectedProgressPct)}</p>
                                    <p><span className="text-muted-foreground">Variance:</span> <span className={variance < 0 ? "text-red-700 font-medium" : "text-emerald-600 font-medium"}>{pct(p.scheduleVariancePct)}</span></p>
                                  </div>
                                </div>
                                <div className="bg-white rounded-lg border p-3">
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Financials</p>
                                  <div className="space-y-1.5 text-sm">
                                    <p><span className="text-muted-foreground">Revenue:</span> {money(p.plannedRevenueFy)}</p>
                                    <p><span className="text-muted-foreground">Inflow:</span> <span className="text-emerald-600">{money(p.receivedInflowFy)}</span></p>
                                    <p><span className="text-muted-foreground">Open Inflow:</span> <span className="text-amber-600">{money(p.openInflowFy)}</span></p>
                                    <p><span className="text-muted-foreground">Expenditure:</span> {money(p.plannedExpenditureFy)}</p>
                                    <p><span className="text-muted-foreground">Paid:</span> <span className="text-emerald-600">{money(p.paidExpenditureFy)}</span></p>
                                    <p><span className="text-muted-foreground">Open Exp:</span> <span className="text-amber-600">{money(p.openExpenditureFy)}</span></p>
                                    <p><span className="text-muted-foreground">GP Margin:</span> <span className="font-medium">{pct((p.grossMarginPctFy || 0) * 100)}</span></p>
                                  </div>
                                </div>
                                <div className="bg-white rounded-lg border p-3">
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Issues & Status</p>
                                  <div className="space-y-1.5 text-sm">
                                    <p><span className="text-muted-foreground">Critical actions:</span> <span className="font-medium">{p.criticalActionCount}</span></p>
                                    <p><span className="text-muted-foreground">Engineering:</span> {p.engineeringStatus}</p>
                                    <p><span className="text-muted-foreground">Quality:</span> {p.qualityStatus}</p>
                                    <p><span className="text-muted-foreground">Import:</span> {p.importFreshness}</p>
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-2 mt-3 flex-wrap">
                                <Link href={`/project/${encodeURIComponent(p.projectName)}`}>
                                  <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    Open Project
                                  </Button>
                                </Link>
                                <Link href={`/project/${encodeURIComponent(p.projectName)}?tab=plan`}><Button size="sm" variant="outline">Plan</Button></Link>
                                <Link href={`/project/${encodeURIComponent(p.projectName)}?tab=revenue-tracking`}><Button size="sm" variant="outline">Revenue</Button></Link>
                                <Link href={`/project/${encodeURIComponent(p.projectName)}?tab=expenditure`}><Button size="sm" variant="outline">Expenditure</Button></Link>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {(data?.projects || []).length === 0 && (
                <div className="text-center py-12">
                  <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center mx-auto mb-3">
                    <FolderOpen className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">No projects match current filters</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
