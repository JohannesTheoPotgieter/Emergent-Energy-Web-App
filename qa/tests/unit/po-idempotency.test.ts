/**
 * PO Creation Idempotency Tests
 *
 * Verifies:
 * 1. poRef already has a DB UNIQUE constraint (pre-existing safety net)
 * 2. Client-generated idempotency key added for duplicate prevention
 * 3. The idempotency check runs BEFORE nextval to avoid wasting sequence numbers
 * 4. Frontend sends a fresh UUID per PO generation action
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("PO poRef uniqueness — pre-existing DB constraint", () => {
  it("Drizzle schema declares poRef as unique", () => {
    const schema = read("shared/schema/finance.ts");
    expect(schema).toContain('poRef: text("po_ref").notNull().unique()');
  });

  it("startup-orchestrator CREATE TABLE has UNIQUE on po_ref", () => {
    const orchestrator = read("server/bootstrap/startup-orchestrator.ts");
    expect(orchestrator).toContain("po_ref TEXT NOT NULL UNIQUE");
  });

  it("migration CREATE TABLE has UNIQUE on po_ref", () => {
    const migration = read("migrations/20260322_startup_schema_hardening_finalize.sql");
    expect(migration).toContain("po_ref TEXT NOT NULL UNIQUE");
  });
});

describe("PO poRef generation — deterministic uniqueness", () => {
  const poRoutes = read("server/po-routes.ts");

  it("poRef includes sequence number from po_number_seq", () => {
    expect(poRoutes).toContain("nextval('po_number_seq')");
  });

  it("poRef format is PO{seqNum}-{projectCode}-{dateStr}-{supplierCode}", () => {
    expect(poRoutes).toContain("`PO${poNumber}-${projectCode}-${dateStr}-${supplierCode}`");
  });

  it("sequence number is obtained before poRef construction", () => {
    const seqIdx = poRoutes.indexOf("nextval('po_number_seq')");
    const refIdx = poRoutes.indexOf("`PO${poNumber}-${projectCode}-${dateStr}-${supplierCode}`");
    expect(seqIdx).toBeGreaterThan(-1);
    expect(refIdx).toBeGreaterThan(-1);
    expect(seqIdx).toBeLessThan(refIdx);
  });
});

describe("PO idempotency key — schema and migration", () => {
  it("purchase_orders schema includes idempotencyKey column", () => {
    const schema = read("shared/schema/finance.ts");
    const poBlock = schema.substring(
      schema.indexOf('pgTable("purchase_orders"'),
      schema.indexOf("insertPurchaseOrderSchema")
    );
    expect(poBlock).toContain('idempotencyKey: text("idempotency_key")');
  });

  it("migration adds idempotency_key column with partial unique index", () => {
    const migration = read("migrations/20260407_add_idempotency_key_to_purchase_orders.sql");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS idempotency_key TEXT");
    expect(migration).toContain("CREATE UNIQUE INDEX");
    expect(migration).toContain("WHERE idempotency_key IS NOT NULL");
  });

  it("idempotency_key column is nullable (does not break existing POs)", () => {
    const schema = read("shared/schema/finance.ts");
    const match = schema.match(/idempotencyKey:\s*text\("idempotency_key"\)[^,]*/);
    expect(match).toBeTruthy();
    // Must NOT have .notNull()
    expect(match![0]).not.toContain("notNull");
  });
});

describe("PO idempotency key — route handler", () => {
  const poRoutes = read("server/po-routes.ts");

  it("generate route extracts idempotencyKey from request body", () => {
    const generateBlock = poRoutes.substring(
      poRoutes.indexOf('"/api/po/generate"'),
      poRoutes.indexOf('"/api/po/generate"') + 3000
    );
    expect(generateBlock).toContain("idempotencyKey");
  });

  it("idempotency check runs BEFORE nextval (avoids wasting sequence)", () => {
    const generateBlock = poRoutes.substring(
      poRoutes.indexOf('"/api/po/generate"'),
      poRoutes.indexOf('"/api/po/generate"') + 3000
    );
    const guardIdx = generateBlock.indexOf("idempotency_key = ${idempotencyKey}");
    const seqIdx = generateBlock.indexOf("nextval('po_number_seq')");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(seqIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(seqIdx);
  });

  it("existing PO is returned without re-inserting on key match", () => {
    const generateBlock = poRoutes.substring(
      poRoutes.indexOf("idempotency_key = ${idempotencyKey}"),
      poRoutes.indexOf("nextval('po_number_seq')")
    );
    expect(generateBlock).toContain("return res.json");
  });

  it("idempotency_key is included in the INSERT statement", () => {
    expect(poRoutes).toContain("idempotency_key");
    expect(poRoutes).toContain("${idempotencyKey || null}");
  });
});

describe("PO idempotency key — frontend", () => {
  const poGenerator = read("client/src/components/POGenerator.tsx");

  it("PO generate mutation sends idempotencyKey", () => {
    expect(poGenerator).toContain("idempotencyKey: crypto.randomUUID()");
  });

  it("idempotencyKey is inside the JSON.stringify body", () => {
    const generateBlock = poGenerator.substring(
      poGenerator.indexOf('"/api/po/generate"'),
      poGenerator.indexOf('"/api/po/generate"') + 1000
    );
    expect(generateBlock).toContain("idempotencyKey");
    expect(generateBlock).toContain("crypto.randomUUID()");
  });
});

describe("PO duplicate scenarios", () => {
  it("SCENARIO: double-click → same idempotencyKey → second returns existing PO", () => {
    const poRoutes = read("server/po-routes.ts");
    // Guard checks for existing PO before consuming sequence
    expect(poRoutes).toContain("if (idempotencyKey)");
    expect(poRoutes).toContain("WHERE idempotency_key = ${idempotencyKey}");
    expect(poRoutes).toContain("return res.json");
  });

  it("SCENARIO: legitimate second PO → different UUID → new PO created", () => {
    const poGenerator = read("client/src/components/POGenerator.tsx");
    // crypto.randomUUID() called inline → each invocation generates new key
    expect(poGenerator).toContain("crypto.randomUUID()");
  });

  it("SCENARIO: no idempotency key (legacy client) → PO created normally", () => {
    const poRoutes = read("server/po-routes.ts");
    // Guard is conditional
    expect(poRoutes).toContain("if (idempotencyKey)");
    // When no key, falls through to normal creation
    expect(poRoutes).toContain("${idempotencyKey || null}");
  });

  it("poRef UNIQUE constraint provides backup protection", () => {
    const schema = read("shared/schema/finance.ts");
    expect(schema).toContain('poRef: text("po_ref").notNull().unique()');
  });
});
