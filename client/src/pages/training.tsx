import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WALKTHROUGHS, WALKTHROUGH_CATEGORIES } from "@/data/walkthroughs";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout } from "@/components/layout";

export default function TrainingPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const saved = typeof window !== "undefined" ? localStorage.getItem("walkthrough-progress") : null;
  const progress = saved ? JSON.parse(saved) as Record<string, number[]> : {};

  const filtered = useMemo(() => WALKTHROUGHS.filter((w) => {
    if (category !== "all" && w.category !== category) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return w.title.toLowerCase().includes(q) || w.description.toLowerCase().includes(q);
  }), [query, category]);

  return (
    <PageLayout
      data-testid="training-page"
      header={
        <PageHeader
          title="Training"
          subtitle="Real learning modules with direct links into operational workflows"
        />
      }
    >
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Input
              placeholder="Search modules"
              className="max-w-sm"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="input-search-training"
            />
            <select
              className="rounded-md border border-input px-3 py-2 text-sm bg-background"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              data-testid="select-training-category"
            >
              <option value="all">All categories</option>
              {Object.keys(WALKTHROUGH_CATEGORIES).map((key) => <option key={key} value={key}>{WALKTHROUGH_CATEGORIES[key].label}</option>)}
            </select>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              No training modules found. Try changing filters, or ask your admin to publish walkthroughs for this role.
            </div>
          ) : filtered.slice(0, 20).map((item) => {
            const total = item.steps.length;
            const done = (progress[item.id] || []).length;
            return (
              <div key={item.id} className="rounded-lg border border-border p-3 flex items-start justify-between gap-3" data-testid={`training-module-${item.id}`}>
                <div>
                  <p className="font-medium text-sm">{item.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <Badge className="bg-emerald-100 text-emerald-700 tabular-nums">{done}/{total} steps done</Badge>
                    <span className="text-xs text-muted-foreground">Est. time: {item.estimatedMinutes} min</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2 items-end">
                  <Button asChild size="sm" variant="outline"><Link href="/ee-info">Open walkthrough</Link></Button>
                  {item.steps.find((s) => s.targetPage)?.targetPage ? <Button asChild size="sm"><Link href={item.steps.find((s) => s.targetPage)!.targetPage!}>Start in app</Link></Button> : null}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </PageLayout>
  );
}
