import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Mail, MessageSquare, ExternalLink, Hash } from "lucide-react";
import type { EmailProjectLink, TeamsProjectLink } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";

/**
 * Project Communications tab.
 *
 * Drops onto project-detail as a new subtab. Lists emails + Teams
 * messages linked to this project, grouped by the lifecycle phase
 * they happened in (user's locked rule: "always keep all history but
 * under its phase"). Never renders email bodies — metadata only per
 * CLAUDE.md. Each row click-opens the live message in Outlook /
 * Teams via the Graph-hosted link.
 *
 * Data comes from the attribution tables (email_project_links /
 * teams_project_links) — the D0 Graph webhook that writes those rows
 * is a separate feature; this tab renders whatever's been written.
 * Manual linking from elsewhere in the app populates the same tables.
 */

interface EmailResponse {
  projectId: number;
  rows: EmailProjectLink[];
}

interface TeamsResponse {
  projectId: number;
  rows: TeamsProjectLink[];
}

export interface ProjectCommunicationsTabProps {
  projectId: number;
}

const PHASE_LABELS: Record<string, string> = {
  P0_FIRST_ASSESSMENT: "First Assessment",
  P1_COST_PROPOSAL_DESIGN: "Cost Proposal & Design",
  P2_PD_PM_HANDOVER: "PD → PM Handover",
  P3_DETAILED_DESIGN_PROC_RELEASE: "Detailed Design / Procurement",
  P4_CONSTRUCTION_INSTALLATION: "Construction",
  P5_COMMISSIONING_TESTING: "Commissioning",
  P6_HANDOVER_CLIENT_MATRIARCH: "Handover",
  P7_CLOSEOUT_POSTMORTEM: "Closeout",
  UNPHASED: "Unphased",
};

const SIGNAL_LABELS: Record<string, string> = {
  client_domain: "Domain match",
  client_contact: "Known contact",
  subject_tag: "Subject tag",
  thread_inheritance: "Thread inheritance",
  pipedrive: "Pipedrive",
  manual: "Manual",
  project_channel: "Project channel",
  user_mention: "@mention",
};

function signalTone(signal: string): string {
  if (signal === "manual") return "bg-blue-50 text-blue-700 border-blue-200";
  if (signal === "pipedrive") return "bg-violet-50 text-violet-700 border-violet-200";
  if (signal === "client_domain" || signal === "project_channel") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  return "bg-muted text-muted-foreground";
}

