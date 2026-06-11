/**
 * Integration credential-expiry domain logic.
 *
 * Tokens auto-refresh; the credentials that DON'T self-heal in a long
 * unattended freeze are the ones that lapse on a fixed clock:
 *   - QuickBooks refresh token (hard-expires ~100 days; rotates on use)
 *   - Azure app client secret(s) (typically 180 days; manual rotation only)
 *
 * This module is the single source of truth for:
 *   - which connector carries which lapsing credential (CONNECTOR_CREDENTIALS)
 *   - how many days until it expires, and the resulting state band
 *   - the threshold "bucket" logic that fires an owner alert at 30 / 7 / 0 days
 *     exactly once per bucket (no daily spam, auto-resets after a rotation)
 *
 * Pure + side-effect-free apart from reading the configured expiry-date env
 * vars (which the rotation runbook instructs ops to set). No DB, no network.
 */

// ===================== TYPES + DESCRIPTORS =====================

/** Alert thresholds, in days before expiry. Plus an implicit 0 (= expired). */
export const CREDENTIAL_EXPIRY_ALERT_THRESHOLD_DAYS = [30, 7] as const;

export type CredentialKind = "oauth_refresh_token" | "client_secret" | "none";

export type CredentialExpiryState =
  | "ok" // > 30 days out
  | "expiring_soon" // <= 30 days
  | "critical" // <= 7 days
  | "expired" // past expiry
  | "unknown"; // no expiry known

export interface ConnectorCredentialDescriptor {
  /** Integration registry `name`. */
  name: string;
  kind: CredentialKind;
  /** Human label for the credential that lapses (used in alert copy / tiles). */
  credentialLabel: string;
  /**
   * ISO-date env var the owner records at rotation time, e.g.
   * AZURE_CLIENT_SECRET_EXPIRES_ON. This is a DATE, not a secret — safe as
   * plain config. Lets the app count down without Key Vault access (Replit).
   */
  expiryConfigEnvVar?: string;
  /**
   * Key Vault secret name whose `properties.expiresOn` can supply the expiry
   * on Azure-hosted deploys (see server/secrets/vault.ts).
   */
  vaultExpiryKey?: string;
  /** One-click reconnect (QB OAuth) or the admin/runbook anchor for ops rotation. */
  reconnectPath: string;
  /** True when reconnect is an in-app one-click action; false when it's an ops task. */
  reconnectIsOneClick: boolean;
}

/**
 * The connectors that carry a lapsing credential. Pipedrive / ClickUp use
 * static API keys with no expiry and are intentionally absent.
 */
export const CONNECTOR_CREDENTIALS: Record<string, ConnectorCredentialDescriptor> = {
  quickbooks: {
    name: "quickbooks",
    kind: "oauth_refresh_token",
    credentialLabel: "QuickBooks refresh token",
    reconnectPath: "/api/quickbooks/auth",
    reconnectIsOneClick: true,
  },
  microsoft_365: {
    name: "microsoft_365",
    kind: "client_secret",
    credentialLabel: "Azure app client secret (AZURE_CLIENT_SECRET)",
    expiryConfigEnvVar: "AZURE_CLIENT_SECRET_EXPIRES_ON",
    vaultExpiryKey: "AZURE_CLIENT_SECRET",
    reconnectPath: "/admin/integrations",
    reconnectIsOneClick: false,
  },
  sharepoint: {
    name: "sharepoint",
    kind: "client_secret",
    credentialLabel: "SharePoint app client secret (SHAREPOINT_CLIENT_SECRET)",
    expiryConfigEnvVar: "SHAREPOINT_CLIENT_SECRET_EXPIRES_ON",
    vaultExpiryKey: "SHAREPOINT_CLIENT_SECRET",
    reconnectPath: "/admin/integrations",
    reconnectIsOneClick: false,
  },
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ===================== EXPIRY MATH =====================

/** Parse an ISO / date string into a Date, or null when blank / unparseable. */
export function parseExpiryDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const t = Date.parse(trimmed);
  return Number.isNaN(t) ? null : new Date(t);
}

/** Read the owner-configured expiry date from its env var (if any). */
export function readConfiguredExpiry(envVar: string | undefined): Date | null {
  if (!envVar) return null;
  return parseExpiryDate(process.env[envVar]);
}

