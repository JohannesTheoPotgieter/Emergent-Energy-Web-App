import { Link } from "wouter";
import { PageHeader } from "@/components/ui/page-header";
import { PageLayout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Shield, Users, FileText, FolderTree, Puzzle, ScrollText,
  Workflow, Database, Activity, AlertTriangle, ArrowRight, SlidersHorizontal,
  Link as LinkIcon, Mail,
} from "lucide-react";
import { isSuperAdmin } from "@/lib/access-control";

/**
 * Settings home — the super-user control surface.
 *
 * Replaces the cluttered "what does what?" feel of the previous admin
 * pages by naming every section, giving each a one-line description of
 * the job-to-be-done, grouping them by concern, and linking out to the
 * existing deep pages. Everything behind a COO/CEO super-user gate
 * matching the locked rule.
 *
 * Actionable rule: every card is a direct link to the tool that does
 * the job named on the card — no landing-then-looking around.
 */

interface SettingsCardDef {
  key: string;
  title: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  status?: "ready" | "beta" | "deprecated";
}

interface SettingsGroupDef {
  title: string;
  description: string;
  cards: SettingsCardDef[];
}

const GROUPS: SettingsGroupDef[] = [
  {
    title: "People",
    description: "Who can do what in the app.",
    cards: [
      {
        key: "roles",
        title: "Roles & Permissions",
        description: "Assign users to roles. Configure what each role can view, edit, and approve across the company.",
        href: "/admin-settings?section=roles",
        icon: Shield,
        status: "ready",
      },
      {
        key: "users",
        title: "Users",
        description: "Add, remove, and deactivate users. Reset passwords, link Microsoft identities.",
        href: "/admin-settings?section=users",
        icon: Users,
        status: "ready",
      },
      {
        key: "visibility",
        title: "Visibility & Navigation",
        description: "Control which pages show up in which role's sidebar. Hide sub-pages per role.",
        href: "/admin-settings?section=visibility",
        icon: SlidersHorizontal,
        status: "ready",
      },
    ],
  },
  {
    title: "Documents",
    description: "Control the company's document lifecycle.",
    cards: [
      {
        key: "document-types",
        title: "Document types & approvers",
        description: "Add / edit controlled document types, change default approver matrix, set multi-approver rules.",
        href: "/admin/document-types",
        icon: FileText,
        status: "ready",
      },
      {
        key: "sharepoint-templates",
        title: "SharePoint folder templates",
        description: "Define the folder structure applied to new projects (BD / Cost Proposal / Design / Handover, etc.).",
        href: "/admin-settings?section=sharepoint",
        icon: FolderTree,
        status: "beta",
      },
    ],
  },
  {
    title: "Integrations",
    description: "External systems the app talks to.",
    cards: [
      {
        key: "quickbooks",
        title: "QuickBooks",
        description: "Connection health, one-click sync, mappings and reconciliation jump-offs.",
        href: "/quickbooks",
        icon: LinkIcon,
        status: "ready",
      },
      {
        key: "pipedrive",
        title: "Pipedrive",
        description: "Deal sync status, field mapping, stage → lifecycle mapping.",
        href: "/admin-pipedrive",
        icon: LinkIcon,
        status: "ready",
      },
      {
        key: "microsoft",
        title: "Microsoft 365",
        description: "MS Graph status: Outlook, Calendar, Teams, SharePoint tokens + delta sync.",
        href: "/admin-settings?section=microsoft",
        icon: Mail,
        status: "beta",
      },
    ],
  },
  {
    title: "Workflow",
    description: "How the lifecycle behaves.",
    cards: [
      {
        key: "workflow-config",
        title: "Workflow config",
        description: "Stage requirements, gate templates, exception thresholds, RAG rules.",
        href: "/admin-workflow-config",
        icon: Workflow,
        status: "ready",
      },
      {
        key: "phase-templates",
        title: "Phase templates",
        description: "Default phase + milestone templates applied to new projects.",
        href: "/phase-templates",
        icon: Puzzle,
        status: "ready",
      },
    ],
  },
  {
    title: "Operational",
    description: "Maintenance and observability.",
    cards: [
      {
        key: "audit",
        title: "Audit log",
        description: "Every role change, approval, import, and settings edit with who/when.",
        href: "/admin-settings?section=audit",
        icon: ScrollText,
        status: "ready",
      },
      {
        key: "system-activity",
        title: "System activity",
        description: "Job runs, errors, job queue status, recent events across the system.",
        href: "/system-activity-log",
        icon: Activity,
        status: "ready",
      },
      {
        key: "backfills",
        title: "Backfills & migrations",
        description: "One-off data repair jobs: lifecycle re-seed, QB re-link, missing snapshots.",
        href: "/admin-backfill",
        icon: Database,
        status: "ready",
      },
      {
        key: "recovery",
        title: "Recovery centre",
        description: "Restore soft-deleted records, review cascade-delete audit history.",
        href: "/admin-recovery",
        icon: AlertTriangle,
        status: "beta",
      },
    ],
  },
];

export default function SettingsHome() {
  const companyRole = localStorage.getItem("company_role");
  const tokenRole = localStorage.getItem("user_role");
  if (!isSuperAdmin(tokenRole, companyRole)) {
    return (
      <PageLayout
        data-testid="settings-home-denied"
        header={<PageHeader title="Settings" subtitle="Access denied." />}
      >
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="py-10 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-amber-500 mb-2" />
            <p className="text-sm font-medium">Only COO and CEO admins can open Settings.</p>
            <p className="text-xs text-muted-foreground mt-1">Contact a super user if you need changes here.</p>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      data-testid="settings-home-page"
      header={
        <PageHeader
          title="Settings"
          subtitle="Everything a super user can configure, grouped and named so you know exactly what each does."
        />
      }
    >
      {GROUPS.map((group) => (
        <section key={group.title} data-testid={`settings-group-${group.title.toLowerCase()}`} className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-foreground">{group.title}</h2>
            <p className="text-xs text-muted-foreground">{group.description}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {group.cards.map((card) => (
              <SettingsCard key={card.key} card={card} />
            ))}
          </div>
        </section>
      ))}
    </PageLayout>
  );
}

function SettingsCard({ card }: { card: SettingsCardDef }) {
  const Icon = card.icon;
  return (
    <Link
      href={card.href}
      className="group block"
      data-testid={`settings-card-${card.key}`}
    >
      <Card className="h-full transition-colors hover:border-primary/40 hover:bg-[hsl(var(--surface-tint))]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            {card.title}
            {card.status === "beta" && (
              <Badge variant="outline" className="text-[9px] ml-auto">
                Beta
              </Badge>
            )}
            {card.status === "deprecated" && (
              <Badge variant="outline" className="text-[9px] ml-auto bg-amber-100 text-amber-700 border-amber-200">
                Retiring
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 pb-3">
          <p className="text-xs text-muted-foreground">{card.description}</p>
          <div className="mt-2 flex items-center gap-1 text-[11px] text-primary group-hover:underline">
            Open
            <ArrowRight className="h-3 w-3" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
