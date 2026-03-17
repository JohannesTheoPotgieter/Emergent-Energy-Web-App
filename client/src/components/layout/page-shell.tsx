import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";

export function PageShell({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("ee-page page-enter pb-8", className)} {...props}>
      {children}
    </div>
  );
}

type SectionHeaderBadge = {
  label: string;
  icon?: React.ReactNode;
  variant?: BadgeProps["variant"];
};

export function SectionHeader({
  icon,
  title,
  eyebrow,
  description,
  actions,
  meta,
  badges,
}: {
  icon: React.ReactNode;
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  badges?: SectionHeaderBadge[];
}) {
  return (
    <div className="ee-page-header">
      <div className="flex items-start gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 shadow-[var(--shadow-xs)]">
          {icon}
        </div>
        <div className="min-w-0 space-y-2">
          <div className="space-y-1">
            {eyebrow ? <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p> : null}
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            {description ? <p className="ee-helper-text max-w-3xl">{description}</p> : null}
            {meta ? <div className="text-xs text-muted-foreground">{meta}</div> : null}
          </div>
          {badges && badges.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {badges.map((badge) => (
                <Badge key={badge.label} variant={badge.variant || "outline"} className="gap-1.5 px-2.5 py-1">
                  {badge.icon ? <span className="shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5">{badge.icon}</span> : null}
                  {badge.label}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex items-center gap-2 flex-wrap">{actions}</div> : null}
    </div>
  );
}

export function KPIStrip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid gap-3", className)}>{children}</div>;
}

export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("border-border bg-card", className)}>
      <CardContent className="p-3">{children}</CardContent>
    </Card>
  );
}

export function PrimaryActionBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

const workspaceNoticeToneClasses: Record<"neutral" | "finance" | "microsoft" | "admin" | "warning", string> = {
  neutral: "border-border/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(244,247,245,0.95))]",
  finance: "border-emerald-200/80 bg-[linear-gradient(135deg,rgba(236,253,245,0.95),rgba(255,255,255,0.98))]",
  microsoft: "border-sky-200/80 bg-[linear-gradient(135deg,rgba(239,246,255,0.95),rgba(255,255,255,0.98))]",
  admin: "border-violet-200/80 bg-[linear-gradient(135deg,rgba(245,243,255,0.95),rgba(255,255,255,0.98))]",
  warning: "border-amber-200/80 bg-[linear-gradient(135deg,rgba(255,251,235,0.96),rgba(255,255,255,0.98))]",
};

export function WorkspaceNotice({
  title,
  description,
  icon,
  tone = "neutral",
  actions,
  className,
  children,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  tone?: "neutral" | "finance" | "microsoft" | "admin" | "warning";
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-2xl border p-4 shadow-[var(--shadow-xs)]", workspaceNoticeToneClasses[tone], className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            {icon ? <div className="rounded-lg bg-background/80 p-2 text-foreground shadow-[var(--shadow-xs)]">{icon}</div> : null}
            <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
          </div>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          {children ? <div className="flex flex-wrap items-center gap-2 pt-1">{children}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function DetailDrawerHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="border-b border-border/70 pb-3 mb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
