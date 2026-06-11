/**
 * C1 — Integration health service.
 *
 * One entry point for integrations to log runs (`recordIntegrationRun`)
 * and one entry point for the dashboard to read health tiles
 * (`getIntegrationHealth`).
 *
 * Health derivation (confirmed defaults):
 *   - healthy : last success within HEALTHY_WINDOW_MS
 *   - stale   : no success in HEALTHY_WINDOW_MS, no recent failure
 *   - failing : last run failed OR last failure newer than last success
 *   - unknown : no runs ever recorded
 *
 * Read-only for C1. Alerting on status transitions is wired in C3.
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  integrations,
  integrationRunEvents,
  INTEGRATION_SEED,
  type Integration,
  type IntegrationHealthState,
  type IntegrationRunEvent,
  type IntegrationRunStatus,
} from "@shared/schema";
import { db } from "../db";
import {
  CONNECTOR_CREDENTIALS,
  daysUntilExpiry,
  expiryState,
  parseExpiryDate,
  readConfiguredExpiry,
  type CredentialExpiryState,
  type CredentialKind,
} from "../lib/integration-credentials";
import { getCircuitSnapshot, type CircuitState } from "../lib/http-resilience";
import { getSecretExpiryFromVault } from "../secrets/vault";

/** 25 hours — gives a nightly job one grace hour before going stale. */
export const INTEGRATION_HEALTHY_WINDOW_MS = 25 * 60 * 60 * 1000;

// ===================== HEALTH DERIVATION =====================

/**
 * Pure function: given the most-recent success timestamp and the most
 * recent run (of any status), return the derived health state. Exposed
 * so unit tests can pin the thresholds.
 */
export function deriveIntegrationHealth(params: {
  lastSuccessAt: Date | null;
  lastRunAt: Date | null;
  lastRunStatus: IntegrationRunStatus | null;
  now?: Date;
}): IntegrationHealthState {
  const now = params.now ?? new Date();
  const { lastSuccessAt, lastRunAt, lastRunStatus } = params;

  if (!lastRunAt && !lastSuccessAt) return "unknown";

  // Any run failing and newer than (or equal to) the last success -> failing.
  if (lastRunStatus === "failure") {
    if (!lastSuccessAt || lastRunAt! >= lastSuccessAt) return "failing";
  }

  if (!lastSuccessAt) {
    // Had runs, but no success ever.
    return "failing";
  }

  const ageMs = now.getTime() - lastSuccessAt.getTime();
  if (ageMs <= INTEGRATION_HEALTHY_WINDOW_MS) return "healthy";
  return "stale";
}

// ===================== SEED =====================

/**
 * Idempotent seed: insert any INTEGRATION_SEED row that doesn't already
 * exist by `name`. Called once at boot so the dashboard has tiles
 * before the first run has been logged.
 */
export async function seedIntegrationRegistry(): Promise<{ inserted: number }> {
  let inserted = 0;
  for (const seed of INTEGRATION_SEED) {
    const existing = await db
      .select({ id: integrations.id })
      .from(integrations)
      .where(eq(integrations.name, seed.name))
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(integrations).values({
      name: seed.name,
      displayName: seed.displayName,
      description: seed.description,
      authType: seed.authType,
      ownerProcess: seed.ownerProcess,
      fallbackDescription: seed.fallbackDescription,
      alertTarget: seed.alertTarget,
    });
    inserted += 1;
  }
  return { inserted };
}

// ===================== RECORD RUN =====================

/**
 * Record a single integration run. Creates the integration row on the
 * fly if it doesn't exist yet (so a new connector can self-register
 * the first time it runs without a manual admin step).
 *
 * Callers should pass the start timestamp, final status, and any
 * counts/errors. This function trusts its caller — there is no gate,
 * just append-only audit.
 */
