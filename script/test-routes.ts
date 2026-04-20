/**
 * Route inventory generator — Phase 4 long-term fix.
 *
 * Previously this script asserted that a hand-written
 * docs/qa/app-route-inventory.md contained every registered SPA route.
 * That file was archived and every run crashed with ENOENT. The drift
 * source was "hand-written doc must be kept in sync with a registry" —
 * a discipline that chronically failed.
 *
 * New contract: the inventory is generated from the registry on every
 * run. Drift is impossible because there is no longer a second source
 * of truth.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const registryPath = path.join(root, "client/src/config/page-registry.ts");
const outputDir = path.join(root, "docs/qa");
const outputPath = path.join(outputDir, "app-route-inventory.md");

if (!fs.existsSync(registryPath)) {
  console.error(`[test:routes] registry not found at ${registryPath}`);
  process.exit(2);
}

const registrySrc = fs.readFileSync(registryPath, "utf8");

interface RouteEntry {
  path: string;
  title: string;
  navGroup: string;
  permissionEntity: string;
  permissionAction: string;
}

const routes: RouteEntry[] = [];
const pathMarker = /path:\s*"([^"]+)"/g;
let match: RegExpExecArray | null;
while ((match = pathMarker.exec(registrySrc)) !== null) {
  const routePath = match[1];
  const offset = match.index;

  // Walk backwards to the nearest `{` and forwards to the matching `}`.
  const openIdx = registrySrc.lastIndexOf("{", offset);
  let depth = 1;
  let closeIdx = offset;
  for (let i = offset; i < registrySrc.length; i += 1) {
    if (registrySrc[i] === "{") depth += 1;
    if (registrySrc[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }

  const block = registrySrc.slice(openIdx, closeIdx + 1);
  const fields: Record<string, string> = {};
  let kv: RegExpExecArray | null;
  const localKv = /(\w+):\s*"([^"]*)"/g;
  while ((kv = localKv.exec(block)) !== null) {
    fields[kv[1]] = kv[2];
  }

  routes.push({
    path: routePath,
    title: fields.title ?? "",
    navGroup: fields.navGroup ?? "",
    permissionEntity: fields.permissionEntity ?? "",
    permissionAction: fields.permissionAction ?? "",
  });
}

if (routes.length === 0) {
  console.error(
    "[test:routes] parsed zero routes from the registry — the file format may have changed. " +
      "Expected object literals with `path: \"...\"` fields.",
  );
  process.exit(1);
}

// Dedupe on path (first occurrence wins) and sort for a stable document.
const byPath = new Map<string, RouteEntry>();
for (const r of routes) {
  if (!byPath.has(r.path)) byPath.set(r.path, r);
}
const sorted = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));

const generatedAt = new Date().toISOString();
const lines: string[] = [
  "# App Route Inventory",
  "",
  `**Generated** ${generatedAt} by \`script/test-routes.ts\`. Do not hand-edit — regenerate with \`npm run test:routes\`.`,
  "",
  `Source: \`client/src/config/page-registry.ts\``,
  "",
  `Total registered paths: ${sorted.length}`,
  "",
  "| Path | Title | Nav group | Permission |",
  "|------|-------|-----------|------------|",
];
for (const r of sorted) {
  const permission =
    r.permissionEntity && r.permissionAction
      ? `${r.permissionEntity}:${r.permissionAction}`
      : r.permissionEntity || r.permissionAction || "—";
  lines.push(`| \`${r.path}\` | ${r.title || "—"} | ${r.navGroup || "—"} | ${permission} |`);
}
lines.push("");

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, lines.join("\n"));

console.log(`[test:routes] wrote ${sorted.length} routes to ${path.relative(root, outputPath)}`);
