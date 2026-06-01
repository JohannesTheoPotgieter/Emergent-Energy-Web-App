import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();

const TARGET_ROUTE_FILES = [
  'server/engineering-routes.ts',
  // server/routes/engineering.routes.ts was a dead empty stub — deleted by
  // the engineer-function audit (see engineering-containment.test.ts H9).
  'server/quality-routes.ts',
  'server/routes/quality.routes.ts',
  'server/commissioning-routes.ts',
  'server/commissioning-dashboard-routes.ts',
] as const;

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function collectRouteSignatures(relPath: string): string[] {
  const source = read(relPath);
  const signatures: string[] = [];
  const routeRegex = /app\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;

  let match: RegExpExecArray | null;
  while ((match = routeRegex.exec(source)) !== null) {
    signatures.push(`${match[1].toUpperCase()} ${match[2]}`);
  }

  return signatures;
}

describe('domain route duplication risk checks (engineering / quality / commissioning)', () => {
  it('does not duplicate method+path signatures across target files', () => {
    const owners = new Map<string, string[]>();

    for (const relPath of TARGET_ROUTE_FILES) {
      for (const signature of collectRouteSignatures(relPath)) {
        const current = owners.get(signature) || [];
        current.push(relPath);
        owners.set(signature, current);
      }
    }

    const duplicates = [...owners.entries()].filter(([, files]) => files.length > 1);

    expect(duplicates).toEqual([]);
  });

  it('keeps placeholder extracted route files unmounted to avoid handler shadowing', () => {
    const registerCore = read('server/routes/register-core-routes.ts');
    const registerSupport = read('server/routes/register-support-routes.ts');

    expect(registerCore).not.toContain('../routes/engineering.routes');
    expect(registerCore).not.toContain('../routes/quality.routes');
    expect(registerSupport).not.toContain('../routes/engineering.routes');
    expect(registerSupport).not.toContain('../routes/quality.routes');
  });
});
