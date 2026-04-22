/**
 * Email auto-linker consumer.
 *
 * Runs the layered-signal matching against an inbound email metadata
 * payload (as Graph webhooks would deliver, or as mock dev triggers
 * supply) and creates attribution rows in email_project_links.
 *
 * Layered signals applied, in order. First match wins for auto-linking;
 * every signal that fires creates a row so the trust-trail is preserved.
 *
 *   1. thread_inheritance — parent message already linked? Inherit.
 *   2. subject_tag        — subject contains a [PRJ-123]-style marker?
 *   3. client_domain      — sender's domain matches a clients row?
 *   4. client_contact     — NOT YET WIRED (needs a contacts table).
 *   5. pipedrive          — handled separately by the Pipedrive sync.
 *
 * Signals that don't match leave no row; the UI shows those messages
 * in an "unlinked — needs your attention" bucket (separate feature).
 */

import { eq, desc, sql } from "drizzle-orm";
import { db } from "../db";
import { emailProjectLinks } from "@shared/schema/email-links";
import { projectInfo } from "@shared/schema/projects";
import {
  createEmailLink,
  matchClientByDomain,
} from "../repositories/email-links-repository";
import { isConnectorMocked, logConnectorModeOnce } from "../lib/connector-mode";

export interface InboundEmailMeta {
  graphMessageId: string;
  graphConversationId?: string | null;
  senderEmail: string;
  subject: string;
  receivedAt?: string | null;
}

export interface AutoLinkResult {
  rowsCreated: number;
  signalsFired: string[];
  clientId: number | null;
  projectId: number | null;
}

const SUBJECT_TAG_RE = /\[PRJ[-_](\d+)\]/i;

/**
 * Look up a project's phase for the phase-at-link-time snapshot. Uses
 * the project_info.phase column (set by phase_history). Null when no
 * phase is known yet.
 */
async function getProjectPhase(projectId: number): Promise<string | null> {
  // Use raw sql for the phase column — Drizzle's inferred type occasionally
  // lags behind the projectInfo schema during incremental schema edits.
  const result = await db.execute(
    sql`SELECT phase FROM project_info WHERE id = ${projectId} LIMIT 1`,
  );
  // Normalise result shape across pg Pool + SQLite driver wrappers.
  const rows = Array.isArray(result) ? result : (result as { rows?: Array<{ phase?: string | null }> })?.rows ?? [];
  const row = rows[0] as { phase?: string | null } | undefined;
  return row?.phase ?? null;
}

/**
 * Run auto-linking against one inbound email. Idempotent: the unique
 * index on (graph_message_id, project_id) prevents double-linking on
 * repeated deliveries (e.g. webhook retries).
 */
export async function autoLinkInboundEmail(meta: InboundEmailMeta): Promise<AutoLinkResult> {
  logConnectorModeOnce("ms-graph");
  const signalsFired: string[] = [];
  let resolvedProjectId: number | null = null;
  let resolvedClientId: number | null = null;
  let rowsCreated = 0;

  // ---- Signal 1: thread_inheritance ---------------------------------
  if (meta.graphConversationId) {
    const [parentLink] = await db
      .select()
      .from(emailProjectLinks)
      .where(eq(emailProjectLinks.graphConversationId, meta.graphConversationId))
      .orderBy(desc(emailProjectLinks.createdAt))
      .limit(1);
    if (parentLink) {
      signalsFired.push("thread_inheritance");
      resolvedProjectId = parentLink.projectId ?? null;
      resolvedClientId = parentLink.clientId ?? null;
      await createEmailLink({
        graphMessageId: meta.graphMessageId,
        graphConversationId: meta.graphConversationId,
        projectId: resolvedProjectId,
        clientId: resolvedClientId,
        signal: "thread_inheritance",
        senderEmail: meta.senderEmail,
        subjectSnapshot: meta.subject,
        phaseAtLinkTime: resolvedProjectId ? await getProjectPhase(resolvedProjectId) : null,
        receivedAt: meta.receivedAt ?? null,
      }).catch(() => {
        // Unique index trip — already linked. Treat as non-fatal.
      });
      rowsCreated += 1;
      // Thread inheritance is strongest; return early.
      return { rowsCreated, signalsFired, clientId: resolvedClientId, projectId: resolvedProjectId };
    }
  }

  // ---- Signal 2: subject_tag ---------------------------------------
  const tagMatch = SUBJECT_TAG_RE.exec(meta.subject || "");
  if (tagMatch) {
    const projectId = Number(tagMatch[1]);
    if (Number.isFinite(projectId) && projectId > 0) {
      const [project] = await db
        .select({ id: projectInfo.id, clientId: projectInfo.clientId })
        .from(projectInfo)
        .where(eq(projectInfo.id, projectId))
        .limit(1);
      if (project) {
        signalsFired.push("subject_tag");
        resolvedProjectId = project.id;
        resolvedClientId = project.clientId ?? null;
        const phase = await getProjectPhase(project.id);
        await createEmailLink({
          graphMessageId: meta.graphMessageId,
          graphConversationId: meta.graphConversationId ?? null,
          projectId: resolvedProjectId,
          clientId: resolvedClientId,
          signal: "subject_tag",
          senderEmail: meta.senderEmail,
          subjectSnapshot: meta.subject,
          phaseAtLinkTime: phase,
          receivedAt: meta.receivedAt ?? null,
        }).catch(() => undefined);
        rowsCreated += 1;
      }
    }
  }

  // ---- Signal 3: client_domain -------------------------------------
  const match = await matchClientByDomain(meta.senderEmail);
  if (match && !signalsFired.includes("subject_tag")) {
    signalsFired.push("client_domain");
    resolvedClientId = match.clientId;
    // Domain match attributes to a client, not a project. The Communications
    // tab on any of that client's projects will still show these rows because
    // the UI query can include client-linked rows — or the user manually
    // promotes to a specific project later.
    await createEmailLink({
      graphMessageId: meta.graphMessageId,
      graphConversationId: meta.graphConversationId ?? null,
      projectId: null,
      clientId: resolvedClientId,
      signal: "client_domain",
      senderEmail: meta.senderEmail,
      subjectSnapshot: meta.subject,
      phaseAtLinkTime: null,
      receivedAt: meta.receivedAt ?? null,
    }).catch(() => undefined);
    rowsCreated += 1;
  }

  return { rowsCreated, signalsFired, clientId: resolvedClientId, projectId: resolvedProjectId };
}

/**
 * Dev-mode mock webhook: given a list of inbound email metas, run the
 * auto-linker against each. In real mode, the Graph subscription
 * consumer calls autoLinkInboundEmail directly — this mock is just
 * for devs to simulate arrival without a tenant.
 */
export async function mockIngestInboundEmails(batch: InboundEmailMeta[]): Promise<AutoLinkResult[]> {
  if (!isConnectorMocked("ms-graph")) {
    throw new Error("mockIngestInboundEmails is only available when MS Graph is in mock mode.");
  }
  const results: AutoLinkResult[] = [];
  for (const meta of batch) {
    results.push(await autoLinkInboundEmail(meta));
  }
  return results;
}
