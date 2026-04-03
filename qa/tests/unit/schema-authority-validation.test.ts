import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

// ===========================================================================
// 1. Production Guards Exist
// ===========================================================================
describe("Production Schema DDL Guards", () => {
  it("runDrizzleSchemaSync has production guard", () => {
    const f = readFile("server/bootstrap/startup-orchestrator.ts");
    const section = f.slice(
      f.indexOf("async function runDrizzleSchemaSync"),
      f.indexOf("async function extractAlterStatements"),
    );
    expect(section).toContain("production");
    expect(section).toContain("staging");
    expect(section).toContain("return");
  });

  it("runAdditiveSchemaAlignments has production guard", () => {
    const f = readFile("server/bootstrap/startup-orchestrator.ts");
    const section = f.slice(
      f.indexOf("async function runAdditiveSchemaAlignments"),
      f.indexOf("async function safeExec") > -1
        ? f.indexOf("async function safeExec")
        : f.indexOf("await safeExec"),
    );
    expect(section).toContain("production");
    expect(section).toContain("staging");
    expect(section).toContain("return");
  });

  it("runStartupOrchestrator blocks DDL in production", () => {
    const f = readFile("server/bootstrap/startup-orchestrator.ts");
    const section = f.slice(f.indexOf("export async function runStartupOrchestrator"));
    // Must check for production before running DDL
    expect(section).toContain("isProduction");
    expect(section).toContain("startup schema DDL blocked");
  });
});

// ===========================================================================
// 2. db.ts Has No PostgreSQL DDL
// ===========================================================================
describe("db.ts Contains No PostgreSQL DDL", () => {
  it("db.ts PostgreSQL init path has no ALTER TABLE", () => {
    const f = readFile("server/db.ts");
    // Find the PostgreSQL connection section (pool.query area)
    const pgSection = f.slice(
      f.indexOf("pool = new pg.Pool"),
      f.indexOf("isInitialized = true") + 50,
    );
    expect(pgSection).not.toContain("ALTER TABLE");
    expect(pgSection).not.toContain("CREATE TABLE");
    expect(pgSection).not.toContain("CREATE INDEX");
  });

  it("db.ts has comment explaining DDL removal", () => {
    const f = readFile("server/db.ts");
    expect(f).toContain("Schema DDL removed from connection init");
    expect(f).toContain("schema-authority.md");
  });
});

// ===========================================================================
// 3. Defense in Depth: Three Independent Guards
// ===========================================================================
describe("Defense in Depth", () => {
  it("isPromotedSchemaPresent guard exists", () => {
    const f = readFile("server/bootstrap/startup-orchestrator.ts");
    expect(f).toContain("async function isPromotedSchemaPresent");
    expect(f).toContain("core.projects");
  });

  it("runtime-schema-compatibility.ts is neutered in production", () => {
    const f = readFile("server/bootstrap/runtime-schema-compatibility.ts");
    expect(f).toContain("production");
    expect(f).toContain("return");
    // Must NOT contain any CREATE/ALTER/DROP statements
    expect(f).not.toContain("CREATE TABLE");
    expect(f).not.toContain("ALTER TABLE");
    expect(f).not.toContain("DROP TABLE");
  });

  it("maintenance.ts is neutered", () => {
    const f = readFile("server/bootstrap/maintenance.ts");
    // Must NOT contain any CREATE/ALTER/DROP statements
    expect(f).not.toContain("CREATE TABLE");
    expect(f).not.toContain("ALTER TABLE");
    expect(f).not.toContain("DROP TABLE");
  });
});

// ===========================================================================
// 4. Documentation Exists
// ===========================================================================
describe("Schema Authority Documentation", () => {
  it("schema-authority.md exists and describes the model", () => {
    const doc = readFile("docs/schema-authority.md");
    expect(doc).toContain("Single Authority");
    expect(doc).toContain("Versioned Migrations");
    expect(doc).toContain("Production");
    expect(doc).toContain("BLOCKED");
  });

  it("schema-authority.md documents the environment behavior table", () => {
    const doc = readFile("docs/schema-authority.md");
    expect(doc).toContain("Production");
    expect(doc).toContain("Staging");
    expect(doc).toContain("Development");
  });

  it("schema-authority.md documents defense in depth", () => {
    const doc = readFile("docs/schema-authority.md");
    expect(doc).toContain("Defense in Depth");
    expect(doc).toContain("NODE_ENV");
    expect(doc).toContain("isPromotedSchemaPresent");
  });

  it("schema-authority.md documents what was removed from db.ts", () => {
    const doc = readFile("docs/schema-authority.md");
    expect(doc).toContain("db.ts");
    expect(doc).toContain("removed");
  });
});

// ===========================================================================
// 5. Versioned Migrations Directory Exists
// ===========================================================================
describe("Migration Infrastructure", () => {
  it("migrations directory exists with SQL files", () => {
    const migrationsDir = path.join(process.cwd(), "migrations");
    expect(fs.existsSync(migrationsDir)).toBe(true);
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(100);
  });

  it("drizzle.config.ts points to migrations directory", () => {
    const config = readFile("drizzle.config.ts");
    expect(config).toContain("./migrations");
    expect(config).toContain("./shared/schema.ts");
  });
});
