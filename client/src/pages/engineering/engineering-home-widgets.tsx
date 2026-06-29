/**
 * Engineering Home — dashboard widget primitives.
 *
 * Lightweight, dependency-free visualisations (CSS bars + SVG-free) used by the
 * Engineering Home dashboard. Recharts exists in the repo, but these small
 * distribution / ranking widgets read cleaner as pure CSS bars: they render
 * instantly, reflow trivially in the dashboard grid, and add no runtime weight.
 *
 * Shared shadcn/Tailwind look — emerald accent (#16A34A → `primary`), muted
 * tracks, red for overdue. All widgets ship their own clean empty state.
 */

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** A titled dashboard panel — header row (title + optional meta/right slot)
 *  over a body. Matches the card chrome used across the page. */
export function DashboardPanel({
  title,
  icon,
  right,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("border-border bg-card", className)}>
      <CardContent className="p-0">
        <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight">
            {icon ? <span className="text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{icon}</span> : null}
            {title}
          </h2>
          {right ? <span className="shrink-0 text-xs text-muted-foreground">{right}</span> : null}
        </div>
        <div className={cn("p-4", bodyClassName)}>{children}</div>
      </CardContent>
    </Card>
  );
}

/** Clean empty state for a widget body. */
export function WidgetEmpty({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      {icon ? <span className="text-muted-foreground [&>svg]:h-5 [&>svg]:w-5">{icon}</span> : null}
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export interface StatusBucket {
  status: string;
  label: string;
  count: number;
  barClass: string;
}

/**
 * Tasks-by-status distribution. A horizontal bar per workflow status, widths
 * proportional to the largest bucket, coloured from the canonical status
 * metadata so it matches the Task Manager.
 */
export function StatusDistribution({ buckets }: { buckets: StatusBucket[] }) {
  const max = buckets.reduce((m, b) => Math.max(m, b.count), 0);
  const total = buckets.reduce((s, b) => s + b.count, 0);

  if (buckets.length === 0 || total === 0) {
    return <WidgetEmpty>No open tasks in scope.</WidgetEmpty>;
  }

  return (
    <div className="space-y-2.5" data-testid="eng-home-status-distribution">
      {buckets.map((b) => {
        const pct = max > 0 ? Math.max(4, Math.round((b.count / max) * 100)) : 0;
        return (
          <div key={b.status} className="grid grid-cols-[7.5rem_1fr_2rem] items-center gap-2">
            <span className="truncate text-xs text-muted-foreground" title={b.label}>
              {b.label}
            </span>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-[width]", b.barClass)}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-right text-xs font-medium tabular-nums">{b.count}</span>
          </div>
        );
      })}
    </div>
  );
}

export interface EngineerLoad {
  userId: number | null;
  name: string;
  open: number;
  overdue: number;
}

/**
 * Workload-by-engineer ranking. Emerald bar for open work with a red overlay
 * segment for the overdue portion, so the lead can see both volume and risk in
 * one glance. Optionally filterable by clicking a row (drill into that
 * engineer) via `onSelect`.
 */
export function EngineerWorkload({
  rows,
  selectedUserId,
  onSelect,
}: {
  rows: EngineerLoad[];
  selectedUserId?: number | null;
  onSelect?: (userId: number | null) => void;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.open), 0);

  if (rows.length === 0) {
    return <WidgetEmpty>No open tasks assigned in scope.</WidgetEmpty>;
  }

  return (
    <ul className="space-y-2.5" data-testid="eng-home-engineer-workload">
      {rows.map((r) => {
        const key = r.userId ?? "unassigned";
        const openPct = max > 0 ? Math.max(4, Math.round((r.open / max) * 100)) : 0;
        const overduePct = r.open > 0 ? Math.round((r.overdue / r.open) * 100) : 0;
        const selectable = onSelect != null && r.userId != null;
        const active = r.userId != null && r.userId === selectedUserId;
        const Row = selectable ? "button" : "div";
        return (
          <li key={key}>
            <Row
              type={selectable ? "button" : undefined}
              onClick={selectable ? () => onSelect?.(active ? null : r.userId) : undefined}
              className={cn(
                "grid w-full grid-cols-[8rem_1fr_auto] items-center gap-2 rounded-md px-1.5 py-1 text-left",
                selectable && "cursor-pointer hover:bg-muted/60",
                active && "bg-primary/8 ring-1 ring-primary/30",
              )}
              data-testid={`eng-home-engineer-${key}`}
            >
              <span
                className={cn(
                  "truncate text-xs",
                  r.userId == null ? "italic text-muted-foreground" : "font-medium text-foreground",
                )}
                title={r.name}
              >
                {r.name}
              </span>
              <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${openPct}%` }}
                >
                  {r.overdue > 0 ? (
                    <div
                      className="h-full rounded-l-full bg-red-500"
                      style={{ width: `${overduePct}%` }}
                    />
                  ) : null}
                </div>
              </div>
              <span className="flex items-center gap-1.5 text-xs tabular-nums">
                <span className="w-5 text-right font-medium text-foreground">{r.open}</span>
                {r.overdue > 0 ? (
                  <span className="rounded bg-red-100 px-1 text-[10px] font-semibold text-red-700">
                    {r.overdue} late
                  </span>
                ) : null}
              </span>
            </Row>
          </li>
        );
      })}
    </ul>
  );
}
