import { describe, it, expect, beforeEach } from "vitest";
import { getSharePointToken, clearSharePointTokenCache } from "../../../server/sharepoint-token";

/**
 * Batch 5: a half-configured SharePoint integration must fail with a coded
 * ApiError (SHAREPOINT_UNAVAILABLE, 503) — not a plain Error that surfaces as an
 * opaque 500 — so the client renders a "connect SharePoint" CTA.
 */
describe("SharePoint token — coded unavailable error", () => {
  beforeEach(() => {
    for (const k of [
      "SHAREPOINT_CLIENT_ID",
      "SHAREPOINT_CLIENT_SECRET",
      "SHAREPOINT_TENANT_ID",
      "REPLIT_CONNECTORS_HOSTNAME",
      "REPL_IDENTITY",
      "WEB_REPL_RENEWAL",
    ]) {
      delete process.env[k];
    }
    clearSharePointTokenCache();
  });

  it("throws a coded SHAREPOINT_UNAVAILABLE ApiError when nothing is configured", async () => {
    await expect(getSharePointToken()).rejects.toMatchObject({
      code: "SHAREPOINT_UNAVAILABLE",
      statusCode: 503,
    });
  });
});
