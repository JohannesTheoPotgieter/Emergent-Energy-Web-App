/**
 * PR-E redesign — /project/v2/:projectId workspace tab mapping.
 *
 * The new shell collapses 9 departments × 27 sub-tabs into 4 tabs
 * (Plan / Money / Quality / Handover). Sub-departments become
 * section headers, not nested tabs. This test pins the canonical
 * mapping so a future refactor can't silently move a section
 * between tabs or drop one entirely.
 */

import { describe, expect, it } from 'vitest';
import {
  PROJECT_WORKSPACE_TABS,
  PROJECT_WORKSPACE_TAB_LABELS,
  PROJECT_WORKSPACE_SECTIONS,
  sectionsForTab,
} from '../../../client/src/pages/project-workspace-tabs';

describe('project workspace — tab list', () => {
  it('exposes exactly four tabs in order', () => {
    expect([...PROJECT_WORKSPACE_TABS]).toEqual([
      'plan',
      'money',
      'quality',
      'handover',
    ]);
  });

  it('every tab has a label', () => {
    for (const tab of PROJECT_WORKSPACE_TABS) {
      expect(PROJECT_WORKSPACE_TAB_LABELS[tab]).toBeTruthy();
    }
  });
});

describe('project workspace — section catalogue', () => {
  it('every section belongs to one of the four tabs', () => {
    const validTabs = new Set<string>(PROJECT_WORKSPACE_TABS);
    for (const s of PROJECT_WORKSPACE_SECTIONS) {
      expect(validTabs.has(s.tab), `section "${s.title}" routed to unknown tab "${s.tab}"`).toBe(true);
    }
  });

  it('every section carries a `legacyLocation` so users can find the same data', () => {
    for (const s of PROJECT_WORKSPACE_SECTIONS) {
      expect(s.legacyLocation, `section "${s.title}" missing legacyLocation`).toMatch(/[A-Za-z]/);
    }
  });

  it('section titles are unique (used as React keys)', () => {
    const seen = new Set<string>();
    for (const s of PROJECT_WORKSPACE_SECTIONS) {
      expect(seen.has(s.title), `duplicate section title: ${s.title}`).toBe(false);
      seen.add(s.title);
    }
  });
});

describe('project workspace — sectionsForTab()', () => {
  it('returns only sections for the requested tab', () => {
    for (const tab of PROJECT_WORKSPACE_TABS) {
      const sections = sectionsForTab(tab);
      for (const s of sections) expect(s.tab).toBe(tab);
    }
  });

  it('every tab has at least one section (no empty tab)', () => {
    for (const tab of PROJECT_WORKSPACE_TABS) {
      const sections = sectionsForTab(tab);
      expect(sections.length, `tab "${tab}" has no sections`).toBeGreaterThan(0);
    }
  });

  it('plan tab includes Schedule (WBS) and RAID', () => {
    const titles = sectionsForTab('plan').map((s) => s.title);
    expect(titles).toContain('Schedule (WBS)');
    expect(titles.some((t) => t.startsWith('RAID'))).toBe(true);
  });

  it('money tab includes revenue + expenditure + cashflow', () => {
    const titles = sectionsForTab('money').map((s) => s.title);
    expect(titles).toContain('Revenue tracking');
    expect(titles).toContain('Expenditure');
    expect(titles).toContain('Cashflow');
  });

  it('quality tab includes the checklist', () => {
    const titles = sectionsForTab('quality').map((s) => s.title);
    expect(titles).toContain('Quality checklist');
  });

  it('handover tab includes Handover', () => {
    const titles = sectionsForTab('handover').map((s) => s.title);
    expect(titles).toContain('Handover');
  });
});
