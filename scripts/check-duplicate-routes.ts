/**
 * Detect duplicate Express route registrations by method+path.
 * Fails with non-zero exit if duplicates are found.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SERVER_DIR = path.join(ROOT, "server");

const METHOD_RE = /\bapp\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;

function stripComments(source: string): string {
  // Remove block comments first, then line comments.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && (full.endsWith(".ts") || full.endsWith(".js"))) out.push(full);
  }
  return out;
}

const files = walk(SERVER_DIR);
const routes = new Map<string, string[]>();

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const text = stripComments(fs.readFileSync(file, "utf8"));
  let m: RegExpExecArray | null;
  while ((m = METHOD_RE.exec(text)) !== null) {
    const key = `${m[1].toUpperCase()} ${m[2]}`;
    const existing = routes.get(key) ?? [];
    existing.push(rel);
    routes.set(key, existing);
  }
}

const duplicates = [...routes.entries()].filter(([, filesForRoute]) => filesForRoute.length > 1);

if (duplicates.length > 0) {
  console.error(`[duplicate-routes] Found ${duplicates.length} duplicate route signature(s):`);
  for (const [route, filesForRoute] of duplicates.sort((a, b) => a[0].localeCompare(b[0]))) {
    console.error(`  - ${route}`);
    for (const f of filesForRoute) {
      console.error(`      ${f}`);
    }
  }
  process.exit(1);
}

console.log("[duplicate-routes] PASS: no duplicate app.<method>(path) registrations detected");
