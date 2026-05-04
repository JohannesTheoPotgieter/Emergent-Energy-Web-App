/**
 * Excel-vs-App per-project diff page.
 *
 * Three sections (Plan / Revenue / Expenditure) showing every drifted
 * field. Per-row checkbox selection enables bulk actions:
 *   - Accept Excel       — clear the manual_overrides entry; live
 *                          column was already at Excel-truth, so the
 *                          field reverts automatically.
 *   - Keep app + reason  — record the live value as a manual override
 *                          with the operator-supplied reason.
 *   - Request approval   — file a financial_edit_requests row routed
 *                          to the section's resolvers.
 *
 * The server enforces per-section RBAC.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, AlertTriangle, CheckCircle2, RotateCcw, MailQuestion, RefreshCw } from "lucide-react";
import { styleForCell } from "@/lib/tracker-cell-format";

type DiffSection = "PLAN" | "REVENUE" | "EXPENDITURE";
type SectionTable = "normalized_cost_lines" | "normalized_revenue_lines" | "work_items";

interface DriftRowField {
  fieldName: string;
  liveValue: unknown;
  snapshotValue: unknown;
  overrideValue: unknown;
  overrideEditor: number | null;
  overrideEditedAt: string | null;
  overrideReason: string | null;
  cellFormat: { font?: string | null; fill?: string | null; bold?: boolean | null } | null;
  drift: "none" | "verified" | "unverified";
}

interface DriftRow {
  id: number;
  rowHash: string | null;
  displayLabel: string;
  sourceRow: number | null;
  fields: DriftRowField[];
}

interface DriftDetailResponse {
  projectId: number;
  projectName: string | null;
  costLines: DriftRow[];
  revenueLines: DriftRow[];
  planTasks: DriftRow[];
  legacyRowsWithoutSnapshot: {
    EXPENDITURE: number;
    REVENUE: number;
    PLAN: number;
  };
  summary: {
    EXPENDITURE: { verified: number; unverified: number };
    REVENUE:     { verified: number; unverified: number };
    PLAN:        { verified: number; unverified: number };
  };
}

interface SelectedEntry {
  table: SectionTable;
  rowId: number;
  fieldName: string;
}


const SECTION_TO_TABLE: Record<DiffSection, SectionTable> = {
  PLAN: "work_items",
  REVENUE: "normalized_revenue_lines",
  EXPENDITURE: "normalized_cost_lines",
};

const SECTION_LABEL: Record<DiffSection, string> = {
  PLAN: "Plan / Schedule",
  REVENUE: "Revenue / Milestones",
  EXPENDITURE: "Costs / Expenses",
};

export function ExcelVsAppProjectContent({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Map<string, SelectedEntry>>(new Map());
  const [filter, setFilter] = useState<"all" | "unverified" | "verified">("unverified");
  const [sectionFilter, setSectionFilter] = useState<"all" | DiffSection>("all");
  const [reasonOpen, setReasonOpen] = useState<{ action: "keep_app" | "request_approval"; section?: DiffSection } | null>(null);
  const [reason, setReason] = useState("");

  const { data, isLoading, isError, error, dataUpdatedAt, isFetching } = useQuery<DriftDetailResponse>({
    queryKey: ["excel-vs-app-project", projectId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/excel-vs-app/projects/${projectId}`);
      if (!res.ok) throw new Error(await res.text() || "Failed to load drift detail");
      return res.json();
    },
    enabled: Number.isFinite(projectId) && projectId > 0,
  });

  function handleRefresh() {
    queryClient.invalidateQueries({ queryKey: ["excel-vs-app-project", projectId] });
    queryClient.invalidateQueries({ queryKey: ["financial-edit-requests"] });
  }

  // Project-level pending financial_edit_requests queue. Includes
  // requests filed by this diff page's "Request approval" action AND
  // any other PM-Site-style cost/revenue overrides awaiting approval
  // for the project. Single queue for the project's financial edits.
  const projectName = data?.projectName ?? null;
  const pendingRequestsQuery = useQuery<any[]>({
    queryKey: ["financial-edit-requests", projectName, "pending"],
    queryFn: async () => {
      if (!projectName) return [];
      const url = `/api/financial-edit-requests?projectName=${encodeURIComponent(projectName)}&status=pending`;
      const res = await apiRequest("GET", url);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectName,
  });

  const resolveMutation = useMutation({
    mutationFn: async (body: object) => {
      const res = await apiRequest("POST", `/api/excel-vs-app/projects/${projectId}/resolve`, body);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as any)?.message || (json as any)?.error || "Resolution failed");
      return json;
    },
    onSuccess: (json: any) => {
      if (json?.status === "pending_approval") {
        toast({ title: "Approval requested", description: `Submitted ${json.submitted} entr${json.submitted === 1 ? "y" : "ies"} for approval.` });
      } else {
        toast({ title: "Drift resolved", description: `${json.resolved} entr${json.resolved === 1 ? "y" : "ies"} ${json.action === "accept_excel" ? "accepted Excel" : "kept app value"}.` });
      }
      setSelected(new Map());
      setReason("");
      setReasonOpen(null);
      queryClient.invalidateQueries({ queryKey: ["excel-vs-app-project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["excel-vs-app-program"] });
      queryClient.invalidateQueries({ queryKey: ["financial-edit-requests"] });
    },
    onError: (e: unknown) => {
      toast({ title: "Resolution failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    },
  });

  const sections: { key: DiffSection; label: string; rows: DriftRow[]; summary?: { verified: number; unverified: number } }[] = useMemo(() => {
    if (!data) return [];
    return [
      { key: "PLAN", label: SECTION_LABEL.PLAN, rows: data.planTasks, summary: data.summary.PLAN },
      { key: "REVENUE", label: SECTION_LABEL.REVENUE, rows: data.revenueLines, summary: data.summary.REVENUE },
      { key: "EXPENDITURE", label: SECTION_LABEL.EXPENDITURE, rows: data.costLines, summary: data.summary.EXPENDITURE },
    ];
  }, [data]);

  const selectedBySection = useMemo(() => {
    const out: Record<DiffSection, SelectedEntry[]> = { PLAN: [], REVENUE: [], EXPENDITURE: [] };
    for (const e of selected.values()) {
      if (e.table === "work_items") out.PLAN.push(e);
      else if (e.table === "normalized_revenue_lines") out.REVENUE.push(e);
      else if (e.table === "normalized_cost_lines") out.EXPENDITURE.push(e);
    }
    return out;
  }, [selected]);

  function entryKey(table: SectionTable, rowId: number, fieldName: string): string {
    return `${table}::${rowId}::${fieldName}`;
  }

  function toggleEntry(table: SectionTable, rowId: number, fieldName: string) {
    const key = entryKey(table, rowId, fieldName);
    const next = new Map(selected);
    if (next.has(key)) next.delete(key);
    else next.set(key, { table, rowId, fieldName });
    setSelected(next);
  }

  function toggleAllInSection(sectionKey: DiffSection, visibleEntries: Array<{ table: SectionTable; rowId: number; fieldName: string }>) {
    const next = new Map(selected);
    const allSelected = visibleEntries.every(e => next.has(entryKey(e.table, e.rowId, e.fieldName)));
    if (allSelected) {
      for (const e of visibleEntries) next.delete(entryKey(e.table, e.rowId, e.fieldName));
    } else {
      for (const e of visibleEntries) next.set(entryKey(e.table, e.rowId, e.fieldName), e);
    }
    setSelected(next);
  }

  function clearSelection() {
    setSelected(new Map());
  }

  function handleSelectAllUnverified(entries: SelectedEntry[]) {
    setSelected(prev => {
      const next = new Map(prev);
      for (const e of entries) {
        next.set(entryKey(e.table, e.rowId, e.fieldName), e);
      }
      return next;
    });
  }

  function submitAcceptExcel() {
    if (selected.size === 0) return;
    resolveMutation.mutate({
      action: "accept_excel",
      entries: Array.from(selected.values()),
    });
  }

  function openKeepApp() {
    if (selected.size === 0) return;
    setReason("");
    setReasonOpen({ action: "keep_app" });
  }

  function openRequestApproval(section: DiffSection) {
    const entries = selectedBySection[section];
    if (entries.length === 0) return;
    setReason("");
    setReasonOpen({ action: "request_approval", section });
  }

  function submitReason() {
    if (!reasonOpen || reason.trim().length < 3) {
      toast({ title: "Reason required", description: "Please provide at least 3 characters.", variant: "destructive" });
      return;
    }
    if (reasonOpen.action === "keep_app") {
      resolveMutation.mutate({
        action: "keep_app",
        reason: reason.trim(),
        entries: Array.from(selected.values()),
      });
    } else if (reasonOpen.action === "request_approval" && reasonOpen.section) {
      resolveMutation.mutate({
        action: "request_approval",
        section: reasonOpen.section,
        reason: reason.trim(),
        entries: selectedBySection[reasonOpen.section],
      });
    }
  }

  if (!Number.isFinite(projectId) || projectId <= 0) {
    return (
      <div className="py-6">
        <p className="text-sm text-red-600">Invalid project id.</p>
      </div>
    );
  }

  const totalSelected = selected.size;

  return (
    <div className="space-y-6" data-testid="excel-vs-app-content">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <p className="text-sm text-muted-foreground max-w-2xl">
            Live state vs the most recent Tracker workbook. Pick rows where the live value disagrees and either accept the Excel value, keep the app value with a reason, or request approval to push the change back to Excel.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <FilterTab active={filter === "unverified"} onClick={() => setFilter("unverified")} data-testid="drift-filter-unverified">Unverified only</FilterTab>
            <FilterTab active={filter === "verified"} onClick={() => setFilter("verified")} data-testid="drift-filter-verified">Verified</FilterTab>
            <FilterTab active={filter === "all"} onClick={() => setFilter("all")} data-testid="drift-filter-all">All drift</FilterTab>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching} data-testid="btn-refresh">
              <RefreshCw className={"h-3.5 w-3.5 mr-1 " + (isFetching ? "animate-spin" : "")} /> Refresh
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground mr-1">Section:</span>
            <FilterTab active={sectionFilter === "all"} onClick={() => setSectionFilter("all")} data-testid="section-filter-all">All</FilterTab>
            <FilterTab active={sectionFilter === "PLAN"} onClick={() => setSectionFilter("PLAN")} data-testid="section-filter-plan">Plan</FilterTab>
            <FilterTab active={sectionFilter === "REVENUE"} onClick={() => setSectionFilter("REVENUE")} data-testid="section-filter-revenue">Revenue</FilterTab>
            <FilterTab active={sectionFilter === "EXPENDITURE"} onClick={() => setSectionFilter("EXPENDITURE")} data-testid="section-filter-expenditure">Expenditure</FilterTab>
          </div>
          {dataUpdatedAt > 0 && (
            <span className="text-[11px] text-muted-foreground">
              Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <BackfillBanner legacyCounts={data?.legacyRowsWithoutSnapshot} />

      <PendingRequestsPanel
        requests={pendingRequestsQuery.data ?? []}
        projectName={projectName ?? undefined}
      />

      {totalSelected > 0 && (
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="p-4 flex items-center justify-between gap-4">
            <div className="text-sm">
              <span className="font-semibold">{totalSelected}</span> field{totalSelected === 1 ? "" : "s"} selected
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="default" onClick={submitAcceptExcel} disabled={resolveMutation.isPending}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Accept Excel ({totalSelected})
              </Button>
              <Button size="sm" variant="secondary" onClick={openKeepApp} disabled={resolveMutation.isPending}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Keep app + reason
              </Button>
              {(["PLAN", "REVENUE", "EXPENDITURE"] as DiffSection[]).map((sec) =>
                selectedBySection[sec].length > 0 ? (
                  <Button key={sec} size="sm" variant="outline" onClick={() => openRequestApproval(sec)} disabled={resolveMutation.isPending}>
                    <MailQuestion className="h-3.5 w-3.5 mr-1" /> Request approval ({sec.toLowerCase()}, {selectedBySection[sec].length})
                  </Button>
                ) : null,
              )}
              <Button size="sm" variant="ghost" onClick={clearSelection} disabled={resolveMutation.isPending}>Clear</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && <SkeletonSection />}
      {isError && <div className="text-sm text-red-600">Failed to load drift detail: {error instanceof Error ? error.message : String(error)}</div>}
      {!isLoading && !isError && data && (
        <div className="space-y-6">
          {sections.filter(s => sectionFilter === "all" || s.key === sectionFilter).map((section) => (
            <DriftSectionCard
              key={section.key}
              section={section.key}
              label={section.label}
              rows={section.rows}
              summary={section.summary}
              filter={filter}
              selected={selected}
              onToggle={(rowId, fieldName) => toggleEntry(SECTION_TO_TABLE[section.key], rowId, fieldName)}
              onSelectAllUnverified={handleSelectAllUnverified}
            />
          ))}
        </div>
      )}

      <Dialog open={reasonOpen !== null} onOpenChange={(open) => !open && setReasonOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reasonOpen?.action === "keep_app" ? "Keep app value" : `Request approval — ${reasonOpen?.section}`}
            </DialogTitle>
            <DialogDescription>
              {reasonOpen?.action === "keep_app"
                ? `Recording ${selected.size} field${selected.size === 1 ? "" : "s"} as deliberate operator overrides on top of Excel-truth. Reason will be persisted alongside the override.`
                : `Filing an approval request for ${reasonOpen?.section ? selectedBySection[reasonOpen.section].length : 0} field${reasonOpen?.section && selectedBySection[reasonOpen.section].length === 1 ? "" : "s"}. The request will appear in the "Pending edit requests" panel above for ${reasonOpen?.section === "EXPENDITURE" ? "PROGRAM_FINANCE_MANAGER / CFO" : reasonOpen?.section === "REVENUE" ? "PROGRAM_FINANCE_MANAGER / CCO" : "PROGRAM_MANAGER"} review. Until they act on it, the affected fields stay unchanged.`}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason (min 3 characters)…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReasonOpen(null)}>Cancel</Button>
            <Button onClick={submitReason} disabled={resolveMutation.isPending || reason.trim().length < 3}>
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ExcelVsAppProjectPage() {
  const [, params] = useRoute("/projects/:projectId/excel-vs-app");
  const projectId = Number(params?.projectId);
  return (
    <div className="container mx-auto py-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/program/excel-vs-app" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to program view
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Excel vs App — Project {projectId}</h1>
        </div>
      </div>
      <ExcelVsAppProjectContent projectId={projectId} />
    </div>
  );
}

function DriftSectionCard({
  section,
  label,
  rows,
  summary,
  filter,
  selected,
  onToggle,
  onSelectAllUnverified,
}: {
  section: DiffSection;
  label: string;
  rows: DriftRow[];
  summary?: { verified: number; unverified: number };
  filter: "all" | "unverified" | "verified";
  selected: Map<string, SelectedEntry>;
  onToggle: (rowId: number, fieldName: string) => void;
  onSelectAllUnverified: (entries: SelectedEntry[]) => void;
}) {
  const visibleRows = useMemo(() => {
    return rows
      .map((r) => ({
        ...r,
        fields: r.fields
          .filter((f) => {
            if (f.drift === "none") return false;
            if (filter === "verified" && f.drift !== "verified") return false;
            if (filter === "unverified" && f.drift !== "unverified") return false;
            return true;
          })
          .sort((a, b) => {
            if (a.drift === b.drift) return 0;
            return a.drift === "unverified" ? -1 : 1;
          }),
      }))
      .filter((r) => r.fields.length > 0);
  }, [rows, filter]);

  const driftCount = (summary?.verified ?? 0) + (summary?.unverified ?? 0);

  const table = SECTION_TO_TABLE[section];
  const allVisibleEntries = useMemo(() => {
    return visibleRows.flatMap((row) =>
      row.fields.map((field) => ({ table, rowId: row.id, fieldName: field.fieldName }))
    );
  }, [visibleRows, table]);

  const allVisibleSelected = allVisibleEntries.length > 0 && allVisibleEntries.every(
    (e) => selected.has(`${e.table}::${e.rowId}::${e.fieldName}`)
  );
  const someVisibleSelected = !allVisibleSelected && allVisibleEntries.some(
    (e) => selected.has(`${e.table}::${e.rowId}::${e.fieldName}`)
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base">{label}</CardTitle>
        <div className="flex items-center gap-2 text-xs">
          {summary?.unverified ? <Badge variant="destructive">{summary.unverified} unverified</Badge> : null}
          {summary?.verified ? <Badge variant="secondary">{summary.verified} verified</Badge> : null}
          {driftCount === 0 ? <Badge variant="outline">No drift</Badge> : null}
          {(summary?.unverified ?? 0) > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs px-2"
              data-testid={`select-all-unverified-${section.toLowerCase()}`}
              onClick={() => {
                const entries = rows.flatMap(row =>
                  row.fields
                    .filter(f => f.drift === "unverified")
                    .map(f => ({ table: SECTION_TO_TABLE[section], rowId: row.id, fieldName: f.fieldName })),
                );
                onSelectAllUnverified(entries);
              }}
            >
              Select all unverified
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {visibleRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rows in this view.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 font-medium w-8">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={allVisibleSelected}
                      ref={(el) => { if (el) el.indeterminate = someVisibleSelected; }}
                      onChange={() => onToggleAll(allVisibleEntries)}
                      data-testid={`select-all-${section.toLowerCase()}`}
                      title="Select all"
                    />
                  </th>
                  <th className="py-2 font-medium">Row</th>
                  <th className="py-2 font-medium">Field</th>
                  <th className="py-2 font-medium">Excel value</th>
                  <th className="py-2 font-medium">Live value</th>
                  <th className="py-2 font-medium">Override</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.flatMap((row) =>
                  row.fields.map((field) => {
                    const key = `${SECTION_TO_TABLE[section]}::${row.id}::${field.fieldName}`;
                    const isSelected = selected.has(key);
                    return (
                      <tr key={key} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="py-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300"
                            checked={isSelected}
                            onChange={() => onToggle(row.id, field.fieldName)}
                          />
                        </td>
                        <td className="py-2 align-top">
                          <div className="font-medium">{row.displayLabel || `Row ${row.id}`}</div>
                          {row.sourceRow != null ? <div className="text-xs text-muted-foreground">Excel row {row.sourceRow}</div> : null}
                        </td>
                        <td className="py-2 align-top font-mono text-xs">{field.fieldName}</td>
                        <td className="py-2 align-top">
                          <ValueCell value={field.snapshotValue} />
                        </td>
                        <td className="py-2 align-top" style={styleForCell({ [field.fieldName]: field.cellFormat ?? undefined }, field.fieldName)}>
                          <ValueCell value={field.liveValue} />
                        </td>
                        <td className="py-2 align-top">
                          {field.drift === "verified" ? (
                            <div>
                              <ValueCell value={field.overrideValue} />
                              {field.overrideReason ? <div className="text-xs text-muted-foreground mt-0.5">{field.overrideReason}</div> : null}
                              {field.overrideEditedAt ? <div className="text-[11px] text-muted-foreground">{new Date(field.overrideEditedAt).toLocaleString()}</div> : null}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 align-top">
                          {field.drift === "unverified" ? (
                            <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> Unverified</Badge>
                          ) : field.drift === "verified" ? (
                            <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Verified</Badge>
                          ) : null}
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PendingRequestsPanel({
  requests,
  projectName,
}: {
  requests: any[];
  projectName?: string;
}) {
  if (!projectName) return null;
  if (!requests || requests.length === 0) return null;
  return (
    <Card className="border-blue-200 bg-blue-50/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-blue-900">
          <MailQuestion className="h-4 w-4" />
          Pending edit requests ({requests.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-blue-900">
          Filed against {projectName}. CFO / COO / approver-role users see them via the project-level finance approvals queue. Until they're acted on, the affected fields stay unchanged.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-blue-900/70">
                <th className="py-1 font-medium">Edit type</th>
                <th className="py-1 font-medium">Summary</th>
                <th className="py-1 font-medium">Requested by</th>
                <th className="py-1 font-medium">Filed</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r: any) => (
                <tr key={r.id} className="border-t border-blue-200/50">
                  <td className="py-1 font-mono">{r.editType}</td>
                  <td className="py-1">{r.editSummary}</td>
                  <td className="py-1">{r.requestedBy?.name ?? "—"}</td>
                  <td className="py-1">{r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function BackfillBanner({
  legacyCounts,
}: {
  legacyCounts?: { EXPENDITURE: number; REVENUE: number; PLAN: number };
}) {
  if (!legacyCounts) return null;
  const total = legacyCounts.EXPENDITURE + legacyCounts.REVENUE + legacyCounts.PLAN;
  if (total === 0) return null;
  const parts: string[] = [];
  if (legacyCounts.PLAN > 0) parts.push(`${legacyCounts.PLAN} plan`);
  if (legacyCounts.REVENUE > 0) parts.push(`${legacyCounts.REVENUE} revenue`);
  if (legacyCounts.EXPENDITURE > 0) parts.push(`${legacyCounts.EXPENDITURE} expenditure`);
  return (
    <Card className="border-amber-300 bg-amber-50">
      <CardContent className="p-4 flex gap-3 items-start">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-amber-900 text-sm">
            Backfill required — drift counts may be misleading
          </div>
          <p className="text-xs text-amber-800">
            {total} active row{total === 1 ? "" : "s"} on this project ({parts.join(", ")}) have no
            <code className="mx-1 bg-amber-100 px-1 rounded">import_snapshot</code> populated yet.
            For those rows, drift detection treats every value as drifted.
          </p>
          <p className="text-xs text-amber-800">
            An ops engineer needs to run
            <code className="mx-1 bg-amber-100 px-1 rounded">npx tsx scripts/backfill-import-snapshot.ts --project-id={" "}<em>this-project</em></code>
            once. Until then, focus on rows where Excel and live values are obviously different — and double-check before clicking Accept Excel.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ValueCell({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground italic">—</span>;
  }
  if (typeof value === "boolean") {
    return <span>{value ? "true" : "false"}</span>;
  }
  return <span className="break-words">{String(value)}</span>;
}

function FilterTab({
  active,
  onClick,
  children,
  "data-testid": testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  "data-testid"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={
        "px-3 py-1 rounded-md text-xs font-medium transition-colors border " +
        (active
          ? "bg-emerald-50 border-emerald-300 text-emerald-700"
          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50")
      }
    >
      {children}
    </button>
  );
}

function SkeletonSection() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-4 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
