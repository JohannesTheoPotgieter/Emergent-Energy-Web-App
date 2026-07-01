import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PageShell, SectionHeader } from "@/components/layout/page-shell";
import { PageError } from "@/components/ui/page-states";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, LayoutDashboard, Pencil } from "lucide-react";
import { AllocateDialog } from "@/components/execution/execution-dialogs";
import { downloadCsv } from "@/lib/table-utils";
import type { AllocationProgramRow, InstallerRow, InstallerSummary } from "@/lib/execution-types";

const CONSTRUCTION_PHASES = ["construction", "commission"]; // substring match

type AllocItem = InstallerSummary["list"][number];

/** Reconstruct the full InstallerRow the edit dialog expects from a program
 *  list item + its parent site. */
function toAssignment(projectId: number, i: AllocItem): InstallerRow {
  return {
    id: i.id, projectId, counterpartyId: i.counterpartyId,
    counterpartyName: i.name, counterpartyType: i.type, role: i.role,
    workPackage: i.workPackage, scopeDescription: i.scopeDescription, status: "active",
  };
}

function RoleBadge({ i }: { i: AllocItem }) {
  const label = i.role ?? (i.type ? i.type.charAt(0) + i.type.slice(1).toLowerCase() : null);
  if (!label) return null;
  return <Badge variant="secondary" className="text-[10px]">{label}</Badge>;
}

export default function ExecutionAllocations() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [lens, setLens] = useState<"site" | "counterparty">("site");
  const [allocFor, setAllocFor] = useState<number | null>(null);
  const [edit, setEdit] = useState<{ projectId: number; assignment: InstallerRow } | null>(null);
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch } = useQuery<AllocationProgramRow[]>({
    queryKey: ["/api/execution-review/program/allocations"],
  });

  const needsInstaller = (r: AllocationProgramRow) =>
    r.installers.count === 0 && CONSTRUCTION_PHASES.some((p) => (r.phase ?? "").toLowerCase().includes(p));

  const sites = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((r) => !q || r.projectName.toLowerCase().includes(q));
  }, [data, search]);

  const byCounterparty = useMemo(() => {
    const m = new Map<string, Array<{ site: AllocationProgramRow; item: AllocItem }>>();
    for (const r of data ?? []) {
      for (const item of r.installers.list) {
        const k = item.name ?? "Unassigned";
        const arr = m.get(k) ?? [];
        arr.push({ site: r, item });
        m.set(k, arr);
      }
    }
    const q = search.trim().toLowerCase();
    return [...m.entries()]
      .filter(([name]) => !q || name.toLowerCase().includes(q))
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [data, search]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/execution-review/program/allocations"] });

  const exportCsv = () => downloadCsv(
    "execution-allocations",
    ["Site", "Phase", "Counterparty", "Role", "Work package", "Scope"],
    (data ?? []).flatMap((r) =>
      r.installers.list.length === 0
        ? [[r.projectName, r.phase ?? "", "", "", "", ""]]
        : r.installers.list.map((i) => [r.projectName, r.phase ?? "", i.name ?? "", i.role ?? "", i.workPackage ?? "", i.scopeDescription ?? ""]),
    ),
  );

  return (
    <PageShell className="max-w-5xl p-4 md:p-6 space-y-4" data-testid="execution-allocations-page">
      <SectionHeader
        icon={<LayoutDashboard className="h-5 w-5" />}
        eyebrow="Execution"
        title="Allocations"
        description="Subcontractors & suppliers — their role, scope of work, and which sites they're on"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={lens === "site" ? "default" : "outline"} onClick={() => setLens("site")}>By site</Button>
        <Button size="sm" variant={lens === "counterparty" ? "default" : "outline"} onClick={() => setLens("counterparty")}>By counterparty</Button>
        <Input className="w-48 h-8" placeholder={lens === "site" ? "Search site…" : "Search counterparty…"} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="allocations-search" />
        <Button size="sm" variant="outline" className="ml-auto gap-1.5" onClick={exportCsv} disabled={(data ?? []).length === 0} data-testid="allocations-export">
          <Download className="w-4 h-4" /><span className="hidden sm:inline">Export</span>
        </Button>
      </div>

      <div className="space-y-2">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : isError ? (
          <PageError title="Could not load allocations" message="The allocation program failed to load." onRetry={() => refetch()} />
        ) : (data ?? []).length === 0 ? (
          <div className="ee-empty-state text-sm text-muted-foreground">No active sites.</div>
        ) : lens === "site" ? (
          sites.length === 0 ? (
            <div className="ee-empty-state text-sm text-muted-foreground">No sites match your search.</div>
          ) : sites.map((r) => (
            <Card key={r.projectId}><CardContent className="p-3">
              <div className="flex items-center gap-3">
                <button className="flex-1 text-left min-w-0" onClick={() => navigate(`/execution/site/${r.projectId}`)}>
                  <div className="font-medium truncate">{r.projectName}</div>
                  <div className="text-xs text-muted-foreground">{r.phase ?? "—"} · {r.installers.count} allocated</div>
                </button>
                {needsInstaller(r) && <Badge variant="destructive">no installer</Badge>}
                <Button size="sm" variant="outline" onClick={() => setAllocFor(r.projectId)} data-testid={`allocate-${r.projectId}`}>Allocate</Button>
              </div>
              {r.installers.list.length > 0 && (
                <div className="mt-2 divide-y border-t">
                  {r.installers.list.map((i) => (
                    <div key={i.id} className="flex items-start gap-2 py-1.5 text-xs" data-testid={`alloc-row-${i.id}`}>
                      <span className="font-medium truncate">{i.name ?? "—"}</span>
                      <RoleBadge i={i} />
                      <div className="min-w-0 flex-1 text-muted-foreground">
                        {i.workPackage && <span className="text-foreground">{i.workPackage}</span>}
                        {i.workPackage && i.scopeDescription && <span> · </span>}
                        {i.scopeDescription && <span className="truncate">{i.scopeDescription}</span>}
                      </div>
                      <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => setEdit({ projectId: r.projectId, assignment: toAssignment(r.projectId, i) })} aria-label="Edit allocation" data-testid={`alloc-edit-${i.id}`}>
                        <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent></Card>
          ))
        ) : byCounterparty.length === 0 ? (
          <div className="ee-empty-state text-sm text-muted-foreground">No counterparties match your search.</div>
        ) : (
          byCounterparty.map(([name, rows]) => (
            <Card key={name}><CardContent className="p-3">
              <div className="font-medium">{name}</div>
              <div className="mt-1.5 divide-y border-t">
                {rows.map(({ site, item }) => (
                  <div key={`${site.projectId}-${item.id}`} className="flex items-center gap-2 py-1.5 text-xs">
                    <button className="font-medium truncate hover:underline" onClick={() => navigate(`/execution/site/${site.projectId}`)}>{site.projectName}</button>
                    <RoleBadge i={item} />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.workPackage || item.scopeDescription || ""}</span>
                    <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => setEdit({ projectId: site.projectId, assignment: toAssignment(site.projectId, item) })} aria-label="Edit allocation">
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent></Card>
          ))
        )}
      </div>

      {/* create */}
      <AllocateDialog
        projectId={allocFor ?? 0}
        open={allocFor != null}
        onOpenChange={(v) => { if (!v) setAllocFor(null); }}
        onSaved={invalidate}
      />
      {/* edit */}
      <AllocateDialog
        projectId={edit?.projectId ?? 0}
        assignment={edit?.assignment ?? null}
        open={edit != null}
        onOpenChange={(v) => { if (!v) setEdit(null); }}
        onSaved={invalidate}
      />
    </PageShell>
  );
}
