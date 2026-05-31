/**
 * SharePoint app-only token source (tenant-owned Azure app).
 *
 * Pins the option-3 behaviour: when SHAREPOINT_TENANT_ID / SHAREPOINT_CLIENT_ID
 * / SHAREPOINT_CLIENT_SECRET are configured, the app uses its own app-only
 * Microsoft Graph token instead of the Replit connector — and the mock/real
 * gate treats MS Graph as live. Deployments without those vars keep the
 * connector behaviour unchanged (no regression).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isConnectorMocked, hasMsGraphAppOnlyCreds } from "../../../server/lib/connector-mode";
import { getSharePointTokenStrategy } from "../../../server/sharepoint-token";

const ENV_KEYS = [
  "SHAREPOINT_TENANT_ID",
  "SHAREPOINT_CLIENT_ID",
  "SHAREPOINT_CLIENT_SECRET",
  "REPLIT_CONNECTORS_HOSTNAME",
  "USE_MOCK_CONNECTORS",
  "NODE_ENV",
] as const;

describe("SharePoint app-only token source (option 3)", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function setAppOnly() {
    process.env.SHAREPOINT_TENANT_ID = "tenant-1";
    process.env.SHAREPOINT_CLIENT_ID = "client-1";
    process.env.SHAREPOINT_CLIENT_SECRET = "secret-1";
  }

  it("selects the app-only strategy when all three SHAREPOINT_* vars are set", () => {
    setAppOnly();
    expect(getSharePointTokenStrategy()).toBe("app-only");
    expect(hasMsGraphAppOnlyCreds()).toBe(true);
  });

  it("falls back to the connector strategy when the app-only config is incomplete", () => {
    process.env.SHAREPOINT_TENANT_ID = "tenant-1";
    process.env.SHAREPOINT_CLIENT_ID = "client-1";
    // SHAREPOINT_CLIENT_SECRET intentionally missing
    expect(getSharePointTokenStrategy()).toBe("connector");
    expect(hasMsGraphAppOnlyCreds()).toBe(false);
  });

  it("treats MS Graph as LIVE when app-only creds are set, even without a Replit connector", () => {
    setAppOnly();
    expect(isConnectorMocked("ms-graph")).toBe(false);
  });

  it("mocks MS Graph when neither app-only creds nor a connector are configured", () => {
    expect(getSharePointTokenStrategy()).toBe("connector");
    expect(isConnectorMocked("ms-graph")).toBe(true);
  });

  it("keeps the Replit connector path working when app-only is absent", () => {
    process.env.REPLIT_CONNECTORS_HOSTNAME = "connectors.example.com";
    expect(getSharePointTokenStrategy()).toBe("connector");
    expect(isConnectorMocked("ms-graph")).toBe(false);
  });

  it("honours USE_MOCK_CONNECTORS=true even when app-only creds are set", () => {
    setAppOnly();
    process.env.USE_MOCK_CONNECTORS = "true";
    expect(isConnectorMocked("ms-graph")).toBe(true);
  });

  it("never mocks in production regardless of creds", () => {
    process.env.NODE_ENV = "production";
    expect(isConnectorMocked("ms-graph")).toBe(false);
  });
});
