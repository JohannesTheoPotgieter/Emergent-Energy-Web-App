/**
 * Unit tests for the centralised Pipedrive → app field mapping registry
 * and the structured error classifier.
 *
 * Pairs with task #29 (Pipedrive sync hardening, 2026-04-22).
 *
 * Scope: pure functions only. The DB-touching parts of the sync service
 * (schema self-check, client resolution, idempotent UPDATE) are exercised
 * separately in the integration suite — keeping these tests pure means
 * they run in milliseconds and gate every push.
 */
import { describe, expect, it } from "vitest";
import {
  buildCrmOwnedFieldsFromDeal,
  classifySyncError,
  coerceOrgIdToText,
  PIPEDRIVE_APP_OWNED_COLUMNS,
  PIPEDRIVE_CUSTOM_FIELD_KEYS,
  PIPEDRIVE_FIELD_REGISTRY,
  PIPEDRIVE_WRITABLE_COLUMNS,
  asNumericString,
  pipedriveDateOnly,
  resolveProvinceFromLeadLocation,
  renderLabels,
} from "../../../server/services/pipedrive-field-mapping";

const MIN_DEAL = {
  id: 42,
  title: "Acme Solar EPC",
  value: 1_500_000,
  currency: "ZAR",
  stage_id: 1,
  status: "open",
  expected_close_date: "2026-09-01",
  update_time: "2026-04-22 10:00:00",
  stage_change_time: "2026-04-20 14:00:00",
  activities_count: 3,
  last_activity_date: "2026-04-21",
  next_activity_date: "2026-04-25",
  next_activity_subject: "Site visit",
  label: "1,2",
  won_time: null,
  lost_time: null,
  lost_reason: null,
  probability: 60,
  weighted_value: 900_000,
  [PIPEDRIVE_CUSTOM_FIELD_KEYS.systemSizeKwp]: "850",
  [PIPEDRIVE_CUSTOM_FIELD_KEYS.batterySizeKwh]: "1200",
  [PIPEDRIVE_CUSTOM_FIELD_KEYS.leadLocation]: "65,71",
} as Record<string, unknown>;

const CTX = {
  stageName: "Proposal",
  labelMap: new Map([["1", "Hot"], ["2", "Q3"]]),
  appStage: "proposal",
  appStatus: "active",
  enrichment: {
    ownerUserId: 7,
    ownerName: "Jane Doe",
    personName: "John Smith",
    personEmail: "john@acme.co.za",
    personPhone: "+27 11 555 0001",
  },
  clientId: 99,
};

describe("Pipedrive field-mapping registry", () => {
  it("contains both CRM-owned and app-owned entries with disjoint targets", () => {
    expect(PIPEDRIVE_WRITABLE_COLUMNS.size).toBeGreaterThan(10);
    expect(PIPEDRIVE_APP_OWNED_COLUMNS.size).toBeGreaterThan(0);
    for (const c of PIPEDRIVE_APP_OWNED_COLUMNS) {
      expect(PIPEDRIVE_WRITABLE_COLUMNS.has(c)).toBe(false);
    }
  });

  it("declares notes, commercialRisks, fundingType, contractType, siteId as app-owned", () => {
    for (const col of ["notes", "commercialRisks", "fundingType", "contractType", "siteId"]) {
      expect(PIPEDRIVE_APP_OWNED_COLUMNS.has(col)).toBe(true);
    }
  });

  it("includes every Pipedrive custom-field hash under a registry entry", () => {
    const sources = new Set(PIPEDRIVE_FIELD_REGISTRY.map(m => m.source));
    for (const k of Object.values(PIPEDRIVE_CUSTOM_FIELD_KEYS)) {
      expect(sources.has(k)).toBe(true);
    }
  });
});

