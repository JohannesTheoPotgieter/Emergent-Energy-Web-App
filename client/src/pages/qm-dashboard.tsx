import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Shield, ShieldCheck, AlertTriangle, Search, ChevronRight, ClipboardCheck, BarChart3 } from "lucide-react";

async function qFetch(url: string) {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers, credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

interface ChecklistPhase {
  phaseId: number;
  phaseName: string;
  total: number;
  completed: number;
}

interface Checklist {
  id: number;
  projectName: string;
  templateId: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
  phases?: ChecklistPhase[];
  warningCount?: number;
}

interface Warning {
  id: number;
  projectName: string;
  severity: string;
  warningType: string;
  title: string;
  description: string;
  status: string;
  createdAt: string;
}

export default function QmDashboardPage() {
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");

  const { data: checklists = [], isLoading: checklistsLoading } = useQuery<Checklist[]>({
    queryKey: ["quality-checklists"],
    queryFn: () => qFetch("/api/quality/checklists"),
  });

  const { data: warnings = [], isLoading: warningsLoading } = useQuery<Warning[]>({
    queryKey: ["quality-warnings-all"],
    queryFn: () => qFetch("/api/quality/warnings?status=open"),
  });

  const filtered = checklists.filter(c =>
    c.projectName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalProjects = checklists.length;
  const completedChecklists = checklists.filter(c => c.status === "completed").length;
  const activeWarnings = warnings.length;
  const avgCompletion = checklists.length > 0
    ? Math.round(
        checklists.reduce((sum, c) => {
          if (!c.phases || c.phases.length === 0) return sum;
          const total = c.phases.reduce((t, p) => t + p.total, 0);
          const completed = c.phases.reduce((t, p) => t + p.completed, 0);
          return sum + (total > 0 ? (completed / total) * 100 : 0);
        }, 0) / checklists.length
      )
    : 0;

  if (checklistsLoading) {
    return (
      <div data-testid="qm-dashboard" className="space-y-6">
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-primary" />
          <h2 className="text-3xl font-heading font-bold text-foreground">Quality Management</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-16 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="qm-dashboard" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-primary" />
          <div>
            <h2 className="text-2xl sm:text-3xl font-heading font-bold text-foreground">Quality Management</h2>
            <p className="text-sm text-muted-foreground">Overview of all project quality checklists</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm text-muted-foreground">Total Projects</p>
                <p className="text-2xl sm:text-3xl font-bold" data-testid="qm-stats-total">{totalProjects}</p>
              </div>
              <ClipboardCheck className="h-8 w-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm text-muted-foreground">Completed</p>
                <p className="text-2xl sm:text-3xl font-bold text-emerald-500">{completedChecklists}</p>
              </div>
              <ShieldCheck className="h-8 w-8 text-emerald-500/30" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm text-muted-foreground">Active Warnings</p>
                <p className="text-2xl sm:text-3xl font-bold text-amber-500" data-testid="qm-stats-warnings">{activeWarnings}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-amber-500/30" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm text-muted-foreground">Avg Completion</p>
                <p className="text-2xl sm:text-3xl font-bold">{avgCompletion}%</p>
              </div>
              <BarChart3 className="h-8 w-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-lg">Project Checklists</CardTitle>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                data-testid="qm-search-input"
                placeholder="Search projects..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {searchTerm ? "No projects match your search" : "No checklists found"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Project Name</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden md:table-cell">Phase Progress</th>
                    <th className="text-center py-3 px-4 font-medium text-muted-foreground">Warnings</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden sm:table-cell">Last Updated</th>
                    <th className="py-3 px-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((checklist) => {
                    const projectWarnings = warnings.filter(w => w.projectName === checklist.projectName);
                    return (
                      <tr
                        key={checklist.id}
                        data-testid={`qm-project-row-${checklist.id}`}
                        className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => setLocation(`/project/${encodeURIComponent(checklist.projectName)}?tab=quality`)}
                      >
                        <td className="py-3 px-4 font-medium">{checklist.projectName}</td>
                        <td className="py-3 px-4">
                          <Badge
                            variant={
                              checklist.status === "completed" ? "default" :
                              checklist.status === "active" ? "secondary" : "outline"
                            }
                            className={
                              checklist.status === "completed" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" :
                              checklist.status === "active" ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : ""
                            }
                          >
                            {checklist.status}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 hidden md:table-cell">
                          {checklist.phases && checklist.phases.length > 0 ? (
                            <div className="flex items-center gap-2 max-w-xs">
                              {checklist.phases.map((phase) => (
                                <div key={phase.phaseId} className="flex-1 min-w-0" title={`${phase.phaseName}: ${phase.completed}/${phase.total}`}>
                                  <div className="text-[10px] text-muted-foreground truncate mb-0.5">{phase.phaseName}</div>
                                  <Progress
                                    value={phase.total > 0 ? (phase.completed / phase.total) * 100 : 0}
                                    className="h-1.5"
                                  />
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {(checklist.warningCount ?? projectWarnings.length) > 0 ? (
                            <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              {checklist.warningCount ?? projectWarnings.length}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                              <ShieldCheck className="h-3 w-3 mr-1" />0
                            </Badge>
                          )}
                        </td>
                        <td className="py-3 px-4 text-muted-foreground text-xs hidden sm:table-cell">
                          {checklist.updatedAt
                            ? new Date(checklist.updatedAt).toLocaleDateString()
                            : checklist.createdAt
                              ? new Date(checklist.createdAt).toLocaleDateString()
                              : "—"}
                        </td>
                        <td className="py-3 px-4">
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {!warningsLoading && warnings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Active Warnings ({warnings.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {warnings.slice(0, 20).map((warning) => (
                <div
                  key={warning.id}
                  className="flex items-start gap-3 p-3 rounded-lg border border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => setLocation(`/project/${encodeURIComponent(warning.projectName)}?tab=quality`)}
                >
                  <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${
                    warning.severity === "High" ? "text-red-500" : "text-amber-500"
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{warning.title}</span>
                      <Badge variant="outline" className={
                        warning.severity === "High"
                          ? "bg-red-500/10 text-red-400 border-red-500/30 text-xs"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/30 text-xs"
                      }>
                        {warning.severity}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{warning.projectName}</p>
                    {warning.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{warning.description}</p>
                    )}
                  </div>
                </div>
              ))}
              {warnings.length > 20 && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                  Showing 20 of {warnings.length} warnings
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