export function ProjectCommunicationsTab({ projectId }: ProjectCommunicationsTabProps) {
  const emailsQuery = useQuery<EmailResponse>({
    queryKey: [`/api/projects/${projectId}/emails`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: projectId > 0,
  });

  const teamsQuery = useQuery<TeamsResponse>({
    queryKey: [`/api/projects/${projectId}/teams-messages`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: projectId > 0,
  });

  const emails = emailsQuery.data?.rows ?? [];
  const teamsRows = teamsQuery.data?.rows ?? [];

  // Group by phaseAtLinkTime — UNPHASED bucket catches nulls.
  const emailsByPhase = useMemo(() => groupByPhase(emails), [emails]);
  const teamsByPhase = useMemo(() => groupByPhase(teamsRows), [teamsRows]);

  const allPhases = useMemo(() => {
    const set = new Set<string>();
    for (const p of emailsByPhase.keys()) set.add(p);
    for (const p of teamsByPhase.keys()) set.add(p);
    // Order by Phase sort key (P0, P1, ... UNPHASED last)
    return Array.from(set).sort((a, b) => {
      if (a === "UNPHASED") return 1;
      if (b === "UNPHASED") return -1;
      return a.localeCompare(b);
    });
  }, [emailsByPhase, teamsByPhase]);

  return (
    <div className="space-y-4" data-testid="project-communications-tab">
      {emailsQuery.isLoading || teamsQuery.isLoading ? (
        <p className="text-xs text-muted-foreground py-6 text-center">Loading communications…</p>
      ) : emails.length === 0 && teamsRows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Mail className="h-6 w-6 mx-auto mb-2 opacity-40" />
            <p className="text-sm font-medium">No linked communications yet</p>
            <p className="text-xs mt-1 max-w-md mx-auto">
              Emails + Teams messages will appear here once they're linked. Linking happens automatically when the sender's domain matches the client's email domain, or manually via "Link to project" on any message.
            </p>
          </CardContent>
        </Card>
      ) : (
        allPhases.map((phaseKey) => (
          <Card key={phaseKey} data-testid={`comms-phase-${phaseKey}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Hash className="h-4 w-4 text-primary" />
                {PHASE_LABELS[phaseKey] ?? phaseKey}
                <Badge variant="outline" className="text-[10px]">
                  {(emailsByPhase.get(phaseKey)?.length ?? 0) + (teamsByPhase.get(phaseKey)?.length ?? 0)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {(emailsByPhase.get(phaseKey) ?? []).length > 0 && (
                <section>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
                    <Mail className="h-3 w-3" /> Emails
                  </p>
                  <ul className="divide-y divide-border/50">
                    {(emailsByPhase.get(phaseKey) ?? []).map((email) => (
                      <EmailRow key={email.id} email={email} />
                    ))}
                  </ul>
                </section>
              )}
              {(teamsByPhase.get(phaseKey) ?? []).length > 0 && (
                <section>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" /> Teams
                  </p>
                  <ul className="divide-y divide-border/50">
                    {(teamsByPhase.get(phaseKey) ?? []).map((tm) => (
                      <TeamsRow key={tm.id} msg={tm} />
                    ))}
                  </ul>
                </section>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function groupByPhase<T extends { phaseAtLinkTime?: string | null }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const key = r.phaseAtLinkTime ?? "UNPHASED";
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }
  return map;
}

function EmailRow({ email }: { email: EmailProjectLink }) {
  return (
    <li className="py-2" data-testid={`email-link-${email.id}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate">
              {email.subjectSnapshot || "(no subject)"}
            </p>
            <Badge variant="outline" className={`text-[10px] ${signalTone(email.signal)}`}>
              {SIGNAL_LABELS[email.signal] ?? email.signal}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {email.senderEmail || "(sender unknown)"}
          </p>
          {email.linkNote && (
            <p className="text-[11px] italic text-muted-foreground truncate">“{email.linkNote}”</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 text-[11px] text-muted-foreground">
          {email.receivedAt && (
            <span className="tabular-nums">
              {formatDistanceToNow(new Date(email.receivedAt), { addSuffix: true })}
            </span>
          )}
          <OutlookLink messageId={email.graphMessageId} />
        </div>
      </div>
    </li>
  );
}

function TeamsRow({ msg }: { msg: TeamsProjectLink }) {
  return (
    <li className="py-2" data-testid={`teams-link-${msg.id}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate">
              {msg.bodyPreview ? msg.bodyPreview.slice(0, 100) : "(no preview)"}
            </p>
            <Badge variant="outline" className={`text-[10px] ${signalTone(msg.signal)}`}>
              {SIGNAL_LABELS[msg.signal] ?? msg.signal}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {msg.senderEmail || "(sender unknown)"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-[11px] text-muted-foreground">
          {msg.postedAt && (
            <span className="tabular-nums">
              {formatDistanceToNow(new Date(msg.postedAt), { addSuffix: true })}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function OutlookLink({ messageId }: { messageId: string }) {
  // Deep-link pattern: https://outlook.office.com/mail/id/{base64UrlEncodedId}
  // We leave the exact deeplink derivation to when the Graph webhook feeds
  // us the full resourceUrl; this is a best-effort opener.
  const href = `https://outlook.office.com/mail/id/${encodeURIComponent(messageId)}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-primary hover:underline"
      data-testid="open-outlook"
      onClick={(e) => e.stopPropagation()}
    >
      Open <ExternalLink className="h-3 w-3" />
    </a>
  );
}
