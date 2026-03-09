import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

export function PageShell({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("space-y-5 md:space-y-6 pb-6", className)} {...props}>
      {children}
    </div>
  );
}

export function SectionHeader({
  icon,
  title,
  description,
  actions,
  meta,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          {meta ? <div className="text-xs text-muted-foreground">{meta}</div> : null}
        </div>
      </div>
      {actions ? <div className="flex items-center gap-2 flex-wrap">{actions}</div> : null}
    </div>
  );
}

export function KPIStrip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid gap-3 sm:gap-4", className)}>{children}</div>;
}

export function FilterBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("border-border/70 shadow-sm", className)}>
      <CardContent className="p-3 md:p-4">{children}</CardContent>
    </Card>
  );
}
