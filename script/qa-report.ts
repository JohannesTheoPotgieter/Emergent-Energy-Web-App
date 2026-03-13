import fs from "node:fs";
import path from "node:path";

const requiredFiles = [
  "docs/architecture/source-of-truth-matrix.md",
  "docs/qa/app-route-inventory.md",
  "docs/qa/release-gate.md",
  "docs/qa/templates/defect-log-template.md",
  "docs/qa/templates/route-coverage-matrix-template.md",
  "docs/qa/templates/workflow-test-evidence-template.md",
  "docs/qa/templates/role-permission-audit-template.md",
];

const missing: string[] = [];
for (const file of requiredFiles) {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) missing.push(file);
}

if (missing.length) {
  console.error("QA report precheck failed. Missing artifacts:");
  for (const file of missing) console.error(`- ${file}`);
  process.exit(1);
}

const latestDir = path.join(process.cwd(), "docs/qa/results/latest");
const latestEntries = fs.existsSync(latestDir) ? fs.readdirSync(latestDir).filter((n) => n !== ".gitkeep") : [];

console.log("QA stability framework precheck: PASS");
console.log(`- Required framework docs present: ${requiredFiles.length}`);
console.log(`- Latest evidence files: ${latestEntries.length}`);
console.log("TODO: Extend qa:report to aggregate automated test outputs and release-gate completion state.");
