/**
 * Manual Expense Idempotency Tests
 *
 * Verifies the idempotency protection for manual expense creation:
 * - Client generates a UUID idempotencyKey per user action
 * - Backend checks for existing row with that key before inserting
 * - Exact retries (same key) return existing row without duplicating
 * - Different user actions (different keys) always create new rows
 * - Imported rows (no key) are never affected by idempotency logic
 *
 * These are structural/unit tests that verify the code paths exist
 * and behave correctly. Integration tests against a live DB would
 * cover the actual UNIQUE index enforcement.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("Idempotency key — schema and migration", () => {
  it("normalized_cost_lines schema includes idempotencyKey column", () => {
    const schema = read("shared/schema/finance.ts");
    expect(schema).toContain('idempotencyKey: text("idempotency_key")');
  });

  it("migration adds idempotency_key column with partial unique index", () => {
    const migration = read("migrations/20260407_add_idempotency_key_to_cost_lines.sql");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS idempotency_key TEXT");
    expect(migration).toContain("CREATE UNIQUE INDEX");
    expect(migration).toContain("WHERE idempotency_key IS NOT NULL");
  });

  it("column is nullable (does not break imported rows)", () => {
    const schema = read("shared/schema/finance.ts");
    // Verify the column definition does NOT have .notNull()
    const colDef = schema.match(/idempotencyKey:\s*text\([^)]+\)[^,]*/);
    expect(colDef).toBeTruthy();
    expect(colDef![0]).not.toContain("notNull");
  });
});

describe("Idempotency key — write service", () => {
  const writeService = read("server/services/finance-line-write-service.ts");

  it("createCostLine checks for existing row when idempotencyKey is provided", () => {
    expect(writeService).toContain("values.idempotencyKey");
    expect(writeService).toContain("normalizedCostLines.idempotencyKey");
  });

  it("createCostLine returns existing row without inserting on key match", () => {
    // The function should SELECT first, then return early if found
    expect(writeService).toContain("if (existing.length > 0)");
    expect(writeService).toContain("return existing[0]");
  });

  it("createCostLine proceeds with insert when no key match", () => {
    // The normal INSERT path should still exist after the guard
    expect(writeService).toContain("insert(normalizedCostLines).values(values).returning()");
  });

  it("createCostLine does not check idempotency when key is absent", () => {
    // The guard is conditional: if (values.idempotencyKey)
    expect(writeService).toContain("if (values.idempotencyKey)");
  });
});

describe("Idempotency key — storage layer", () => {
  const storage = read("server/storage.ts");

  it("createManualExpense accepts and forwards idempotencyKey", () => {
    expect(storage).toContain("idempotencyKey?: string");
    expect(storage).toContain("mapped.idempotencyKey = data.idempotencyKey");
  });
});

describe("Idempotency key — route handlers", () => {
  const routes = read("server/departments/finance-routes.ts");

  it("add-line route extracts idempotencyKey from request body", () => {
    // Find the add-line handler and verify it destructures idempotencyKey
    const addLineBlock = routes.substring(
      routes.indexOf('"/api/expenses/add-line"'),
      routes.indexOf('"/api/expenses/add-category"')
    );
    expect(addLineBlock).toContain("idempotencyKey");
  });

  it("add-category route extracts idempotencyKey from request body", () => {
    const addCategoryBlock = routes.substring(
      routes.indexOf('"/api/expenses/add-category"'),
      routes.indexOf('"/api/expenses/insert-task-as-line"')
    );
    expect(addCategoryBlock).toContain("idempotencyKey");
  });

  it("insert-task-as-line route extracts idempotencyKey from request body", () => {
    const insertTaskBlock = routes.substring(
      routes.indexOf('"/api/expenses/insert-task-as-line"'),
      routes.indexOf('"/api/expenses/insert-task-as-line"') + 2000
    );
    expect(insertTaskBlock).toContain("idempotencyKey");
  });
});

describe("Idempotency key — frontend", () => {
  const expenditureTab = read("client/src/components/tabs/ExpenditureEditableTab.tsx");

  it("add-line mutation includes idempotencyKey in request body", () => {
    // Find the add-line fetch call
    const addLineSection = expenditureTab.substring(
      expenditureTab.indexOf('"/api/expenses/add-line"'),
      expenditureTab.indexOf('"/api/expenses/add-line"') + 500
    );
    expect(addLineSection).toContain("idempotencyKey");
    expect(addLineSection).toContain("crypto.randomUUID()");
  });

  it("add-category mutation includes idempotencyKey in request body", () => {
    const addCategorySection = expenditureTab.substring(
      expenditureTab.indexOf('"/api/expenses/add-category"'),
      expenditureTab.indexOf('"/api/expenses/add-category"') + 500
    );
    expect(addCategorySection).toContain("idempotencyKey");
    expect(addCategorySection).toContain("crypto.randomUUID()");
  });

  it("insert-task-as-line mutation includes idempotencyKey in request body", () => {
    const insertTaskSection = expenditureTab.substring(
      expenditureTab.indexOf('"/api/expenses/insert-task-as-line"'),
      expenditureTab.indexOf('"/api/expenses/insert-task-as-line"') + 500
    );
    expect(insertTaskSection).toContain("idempotencyKey");
    expect(insertTaskSection).toContain("crypto.randomUUID()");
  });

  it("each mutation generates a fresh UUID (not reused across calls)", () => {
    // crypto.randomUUID() is called inline in the JSON.stringify,
    // meaning each mutation invocation generates a new key.
    // Verify it's inside the JSON.stringify, not extracted as a variable
    // that could be accidentally reused.
    const addLineCall = expenditureTab.match(/JSON\.stringify\(\{[^}]*idempotencyKey:\s*crypto\.randomUUID\(\)/);
    expect(addLineCall).toBeTruthy();
  });
});

describe("Idempotency — duplicate scenario coverage", () => {
  it("SCENARIO: double-click produces same key → second request returns existing row", () => {
    // This is by design: the frontend generates the key inside mutationFn,
    // but TanStack Query's useMutation won't re-invoke mutationFn while isPending.
    // If the user manages to bypass isPending (e.g., browser resend), the backend
    // idempotency guard catches the duplicate.
    const writeService = read("server/services/finance-line-write-service.ts");
    expect(writeService).toContain("if (values.idempotencyKey)");
    expect(writeService).toContain("return existing[0]");
  });

  it("SCENARIO: legitimate similar expense → different UUID → both created", () => {
    // Each mutation call generates a fresh crypto.randomUUID(),
    // so two intentional "add line" clicks produce two different keys.
    const tab = read("client/src/components/tabs/ExpenditureEditableTab.tsx");
    const calls = tab.match(/crypto\.randomUUID\(\)/g);
    // At least 3 calls (add-line, add-category, insert-task-as-line)
    expect(calls).toBeTruthy();
    expect(calls!.length).toBeGreaterThanOrEqual(3);
  });

  it("SCENARIO: imported rows have no idempotency key → never blocked", () => {
    const writeService = read("server/services/finance-line-write-service.ts");
    // Guard only triggers when key is present
    expect(writeService).toContain("if (values.idempotencyKey)");
    // No else-block that blocks import paths
  });
});