describe("buildCrmOwnedFieldsFromDeal", () => {
  it("populates the CRM-owned columns from the deal payload", () => {
    const out = buildCrmOwnedFieldsFromDeal(MIN_DEAL, CTX);
    expect(out.pipedriveDealId).toBe("42");
    expect(out.source).toBe("pipedrive");
    expect(out.dealName).toBe("Acme Solar EPC");
    expect(out.estimatedValue).toBe("1500000");
    expect(out.currency).toBe("ZAR");
    expect(out.stage).toBe("proposal");
    expect(out.status).toBe("active");
    expect(out.expectedCloseDate).toBe("2026-09-01");
    expect(out.estimatedKwp).toBe("850");
    expect(out.estimatedKwh).toBe("1200");
    expect(out.province).toBe("Gauteng");
    expect(out.labels).toBe("Hot, Q3");
    expect(out.dealOwnerUserId).toBe(7);
    expect(out.dealOwnerName).toBe("Jane Doe");
    expect(out.personName).toBe("John Smith");
    expect(out.personEmail).toBe("john@acme.co.za");
    expect(out.clientId).toBe(99);
  });

  it("never writes app-owned columns even when the deal carries values for them", () => {
    const dealWithApp = { ...MIN_DEAL, notes: "should not propagate", commercialRisks: "should not propagate", fundingType: "self_funded" };
    const out = buildCrmOwnedFieldsFromDeal(dealWithApp, CTX);
    for (const c of PIPEDRIVE_APP_OWNED_COLUMNS) {
      expect(out).not.toHaveProperty(c);
    }
  });

  it("omits sparse custom fields when source value is null (no overwrite)", () => {
    const sparse = {
      ...MIN_DEAL,
      [PIPEDRIVE_CUSTOM_FIELD_KEYS.systemSizeKwp]: null,
      [PIPEDRIVE_CUSTOM_FIELD_KEYS.batterySizeKwh]: null,
      [PIPEDRIVE_CUSTOM_FIELD_KEYS.leadLocation]: null,
    } as Record<string, unknown>;
    const out = buildCrmOwnedFieldsFromDeal(sparse, CTX);
    expect(out).not.toHaveProperty("estimatedKwp");
    expect(out).not.toHaveProperty("estimatedKwh");
    expect(out).not.toHaveProperty("province");
  });

  it("nulls overwrite for fields where the CRM owns the empty state (signedDate, lostReason)", () => {
    const reopened = { ...MIN_DEAL, won_time: null, lost_reason: null, expected_close_date: null };
    const out = buildCrmOwnedFieldsFromDeal(reopened, CTX);
    expect(out.signedDate).toBeNull();
    expect(out.lostReason).toBeNull();
    expect(out.expectedCloseDate).toBeNull();
  });

  it("strips time component when mapping won_time → signedDate", () => {
    expect(pipedriveDateOnly("2026-04-15 09:30:00")).toBe("2026-04-15");
    expect(pipedriveDateOnly(null)).toBeNull();
    expect(pipedriveDateOnly("")).toBeNull();
  });

  it("renders labels via the labelMap and falls back to the raw id when missing", () => {
    const map = new Map([["10", "Hot"]]);
    expect(renderLabels("10,99", { stageName: null, labelMap: map })).toBe("Hot, 99");
    expect(renderLabels(null, { stageName: null, labelMap: map })).toBeNull();
  });

  it("resolveProvinceFromLeadLocation maps known options and returns null for 'Other'", () => {
    expect(resolveProvinceFromLeadLocation("65")).toBe("Gauteng");
    expect(resolveProvinceFromLeadLocation("66,99")).toBe("Western Cape");
    expect(resolveProvinceFromLeadLocation("71")).toBeNull();
    expect(resolveProvinceFromLeadLocation(null)).toBeNull();
  });

  it("asNumericString tolerates strings and rejects non-numeric input", () => {
    expect(asNumericString("250.5")).toBe("250.5");
    expect(asNumericString(250)).toBe("250");
    expect(asNumericString("abc")).toBeNull();
    expect(asNumericString(null)).toBeNull();
    expect(asNumericString("")).toBeNull();
  });
});

describe("coerceOrgIdToText", () => {
  it("normalises numeric and string inputs to the same text form", () => {
    expect(coerceOrgIdToText(123)).toBe("123");
    expect(coerceOrgIdToText("123")).toBe("123");
    expect(coerceOrgIdToText(" 123 ")).toBe("123");
  });
  it("returns null for empty/missing values", () => {
    expect(coerceOrgIdToText(null)).toBeNull();
    expect(coerceOrgIdToText(undefined)).toBeNull();
    expect(coerceOrgIdToText("")).toBeNull();
    expect(coerceOrgIdToText("   ")).toBeNull();
  });
});

describe("classifySyncError", () => {
  it("classifies a Postgres missing-column error as schema_mismatch", () => {
    const err = new Error('Failed query: select "id" from clients where pipedrive_org_id = $1\nparams: ["12"]\nerror: column "primary_email_domain" does not exist');
    const c = classifySyncError(err);
    expect(c.class).toBe("schema_mismatch");
    expect(c.retryable).toBe(false);
    expect(c.message).not.toContain("Failed query: select");
    expect(c.message).toContain("primary_email_domain");
  });

  it("classifies invalid input syntax as type_coercion", () => {
    const err = new Error('invalid input syntax for type integer: "abc"');
    expect(classifySyncError(err).class).toBe("type_coercion");
  });

  it("classifies network errors as retryable api_error", () => {
    const err = new Error("fetch failed: ETIMEDOUT");
    const c = classifySyncError(err);
    expect(c.class).toBe("api_error");
    expect(c.retryable).toBe(true);
  });

  it("classifies a missing org_id as missing_org", () => {
    const c = classifySyncError(new Error("Pipedrive deal has no org_id; cannot create app-side opportunity without a client"));
    expect(c.class).toBe("missing_org");
  });

  it("falls back to unknown for unrecognised errors", () => {
    expect(classifySyncError(new Error("something weird")).class).toBe("unknown");
    expect(classifySyncError("a string").class).toBe("unknown");
  });
});
