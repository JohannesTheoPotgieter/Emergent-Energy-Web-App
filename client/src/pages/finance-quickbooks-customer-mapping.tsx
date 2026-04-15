import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { PageSkeleton } from "@/components/ui/page-states";
import { useToast } from "@/hooks/use-toast";
import { Link2, Link2Off, Plug, Search, Users } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { ReportTrustNotice } from "@/components/reports/ReportTrustNotice";

interface ProjectMapping {
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

interface QbCustomerRaw {
  Id: string;
  DisplayName?: string;
  CompanyName?: string;
  Active?: boolean;
  PrimaryEmailAddr?: { Address?: string };
}

interface QuickBooksStatus {
  connected: boolean;
  companyName: string | null;
  sandbox: boolean;
  lastSuccessfulSyncAt?: string | null;
  isStale?: boolean;
}

export default function FinanceQuickBooksCustomerMappingPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [projectFilter, setProjectFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  // projectId currently being edited (shows customer picker for that row).
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);

  const { data: status, isLoading: statusLoading } = useQuery<QuickBooksStatus>({
    queryKey: ["/api/quickbooks/status"],
    queryFn: async () => (await apiRequest("GET", "/api/quickbooks/status")).json(),
  });

  const { data: mappingResp } = useQuery<{ projects: ProjectMapping[] }>({
    queryKey: ["/api/quickbooks/customer-mappings"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/quickbooks/customer-mappings")).json(),
  });

  const { data: customersResp } = useQuery<{ QueryResponse?: { Customer?: QbCustomerRaw[] } }>({
    queryKey: ["/api/quickbooks/customers"],
    queryFn: async () => (await apiRequest("GET", "/api/quickbooks/customers")).json(),
    enabled: !!status?.connected,
  });

  const saveMutation = useMutation({
    mutationFn: async (input: {
      projectId: number;
      qbCustomerId: string;
      qbCustomerName: string;
    }) => {
      const res = await apiRequest("POST", "/api/quickbooks/customer-mappings", input);
      return res.json();
    },
    onSuccess: () => {
      setEditingProjectId(null);
      setCustomerFilter("");
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/customer-mappings"] });
      toast({ title: "Mapping saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (mappingId: number) => {
      const res = await apiRequest("DELETE", `/api/quickbooks/customer-mappings/${mappingId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/customer-mappings"] });
      toast({ title: "Mapping cleared" });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const projects = mappingResp?.projects ?? [];
  const customers = customersResp?.QueryResponse?.Customer ?? [];

  const filteredProjects = useMemo(() => {
    const q = projectFilter.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) =>
      p.projectName.toLowerCase().includes(q) ||
      p.mapping?.qbCustomerName?.toLowerCase().includes(q),
    );
  }, [projects, projectFilter]);

  const filteredCustomers = useMemo(() => {
    const q = customerFilter.trim().toLowerCase();
    const active = customers.filter((c) => c.Active !== false);
    if (!q) return active;
    return active.filter((c) =>
      (c.DisplayName ?? c.CompanyName ?? "").toLowerCase().includes(q),
    );
  }, [customers, customerFilter]);

  if (statusLoading) return <PageSkeleton lines={6} />;

  if (!status?.connected) {
    return (
      <PageShell className="p-4 md:p-6">
        <SectionHeader
          icon={<Users className="h-5 w-5" />}
          eyebrow="Finance"
          title="QuickBooks Customer Mapping"
          description="Map each app project to its QuickBooks customer so invoices auto-scope per project"
        />
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="p-4 text-xs text-amber-800 flex items-start gap-2">
            <Plug className="h-4 w-4 mt-0.5" />
            <div>
              QuickBooks is not connected. Go to{" "}
              <a href="/admin/quickbooks" className="underline font-medium">
                Admin → QuickBooks
              </a>
              {" "}to connect first.
            </div>
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const mappedCount = projects.filter((p) => p.mapping).length;

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-finance-quickbooks-customer-mapping">
      <SectionHeader
        icon={<Users className="h-5 w-5" />}
        eyebrow="Finance"
        title="QuickBooks Customer Mapping"
        description="Map each app project to its QuickBooks customer so invoices reconcile cleanly per project"
      />

      <ReportTrustNotice
        sourceLabel="QB customers (evidence) ↔ app projects (truth)"
        lastUpdatedAt={status.lastSuccessfulSyncAt ?? null}
        note="Mapping a project to a QB customer scopes revenue-side reconciliation to that customer's QuickBooks invoices. The mapping itself is metadata only — it does not move money, recognise revenue, or alter cost lines."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <SummaryCard label="Projects" value={projects.length} />
        <SummaryCard label="Mapped" value={mappedCount} tone="emerald" />
        <SummaryCard label="Unmapped" value={projects.length - mappedCount} tone="amber" />
        <SummaryCard label="QB customers" value={customers.length} />
      </div>

      <Card>
        <CardContent className="p-3 flex items-center gap-2">
          <Search className="h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Filter projects by name or mapped customer"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="h-8 text-xs"
          />
          {status.sandbox && <Badge variant="outline" className="text-[10px]">Sandbox</Badge>}
          {status.companyName && (
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              QB: {status.companyName}
            </span>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-[10px] text-muted-foreground uppercase">
              <tr>
                <th className="px-2 py-1.5 text-left">Project</th>
                <th className="px-2 py-1.5 text-left">Client</th>
                <th className="px-2 py-1.5 text-left">QB Customer</th>
                <th className="px-2 py-1.5 text-left">Updated</th>
                <th className="px-2 py-1.5 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((project) => {
                const isEditing = editingProjectId === project.projectId;
                return (
                  <>
                    <tr
                      key={project.projectId}
                      className={`border-t ${isEditing ? "bg-sky-50/40" : ""}`}
                    >
                      <td className="px-2 py-1.5 font-medium">
                        <a
                          href={`/projects/${encodeURIComponent(project.projectName)}`}
                          className="hover:underline"
                        >
                          {project.projectName}
                        </a>
                        <div className="text-[10px] text-muted-foreground">
                          #{project.projectId}
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        {project.clientId ? (
                          <span className="text-[10px] text-muted-foreground">
                            client #{project.clientId}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        {project.mapping ? (
                          <div>
                            <div className="font-medium">{project.mapping.qbCustomerName ?? "—"}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">
                              QB #{project.mapping.qbCustomerId}
                            </div>
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-[9px] text-amber-700 bg-amber-50">
                            Unmapped
                          </Badge>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-[10px] text-muted-foreground">
                        {project.mapping
                          ? new Date(project.mapping.updatedAt).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant={isEditing ? "default" : "outline"}
                            className="h-6 text-[10px] gap-1"
                            onClick={() => {
                              setEditingProjectId(isEditing ? null : project.projectId);
                              setCustomerFilter("");
                            }}
                          >
                            <Link2 className="h-3 w-3" />
                            {project.mapping ? "Change" : "Map"}
                          </Button>
                          {project.mapping && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[10px] gap-1 text-muted-foreground"
                              onClick={() => deleteMutation.mutate(project.mapping!.id)}
                              disabled={deleteMutation.isPending}
                            >
                              <Link2Off className="h-3 w-3" />
                              Clear
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isEditing && (
                      <tr className="border-t bg-sky-50/20">
                        <td colSpan={5} className="px-2 py-2">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <Search className="h-3 w-3 text-muted-foreground" />
                              <Input
                                placeholder="Search QuickBooks customers"
                                value={customerFilter}
                                onChange={(e) => setCustomerFilter(e.target.value)}
                                className="h-7 text-xs"
                                autoFocus
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[10px]"
                                onClick={() => setEditingProjectId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                            <div className="max-h-64 overflow-y-auto border rounded">
                              {filteredCustomers.length === 0 && (
                                <div className="p-2 text-[10px] text-muted-foreground">
                                  No matching QuickBooks customers.
                                </div>
                              )}
                              {filteredCustomers.slice(0, 50).map((cust) => (
                                <button
                                  key={cust.Id}
                                  type="button"
                                  className="w-full text-left px-2 py-1.5 hover:bg-muted/60 flex items-center gap-2 border-b last:border-0"
                                  onClick={() =>
                                    saveMutation.mutate({
                                      projectId: project.projectId,
                                      qbCustomerId: cust.Id,
                                      qbCustomerName:
                                        cust.DisplayName ?? cust.CompanyName ?? cust.Id,
                                    })
                                  }
                                  disabled={saveMutation.isPending}
                                >
                                  <Users className="h-3 w-3 text-muted-foreground" />
                                  <div className="flex-1">
                                    <div className="text-xs font-medium">
                                      {cust.DisplayName ?? cust.CompanyName ?? "Unnamed"}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">
                                      QB #{cust.Id}
                                      {cust.PrimaryEmailAddr?.Address && (
                                        <> · {cust.PrimaryEmailAddr.Address}</>
                                      )}
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
              {filteredProjects.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">
                    No projects match your filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </PageShell>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "amber"
        ? "text-amber-700"
        : "text-foreground";
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className={`text-lg font-semibold ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
