/**
 * C3 — Alert dispatcher.
 *
 * One entry point for the rest of the system to fan out a
 * notification to "everyone with role X". The dispatcher pushes the
 * payload onto the BullMQ-backed `notification-send` queue (with
 * automatic in-memory fallback when REDIS_URL is unset, see
 * server/lib/job-queue.ts), and a worker drains the queue by calling
 * the existing notification-service.
 *
 * Why a queue:
 *   - Retries + exponential backoff for transient DB blips
 *   - Decouples the producer (refresh cycle, integration run) from
 *     the consumer (DB write + future email/Slack delivery)
 *   - When Redis is configured, queue state survives a process restart
 */

import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { db } from "../db";
import { enqueueJob, registerWorker, QUEUE_NAMES } from "../lib/job-queue";
import logger from "../lib/logger";
import { createNotification } from "./notification-service";

export interface AlertPayload {
  /** Role to fan out to. Resolved to user IDs at dispatch time. */
  alertTarget: string | null;
  /** Optional explicit user IDs in addition to (or instead of) role lookup. */
  recipientUserIds?: number[];
  /** Stable event type — used by the existing notification throttle. */
  eventType: string;
  title: string;
  body?: string;
  /** Free-form entity reference for throttle dedup. */
  entityType?: string;
  entityId?: number;
  projectId?: number;
  projectName?: string;
}

/**
 * Resolve role → list of active user IDs. Returns [] if the role
 * doesn't match anything (the dispatcher logs and skips).
 */
export async function resolveRoleRecipients(role: string): Promise<number[]> {
  if (!role) return [];
  const rows = (await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, role))) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

/**
 * Public entry point. Always enqueues — never blocks the caller. The
 * worker handles throttling via the existing notification_throttle
 * table.
 */
export async function dispatchAlert(payload: AlertPayload): Promise<void> {
  await enqueueJob(QUEUE_NAMES.NOTIFICATION_SEND, payload, {
    attempts: 3,
    // jobId dedup: same alert for the same entity within a short window
    // collapses into one queue job. The DB throttle then handles longer
    // windows and per-recipient dedup.
    jobId:
      payload.entityType && payload.entityId !== undefined
        ? `alert:${payload.eventType}:${payload.entityType}:${payload.entityId}`
        : undefined,
  });
}

/**
 * Worker: drain `notification-send` jobs by resolving recipients and
 * calling createNotification (which already handles per-(user,event,
 * entity) throttling via notification_throttle).
 */
async function notificationSendWorker(data: unknown): Promise<void> {
  const payload = data as AlertPayload;
  if (!payload || typeof payload !== "object") return;

  const recipientIds = new Set<number>();
  if (payload.recipientUserIds && payload.recipientUserIds.length > 0) {
    for (const id of payload.recipientUserIds) recipientIds.add(id);
  }
  if (payload.alertTarget) {
    const roleRecipients = await resolveRoleRecipients(payload.alertTarget);
    for (const id of roleRecipients) recipientIds.add(id);
  }

  if (recipientIds.size === 0) {
    logger.warn(
      `[AlertDispatcher] No recipients resolved for ${payload.eventType} (alertTarget=${payload.alertTarget}). Skipping.`,
    );
    return;
  }

  for (const userId of recipientIds) {
    try {
      await createNotification({
        recipientUserId: userId,
        eventType: payload.eventType,
        title: payload.title,
        body: payload.body,
        projectId: payload.projectId,
        projectName: payload.projectName,
        relatedEntityType: payload.entityType,
        relatedEntityId: payload.entityId,
      });
    } catch (err) {
      // Re-throw so BullMQ retries the whole job. The throttle table
      // makes per-recipient retries idempotent.
      logger.warn(
        `[AlertDispatcher] createNotification failed for user=${userId} event=${payload.eventType}:`,
        err,
      );
      throw err;
    }
  }
}

let workerStarted = false;

/**
 * Idempotent worker bootstrap. Call once from start-runtime-services.
 */
export async function startAlertDispatcherWorker(): Promise<void> {
  if (workerStarted) return;
  workerStarted = true;
  await registerWorker(QUEUE_NAMES.NOTIFICATION_SEND, notificationSendWorker);
}

/**
 * Test-only escape hatch: synchronously process a payload as if a
 * worker had picked it up. Lets unit tests assert the end-to-end
 * behaviour without spinning up a queue.
 */
export async function __processAlertForTests(payload: AlertPayload): Promise<void> {
  await notificationSendWorker(payload);
}
