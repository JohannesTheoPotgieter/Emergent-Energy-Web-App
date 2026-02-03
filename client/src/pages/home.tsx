import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { 
  Building2, 
  TrendingUp, 
  TrendingDown,
  AlertTriangle,
  DollarSign,
  Clock,
  CheckCircle2,
  PauseCircle,
  XCircle,
  Edit3,
  Save,
  RefreshCw,
  Calendar,
  AlertCircle,
  BarChart3,
  Zap
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { formatRand, formatPercent, safeNumber, formatNumber } from "@/lib/safeMoney";
import { apiRequest } from "@/lib/queryClient";

interface HomeSummary {
  lastRefresh: string | null;
  fyRange: { start: string; end: string; label?: string };
  portfolio: {
    activeProjects: number;
    activeCapacityMW: number;
    onScheduleRate: number;
    projectsBehindPlan: number;
    contractPackComplete: number | null;
    onHold: number;
    closed: number;
    phaseDistribution: Array<{ phase: string; count: number; kw: number }>;
  };
  upcomingEvents?: {
    constructionStart: number;
    commissioning: number;
    omHandover: number;
    clientHandover: number;
  };
  execution: {
    constructionProjects: number;
    executionCapacityKw: number;
    avgPercentComplete: number;
    avgDeltaVsExpected: number;
    behindSchedule: number;
    commissioningDue30: number;
    omHandoverDue30: number;
    clientHandoverDue30: number;
  };
  top5BehindPlan?: Array<{
    projectName: string;
    delta: number;
    avgActual: number;
    avgExpected: number;
  }>;
  financial: {
    actualRevenue: number;
    actualExpenses: number;
    grossProfit: number;
    grossProfitPercent: number;
    revenueOutstanding: number;
    expensesOutstanding: number;
    currentVoTotal: number;
    thisWeek: {
      inflows: number;
      outflows: number;
      net: number;
    };
    thisMonth: {
      revenueOutstanding: number;
      cosOutstanding: number;
    };
  };
  dataQuality: {
    missingPhase: number;
    missingKwp: number;
    missingCommissioning: number;
    projectCount: number;
    expenseCount: number;
    inflowCount: number;
    planCount: number;
    lastUpload: string | null;
  };
}

interface HomeNotes {
  id?: number;
  highlightsNotes: string | null;
  constructionNotes: string | null;
  financeNotes: string | null;
  preparedBy?: string | null;
  updatedAt?: string;
}

function StatCard({ 
  title, 
  value, 
  subtitle,
  icon: Icon,
  trend,
  variant = "default"
}: { 
  title: string; 
  value: string | number; 
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  trend?: { value: number; label: string };
  variant?: "default" | "success" | "warning" | "danger" | "muted";
}) {
  const bgColors = {
    default: "bg-card",
    success: "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800",
    warning: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800",
    danger: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800",
    muted: "bg-muted/50"
  };

  const iconColors = {
    default: "text-primary",
    success: "text-green-600 dark:text-green-400",
    warning: "text-amber-600 dark:text-amber-400",
    danger: "text-red-600 dark:text-red-400",
    muted: "text-muted-foreground"
  };

  return (
    <Card className={`${bgColors[variant]} transition-colors`} data-testid={`stat-card-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-sm text-muted-foreground font-medium">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
            {trend && (
              <div className={`flex items-center gap-1 mt-2 text-xs ${trend.value >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {trend.value >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                <span>{formatPercent(trend.value, { showSign: true })}</span>
                <span className="text-muted-foreground">{trend.label}</span>
              </div>
            )}
          </div>
          {Icon && (
            <div className={`p-2 rounded-lg bg-background/50 ${iconColors[variant]}`}>
              <Icon className="h-5 w-5" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function EditableNote({
  label,
  value,
  onChange,
  onSave,
  saving
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="space-y-2" data-testid={`note-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <Button 
          variant="ghost" 
          size="sm"
          onClick={() => {
            if (editing) {
              onSave();
            }
            setEditing(!editing);
          }}
          disabled={saving}
          data-testid={`edit-note-${label.toLowerCase().replace(/\s+/g, '-')}`}
        >
          {saving ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : editing ? (
            <>
              <Save className="h-3 w-3 mr-1" />
              Save
            </>
          ) : (
            <>
              <Edit3 className="h-3 w-3 mr-1" />
              Edit
            </>
          )}
        </Button>
      </div>
      {editing ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Add ${label.toLowerCase()}...`}
          className="min-h-[80px] text-sm"
        />
      ) : (
        <p className="text-sm text-foreground/80 whitespace-pre-wrap min-h-[40px]">
          {value || <span className="text-muted-foreground italic">No notes added</span>}
        </p>
      )}
    </div>
  );
}

export default function Home() {
  const queryClient = useQueryClient();
  
  const { data: summary, isLoading: summaryLoading } = useQuery<HomeSummary>({
    queryKey: ["/api/home/summary"],
    queryFn: async () => {
      const res = await fetch("/api/home/summary");
      if (!res.ok) throw new Error("Failed to fetch summary");
      return res.json();
    }
  });

  const { data: notes } = useQuery<HomeNotes>({
    queryKey: ["/api/home/notes"],
    queryFn: async () => {
      const res = await fetch("/api/home/notes");
      if (!res.ok) return { id: 0, highlightsNote: "", constructionNote: "", financeNote: "", updatedAt: "" };
      return res.json();
    }
  });

  const [localNotes, setLocalNotes] = useState<{
    highlightsNotes: string;
    constructionNotes: string;
    financeNotes: string;
  }>({
    highlightsNotes: "",
    constructionNotes: "",
    financeNotes: ""
  });

  const notesMutation = useMutation({
    mutationFn: async (data: { highlightsNotes?: string; constructionNotes?: string; financeNotes?: string }) => {
      const res = await apiRequest("POST", "/api/home/notes", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/home/notes"] });
    }
  });

  if (notes && !localNotes.highlightsNotes && !localNotes.constructionNotes && !localNotes.financeNotes) {
    setLocalNotes({
      highlightsNotes: notes.highlightsNotes || "",
      constructionNotes: notes.constructionNotes || "",
      financeNotes: notes.financeNotes || ""
    });
  }

  if (summaryLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const portfolio = summary?.portfolio;
  const execution = summary?.execution;
  const financial = summary?.financial;
  const dataQuality = summary?.dataQuality;
  const top5Behind = summary?.top5BehindPlan || [];

  const netCashflowThisWeek = safeNumber(financial?.thisWeek?.net);

  return (
    <div className="container mx-auto py-6 space-y-6" data-testid="home-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Projects Report</h1>
          <p className="text-muted-foreground">
            {summary?.fyRange?.label || 'FY26'} Overview • Updated {
              summary?.lastRefresh 
                ? formatDistanceToNow(new Date(summary.lastRefresh), { addSuffix: true })
                : 'never'
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="px-3 py-1">
            <Calendar className="h-3 w-3 mr-1" />
            {summary?.fyRange?.start && summary?.fyRange?.end 
              ? `${format(new Date(summary.fyRange.start), 'dd MMM yyyy')} - ${format(new Date(summary.fyRange.end), 'dd MMM yyyy')}`
              : 'FY26'
            }
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Portfolio Summary
            </CardTitle>
            <CardDescription>Active projects and capacity overview</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                title="Active Projects"
                value={portfolio?.activeProjects || 0}
                subtitle={`${portfolio?.onHold || 0} on hold, ${portfolio?.closed || 0} closed`}
                icon={Building2}
              />
              <StatCard
                title="Active Capacity"
                value={`${formatNumber(portfolio?.activeCapacityMW || 0, 1)} MW`}
                subtitle="Total installed capacity"
                icon={Zap}
              />
              <StatCard
                title="On Schedule"
                value={formatPercent(portfolio?.onScheduleRate || 0)}
                variant={safeNumber(portfolio?.onScheduleRate) >= 80 ? "success" : safeNumber(portfolio?.onScheduleRate) >= 50 ? "warning" : "danger"}
                icon={CheckCircle2}
              />
              <StatCard
                title="Behind Plan"
                value={portfolio?.projectsBehindPlan || 0}
                variant={safeNumber(portfolio?.projectsBehindPlan) > 0 ? "warning" : "success"}
                icon={AlertTriangle}
              />
            </div>
            
            {portfolio?.phaseDistribution && portfolio.phaseDistribution.length > 0 && (
              <>
                <Separator className="my-4" />
                <div>
                  <p className="text-sm font-medium mb-3">Phase Distribution</p>
                  <div className="flex flex-wrap gap-2">
                    {portfolio.phaseDistribution.map((item) => (
                      <Badge key={item.phase} variant="secondary" className="px-3 py-1">
                        {item.phase}: {item.count} ({formatNumber(safeNumber(item.kw) / 1000, 1)} MW)
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Edit3 className="h-5 w-5" />
              Key Highlights
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EditableNote
              label="Weekly Highlights"
              value={localNotes.highlightsNotes}
              onChange={(val) => setLocalNotes(prev => ({ ...prev, highlightsNotes: val }))}
              onSave={() => notesMutation.mutate({ highlightsNotes: localNotes.highlightsNotes })}
              saving={notesMutation.isPending}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Execution Summary
            </CardTitle>
            <CardDescription>Construction progress and milestones</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <StatCard
                title="In Construction"
                value={execution?.constructionProjects || 0}
                subtitle={`${formatNumber(safeNumber(execution?.executionCapacityKw) / 1000, 1)} MW capacity`}
                icon={Clock}
              />
              <StatCard
                title="Avg % Complete"
                value={formatPercent(execution?.avgPercentComplete || 0)}
                subtitle={`Delta: ${formatPercent(execution?.avgDeltaVsExpected || 0, { showSign: true })} vs expected`}
                trend={execution?.avgDeltaVsExpected ? { value: execution.avgDeltaVsExpected, label: "vs expected" } : undefined}
              />
            </div>
            
            <Separator />
            
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                <span className="text-sm">Behind Schedule</span>
                <Badge variant={safeNumber(execution?.behindSchedule) > 0 ? "destructive" : "secondary"}>
                  {execution?.behindSchedule || 0} projects
                </Badge>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                <span className="text-sm">Commissioning Due (30d)</span>
                <Badge variant="outline">{execution?.commissioningDue30 || 0}</Badge>
              </div>
            </div>

            {top5Behind.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-sm font-medium mb-2">Top 5 Behind Plan</p>
                  <div className="space-y-2">
                    {top5Behind.slice(0, 5).map((p, i) => (
                      <div key={i} className="flex items-center justify-between text-sm p-2 rounded bg-muted/50">
                        <span className="font-medium truncate">{p.projectName.replace('_Tracker', '')}</span>
                        <Badge variant="destructive">
                          {formatPercent(p.delta, { showSign: true })}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            <Separator />
            
            <EditableNote
              label="Construction Notes"
              value={localNotes.constructionNotes}
              onChange={(val) => setLocalNotes(prev => ({ ...prev, constructionNotes: val }))}
              onSave={() => notesMutation.mutate({ constructionNotes: localNotes.constructionNotes })}
              saving={notesMutation.isPending}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Financial Summary
            </CardTitle>
            <CardDescription>Revenue, expenses, and cashflow ({summary?.fyRange?.label || 'FY26'})</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="p-3 rounded-lg border bg-green-50/50 dark:bg-green-950/20">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Revenue (Actual)</span>
                    <TrendingUp className="h-4 w-4 text-green-600" />
                  </div>
                  <p className="text-xl font-bold text-green-700 dark:text-green-400">
                    {formatRand(financial?.actualRevenue, { compact: true })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Outstanding: {formatRand(financial?.revenueOutstanding, { compact: true })}
                  </p>
                </div>
                <div className="p-3 rounded-lg border bg-red-50/50 dark:bg-red-950/20">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Expenses (Actual)</span>
                    <TrendingDown className="h-4 w-4 text-red-600" />
                  </div>
                  <p className="text-xl font-bold text-red-700 dark:text-red-400">
                    {formatRand(financial?.actualExpenses, { compact: true })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Outstanding: {formatRand(financial?.expensesOutstanding, { compact: true })}
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-lg border">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Gross Profit</span>
                  {safeNumber(financial?.grossProfit) >= 0 ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-amber-600" />
                  )}
                </div>
                <p className={`text-xl font-bold ${safeNumber(financial?.grossProfit) >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                  {formatRand(financial?.grossProfit, { compact: true, showSign: true })}
                </p>
                <p className="text-xs text-muted-foreground">
                  Margin: {formatPercent(financial?.grossProfitPercent || 0)}
                </p>
              </div>

              <Separator />

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                  <span className="text-sm">This Week Net</span>
                  <span className={`font-medium ${netCashflowThisWeek >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatRand(financial?.thisWeek?.net, { compact: true, showSign: true })}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                  <span className="text-sm">This Week Outflows</span>
                  <span className="font-medium">{formatRand(financial?.thisWeek?.outflows, { compact: true })}</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                  <span className="text-sm">COS Outstanding</span>
                  <span className="font-medium">{formatRand(financial?.thisMonth?.cosOutstanding, { compact: true })}</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                  <span className="text-sm">Current VO Total</span>
                  <span className="font-medium">{formatRand(financial?.currentVoTotal, { compact: true })}</span>
                </div>
              </div>
            </div>

            <Separator />
            
            <EditableNote
              label="Finance Notes"
              value={localNotes.financeNotes}
              onChange={(val) => setLocalNotes(prev => ({ ...prev, financeNotes: val }))}
              onSave={() => notesMutation.mutate({ financeNotes: localNotes.financeNotes })}
              saving={notesMutation.isPending}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Data Quality
          </CardTitle>
          <CardDescription>
            Tracker data completeness and upload status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div>
                <p className="text-sm text-muted-foreground">Projects</p>
                <p className="text-2xl font-bold">{dataQuality?.projectCount || 0}</p>
              </div>
              <Building2 className="h-8 w-8 text-muted-foreground/30" />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div>
                <p className="text-sm text-muted-foreground">Expense Lines</p>
                <p className="text-2xl font-bold">{formatNumber(dataQuality?.expenseCount || 0)}</p>
              </div>
              <DollarSign className="h-8 w-8 text-muted-foreground/30" />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div>
                <p className="text-sm text-muted-foreground">Inflow Lines</p>
                <p className="text-2xl font-bold">{formatNumber(dataQuality?.inflowCount || 0)}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-muted-foreground/30" />
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div>
                <p className="text-sm text-muted-foreground">Plan Tasks</p>
                <p className="text-2xl font-bold">{formatNumber(dataQuality?.planCount || 0)}</p>
              </div>
              <Clock className="h-8 w-8 text-muted-foreground/30" />
            </div>
          </div>

          {(safeNumber(dataQuality?.missingPhase) > 0 || 
            safeNumber(dataQuality?.missingKwp) > 0 || 
            safeNumber(dataQuality?.missingCommissioning) > 0) && (
            <div className="mt-4 p-3 rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Data Quality Warnings</p>
                  <ul className="text-sm text-amber-700 dark:text-amber-300 mt-1 space-y-1">
                    {safeNumber(dataQuality?.missingPhase) > 0 && (
                      <li>{dataQuality?.missingPhase} projects missing phase information</li>
                    )}
                    {safeNumber(dataQuality?.missingKwp) > 0 && (
                      <li>{dataQuality?.missingKwp} projects missing capacity (kWp)</li>
                    )}
                    {safeNumber(dataQuality?.missingCommissioning) > 0 && (
                      <li>{dataQuality?.missingCommissioning} projects missing commissioning date</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Last upload: {dataQuality?.lastUpload 
                ? format(new Date(dataQuality.lastUpload), 'dd MMM yyyy HH:mm')
                : 'Never'
              }
            </span>
            <Button variant="outline" size="sm" asChild>
              <a href="/upload" data-testid="link-upload">
                <RefreshCw className="h-3 w-3 mr-1" />
                Upload Trackers
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
