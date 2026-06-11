/**
 * REV / COS / GP drill-down — FY ▸ month ▸ project ▸ line ▸ invoice.
 *
 * Reads ONLY the canonical drill endpoints (`/api/finance/drill/tree` and
 * `/api/finance/drill/invoices`), which sum the single read-path's per-line
 * values (AGENT_GUARDRAILS § 3.3.2 / § 3.3.1). This component computes no
 * REV/COS/GP number — every figure is a server-side sum of canonical lines.
 * Realised (BLACK) vs forecast (RED) is surfaced at every level (§ 3.7); all
 * amounts are ex-VAT. Every aggregate total is clickable to drill into its
 * children; the invoice leaf shows its tracker source cell for traceability.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Download, Loader2, FileSpreadsheet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { fetchQueryFn, apiRequest } from "@/lib/queryClient";
import { formatZar } from "@/lib/currency";
import { exportToCSV, type ExportColumn } from "@/lib/export-table";

interface SplitTotals {
  cos: number;
  revenue: number;
  gp: number;
}
interface DrillTotals {
  cos: number;
  revenue: number;
  gp: number;
  gpPct: number | null;
  count: number;
  realised: SplitTotals;
  forecast: SplitTotals;
}
type DrillLevel = "fy" | "month" | "project" | "category" | "invoice";
interface DrillNode extends DrillTotals {
  level: DrillLevel;
  key: string;
  label: string;
  month?: string | null;
  projectId?: number | null;
  categoryAllocationId?: number | null;
  categoryKey?: string | null;
  lineId?: number;
  parentLineId?: number;
  invoiceNumber?: string | null;
  invoiceRaisedDate?: string | null;
  poNumber?: string | null;
  bucket?: string;
  isForecast?: boolean;
  sourceSheet?: string | null;
  sourceRow?: number | null;
  sourceCell?: string | null;
  children?: DrillNode[];
  childCount?: number;
}
interface TreeResponse {
  fy: number;
  fyLabel: string;
  fyStart: string;
  fyEnd: string;
  projectIds: number[];
  sumInvariantOk: boolean;
  tree: DrillNode;
}
interface InvoicesResponse {
  projectId: number;
  fy: number;
  month: string | null;
  categoryAllocationId: number | null;
  categoryKey: string | null;
  subtotal: DrillTotals;
  total: number;
  limit: number;
  offset: number;
  invoices: DrillNode[];
}

const money = (n: number | null | undefined): string => formatZar(n);
const pct = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(1)}%`;

function currentFy(): number {
  const d = new Date();
  return d.getMonth() >= 8 ? d.getFullYear() + 1 : d.getFullYear();
}

const LEVEL_HINT: Record<DrillLevel, string> = {
  fy: "months",
  month: "projects",
  project: "categories",
  category: "invoices",
  invoice: "—",
};

/** Walk the tree following the focus keys; return the node chain (root first). */
function pathForKeys(root: DrillNode, keys: string[]): DrillNode[] {
  const chain: DrillNode[] = [root];
  let node = root;
  for (const k of keys) {
    const next = node.children?.find((c) => c.key === k);
    if (!next) break;
    chain.push(next);
    node = next;
  }
  return chain;
}

const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "projectId", header: "Project ID" },
  { key: "label", header: "Description" },
  { key: "invoiceNumber", header: "Invoice No (col S)" },
  { key: "invoiceRaisedDate", header: "Invoice Raised Date (col T)" },
  { key: "cos", header: "COS ex-VAT (col Q)" },
  { key: "revenue", header: "Revenue ex-VAT (Q/X×J)" },
  { key: "gp", header: "GP ex-VAT" },
  { key: "bucket", header: "State" },
  { key: "poNumber", header: "PO No (col R)" },
  { key: "sourceSheet", header: "Source Sheet" },
  { key: "sourceRow", header: "Source Row" },
  { key: "sourceCell", header: "Source Cell" },
];

async function fetchInvoices(params: Record<string, string>): Promise<DrillNode[]> {
  const qs = new URLSearchParams(params).toString();
  const res = await apiRequest("GET", `/api/finance/drill/invoices?${qs}`);
  const json = (await res.json()) as InvoicesResponse;
  return json.invoices;
}

/** Collect the underlying invoice leaves for ANY focused node, by querying the
 * canonical invoices endpoint for each project (and month/category) in scope.
 * Bounded by the number of projects under the node. */
