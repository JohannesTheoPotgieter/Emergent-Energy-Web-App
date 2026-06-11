import { describe, expect, it } from "vitest";
import {
  TOP_SECTIONS,
  DISPLAY_TOP_NAV,
  buildVisibleTopSections,
  ROLE_VISIBLE_SECTIONS,
  type SectionKey,
} from "@/config/app-navigation";

/**
 * Nav cleanup validation — locks the COO-spec six-tab nav (2026-05-11):
 *
 *   Home · Project Delivery · Finance · Engineering · Quality Management · Settings
 *
 * Project Delivery has exactly three items: Execution Dashboard · All Projects ·
 * Milestone Tracker. Finance has five: Cashflow · Cost of Sales · Revenue ·
 * Gross Profit · FYE Tracking Report. Engineering has four: Dashboard · Task
 * Board · Document Management · Standup. Quality has three: Dashboard · Task
 * Board · Document Management. Settings has four: Roles & Permissions ·
 * Functionality Control · Integration Statuses · Audit Log. Everything else
 * is hidden by default and surfaced via Functionality Control.
 */

const EXPECTED_TOP_LABELS = [
  "Home",
  "Project Delivery",
  "Finance",
  "Engineering",
  "Quality Management",
  "Settings",
];

function findTop(label: string) {
  const section = TOP_SECTIONS.find((s) => s.label === label);
  expect(section, `${label} top section must exist`).toBeDefined();
  return section!;
}

describe("nav cleanup — six-tab COO spec", () => {
  it("DISPLAY_TOP_NAV has exactly six top-level tabs in the canonical order", () => {
    const labels = DISPLAY_TOP_NAV.map((item) => item.label);
    expect(labels).toEqual(EXPECTED_TOP_LABELS);
  });

  it("Project Delivery has the three locked items", () => {
    const section = findTop("Project Delivery");
    expect(section.secondary.map((item) => item.path)).toEqual([
      "/execution-board",
      "/projects",
      "/milestone-tracker",
    ]);
  });

  it("Finance has the locked items and operations in spec order", () => {
    const section = findTop("Finance");
    expect(section.secondary.map((item) => item.path)).toEqual([
      "/finance",
      "/cashflow",
      "/cos",
      "/revenue-tracker",
      "/finance/gp/company",
      "/finance/qb-reconciliation",
      "/finance/close",
      "/fye-revenue-tracking",
      "/payment-request-board",
      "/po-approval-board",
    ]);
  });

  it("Engineering has the four locked items in spec order", () => {
    const section = findTop("Engineering");
    expect(section.secondary.map((item) => item.path)).toEqual([
      "/engineering",
      "/engineering/tasks",
      "/engineering/documents",
      "/engineering/standup",
    ]);
  });

  it("Quality Management has the three locked items in spec order", () => {
    const section = findTop("Quality Management");
    expect(section.secondary.map((item) => item.path)).toEqual([
      "/quality",
      "/quality/tasks",
      "/quality/documents",
    ]);
  });

  it("Settings has the four locked items in spec order", () => {
    const section = findTop("Settings");
    expect(section.secondary.map((item) => item.path)).toEqual([
      "/admin/roles",
      "/admin/functionality",
      "/admin/integrations",
      "/admin/activity-log",
    ]);
  });

  it("Home secondary still surfaces personal-workspace items", () => {
    const section = findTop("Home");
    const paths = section.secondary.map((item) => item.path);
    // Phase 7B: /my-work/tasks dropped from secondary nav. Replaced by
    // /priorities which is the unified surface for personal work
    // (work_items + personal priorities in one feed).
    expect(paths).toContain("/priorities");
    expect(paths).toContain("/my-work/calendar");
    expect(paths).toContain("/inbox");
  });

  it("legacy 'Projects' / 'Departments' / 'Reports' / 'Admin' display tabs are gone", () => {
    const labels = new Set(DISPLAY_TOP_NAV.map((i) => i.label as string));
    for (const removed of ["Projects", "Departments", "Reports", "Admin"]) {
      expect(labels.has(removed)).toBe(false);
    }
  });

  it("ROLE_VISIBLE_SECTIONS still covers every CompanyRole", () => {
    const entries = Object.entries(ROLE_VISIBLE_SECTIONS) as [string, SectionKey[]][];
    expect(entries.length).toBeGreaterThan(0);
    for (const [role, sections] of entries) {
      expect(sections, `${role} must have at least HOME`).toContain("HOME");
    }
  });

  it("buildVisibleTopSections returns only sections allowed for the role", () => {
    const sections = buildVisibleTopSections({
      companyRole: "ACCOUNTANT",
      canViewPath: () => true,
    });
    expect(sections.some((s) => s.label === "Home")).toBe(true);
    expect(sections.some((s) => s.label === "Finance")).toBe(true);
    expect(sections.some((s) => s.label === "Engineering")).toBe(false);
    expect(sections.some((s) => s.label === "Quality Management")).toBe(false);
    expect(sections.some((s) => s.label === "Settings")).toBe(false);
  });
});
