import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

type GateStatus = "pass" | "warning" | "fail";

type GateCheck = {
  name: string;
  command?: string;
  status: GateStatus;
  details: string;
  required: boolean;
};

type ReconciliationEvidence = {
  status?: GateStatus;
  generated_at?: string;
  [key: string]: unknown;
};

const REPORTS_DIR = path.join(process.cwd(), "qa", "reports");
const RECONCILIATION_FILE = process.env.RELEASE_RECONCILIATION_FILE || path.join(REPORTS_DIR, "reconciliation-status.json");
const CRITICAL_DEFECT_FILE = process.env.CRITICAL_DEFECT_FILE || path.join(process.cwd(), "FINAL_DEFECT_REGISTER.md");
const WORKFLOW_TEST_COMMAND = process.env.WORKFLOW_TEST_COMMAND || "npm run test:workflows";
const ROLE_AUDIT_FILE = process.env.ROLE_AUDIT_FILE || path.join(process.cwd(), "docs", "qa", "results", "latest", "role-permission-audit.md");
const CRITICAL_ROUTES = ["/projects", "/project/:projectName", "/cashflow", "/quality", "/engineering/tasks", "/pm-dashboard", "/admin/control-center", "/handover-control"];

function runCommand(command: string): { ok: boolean; output: string } {
  const result = spawnSync(command, { shell: true, encoding: "utf8", cwd: process.cwd() });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  return { ok: result.status === 0, output };
}

function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readReconciliationEvidence(filePath: string): ReconciliationEvidence | null {
  if (!fileExists(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function evaluateCriticalDefects(filePath: string): { status: GateStatus; details: string } {
  if (!fileExists(filePath)) {
    return { status: "fail", details: `Critical defect file missing: ${filePath}` };
  }

  const content = fs.readFileSync(filePath, "utf8");
  const rows = content.split("\n").filter((line) => line.trim().startsWith("|"));
  const criticalOrHighOpen = rows.filter((line) => {
    const normalized = line.toLowerCase();
    const isCritical =
      normalized.includes("| critical ") ||
      normalized.includes("| high ") ||
      normalized.includes("| severity 1 ") ||
      normalized.includes("| p0 ") ||
      normalized.includes("| p1 ");
    const isClosed =
      normalized.includes("**fixed**") ||
      normalized.includes("**closed") ||
      normalized.includes("| fixed") ||
      normalized.includes("| closed") ||
      normalized.includes("| resolved");
    return isCritical && !isClosed;
  });

  if (criticalOrHighOpen.length > 0) {
    return {
      status: "fail",
      details: `Open critical/high defects found (${criticalOrHighOpen.length}) in ${path.basename(filePath)}.`,
    };
  }

  return { status: "pass", details: `No open critical/high defects in ${path.basename(filePath)}.` };
}

function evaluateRoleAudit(filePath: string): { status: GateStatus; details: string } {
  if (!fileExists(filePath)) {
    return { status: "fail", details: `Role permission audit missing: ${filePath}` };
  }

  const content = fs.readFileSync(filePath, "utf8").toLowerCase();
  const lines = content.split("\n");
  const missingRoutes = CRITICAL_ROUTES.filter((route) => {
    const routeTokenA = `| ${route.toLowerCase()} |`;
    const routeTokenB = `| \`${route.toLowerCase()}\` |`;
    const routeLines = lines.filter((line) => line.includes(routeTokenA) || line.includes(routeTokenB));
    if (routeLines.length === 0) return true;
    return !routeLines.some((line) => line.includes("| pass") || line.includes("| **pass**"));
  });

  if (missingRoutes.length > 0) {
    return {
      status: "fail",
      details: `Missing passing role validation for critical routes: ${missingRoutes.join(", ")}.`,
    };
  }

  return { status: "pass", details: "Critical route role validation present and passing." };
}

function collapseStatus(checks: GateCheck[]): GateStatus {
  if (checks.some((check) => check.required && check.status === "fail")) return "fail";
  if (checks.some((check) => check.required && check.status === "warning")) return "warning";
  return "pass";
}

function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║         RELEASE GATE ENFORCEMENT        ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const checks: GateCheck[] = [];

  const apiTestCommand = "npm run test:api";
  const apiResult = runCommand(apiTestCommand);
  checks.push({
    name: "API tests",
    command: apiTestCommand,
    required: true,
    status: apiResult.ok ? "pass" : "fail",
    details: apiResult.ok ? "API test suite passed." : "API test suite failed.",
  });

  const smokeTestCommand = "npm run test:smoke";
  const smokeResult = runCommand(smokeTestCommand);
  checks.push({
    name: "Smoke tests",
    command: smokeTestCommand,
    required: true,
    status: smokeResult.ok ? "pass" : "fail",
    details: smokeResult.ok ? "Smoke test suite passed." : "Smoke test suite failed.",
  });

  const workflowResult = runCommand(WORKFLOW_TEST_COMMAND);
  checks.push({
    name: "Workflow tests",
    command: WORKFLOW_TEST_COMMAND,
    required: true,
    status: workflowResult.ok ? "pass" : "fail",
    details: workflowResult.ok ? "Workflow test command passed." : "Workflow test command failed.",
  });

  const reconciliation = readReconciliationEvidence(RECONCILIATION_FILE);
  if (!reconciliation) {
    checks.push({
      name: "Reconciliation status",
      required: true,
      status: "fail",
      details: `Missing or invalid reconciliation evidence: ${RECONCILIATION_FILE}`,
    });
  } else {
    const reconStatus = reconciliation.status || "fail";
    const status: GateStatus = reconStatus === "pass" ? "pass" : reconStatus === "warning" ? "warning" : "fail";
    checks.push({
      name: "Reconciliation status",
      required: true,
      status,
      details: `Reconciliation status=${reconStatus}${reconciliation.generated_at ? ` (generated ${reconciliation.generated_at})` : ""}.`,
    });
  }

  const defectCheck = evaluateCriticalDefects(CRITICAL_DEFECT_FILE);
  checks.push({
    name: "Critical defects",
    required: true,
    status: defectCheck.status,
    details: defectCheck.details,
  });

  const roleAuditCheck = evaluateRoleAudit(ROLE_AUDIT_FILE);
  checks.push({
    name: "Critical route role validation",
    required: true,
    status: roleAuditCheck.status,
    details: roleAuditCheck.details,
  });

  const overall = collapseStatus(checks);

  for (const check of checks) {
    const icon = check.status === "pass" ? "✅" : check.status === "warning" ? "⚠️" : "❌";
    const command = check.command ? ` [${check.command}]` : "";
    console.log(`${icon} ${check.name}${command} — ${check.details}`);
  }

  const output = {
    generated_at: new Date().toISOString(),
    status: overall,
    checks,
    required_evidence: {
      reconciliation_file: RECONCILIATION_FILE,
      critical_defect_file: CRITICAL_DEFECT_FILE,
      role_audit_file: ROLE_AUDIT_FILE,
    },
    manual_signoff_required: checks.some((check) => check.status === "warning"),
  };

  const outputFile = path.join(REPORTS_DIR, "release-gate-result.json");
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(`\nRelease gate result written to ${outputFile}`);
  console.log(`Overall release gate status: ${overall.toUpperCase()}`);

  process.exit(overall === "pass" ? 0 : 1);
}

main();
