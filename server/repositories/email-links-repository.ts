/**
 * Email + Teams project-link repository.
 *
 * Read + write path for the email-linking feature. Current surface:
 *   - matchClientByDomain(senderEmail) — layered signal #1 (domain)
 *   - matchClientByContact(senderEmail) — layered signal #2 (known contact)
 *   - createEmailLink(input) — insert attribution row (auto OR manual)
 *   - createTeamsLink(input) — mirror for Teams messages
 *   - listEmailLinksForProject(projectId)
 *   - listTeamsLinksForProject(projectId)
 *   - removeEmailLink(id, userId) — super-user recall
 *
 * All queries filter soft-delete where relevant. All inputs are validated
 * by callers (route layer) via Zod.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  emailProjectLinks,
  teamsProjectLinks,
  type EmailLinkSignal,
  type EmailProjectLink,
  type TeamsLinkSignal,
  type TeamsProjectLink,
} from "@shared/schema/email-links";
import { clients } from "@shared/schema/projects";

// ---- Layered matching --------------------------------------------------

/**
 * Extract the domain portion from an email address (lowercased).
 * Returns null on malformed input.
 */
export function extractDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain || domain.includes(" ")) return null;
  return domain;
}

export interface MatchedClient {
  clientId: number;
  clientName: string;
  matchedVia: "primary_domain" | "additional_domain";
}

/**
 * Layered signal #1 — match the sender's email domain against clients'
 * primaryEmailDomain / additionalEmailDomains. Returns the first match
 * (primary beats additional if a domain happens to be in both lists,
 * which shouldn't normally happen).
 */
export async function matchClientByDomain(senderEmail: string): Promise<MatchedClient | null> {
  const domain = extractDomain(senderEmail);
  if (!domain) return null;

  // Fetch candidates where primaryEmailDomain matches exactly.
  const primaryRows = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(eq(clients.primaryEmailDomain, domain))
    .limit(1);
  if (primaryRows[0]) {
    return { clientId: primaryRows[0].id, clientName: primaryRows[0].name, matchedVia: "primary_domain" };
  }

  // Fallback: scan additionalEmailDomains (jsonb array). Do this via sql`?` containment
  // operator which is Postgres-specific. SQLite dev fallback skips this.
  try {
    const additionalRows = await db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(sql`${clients.additionalEmailDomains} ? ${domain}`)
      .limit(1);
    if (additionalRows[0]) {
      return { clientId: additionalRows[0].id, clientName: additionalRows[0].name, matchedVia: "additional_domain" };
    }
  } catch {
    // SQLite doesn't support jsonb ?-containment. Fall through to no-match.
  }
  return null;
}

// ---- Writes ------------------------------------------------------------

export interface CreateEmailLinkInput {
  graphMessageId: string;
  graphConversationId?: string | null;
  projectId?: number | null;
  clientId?: number | null;
  signal: EmailLinkSignal;
  senderEmail?: string | null;
  subjectSnapshot?: string | null;
  phaseAtLinkTime?: string | null;
  linkedByUserId?: number | null;
  linkNote?: string | null;
  receivedAt?: Date | string | null;
}

export async function createEmailLink(input: CreateEmailLinkInput): Promise<EmailProjectLink> {
  if (!input.projectId && !input.clientId) {
    throw new Error("createEmailLink requires at least one of projectId / clientId.");
  }
  const [row] = await db
    .insert(emailProjectLinks)
    .values({
      graphMessageId: input.graphMessageId,
      graphConversationId: input.graphConversationId ?? null,
      projectId: input.projectId ?? null,
      clientId: input.clientId ?? null,
      signal: input.signal,
      senderEmail: input.senderEmail ?? null,
      subjectSnapshot: input.subjectSnapshot ?? null,
      phaseAtLinkTime: input.phaseAtLinkTime ?? null,
      linkedByUserId: input.linkedByUserId ?? null,
      linkNote: input.linkNote ?? null,
      receivedAt: input.receivedAt ? new Date(input.receivedAt) : null,
    })
    .returning();
  return row;
}

export interface CreateTeamsLinkInput {
  graphMessageId: string;
  graphChannelId?: string | null;
  graphTeamId?: string | null;
  graphThreadId?: string | null;
  projectId: number;
  signal: TeamsLinkSignal;
  senderEmail?: string | null;
  bodyPreview?: string | null;
  phaseAtLinkTime?: string | null;
  linkedByUserId?: number | null;
  linkNote?: string | null;
  postedAt?: Date | string | null;
}

export async function createTeamsLink(input: CreateTeamsLinkInput): Promise<TeamsProjectLink> {
  const [row] = await db
    .insert(teamsProjectLinks)
    .values({
      graphMessageId: input.graphMessageId,
      graphChannelId: input.graphChannelId ?? null,
      graphTeamId: input.graphTeamId ?? null,
      graphThreadId: input.graphThreadId ?? null,
      projectId: input.projectId,
      signal: input.signal,
      senderEmail: input.senderEmail ?? null,
      bodyPreview: input.bodyPreview ? input.bodyPreview.slice(0, 200) : null,
      phaseAtLinkTime: input.phaseAtLinkTime ?? null,
      linkedByUserId: input.linkedByUserId ?? null,
      linkNote: input.linkNote ?? null,
      postedAt: input.postedAt ? new Date(input.postedAt) : null,
    })
    .returning();
  return row;
}

// ---- Reads -------------------------------------------------------------

export async function listEmailLinksForProject(projectId: number): Promise<EmailProjectLink[]> {
  return db
    .select()
    .from(emailProjectLinks)
    .where(eq(emailProjectLinks.projectId, projectId))
    .orderBy(desc(emailProjectLinks.receivedAt), desc(emailProjectLinks.createdAt));
}

export async function listTeamsLinksForProject(projectId: number): Promise<TeamsProjectLink[]> {
  return db
    .select()
    .from(teamsProjectLinks)
    .where(eq(teamsProjectLinks.projectId, projectId))
    .orderBy(desc(teamsProjectLinks.postedAt), desc(teamsProjectLinks.createdAt));
}

export async function removeEmailLink(id: number): Promise<void> {
  await db.delete(emailProjectLinks).where(eq(emailProjectLinks.id, id));
}

export async function removeTeamsLink(id: number): Promise<void> {
  await db.delete(teamsProjectLinks).where(eq(teamsProjectLinks.id, id));
}
