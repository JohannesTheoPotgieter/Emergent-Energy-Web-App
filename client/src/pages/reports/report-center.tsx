import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarDays, FileText, FolderKanban, Settings2, BarChart3, TrendingUp, ShieldCheck, Milestone } from "lucide-react";
import { Link } from "wouter";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { GateReports } from "@/components/reports/gate-reports";
import { OperationalReports } from "@/components/reports/operational-reports";
import { QualityComplianceReports } from "@/components/reports/quality-compliance-reports";

type ReportType = {
  key: string;
  name: string;
  description: string;
  category: string;
  availableFormats: string[];
  parameters: string[];
};

type ReportHistoryRow = {
  id: string;
  report_type: string;
  format: string;
  status: string;
  download_url: string | null;
  created_at: string;
};

async function authFetch(url: string, options?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const csrf = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith("csrf-token="))?.split("=")[1];
  if (csrf) headers["X-CSRF-Token"] = csrf;
  const res = await fetch(url, { ...options, headers, credentials: "include" });
  if (!res.ok) throw new Error("Request failed");
  return res.json();
}

export default function ReportCenterPage() {
  const queryClient = useQueryClient();
  const [selectedFormat, setSelectedFormat] = useState("pdf");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [projectIds, setProjectIds] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleType, setScheduleType] = useState("weekly");
  const [scheduleTime, setScheduleTime] = useState("09:00");

  const { data: catalog } = useQuery<{ reportTypes: ReportType[] }>({
    queryKey: ["reports-catalog-advanced"],
    queryFn: () => authFetch("/api/reports/catalog"),
  });

  const { data: history } = useQuery<{ items: ReportHistoryRow[] }>({
    queryKey: ["reports-history-advanced"],
    queryFn: () => authFetch("/api/reports/history"),
  });

  const grouped = useMemo(() => {
    const map = new Map<string, ReportType[]>();
    for (const item of catalog?.reportTypes || []) {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category)!.push(item);
    }
    return Array.from(map.entries());
  }, [catalog]);

  const generateMutation = useMutation({
    mutationFn: (payload: { reportType: string; schedule?: string }) =>
      authFetch("/api/reports/generate", {
        method: "POST",
        body: JSON.stringify({
          reportType: payload.reportType,
          format: selectedFormat,
          parameters: {
            dateRange: { from: dateFrom || null, to: dateTo || null },
            projectIds: projectIds
              .split(",")
              .map((x) => Number(x.trim()))
              .filter((x) => Number.isFinite(x)),
          },
          schedule: payload.schedule,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reports-history-advanced"] });
      queryClient.invalidateQueries({ queryKey: ["reports-catalog-advanced"] });
      setScheduleOpen(false);
    },
  });

  const cron = scheduleType === "daily" ? `0 ${scheduleTime.split(":")[1]} ${scheduleTime.split(":")[0]} * * *` : scheduleType === "weekly" ? `0 ${scheduleTime.split(":")[1]} ${scheduleTime.split(":")[0]} * * 1` : `0 ${scheduleTime.split(":")[1]} ${scheduleTime.split(":")[0]} 1 * *`;

  return (
    <PageShell>
      <SectionHeader
        icon={<FolderKanban className="h-5 w-5" />}
        title="Report Centre"
        description="Generate, schedule, and download advanced reports across all departments."
      />

      {/* Wireframe: Report Centre overview dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-emerald-200">
          <CardContent className="px-4 py-3 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-50 flex items-center justify-center">
              <BarChart3 className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Executive Packs</p>
              <p className="text-lg font-bold">3 Reports</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-200">
          <CardContent className="px-4 py-3 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center">
              <Milestone className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Gate Reports</p>
              <p className="text-lg font-bold">Stage Engine</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-200">
          <CardContent className="px-4 py-3 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-50 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Operational</p>
              <p className="text-lg font-bold">KPIs & Metrics</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-violet-200">
          <CardContent className="px-4 py-3 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-violet-50 flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-violet-600" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Compliance</p>
              <p className="text-lg font-bold">Quality & HSE</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Generation Parameters</CardTitle>
          <CardDescription>Applies to report generation actions below.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4 grid-cols-1">
          <div>
            <Label>Date from</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <Label>Date to</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div>
            <Label>Project IDs</Label>
            <Input value={projectIds} onChange={(e) => setProjectIds(e.target.value)} placeholder="1,2,3" />
          </div>
          <div>
            <Label>Format</Label>
            <Select value={selectedFormat} onValueChange={setSelectedFormat}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pdf">PDF</SelectItem>
                <SelectItem value="xlsx">Excel</SelectItem>
                <SelectItem value="pptx">PowerPoint</SelectItem>
                <SelectItem value="csv">CSV</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="border-emerald-200">
        <CardHeader>
          <CardTitle>Executive Reporting Packs</CardTitle>
          <CardDescription>Primary board/management packs with compare, history, review and publish controls.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Link href="/reports/pm/monthly"><Button className="w-full" variant="outline">PM Monthly Report</Button></Link>
          <Link href="/reports/engineering/monthly"><Button className="w-full" variant="outline">Engineering Monthly Report</Button></Link>
          <Link href="/reports/programme"><Button className="w-full" variant="outline">Programme Reports</Button></Link>
        </CardContent>
      </Card>

      {/* Stage Engine Reports (Prompt 6) */}
      <Card className="border-blue-200">
        <CardHeader>
          <CardTitle>Stage Engine Reports</CardTitle>
          <CardDescription>Gate, operational, and quality/compliance reports from the stage lifecycle.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Link href="/reports/performance"><Button className="w-full" variant="outline">Performance Dashboard</Button></Link>
        </CardContent>
      </Card>

      <GateReports />
      <OperationalReports />
      <QualityComplianceReports />

      {grouped.map(([category, items]) => (
        <section key={category} className="space-y-3">
          <h2 className="font-semibold flex items-center gap-2"><FileText className="h-4 w-4" /> {category}</h2>
          <div className="grid lg:grid-cols-3 md:grid-cols-2 grid-cols-1 gap-4">
            {items.map((report) => (
              <Card key={report.key}>
                <CardHeader>
                  <CardTitle className="text-base">{report.name}</CardTitle>
                  <CardDescription>{report.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-1 flex-wrap">
                    {report.availableFormats.map((fmt) => <Badge key={fmt} variant="secondary">{fmt.toUpperCase()}</Badge>)}
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => generateMutation.mutate({ reportType: report.key })} disabled={generateMutation.isPending}>Generate</Button>
                    <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
                      <DialogTrigger asChild>
                        <Button variant="outline"><CalendarDays className="h-4 w-4 mr-1" />Schedule</Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>Schedule Report</DialogTitle></DialogHeader>
                        <div className="space-y-3">
                          <div>
                            <Label>Frequency</Label>
                            <Select value={scheduleType} onValueChange={setScheduleType}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="daily">Daily</SelectItem>
                                <SelectItem value="weekly">Weekly</SelectItem>
                                <SelectItem value="monthly">Monthly</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label>Time</Label>
                            <Input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
                          </div>
                          <Button className="w-full" onClick={() => generateMutation.mutate({ reportType: report.key, schedule: cron })}>
                            <Settings2 className="h-4 w-4 mr-1" /> Save Schedule
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Report History</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Format</TableHead><TableHead>Status</TableHead><TableHead>Generated</TableHead><TableHead>Download</TableHead></TableRow></TableHeader>
            <TableBody>
              {(history?.items || []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.report_type}</TableCell>
                  <TableCell>{row.format.toUpperCase()}</TableCell>
                  <TableCell>{row.status}</TableCell>
                  <TableCell>{new Date(row.created_at).toLocaleString()}</TableCell>
                  <TableCell>{row.download_url ? <a className="text-emerald-600" href={row.download_url}>Download</a> : "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PageShell>
  );
}
