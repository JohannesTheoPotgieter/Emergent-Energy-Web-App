import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('project detail trust and permission UX guards', () => {
  const pagePath = path.resolve(process.cwd(), 'client/src/pages/project-detail.tsx');
  const source = fs.readFileSync(pagePath, 'utf8');

  it('renders trust marker strip with source and freshness cues', () => {
    expect(source).toContain('data-testid="project-trust-markers"');
    expect(source).toContain('TrustMarker label="Revenue" source="Excel / App"');
    expect(source).toContain('TrustMarker label="Cashflow" source="QuickBooks / App"');
    expect(source).toContain('Unable to load');
  });

  it('surfaces permission reasons when sections are unavailable', () => {
    expect(source).toContain('data-testid="project-dept-permission-hints"');
    expect(source).toContain('Engineering locked:');
    expect(source).toContain('Finance locked:');
  });
});
