import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as WouterLink } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { useToast } from "@/hooks/use-toast";
import { Link as LinkIcon, Loader2, AlertTriangle, Unlink } from "lucide-react";
import { PageError, PageSkeleton } from "@/components/ui/page-states";
import { apiRequest } from "@/lib/queryClient";

type OrphanRow = {
  workItemId: number;
  workItemTitle: string;
  workItemStatus: string | null;
  workItemPhase: string | null;
  ownerName: string | null;
  projectId: number | null;
  projectName: string | null;
  pdTicketId: number | null;
  pdTicketDeleted: boolean;
  pdTicketRequestType: string | null;
  reason: "missing" | "soft_deleted" | "unlinked";
};

type LiveTicketChoice = {
  id: number;
  requestType: string;
  status: string;
  dueDate: string | null;
};

type OrphanResponse = {
  generatedAt: string;
  counts: { brokenLink: number; unlinkedButProjectHasTickets: number; total: number };
  rows: OrphanRow[];
  ticketChoicesByProject: Record<string, LiveTicketChoice[]>;
};

const REASON_LABEL: Record<OrphanRow["reason"], string> = {
  missing: "Linked ticket no longer exists",
  soft_deleted: "Linked ticket was soft-deleted",
  unlinked: "Project has live tickets but this work item is not linked",
};

