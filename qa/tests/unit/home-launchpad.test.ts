import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMyWorkPreviewItems,
  selectHomeCompanyPriorities,
  selectHomeExceptionPreview,
  type CompanyPriority,
  type ExceptionResponse,
} from "@/lib/home-launchpad";

describe("home launchpad logic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T08:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps only company-wide and role-relevant company priorities", () => {
    const priorities: CompanyPriority[] = [
      { id: 1, title: "Company goal", description: null, department: "company-wide", ownerRole: "all", status: "active", priorityRank: 2 },
      { id: 2, title: "Engineering focus", description: null, department: null, ownerRole: "ENGINEERING_MANAGER", status: "active", priorityRank: 1 },
      { id: 3, title: "Finance only", description: null, department: null, ownerRole: "finance", status: "active", priorityRank: 3 },
      { id: 4, title: "Closed", description: null, department: null, ownerRole: "all", status: "closed", priorityRank: 0 },
    ];

    const selected = selectHomeCompanyPriorities(priorities, { userRole: "ENGINEERING_MANAGER", userDepartment: "Engineering" });

    expect(selected.map((priority) => priority.title)).toEqual(["Engineering focus", "Company goal"]);
  });

  it("maps exception focus into approved launchpad categories and my-work links", () => {
    const exceptionResponse: ExceptionResponse = {
      summary: { total: 4, bySeverity: { critical: 1, high: 2, medium: 1, low: 0 } },
      items: [
        {
          id: "work-1",
          category: "blocked_tasks",
          severity: "critical",
          title: "Cable trench blocked",
          owner: "Alex",
          dueDate: "2026-03-14",
          project: "Solar Alpha",
          sourceLink: "/project/Solar%20Alpha",
          sourceType: "work_item",
          sourceId: 12,
          reason: "Blocked by permit",
        },
        {
          id: "approval-1",
          category: "pending_approvals",
          severity: "high",
          title: "Budget signoff",
          owner: "Finance queue",
          dueDate: "2026-03-15",
          project: "Solar Beta",
          sourceLink: "/approvals/1",
          sourceType: "approval",
          sourceId: 77,
          reason: "Approval waiting for decision",
        },
        {
          id: "deliverable-1",
          category: "missing_evidence",
          severity: "medium",
          title: "IFC drawing pack",
          owner: "Quality team",
          dueDate: null,
          project: "Solar Gamma",
          sourceLink: "/deliverables/3",
          sourceType: "deliverable",
          sourceId: 3,
          reason: "Deliverable in review without version evidence",
        },
      ],
    };

    const preview = selectHomeExceptionPreview(exceptionResponse, 3);

    expect(preview.summary.total).toBe(4);
    expect(preview.items).toEqual([
      expect.objectContaining({ modelLabel: "Blocked task", href: "/my-work/tasks?itemKey=plan-12" }),
      expect.objectContaining({ modelLabel: "Late approval", href: "/my-work/tasks?itemKey=approval-gen-77" }),
      expect.objectContaining({ modelLabel: "Missing deliverable", href: "/my-work/tasks?itemKey=del-3" }),
    ]);
  });

  it("prioritises overdue, blocked, due-soon work and still includes approvals in the preview", () => {
    const now = new Date("2026-03-16T08:00:00Z").getTime();
    const allTaskData = {
      personal: [
        {
          id: 1,
          title: "Old personal task",
          status: "todo",
          priority: "high",
          dueAt: new Date(now - 86_400_000).toISOString(),
        },
      ],
      operational: [
        {
          id: 2,
          title: "Blocked site task",
          status: "BLOCKED",
          priority: "Med",
          dueDate: new Date(now + 2 * 86_400_000).toISOString(),
          projectName: "Solar Alpha",
        },
        {
          id: 3,
          title: "Due soon task",
          status: "TO DO",
          priority: "Med",
          dueDate: new Date(now + 86_400_000).toISOString(),
          projectName: "Solar Beta",
        },
      ],
      approvals: {
        engineering: [
          {
            id: 9,
            title: "Stage signoff",
            status: "pending",
            createdAt: new Date(now).toISOString(),
            projectName: "Solar Gamma",
          },
        ],
      },
      trRegister: [
        {
          id: 4,
          actionDescription: "General action",
          status: "Active",
          ragStatus: "Green",
        },
      ],
    };

    const preview = buildMyWorkPreviewItems(allTaskData, 5);

    expect(preview.map((item) => item.reason)).toEqual(expect.arrayContaining(["overdue", "blocked", "dueSoon", "approval"]));
    expect(preview[0]).toEqual(expect.objectContaining({ itemKey: "personal-1", reason: "overdue" }));
    expect(preview.some((item) => item.itemKey === "approval-eng-9")).toBe(true);
    expect(preview.find((item) => item.itemKey === "approval-eng-9")?.href).toBe("/my-work/tasks?itemKey=approval-eng-9");
  });

  it("includes general approvals in the my-work preview queue", () => {
    const allTaskData = {
      approvals: {
        general: [
          {
            id: 17,
            title: "Client approval package",
            status: "pending",
            requestedAt: "2026-03-16T08:00:00.000Z",
            projectName: "Solar Delta",
          },
        ],
      },
    };

    const preview = buildMyWorkPreviewItems(allTaskData, 3);

    expect(preview[0]).toEqual(expect.objectContaining({
      itemKey: "approval-gen-17",
      reason: "approval",
      href: "/my-work/tasks?itemKey=approval-gen-17",
    }));
  });
});
