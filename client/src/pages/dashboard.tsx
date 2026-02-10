import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Construction, Zap, Wrench, UserCheck, DollarSign, AlertCircle, TrendingDown, TrendingUp, ArrowRight } from "lucide-react";
import { useLocation } from "wouter";

function formatRand(val: number): string {
  if (val >= 1_000_000) return `R ${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `R ${(val / 1_000).toFixed(1)}K`;
  return `R ${Math.round(val)}`;
}

function formatPct(val: number | null): string {
  if (val === null || val === undefined) return "—";
  return `${(val * 100).toFixed(1)}%`;
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const { data: dashboardData, isLoading: dashLoading } = useQuery<{
    kpis: {
      siteEstablishmentNext10: number;
      commissioningNext10: number;
      omHandoverNext10: number;
      clientHandoverNext10: number;
      revenueOutstanding: number;
      expenseOverdue: number;
      inflowsThisWeek: number;
      outflowsThisWeek: number;
    };
    pmTable: Array<{ pm: string; activeProjects: number; commissioningThisMonth: number; clientHandoverThisMonth: number }>;
  }>({
    queryKey: ["/api/program-dashboard"],
  });

  const { data: projectsSummary = [], isLoading: projLoading } = useQuery<any[]>({
    queryKey: ["/api/projects-summary"],
  });

  const { data: homeNotes } = useQuery<{
    weeklyHighlights: string;
    constructionNotes: string;
    financeNotes: string;
  }>({
    queryKey: ["/api/home/notes"],
  });

  const [weeklyHighlights, setWeeklyHighlights] = useState("");
  const [constructionNotes, setConstructionNotes] = useState("");
  const [financeNotes, setFinanceNotes] = useState("");

  useEffect(() => {
    if (homeNotes) {
      setWeeklyHighlights(homeNotes.weeklyHighlights || "");
      setConstructionNotes(homeNotes.constructionNotes || "");
      setFinanceNotes(homeNotes.financeNotes || "");
    }
  }, [homeNotes]);

  const saveNotesMutation = useMutation({
    mutationFn: async (notes: { weeklyHighlights: string; constructionNotes: string; financeNotes: string }) => {
      await apiRequest("POST", "/api/home/notes", notes);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/home/notes"] });
    },
  });

  const kpis = dashboardData?.kpis;
  const pmTable = dashboardData?.pmTable || [];

  const top10Projects = useMemo(() => {
    if (!projectsSummary.length) return [];
    return [...projectsSummary]
      .sort((a, b) => (a.delta_vs_expected ?? 0) - (b.delta_vs_expected ?? 0))
      .slice(0, 10);
  }, [projectsSummary]);

  const pmTotals = useMemo(() => {
    return pmTable.reduce(
      (acc, row) => ({
        activeProjects: acc.activeProjects + row.activeProjects,
        commissioningThisMonth: acc.commissioningThisMonth + row.commissioningThisMonth,
        clientHandoverThisMonth: acc.clientHandoverThisMonth + row.clientHandoverThisMonth,
      }),
      { activeProjects: 0, commissioningThisMonth: 0, clientHandoverThisMonth: 0 }
    );
  }, [pmTable]);

  if (dashLoading && !dashboardData) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-heading font-bold text-foreground" data-testid="text-page-title">Program Dashboard</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-32 bg-muted/20 animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-heading font-bold text-foreground" data-testid="text-page-title">Program Dashboard</h2>

      {/* Row 1: Milestone KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800" data-testid="card-site-establishment">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-lg bg-amber-100 dark:bg-amber-900/40">
                <Construction className="w-6 h-6 text-amber-700 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-3xl font-bold text-amber-800 dark:text-amber-300" data-testid="value-site-establishment">
                  {kpis?.siteEstablishmentNext10 ?? 0}
                </p>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Site Establishment</p>
                <p className="text-xs text-amber-600 dark:text-amber-500">Next 10 Business Days</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800" data-testid="card-commissioning">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-lg bg-blue-100 dark:bg-blue-900/40">
                <Zap className="w-6 h-6 text-blue-700 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-3xl font-bold text-blue-800 dark:text-blue-300" data-testid="value-commissioning">
                  {kpis?.commissioningNext10 ?? 0}
                </p>
                <p className="text-sm font-medium text-blue-700 dark:text-blue-400">Commissioning</p>
                <p className="text-xs text-blue-600 dark:text-blue-500">Next 10 Business Days</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800" data-testid="card-om-handover">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-lg bg-green-100 dark:bg-green-900/40">
                <Wrench className="w-6 h-6 text-green-700 dark:text-green-400" />
              </div>
              <div>
                <p className="text-3xl font-bold text-green-800 dark:text-green-300" data-testid="value-om-handover">
                  {kpis?.omHandoverNext10 ?? 0}
                </p>
                <p className="text-sm font-medium text-green-700 dark:text-green-400">O&M Handover</p>
                <p className="text-xs text-green-600 dark:text-green-500">Next 10 Business Days</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800" data-testid="card-client-handover">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-lg bg-purple-100 dark:bg-purple-900/40">
                <UserCheck className="w-6 h-6 text-purple-700 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-3xl font-bold text-purple-800 dark:text-purple-300" data-testid="value-client-handover">
                  {kpis?.clientHandoverNext10 ?? 0}
                </p>
                <p className="text-sm font-medium text-purple-700 dark:text-purple-400">Client Handover</p>
                <p className="text-xs text-purple-600 dark:text-purple-500">Next 10 Business Days</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Financial KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800" data-testid="card-revenue-outstanding">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-lg bg-amber-100 dark:bg-amber-900/40">
                <DollarSign className="w-6 h-6 text-amber-700 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-800 dark:text-amber-300" data-testid="value-revenue-outstanding">
                  {formatRand(kpis?.revenueOutstanding ?? 0)}
                </p>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Revenue Outstanding</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800" data-testid="card-expenses-overdue">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-lg bg-red-100 dark:bg-red-900/40">
                <AlertCircle className="w-6 h-6 text-red-700 dark:text-red-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-red-800 dark:text-red-300" data-testid="value-expenses-overdue">
                  {formatRand(kpis?.expenseOverdue ?? 0)}
                </p>
                <p className="text-sm font-medium text-red-700 dark:text-red-400">Expenses Overdue</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800" data-testid="card-inflows-this-week">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-lg bg-green-100 dark:bg-green-900/40">
                <TrendingUp className="w-6 h-6 text-green-700 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-green-800 dark:text-green-300" data-testid="value-inflows-this-week">
                  {formatRand(kpis?.inflowsThisWeek ?? 0)}
                </p>
                <p className="text-sm font-medium text-green-700 dark:text-green-400">Inflows This Week</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800" data-testid="card-outflows-this-week">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-lg bg-red-100 dark:bg-red-900/40">
                <TrendingDown className="w-6 h-6 text-red-700 dark:text-red-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-red-800 dark:text-red-300" data-testid="value-outflows-this-week">
                  {formatRand(kpis?.outflowsThisWeek ?? 0)}
                </p>
                <p className="text-sm font-medium text-red-700 dark:text-red-400">Outflows This Week</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 3: PM Summary Table */}
      <Card data-testid="card-pm-summary">
        <CardHeader>
          <CardTitle>Project Manager Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium">PM Name</th>
                  <th className="text-right py-2 px-3 font-medium">Active Projects</th>
                  <th className="text-right py-2 px-3 font-medium">Commissioning (This Month)</th>
                  <th className="text-right py-2 px-3 font-medium">Client Handover (This Month)</th>
                </tr>
              </thead>
              <tbody>
                {pmTable.map((row, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/30" data-testid={`row-pm-${i}`}>
                    <td className="py-2 px-3">{row.pm}</td>
                    <td className="py-2 px-3 text-right font-mono">{row.activeProjects}</td>
                    <td className="py-2 px-3 text-right font-mono">{row.commissioningThisMonth}</td>
                    <td className="py-2 px-3 text-right font-mono">{row.clientHandoverThisMonth}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-bold">
                  <td className="py-2 px-3">Total</td>
                  <td className="py-2 px-3 text-right font-mono">{pmTotals.activeProjects}</td>
                  <td className="py-2 px-3 text-right font-mono">{pmTotals.commissioningThisMonth}</td>
                  <td className="py-2 px-3 text-right font-mono">{pmTotals.clientHandoverThisMonth}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Row 4: Projects Summary Mini Table */}
      <Card data-testid="card-projects-overview">
        <CardHeader>
          <CardTitle>Active Projects Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium">Project</th>
                  <th className="text-left py-2 px-3 font-medium">Phase</th>
                  <th className="text-right py-2 px-3 font-medium">% Complete</th>
                  <th className="text-right py-2 px-3 font-medium">Delta</th>
                  <th className="text-right py-2 px-3 font-medium">Revenue</th>
                  <th className="text-right py-2 px-3 font-medium">Expenses</th>
                </tr>
              </thead>
              <tbody>
                {top10Projects.map((p: any, i: number) => (
                  <tr
                    key={p.project_name || i}
                    className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                    onClick={() => setLocation(`/project/${encodeURIComponent(p.project_name)}`)}
                    data-testid={`row-project-${i}`}
                  >
                    <td className="py-2 px-3 font-medium">{(p.project_name || "").replace("_Tracker", "")}</td>
                    <td className="py-2 px-3">{p.phase || "—"}</td>
                    <td className="py-2 px-3 text-right font-mono">{formatPct(p.project_pct_complete)}</td>
                    <td className={`py-2 px-3 text-right font-mono ${(p.delta_vs_expected ?? 0) < 0 ? "text-red-600" : "text-green-600"}`}>
                      {formatPct(p.delta_vs_expected)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono">{formatRand(p.actual_revenue ?? 0)}</td>
                    <td className="py-2 px-3 text-right font-mono">{formatRand(p.actual_expenses ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 text-center">
            <Button variant="link" onClick={() => setLocation("/projects")} data-testid="link-view-all-projects">
              View All <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Row 5: Editable Notes */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card data-testid="card-weekly-highlights">
          <CardHeader>
            <CardTitle className="text-base">Weekly Highlights</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={weeklyHighlights}
              onChange={(e) => setWeeklyHighlights(e.target.value)}
              rows={6}
              placeholder="Enter weekly highlights..."
              data-testid="textarea-weekly-highlights"
            />
            <Button
              size="sm"
              onClick={() => saveNotesMutation.mutate({ weeklyHighlights, constructionNotes, financeNotes })}
              disabled={saveNotesMutation.isPending}
              data-testid="button-save-weekly-highlights"
            >
              {saveNotesMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </CardContent>
        </Card>

        <Card data-testid="card-construction-notes">
          <CardHeader>
            <CardTitle className="text-base">Construction Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={constructionNotes}
              onChange={(e) => setConstructionNotes(e.target.value)}
              rows={6}
              placeholder="Enter construction notes..."
              data-testid="textarea-construction-notes"
            />
            <Button
              size="sm"
              onClick={() => saveNotesMutation.mutate({ weeklyHighlights, constructionNotes, financeNotes })}
              disabled={saveNotesMutation.isPending}
              data-testid="button-save-construction-notes"
            >
              {saveNotesMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </CardContent>
        </Card>

        <Card data-testid="card-finance-notes">
          <CardHeader>
            <CardTitle className="text-base">Finance Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={financeNotes}
              onChange={(e) => setFinanceNotes(e.target.value)}
              rows={6}
              placeholder="Enter finance notes..."
              data-testid="textarea-finance-notes"
            />
            <Button
              size="sm"
              onClick={() => saveNotesMutation.mutate({ weeklyHighlights, constructionNotes, financeNotes })}
              disabled={saveNotesMutation.isPending}
              data-testid="button-save-finance-notes"
            >
              {saveNotesMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
