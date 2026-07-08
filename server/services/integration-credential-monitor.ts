/**
 * Proactive credential-expiry monitor.
 *
 * Tokens auto-refresh; the credentials that lapse on a fixed clock during a
 * long unattended freeze do NOT self-heal:
 *   - QuickBooks refresh token (hard-expires ~100 days)
 *   - Azure / SharePoint app client secrets (~180 days, manual rotation)
 *
 * This sweep runs daily, counts down each connector's lapsing credential, and
 * pages the connector's `alertTarget` (COO_ADMIN) once per escalation at
 * 30 / 7 / 0 days — well before the credential lapses and silently breaks the
 * integration. Dedup state lives on `integrations.metadata.credentialAlert`
 * and auto-resets after a rotation moves the expiry date forward.
 *
 * Reuses the existing C3 alert pipeline (dispatchAlert → notification queue →
 * COO_ADMIN inbox). It does NOT touch the reactive needs_reconnect path — a
 * revoked token still surfaces via the run-event health transition.
 */

import { eq, isNull } from "drizzle-orm";
import { integrations, type Integration } from "@shared/schema";
import { db } from "../db";
import { dispatchAlert } from "./alert-dispatcher-service";
import { getSecretExpiryFromVault } from "../secrets/vault";
import {
  CONNECTOR_CREDENTIALS,
  buildCredentialExpiryAlertCopy,
  daysUntilExpiry,
  expiryAlertBucket,
  parseExpiryDate,
  readConfiguredExpiry,
  shouldFireExpiryAlert,
  type ConnectorCredentialDescriptor,
  type CredentialAlertState,
} from "../lib/integration-credentials";

/** Resolve the lapsing credential's expiry for one connector, or null when unknown. */
function resolveExpiry(
  descriptor: ConnectorCredentialDescriptor,
  rawMetadata: Record<string, unknown>,
): Date | null {
  if (descriptor.kind === "oauth_refresh_token") {
    // QuickBooks refresh-token expiry (plaintext field in metadata).
    return parseExpiryDate(rawMetadata.refreshTokenExpiry as string | undefined);
  }
  // Client secret: prefer the owner-configured date, fall back to Key Vault.
  return (
    readConfiguredExpiry(descriptor.expiryConfigEnvVar) ??
    (descriptor.vaultExpiryKey ? getSecretExpiryFromVault(descriptor.vaultExpiryKey) : null)
  );
}

export interface CredentialSweepResult {
  name: string;
  daysUntilExpiry: number | null;
  bucket: number | null;
  fired: boolean;
}

/**
 * Run one credential-expiry sweep across all credential-bearing connectors.
 * Pure-ish: the only side effects are dispatching alerts and persisting the
 * per-connector dedup state. Safe to call repeatedly (idempotent within a
 * bucket). Exported so the scheduler and unit tests can drive it.
 */
export async function sweepCredentialExpiries(
  now: Date = new Date(),
): Promise<{ checked: number; alertsFired: number; results: CredentialSweepResult[] }> {
  const rows = (await db
    .select()
    .from(integrations)
    .where(isNull(integrations.deletedAt))) as Integration[];

  const results: CredentialSweepResult[] = [];
  let alertsFired = 0;

  for (const integration of rows) {
    const descriptor = CONNECTOR_CREDENTIALS[integration.name];
    if (!descriptor) continue;

    const rawMetadata = ((integration.metadata as Record<string, unknown> | null) ?? {}) as Record<
      string,
      unknown
    >;
    const expiresAt = resolveExpiry(descriptor, rawMetadata);
    const days = daysUntilExpiry(expiresAt, now);
    const bucket = expiryAlertBucket(days);

    const prevState = (rawMetadata.credentialAlert as CredentialAlertState | undefined) ?? {};
    const currentExpiryIso = expiresAt ? expiresAt.toISOString() : null;

    // If the expiry date moved (a rotation happened), forget the last bucket so
    // the next expiry cycle alerts afresh.
    const rotated = !!prevState.lastExpiryIso && prevState.lastExpiryIso !== currentExpiryIso;
    const effectiveLastBucket = rotated ? null : prevState.lastFiredBucket ?? null;

    let fired = false;
    let nextState: CredentialAlertState;

    if (expiresAt && days !== null && shouldFireExpiryAlert(bucket, effectiveLastBucket)) {
      const copy = buildCredentialExpiryAlertCopy({
        displayName: integration.displayName || integration.name,
        descriptor,
        daysUntil: days,
        expiresAt,
      });
      await dispatchAlert({
        // Fall back to COO_ADMIN (the owner) when a connector row has no explicit
        // alertTarget — otherwise the dispatcher resolves zero recipients and the
        // expiry alert is silently dropped, letting a credential lapse unnoticed.
        alertTarget: integration.alertTarget ?? "COO_ADMIN",
        eventType: copy.eventType,
        title: copy.title,
        body: copy.body,
        entityType: "integration",
        entityId: integration.id,
      });
      fired = true;
      alertsFired += 1;
      nextState = {
        lastFiredBucket: bucket,
        lastFiredAt: now.toISOString(),
        lastExpiryIso: currentExpiryIso,
      };
    } else if (bucket === null) {
      // Comfortably in the future (or unknown) — clear any stale dedup so a
      // future approach to expiry re-alerts from scratch.
      nextState = { lastFiredBucket: null, lastExpiryIso: currentExpiryIso };
    } else {
      // In a bucket we've already alerted on — keep the record, refresh expiry.
      nextState = {
        lastFiredBucket: effectiveLastBucket,
        lastFiredAt: prevState.lastFiredAt,
        lastExpiryIso: currentExpiryIso,
      };
    }

    await persistCredentialAlertState(integration.id, rawMetadata, nextState);
    results.push({ name: integration.name, daysUntilExpiry: days, bucket, fired });
  }

  return { checked: results.length, alertsFired, results };
}

/**
 * Merge the dedup state back into the connector's metadata. The raw metadata is
 * written through untouched — for QuickBooks that preserves the ENCRYPTED token
 * fields exactly as stored (this path never decrypts them).
 */
async function persistCredentialAlertState(
  integrationId: number,
  rawMetadata: Record<string, unknown>,
  state: CredentialAlertState,
): Promise<void> {
  await db
    .update(integrations)
    .set({
      metadata: { ...rawMetadata, credentialAlert: state } as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, integrationId));
}
