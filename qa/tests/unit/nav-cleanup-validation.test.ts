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
 *   Home · Execution · Engineering · Finance · Quality Management · Settings
 *
 * Execution (formerly Project Delivery) has Board · This fortnight · Deliveries ·
 * Allocations (the legacy "All Projects" list and "Milestone Tracker" were
 * retired — All Projects' features were migrated into the board). Finance has five: Cashflow · Cost of Sales · Revenue ·
 * Gross Profit · FYE Tracking Report. Engineering (Live-Ready 2026-06-22) is
 * ring-fenced to its Home landing while the delivery rebuild lands. Quality has three: Dashboard · Task
 * Board · Document Management. Settings has four: Roles & Permissions ·
 * Functionality Control · Integration Statuses · Audit Log. Everything else
 * is hidden by default and surfaced via Functionality Control.
 */

const EXPECTED_TOP_LABELS = [
  "Home",
  "Execution",
  "Engineering",
  "Finance",
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

  it("Execution has the locked items in spec order", () => {
    const section = findTop("Execution");
    expect(section.secondary.map((item) => item.path)).toEqual([
      "/execution",
      "/execution/milestones",
      "/execution/deliveries",
      "/execution/allocations",
    ]);
  });

  it("Finance has exactly the seven live-ready items in spec order", () => {
    // Live-Ready module (2026-06-11): exactly 7 items. Weekly Close is
    // scrapped (folded into Cashflow); Payment Requests + PO Approvals are
    // parked (procure-to-pay deferred) and removed from the sidebar.
    const section = findTop("Finance");
    expect(section.secondary.map((item) => item.path)).toEqual([
      "/finance",
      "/cashflow",
      "/cos",
      "/revenue-tracker",
      "/finance/gp/company",
      "/finance/qb-reconciliation",
      "/fye-revenue-tracking",
    ]);
  });

  it("Finance no longer surfaces Weekly Close / Payment Requests / PO Approvals", () => {
    const section = findTop("Finance");
    const paths = new Set(section.secondary.map((item) => item.path));
    for (const removed of ["/finance/close", "/payment-request-board", "/po-approval-board"]) {
      expect(paths.has(removed)).toBe(false);
    }
  });

  it("Engineering is ring-fenced to the delivery pages while the rebuild lands", () => {
    // Live-Ready: Engineering is the third module, between Execution and Finance.
    // Home + Task Manager are live; Document Management is re-added in Phase 3.
    // Standup + registers are removed from the engineering nav.
    const section = findTop("Engineering");
    expect(section.secondary.map((item) => item.path)).toEqual([
      "/engineering",
      "/engineering/tasks",
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

  it("Settings has the locked finance items in spec order", () => {
    // Live-Ready Settings (2026-06-18, owner): Roles & Permissions,
    // Integration Statuses, Audit Log. Functionality Control was removed from
    // the menu (screen gating defaults to open).
    const section = findTop("Settings");
    expect(section.secondary.map((item) => item.path)).toEqual([
      "/admin/roles",
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
