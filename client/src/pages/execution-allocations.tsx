import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PageShell } from "@/components/layout/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Download } from "lucide-react";
import { AllocateDialog } from "@/components/execution/execution-dialogs";
import { downloadCsv } from "@/lib/table-utils";
import type { AllocationProgramRow } from "@/lib/execution-types";

const CONSTRUCTION_PHASES = ["construction", "commission"]; // substring match

export default function ExecutionAllocations() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [lens, setLens] = useState<"site" | "counterparty">("site");
  const [allocFor, setAllocFor] = useState<number | null>(null);
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
    const m = new Map<string, AllocationProgramRow[]>();
    for (const r of data ?? []) {
      for (const inst of r.installers.list) {
        const k = inst.name ?? "Unassigned";
        const arr = m.get(k) ?? [];
        arr.push(r);
        m.set(k, arr);
      }
    }
    const q = search.trim().toLowerCase();
    return [...m.entries()]
      .filter(([name]) => !q || name.toLowerCase().includes(q))
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [data, search]);

  const exportCsv = () => downloadCsv(
    "execution-allocations",
    ["Site", "Phase", "Installers", "Installer count", "PM", "Needs installer"],
    (data ?? []).map((r) => [
      r.projectName, r.phase ?? "",
      r.installers.list.map((i) => i.name).filter(Boolean).join("; "),
      r.installers.count, r.pmName ?? "", needsInstaller(r) ? "yes" : "",
    ]),
  );

  return (
    <PageShell className="max-w-5xl p-4 md:p-6" data-testid="execution-allocations-page">
      <PageHeader title="Allocations" subtitle="Who is installing where, across all active sites" />
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <Button size="sm" variant={lens === "site" ? "default" : "outline"} onClick={() => setLens("site")}>By site</Button>
        <Button size="sm" variant={lens === "counterparty" ? "default" : "outline"} onClick={() => setLens("counterparty")}>By counterparty</Button>
        <Input className="w-48 h-8" placeholder={lens === "site" ? "Search site…" : "Search counterparty…"} value={search} onChange={(e) => setSearch(e.target.value)} data-testid="allocations-search" />
        <Button size="sm" variant="outline" className="ml-auto gap-1.5" onClick={exportCsv} disabled={(data ?? []).length === 0} data-testid="allocations-export">
          <Download className="w-4 h-4" /><span className="hidden sm:inline">Export</span>
        </Button>
      </div>

      <div className="mt-4 space-y-2">
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : isError ? (
          <p className="text-sm text-muted-foreground">Could not load. <Button variant="link" onClick={() => refetch()}>Retry</Button></p>
        ) : (data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No active sites.</p>
        ) : lens === "site" ? (
          sites.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sites match your search.</p>
          ) : sites.map((r) => (
            <Card key={r.projectId}><CardContent className="p-3 flex items-center gap-3">
              <button className="flex-1 text-left" onClick={() => navigate(`/execution/site/${r.projectId}`)}>
                <div className="font-medium">{r.projectName}</div>
                <div className="text-xs text-muted-foreground">
                  {r.phase ?? "—"} · {r.installers.count > 0 ? r.installers.list.map((i) => i.name).join(", ") : "no installer"}
                </div>
              </button>
              {needsInstaller(r) && <Badge variant="destructive">no installer</Badge>}
              <Button size="sm" variant="outline" onClick={() => setAllocFor(r.projectId)}>Allocate</Button>
            </CardContent></Card>
          ))
        ) : byCounterparty.length === 0 ? (
          <p className="text-sm text-muted-foreground">No counterparties match your search.</p>
        ) : (
          byCounterparty.map(([name, siteList]) => (
            <Card key={name}><CardContent className="p-3">
              <div className="font-medium">{name}</div>
              <div className="text-xs text-muted-foreground">{siteList.map((s) => s.projectName).join(", ")}</div>
            </CardContent></Card>
          ))
        )}
      </div>

      <AllocateDialog
        projectId={allocFor ?? 0}
        open={allocFor != null}
        onOpenChange={(v) => { if (!v) setAllocFor(null); }}
        onSaved={() => qc.invalidateQueries({ queryKey: ["/api/execution-review/program/allocations"] })}
      />
    </PageShell>
  );
}
