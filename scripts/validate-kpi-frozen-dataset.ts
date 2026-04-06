import fs from "node:fs";
import path from "node:path";

const datasetPath = path.join(process.cwd(), "qa", "kpi-frozen-dataset.json");
const ownerGuidePath = path.join(process.cwd(), "docs", "qa", "kpi-frozen-dataset-process.md");

const requiredRoot = ["dataset_owner", "approval_date", "approval_ticket", "kpis"] as const;
const requiredKpis = ["planned_outcome_vs_budget_pct", "actual_cos_realised"] as const;

function fail(message: string): never {
  console.error(message);
  console.error(`Required dataset file: ${datasetPath}`);
  console.error(`Required root fields: ${requiredRoot.join(", ")}`);
  console.error(`Required KPI fields: ${requiredKpis.join(", ")}`);
  console.error(`Owner must provide approvals in: ${ownerGuidePath}`);
  process.exit(1);
}

if (!fs.existsSync(datasetPath)) {
  fail("Missing required frozen KPI dataset.");
}

const raw = fs.readFileSync(datasetPath, "utf8");
let data: any;
try {
  data = JSON.parse(raw);
} catch (error) {
  fail(`kpi-frozen-dataset.json is not valid JSON: ${String(error)}`);
}

for (const key of requiredRoot) {
  if (!(key in data)) {
    fail(`Missing root field: ${key}`);
  }
}

if (typeof data.dataset_owner !== "string" || !data.dataset_owner.trim()) {
  fail("dataset_owner must be a non-empty string.");
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.approval_date))) {
  fail("approval_date must use YYYY-MM-DD format.");
}

if (typeof data.approval_ticket !== "string" || !data.approval_ticket.trim()) {
  fail("approval_ticket must be a non-empty string.");
}

if (!data.kpis || typeof data.kpis !== "object") {
  fail("kpis must be an object.");
}

for (const kpiKey of requiredKpis) {
  if (typeof data.kpis[kpiKey] !== "number" || !Number.isFinite(data.kpis[kpiKey])) {
    fail(`kpis.${kpiKey} must be a finite number.`);
  }
}

console.log("Frozen KPI dataset validation passed.");
