import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Loader2, Download } from "lucide-react";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function fmtDate(v?: string | null): string {
  return v ? new Date(v).toLocaleDateString("en-ZA") : "—";
}

type SortConfig = { key: string; direction: "asc" | "desc" };

function sortRows(rows: any[], sort: SortConfig): any[] {
  const list = [...rows];
  list.sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    if (typeof av === "number" && typeof bv === "number") return sort.direction === "asc" ? av - bv : bv - av;
    return sort.direction === "asc" ? String(av ?? "").localeCompare(String(bv ?? "")) : String(bv ?? "").localeCompare(String(av ?? ""));
  });
  return list;
}

function DrillTable({ title, rows, columns }: { title: string; rows: any[]; columns: { key: string; label: string; render?: (v: any, row: any) => any }[] }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortConfig>({ key: columns[0].key, direction: "asc" });

  const filtered = useMemo(() => rows.filter((r) => JSON.stringify(r).toLowerCase().includes(search.toLowerCase())), [rows, search]);
  const sorted = useMemo(() => sortRows(filtered, sort), [filtered, sort]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">{title}</CardTitle>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter rows..." className="h-8 w-[220px]" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-[540px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0">
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className="text-left px-3 py-2 font-medium cursor-pointer"
                      onClick={() => setSort((prev) => ({ key: c.key, direction: prev.key === c.key && prev.direction === "asc" ? "desc" : "asc" }))}
                    >
                      {c.label} {sort.key === c.key ? (sort.direction === "asc" ? "↑" : "↓") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">No data</td></tr>
                ) : sorted.map((row, i) => (
                  <tr key={i} className="border-b hover:bg-muted/30">
                    {columns.map((c) => <td key={c.key} className="px-3 py-1.5">{c.render ? c.render(row[c.key], row) : String(row[c.key] ?? "—")}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EngineeringMonthlyReportProject() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/reports/engineering/monthly/:month/project/:projectId");
  const month = params?.month || "";
  const projectId = params?.projectId || "";
  const [activeTab, setActiveTab] = useState("tasks");

  const { data: report } = useQuery({
    queryKey: ["/api/reports/engineering/monthly", month],
    queryFn: async () => {
      const res = await fetch(`/api/reports/engineering/monthly?month=${month}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
    enabled: !!month,
  });

  const reportId = report?.id;

  const { data: projectData, isLoading, error } = useQuery({
    queryKey: ["/api/reports/engineering/monthly/project", reportId, projectId],
    queryFn: async () => {
      const res = await fetch(`/api/reports/engineering/monthly/${reportId}/project/${projectId}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to load project data");
      return res.json();
    },
    enabled: !!reportId && !!projectId,
  });

  const { data: taskRows } = useQuery({
    queryKey: ["eng-project-drill-tasks", reportId, projectId],
    queryFn: async () => {
      const q = new URLSearchParams({ tab: "tasks", projectId: String(projectId) });
      const res = await fetch(`/api/reports/engineering/monthly/${reportId}/drilldown?${q.toString()}`, { headers: getAuthHeaders() });
      if (!res.ok) return { rows: [] };
      return res.json();
    },
    enabled: !!reportId,
  });

  const { data: delRows } = useQuery({
    queryKey: ["eng-project-drill-deliverables", reportId, projectId],
    queryFn: async () => {
      const q = new URLSearchParams({ tab: "deliverables", projectId: String(projectId) });
      const res = await fetch(`/api/reports/engineering/monthly/${reportId}/drilldown?${q.toString()}`, { headers: getAuthHeaders() });
      if (!res.ok) return { rows: [] };
      return res.json();
    },
    enabled: !!reportId,
  });

  const { data: stageRows } = useQuery({
    queryKey: ["eng-project-drill-stages", reportId, projectId],
    queryFn: async () => {
      const q = new URLSearchParams({ tab: "stages", projectId: String(projectId) });
      const res = await fetch(`/api/reports/engineering/monthly/${reportId}/drilldown?${q.toString()}`, { headers: getAuthHeaders() });
      if (!res.ok) return { rows: [] };
      return res.json();
    },
    enabled: !!reportId,
  });

  const { data: approvalRows } = useQuery({
    queryKey: ["eng-project-drill-approvals", reportId, projectId],
    queryFn: async () => {
      const q = new URLSearchParams({ tab: "approvals", projectId: String(projectId) });
      const res = await fetch(`/api/reports/engineering/monthly/${reportId}/drilldown?${q.toString()}`, { headers: getAuthHeaders() });
      if (!res.ok) return { rows: [] };
      return res.json();
    },
    enabled: !!reportId,
  });

  const exportTab = async () => {
    if (!reportId) return;
    const q = new URLSearchParams({ tab: activeTab, projectId: String(projectId), format: "xlsx" });
    const res = await fetch(`/api/reports/engineering/monthly/${reportId}/drilldown?${q.toString()}`, { headers: getAuthHeaders() });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `engineering_project_${projectId}_${activeTab}_${month}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const summary = projectData?.tasks;
  const rowsTasks = taskRows?.rows || [];
  const rowsDeliverables = delRows?.rows || [];
  const rowsStages = stageRows?.rows || [];
  const rowsApprovals = approvalRows?.rows || [];

  const blockersAndComments = [
    ...rowsTasks.filter((r: any) => r.blockerReason).map((r: any) => ({ source: "Task blocker", item: r.taskName, owner: r.owner, detail: r.blockerReason, status: r.status })),
    ...rowsApprovals.filter((r: any) => r.comments).map((r: any) => ({ source: "Approval comment", item: r.approverRole, owner: r.approverUserId, detail: r.comments, status: r.status })),
  ];

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/reports/engineering/monthly?month=${month}`)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="text-2xl font-bold">Engineering Project Drill-down</h1>
          <span className="text-sm text-muted-foreground">{month}</span>
        </div>
        <Button variant="outline" size="sm" onClick={exportTab}><Download className="h-4 w-4 mr-2" />Export current tab</Button>
      </div>

      {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}

      {isLoading ? (
        <div className="flex items-center justify-center min-h-[30vh]"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {summary && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Project Summary — {summary.projectName}</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-sm">
                  <div><p className="text-xs text-muted-foreground">Total</p><p className="font-bold">{summary.totalTasks}</p></div>
                  <div><p className="text-xs text-muted-foreground">Completed</p><p className="font-bold text-emerald-600">{summary.completed}</p></div>
                  <div><p className="text-xs text-muted-foreground">In Progress</p><p className="font-bold text-blue-600">{summary.inProgress}</p></div>
                  <div><p className="text-xs text-muted-foreground">Overdue</p><p className="font-bold text-red-600">{summary.overdue}</p></div>
                  <div><p className="text-xs text-muted-foreground">Done %</p><p className="font-bold">{summary.completionPct?.toFixed(0)}%</p></div>
                  <div><p className="text-xs text-muted-foreground">Completed this month</p><p className="font-bold">{summary.completedThisMonth}</p></div>
                </div>
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="tasks" onValueChange={setActiveTab}>
            <TabsList className="w-full justify-start">
              <TabsTrigger value="tasks">Engineering tasks</TabsTrigger>
              <TabsTrigger value="deliverables">Deliverables</TabsTrigger>
              <TabsTrigger value="stages">Stage gates</TabsTrigger>
              <TabsTrigger value="approvals">Approvals</TabsTrigger>
              <TabsTrigger value="blockers">Blockers / comments</TabsTrigger>
            </TabsList>

            <TabsContent value="tasks" className="mt-4">
              <DrillTable
                title="Engineering task line-items"
                rows={rowsTasks}
                columns={[
                  { key: "taskName", label: "Task" },
                  { key: "owner", label: "Owner" },
                  { key: "status", label: "Status", render: (v) => <Badge variant="outline" className="text-[10px]">{v || "—"}</Badge> },
                  { key: "endDate", label: "Due date" },
                  { key: "agingDays", label: "Aging" },
                  { key: "sourceSheet", label: "Source sheet" },
                  { key: "sourceRow", label: "Source row" },
                ]}
              />
            </TabsContent>

            <TabsContent value="deliverables" className="mt-4">
              <DrillTable
                title="Deliverable register line-items"
                rows={rowsDeliverables}
                columns={[
                  { key: "title", label: "Deliverable" },
                  { key: "type", label: "Type" },
                  { key: "status", label: "Approval state", render: (v) => <Badge variant="outline" className="text-[10px]">{v}</Badge> },
                  { key: "currentVersion", label: "Version" },
                  { key: "createdAt", label: "Created" },
                  { key: "updatedAt", label: "Updated", render: (v) => fmtDate(v) },
                ]}
              />
            </TabsContent>

            <TabsContent value="stages" className="mt-4">
              <DrillTable
                title="Stage gate records"
                rows={rowsStages}
                columns={[
                  { key: "stageTemplateId", label: "Stage template" },
                  { key: "status", label: "Status", render: (v) => <Badge variant="outline" className="text-[10px]">{v}</Badge> },
                  { key: "startedAt", label: "Started", render: (v) => fmtDate(v) },
                  { key: "completedAt", label: "Completed", render: (v) => fmtDate(v) },
                  { key: "overrideReason", label: "Blocker / reason" },
                ]}
              />
            </TabsContent>

            <TabsContent value="approvals" className="mt-4">
              <DrillTable
                title="Approval records"
                rows={rowsApprovals}
                columns={[
                  { key: "approverRole", label: "Type" },
                  { key: "status", label: "Status", render: (v) => <Badge variant="outline" className="text-[10px]">{v}</Badge> },
                  { key: "approverUserId", label: "Approver" },
                  { key: "updatedAt", label: "Date", render: (v) => fmtDate(v) },
                  { key: "comments", label: "Comments" },
                ]}
              />
            </TabsContent>

            <TabsContent value="blockers" className="mt-4">
              <DrillTable
                title="Blockers / comments"
                rows={blockersAndComments}
                columns={[
                  { key: "source", label: "Source" },
                  { key: "item", label: "Item" },
                  { key: "owner", label: "Owner" },
                  { key: "status", label: "Status" },
                  { key: "detail", label: "Detail" },
                ]}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
