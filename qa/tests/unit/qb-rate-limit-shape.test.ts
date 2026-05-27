/**
 * TF-15 (audit V3) — Contract test for the QuickBooks rate-limit
 * middleware. Pins the per-user gate on the high-cost QB endpoints so
 * a future refactor cannot silently remove it.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("TF-15 — QuickBooks per-user rate limiting", () => {
  const matchesSrc = read("server/routes/quickbooks-invoice-matches.routes.ts");
  const qbSrc = read("server/quickbooks-routes.ts");
  const middleware = read("server/middleware/rateLimitPerUser.ts");

  it("middleware exports rateLimitPerUser with the documented options shape", () => {
    expect(middleware).toContain("export interface RateLimitOptions");
    expect(middleware).toContain("export function rateLimitPerUser");
    // 429 response payload shape
    expect(middleware).toContain('error: "rate_limited"');
    expect(middleware).toContain("Retry-After");
  });

  it("imports the rate-limit middleware into both QB route files", () => {
    expect(matchesSrc).toContain('from "../middleware/rateLimitPerUser"');
    expect(qbSrc).toContain('from "./middleware/rateLimitPerUser"');
  });

  it("applies rate limit to find / approve-multi / bulk-approve endpoints", () => {
    expect(matchesSrc).toContain('bucket: "qb-find-matches"');
    expect(matchesSrc).toContain('bucket: "qb-approve-multi"');
    expect(matchesSrc).toContain('bucket: "qb-bulk-approve"');
  });

  it("rate-limits the heavy /api/quickbooks/sync-now endpoint", () => {
    expect(qbSrc).toContain('bucket: "qb-sync-now"');
  });
});
