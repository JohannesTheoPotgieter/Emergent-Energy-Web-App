/**
 * Source-pin tests for the four new transition-history tables.
 *
 * Plan v3 § 2.3 / D.5 (β): four self-auditing entities now write a row
 * to a domain history table on every state transition. These tests pin
 * three things:
 *
 *   1. Each table is declared in its expected shared/schema/*.ts file
 *      with the canonical column set.
 *   2. The migration 0057 file ships 4 CREATE TABLE blocks + 4 indexes
 *      with IF NOT EXISTS guards.
 *   3. The migration journal registers entry 58 with the matching tag.
 *   4. Each of the 4 services imports its history table AND inserts
 *      into it (source-text grep) — catches a regression where someone
 *      removes the history insert.
 *
 * No DB execution; pure file-content checks.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  omHandoverHistory,
  projectStageExceptionHistory,
  pendingApprovalHistory,
  qbLinkProposedCascadeHistory,
} from "@shared/schema";

const repoRoot = process.cwd();
const handoverSrc = fs.readFileSync(path.join(repoRoot, "shared/schema/handover.ts"), "utf8");
const stageLifecycleSrc = fs.readFileSync(path.join(repoRoot, "shared/schema/stage-lifecycle.ts"), "utf8");
const pendingApprovalsSrc = fs.readFileSync(path.join(repoRoot, "shared/schema/pending-approvals.ts"), "utf8");
const integrationsSrc = fs.readFileSync(path.join(repoRoot, "shared/schema/integrations.ts"), "utf8");
const migrationSrc = fs.readFileSync(path.join(repoRoot, "migrations/0057_add_transition_history_tables.sql"), "utf8");
const journal = JSON.parse(fs.readFileSync(path.join(repoRoot, "migrations/meta/_journal.json"), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

const omHandoverServiceSrc = fs.readFileSync(path.join(repoRoot, "server/services/om-handover-service.ts"), "utf8");
const stageExceptionServiceSrc = fs.readFileSync(path.join(repoRoot, "server/services/stage-exception-service.ts"), "utf8");
const pendingApprovalsServiceSrc = fs.readFileSync(path.join(repoRoot, "server/services/pending-approvals-service.ts"), "utf8");
const qbCascadeServiceSrc = fs.readFileSync(path.join(repoRoot, "server/services/quickbooks-cascade-proposals-service.ts"), "utf8");

describe("D.5 (β) — schema declarations", () => {
  it("omHandoverHistory is declared in shared/schema/handover.ts", () => {
    expect(handoverSrc).toContain('export const omHandoverHistory = pgTable("om_handover_history"');
    expect(handoverSrc).toMatch(/omHandoverId:\s*integer\("om_handover_id"\)/);
    expect(handoverSrc).toMatch(/fromStatus:\s*text\("from_status"\)/);
    expect(handoverSrc).toMatch(/toStatus:\s*text\("to_status"\)\.notNull\(\)/);
    expect(handoverSrc).toMatch(/changedByUserId:\s*integer\("changed_by_user_id"\)/);
    expect(handoverSrc).toMatch(/changedAt:\s*timestamp\("changed_at"\)\.notNull\(\)\.defaultNow\(\)/);
  });

  it("projectStageExceptionHistory is declared in shared/schema/stage-lifecycle.ts", () => {
    expect(stageLifecycleSrc).toContain('export const projectStageExceptionHistory = pgTable("project_stage_exception_history"');
    expect(stageLifecycleSrc).toMatch(/exceptionId:\s*integer\("exception_id"\)/);
    expect(stageLifecycleSrc).toMatch(/exceptionIdIdx:\s*index\("pseh_exception_id_idx"\)/);
  });

  it("pendingApprovalHistory is declared in shared/schema/pending-approvals.ts", () => {
    expect(pendingApprovalsSrc).toContain('export const pendingApprovalHistory = pgTable("pending_approval_history"');
    expect(pendingApprovalsSrc).toMatch(/pendingApprovalId:\s*integer\("pending_approval_id"\)/);
    expect(pendingApprovalsSrc).toMatch(/pendingApprovalIdIdx:\s*index\("pah_pending_approval_id_idx"\)/);
  });

  it("qbLinkProposedCascadeHistory is declared in shared/schema/integrations.ts", () => {
    expect(integrationsSrc).toContain('export const qbLinkProposedCascadeHistory = pgTable("qb_link_proposed_cascade_history"');
    expect(integrationsSrc).toMatch(/cascadeId:\s*integer\("cascade_id"\)/);
    expect(integrationsSrc).toMatch(/cascadeIdIdx:\s*index\("qlpch_cascade_id_idx"\)/);
  });

  it("each history table is reachable via @shared/schema (re-export)", () => {
    expect(omHandoverHistory).toBeDefined();
    expect(projectStageExceptionHistory).toBeDefined();
    expect(pendingApprovalHistory).toBeDefined();
    expect(qbLinkProposedCascadeHistory).toBeDefined();
  });
});

describe("D.5 (β) — migration 0057 structure", () => {
  it("ships 4 CREATE TABLE IF NOT EXISTS blocks", () => {
    const tables = migrationSrc.match(/CREATE TABLE IF NOT EXISTS \w+/g) ?? [];
    expect(tables.length).toBe(4);
  });

  it("ships 4 CREATE INDEX IF NOT EXISTS blocks", () => {
    const indexes = migrationSrc.match(/CREATE INDEX IF NOT EXISTS \w+/g) ?? [];
    expect(indexes.length).toBe(4);
  });

  it("each CREATE TABLE has the four expected entity tables", () => {
    expect(migrationSrc).toContain("CREATE TABLE IF NOT EXISTS om_handover_history");
    expect(migrationSrc).toContain("CREATE TABLE IF NOT EXISTS project_stage_exception_history");
    expect(migrationSrc).toContain("CREATE TABLE IF NOT EXISTS pending_approval_history");
    expect(migrationSrc).toContain("CREATE TABLE IF NOT EXISTS qb_link_proposed_cascade_history");
  });

  it("each table has FK to its parent with ON DELETE CASCADE", () => {
    expect(migrationSrc).toMatch(/REFERENCES om_handovers\(id\) ON DELETE CASCADE/);
    expect(migrationSrc).toMatch(/REFERENCES project_stage_exceptions\(id\) ON DELETE CASCADE/);
    expect(migrationSrc).toMatch(/REFERENCES pending_approvals\(id\) ON DELETE CASCADE/);
    expect(migrationSrc).toMatch(/REFERENCES qb_link_proposed_cascades\(id\) ON DELETE CASCADE/);
  });

  it("changed_by_user_id is FK to users.id with ON DELETE SET NULL", () => {
    const matches = migrationSrc.match(/REFERENCES users\(id\) ON DELETE SET NULL/g) ?? [];
    expect(matches.length).toBe(4);
  });

  it("registers entry 58 in the migration journal", () => {
    const entry = journal.entries.find((e) => e.idx === 58);
    expect(entry).toBeDefined();
    expect(entry?.tag).toBe("0057_add_transition_history_tables");
  });
});

describe("D.5 (β) — service insert wiring", () => {
  it("om-handover-service.ts imports and inserts omHandoverHistory", () => {
    expect(omHandoverServiceSrc).toContain("omHandoverHistory");
    expect(omHandoverServiceSrc).toMatch(/tx\.insert\(omHandoverHistory\)/);
  });

  it("stage-exception-service.ts imports and inserts projectStageExceptionHistory in all four state transitions", () => {
    expect(stageExceptionServiceSrc).toContain("projectStageExceptionHistory");
    const inserts = stageExceptionServiceSrc.match(/tx\.insert\(projectStageExceptionHistory\)/g) ?? [];
    // create + approve + reject + close = 4
    expect(inserts.length).toBe(4);
  });

  it("pending-approvals-service.ts imports and inserts pendingApprovalHistory in all four terminal branches", () => {
    expect(pendingApprovalsServiceSrc).toContain("pendingApprovalHistory");
    const inserts = pendingApprovalsServiceSrc.match(/tx\.insert\(pendingApprovalHistory\)/g) ?? [];
    // approvePending no-handler-failed + approvePending handler-threw + approvePending success + rejectPending = 4
    expect(inserts.length).toBe(4);
  });

  it("quickbooks-cascade-proposals-service.ts imports and inserts qbLinkProposedCascadeHistory in accept + decline", () => {
    expect(qbCascadeServiceSrc).toContain("qbLinkProposedCascadeHistory");
    const inserts = qbCascadeServiceSrc.match(/tx\.insert\(qbLinkProposedCascadeHistory\)/g) ?? [];
    expect(inserts.length).toBe(2);
  });
});
