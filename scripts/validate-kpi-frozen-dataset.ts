import fs from "node:fs";
import path from "node:path";

const datasetPath = path.join(process.cwd(), "qa", "kpi-frozen-dataset.json");

if (!fs.existsSync(datasetPath)) {
  console.error(`Missing required frozen KPI dataset: ${datasetPath}`);
  process.exit(1);
}

const raw = fs.readFileSync(datasetPath, "utf8");
let data: any;
try {
  data = JSON.parse(raw);
} catch (error) {
  console.error("kpi-frozen-dataset.json is not valid JSON", error);
  process.exit(1);
}

const requiredRoot = ["dataset_owner", "approval_date", "approval_ticket", "kpis"];
for (const key of requiredRoot) {
  if (!(key in data)) {
    console.error(`Missing root field: ${key}`);
    process.exit(1);
  }
}

if (typeof data.dataset_owner !== "string" || !data.dataset_owner.trim()) {
  console.error("dataset_owner must be a non-empty string");
  process.exit(1);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data.approval_date))) {
  console.error("approval_date must use YYYY-MM-DD format");
  process.exit(1);
}

if (typeof data.approval_ticket !== "string" || !data.approval_ticket.trim()) {
  console.error("approval_ticket must be a non-empty string");
  process.exit(1);
}

if (!data.kpis || typeof data.kpis !== "object") {
  console.error("kpis must be an object");
  process.exit(1);
}

for (const kpiKey of ["planned_outcome_vs_budget_pct", "actual_cos_realised"]) {
  if (typeof data.kpis[kpiKey] !== "number" || !Number.isFinite(data.kpis[kpiKey])) {
    console.error(`kpis.${kpiKey} must be a finite number`);
    process.exit(1);
  }
}

console.log("Frozen KPI dataset validation passed.");
