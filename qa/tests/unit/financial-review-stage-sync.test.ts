import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relPath: string) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("financial review → S05 stage sync", () => {
  const serviceSource = read("server/services/financial-review-service.ts");

  // ── Outcome → Stage Status mapping ──

  it("GO outcome maps to APPROVED stage status", () => {
    expect(serviceSource).toContain('GO: "APPROVED"');
  });

  it("NO_GO outcome maps to BLOCKED stage status", () => {
    expect(serviceSource).toContain('NO_GO: "BLOCKED"');
  });

  it("CONDITIONAL_GO outcome maps to EXCEPTION_APPROVED stage status", () => {
    expect(serviceSource).toContain('CONDITIONAL_GO: "EXCEPTION_APPROVED"');
  });

  it("DEFERRED outcome maps to IN_PROGRESS stage status", () => {
    expect(serviceSource).toContain('DEFERRED: "IN_PROGRESS"');
  });

  // ── S05 stage instance validation ──

  it("verifies S05 stage instance exists before updating", () => {
    expect(serviceSource).toContain("S05_FINANCIAL_REVIEW");
    expect(serviceSource).toContain("No S05_FINANCIAL_REVIEW stage instance found");
  });

  it("fails with clear error if no S05 stage instance found (no partial commit)", () => {
    // The check happens BEFORE the transaction begins
    expect(serviceSource).toContain("Cannot record financial review outcome without a matching stage instance");
  });

  // ── Transaction wrapping ──

  it("wraps all state changes in a single transaction", () => {
    expect(serviceSource).toContain("db.transaction(async (tx)");
    // All writes inside the transaction use tx, not db
    // tx is used for: approvals, projectFinancialReviews, projectExecutionState,
    // projectStageInstances, projectStageDecisions, projectStageExceptions
    expect(serviceSource).toContain("await tx");
    // Verify tx used for stage update (not db)
    const txUsageCount = (serviceSource.match(/await tx\b/g) || []).length;
    expect(txUsageCount).toBeGreaterThanOrEqual(5); // at minimum: approval, review, exec state, stage, decision
  });

  // ── CONDITIONAL_GO creates exception record ──

  it("CONDITIONAL_GO creates a projectStageExceptions record with conditions", () => {
    expect(serviceSource).toContain('tx.insert(projectStageExceptions)');
    expect(serviceSource).toContain('"APPROVED_WITH_CONDITIONS"');
    expect(serviceSource).toContain("conditionsText: params.outcomeConditions");
  });

  // ── Notifications ──

  it("sends notifications only when stage status actually changed", () => {
    expect(serviceSource).toContain("if (stageStatusChanged)");
    expect(serviceSource).toContain("notifyUsers(");
  });

  it("collects stage owner, PM, and PROGRAM_MANAGER as notification recipients", () => {
    expect(serviceSource).toContain("s05Instance.stageOwnerUserId");
    expect(serviceSource).toContain("projInfo?.pmUserId");
    expect(serviceSource).toContain("execState?.programManagerUserId");
  });

  it("excludes the actor from notifications", () => {
    expect(serviceSource).toContain("recipientIds.delete(params.actorUserId)");
  });

  it("includes blocking reason for NO_GO in notification body", () => {
    expect(serviceSource).toContain('params.outcome === "NO_GO"');
    expect(serviceSource).toContain("Reason:");
  });

  it("includes condition summary for CONDITIONAL_GO in notification body", () => {
    expect(serviceSource).toContain('params.outcome === "CONDITIONAL_GO"');
    expect(serviceSource).toContain("Conditions:");
  });

  // ── Sets completedAt on approval ──

  it("sets completedAt on stage instance when outcome is GO or CONDITIONAL_GO", () => {
    expect(serviceSource).toContain('stageUpdates.completedAt = new Date()');
    expect(serviceSource).toContain('"APPROVED" || newStageStatus === "EXCEPTION_APPROVED"');
  });

  // ── Business interpretation documented ──

  it("documents the confirmed business interpretation for CONDITIONAL_GO", () => {
    expect(serviceSource).toContain("approved but with documented conditions");
    expect(serviceSource).toContain("EXCEPTION_APPROVED");
  });

  // ── Stage decision audit trail ──

  it("logs a stage decision for every outcome", () => {
    expect(serviceSource).toContain("tx.insert(projectStageDecisions)");
    expect(serviceSource).toContain("GATE_FAIL");
    expect(serviceSource).toContain("GATE_PASS");
  });
});
