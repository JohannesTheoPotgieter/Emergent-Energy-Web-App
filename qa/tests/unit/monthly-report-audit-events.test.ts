import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// T1.x audit Finding B: monthly report state transitions (review,
// publish, revert, regenerate) AND scheduler auto-generation did
// not write `audit_events` rows. State history was visible only via
// `monthly_report_snapshots.reviewedBy` / `publishedBy` columns —
// not via the unified audit timeline. Per AGENT_GUARDRAILS § 4 major
// state transitions should emit audit events.
//
// Fix: emit `audit_events` row on each transition for both PM and
// Engineering routes, plus on scheduler auto-generation.

function read(rel: string) {
  return fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
}

describe("monthly report audit events (T1.x Finding B)", () => {
  describe("PM monthly report routes", () => {
    const source = read("server/routes/pm-monthly-report-routes.ts");

    it("imports logAuditFromReq from audit-logger", () => {
      expect(source).toContain('import { logAuditFromReq } from "../audit-logger"');
    });

    it("emits audit on review transition", () => {
      expect(source).toMatch(
        /logAuditFromReq\(req,\s*\{[^}]*entityType:\s*"monthly_report"[^}]*action:\s*"review"/s,
      );
    });

    it("emits audit on publish transition", () => {
      expect(source).toMatch(
        /logAuditFromReq\(req,\s*\{[^}]*entityType:\s*"monthly_report"[^}]*action:\s*"publish"/s,
      );
    });

    it("emits audit on revert transition", () => {
      expect(source).toMatch(
        /logAuditFromReq\(req,\s*\{[^}]*entityType:\s*"monthly_report"[^}]*action:\s*"revert"/s,
      );
    });

    it("emits audit on regenerate", () => {
      expect(source).toMatch(
        /logAuditFromReq\(req,\s*\{[^}]*entityType:\s*"monthly_report"[^}]*action:\s*"regenerate"/s,
      );
    });

    it("includes report_type and report_month in changesJson", () => {
      expect(source).toMatch(/report_type:\s*REPORT_TYPE/);
      expect(source).toMatch(/report_month:\s*snapshot\.reportMonth/);
    });
  });

  describe("Engineering monthly report routes", () => {
    const source = read("server/routes/engineering-monthly-report-routes.ts");

    it("imports logAuditFromReq from audit-logger", () => {
      expect(source).toContain('import { logAuditFromReq } from "../audit-logger"');
    });

    it("emits audit on review transition", () => {
      expect(source).toMatch(
        /logAuditFromReq\(req,\s*\{[^}]*entityType:\s*"monthly_report"[^}]*action:\s*"review"/s,
      );
    });

    it("emits audit on publish transition", () => {
      expect(source).toMatch(
        /logAuditFromReq\(req,\s*\{[^}]*entityType:\s*"monthly_report"[^}]*action:\s*"publish"/s,
      );
    });

    it("emits audit on revert transition", () => {
      expect(source).toMatch(
        /logAuditFromReq\(req,\s*\{[^}]*entityType:\s*"monthly_report"[^}]*action:\s*"revert"/s,
      );
    });

    it("emits audit on regenerate", () => {
      expect(source).toMatch(
        /logAuditFromReq\(req,\s*\{[^}]*entityType:\s*"monthly_report"[^}]*action:\s*"regenerate"/s,
      );
    });
  });

  describe("Scheduler auto-generation", () => {
    const source = read("server/services/monthly-report-scheduler.ts");

    it("imports logAudit (no req available — system source)", () => {
      expect(source).toContain('import { logAudit } from "../audit-logger"');
    });

    it("captures the inserted snapshot id via .returning() to populate entityId", () => {
      expect(source).toContain(".returning({ id: monthlyReportSnapshots.id })");
    });

    it("emits SYSTEM-source audit event with action='auto_generate'", () => {
      expect(source).toContain("logAudit(");
      expect(source).toContain('action: "auto_generate"');
      expect(source).toMatch(/source:\s*"SYSTEM"/);
      expect(source).toMatch(/actorRole:\s*"system"/);
    });

    it("changesJson notes the trigger as scheduler_first_of_month", () => {
      expect(source).toContain('trigger: "scheduler_first_of_month"');
    });
  });
});
