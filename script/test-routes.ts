import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const registryPath = path.join(root, "client/src/config/page-registry.ts");
const inventoryPath = path.join(root, "docs/qa/app-route-inventory.md");

const registry = fs.readFileSync(registryPath, "utf8");
const inventory = fs.readFileSync(inventoryPath, "utf8");

const routeRegex = /path:\s*"([^"]+)"/g;
const routes = new Set<string>();
for (const match of registry.matchAll(routeRegex)) {
  routes.add(match[1]);
}

const hasRoute = (route: string) =>
  inventory.includes(`| ${route} |`) || inventory.includes(`| \`${route}\` |`);

const missing = [...routes].filter((route) => !hasRoute(route));

console.log(`Registered routes discovered: ${routes.size}`);
console.log(`Routes explicitly documented in inventory table: ${routes.size - missing.length}`);

if (missing.length > 0) {
  console.log("TODO: add the remaining registered routes to docs/qa/app-route-inventory.md");
  console.log("Missing routes:");
  for (const route of missing) {
    console.log(`- ${route}`);
  }
}

console.log("Route inventory script completed.");
