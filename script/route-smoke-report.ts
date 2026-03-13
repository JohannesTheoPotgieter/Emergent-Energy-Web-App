import fs from "node:fs";
import path from "node:path";
import { buildRouteProofResults } from "../qa/utils/route-proof";

const results = buildRouteProofResults();
const outDir = path.join(process.cwd(), "qa/reports");
fs.mkdirSync(outDir, { recursive: true });

const jsonPath = path.join(outDir, "route-smoke-report.json");
fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));

const rows = results
  .map((result) => {
    const missing = result.missingMarkers.length ? result.missingMarkers.join(", ") : "-";
    return `| ${result.route} | ${result.status.toUpperCase()} | ${missing} | ${result.permissionBlockedExpected ? "yes" : "no"} | ${result.apiDependencies.length ? result.apiDependencies.join("<br>") : "-"} |`;
  })
  .join("\n");

const todo = results.map((result) => `- [ ] ${result.route} (${result.label}): ${result.todo}`).join("\n");
const suspected = results.filter((result) => result.suspectedDeadView || result.missingMarkers.length > 0);
const suspectedLines = suspected.length
  ? suspected.map((result) => `- ${result.route}: ${result.missingMarkers.join(", ") || "incomplete content"}`).join("\n")
  : "- None";

const markdown = `# Route Smoke Report\n\nGenerated: ${new Date().toISOString()}\n\n## Coverage Summary\n- Routes checked: ${results.length}\n- Passed: ${results.filter((r) => r.status === "pass").length}\n- Warnings: ${results.filter((r) => r.status === "warn").length}\n- Failed: ${results.filter((r) => r.status === "fail").length}\n\n## Route Results\n| Route | Status | Missing UI markers | Permission-blocked expected | Route-to-API dependencies |\n|---|---|---|---|---|\n${rows}\n\n## Suspected dead/incomplete views\n${suspectedLines}\n\n## TODO: deeper interaction coverage\n${todo}\n`;

const mdPath = path.join(outDir, "route-smoke-report.md");
fs.writeFileSync(mdPath, markdown);

console.log(`Route smoke report written:\n- ${jsonPath}\n- ${mdPath}`);
