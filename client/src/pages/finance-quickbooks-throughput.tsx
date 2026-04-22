import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PageSkeleton } from "@/components/ui/page-states";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plug,
  RefreshCw,
  Building2,
  Link2,
  Link2Off,
  Users,
  Activity,
  History,
  Search,
  X,
  ChevronDown,
  Receipt,
  Banknote,
} from "lucide-react";
import { apiRequest, invalidateDashboardQueries } from "@/lib/queryClient";
import { isApiError } from "@/lib/api-error";
import { formatRand } from "@/lib/safeMoney";
import { FinanceShell } from "@/components/layout/FinanceShell";
import { useAuth } from "@/hooks/use-auth";
import { SuggestMatchesDialog } from "@/components/quickbooks/SuggestMatchesDialog";
import { Sparkles } from "lucide-react";


type IntegrationHealthState = "healthy" | "stale" | "failing" | "unknown";

interface QuickBooksStatus {
  connected: boolean;
  realmId: string | null;
  companyName: string | null;
  tokenExpiry: string | null;
  refreshTokenExpiry: string | null;
  sandbox: boolean;
  health: IntegrationHealthState;
  lastSuccessfulSyncAt: string | null;
  lastFailedSyncAt: string | null;
  lastFailureCode: string | null;
  lastFailureReason: string | null;
  isStale: boolean;
  ageMs: number | null;
  staleAfterMs: number;
}

