/**
 * TF-23 (audit V3) — Contract test for QB realm orphan handling.
 *
 * Pins the realm-disconnect path so a future refactor cannot silently
 * leave orphaned quickbooks_invoice_links rows pointing at a realm that
 * no longer answers.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("TF-23 — QuickBooks realm orphan handling on disconnect", () => {
  const src = read("server/services/quickbooks-service.ts");

  it("imports quickbooksInvoiceLinks for the orphan sweep", () => {
    expect(src).toContain("quickbooksInvoiceLinks");
  });

  it("defines a helper that soft-deletes links for the previous realm", () => {
    expect(src).toContain("orphanLinksForRealm");
  });

  it("runs the orphan sweep before clearing the QB tokens", () => {
    // The orphan sweep must use the OLD realmId, so it has to read
    // metadata.realmId BEFORE calling saveQuickBooksMetadata({}).
    const previousIdx = src.indexOf("const previous = await loadQuickBooksMetadata");
    const saveIdx = src.indexOf("await saveQuickBooksMetadata({})");
    expect(previousIdx).toBeGreaterThan(-1);
    expect(saveIdx).toBeGreaterThan(-1);
    expect(previousIdx).toBeLessThan(saveIdx);
  });

  it("stamps the orphan reason into the notes column", () => {
    expect(src).toContain("[ORPHANED] QB realm");
    // deletedAt is the soft-delete signal — reads filter isNull(deletedAt).
    expect(src).toMatch(/deletedAt:\s*new Date\(\)/);
  });

  it("records the orphaned realm in the integration-run metadata", () => {
    expect(src).toContain("orphanedRealmId");
  });
});