export default function AdminWorkItemLinkagePage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [picks, setPicks] = useState<Record<number, number | undefined>>({});

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<OrphanResponse>({
    queryKey: ["/api/admin/work-item-linkage/orphans"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/work-item-linkage/orphans");
      return res.json();
    },
  });

  const relink = useMutation({
    mutationFn: async (params: { workItemId: number; pdTicketId: number }) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/work-item-linkage/${params.workItemId}/relink`,
        { pdTicketId: params.pdTicketId },
      );
      return res.json();
    },
    onSuccess: (_, vars) => {
      toast({
        title: "Work item re-linked",
        description: `Work item #${vars.workItemId} now points at ticket #${vars.pdTicketId}.`,
      });
      qc.invalidateQueries({ queryKey: ["/api/admin/work-item-linkage/orphans"] });
      qc.invalidateQueries({ queryKey: ["/api/project-development/workspace/rollup"] });
    },
    onError: (err: Error) =>
      toast({ title: "Re-link failed", description: err.message, variant: "destructive" }),
  });

  const standalone = useMutation({
    mutationFn: async (workItemId: number) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/work-item-linkage/${workItemId}/standalone`,
        {},
      );
      return res.json();
    },
    onSuccess: (_, workItemId) => {
      toast({
        title: "Converted to standalone",
        description: `Work item #${workItemId} is no longer linked to any PD ticket.`,
      });
      qc.invalidateQueries({ queryKey: ["/api/admin/work-item-linkage/orphans"] });
      qc.invalidateQueries({ queryKey: ["/api/project-development/workspace/rollup"] });
    },
    onError: (err: Error) =>
      toast({ title: "Convert failed", description: err.message, variant: "destructive" }),
  });

  const grouped = useMemo(() => {
    if (!data) return [] as Array<{ key: string; projectId: number | null; projectName: string | null; rows: OrphanRow[] }>;
    const map = new Map<string, { key: string; projectId: number | null; projectName: string | null; rows: OrphanRow[] }>();
    for (const row of data.rows) {
      const key = row.projectId == null ? "no-project" : String(row.projectId);
      const existing = map.get(key) ?? {
        key,
        projectId: row.projectId,
        projectName: row.projectName,
        rows: [],
      };
      existing.rows.push(row);
      map.set(key, existing);
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.projectName || "").localeCompare(b.projectName || ""),
    );
  }, [data]);

  if (isLoading) return <PageSkeleton lines={6} />;
  if (isError) {
    return (
      <PageShell className="p-4 md:p-6">
        <PageError
          title="Unable to load orphan work items"
          message={error instanceof Error ? error.message : "Failed to fetch data"}
          onRetry={() => refetch()}
        />
      </PageShell>
    );
  }
  if (!data) return null;

  return (
    <PageShell className="p-4 md:p-6" data-testid="page-admin-work-item-linkage">
      <SectionHeader
        icon={<LinkIcon className="h-5 w-5" />}
        eyebrow="Admin · Spine repair"
        title="Work item linkage"
        description="Inspect and repair work_items whose PD ticket pointer is missing, soft-deleted, or never set despite live tickets on the project."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="linkage-counts">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Broken pointer</p>
            <p className="text-2xl font-semibold" data-testid="count-broken">{data.counts.brokenLink}</p>
            <p className="text-[10px] text-muted-foreground">work_items.pd_ticket_id → missing or soft-deleted ticket</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Unlinked but project has tickets</p>
            <p className="text-2xl font-semibold" data-testid="count-unlinked">{data.counts.unlinkedButProjectHasTickets}</p>
            <p className="text-[10px] text-muted-foreground">work_items.pd_ticket_id IS NULL on a project that still has live PD tickets</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Total to review</p>
              <p className="text-2xl font-semibold" data-testid="count-total">{data.counts.total}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-refresh"
            >
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {grouped.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground" data-testid="empty-state">
            No orphan work_items detected. Spine is healthy.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map((g) => {
            const choices = g.projectId != null ? data.ticketChoicesByProject[String(g.projectId)] ?? [] : [];
            return (
              <Card key={g.key} data-testid={`group-project-${g.projectId ?? "none"}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-semibold">
                        {g.projectName ? (
                          <WouterLink href={`/project/${encodeURIComponent(g.projectName)}`} className="hover:underline" data-testid={`link-project-${g.projectId}`}>
                            {g.projectName}
                          </WouterLink>
                        ) : (
                          <span className="text-muted-foreground">No project</span>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {g.rows.length} orphan work item{g.rows.length === 1 ? "" : "s"} · {choices.length} live ticket{choices.length === 1 ? "" : "s"} available for re-link
                      </p>
                    </div>
                    {choices.length === 0 && g.projectId != null && (
                      <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300">
                        <AlertTriangle className="h-3 w-3" /> No live tickets — convert to standalone
                      </Badge>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs" data-testid={`table-orphans-${g.projectId ?? "none"}`}>
                      <thead>
                        <tr className="text-left text-muted-foreground border-b">
                          <th className="py-2 pr-3">Work item</th>
                          <th className="py-2 pr-3">Status / Phase</th>
                          <th className="py-2 pr-3">Owner</th>
                          <th className="py-2 pr-3">Reason</th>
                          <th className="py-2 pr-3">Re-link to ticket</th>
                          <th className="py-2 pr-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((row) => {
                          const pickedTicket = picks[row.workItemId];
                          const isBusy = relink.isPending || standalone.isPending;
                          return (
                            <tr key={row.workItemId} className="border-b align-top" data-testid={`row-orphan-${row.workItemId}`}>
                              <td className="py-2 pr-3">
                                <div className="font-medium">{row.workItemTitle || `Work item #${row.workItemId}`}</div>
                                <div className="text-[10px] text-muted-foreground">#{row.workItemId}{row.pdTicketId ? ` · was → ticket #${row.pdTicketId}` : ""}</div>
                              </td>
                              <td className="py-2 pr-3">
                                <div>{row.workItemStatus || "—"}</div>
                                <div className="text-[10px] text-muted-foreground">{row.workItemPhase || ""}</div>
                              </td>
                              <td className="py-2 pr-3 text-muted-foreground">{row.ownerName || "—"}</td>
                              <td className="py-2 pr-3">
                                <Badge variant={row.reason === "unlinked" ? "secondary" : "destructive"} className="text-[10px]" data-testid={`badge-reason-${row.workItemId}`}>
                                  {REASON_LABEL[row.reason]}
                                </Badge>
                              </td>
                              <td className="py-2 pr-3 min-w-[220px]">
                                {choices.length === 0 ? (
                                  <span className="text-[11px] text-muted-foreground">No live tickets</span>
                                ) : (
                                  <Select
                                    value={pickedTicket ? String(pickedTicket) : ""}
                                    onValueChange={(v) => setPicks((prev) => ({ ...prev, [row.workItemId]: Number(v) }))}
                                  >
                                    <SelectTrigger className="h-8 text-xs" data-testid={`select-ticket-${row.workItemId}`}>
                                      <SelectValue placeholder="Pick a live ticket…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {choices.map((t) => (
                                        <SelectItem key={t.id} value={String(t.id)} data-testid={`option-ticket-${row.workItemId}-${t.id}`}>
                                          #{t.id} · {t.requestType} · {t.status}{t.dueDate ? ` · due ${t.dueDate}` : ""}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                              </td>
                              <td className="py-2 pr-3 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <Button
                                    size="sm"
                                    variant="default"
                                    disabled={!pickedTicket || isBusy}
                                    onClick={() => {
                                      if (!pickedTicket) return;
                                      relink.mutate({ workItemId: row.workItemId, pdTicketId: pickedTicket });
                                    }}
                                    data-testid={`button-relink-${row.workItemId}`}
                                  >
                                    {relink.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <LinkIcon className="h-3 w-3" />}
                                    <span className="ml-1">Re-link</span>
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={isBusy || row.reason === "unlinked"}
                                    onClick={() => standalone.mutate(row.workItemId)}
                                    data-testid={`button-standalone-${row.workItemId}`}
                                  >
                                    {standalone.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
                                    <span className="ml-1">Standalone</span>
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground text-right" data-testid="generated-at">
        Snapshot generated {new Date(data.generatedAt).toLocaleString()}
      </p>
    </PageShell>
  );
}
