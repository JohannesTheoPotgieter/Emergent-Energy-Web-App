import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DollarSign,
  FileText,
  Package,
  AlertTriangle,
  Search,
  ChevronDown,
  ChevronRight,
  Filter,
  ArrowUpDown,
} from "lucide-react";

function formatRand(val: number | null | undefined): string {
  if (val == null || isNaN(val)) return "R 0";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R ${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}R ${(abs / 1_000).toFixed(1)}K`;
  return `${sign}R ${Math.round(abs)}`;
}

interface COSSummary {
  totalPlanned: number;
  totalCommitted: number;
  totalInvoiced: number;
  totalPaid: number;
  totalOutstanding: number;
  forecastNext4w: number;
  forecastNext8w: number;
  forecastNext12w: number;
  lineCount: number;
}

interface ProjectCOS {
  projectName: string;
  planned: number;
  committed: number;
  invoiced: number;
  paid: number;
  outstanding: number;
  forecastNext4w: number;
  lineCount: number;
}

interface COSLine {
  id: number;
  hash: string;
  projectName: string;
  category: string | null;
  lineItem: string | null;
  budgetTotal: number;
  actualTotal: number;
  state: string;
  poNumber: string | null;
  invoiceNumber: string | null;
  invoicedDate: string | null;
  paymentDate: string | null;
  forecastPaymentDate: string | null;
  supplierName: string | null;
  confidence: string;
  assumptionDriver: string;
}

interface InvoiceEntry {
  invoiceNumber: string;
  totalAmount: number;
  projects: string[];
  state: string;
  invoicedDate: string | null;
  paymentDate: string | null;
  supplierName: string | null;
  lineCount: number;
}

interface POEntry {
  poNumber: string;
  totalAmount: number;
  projects: string[];
  invoiceNumbers: string[];
  supplierName: string | null;
  lineCount: number;
}

const stateBadgeColors: Record<string, string> = {
  Planned: "bg-slate-100 text-slate-700 border-slate-200",
  Committed: "bg-amber-100 text-amber-700 border-amber-200",
  Invoiced: "bg-blue-100 text-blue-700 border-blue-200",
  Paid: "bg-green-100 text-green-700 border-green-200",
};

const confidenceBadgeColors: Record<string, string> = {
  High: "bg-green-100 text-green-700",
  Medium: "bg-amber-100 text-amber-700",
  Low: "bg-red-100 text-red-700",
};

function KPICard({ title, value, subtitle, icon: Icon, color }: {
  title: string;
  value: string;
  subtitle?: string;
  icon: any;
  color: string;
}) {
  return (
    <Card data-testid={`kpi-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium">{title}</p>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          <div className={`p-2 rounded-lg ${color.replace('text-', 'bg-').replace('600', '100')}`}>
            <Icon className={`h-5 w-5 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LineExplorer({ searchQuery, stateFilter, projectFilter }: {
  searchQuery: string;
  stateFilter: string;
  projectFilter: string;
}) {
  const params = new URLSearchParams();
  if (searchQuery) params.set('search', searchQuery);
  if (stateFilter && stateFilter !== 'all') params.set('state', stateFilter);
  if (projectFilter && projectFilter !== 'all') params.set('project', projectFilter);

  const { data, isLoading } = useQuery<{ lines: COSLine[]; total: number }>({
    queryKey: ["/api/cos-control/lines?" + params.toString()],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const [sortField, setSortField] = useState<string>("actualTotal");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const sortedLines = useMemo(() => {
    if (!data?.lines) return [];
    return [...data.lines].sort((a: any, b: any) => {
      const av = a[sortField] ?? 0;
      const bv = b[sortField] ?? 0;
      return sortDir === "desc" ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
    });
  }, [data?.lines, sortField, sortDir]);

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  };

  if (isLoading) return <div className="p-4 text-center text-muted-foreground">Loading line items...</div>;

  return (
    <div className="overflow-x-auto">
      <div className="text-sm text-muted-foreground mb-2">{data?.total ?? 0} line items</div>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background z-10 border-b">
          <tr>
            <th className="p-2 text-left w-8"></th>
            <th className="p-2 text-left cursor-pointer" onClick={() => toggleSort("projectName")}>
              <div className="flex items-center gap-1">Project <ArrowUpDown className="h-3 w-3" /></div>
            </th>
            <th className="p-2 text-left">Category</th>
            <th className="p-2 text-left">Line Item</th>
            <th className="p-2 text-left">State</th>
            <th className="p-2 text-right cursor-pointer" onClick={() => toggleSort("budgetTotal")}>
              <div className="flex items-center justify-end gap-1">Budget <ArrowUpDown className="h-3 w-3" /></div>
            </th>
            <th className="p-2 text-right cursor-pointer" onClick={() => toggleSort("actualTotal")}>
              <div className="flex items-center justify-end gap-1">Actual <ArrowUpDown className="h-3 w-3" /></div>
            </th>
            <th className="p-2 text-left">Invoice</th>
            <th className="p-2 text-left">PO</th>
            <th className="p-2 text-left">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {sortedLines.slice(0, 200).map((line) => (
            <React.Fragment key={line.id}>
              <tr
                data-testid={`cos-line-${line.id}`}
                className="border-b hover:bg-muted/50 cursor-pointer"
                onClick={() => {
                  const next = new Set(expandedRows);
                  next.has(line.id) ? next.delete(line.id) : next.add(line.id);
                  setExpandedRows(next);
                }}
              >
                <td className="p-2">
                  {expandedRows.has(line.id) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </td>
                <td className="p-2 font-medium truncate max-w-[180px]">{line.projectName}</td>
                <td className="p-2 truncate max-w-[120px]">{line.category || '-'}</td>
                <td className="p-2 truncate max-w-[200px]">{line.lineItem || '-'}</td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${stateBadgeColors[line.state] || ''}`}>
                    {line.state}
                  </span>
                </td>
                <td className="p-2 text-right font-mono text-xs">{formatRand(line.budgetTotal)}</td>
                <td className="p-2 text-right font-mono text-xs font-medium">{formatRand(line.actualTotal)}</td>
                <td className="p-2 truncate max-w-[120px] text-xs">{line.invoiceNumber || '-'}</td>
                <td className="p-2 truncate max-w-[100px] text-xs">{line.poNumber || '-'}</td>
                <td className="p-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${confidenceBadgeColors[line.confidence] || ''}`}>
                    {line.confidence}
                  </span>
                </td>
              </tr>
              {expandedRows.has(line.id) && (
                <tr className="bg-muted/30">
                  <td colSpan={10} className="p-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div><span className="text-muted-foreground">Supplier:</span> {line.supplierName || 'Unknown'}</div>
                      <div><span className="text-muted-foreground">Invoiced Date:</span> {line.invoicedDate || '-'}</div>
                      <div><span className="text-muted-foreground">Payment Date:</span> {line.paymentDate || '-'}</div>
                      <div><span className="text-muted-foreground">Forecast Payment:</span> {line.forecastPaymentDate || '-'}</div>
                      <div className="col-span-2"><span className="text-muted-foreground">Assumption:</span> {line.assumptionDriver}</div>
                      <div><span className="text-muted-foreground">Hash:</span> <code className="text-[10px]">{line.hash}</code></div>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      {sortedLines.length > 200 && (
        <p className="text-xs text-muted-foreground text-center py-2">Showing first 200 of {sortedLines.length} lines</p>
      )}
    </div>
  );
}

function InvoiceView() {
  const { data, isLoading } = useQuery<{ invoices: InvoiceEntry[]; total: number }>({
    queryKey: ["/api/cos-control/invoices"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  if (isLoading) return <div className="p-4 text-center text-muted-foreground">Loading invoices...</div>;

  return (
    <div className="overflow-x-auto">
      <div className="text-sm text-muted-foreground mb-2">{data?.total ?? 0} unique invoices</div>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background z-10 border-b">
          <tr>
            <th className="p-2 text-left">Invoice #</th>
            <th className="p-2 text-right">Total Amount</th>
            <th className="p-2 text-left">Supplier</th>
            <th className="p-2 text-left">State</th>
            <th className="p-2 text-left">Date</th>
            <th className="p-2 text-center">Projects</th>
            <th className="p-2 text-center">Lines</th>
          </tr>
        </thead>
        <tbody>
          {(data?.invoices ?? []).slice(0, 100).map((inv) => (
            <tr key={inv.invoiceNumber} className="border-b hover:bg-muted/50" data-testid={`invoice-row-${inv.invoiceNumber}`}>
              <td className="p-2 font-medium text-xs">{inv.invoiceNumber}</td>
              <td className="p-2 text-right font-mono text-xs font-medium">{formatRand(inv.totalAmount)}</td>
              <td className="p-2 text-xs">{inv.supplierName || '-'}</td>
              <td className="p-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${stateBadgeColors[inv.state] || ''}`}>
                  {inv.state}
                </span>
              </td>
              <td className="p-2 text-xs">{inv.invoicedDate || '-'}</td>
              <td className="p-2 text-center text-xs">{inv.projects.length}</td>
              <td className="p-2 text-center text-xs">{inv.lineCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function POView() {
  const { data, isLoading } = useQuery<{ pos: POEntry[]; total: number }>({
    queryKey: ["/api/cos-control/pos"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  if (isLoading) return <div className="p-4 text-center text-muted-foreground">Loading POs...</div>;

  return (
    <div className="overflow-x-auto">
      <div className="text-sm text-muted-foreground mb-2">{data?.total ?? 0} unique POs</div>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background z-10 border-b">
          <tr>
            <th className="p-2 text-left">PO #</th>
            <th className="p-2 text-right">Total Amount</th>
            <th className="p-2 text-left">Supplier</th>
            <th className="p-2 text-center">Invoices</th>
            <th className="p-2 text-center">Projects</th>
            <th className="p-2 text-center">Lines</th>
          </tr>
        </thead>
        <tbody>
          {(data?.pos ?? []).slice(0, 100).map((po) => (
            <tr key={po.poNumber} className="border-b hover:bg-muted/50" data-testid={`po-row-${po.poNumber}`}>
              <td className="p-2 font-medium text-xs">{po.poNumber}</td>
              <td className="p-2 text-right font-mono text-xs font-medium">{formatRand(po.totalAmount)}</td>
              <td className="p-2 text-xs">{po.supplierName || '-'}</td>
              <td className="p-2 text-center text-xs">{po.invoiceNumbers.length}</td>
              <td className="p-2 text-center text-xs">{po.projects.length}</td>
              <td className="p-2 text-center text-xs">{po.lineCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataQualityPanel() {
  const { data, isLoading } = useQuery<{
    issues: { ruleId: string; severity: string; description: string; count: number; items: any[] }[];
    summary: { errorCount: number; warningCount: number; infoCount: number; totalIssues: number };
  }>({
    queryKey: ["/api/data-quality/scan"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set());

  if (isLoading) return <div className="p-4 text-center text-muted-foreground">Scanning data quality...</div>;

  const summary = data?.summary;

  return (
    <div className="space-y-3">
      <div className="flex gap-4 mb-3">
        <Badge variant="destructive" className="text-xs">{summary?.errorCount ?? 0} Errors</Badge>
        <Badge className="bg-amber-100 text-amber-700 text-xs">{summary?.warningCount ?? 0} Warnings</Badge>
        <Badge variant="outline" className="text-xs">{summary?.infoCount ?? 0} Info</Badge>
      </div>
      {(data?.issues ?? []).map((issue) => (
        <Card key={issue.ruleId} className="border-l-4 border-l-transparent" style={{
          borderLeftColor: issue.severity === 'Error' ? '#ef4444' : issue.severity === 'Warning' ? '#f59e0b' : '#6b7280',
        }}>
          <div
            className="p-3 cursor-pointer flex items-center justify-between"
            onClick={() => {
              const next = new Set(expandedRules);
              next.has(issue.ruleId) ? next.delete(issue.ruleId) : next.add(issue.ruleId);
              setExpandedRules(next);
            }}
            data-testid={`dq-rule-${issue.ruleId}`}
          >
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono text-muted-foreground">{issue.ruleId}</code>
              <span className="text-sm font-medium">{issue.description}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">{issue.count}</Badge>
              {expandedRules.has(issue.ruleId) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </div>
          </div>
          {expandedRules.has(issue.ruleId) && (
            <div className="px-3 pb-3">
              <div className="max-h-48 overflow-y-auto text-xs space-y-1">
                {issue.items.slice(0, 50).map((item, idx) => (
                  <div key={idx} className="flex justify-between py-1 border-b border-muted">
                    <span className="font-medium">{item.projectName}</span>
                    <span className="text-muted-foreground">{item.detail}</span>
                  </div>
                ))}
                {issue.items.length > 50 && (
                  <p className="text-muted-foreground text-center">...and {issue.items.length - 50} more</p>
                )}
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function ProjectBreakdownTable() {
  const { data, isLoading } = useQuery<ProjectCOS[]>({
    queryKey: ["/api/cos-control/by-project"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  if (isLoading) return <div className="p-4 text-center text-muted-foreground">Loading projects...</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-background z-10 border-b">
          <tr>
            <th className="p-2 text-left">Project</th>
            <th className="p-2 text-right">Planned</th>
            <th className="p-2 text-right">Committed</th>
            <th className="p-2 text-right">Invoiced</th>
            <th className="p-2 text-right">Paid</th>
            <th className="p-2 text-right">Outstanding</th>
            <th className="p-2 text-right">4w Forecast</th>
            <th className="p-2 text-center">Lines</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((p) => (
            <tr key={p.projectName} className="border-b hover:bg-muted/50" data-testid={`project-cos-${p.projectName}`}>
              <td className="p-2 font-medium truncate max-w-[200px]">{p.projectName}</td>
              <td className="p-2 text-right font-mono text-xs">{formatRand(p.planned)}</td>
              <td className="p-2 text-right font-mono text-xs">{formatRand(p.committed)}</td>
              <td className="p-2 text-right font-mono text-xs">{formatRand(p.invoiced)}</td>
              <td className="p-2 text-right font-mono text-xs text-green-600">{formatRand(p.paid)}</td>
              <td className="p-2 text-right font-mono text-xs text-amber-600">{formatRand(p.outstanding)}</td>
              <td className="p-2 text-right font-mono text-xs">{formatRand(p.forecastNext4w)}</td>
              <td className="p-2 text-center text-xs">{p.lineCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CosControlPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");

  const { data: summary, isLoading: summaryLoading } = useQuery<COSSummary>({
    queryKey: ["/api/cos-control/summary"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const { data: projectData } = useQuery<ProjectCOS[]>({
    queryKey: ["/api/cos-control/by-project"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const projectNames = useMemo(() => {
    return (projectData ?? []).map(p => p.projectName).sort();
  }, [projectData]);

  return (
    <div className="space-y-6" data-testid="cos-control-page">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-heading font-bold text-foreground">COS Control Tower</h2>
        <p className="text-muted-foreground">Line-item state machine with invoice and PO rollup views</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <KPICard
          title="Planned"
          value={formatRand(summary?.totalPlanned)}
          subtitle={`${summary?.lineCount ?? 0} total lines`}
          icon={DollarSign}
          color="text-slate-600"
        />
        <KPICard
          title="Committed"
          value={formatRand(summary?.totalCommitted)}
          icon={Package}
          color="text-amber-600"
        />
        <KPICard
          title="Invoiced"
          value={formatRand(summary?.totalInvoiced)}
          icon={FileText}
          color="text-blue-600"
        />
        <KPICard
          title="Paid"
          value={formatRand(summary?.totalPaid)}
          icon={DollarSign}
          color="text-green-600"
        />
        <KPICard
          title="Outstanding"
          value={formatRand(summary?.totalOutstanding)}
          subtitle={`4w forecast: ${formatRand(summary?.forecastNext4w)}`}
          icon={AlertTriangle}
          color="text-red-600"
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">By Project</TabsTrigger>
          <TabsTrigger value="lines" data-testid="tab-lines">Line Items</TabsTrigger>
          <TabsTrigger value="invoices" data-testid="tab-invoices">Invoices</TabsTrigger>
          <TabsTrigger value="pos" data-testid="tab-pos">Purchase Orders</TabsTrigger>
          <TabsTrigger value="quality" data-testid="tab-quality">Data Quality</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">COS by Project</CardTitle>
            </CardHeader>
            <CardContent>
              <ProjectBreakdownTable />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lines">
          <Card>
            <CardHeader>
              <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
                <CardTitle className="text-lg">Line Item Explorer</CardTitle>
                <div className="flex gap-2 flex-wrap">
                  <div className="relative">
                    <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                    <Input
                      data-testid="input-search-lines"
                      placeholder="Search..."
                      className="pl-8 h-8 w-48"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                    />
                  </div>
                  <select
                    data-testid="select-state-filter"
                    className="h-8 rounded-md border px-2 text-sm bg-background"
                    value={stateFilter}
                    onChange={e => setStateFilter(e.target.value)}
                  >
                    <option value="all">All States</option>
                    <option value="Planned">Planned</option>
                    <option value="Committed">Committed</option>
                    <option value="Invoiced">Invoiced</option>
                    <option value="Paid">Paid</option>
                  </select>
                  <select
                    data-testid="select-project-filter"
                    className="h-8 rounded-md border px-2 text-sm bg-background max-w-[200px]"
                    value={projectFilter}
                    onChange={e => setProjectFilter(e.target.value)}
                  >
                    <option value="all">All Projects</option>
                    {projectNames.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <LineExplorer searchQuery={searchQuery} stateFilter={stateFilter} projectFilter={projectFilter} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoices">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Invoice Rollup</CardTitle>
            </CardHeader>
            <CardContent>
              <InvoiceView />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pos">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Purchase Order Rollup</CardTitle>
            </CardHeader>
            <CardContent>
              <POView />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quality">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Data Quality Scanner</CardTitle>
            </CardHeader>
            <CardContent>
              <DataQualityPanel />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
