/**
 * Email / Teams project linking (email-linking feature).
 *
 * Stores metadata-only attribution records that tie an Outlook message
 * or Teams thread to a project (and sometimes to a specific client).
 * See docs/overhaul/04-overnight-progress.md for the layered-signal
 * design and user conversation.
 *
 * CLAUDE.md rule: we never store email bodies or attachment content.
 * The `graphMessageId` / `graphConversationId` are Graph API handles
 * used to fetch the live message from Outlook when rendering the UI.
 */

import { sql } from "drizzle-orm";
import { pgTable, text, integer, timestamp, pgEnum, serial, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { projectInfo, clients } from "./projects";

// =====================================================================
// Enums
// =====================================================================

/**
 * Signal that produced the link. Drives trust scoring + allows the UI
 * to surface which links need a human confirmation (manual links are
 * 100% trusted, domain-matched links are auto-confirmed, subject-tag
 * matches are confirmed, free-text matches would require confirmation
 * — those aren't implemented yet).
 */
export const emailLinkSignalEnum = pgEnum("email_link_signal_enum", [
  "client_domain",       // sender's domain matches clients.primaryEmailDomain or additionalEmailDomains
  "client_contact",      // sender's email matches a known contact on the client
  "subject_tag",         // subject contains a [PRJ-123]-style tag
  "thread_inheritance",  // previous message in the thread was linked; this reply inherited
  "pipedrive",           // linked via Pipedrive activity sync
  "manual",              // user clicked "Link to project" in the UI
]);

export type EmailLinkSignal = typeof emailLinkSignalEnum.enumValues[number];

// =====================================================================
// Email → project / client links
// =====================================================================

export const emailProjectLinks = pgTable("email_project_links", {
  id: serial("id").primaryKey(),
  /** Graph message id. Unique per link row — same message can't link twice to same project. */
  graphMessageId: text("graph_message_id").notNull(),
  /** Graph conversation (thread) id — lets us find all emails in the same thread. */
  graphConversationId: text("graph_conversation_id"),
  /** Optional project link. Null when we only linked to a client. */
  projectId: integer("project_id").references(() => projectInfo.id, { onDelete: "cascade" }),
  /** Optional client link. Set when client-domain or client-contact matched. */
  clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }),
  /** Which signal produced this link. */
  signal: emailLinkSignalEnum("signal").notNull(),
  /** Sender address as captured from Outlook (denormalised for filtering). */
  senderEmail: text("sender_email"),
  /** Subject line snapshot (metadata — no body). */
  subjectSnapshot: text("subject_snapshot"),
  /**
   * Snapshot of the project's lifecycle phase at the time of linking.
   * User's locked rule: "Always keep all history but under its phase" —
   * so emails from First Assessment stay grouped under First Assessment
   * even after the project has moved to Construction.
   */
  phaseAtLinkTime: text("phase_at_link_time"),
  /** User who manually linked (null for auto-linked). */
  linkedByUserId: integer("linked_by_user_id").references(() => users.id, { onDelete: "set null" }),
  /** Optional reason/comment for manual links. */
  linkNote: text("link_note"),
  /** Received-at timestamp (from Graph metadata). */
  receivedAt: timestamp("received_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  projectIdIdx: index("epl_project_id_idx").on(t.projectId),
  clientIdIdx: index("epl_client_id_idx").on(t.clientId),
  conversationIdx: index("epl_conversation_idx").on(t.graphConversationId),
  messageIdIdx: uniqueIndex("epl_message_project_unique_idx").on(t.graphMessageId, t.projectId),
}));

export const insertEmailProjectLinkSchema = createInsertSchema(emailProjectLinks)
  .omit({ id: true, createdAt: true });
export type InsertEmailProjectLink = z.infer<typeof insertEmailProjectLinkSchema>;
export type EmailProjectLink = typeof emailProjectLinks.$inferSelect;

// =====================================================================
// Teams → project links (mirror shape)
// =====================================================================

export const teamsLinkSignalEnum = pgEnum("teams_link_signal_enum", [
  "project_channel",  // message is in the project's dedicated Teams channel
  "user_mention",     // a user on the project was @mentioned
  "manual",           // user pinned the message to a project
]);

export type TeamsLinkSignal = typeof teamsLinkSignalEnum.enumValues[number];

export const teamsProjectLinks = pgTable("teams_project_links", {
  id: serial("id").primaryKey(),
  graphMessageId: text("graph_message_id").notNull(),
  graphChannelId: text("graph_channel_id"),
  graphTeamId: text("graph_team_id"),
  graphThreadId: text("graph_thread_id"),
  projectId: integer("project_id").notNull().references(() => projectInfo.id, { onDelete: "cascade" }),
  signal: teamsLinkSignalEnum("signal").notNull(),
  senderEmail: text("sender_email"),
  bodyPreview: text("body_preview"),  // first ~200 chars, metadata-only
  phaseAtLinkTime: text("phase_at_link_time"),
  linkedByUserId: integer("linked_by_user_id").references(() => users.id, { onDelete: "set null" }),
  linkNote: text("link_note"),
  postedAt: timestamp("posted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  projectIdIdx: index("tpl_project_id_idx").on(t.projectId),
  channelIdx: index("tpl_channel_idx").on(t.graphChannelId),
  threadIdx: index("tpl_thread_idx").on(t.graphThreadId),
  messageProjectUniqueIdx: uniqueIndex("tpl_message_project_unique_idx").on(t.graphMessageId, t.projectId),
}));

export const insertTeamsProjectLinkSchema = createInsertSchema(teamsProjectLinks)
  .omit({ id: true, createdAt: true });
export type InsertTeamsProjectLink = z.infer<typeof insertTeamsProjectLinkSchema>;
export type TeamsProjectLink = typeof teamsProjectLinks.$inferSelect;

// =====================================================================
// Placate strict-mode Drizzle: re-export table ids for sql`` references.
// =====================================================================
export const __emailProjectLinksSql = sql`${emailProjectLinks.id}`;
export const __teamsProjectLinksSql = sql`${teamsProjectLinks.id}`;
