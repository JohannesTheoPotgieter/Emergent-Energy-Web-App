import fs from 'fs';
import path from 'path';

const repo = process.cwd();

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.git')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else if (entry.isFile() && (p.endsWith('.ts') || p.endsWith('.tsx'))) acc.push(p);
  }
  return acc;
}

const serverFiles = walk(path.join(repo, 'server'));
const clientFiles = walk(path.join(repo, 'client'));

const routeRegex = /\bapp\.(get|post|put|patch|delete)\(\s*["'`](\/api\/[^"'`]+)["'`]/g;
const importSchemaRegex = /from\s+["']@shared\/schema["']/;

const legacyTables = ['projects', 'expenses', 'revenues', 'tasks', 'budgets'];

const routes = [];
for (const file of serverFiles) {
  const text = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = routeRegex.exec(text)) !== null) {
    routes.push({
      method: m[1].toUpperCase(),
      endpoint: m[2],
      file: path.relative(repo, file),
      text,
    });
  }
}

const clientText = clientFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

const rows = routes
  .map((r) => {
    const touched = legacyTables.filter((tbl) => new RegExp(`\\b${tbl}\\b`).test(r.text));
    const frontendUsage = clientText.includes(r.endpoint.split('/:')[0]) ? 'yes' : 'unknown';
    const replacement = r.endpoint.startsWith('/api/v2') ? r.endpoint : r.endpoint.replace(/^\/api\//, '/api/v2/');
    const decision = r.endpoint.startsWith('/api/v2') ? 'keep' : touched.length ? 'replace' : 'review';

    return {
      oldEndpoint: `${r.method} ${r.endpoint}`,
      purpose: `Defined in ${r.file}`,
      frontendUsage,
      tablesTouched: touched.length ? touched.join(', ') : 'new-schema-or-unknown',
      replacementEndpoint: `${r.method} ${replacement}`,
      action: decision,
      source: r.file,
    };
  })
  .sort((a, b) => a.oldEndpoint.localeCompare(b.oldEndpoint));

const lines = [];
lines.push('# API Migration Matrix');
lines.push('');
lines.push('> Auto-generated from backend route declarations and static usage heuristics. Validate manually before cutover.');
lines.push('');
lines.push('| Old endpoint | Purpose | Frontend usage | Tables touched | Replacement endpoint | Keep/Replace/Delete |');
lines.push('|---|---|---|---|---|---|');
for (const row of rows) {
  lines.push(`| ${row.oldEndpoint} | ${row.purpose} | ${row.frontendUsage} | ${row.tablesTouched} | ${row.replacementEndpoint} | ${row.action} |`);
}

const out = path.join(repo, 'docs/api/API_MIGRATION_MATRIX.md');
fs.writeFileSync(out, lines.join('\n'));
console.log(`Generated ${rows.length} rows -> ${path.relative(repo, out)}`);
