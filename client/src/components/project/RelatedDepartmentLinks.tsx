import { Link } from "wouter";
import { ShieldAlert, ShieldCheck, CreditCard, Handshake, ClipboardList, ExternalLink } from "lucide-react";

interface RelatedDepartmentLinksProps {
  projectId: number | null | undefined;
  projectName: string | null | undefined;
}

/**
 * Surfaces the lifecycle departments that don't have a first-class tab on
 * the project detail page (HSE, Commissioning, Procurement / PO Approvals,
 * SSEG / Compliance, Handover & Closeout). Without this strip, a user
 * following a project end-to-end has to leave the page, navigate to the
 * cross-project surface from the top nav, and find the project there —
 * losing context.
 *
 * Each link points at the canonical surface for that department. Where a
 * project-scoped page exists (Commissioning), it deep-links by id;
 * elsewhere it lands on the global page so the user can filter to this
 * project from there.
 */
export function RelatedDepartmentLinks({ projectId, projectName }: RelatedDepartmentLinksProps) {
  const links = [
    {
      key: "hse",
      label: "HSE",
      icon: ShieldAlert,
      href: "/hse",
      description: "Incidents, corrective actions",
    },
    {
      key: "commissioning",
      label: "Commissioning",
      icon: ShieldCheck,
      href: projectId != null ? `/commissioning-dashboard/${projectId}` : "/commissioning-dashboard",
      description: "Commissioning checklists & sign-off",
    },
    {
      key: "po-approvals",
      label: "PO Approvals",
      icon: CreditCard,
      href: projectName ? `/po-approval-board?project=${encodeURIComponent(projectName)}` : "/po-approval-board",
      description: "Purchase order approvals",
    },
    {
      key: "sseg",
      label: "SSEG / Compliance",
      icon: ClipboardList,
      href: projectName ? `/sseg-submissions?project=${encodeURIComponent(projectName)}` : "/sseg-submissions",
      description: "SSEG submissions, compliance docs",
    },
    {
      key: "handover",
      label: "Handover & Closeout",
      icon: Handshake,
      href: projectName ? `/handover?project=${encodeURIComponent(projectName)}` : "/handover",
      description: "PC, client handover, O&M",
    },
  ] as const;

  return (
    <div className="rounded-md border bg-muted/10 px-3 py-2" data-testid="related-department-links">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mr-1">
          Related departments
        </span>
        {links.map((l) => {
          const Icon = l.icon;
          return (
            <Link
              key={l.key}
              href={l.href}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-background border border-border/60 text-foreground hover:bg-muted/60 hover:border-border transition-colors"
              title={l.description}
              data-testid={`related-dept-${l.key}`}
            >
              <Icon className="h-3.5 w-3.5" />
              {l.label}
              <ExternalLink className="h-3 w-3 text-muted-foreground/60" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
