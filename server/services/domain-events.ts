/**
 * Prompt 13 — Domain Events Emitter Service
 *
 * Inserts structured domain events into the domain_events table.
 * Events are stored for future processing by an event dispatcher
 * that reads subscriptions and dispatches to handlers.
 *
 * TODO: Wire up event processor to read subscriptions and dispatch.
 * See docs/spine-v2/07-event-emit-points.md for emit point catalog.
 */

import { db } from "../db";
import { domainEvents, type DomainEvent } from "@shared/schema";

export interface EmitDomainEventParams {
  type: string;
  aggregateType: string;
  aggregateId: number;
  projectId?: number | null;
  triggeredBy?: number | null;
  payload: Record<string, unknown>;
}

/**
 * Emit a domain event by inserting it into the domain_events table.
 *
 * Events are stored with processed_at = NULL (unprocessed).
 * A future event processor will:
 *   1. Poll for unprocessed events
 *   2. Match event_type against event_subscriptions (supports wildcards)
 *   3. Dispatch to registered handlers
 *   4. Log results in event_processing_log
 *   5. Mark events as processed
 *
 * TODO: Wire up event processor to read subscriptions and dispatch
 */
export async function emitDomainEvent(
  params: EmitDomainEventParams,
): Promise<DomainEvent> {
  const [event] = await db
    .insert(domainEvents)
    .values({
      eventType: params.type,
      aggregateType: params.aggregateType,
      aggregateId: params.aggregateId,
      projectId: params.projectId ?? null,
      triggeredBy: params.triggeredBy ?? null,
      payload: params.payload,
    })
    .returning();

  return event;
}

/**
 * Fire-and-forget wrapper that logs errors but never throws.
 * Use this in route handlers to avoid blocking the HTTP response.
 */
export function emitDomainEventAsync(params: EmitDomainEventParams): void {
  emitDomainEvent(params).catch((err) =>
    console.warn(
      `[domain-events] Failed to emit ${params.type}:`,
      err.message,
    ),
  );
}
