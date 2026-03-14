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
  category: "proof" | "optional";
};

type ReconciliationEvidence = {
  status?: GateStatus;
  generated_at?: string;
  explanation?: string;
  [key: string]: unknown;
};

const REPORTS_DIR = path.join(process.cwd(), "qa", "reports");
const RECONCILIATION_FILE = process.env.RELEASE_RECONCILIATION_FILE || path.join(REPORTS_DIR, "reconciliation-status.json");
const CRITICAL_DEFECT_FILE = process.env.CRITICAL_DEFECT_FILE || path.join(process.cwd(), "FINAL_DEFECT_REGISTER.md");
const REQUIRE_CRITICAL_DEFECT_FILE = process.env.REQUIRE_CRITICAL_DEFECT_FILE === "true";
const WORKFLOW_TEST_COMMAND = process.env.WORKFLOW_TEST_COMMAND || "npm run test:workflows";
const ROLE_AUDIT_FILE = process.env.ROLE_AUDIT_FILE || path.join(process.cwd(), "docs", "qa", "results", "latest", "role-permission-audit.md");
const CRITICAL_ROUTES = ["/projects", "/project/:projectName", "/cashflow", "/quality", "/engineering/tasks", "/pm-dashboard", "/admin/control-center", "/handover-control"];

const REQUIRED_COMMAND_CHECKS = [
  { name: "API tests", command: "npm run test:api" },
  { name: "Smoke tests", command: "npm run test:smoke" },
  { name: "Routes tests", command: "npm run test:routes" },
  { name: "Workflow tests", command: WORKFLOW_TEST_COMMAND },
] as const;

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
    return REQUIRE_CRITICAL_DEFECT_FILE
      ? { status: "fail", details: `Critical defect file required but missing: ${filePath}` }
      : { status: "warning", details: `Critical defect file not found (optional): ${filePath}. Manual signoff required.` };
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
  if (checks.some((check) => check.required && check.status !== "pass")) return "fail";
  if (checks.some((check) => !check.required && check.status === "warning")) return "warning";
  return "pass";
}

function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║         RELEASE GATE ENFORCEMENT        ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const checks: GateCheck[] = [];

  for (const checkDef of REQUIRED_COMMAND_CHECKS) {
    const commandResult = runCommand(checkDef.command);
    checks.push({
      name: checkDef.name,
      command: checkDef.command,
      required: true,
      category: "proof",
      status: commandResult.ok ? "pass" : "fail",
      details: commandResult.ok
        ? `${checkDef.name} passed.`
        : `${checkDef.name} failed with non-zero exit code.`,
    });
  }

  const reconciliation = readReconciliationEvidence(RECONCILIATION_FILE);
  if (!reconciliation) {
    checks.push({
      name: "Reconciliation status",
      required: true,
      category: "proof",
      status: "fail",
      details: `Missing or invalid reconciliation evidence: ${RECONCILIATION_FILE}`,
    });
  } else {
    const reconStatus = reconciliation.status || "fail";
    const normalizedStatus: GateStatus = reconStatus === "pass" ? "pass" : reconStatus === "warning" ? "warning" : "fail";
    checks.push({
      name: "Reconciliation status",
      required: true,
      category: "proof",
      status: normalizedStatus,
      details: `Reconciliation status=${reconStatus}${reconciliation.generated_at ? ` (generated ${reconciliation.generated_at})` : ""}${reconciliation.explanation ? `. ${reconciliation.explanation}` : ""}`,
    });
  }

  const defectCheck = evaluateCriticalDefects(CRITICAL_DEFECT_FILE);
  checks.push({
    name: "Critical defects",
    required: REQUIRE_CRITICAL_DEFECT_FILE,
    category: "optional",
    status: defectCheck.status,
    details: defectCheck.details,
  });

  const roleAuditCheck = evaluateRoleAudit(ROLE_AUDIT_FILE);
  checks.push({
    name: "Critical route role validation",
    required: true,
    category: "proof",
    status: roleAuditCheck.status,
    details: roleAuditCheck.details,
  });

  const overall = collapseStatus(checks);

  for (const check of checks) {
    const icon = check.status === "pass" ? "✅" : check.status === "warning" ? "⚠️" : "❌";
    const command = check.command ? ` [${check.command}]` : "";
    const requirement = check.required ? "REQUIRED" : "OPTIONAL";
    console.log(`${icon} ${check.name}${command} (${requirement}) — ${check.details}`);
  }

  const output = {
    generated_at: new Date().toISOString(),
    status: overall,
    checks,
    enforced_proofs: {
      commands: REQUIRED_COMMAND_CHECKS.map((item) => item.command),
      reconciliation_file: RECONCILIATION_FILE,
      role_audit_file: ROLE_AUDIT_FILE,
      critical_defect_file: CRITICAL_DEFECT_FILE,
      critical_defect_file_required: REQUIRE_CRITICAL_DEFECT_FILE,
      required_checks_fail_on_warning: true,
    },
    manual_signoff_required: checks.some((check) => !check.required && check.status === "warning"),
  };

  const outputFile = path.join(REPORTS_DIR, "release-gate-result.json");
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(`\nRelease gate result written to ${outputFile}`);
  console.log(`Overall release gate status: ${overall.toUpperCase()}`);
  if (overall === "fail") {
    console.log("Release gate blocked: required stability proof is missing, warning, or failed.");
  }

  process.exit(overall === "pass" ? 0 : 1);
}

main();