export async function recordIntegrationRun(params: {
  name: string;
  runType?: string | null;
  startedAt: Date;
  finishedAt?: Date | null;
  status: IntegrationRunStatus;
  recordsProcessed?: number | null;
  errorCode?: string | null;
  errorDetail?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<IntegrationRunEvent> {
  // Find-or-create the integration row (lazy registration).
  let [integration] = await db
    .select()
    .from(integrations)
    .where(eq(integrations.name, params.name))
    .limit(1);

  if (!integration) {
    const [inserted] = await db
      .insert(integrations)
      .values({
        name: params.name,
        displayName: params.name,
        authType: "api_key",
        ownerProcess: "unknown (auto-registered on first run)",
      })
      .returning();
    integration = inserted as Integration;
  }

  const [event] = await db
    .insert(integrationRunEvents)
    .values({
      integrationId: integration.id,
      runType: params.runType ?? null,
      startedAt: params.startedAt,
      finishedAt: params.finishedAt ?? null,
      status: params.status,
      recordsProcessed: params.recordsProcessed ?? null,
      errorCode: params.errorCode ?? null,
      errorDetail: params.errorDetail ?? null,
      metadata: (params.metadata as any) ?? null,
    })
    .returning();

  // Touch updated_at on the integration so the dashboard re-sorts.
  await db
    .update(integrations)
    .set({ updatedAt: new Date() })
    .where(eq(integrations.id, integration.id));

  // C3: check for a health-state transition and dispatch an alert if
  // warranted. Wrapped so a failure here never blocks the audit log.
  try {
    const { checkAndDispatchIntegrationAlert } = await import("./integration-alert-monitor");
    await checkAndDispatchIntegrationAlert(integration.id);
  } catch (err) {
    console.warn("[IntegrationHealth] alert dispatch hook failed:", err);
  }

  return event as IntegrationRunEvent;
}

// ===================== READ: DASHBOARD =====================

export interface IntegrationHealthTile {
  integration: Integration;
  health: IntegrationHealthState;
  lastRunAt: Date | null;
  lastRunStatus: IntegrationRunStatus | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
  ageMs: number | null;
  // ----- Credential / connection dimension (R1–R3) -----
  /** Whether the connector holds a usable credential. Null when N/A (static API key). */
  connected: boolean | null;
  /** Kind of lapsing credential this connector carries. */
  credentialKind: CredentialKind;
  /** When the lapsing credential (refresh token / client secret) expires. */
  secretExpiresAt: Date | null;
  /** Whole days until that credential expires. Negative once expired. */
  daysUntilSecretExpiry: number | null;
  /** Banded expiry state: ok | expiring_soon | critical | expired | unknown. */
  secretExpiryState: CredentialExpiryState;
  /** True when a human must reconnect / re-authorise (revoked or expired). */
  reconnectRequired: boolean;
  /** Reconnect path (one-click for QB, admin/runbook anchor for secrets). Null when N/A. */
  reconnectPath: string | null;
  /** Circuit-breaker state for this connector's outbound calls, when one exists. */
  circuitState: CircuitState | null;
}

/**
 * Resolve the credential / connection dimension for a tile: token presence,
 * the lapsing-credential expiry (QB refresh token from metadata; Azure/SharePoint
 * client-secret expiry from the configured date or Key Vault), whether a
 * reconnect is required, and the connector's circuit-breaker state.
 */
function resolveTileCredential(
  integration: Integration,
  lastErrorCode: string | null,
  now: Date,
): {
  connected: boolean | null;
  credentialKind: CredentialKind;
  secretExpiresAt: Date | null;
  daysUntilSecretExpiry: number | null;
  secretExpiryState: CredentialExpiryState;
  reconnectRequired: boolean;
  reconnectPath: string | null;
  circuitState: CircuitState | null;
} {
  const descriptor = CONNECTOR_CREDENTIALS[integration.name];
  const circuitState = getCircuitSnapshot(integration.name)?.state ?? null;

  if (!descriptor) {
    return {
      connected: null,
      credentialKind: "none",
      secretExpiresAt: null,
      daysUntilSecretExpiry: null,
      secretExpiryState: "unknown",
      reconnectRequired: false,
      reconnectPath: null,
      circuitState,
    };
  }

  const meta = (integration.metadata as Record<string, unknown> | null) ?? {};
  let secretExpiresAt: Date | null = null;
  let connected: boolean | null = null;

  if (descriptor.kind === "oauth_refresh_token") {
    // QuickBooks: refresh-token expiry + token presence live in metadata.
    secretExpiresAt = parseExpiryDate(meta.refreshTokenExpiry as string | undefined);
    connected = Boolean(meta.accessToken && meta.refreshToken && meta.realmId);
  } else {
    // Client secret: owner-configured expiry date, else Key Vault expiresOn.
    secretExpiresAt =
      readConfiguredExpiry(descriptor.expiryConfigEnvVar) ??
      (descriptor.vaultExpiryKey ? getSecretExpiryFromVault(descriptor.vaultExpiryKey) : null);
  }

  const days = daysUntilExpiry(secretExpiresAt, now);
  const secretExpiryState = expiryState(days);
  const reconnectRequired =
    lastErrorCode === "needs_reconnect" || secretExpiryState === "expired";

  return {
    connected,
    credentialKind: descriptor.kind,
    secretExpiresAt,
    daysUntilSecretExpiry: days,
    secretExpiryState,
    reconnectRequired,
    reconnectPath: descriptor.reconnectPath,
    circuitState,
  };
}

/**
 * Dashboard query. Loads every active integration + its most recent
 * run / most recent success, then derives the health tile. One round
 * trip per integration for the "latest" lookups — acceptable at our
 * integration count (~single digits) and keeps the query obvious.
 */
export async function getIntegrationHealth(params: { now?: Date } = {}): Promise<{
  generatedAt: string;
  counts: Record<IntegrationHealthState, number>;
  tiles: IntegrationHealthTile[];
}> {
  const now = params.now ?? new Date();
  const integrationRows = await db
    .select()
    .from(integrations)
    .where(isNull(integrations.deletedAt))
    .orderBy(integrations.name);

  const tiles: IntegrationHealthTile[] = [];
  const counts: Record<IntegrationHealthState, number> = {
    healthy: 0,
    stale: 0,
    failing: 0,
    unknown: 0,
  };

  for (const integration of integrationRows as Integration[]) {
    const [lastRun] = await db
      .select()
      .from(integrationRunEvents)
      .where(eq(integrationRunEvents.integrationId, integration.id))
      .orderBy(desc(integrationRunEvents.startedAt))
      .limit(1);

    const [lastSuccess] = await db
      .select()
      .from(integrationRunEvents)
      .where(
        and(
          eq(integrationRunEvents.integrationId, integration.id),
          eq(integrationRunEvents.status, "success"),
        ),
      )
      .orderBy(desc(integrationRunEvents.startedAt))
      .limit(1);

    const [lastFailure] = await db
      .select()
      .from(integrationRunEvents)
      .where(
        and(
          eq(integrationRunEvents.integrationId, integration.id),
          eq(integrationRunEvents.status, "failure"),
        ),
      )
      .orderBy(desc(integrationRunEvents.startedAt))
      .limit(1);

    const lastRunAt = (lastRun as IntegrationRunEvent | undefined)?.startedAt ?? null;
    const lastRunStatus =
      ((lastRun as IntegrationRunEvent | undefined)?.status as IntegrationRunStatus | undefined) ??
      null;
    const lastSuccessAt =
      (lastSuccess as IntegrationRunEvent | undefined)?.startedAt ?? null;
    const lastFailureAt =
      (lastFailure as IntegrationRunEvent | undefined)?.startedAt ?? null;

    const health = deriveIntegrationHealth({
      lastSuccessAt,
      lastRunAt,
      lastRunStatus,
      now,
    });
    counts[health] += 1;

    const lastErrorCode =
      (lastRun as IntegrationRunEvent | undefined)?.errorCode ?? null;
    const credential = resolveTileCredential(integration, lastErrorCode, now);

    tiles.push({
      integration,
      health,
      lastRunAt,
      lastRunStatus,
      lastSuccessAt,
      lastFailureAt,
      lastErrorCode,
      lastErrorDetail:
        (lastRun as IntegrationRunEvent | undefined)?.errorDetail ?? null,
      ageMs: lastSuccessAt ? now.getTime() - lastSuccessAt.getTime() : null,
      ...credential,
    });
  }

  return {
    generatedAt: now.toISOString(),
    counts,
    tiles,
  };
}

// ===================== READ: RUN HISTORY =====================

/**
 * Paginated run history for a single integration (by name). Used by
 * the "view runs" drawer on the dashboard.
 */
export async function getIntegrationRunHistory(params: {
  name: string;
  limit?: number;
}): Promise<IntegrationRunEvent[]> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 500);
  const [integration] = await db
    .select()
    .from(integrations)
    .where(eq(integrations.name, params.name))
    .limit(1);
  if (!integration) return [];
  const rows = await db
    .select()
    .from(integrationRunEvents)
    .where(eq(integrationRunEvents.integrationId, (integration as Integration).id))
    .orderBy(desc(integrationRunEvents.startedAt))
    .limit(limit);
  return rows as IntegrationRunEvent[];
}

