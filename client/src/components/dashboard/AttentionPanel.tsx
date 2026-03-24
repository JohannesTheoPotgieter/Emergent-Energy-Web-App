import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ChevronDown, ChevronUp } from "lucide-react";

export type AttentionEntry = { id: number; name: string; owner: string; daysBehind?: number; ageDays?: number; severity: "high" | "medium" | "low"; link: string };
export type AttentionItemsResponse = {
  behindPlan: AttentionEntry[];
  engineeringBlockers: AttentionEntry[];
  qualityWarnings: AttentionEntry[];
  overdueActions: AttentionEntry[];
};

const severityRank = { high: 3, medium: 2, low: 1 };

export function AttentionPanel({ data }: { data?: AttentionItemsResponse }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ behindPlan: true });
  const sections = useMemo(() => ([
    ["behindPlan", "Behind Plan"],
    ["engineeringBlockers", "Engineering Blockers"],
    ["qualityWarnings", "Quality Warnings"],
    ["overdueActions", "Overdue Actions"],
  ] as const), []);

  return (
    <Card className="border-border shadow-sm">
      <CardContent className="p-6 space-y-4">
        <h3 className="text-lg font-semibold">Attention Needed</h3>
        {sections.map(([key, label]) => {
          const rows = ([...(data?.[key] || [])] as AttentionEntry[])
            .sort((a, b) => (severityRank[b.severity] - severityRank[a.severity]) || ((b.ageDays ?? b.daysBehind ?? 0) - (a.ageDays ?? a.daysBehind ?? 0)) )
            .slice(0, 5);
          return (
            <div key={key} className="border rounded-lg">
              <button className="w-full p-3 flex items-center justify-between" onClick={() => setOpen((p) => ({ ...p, [key]: !p[key] }))}>
                <span className="text-sm font-medium">{label}</span>
                {open[key] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {open[key] && (
                <div className="border-t">
                  {rows.length === 0 && <p className="text-sm text-muted-foreground p-3">No items.</p>}
                  {rows.map((item) => (
                    <div key={`${key}-${item.id}`} className="p-3 flex items-center gap-3 border-b last:border-b-0">
                      <Link href={item.link} className="text-sm font-medium hover:underline">{item.name}</Link>
                      <span className="text-xs text-muted-foreground">{item.owner}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{item.ageDays ?? item.daysBehind ?? 0}d</span>
                      <Badge className={item.severity === "high" ? "bg-red-100 text-red-700" : item.severity === "medium" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}>{item.severity}</Badge>
                      <Button size="sm" variant="outline">{key === "overdueActions" ? "Assign" : "Escalate"}</Button>
                    </div>
                  ))}
                  <div className="p-3">
                    <Link href="/projects" className="text-xs text-blue-600 hover:underline">View all {label}</Link>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
