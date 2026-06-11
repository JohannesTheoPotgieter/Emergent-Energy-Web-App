/**
 * Integration credential-expiry domain logic.
 *
 * Pins the freeze-hardening contract: count down each lapsing credential and
 * page the owner once per escalation at 30 / 7 / 0 days — never daily spam,
 * and auto-resets after a rotation. Pure functions, no DB / network.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  CONNECTOR_CREDENTIALS,
  parseExpiryDate,
  readConfiguredExpiry,
  daysUntilExpiry,
  expiryState,
  expiryAlertBucket,
  shouldFireExpiryAlert,
  buildCredentialExpiryAlertCopy,
  summariseCredentialExpiry,
} from "../../../server/lib/integration-credentials";

const NOW = new Date("2026-06-11T00:00:00.000Z");
function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
}

describe("parseExpiryDate / readConfiguredExpiry", () => {
  it("parses ISO dates and rejects junk", () => {
    expect(parseExpiryDate("2026-12-01")?.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(parseExpiryDate("")).toBeNull();
    expect(parseExpiryDate(null)).toBeNull();
    expect(parseExpiryDate("not-a-date")).toBeNull();
  });

  it("reads a configured expiry env var", () => {
    const KEY = "TEST_SECRET_EXPIRES_ON_XYZ";
    process.env[KEY] = "2026-10-15";
    try {
      expect(readConfiguredExpiry(KEY)?.toISOString().slice(0, 10)).toBe("2026-10-15");
      expect(readConfiguredExpiry(undefined)).toBeNull();
      expect(readConfiguredExpiry("DEFINITELY_UNSET_VAR_ABC")).toBeNull();
    } finally {
      delete process.env[KEY];
    }
  });
});

describe("daysUntilExpiry / expiryState / expiryAlertBucket", () => {
  it("computes whole days until expiry", () => {
    expect(daysUntilExpiry(daysFromNow(30), NOW)).toBe(30);
    expect(daysUntilExpiry(daysFromNow(0.4), NOW)).toBe(0);
    expect(daysUntilExpiry(daysFromNow(-3), NOW)).toBe(-3);
    expect(daysUntilExpiry(null, NOW)).toBeNull();
  });

  it("bands the expiry state", () => {
    expect(expiryState(60)).toBe("ok");
    expect(expiryState(30)).toBe("expiring_soon");
    expect(expiryState(7)).toBe("critical");
    expect(expiryState(0)).toBe("expired");
    expect(expiryState(-1)).toBe("expired");
    expect(expiryState(null)).toBe("unknown");
  });

  it("maps days to alert buckets (smaller = more urgent)", () => {
    expect(expiryAlertBucket(40)).toBeNull();
    expect(expiryAlertBucket(30)).toBe(30);
    expect(expiryAlertBucket(8)).toBe(30);
    expect(expiryAlertBucket(7)).toBe(7);
    expect(expiryAlertBucket(0)).toBe(0);
    expect(expiryAlertBucket(-5)).toBe(0);
    expect(expiryAlertBucket(null)).toBeNull();
  });
});

describe("shouldFireExpiryAlert — escalation dedup", () => {
  it("fires once on first entry into each bucket, never on the same bucket twice", () => {
    // never alerted → fire at 30
    expect(shouldFireExpiryAlert(30, null)).toBe(true);
    // already alerted at 30, still 30 → suppress
    expect(shouldFireExpiryAlert(30, 30)).toBe(false);
    // escalate 30 → 7 → fire
    expect(shouldFireExpiryAlert(7, 30)).toBe(true);
    // already at 7 → suppress
    expect(shouldFireExpiryAlert(7, 7)).toBe(false);
    // escalate 7 → expired(0) → fire
    expect(shouldFireExpiryAlert(0, 7)).toBe(true);
    // already expired → suppress
    expect(shouldFireExpiryAlert(0, 0)).toBe(false);
  });

  it("never fires when comfortably in the future or unknown", () => {
    expect(shouldFireExpiryAlert(null, null)).toBe(false);
    expect(shouldFireExpiryAlert(null, 7)).toBe(false);
  });
});

describe("buildCredentialExpiryAlertCopy", () => {
  it("gives QuickBooks an actionable one-click re-auth message while expiring", () => {
    const copy = buildCredentialExpiryAlertCopy({
      displayName: "QuickBooks Online",
      descriptor: CONNECTOR_CREDENTIALS.quickbooks,
      daysUntil: 7,
      expiresAt: daysFromNow(7),
    });
    expect(copy.eventType).toBe("integration_credential_expiring");
    expect(copy.title).toContain("expires in 7 days");
    expect(copy.body).toContain("/api/quickbooks/auth");
  });

  it("points client-secret connectors at the ops rotation runbook", () => {
    const copy = buildCredentialExpiryAlertCopy({
      displayName: "Microsoft 365 (SSO + Graph)",
      descriptor: CONNECTOR_CREDENTIALS.microsoft_365,
      daysUntil: 30,
      expiresAt: daysFromNow(30),
    });
    expect(copy.body).toContain("secrets-rotation.md");
    expect(copy.body).toContain("AZURE_CLIENT_SECRET_EXPIRES_ON");
  });

  it("switches to an 'expired' alert once past the date", () => {
    const copy = buildCredentialExpiryAlertCopy({
      displayName: "QuickBooks Online",
      descriptor: CONNECTOR_CREDENTIALS.quickbooks,
      daysUntil: 0,
      expiresAt: NOW,
    });
    expect(copy.eventType).toBe("integration_credential_expired");
    expect(copy.title).toContain("has expired");
  });
});

describe("CONNECTOR_CREDENTIALS registry", () => {
  it("models QB as a one-click OAuth refresh token and Azure/SharePoint as ops-rotated secrets", () => {
    expect(CONNECTOR_CREDENTIALS.quickbooks.kind).toBe("oauth_refresh_token");
    expect(CONNECTOR_CREDENTIALS.quickbooks.reconnectIsOneClick).toBe(true);
    expect(CONNECTOR_CREDENTIALS.microsoft_365.kind).toBe("client_secret");
    expect(CONNECTOR_CREDENTIALS.microsoft_365.reconnectIsOneClick).toBe(false);
    expect(CONNECTOR_CREDENTIALS.sharepoint.expiryConfigEnvVar).toBe(
      "SHAREPOINT_CLIENT_SECRET_EXPIRES_ON",
    );
  });
});

describe("summariseCredentialExpiry", () => {
  it("rolls expiry into a single tile summary", () => {
    const s = summariseCredentialExpiry(daysFromNow(5), "client_secret", NOW);
    expect(s).toMatchObject({ kind: "client_secret", daysUntilExpiry: 5, state: "critical" });
    const none = summariseCredentialExpiry(null, "none", NOW);
    expect(none.state).toBe("unknown");
  });
});

afterEach(() => {
  // Defensive — no shared state, but keeps env clean if a case adds vars.
});