async function gatherLeavesForNode(node: DrillNode, fy: number, tree: DrillNode): Promise<DrillNode[]> {
  const base = { fy: String(fy), limit: "500" };
  if (node.level === "category" && node.projectId != null) {
    const params: Record<string, string> = { ...base, projectId: String(node.projectId) };
    if (node.month) params.month = node.month;
    if (node.categoryAllocationId != null) params.categoryAllocationId = String(node.categoryAllocationId);
    else if (node.categoryKey) params.categoryKey = node.categoryKey;
    return fetchInvoices(params);
  }
  if (node.level === "project" && node.projectId != null) {
    return fetchInvoices({ ...base, projectId: String(node.projectId) });
  }
  if (node.level === "month" && node.month) {
    const projectIds = (node.children ?? []).map((c) => c.projectId).filter((id): id is number => id != null);
    const all = await Promise.all(
      projectIds.map((pid) => fetchInvoices({ ...base, projectId: String(pid), month: node.month! })),
    );
    return all.flat();
  }
  // FY root → every project in the tree.
  const projectIds = new Set<number>();
  for (const month of tree.children ?? []) {
    for (const proj of month.children ?? []) {
      if (proj.projectId != null) projectIds.add(proj.projectId);
    }
  }
  const all = await Promise.all(
    Array.from(projectIds).map((pid) => fetchInvoices({ ...base, projectId: String(pid) })),
  );
  return all.flat();
}

function StateBadge({ node }: { node: DrillNode }) {
  const realised = node.bucket === "realised";
  return (
    <Badge
      variant={realised ? "default" : "destructive"}
      className={realised ? "" : "bg-red-600 hover:bg-red-600"}
    >
      {realised ? "Realised" : "Forecast"}
    </Badge>
  );
}

/** Realised (black) / Forecast (red) GP split shown at every aggregate level. */
function SplitCell({ totals }: { totals: DrillTotals }) {
  return (
    <div className="text-right tabular-nums leading-tight">
      <div className="text-foreground font-semibold" title="Realised (BLACK)">
        {money(totals.realised.gp)}
      </div>
      <div className="text-red-600 text-xs" title="Forecast (RED)">
        {money(totals.forecast.gp)}
      </div>
    </div>
  );
}