function formatRelativeAge(ageMs: number | null): string {
  if (ageMs === null || ageMs < 0) return "—";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function healthBadgeClass(state: IntegrationHealthState): string {
  switch (state) {
    case "healthy":
      return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "stale":
      return "bg-amber-100 text-amber-700 border-amber-200";
    case "failing":
      return "bg-rose-100 text-rose-700 border-rose-200";
    default:
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

function ConnectionTab({ status }: { status: QuickBooksStatus | undefined }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isConnected = status?.connected ?? false;

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/quickbooks/disconnect");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/status"] });
      toast({ title: "QuickBooks disconnected" });
    },
    onError: (err: Error) => {
      toast({ title: "Disconnect failed", description: err.message, variant: "destructive" });
    },
  });

  const { data: pnlReport } = useQuery<any>({
    queryKey: ["/api/quickbooks/reports/pnl-throughput"],
    queryFn: async () => {
      const end = new Date();
      const start = new Date(end.getFullYear(), end.getMonth() - 2, 1);
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const res = await apiRequest(
        "GET",
        `/api/quickbooks/reports/pnl?startDate=${iso(start)}&endDate=${iso(end)}`,
      );
      return res.json();
    },
    enabled: isConnected,
  });

  const summaryRow = pnlReport?.Rows?.Row?.find?.((r: any) => r?.Summary);
  const netIncome =
    summaryRow?.Summary?.ColData?.[summaryRow.Summary.ColData.length - 1]?.value ?? "—";

  return (
    <div className="space-y-4">
      {!isConnected ? (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-800">QuickBooks is not connected</p>
                <p className="text-xs text-amber-700 mt-1">
                  Click Connect to authorize this workspace. You'll be redirected to Intuit.
                </p>
                <Button
                  size="sm"
                  className="mt-3 gap-1.5"
                  onClick={() => {
                    window.location.href = "/api/quickbooks/auth";
                  }}
                >
                  <Plug className="h-4 w-4" /> Connect to QuickBooks
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card
            className={
              status?.health === "failing"
                ? "border-rose-200 bg-rose-50/40"
                : status?.isStale || status?.health === "stale"
                  ? "border-amber-200 bg-amber-50/40"
                  : "border-emerald-200 bg-emerald-50/40"
            }
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                {status?.health === "failing" ? (
                  <AlertTriangle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
                ) : status?.isStale || status?.health === "stale" ? (
                  <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">Integration health</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${healthBadgeClass(status?.health ?? "unknown")}`}
                    >
                      {status?.health ?? "unknown"}
                    </Badge>
                    {status?.isStale && status?.health !== "failing" && (
                      <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                        stale data
                      </Badge>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">Last successful sync</div>
                      <div className="font-medium">
                        {status?.lastSuccessfulSyncAt
                          ? `${formatDateTime(status.lastSuccessfulSyncAt)} (${formatRelativeAge(status.ageMs)})`
                          : "never"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Last failed sync</div>
                      <div className="font-medium">
                        {status?.lastFailedSyncAt ? formatDateTime(status.lastFailedSyncAt) : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Last failure reason</div>
                      <div className="font-medium truncate" title={status?.lastFailureReason ?? undefined}>
                        {status?.lastFailureCode
                          ? `${status.lastFailureCode}${status.lastFailureReason ? ` — ${status.lastFailureReason}` : ""}`
                          : "—"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground mb-1">Company</div>
                <div className="text-sm font-medium truncate">{status?.companyName ?? "—"}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground mb-1">Realm ID</div>
                <div className="text-sm font-medium truncate">{status?.realmId ?? "—"}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground mb-1">Access token expiry</div>
                <div className="text-sm font-medium">{formatDateTime(status?.tokenExpiry)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-xs text-muted-foreground mb-1">3-mo Net Income (QB P&L)</div>
                <div className="text-sm font-medium">{netIncome}</div>
              </CardContent>
            </Card>
          </div>

          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
              className="gap-1.5"
            >
              {disconnectMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plug className="h-4 w-4" />
              )}
              Disconnect
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

interface SyncLogEvent {
  id: number;
  runAt: string;
  status: "ok" | "error" | "running";
  kind: string | null;
  message: string | null;
  recordCount: number | null;
}

function SyncLogTab() {
  const { data, isLoading } = useQuery<{ events: SyncLogEvent[] }>({
    queryKey: ["/api/quickbooks/sync-log"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/quickbooks/sync-log");
      return res.json();
    },
  });

  const events = data?.events ?? [];

  if (isLoading) return <PageSkeleton lines={5} />;

  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        {events.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No sync events recorded yet. Trigger a sync from the Connection tab.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">When</th>
                <th className="text-left px-3 py-2 font-medium">Type</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-right px-3 py-2 font-medium">Records</th>
                <th className="text-left px-3 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((evt) => (
                <tr key={evt.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(evt.runAt)}</td>
                  <td className="px-3 py-2">{evt.kind ?? "—"}</td>
                  <td className="px-3 py-2">
                    {evt.status === "ok" ? (
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> OK
                      </Badge>
                    ) : evt.status === "error" ? (
                      <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">
                        <AlertTriangle className="h-3 w-3 mr-1" /> Error
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200">
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Running
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{evt.recordCount ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-[400px] truncate">
                    {evt.message ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

// ===================== Mapping tab =====================

interface QbCustomerRaw {
  Id: string;
  DisplayName?: string;
  CompanyName?: string;
  Active?: boolean;
}

interface QbVendorRaw {
  Id: string;
  DisplayName?: string;
  CompanyName?: string;
  Active?: boolean;
}

interface CustomerMappingRow {
  projectId: number;
  projectName: string;
  clientId: number | null;
  mapping: {
    id: number;
    projectId: number;
    qbCustomerId: string;
    qbCustomerName: string | null;
    qbRealmId: string;
    updatedAt: string;
  } | null;
}

interface VendorMappingRow {
  id: number;
  qbVendorId: string;
  qbVendorName: string | null;
  qbRealmId: string;
  counterpartyId: number;
  counterpartyName: string | null;
  counterpartyCurrent: string | null;
  updatedAt: string;
}

interface CounterpartyRow {
  id: number;
  nameCanonical: string;
  typeDefault: string;
  isActive: boolean;
}

function SearchPicker({
  value,
  placeholder,
  options,
  onSelect,
  disabled,
  buttonClassName,
  emptyLabel = "No results",
}: {
  value: string | null;
  placeholder: string;
  options: { key: string; label: string; sublabel?: string }[];
  onSelect: (key: string, label: string) => void;
  disabled?: boolean;
  buttonClassName?: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 200);
    return options
      .filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          (o.sublabel ?? "").toLowerCase().includes(q),
      )
      .slice(0, 200);
  }, [options, query]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className={`justify-between gap-2 ${buttonClassName ?? ""}`}
        >
          <span className="truncate">{value ?? placeholder}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[320px]" align="start">
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>
        <div className="max-h-[280px] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground text-center">{emptyLabel}</div>
          ) : (
            filtered.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => {
                  onSelect(o.key, o.label);
                  setOpen(false);
                  setQuery("");
                }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-muted/60 border-b last:border-b-0"
              >
                <div className="font-medium truncate">{o.label}</div>
                {o.sublabel && <div className="text-[10px] text-muted-foreground truncate">{o.sublabel}</div>}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CustomersMappingView({ isConnected }: { isConnected: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const [search, setSearch] = useState("");
  const [suggestFor, setSuggestFor] = useState<{ projectId: number; projectName: string } | null>(null);

  const { data: customersResp, isLoading: customersLoading } = useQuery<{
    QueryResponse?: { Customer?: QbCustomerRaw[] };
  }>({
    queryKey: ["/api/quickbooks/customers"],
    queryFn: async () => (await apiRequest("GET", "/api/quickbooks/customers")).json(),
    enabled: isConnected,
  });

  const { data: mappingResp, isLoading: mappingLoading } = useQuery<{ projects: CustomerMappingRow[] }>({
    queryKey: ["/api/quickbooks/customer-mappings"],
    queryFn: async () => (await apiRequest("GET", "/api/quickbooks/customer-mappings")).json(),
  });

  const saveMapping = useMutation({
    mutationFn: async (input: { projectId: number; qbCustomerId: string; qbCustomerName: string }) => {
      const res = await apiRequest("POST", "/api/quickbooks/customer-mappings", input);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/customer-mappings"] });
      toast({ title: "Project mapped" });
    },
    onError: (e: Error) => toast({ title: "Map failed", description: e.message, variant: "destructive" }),
  });

  const removeMapping = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/quickbooks/customer-mappings/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/customer-mappings"] });
      toast({ title: "Project unmapped" });
    },
    onError: (e: Error) => toast({ title: "Unmap failed", description: e.message, variant: "destructive" }),
  });

  const qbCustomers = customersResp?.QueryResponse?.Customer ?? [];
  const rows = mappingResp?.projects ?? [];

  // Group projects by the QB customer they are mapped to.
  const mappedByCustomer = useMemo(() => {
    const byCust = new Map<string, CustomerMappingRow[]>();
    for (const row of rows) {
      if (!row.mapping) continue;
      const k = row.mapping.qbCustomerId;
      if (!byCust.has(k)) byCust.set(k, []);
      byCust.get(k)!.push(row);
    }
    return byCust;
  }, [rows]);

  const unmappedProjects = useMemo(
    () => rows.filter((r) => !r.mapping),
    [rows],
  );

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = qbCustomers;
    if (!q) return list;
    return list.filter((c) =>
      (c.DisplayName ?? "").toLowerCase().includes(q) ||
      (c.CompanyName ?? "").toLowerCase().includes(q),
    );
  }, [qbCustomers, search]);

  const projectOptionsFor = (custId: string) => {
    const alreadyMapped = new Set(
      (mappedByCustomer.get(custId) ?? []).map((r) => r.projectId),
    );
    return unmappedProjects
      .filter((r) => !alreadyMapped.has(r.projectId))
      .map((r) => ({
        key: String(r.projectId),
        label: r.projectName,
        sublabel: `#${r.projectId}`,
      }));
  };

  if (!isConnected) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground text-center">
          Connect QuickBooks to manage customer mappings.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-muted-foreground">
          {qbCustomers.length} QuickBooks customers · {rows.filter((r) => r.mapping).length}/{rows.length} projects mapped
        </div>
        <div className="relative w-[240px]">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search QuickBooks customers..."
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {customersLoading || mappingLoading ? (
            <div className="p-4"><PageSkeleton lines={4} /></div>
          ) : filteredCustomers.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {qbCustomers.length === 0
                ? "No QuickBooks customers returned. Trigger a sync from the Connection tab."
                : "No customers match your search."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">QuickBooks Customer</th>
                  <th className="text-left px-3 py-2 font-medium">Mapped Projects</th>
                  <th className="text-right px-3 py-2 font-medium w-[200px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.map((c) => {
                  const mapped = mappedByCustomer.get(c.Id) ?? [];
                  return (
                    <tr key={c.Id} className="border-t align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium">{c.DisplayName ?? c.CompanyName ?? c.Id}</div>
                        <div className="text-[10px] text-muted-foreground">QB Id {c.Id}{c.Active === false ? " · inactive" : ""}</div>
                      </td>
                      <td className="px-3 py-2">
                        {mapped.length === 0 ? (
                          <span className="text-xs text-muted-foreground">Not mapped</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {mapped.map((r) => (
                              <Badge
                                key={r.projectId}
                                variant="outline"
                                className="gap-1 bg-emerald-50 text-emerald-700 border-emerald-200"
                              >
                                <Link2 className="h-3 w-3" />
                                {r.projectName}
                                <button
                                  type="button"
                                  onClick={() => r.mapping && removeMapping.mutate(r.mapping.id)}
                                  className="hover:text-rose-600 ml-1"
                                  title="Unmap"
                                  disabled={removeMapping.isPending}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <SearchPicker
                          value={null}
                          placeholder="Map to project..."
                          options={projectOptionsFor(c.Id)}
                          emptyLabel="All projects mapped"
                          disabled={saveMapping.isPending}
                          onSelect={(key) => {
                            const projectId = Number(key);
                            if (!Number.isFinite(projectId)) return;
                            saveMapping.mutate({
                              projectId,
                              qbCustomerId: c.Id,
                              qbCustomerName: c.DisplayName ?? c.CompanyName ?? "",
                            });
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {unmappedProjects.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs font-medium">{unmappedProjects.length} app projects have no QB customer</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {unmappedProjects.slice(0, 50).map((r) => (
                <span key={r.projectId} className="inline-flex items-center gap-1">
                  <Badge variant="outline" className="text-[10px]">
                    {r.projectName}
                  </Badge>
                  {isAdmin && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-5 px-1.5 text-[10px] gap-0.5 text-amber-700 hover:text-amber-900"
                      onClick={() => setSuggestFor({ projectId: r.projectId, projectName: r.projectName })}
                      data-testid={`button-suggest-customer-${r.projectId}`}
                      title="Suggest matches (admin)"
                    >
                      <Sparkles className="h-2.5 w-2.5" /> Suggest
                    </Button>
                  )}
                </span>
              ))}
              {unmappedProjects.length > 50 && (
                <Badge variant="outline" className="text-[10px]">+{unmappedProjects.length - 50} more</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {suggestFor && (
        <SuggestMatchesDialog
          open={!!suggestFor}
          onOpenChange={(o) => !o && setSuggestFor(null)}
          scope="customer"
          appEntityId={suggestFor.projectId}
          appEntityLabel={suggestFor.projectName}
          invalidateOnSuccess={[
            ["/api/quickbooks/customer-mappings"],
            ["/api/quickbooks/links"],
          ]}
        />
      )}
    </div>
  );
}

function VendorsMappingView({ isConnected }: { isConnected: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const [search, setSearch] = useState("");
  const [suggestFor, setSuggestFor] = useState<{ counterpartyId: number; counterpartyName: string } | null>(null);

  const { data: vendorsResp, isLoading: vendorsLoading } = useQuery<{
    QueryResponse?: { Vendor?: QbVendorRaw[] };
  }>({
    queryKey: ["/api/quickbooks/vendors"],
    queryFn: async () => (await apiRequest("GET", "/api/quickbooks/vendors")).json(),
    enabled: isConnected,
  });

  const { data: mappingResp, isLoading: mappingLoading } = useQuery<{ mappings: VendorMappingRow[] }>({
    queryKey: ["/api/quickbooks/vendor-mappings"],
    queryFn: async () => (await apiRequest("GET", "/api/quickbooks/vendor-mappings")).json(),
  });

  const { data: counterparties } = useQuery<CounterpartyRow[]>({
    queryKey: ["/api/counterparties"],
    queryFn: async () => (await apiRequest("GET", "/api/counterparties")).json(),
  });

  const saveMapping = useMutation({
    mutationFn: async (input: {
      qbVendorId: string;
      qbVendorName: string | null;
      counterpartyId: number;
      counterpartyName: string | null;
    }) => {
      const res = await apiRequest("POST", "/api/quickbooks/vendor-mappings", input);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/vendor-mappings"] });
      toast({ title: "Vendor mapped" });
    },
    onError: (e: Error) => toast({ title: "Map failed", description: e.message, variant: "destructive" }),
  });

  const removeMapping = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/quickbooks/vendor-mappings/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/vendor-mappings"] });
      toast({ title: "Vendor unmapped" });
    },
    onError: (e: Error) => toast({ title: "Unmap failed", description: e.message, variant: "destructive" }),
  });

  const qbVendors = vendorsResp?.QueryResponse?.Vendor ?? [];
  const mappings = mappingResp?.mappings ?? [];
  const cpList = counterparties ?? [];

  const mappingByVendor = useMemo(() => {
    const m = new Map<string, VendorMappingRow>();
    for (const x of mappings) m.set(x.qbVendorId, x);
    return m;
  }, [mappings]);

  const filteredVendors = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return qbVendors;
    return qbVendors.filter((v) =>
      (v.DisplayName ?? "").toLowerCase().includes(q) ||
      (v.CompanyName ?? "").toLowerCase().includes(q),
    );
  }, [qbVendors, search]);

  const counterpartyOptions = useMemo(
    () =>
      cpList
        .filter((c) => c.isActive !== false)
        .map((c) => ({
          key: String(c.id),
          label: c.nameCanonical,
          sublabel: c.typeDefault,
        })),
    [cpList],
  );

  const mappedCounterpartyIds = useMemo(
    () => new Set(mappings.map((m) => m.counterpartyId)),
    [mappings],
  );
  const unmappedCounterparties = useMemo(
    () =>
      cpList
        .filter((c) => c.isActive !== false && !mappedCounterpartyIds.has(c.id))
        .slice(0, 50),
    [cpList, mappedCounterpartyIds],
  );

  if (!isConnected) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground text-center">
          Connect QuickBooks to manage vendor mappings.
        </CardContent>
      </Card>
    );
  }

  const unmappedVendors = qbVendors.filter((v) => !mappingByVendor.has(v.Id));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs text-muted-foreground">
          {qbVendors.length} QuickBooks vendors · {mappings.length} mapped · {unmappedVendors.length} unmapped
        </div>
        <div className="relative w-[240px]">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search QuickBooks vendors..."
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {vendorsLoading || mappingLoading ? (
            <div className="p-4"><PageSkeleton lines={4} /></div>
          ) : filteredVendors.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {qbVendors.length === 0
                ? "No QuickBooks vendors returned. Trigger a sync from the Connection tab."
                : "No vendors match your search."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">QuickBooks Vendor</th>
                  <th className="text-left px-3 py-2 font-medium">Mapped Supplier (Counterparty)</th>
                  <th className="text-right px-3 py-2 font-medium w-[240px]">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredVendors.map((v) => {
                  const m = mappingByVendor.get(v.Id);
                  const vendorName = v.DisplayName ?? v.CompanyName ?? v.Id;
                  return (
                    <tr key={v.Id} className="border-t align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium">{vendorName}</div>
                        <div className="text-[10px] text-muted-foreground">QB Id {v.Id}{v.Active === false ? " · inactive" : ""}</div>
                      </td>
                      <td className="px-3 py-2">
                        {m ? (
                          <Badge variant="outline" className="gap-1 bg-emerald-50 text-emerald-700 border-emerald-200">
                            <Link2 className="h-3 w-3" />
                            {m.counterpartyCurrent ?? m.counterpartyName ?? `Counterparty #${m.counterpartyId}`}
                            <button
                              type="button"
                              onClick={() => removeMapping.mutate(m.id)}
                              className="hover:text-rose-600 ml-1"
                              title="Unmap"
                              disabled={removeMapping.isPending}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not mapped</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <SearchPicker
                          value={null}
                          placeholder={m ? "Change supplier..." : "Pick supplier..."}
                          options={counterpartyOptions}
                          emptyLabel="No counterparties"
                          disabled={saveMapping.isPending}
                          onSelect={(key, label) => {
                            const counterpartyId = Number(key);
                            if (!Number.isFinite(counterpartyId)) return;
                            saveMapping.mutate({
                              qbVendorId: v.Id,
                              qbVendorName: vendorName,
                              counterpartyId,
                              counterpartyName: label,
                            });
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {isAdmin && unmappedCounterparties.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs font-medium">
                {unmappedCounterparties.length} suppliers have no QuickBooks vendor — admins can request matches
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {unmappedCounterparties.map((cp) => (
                <Button
                  key={cp.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px] gap-1 text-amber-700 hover:text-amber-900"
                  onClick={() => setSuggestFor({ counterpartyId: cp.id, counterpartyName: cp.nameCanonical })}
                  data-testid={`button-suggest-vendor-${cp.id}`}
                >
                  <Sparkles className="h-2.5 w-2.5" /> {cp.nameCanonical}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {suggestFor && (
        <SuggestMatchesDialog
          open={!!suggestFor}
          onOpenChange={(o) => !o && setSuggestFor(null)}
          scope="vendor"
          appEntityId={suggestFor.counterpartyId}
          appEntityLabel={suggestFor.counterpartyName}
          invalidateOnSuccess={[
            ["/api/quickbooks/vendor-mappings"],
            ["/api/quickbooks/links"],
          ]}
        />
      )}
    </div>
  );
}

// ===================== Suppliers =====================

interface CounterpartySummaryRow {
  id: number;
  nameCanonical: string;
  typeDefault: string;
  isActive: boolean;
  isCore: boolean;
  roleTags: string[];
  usageCount: number;
  linkedProjectCount: number;
  totalSpendExVat: number;
  openAmountExVat: number;
  activeContactCount: number;
}

function SuppliersTab({ isConnected }: { isConnected: boolean }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [sortBy, setSortBy] = useState<"spend" | "name" | "projects">("spend");

  const { data: counterparties, isLoading: cpLoading } = useQuery<CounterpartySummaryRow[]>({
    queryKey: ["/api/counterparties/summary"],
    queryFn: async () => (await apiRequest("GET", "/api/counterparties/summary")).json(),
  });

  const { data: vendorMappingsResp } = useQuery<{ mappings: VendorMappingRow[] }>({
    queryKey: ["/api/quickbooks/vendor-mappings"],
    queryFn: async () => (await apiRequest("GET", "/api/quickbooks/vendor-mappings")).json(),
    enabled: isConnected,
  });

  const mappings = vendorMappingsResp?.mappings ?? [];
  const mappingByCpId = useMemo(() => {
    const m = new Map<number, VendorMappingRow>();
    for (const x of mappings) m.set(x.counterpartyId, x);
    return m;
  }, [mappings]);

  const rows = counterparties ?? [];

  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.typeDefault) set.add(r.typeDefault);
    return ["ALL", ...Array.from(set).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter((r) => r.isActive !== false);
    if (typeFilter !== "ALL") out = out.filter((r) => r.typeDefault === typeFilter);
    if (q) out = out.filter((r) => r.nameCanonical.toLowerCase().includes(q));
    out = [...out];
    if (sortBy === "spend") out.sort((a, b) => (b.totalSpendExVat ?? 0) - (a.totalSpendExVat ?? 0));
    else if (sortBy === "projects") out.sort((a, b) => b.linkedProjectCount - a.linkedProjectCount);
    else out.sort((a, b) => a.nameCanonical.localeCompare(b.nameCanonical));
    return out;
  }, [rows, search, typeFilter, sortBy]);

  const totalSpend = useMemo(
    () => filtered.reduce((sum, r) => sum + (r.totalSpendExVat ?? 0), 0),
    [filtered],
  );
  const totalOpen = useMemo(
    () => filtered.reduce((sum, r) => sum + (r.openAmountExVat ?? 0), 0),
    [filtered],
  );
  const mappedCount = useMemo(
    () => filtered.filter((r) => mappingByCpId.has(r.id)).length,
    [filtered, mappingByCpId],
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Card><CardContent className="p-3">
          <div className="text-[10px] text-muted-foreground">Active suppliers</div>
          <div className="text-lg font-semibold">{filtered.length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] text-muted-foreground">Total spend ex VAT</div>
          <div className="text-lg font-semibold">{formatRand(totalSpend)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] text-muted-foreground">Open balance ex VAT</div>
          <div className="text-lg font-semibold text-amber-700">{formatRand(totalOpen)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] text-muted-foreground">Mapped to QB vendor</div>
          <div className="text-lg font-semibold text-emerald-700">
            {mappedCount}/{filtered.length}
          </div>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <div className="relative w-[220px]">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search supplier..."
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="h-8 text-xs border rounded px-2 bg-background"
              >
                {typeOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "spend" | "name" | "projects")}
                className="h-8 text-xs border rounded px-2 bg-background"
              >
                <option value="spend">Sort by spend</option>
                <option value="projects">Sort by projects</option>
                <option value="name">Sort by name</option>
              </select>
            </div>
            <div className="text-[10px] text-muted-foreground">
              Showing {filtered.length} of {rows.length} counterparties
            </div>
          </div>
          <div className="overflow-x-auto border rounded">
            {cpLoading ? (
              <div className="p-4"><PageSkeleton lines={4} /></div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">No suppliers match.</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-[10px] text-muted-foreground uppercase sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Supplier</th>
                    <th className="px-2 py-1.5 text-left">Type</th>
                    <th className="px-2 py-1.5 text-right">Projects</th>
                    <th className="px-2 py-1.5 text-right">Bills</th>
                    <th className="px-2 py-1.5 text-right">Spend ex VAT</th>
                    <th className="px-2 py-1.5 text-right">Open ex VAT</th>
                    <th className="px-2 py-1.5 text-left">QB vendor</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const mapping = mappingByCpId.get(r.id);
                    return (
                      <tr key={r.id} className="border-t hover:bg-muted/40">
                        <td className="px-2 py-1.5">
                          <div className="font-medium">{r.nameCanonical}</div>
                          {r.roleTags.length > 0 && (
                            <div className="flex flex-wrap gap-0.5 mt-0.5">
                              {r.roleTags.slice(0, 3).map((t) => (
                                <Badge key={t} variant="outline" className="text-[9px]">{t}</Badge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <Badge variant="outline" className="text-[9px]">{r.typeDefault}</Badge>
                          {r.isCore && <Badge className="text-[9px] bg-sky-100 text-sky-800 ml-1">Core</Badge>}
                        </td>
                        <td className="px-2 py-1.5 text-right">{r.linkedProjectCount}</td>
                        <td className="px-2 py-1.5 text-right">{r.usageCount}</td>
                        <td className="px-2 py-1.5 text-right font-medium">{formatRand(r.totalSpendExVat)}</td>
                        <td className={`px-2 py-1.5 text-right ${(r.openAmountExVat ?? 0) > 0 ? "text-amber-700" : ""}`}>
                          {formatRand(r.openAmountExVat)}
                        </td>
                        <td className="px-2 py-1.5">
                          {mapping ? (
                            <Badge variant="outline" className="gap-1 bg-emerald-50 text-emerald-700 border-emerald-200">
                              <Link2 className="h-3 w-3" />
                              {mapping.qbVendorName ?? mapping.qbVendorId}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] bg-amber-50 text-amber-700 border-amber-200">
                              Unmapped
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground">
            Map unmapped suppliers to their QuickBooks vendors in the Mapping tab. Totals reflect posted app bills ex VAT.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ===================== Reconciliation — Bills (Cost) =====================

interface QbBillRaw {
  Id: string;
  DocNumber?: string | null;
  TxnDate?: string | null;
  TotalAmt?: number | null;
  TxnTaxDetail?: { TotalTax?: number | null };
  Balance?: number | null;
  VendorRef?: { name?: string | null; value?: string | null };
}

interface AppCostLineSummary {
  id: number;
  projectId: number;
  projectName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  amountExVat: number | null;
  counterpartyName: string | null;
  description: string | null;
}

interface QuickBooksLinkRow {
  id: number;
  projectId: number | null;
  appEntityId: number;
  qbEntityId: string;
  qbDocNumber: string | null;
  qbTxnDate: string | null;
  qbAmount: string | null;
  qbCounterpartyName: string | null;
  matchType: string;
  confirmedAt: string;
  confirmedBy: number | null;
  appEntityType?: string;
  qbEntityType?: string;
}

function BillsReconciliationView({ isConnected }: { isConnected: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedBill, setSelectedBill] = useState<QbBillRaw | null>(null);
  const [costLineSearch, setCostLineSearch] = useState("");
  const [allocationDraft, setAllocationDraft] = useState<Record<number, string>>({});

  const { data: billsResp } = useQuery<{ QueryResponse?: { Bill?: QbBillRaw[] } }>({
    queryKey: ["/api/quickbooks/bills"],
    queryFn: async () => (await apiRequest("GET", "/api/quickbooks/bills")).json(),
    enabled: isConnected,
  });

  const { data: linksResp } = useQuery<{ links: QuickBooksLinkRow[] }>({
    queryKey: ["/api/quickbooks/links"],
    queryFn: async () => (await apiRequest("GET", "/api/quickbooks/links")).json(),
    enabled: isConnected,
  });

  const { data: costLineSearchResp, isFetching: costLineSearching } = useQuery<{
    costLines: AppCostLineSummary[];
  }>({
    queryKey: ["/api/quickbooks/cost-lines/search", costLineSearch],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/quickbooks/cost-lines/search?q=${encodeURIComponent(costLineSearch)}&limit=25`,
      );
      return res.json();
    },
    enabled: !!selectedBill,
  });

  const linkMutation = useMutation({
    mutationFn: async (input: { costLineId: number; projectId: number; bill: QbBillRaw; amountExVat: number }) => {
      const res = await apiRequest("POST", "/api/quickbooks/cost-allocations/bulk-assign", {
        projectId: input.projectId,
        billId: input.bill.Id,
        allocations: [{ costLineId: input.costLineId, amountExVat: input.amountExVat }],
      });
      return res.json();
    },
    onSuccess: () => {
      setSelectedBill(null);
      setCostLineSearch("");
      setAllocationDraft({});
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/links"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/cost-lines/search"] });
      toast({ title: "Bill linked to cost line" });
    },
    onError: (err: Error) => {
      const title = isApiError(err) && err.status === 409 ? "Over-assignment blocked" : "Link failed";
      toast({ title, description: err.message, variant: "destructive" });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (linkId: number) => {
      const res = await apiRequest("DELETE", `/api/quickbooks/links/${linkId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/links"] });
      toast({ title: "Link removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Unlink failed", description: err.message, variant: "destructive" });
    },
  });

  const bills = billsResp?.QueryResponse?.Bill ?? [];
  const links = linksResp?.links ?? [];
  const billLinks = useMemo(
    () => links.filter((l) => (l.qbEntityType ?? "bill") === "bill"),
    [links],
  );
  const linkedQbIds = useMemo(() => new Set(billLinks.map((l) => l.qbEntityId)), [billLinks]);
  const unlinkedBills = useMemo(() => bills.filter((b) => !linkedQbIds.has(b.Id)), [bills, linkedQbIds]);

  if (!isConnected) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground text-center">
          Connect QuickBooks to reconcile bills.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Card><CardContent className="p-3">
          <div className="text-[10px] text-muted-foreground">QB bills</div>
          <div className="text-lg font-semibold">{bills.length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] text-muted-foreground">Linked</div>
          <div className="text-lg font-semibold text-emerald-700">{billLinks.length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] text-muted-foreground">Unlinked</div>
          <div className="text-lg font-semibold text-amber-700">{unlinkedBills.length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] text-muted-foreground">Link coverage</div>
          <div className="text-lg font-semibold">
            {bills.length === 0 ? "—" : `${Math.round((billLinks.length / bills.length) * 100)}%`}
          </div>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="text-xs font-semibold mb-2 flex items-center gap-2">
            1. Pick a QuickBooks bill
            <Badge variant="outline" className="text-[10px]">{unlinkedBills.length} unlinked</Badge>
          </div>
          {unlinkedBills.length === 0 ? (
            <p className="text-xs text-muted-foreground">No unlinked QB bills.</p>
          ) : (
            <div className="overflow-x-auto max-h-72 border rounded">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-[10px] text-muted-foreground uppercase sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Bill #</th>
                    <th className="px-2 py-1.5 text-left">Date</th>
                    <th className="px-2 py-1.5 text-left">Vendor</th>
                    <th className="px-2 py-1.5 text-right">Inc VAT</th>
                    <th className="px-2 py-1.5 text-right">Ex VAT</th>
                    <th className="px-2 py-1.5 text-right">Balance</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {unlinkedBills.map((bill) => {
                    const isSelected = selectedBill?.Id === bill.Id;
                    const ex = (bill.TotalAmt ?? 0) - (bill.TxnTaxDetail?.TotalTax ?? 0);
                    return (
                      <tr
                        key={bill.Id}
                        className={`border-t cursor-pointer ${isSelected ? "bg-sky-50/70" : "hover:bg-muted/40"}`}
                        onClick={() => setSelectedBill(isSelected ? null : bill)}
                      >
                        <td className="px-2 py-1.5 font-medium">{bill.DocNumber ?? bill.Id}</td>
                        <td className="px-2 py-1.5">{bill.TxnDate ?? "—"}</td>
                        <td className="px-2 py-1.5">{bill.VendorRef?.name ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right">{formatRand(bill.TotalAmt)}</td>
                        <td className="px-2 py-1.5 text-right">{formatRand(ex)}</td>
                        <td className="px-2 py-1.5 text-right">{formatRand(bill.Balance)}</td>
                        <td className="px-2 py-1.5">
                          {isSelected && <Badge className="text-[9px] bg-sky-100 text-sky-800">Selected</Badge>}
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

      {selectedBill && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold flex items-center gap-2">
                2. Pick a project cost line
                <Badge variant="outline" className="text-[10px]">
                  {costLineSearchResp?.costLines.length ?? 0} candidates
                </Badge>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px]"
                onClick={() => { setSelectedBill(null); setCostLineSearch(""); }}
              >
                <X className="h-3 w-3 mr-1" /> Clear
              </Button>
            </div>
            <div className="relative">
              <Search className="h-3 w-3 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Search by project, invoice #, supplier, description…"
                value={costLineSearch}
                onChange={(e) => setCostLineSearch(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
            {costLineSearching && <div className="text-[10px] text-muted-foreground">Searching…</div>}
            <div className="overflow-x-auto max-h-72 border rounded">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-[10px] text-muted-foreground uppercase">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Project</th>
                    <th className="px-2 py-1.5 text-left">Invoice #</th>
                    <th className="px-2 py-1.5 text-left">Date</th>
                    <th className="px-2 py-1.5 text-left">Supplier</th>
                    <th className="px-2 py-1.5 text-right">Amount ex VAT</th>
                    <th className="px-2 py-1.5 text-right">Assign</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {(costLineSearchResp?.costLines ?? []).map((cost) => {
                    const exactMatch =
                      (cost.invoiceNumber ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase() ===
                      (selectedBill.DocNumber ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
                    return (
                      <tr key={cost.id} className="border-t hover:bg-muted/40">
                        <td className="px-2 py-1.5">{cost.projectName ?? `#${cost.projectId}`}</td>
                        <td className="px-2 py-1.5 font-medium">
                          {cost.invoiceNumber ?? "—"}
                          {exactMatch && (
                            <Badge className="ml-1 text-[9px] bg-green-100 text-green-700">match</Badge>
                          )}
                        </td>
                        <td className="px-2 py-1.5">{cost.invoiceDate ?? "—"}</td>
                        <td className="px-2 py-1.5">{cost.counterpartyName ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right">{formatRand(cost.amountExVat)}</td>
                        <td className="px-2 py-1.5 text-right">
                          <Input
                            className="h-6 text-[10px] w-24 ml-auto"
                            value={allocationDraft[cost.id] ?? ""}
                            placeholder={String(cost.amountExVat ?? "")}
                            onChange={(e) => setAllocationDraft((d) => ({ ...d, [cost.id]: e.target.value }))}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Button
                            size="sm"
                            className="h-6 text-[10px] gap-1"
                            disabled={linkMutation.isPending}
                            onClick={() =>
                              linkMutation.mutate({
                                costLineId: cost.id,
                                projectId: cost.projectId,
                                bill: selectedBill,
                                amountExVat: Number(allocationDraft[cost.id] || cost.amountExVat || 0),
                              })
                            }
                          >
                            <Link2 className="h-3 w-3" /> Link
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {!costLineSearching && (costLineSearchResp?.costLines.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={7} className="px-2 py-3 text-center text-muted-foreground">
                        {costLineSearch ? "No cost lines match." : "Type to search (or leave blank for most recent 50)."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-3">
          <div className="text-xs font-semibold mb-2 flex items-center gap-2">
            Existing bill links
            <Badge variant="outline" className="text-[10px]">{billLinks.length}</Badge>
          </div>
          {billLinks.length === 0 ? (
            <p className="text-xs text-muted-foreground">No bill links yet.</p>
          ) : (
            <div className="overflow-x-auto max-h-72 border rounded">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-[10px] text-muted-foreground uppercase sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Match</th>
                    <th className="px-2 py-1.5 text-left">Project</th>
                    <th className="px-2 py-1.5 text-left">App cost line</th>
                    <th className="px-2 py-1.5 text-left">QB bill</th>
                    <th className="px-2 py-1.5 text-left">Vendor</th>
                    <th className="px-2 py-1.5 text-right">QB amount</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {billLinks.map((link) => (
                    <tr key={link.id} className="border-t">
                      <td className="px-2 py-1.5">
                        <Badge variant="outline" className="text-[9px]">{link.matchType}</Badge>
                      </td>
                      <td className="px-2 py-1.5">{link.projectId ? `#${link.projectId}` : "—"}</td>
                      <td className="px-2 py-1.5 font-mono">#{link.appEntityId}</td>
                      <td className="px-2 py-1.5">
                        {link.qbDocNumber ?? link.qbEntityId}
                        {link.qbTxnDate && (
                          <span className="block text-[10px] text-muted-foreground">{link.qbTxnDate}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">{link.qbCounterpartyName ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right">{formatRand(link.qbAmount)}</td>
                      <td className="px-2 py-1.5 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] gap-1"
                          onClick={() => unlinkMutation.mutate(link.id)}
                          disabled={unlinkMutation.isPending}
                        >
                          <Link2Off className="h-3 w-3" /> Unlink
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ===================== Reconciliation — Invoices (Revenue) =====================

interface QbInvoiceRaw {
  Id: string;
  DocNumber?: string | null;
  TxnDate?: string | null;
  TotalAmt?: number | null;
  TxnTaxDetail?: { TotalTax?: number | null };
  Balance?: number | null;
  CustomerRef?: { name?: string | null; value?: string | null };
}

interface AppRevenueLineSummary {
  id: number;
  projectId: number;
  projectName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  paidDate?: string | null;
  amountExVat: number | null;
  description: string | null;
  status: string | null;
  milestoneName?: string | null;
}

function InvoicesReconciliationView({ isConnected }: { isConnected: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedInvoice, setSelectedInvoice] = useState<QbInvoiceRaw | null>(null);
  const [revenueSearch, setRevenueSearch] = useState("");

  const { data: invoicesResp } = useQuery<{ QueryResponse?: { Invoice?: QbInvoiceRaw[] } }>({
    queryKey: ["/api/quickbooks/invoices"],
    queryFn: async () => (await apiRequest("GET", "/api/quickbooks/invoices")).json(),
    enabled: isConnected,
  });

  const { data: linksResp } = useQuery<{ links: QuickBooksLinkRow[] }>({
    queryKey: ["/api/quickbooks/links"],
    queryFn: async () => (await apiRequest("GET", "/api/quickbooks/links")).json(),
    enabled: isConnected,
  });

  const { data: revenueSearchResp, isFetching: revenueSearching } = useQuery<{
    revenueLines: AppRevenueLineSummary[];
  }>({
    queryKey: ["/api/quickbooks/revenue-lines/search", revenueSearch],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/quickbooks/revenue-lines/search?q=${encodeURIComponent(revenueSearch)}&limit=25`,
      );
      return res.json();
    },
    enabled: !!selectedInvoice,
  });

  const linkMutation = useMutation({
    mutationFn: async (input: { revenueLineId: number; projectId: number; invoice: QbInvoiceRaw }) => {
      const res = await apiRequest("POST", "/api/quickbooks/revenue-links", {
        revenueLineId: input.revenueLineId,
        projectId: input.projectId,
        invoice: input.invoice,
        matchType: "manual",
      });
      return res.json();
    },
    onSuccess: () => {
      setSelectedInvoice(null);
      setRevenueSearch("");
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/links"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/revenue-lines/search"] });
      toast({ title: "Invoice linked to revenue line" });
    },
    onError: (err: Error) => {
      const title = isApiError(err) && err.status === 409 ? "Conflict" : "Link failed";
      toast({ title, description: err.message, variant: "destructive" });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (linkId: number) => {
      const res = await apiRequest("DELETE", `/api/quickbooks/links/${linkId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/links"] });
      toast({ title: "Link removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Unlink failed", description: err.message, variant: "destructive" });
    },
  });

  const invoices = invoicesResp?.QueryResponse?.Invoice ?? [];
  const links = linksResp?.links ?? [];
  const invoiceLinks = useMemo(
    () => links.filter((l) => l.qbEntityType === "invoice"),
    [links],
  );
  const linkedQbIds = useMemo(() => new Set(invoiceLinks.map((l) => l.qbEntityId)), [invoiceLinks]);
  const unlinkedInvoices = useMemo(
    () => invoices.filter((i) => !linkedQbIds.has(i.Id)),
    [invoices, linkedQbIds],
  );

  if (!isConnected) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground text-center">
          Connect QuickBooks to reconcile invoices.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Card><CardContent className="p-3">
          <div className="text-[10px] text-muted-foreground">QB invoices</div>
          <div className="text-lg font-semibold">{invoices.length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] text-muted-foreground">Linked</div>
          <div className="text-lg font-semibold text-emerald-700">{invoiceLinks.length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] text-muted-foreground">Unlinked</div>
          <div className="text-lg font-semibold text-amber-700">{unlinkedInvoices.length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] text-muted-foreground">Link coverage</div>
          <div className="text-lg font-semibold">
            {invoices.length === 0 ? "—" : `${Math.round((invoiceLinks.length / invoices.length) * 100)}%`}
          </div>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="text-xs font-semibold mb-2 flex items-center gap-2">
            1. Pick a QuickBooks invoice
            <Badge variant="outline" className="text-[10px]">{unlinkedInvoices.length} unlinked</Badge>
          </div>
          {unlinkedInvoices.length === 0 ? (
            <p className="text-xs text-muted-foreground">No unlinked QB invoices.</p>
          ) : (
            <div className="overflow-x-auto max-h-72 border rounded">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-[10px] text-muted-foreground uppercase sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Invoice #</th>
                    <th className="px-2 py-1.5 text-left">Date</th>
                    <th className="px-2 py-1.5 text-left">Customer</th>
                    <th className="px-2 py-1.5 text-right">Inc VAT</th>
                    <th className="px-2 py-1.5 text-right">Ex VAT</th>
                    <th className="px-2 py-1.5 text-right">Balance</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {unlinkedInvoices.map((inv) => {
                    const isSelected = selectedInvoice?.Id === inv.Id;
                    const ex = (inv.TotalAmt ?? 0) - (inv.TxnTaxDetail?.TotalTax ?? 0);
                    return (
                      <tr
                        key={inv.Id}
                        className={`border-t cursor-pointer ${isSelected ? "bg-sky-50/70" : "hover:bg-muted/40"}`}
                        onClick={() => setSelectedInvoice(isSelected ? null : inv)}
                      >
                        <td className="px-2 py-1.5 font-medium">{inv.DocNumber ?? inv.Id}</td>
                        <td className="px-2 py-1.5">{inv.TxnDate ?? "—"}</td>
                        <td className="px-2 py-1.5">{inv.CustomerRef?.name ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right">{formatRand(inv.TotalAmt)}</td>
                        <td className="px-2 py-1.5 text-right">{formatRand(ex)}</td>
                        <td className="px-2 py-1.5 text-right">{formatRand(inv.Balance)}</td>
                        <td className="px-2 py-1.5">
                          {isSelected && <Badge className="text-[9px] bg-sky-100 text-sky-800">Selected</Badge>}
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

      {selectedInvoice && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold flex items-center gap-2">
                2. Pick a project revenue line
                <Badge variant="outline" className="text-[10px]">
                  {revenueSearchResp?.revenueLines.length ?? 0} candidates
                </Badge>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[10px]"
                onClick={() => { setSelectedInvoice(null); setRevenueSearch(""); }}
              >
                <X className="h-3 w-3 mr-1" /> Clear
              </Button>
            </div>
            <div className="relative">
              <Search className="h-3 w-3 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Search by project, invoice #, description…"
                value={revenueSearch}
                onChange={(e) => setRevenueSearch(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
            {revenueSearching && <div className="text-[10px] text-muted-foreground">Searching…</div>}
            <div className="overflow-x-auto max-h-72 border rounded">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-[10px] text-muted-foreground uppercase">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Project</th>
                    <th className="px-2 py-1.5 text-left">Invoice #</th>
                    <th className="px-2 py-1.5 text-left">Date</th>
                    <th className="px-2 py-1.5 text-left">Description</th>
                    <th className="px-2 py-1.5 text-right">Amount ex VAT</th>
                    <th className="px-2 py-1.5 text-left">Status</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {(revenueSearchResp?.revenueLines ?? []).map((rev) => {
                    const exactMatch =
                      (rev.invoiceNumber ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase() ===
                      (selectedInvoice.DocNumber ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
                    return (
                      <tr key={rev.id} className="border-t hover:bg-muted/40">
                        <td className="px-2 py-1.5">{rev.projectName ?? `#${rev.projectId}`}</td>
                        <td className="px-2 py-1.5 font-medium">
                          {rev.invoiceNumber ?? "—"}
                          {exactMatch && (
                            <Badge className="ml-1 text-[9px] bg-green-100 text-green-700">match</Badge>
                          )}
                        </td>
                        <td className="px-2 py-1.5">{rev.invoiceDate ?? "—"}</td>
                        <td className="px-2 py-1.5 truncate max-w-[200px]">{rev.description ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right">{formatRand(rev.amountExVat)}</td>
                        <td className="px-2 py-1.5">
                          <Badge variant="outline" className="text-[9px]">{rev.status ?? "—"}</Badge>
                        </td>
                        <td className="px-2 py-1.5">
                          <Button
                            size="sm"
                            className="h-6 text-[10px] gap-1"
                            disabled={linkMutation.isPending}
                            onClick={() =>
                              linkMutation.mutate({
                                revenueLineId: rev.id,
                                projectId: rev.projectId,
                                invoice: selectedInvoice,
                              })
                            }
                          >
                            <Link2 className="h-3 w-3" /> Link
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {!revenueSearching && (revenueSearchResp?.revenueLines.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={7} className="px-2 py-3 text-center text-muted-foreground">
                        {revenueSearch ? "No revenue lines match." : "Type to search (or leave blank for most recent 50)."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-3">
          <div className="text-xs font-semibold mb-2 flex items-center gap-2">
            Existing invoice links
            <Badge variant="outline" className="text-[10px]">{invoiceLinks.length}</Badge>
          </div>
          {invoiceLinks.length === 0 ? (
            <p className="text-xs text-muted-foreground">No invoice links yet.</p>
          ) : (
            <div className="overflow-x-auto max-h-72 border rounded">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-[10px] text-muted-foreground uppercase sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Match</th>
                    <th className="px-2 py-1.5 text-left">Project</th>
                    <th className="px-2 py-1.5 text-left">App revenue line</th>
                    <th className="px-2 py-1.5 text-left">QB invoice</th>
                    <th className="px-2 py-1.5 text-left">Customer</th>
                    <th className="px-2 py-1.5 text-right">QB amount</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceLinks.map((link) => (
                    <tr key={link.id} className="border-t">
                      <td className="px-2 py-1.5">
                        <Badge variant="outline" className="text-[9px]">{link.matchType}</Badge>
                      </td>
                      <td className="px-2 py-1.5">{link.projectId ? `#${link.projectId}` : "—"}</td>
                      <td className="px-2 py-1.5 font-mono">#{link.appEntityId}</td>
                      <td className="px-2 py-1.5">
                        {link.qbDocNumber ?? link.qbEntityId}
                        {link.qbTxnDate && (
                          <span className="block text-[10px] text-muted-foreground">{link.qbTxnDate}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">{link.qbCounterpartyName ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right">{formatRand(link.qbAmount)}</td>
                      <td className="px-2 py-1.5 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] gap-1"
                          onClick={() => unlinkMutation.mutate(link.id)}
                          disabled={unlinkMutation.isPending}
                        >
                          <Link2Off className="h-3 w-3" /> Unlink
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ReconciliationTab({ isConnected }: { isConnected: boolean }) {
  const [sub, setSub] = useState<string>("bills");
  return (
    <div className="space-y-3">
      <Tabs value={sub} onValueChange={setSub}>
        <TabsList className="h-auto p-1 bg-muted/50">
          <TabsTrigger value="bills" className="gap-1.5 text-xs">
            <Banknote className="h-3 w-3" /> Bills (COS)
          </TabsTrigger>
          <TabsTrigger value="invoices" className="gap-1.5 text-xs">
            <Receipt className="h-3 w-3" /> Invoices (Revenue)
          </TabsTrigger>
        </TabsList>
        <TabsContent value="bills" className="mt-3">
          <BillsReconciliationView isConnected={isConnected} />
        </TabsContent>
        <TabsContent value="invoices" className="mt-3">
          <InvoicesReconciliationView isConnected={isConnected} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MappingTab({ isConnected }: { isConnected: boolean }) {
  const [sub, setSub] = useState<string>("customers");
  return (
    <div className="space-y-3">
      <Tabs value={sub} onValueChange={setSub}>
        <TabsList className="h-auto p-1 bg-muted/50">
          <TabsTrigger value="customers" className="gap-1.5 text-xs">
            <Building2 className="h-3 w-3" /> Customers → Projects
          </TabsTrigger>
          <TabsTrigger value="vendors" className="gap-1.5 text-xs">
            <Users className="h-3 w-3" /> Vendors → Suppliers
          </TabsTrigger>
        </TabsList>
        <TabsContent value="customers" className="mt-3">
          <CustomersMappingView isConnected={isConnected} />
        </TabsContent>
        <TabsContent value="vendors" className="mt-3">
          <VendorsMappingView isConnected={isConnected} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function FinanceQuickBooksThroughputPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<string>("connection");

  const { data: status, isLoading: statusLoading } = useQuery<QuickBooksStatus>({
    queryKey: ["/api/quickbooks/status"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/quickbooks/status");
      return res.json();
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/quickbooks/sync-now");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "QuickBooks sync triggered", description: "Pulling latest bills, invoices, customers and vendors." });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/sync-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/bills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/customers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/vendors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cos-tracker"] });
      queryClient.invalidateQueries({ queryKey: ["/api/revenue-tracker"] });
      invalidateDashboardQueries(queryClient);
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  // Surface OAuth callback result as a toast, then strip the query string.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("quickbooks");
    if (!flag) return;
    if (flag === "connected") {
      toast({ title: "QuickBooks connected", description: "OAuth flow completed." });
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/status"] });
    } else if (flag === "error") {
      toast({
        title: "QuickBooks connection failed",
        description: params.get("message") || "See logs for details.",
        variant: "destructive",
      });
    }
    params.delete("quickbooks");
    params.delete("message");
    const qs = params.toString();
    const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    window.history.replaceState({}, "", nextUrl);
  }, [toast, queryClient]);

  if (statusLoading) return <FinanceShell><PageSkeleton lines={5} /></FinanceShell>;

  const isConnected = status?.connected ?? false;

  return (
    <FinanceShell>
      <div className="space-y-4">
        {/* Header — connection state + Sync Now */}
        <Card>
          <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                <Plug className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <div className="text-base font-semibold">QuickBooks Throughput</div>
                <div className="text-xs text-muted-foreground">
                  {isConnected
                    ? `Connected to ${status?.companyName ?? "QuickBooks"} · Last sync ${status?.lastSuccessfulSyncAt ? formatRelativeAge(status.ageMs) : "never"}`
                    : "Not connected"}
                </div>
              </div>
            </div>
            {isConnected && (
              <Button
                size="sm"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className="gap-1.5"
                data-testid="qb-sync-now"
              >
                {syncMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Sync Now
              </Button>
            )}
          </CardContent>
        </Card>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-auto p-1 bg-muted/60">
            <TabsTrigger value="connection" className="gap-1.5">
              <Activity className="h-3.5 w-3.5" /> Connection
            </TabsTrigger>
            <TabsTrigger value="mapping" className="gap-1.5">
              <Building2 className="h-3.5 w-3.5" /> Mapping
            </TabsTrigger>
            <TabsTrigger value="reconciliation" className="gap-1.5">
              <Link2 className="h-3.5 w-3.5" /> Reconciliation
            </TabsTrigger>
            <TabsTrigger value="suppliers" className="gap-1.5">
              <Users className="h-3.5 w-3.5" /> Suppliers
            </TabsTrigger>
            <TabsTrigger value="log" className="gap-1.5">
              <History className="h-3.5 w-3.5" /> Sync Log
            </TabsTrigger>
          </TabsList>

          <TabsContent value="connection" className="mt-4">
            <ConnectionTab status={status} />
          </TabsContent>

          <TabsContent value="mapping" className="mt-4">
            <MappingTab isConnected={isConnected} />
          </TabsContent>

          <TabsContent value="reconciliation" className="mt-4">
            <ReconciliationTab isConnected={isConnected} />
          </TabsContent>

          <TabsContent value="suppliers" className="mt-4">
            <SuppliersTab isConnected={isConnected} />
          </TabsContent>

          <TabsContent value="log" className="mt-4">
            <SyncLogTab />
          </TabsContent>
        </Tabs>
      </div>
    </FinanceShell>
  );
}
