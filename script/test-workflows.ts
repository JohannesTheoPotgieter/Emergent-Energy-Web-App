import { spawnSync } from "node:child_process";

type WorkflowCheck = {
  name: string;
  command: string;
  required: boolean;
};

const checks: WorkflowCheck[] = [
  { name: "Route inventory coverage", command: "npm run test:routes", required: true },
  { name: "Workflow-critical API pack", command: "vitest run -c qa/vitest.config.ts qa/tests/api/workflow-critical-pack.test.ts", required: true },
  { name: "Priority route proof", command: "vitest run -c qa/vitest.config.ts qa/tests/unit/route-proof.test.ts", required: true },
];

let failed = false;

for (const check of checks) {
  console.log(`\n▶ ${check.name}`);
  console.log(`$ ${check.command}`);

  const result = spawnSync(check.command, { shell: true, stdio: "inherit" });
  const ok = result.status === 0;
  const icon = ok ? "✅" : "❌";
  console.log(`${icon} ${check.name} ${ok ? "passed" : "failed"}`);

  if (!ok && check.required) {
    failed = true;
  }
}

if (failed) {
  console.error("\nWorkflow proof failed. At least one required workflow check is failing.");
  process.exit(1);
}

console.log("\nAll required workflow proof checks passed.");
