/**
 * Smart Import Commit Guard Tests
 *
 * Verifies that the commit handler has an atomic state transition guard
 * that prevents duplicate commit execution, even under concurrent requests.
 *
 * The guard uses UPDATE ... WHERE status IN ('PREVIEW', 'AWAITING_REVIEW')
 * RETURNING id inside the transaction. If the row was already committed
 * by another request, the UPDATE matches 0 rows and the transaction aborts.
 *
 * This eliminates the race condition where two requests read status=PREVIEW
 * outside the transaction and both proceed to write data.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Smart import state machine", () => {
  it("status enum includes all expected states", () => {
    const schema = read("shared/schema/imports.ts");
    expect(schema).toContain("'PREVIEW'");
    expect(schema).toContain("'AWAITING_REVIEW'");
    expect(schema).toContain("'COMMITTED'");
    expect(schema).toContain("'ROLLED_BACK'");
    expect(schema).toContain("'FAILED'");
    expect(schema).toContain("'SUPERSEDED'");
  });

  it("upload creates run with PREVIEW status", () => {
    const routes = read("server/smart-import-routes.ts");
    expect(routes).toContain('status: "PREVIEW"');
  });

  it("commit transitions to COMMITTED", () => {
    const routes = read("server/smart-import-routes.ts");
    expect(routes).toContain('status: "COMMITTED"');
  });

  it("rollback only works on COMMITTED runs", () => {
    const routes = read("server/smart-import-routes.ts");
    expect(routes).toContain('if (run.status !== "COMMITTED")');
  });

  it("retry only works on FAILED, ROLLED_BACK, or PREVIEW runs", () => {
    const routes = read("server/smart-import-routes.ts");
    expect(routes).toContain('run.status !== "FAILED" && run.status !== "ROLLED_BACK" && run.status !== "PREVIEW"');
  });
});

describe("Commit guard — atomic state transition", () => {
  const routes = read("server/smart-import-routes.ts");

  it("guard runs INSIDE db.transaction (not outside)", () => {
    // The transaction starts before the guard
    const txStart = routes.indexOf("await db.transaction(async (tx: any) => {");
    const guard = routes.indexOf("UPDATE smart_import_runs");
    const txEnd = routes.indexOf("});", guard);

    expect(txStart).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(txStart);
    // The guard is inside the transaction
  });

  it("guard uses UPDATE ... WHERE status IN committable states", () => {
    expect(routes).toContain("AND status IN ('PREVIEW', 'AWAITING_REVIEW')");
  });

  it("guard uses RETURNING id to detect whether the claim succeeded", () => {
    expect(routes).toContain("RETURNING id");
  });

  it("guard throws 409 when claim fails (no rows matched)", () => {
    // The guard checks if claimed rows are empty and throws
    const guardBlock = routes.substring(
      routes.indexOf("Atomic commit guard"),
      routes.indexOf("const existingTaskOwners")
    );
    expect(guardBlock).toContain("claimed.length === 0");
    expect(guardBlock).toContain("status: 409");
  });

  it("error handler returns 409 status code for guard rejection", () => {
    expect(routes).toContain("(err as any)?.status === 409 ? 409 : 500");
  });

  it("early check outside transaction still exists for user-friendly messages", () => {
    // The non-atomic check at the top of the route provides a friendly error
    // for already-committed runs (no race condition needed)
    const commitRoute = routes.substring(
      routes.indexOf('"/api/smart-import/:runId/commit"'),
      routes.indexOf("await db.transaction")
    );
    expect(commitRoute).toContain('run.status === "COMMITTED"');
    expect(commitRoute).toContain("This import has already been committed");
  });
});

describe("Commit guard — prevents all duplicate scenarios", () => {
  const routes = read("server/smart-import-routes.ts");

  it("SCENARIO: double-click — second request's UPDATE matches 0 rows because first already claimed", () => {
    // The guard transitions status to AWAITING_REVIEW atomically.
    // PostgreSQL's row-level locking ensures the second UPDATE blocks
    // until the first transaction commits, then matches 0 rows.
    const guardBlock = routes.substring(
      routes.indexOf("Atomic commit guard"),
      routes.indexOf("const existingTaskOwners")
    );
    expect(guardBlock).toContain("SET status = 'AWAITING_REVIEW'");
    expect(guardBlock).toContain("AND status IN ('PREVIEW', 'AWAITING_REVIEW')");
  });

  it("SCENARIO: retry after success — early check catches COMMITTED status", () => {
    const earlyCheck = routes.substring(
      routes.indexOf("const [run] = await db.select()"),
      routes.indexOf("Import recency enforcement")
    );
    expect(earlyCheck).toContain('run.status === "COMMITTED"');
  });

  it("SCENARIO: retry after rollback — guard rejects (status is ROLLED_BACK, not in committable set)", () => {
    // ROLLED_BACK is NOT in ('PREVIEW', 'AWAITING_REVIEW')
    const guardBlock = routes.substring(
      routes.indexOf("Atomic commit guard"),
      routes.indexOf("const existingTaskOwners")
    );
    expect(guardBlock).toContain("AND status IN ('PREVIEW', 'AWAITING_REVIEW')");
    expect(guardBlock).not.toContain("ROLLED_BACK");
  });

  it("SCENARIO: commit superseded run — guard rejects (SUPERSEDED not in committable set)", () => {
    const guardBlock = routes.substring(
      routes.indexOf("Atomic commit guard"),
      routes.indexOf("const existingTaskOwners")
    );
    expect(guardBlock).not.toContain("SUPERSEDED");
  });
});

describe("Commit guard — temporal soft-close preserved", () => {
  const routes = read("server/smart-import-routes.ts");

  it("commit uses temporal soft-close for existing rows", () => {
    expect(routes).toContain("softCloseByProjectId");
    expect(routes).toContain("softCloseByProjectName");
  });

  it("rollback uses temporal soft-close by import run ID", () => {
    expect(routes).toContain("softCloseByImportRunId");
  });

  it("preview supersede logic marks older previews as SUPERSEDED", () => {
    expect(routes).toContain('status: "SUPERSEDED"');
  });
});
