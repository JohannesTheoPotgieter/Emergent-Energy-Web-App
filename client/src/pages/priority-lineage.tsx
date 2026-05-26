import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronRight, Flag, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout } from "@/components/layout";
import { departmentLabel } from "@shared/config/priorities";
import type { PriorityRow } from "@/lib/priority-types";

const HEALTH_DOT: Record<string, string> = {
  critical: "bg-red-500",
  at_risk: "bg-amber-500",
  healthy: "bg-emerald-500",
};

const SCOPE_BADGE: Record<string, string> = {
  company: "bg-emerald-100 text-emerald-700",
  department: "bg-sky-100 text-sky-700",
  role: "bg-slate-100 text-slate-700",
};

interface LineageNode extends PriorityRow {
  depth: number;
  ancestors: number[];
}

async function fetchAll(): Promise<PriorityRow[]> {
  const token = localStorage.getItem("auth_token") || "";
  const res = await fetch("/api/priorities?include_cancelled=true", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  return res.json();
}

export default function PriorityLineagePage() {
  const { data: all = [], isLoading } = useQuery<PriorityRow[]>({
    queryKey: ["/api/priorities", "lineage"],
    queryFn: fetchAll,
  });

  const trees = useMemo(() => {
    if (all.length === 0) return [] as Array<{ root: PriorityRow; nodes: LineageNode[] }>;
    const byParent = new Map<number | null, PriorityRow[]>();
    for (const p of all) {
      const key = p.parentId ?? null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(p);
    }
    for (const list of byParent.values()) {
      list.sort((a, b) => {
        if (a.scope !== b.scope) {
          const order = (s: string) => (s === "company" ? 0 : s === "department" ? 1 : 2);
          return order(a.scope) - order(b.scope);
        }
        return (a.title || "").localeCompare(b.title || "");
      });
    }
    const roots = byParent.get(null) || [];
    const out: Array<{ root: PriorityRow; nodes: LineageNode[] }> = [];
    for (const root of roots) {
      const nodes: LineageNode[] = [];
      const visit = (node: PriorityRow, depth: number, ancestors: number[]) => {
        nodes.push({ ...node, depth, ancestors });
        const kids = byParent.get(node.id) || [];
        for (const k of kids) {
          visit(k, depth + 1, [...ancestors, node.id]);
        }
      };
      visit(root, 0, []);
      out.push({ root, nodes });
    }
    out.sort((a, b) => {
      const sevOrder = (s: string) => (s === "critical" ? 0 : s === "important" ? 1 : 2);
      return sevOrder(a.root.severity) - sevOrder(b.root.severity);
    });
    return out;
  }, [all]);

  // Orphans: priorities with a parentId that isn't in the loaded set —
  // typically happens when a parent is closed and filtered out. Lift
  // them to top-level lineage so they're not silently hidden.
  const orphans = useMemo(() => {
    if (all.length === 0) return [] as PriorityRow[];
    const knownIds = new Set(all.map((p) => p.id));
    return all.filter((p) => p.parentId != null && !knownIds.has(p.parentId));
  }, [all]);

  return (
    <PageLayout>
      <PageHeader
        title="Priority lineage"
        subtitle="Cross-department parent → child chain for every active priority. Use this for board-ready reviews of how strategic intent flows from company → department → role."
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : trees.length === 0 && orphans.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Flag className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium text-foreground">No active priorities</p>
            <p className="text-xs text-muted-foreground">Create a priority on /priorities to see it lineage-mapped here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {trees.map(({ root, nodes }) => (
            <Card key={root.id} data-testid={`lineage-tree-${root.id}`}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2 pb-2 border-b">
                  <span className={`w-3 h-3 rounded-full ${HEALTH_DOT[root.effectiveHealth] || HEALTH_DOT.healthy}`} />
                  <Badge variant="secondary" className={`text-[10px] ${SCOPE_BADGE[root.scope]}`}>
                    {root.scope}
                  </Badge>
                  <Link href={`/priorities/${root.id}`}>
                    <span className="text-sm font-semibold text-foreground hover:text-primary hover:underline cursor-pointer">
                      {root.title}
                    </span>
                  </Link>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {nodes.length} node{nodes.length === 1 ? "" : "s"} · {root.effectiveProgress}%
                  </span>
                </div>
                <div className="space-y-1">
                  {nodes.slice(1).map((node) => (
                    <LineageRow key={node.id} node={node} />
                  ))}
                  {nodes.length === 1 && (
                    <p className="text-xs text-muted-foreground italic">No descendants — standalone priority.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}

          {orphans.length > 0 && (
            <Card data-testid="lineage-orphans">
              <CardContent className="p-4 space-y-2">
                <div className="pb-2 border-b flex items-center gap-2">
                  <span className="text-sm font-semibold text-amber-700">Orphans</span>
                  <span className="text-xs text-muted-foreground">{orphans.length} priorit{orphans.length === 1 ? "y has" : "ies have"} a parent that isn't visible from this view (likely closed)</span>
                </div>
                {orphans.map((p) => (
                  <LineageRow key={p.id} node={{ ...p, depth: 1, ancestors: [] }} />
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </PageLayout>
  );
}

function LineageRow({ node }: { node: LineageNode }) {
  return (
    <div
      className="flex items-center gap-2 text-sm py-1"
      style={{ marginLeft: node.depth * 18 }}
      data-testid={`lineage-row-${node.id}`}
    >
      {node.depth > 0 && (
        <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
      )}
      <span className={`w-2 h-2 rounded-full ${HEALTH_DOT[node.effectiveHealth] || HEALTH_DOT.healthy}`} />
      <Badge variant="secondary" className={`text-[10px] ${SCOPE_BADGE[node.scope]}`}>
        {node.scope}
      </Badge>
      {node.departmentKey && (
        <span className="text-[11px] text-muted-foreground hidden md:inline">{departmentLabel(node.departmentKey)}</span>
      )}
      <Link href={`/priorities/${node.id}`}>
        <span className="hover:text-primary hover:underline cursor-pointer truncate">{node.title}</span>
      </Link>
      <span className="text-[11px] text-muted-foreground ml-auto shrink-0 tabular-nums">{node.effectiveProgress ?? 0}%</span>
      {node.assignedUser && (
        <span className="text-[11px] text-muted-foreground shrink-0 hidden lg:inline">
          <ArrowRight className="w-3 h-3 inline mr-0.5" />
          {node.assignedUser.name}
        </span>
      )}
    </div>
  );
}