// ===================== ADMIN: REGISTER =====================

/**
 * Upsert a connector entry. Admin surface — used to pre-register a
 * connector or to edit its metadata (fallback description, alert
 * target, etc.) from the admin UI.
 */
export async function upsertIntegration(params: {
  name: string;
  displayName?: string;
  description?: string | null;
  authType?: string;
  ownerProcess?: string | null;
  fallbackDescription?: string | null;
  alertTarget?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<Integration> {
  const [existing] = await db
    .select()
    .from(integrations)
    .where(eq(integrations.name, params.name))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(integrations)
      .set({
        displayName: params.displayName ?? (existing as Integration).displayName,
        description: params.description ?? (existing as Integration).description,
        authType: params.authType ?? (existing as Integration).authType,
        ownerProcess: params.ownerProcess ?? (existing as Integration).ownerProcess,
        fallbackDescription:
          params.fallbackDescription ?? (existing as Integration).fallbackDescription,
        alertTarget: params.alertTarget ?? (existing as Integration).alertTarget,
        metadata: (params.metadata as any) ?? (existing as Integration).metadata,
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, (existing as Integration).id))
      .returning();
    return updated as Integration;
  }

  const [inserted] = await db
    .insert(integrations)
    .values({
      name: params.name,
      displayName: params.displayName ?? params.name,
      description: params.description ?? null,
      authType: params.authType ?? "api_key",
      ownerProcess: params.ownerProcess ?? null,
      fallbackDescription: params.fallbackDescription ?? null,
      alertTarget: params.alertTarget ?? null,
      metadata: (params.metadata as any) ?? null,
    })
    .returning();
  return inserted as Integration;
}
