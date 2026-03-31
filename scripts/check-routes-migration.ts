/**
 * CI Check: Verify routes.ts is not growing.
 *
 * Fails if routes.ts line count exceeds the frozen baseline.
 * Prints migration progress percentage.
 *
 * Run: npx tsx scripts/check-routes-migration.ts
 */

import fs from "node:fs";
import path from "node:path";

const ROUTES_FILE = path.join(process.cwd(), "server/routes.ts");
const FROZEN_BASELINE = 9520; // Line count at freeze date (2026-03-31), includes FROZEN header + EXTRACTED markers
const TARGET = 0;

const content = fs.readFileSync(ROUTES_FILE, "utf8");
const currentLines = content.split("\n").length;

// Count route handlers
const handlerCount = (content.match(/app\.(get|post|patch|put|delete)\(/g) || []).length;

// Count EXTRACTED markers
const extractedCount = (content.match(/EXTRACTED to server\/routes\//g) || []).length;

const reductionPct = ((FROZEN_BASELINE - currentLines) / FROZEN_BASELINE * 100).toFixed(1);

console.log("=== routes.ts Migration Progress ===");
console.log(`Lines:     ${currentLines} / ${FROZEN_BASELINE} baseline (${reductionPct}% reduced)`);
console.log(`Handlers:  ${handlerCount} remaining`);
console.log(`Extracted: ${extractedCount} marker(s)`);
console.log(`Target:    ${TARGET} lines`);

if (currentLines > FROZEN_BASELINE) {
  console.error(`\nFAIL: routes.ts grew from ${FROZEN_BASELINE} to ${currentLines} lines.`);
  console.error("Do NOT add new routes to routes.ts — use server/routes/<domain>-routes.ts instead.");
  process.exit(1);
} else {
  console.log("\nPASS: routes.ts has not grown above baseline.");
  process.exit(0);
}