/** Whole days until expiry (floored). Negative once expired. Null when unknown. */
export function daysUntilExpiry(expiresAt: Date | null, now: Date = new Date()): number | null {
  if (!expiresAt) return null;
  return Math.floor((expiresAt.getTime() - now.getTime()) / MS_PER_DAY);
}

/** Map days-until-expiry to a coarse state band for tiles + alert copy. */
export function expiryState(days: number | null): CredentialExpiryState {
  if (days === null) return "unknown";
  if (days <= 0) return "expired";
  if (days <= 7) return "critical";
  if (days <= 30) return "expiring_soon";
  return "ok";
}

/**
 * The most-urgent alert bucket the credential has entered:
 *   0 = expired, 7 = within a week, 30 = within a month, null = >30 days / unknown.
 * Buckets get numerically smaller as urgency rises — shouldFireExpiryAlert
 * relies on that ordering to fire once per escalation.
 */
export function expiryAlertBucket(days: number | null): number | null {
  if (days === null) return null;
  if (days <= 0) return 0;
  if (days <= 7) return 7;
  if (days <= 30) return 30;
  return null;
}

/**
 * Fire only when the credential has escalated into a more-urgent bucket than
 * the last one we alerted on. A null `lastFiredBucket` (never alerted, or reset
 * after a rotation) fires on any non-null current bucket. Equal buckets do not
 * re-fire, so the daily sweep never spams.
 */
export function shouldFireExpiryAlert(
  currentBucket: number | null,
  lastFiredBucket: number | null | undefined,
): boolean {
  if (currentBucket === null) return false;
  if (lastFiredBucket === null || lastFiredBucket === undefined) return true;
  return currentBucket < lastFiredBucket;
}

// ===================== PERSISTED DEDUP STATE =====================

/**
 * Stored on integrations.metadata.credentialAlert so the daily sweep fires
 * each escalation once. A rotation (new expiry date) clears it via the
 * scheduler so the next expiry cycle alerts afresh.
 */
export interface CredentialAlertState {
  /** Most-urgent bucket already alerted on (30 | 7 | 0). */
  lastFiredBucket?: number | null;
  /** ISO timestamp of the last fired alert (audit). */
  lastFiredAt?: string;
  /** Expiry date last evaluated — a change means the secret was rotated. */
  lastExpiryIso?: string | null;
}

// ===================== ALERT COPY =====================

/**
 * Build the owner-facing alert for an expiring / expired credential. Distinct
 * eventType per state so the notification throttle dedups correctly, and the
 * body always names the concrete next action (one-click re-auth for QB, the
 * ~15-min ops rotation for an Azure secret).
 */
export function buildCredentialExpiryAlertCopy(params: {
  displayName: string;
  descriptor: ConnectorCredentialDescriptor;
  daysUntil: number;
  expiresAt: Date;
}): { eventType: string; title: string; body: string } {
  const { displayName, descriptor, daysUntil, expiresAt } = params;
  const when = expiresAt.toISOString().slice(0, 10);
  const noun = descriptor.credentialLabel;
  const action = descriptor.reconnectIsOneClick
    ? `Re-authorise in one click from ${descriptor.reconnectPath}.`
    : `Rotate the secret (ops task, ~15 min — see docs/runbooks/secrets-rotation.md), then update ${descriptor.expiryConfigEnvVar ?? "the expiry-date config"}.`;

  if (daysUntil <= 0) {
    return {
      eventType: "integration_credential_expired",
      title: `Action required: ${displayName} ${noun} has expired`,
      body: `${displayName}'s ${noun} expired on ${when}. The integration will fail until it is renewed. ${action}`,
    };
  }
  return {
    eventType: "integration_credential_expiring",
    title: `${displayName} ${noun} expires in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`,
    body: `${displayName}'s ${noun} expires on ${when} (${daysUntil} day${daysUntil === 1 ? "" : "s"} away). Renew it before then to avoid an outage. ${action}`,
  };
}

// ===================== TILE SUMMARY =====================

export interface CredentialExpirySummary {
  kind: CredentialKind;
  expiresAt: Date | null;
  daysUntilExpiry: number | null;
  state: CredentialExpiryState;
}

/** One-call summary for a tile / status payload. */
export function summariseCredentialExpiry(
  expiresAt: Date | null,
  kind: CredentialKind,
  now: Date = new Date(),
): CredentialExpirySummary {
  const days = daysUntilExpiry(expiresAt, now);
  return { kind, expiresAt, daysUntilExpiry: days, state: expiryState(days) };
}
