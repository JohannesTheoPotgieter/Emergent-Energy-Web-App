import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

type SmokeRow = {
  domain: 'engineering' | 'quality' | 'commissioning';
  frontendPath: string;
  backendEndpoint: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  permissionEntity?: string;
  legacyAlias?: boolean;
};

const ROOT = process.cwd();

const ROUTE_SMOKE_MATRIX: SmokeRow[] = [
  { domain: 'engineering', frontendPath: '/engineering', backendEndpoint: '/api/eng/dashboard/overview', method: 'GET', permissionEntity: 'engineering' },
  { domain: 'engineering', frontendPath: '/engineering/tasks', backendEndpoint: '/api/eng/tasks', method: 'GET', permissionEntity: 'eng_tasks' },
  { domain: 'quality', frontendPath: '/quality', backendEndpoint: '/api/quality/dashboard', method: 'GET', permissionEntity: 'quality' },
  { domain: 'quality', frontendPath: '/quality/dashboard', backendEndpoint: '/api/quality/dashboard', method: 'GET', permissionEntity: 'quality', legacyAlias: true },
  { domain: 'quality', frontendPath: '/quality/ncrs', backendEndpoint: '/api/quality/ncrs', method: 'GET', permissionEntity: 'quality', legacyAlias: true },
  { domain: 'commissioning', frontendPath: '/commissioning-dashboard', backendEndpoint: '/api/commissioning-dashboard/:projectId', method: 'GET', permissionEntity: 'commissioning' },
  { domain: 'commissioning', frontendPath: '/commissioning-dashboard/:projectId', backendEndpoint: '/api/commissioning-dashboard/:projectId', method: 'GET', permissionEntity: 'commissioning' },
  { domain: 'commissioning', frontendPath: '/commissioning-dashboard/:projectId', backendEndpoint: '/api/commissioning/project/:projectId', method: 'GET', permissionEntity: 'commissioning' },
] as const;

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function routeDeclRegex(method: SmokeRow['method'], endpoint: string): RegExp {
  return new RegExp(`app\\.${method.toLowerCase()}\\(\\s*["'\
\`]${escapeRegex(endpoint)}["'\
\`]`);
}

describe('domain runtime route smoke proof (engineering / quality / commissioning)', () => {
  it('keeps critical backend endpoints registered on active route surfaces', () => {
    const engineeringSource = read('server/engineering-routes.ts');
    const qualitySource = read('server/quality-routes.ts');
    const qualityNcrSource = read('server/quality-ncr-routes.ts');
    const commissioningSource = read('server/commissioning-routes.ts');
    const commissioningDashboardSource = read('server/commissioning-dashboard-routes.ts');

    const sourceByEndpoint: Record<string, string> = {
      '/api/eng/dashboard/overview': engineeringSource,
      '/api/eng/tasks': engineeringSource,
      '/api/quality/dashboard': qualitySource,
      '/api/quality/ncrs': qualityNcrSource,
      '/api/commissioning-dashboard/:projectId': commissioningDashboardSource,
      '/api/commissioning/project/:projectId': commissioningSource,
    };

    for (const row of ROUTE_SMOKE_MATRIX) {
      const source = sourceByEndpoint[row.backendEndpoint];
      expect(source, `Missing source mapping for ${row.backendEndpoint}`).toBeTruthy();
      expect(source).toMatch(routeDeclRegex(row.method, row.backendEndpoint));
    }
  });

  it('keeps required permissions attached to critical backend endpoints', () => {
    const endpointPermissions: Array<{ endpoint: string; sourcePath: string; token: string; method: 'get' }> = [
      { endpoint: '/api/eng/tasks', sourcePath: 'server/engineering-routes.ts', token: 'requirePermission("eng_tasks", "view")', method: 'get' },
      { endpoint: '/api/quality/dashboard', sourcePath: 'server/quality-routes.ts', token: 'requirePermission("quality", "view")', method: 'get' },
      { endpoint: '/api/quality/ncrs', sourcePath: 'server/quality-ncr-routes.ts', token: 'requirePermission("quality", "view")', method: 'get' },
      { endpoint: '/api/commissioning/project/:projectId', sourcePath: 'server/commissioning-routes.ts', token: 'requirePermission("commissioning", "view")', method: 'get' },
      { endpoint: '/api/commissioning-dashboard/:projectId', sourcePath: 'server/commissioning-dashboard-routes.ts', token: 'requirePermission("commissioning", "view")', method: 'get' },
    ];

    for (const check of endpointPermissions) {
      const source = read(check.sourcePath);
      const routeStart = source.indexOf(`app.${check.method}(\"${check.endpoint}\"`);
      expect(routeStart, `${check.endpoint} not found in ${check.sourcePath}`).toBeGreaterThan(-1);
      const window = source.slice(routeStart, routeStart + 300);
      expect(window).toContain(check.token);
    }
  });

  it('keeps frontend aliases mapped to live domain surfaces', () => {
    const pageRegistry = read('client/src/config/page-registry.ts');

    expect(pageRegistry).toContain('{ id: "qualityDashboardV2", path: "/quality/dashboard"');
    expect(pageRegistry).toContain('redirectTo: "/quality"');

    expect(pageRegistry).toContain('{ id: "qualityNcrList", path: "/quality/ncrs"');
    expect(pageRegistry).toContain('{ id: "qualityNcrDetail", path: "/quality/ncr/:id"');
  });

  it('keeps placeholder extracted route files unmounted', () => {
    const registerCore = read('server/routes/register-core-routes.ts');
    const registerSupport = read('server/routes/register-support-routes.ts');

    expect(registerCore).not.toContain('../routes/engineering.routes');
    expect(registerCore).not.toContain('../routes/quality.routes');
    expect(registerSupport).not.toContain('../routes/engineering.routes');
    expect(registerSupport).not.toContain('../routes/quality.routes');
  });
});