export function RevCosGpDrillView() {
  const [fy, setFy] = useState<number>(currentFy());
  const [focusKeys, setFocusKeys] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);

  const treeQuery = useQuery<TreeResponse>({
    queryKey: [`/api/finance/drill/tree?fy=${fy}`],
    queryFn: fetchQueryFn(`/api/finance/drill/tree?fy=${fy}`),
    staleTime: 60_000,
  });

  const tree = treeQuery.data?.tree ?? null;
  const chain = useMemo(() => (tree ? pathForKeys(tree, focusKeys) : []), [tree, focusKeys]);
  const current = chain.length > 0 ? chain[chain.length - 1] : tree;
  const isCategory = current?.level === "category";

  const invoiceParams = useMemo(() => {
    if (!isCategory || !current || current.projectId == null) return null;
    const p: Record<string, string> = {
      fy: String(fy),
      projectId: String(current.projectId),
      limit: "500",
    };
    if (current.month) p.month = current.month;
    if (current.categoryAllocationId != null) p.categoryAllocationId = String(current.categoryAllocationId);
    else if (current.categoryKey) p.categoryKey = current.categoryKey;
    return p;
  }, [isCategory, current, fy]);

  const invoicesQuery = useQuery<InvoicesResponse>({
    queryKey: [`/api/finance/drill/invoices`, invoiceParams],
    queryFn: fetchQueryFn(`/api/finance/drill/invoices?${new URLSearchParams(invoiceParams ?? {}).toString()}`),
    enabled: invoiceParams != null,
    staleTime: 60_000,
  });

  const fyOptions = useMemo(() => {
    const c = currentFy();
    return [c + 1, c, c - 1, c - 2];
  }, []);

  const drillInto = (node: DrillNode) => {
    if (node.level === "invoice") return;
    setFocusKeys((prev) => [...prev, node.key]);
  };
  const jumpTo = (depth: number) => setFocusKeys((prev) => prev.slice(0, depth));

  const handleExport = async () => {
    if (!current || !tree) return;
    setExporting(true);
    try {
      const leaves = await gatherLeavesForNode(current, fy, tree);
      const filename = `finance-drill-${current.level}-${current.label.replace(/\W+/g, "_")}-FY${fy}`;
      exportToCSV(leaves, EXPORT_COLUMNS, filename);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card data-testid="rev-cos-gp-drill">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">REV / COS / GP drill — invoice level</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              FY ▸ month ▸ project ▸ line ▸ invoice. Every figure is the sum of canonical per-line
              values (§ 3.3.1). All amounts <strong>ex-VAT</strong>. Realised =
              {" "}<span className="text-foreground font-semibold">black</span>, forecast =
              {" "}<span className="text-red-600 font-semibold">red</span>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={fy}
              onChange={(e) => {
                setFy(Number(e.target.value));
                setFocusKeys([]);
              }}
              data-testid="drill-fy-select"
            >
              {fyOptions.map((y) => (
                <option key={y} value={y}>{`FY${String(y).slice(-2)}`}</option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              onClick={handleExport}
              disabled={exporting || !current}
              data-testid="drill-export"
            >
              {exporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
              Export lines
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Breadcrumb */}
        {tree && (
          <Breadcrumb>
            <BreadcrumbList>
              {chain.map((node, i) => {
                const isLast = i === chain.length - 1;
                return (
                  <span key={node.key} className="inline-flex items-center gap-1.5">
                    <BreadcrumbItem>
                      {isLast ? (
                        <BreadcrumbPage>{node.label}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink asChild>
                          <button
                            type="button"
                            className="hover:text-foreground"
                            onClick={() => jumpTo(i)}
                            data-testid={`drill-crumb-${i}`}
                          >
                            {node.label}
                          </button>
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                    {!isLast && <BreadcrumbSeparator />}
                  </span>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
        )}

        {treeQuery.isLoading && (
          <div className="flex items-center text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading drill…
          </div>
        )}
        {treeQuery.isError && (
          <div className="text-sm text-muted-foreground py-6">
            Could not load the drill.{" "}
            <button className="underline" onClick={() => treeQuery.refetch()}>Retry</button>.
          </div>
        )}

        {tree && current && !treeQuery.isLoading && (
          <>
            {/* Focused node summary */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
              <Summary label="Revenue (ex-VAT)" value={money(current.revenue)} />
              <Summary label="COS (ex-VAT)" value={money(current.cos)} />
              <Summary label="GP (ex-VAT)" value={money(current.gp)} />
              <Summary label="Margin %" value={pct(current.gpPct)} />
              <Summary
                label="Realised / Forecast GP"
                value={
                  <span>
                    <span className="text-foreground font-semibold">{money(current.realised.gp)}</span>
                    {" / "}
                    <span className="text-red-600">{money(current.forecast.gp)}</span>
                  </span>
                }
              />
            </div>

            {isCategory ? (
              <InvoiceTable query={invoicesQuery} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>{`${current.label} — drill into ${LEVEL_HINT[current.level]}`}</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">COS</TableHead>
                    <TableHead className="text-right">GP</TableHead>
                    <TableHead className="text-right">Margin %</TableHead>
                    <TableHead className="text-right">Realised / Forecast GP</TableHead>
                    <TableHead className="text-right">Lines</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(current.children ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">
                        No lines at this level for {fyLabelShort(fy)}.
                      </TableCell>
                    </TableRow>
                  )}
                  {(current.children ?? []).map((child) => (
                    <TableRow
                      key={child.key}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => drillInto(child)}
                      data-testid={`drill-row-${child.key}`}
                    >
                      <TableCell className="w-8"><ChevronRight className="h-4 w-4" /></TableCell>
                      <TableCell className="font-medium">{child.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(child.revenue)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(child.cos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(child.gp)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(child.gpPct)}</TableCell>
                      <TableCell><SplitCell totals={child} /></TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{child.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function fyLabelShort(fy: number): string {
  return `FY${String(fy).slice(-2)}`;
}

function Summary({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function InvoiceTable({ query }: { query: ReturnType<typeof useQuery<InvoicesResponse>> }) {
  if (query.isLoading) {
    return (
      <div className="flex items-center text-muted-foreground py-6">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading invoices…
      </div>
    );
  }
  const invoices = query.data?.invoices ?? [];
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice / Line</TableHead>
          <TableHead>Date (T)</TableHead>
          <TableHead className="text-right">COS (Q)</TableHead>
          <TableHead className="text-right">Revenue</TableHead>
          <TableHead className="text-right">GP</TableHead>
          <TableHead>State</TableHead>
          <TableHead>PO (R)</TableHead>
          <TableHead>Source cell</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.length === 0 && (
          <TableRow>
            <TableCell colSpan={8} className="text-center text-muted-foreground">
              No invoices in this category.
            </TableCell>
          </TableRow>
        )}
        {invoices.map((inv) => (
          <TableRow
            key={inv.key}
            className={inv.bucket === "realised" ? "" : "text-red-700"}
            data-testid={`drill-invoice-${inv.lineId}`}
          >
            <TableCell>
              <div className="font-medium">{inv.invoiceNumber ?? inv.label}</div>
              <div className="text-xs text-muted-foreground">{inv.label}</div>
            </TableCell>
            <TableCell className="tabular-nums">{inv.invoiceRaisedDate ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">{money(inv.cos)}</TableCell>
            <TableCell className="text-right tabular-nums">{money(inv.revenue)}</TableCell>
            <TableCell className="text-right tabular-nums">{money(inv.gp)}</TableCell>
            <TableCell><StateBadge node={inv} /></TableCell>
            <TableCell className="text-xs text-muted-foreground">{inv.poNumber ?? "—"}</TableCell>
            <TableCell className="text-xs font-mono text-muted-foreground" title="Tracker source cell">
              <span className="inline-flex items-center gap-1">
                <FileSpreadsheet className="h-3 w-3" />
                {inv.sourceCell ?? (inv.sourceSheet ?? "—")}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default RevCosGpDrillView;
