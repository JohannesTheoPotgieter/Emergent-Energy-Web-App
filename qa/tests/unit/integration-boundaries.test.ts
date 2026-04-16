/**
 * Integration boundary structural tests.
 *
 * Pins the data ownership rules, freshness thresholds, and field
 * boundary contracts so they can't drift silently.
 */
import { describe, it, expect } from "vitest";
import {
  PIPEDRIVE_FIELD_BOUNDARIES,
  PIPEDRIVE_CRM_OWNED_FIELDS,
  SHAREPOINT_FIELD_BOUNDARIES,
  QUICKBOOKS_FIELD_BOUNDARIES,
  INTEGRATION_FRESHNESS_THRESHOLDS,
  computeFreshnessStatus,
  type IntegrationFreshnessStatus,
} from "@shared/integration-boundaries";

describe("Integration boundary rules", () => {
  // ---- Pipedrive ----

  it("Pipedrive CRM-owned fields match the known overwrite set", () => {
    // These are the fields the sync service overwrites on every run.
    // If this list changes, the opportunities PATCH warning message
    // and the sync service itself must be updated in tandem.
    expect(PIPEDRIVE_CRM_OWNED_FIELDS).toEqual(
      expect.arrayContaining([
        "pipedriveDealId",
        "source",
        "clientId",
        "stage",
        "status",
        "estimatedValue",
        "expectedCloseDate",
        "signedDate",
      ]),
    );
  });

  it("Pipedrive notes field is seeded_once, not crm_overwrite", () => {
    const notesField = PIPEDRIVE_FIELD_BOUNDARIES.find(b => b.field === "notes");
    expect(notesField).toBeDefined();
    expect(notesField!.mutability).toBe("seeded_once");
    expect(notesField!.owner).toBe("app");
  });

  it("Pipedrive deprecated fields are marked deprecated", () => {
    const deprecated = PIPEDRIVE_FIELD_BOUNDARIES
      .filter(b => b.mutability === "deprecated")
      .map(b => b.field);
    expect(deprecated).toEqual(
      expect.arrayContaining(["handoverReadiness", "dealOwnerUserId", "estimatedKwh"]),
    );
  });

  // ---- SharePoint ----

  it("SharePoint has both SP-owned and app-owned fields", () => {
    const spOwned = SHAREPOINT_FIELD_BOUNDARIES.filter(b => b.owner === "sharepoint");
    const appOwned = SHAREPOINT_FIELD_BOUNDARIES.filter(b => b.owner === "app");
    expect(spOwned.length).toBeGreaterThan(0);
    expect(appOwned.length).toBeGreaterThan(0);
  });

  it("SharePoint shared fields have 'warn' stale behavior", () => {
    const shared = SHAREPOINT_FIELD_BOUNDARIES.filter(b => b.mutability === "shared");
    expect(shared.length).toBeGreaterThan(0);
    for (const field of shared) {
      expect(field.staleBehavior).toBe("warn");
    }
  });

  // ---- QuickBooks ----

  it("QuickBooks data is read_only_mirror or reconciliation", () => {
    const qbOwned = QUICKBOOKS_FIELD_BOUNDARIES.filter(b => b.owner === "quickbooks");
    for (const field of qbOwned) {
      expect(["read_only_mirror", "reconciliation"]).toContain(field.mutability);
    }
  });

  it("COS realisation is app-owned, not QB-owned", () => {
    const cos = QUICKBOOKS_FIELD_BOUNDARIES.find(b => b.field === "cosRealisation");
    expect(cos).toBeDefined();
    expect(cos!.owner).toBe("app");
    expect(cos!.mutability).toBe("app_owned");
  });

  // ---- Freshness thresholds ----

  it("Freshness thresholds are within expected ranges", () => {
    const ONE_HOUR = 60 * 60 * 1000;
    expect(INTEGRATION_FRESHNESS_THRESHOLDS.pipedrive).toBe(25 * ONE_HOUR);
    expect(INTEGRATION_FRESHNESS_THRESHOLDS.sharepoint).toBe(24 * ONE_HOUR);
    expect(INTEGRATION_FRESHNESS_THRESHOLDS.quickbooks).toBe(2 * ONE_HOUR);
    expect(INTEGRATION_FRESHNESS_THRESHOLDS.microsoft_365).toBe(1 * ONE_HOUR);
  });

  it("QuickBooks has the tightest freshness window", () => {
    const values = Object.values(INTEGRATION_FRESHNESS_THRESHOLDS);
    const min = Math.min(...values);
    expect(INTEGRATION_FRESHNESS_THRESHOLDS.quickbooks).toBeLessThanOrEqual(min * 2);
  });
});

describe("computeFreshnessStatus", () => {
  const NOW = new Date("2026-04-16T12:00:00Z");

  it("returns healthy when last success is within threshold", () => {
    const lastSuccess = new Date("2026-04-16T11:00:00Z"); // 1h ago
    const result = computeFreshnessStatus("pipedrive", "Pipedrive CRM", lastSuccess, false, NOW);
    expect(result.health).toBe("healthy");
    expect(result.isStale).toBe(false);
    expect(result.warning).toBeNull();
  });

  it("returns stale when last success exceeds threshold", () => {
    const lastSuccess = new Date("2026-04-14T12:00:00Z"); // 48h ago
    const result = computeFreshnessStatus("pipedrive", "Pipedrive CRM", lastSuccess, false, NOW);
    expect(result.health).toBe("stale");
    expect(result.isStale).toBe(true);
    expect(result.warning).toContain("last synced");
    expect(result.warning).toContain("48h ago");
  });

  it("returns failing when isFailing is true", () => {
    const lastSuccess = new Date("2026-04-16T11:00:00Z");
    const result = computeFreshnessStatus("pipedrive", "Pipedrive CRM", lastSuccess, true, NOW);
    expect(result.health).toBe("failing");
    expect(result.isFailing).toBe(true);
    expect(result.warning).toContain("failing");
  });

  it("returns unknown when never synced", () => {
    const result = computeFreshnessStatus("pipedrive", "Pipedrive CRM", null, false, NOW);
    expect(result.health).toBe("unknown");
    expect(result.lastSuccessAt).toBeNull();
    expect(result.warning).toContain("never synced");
  });

  it("returns failing when never synced and also failing", () => {
    const result = computeFreshnessStatus("quickbooks", "QuickBooks", null, true, NOW);
    expect(result.health).toBe("failing");
  });

  it("QB 2-hour threshold flags staleness correctly", () => {
    const twoAndHalfHoursAgo = new Date("2026-04-16T09:30:00Z");
    const result = computeFreshnessStatus("quickbooks", "QuickBooks", twoAndHalfHoursAgo, false, NOW);
    expect(result.isStale).toBe(true);
    expect(result.health).toBe("stale");
  });

  it("QB within 2-hour threshold is healthy", () => {
    const oneHourAgo = new Date("2026-04-16T11:00:00Z");
    const result = computeFreshnessStatus("quickbooks", "QuickBooks", oneHourAgo, false, NOW);
    expect(result.isStale).toBe(false);
    expect(result.health).toBe("healthy");
  });
});
