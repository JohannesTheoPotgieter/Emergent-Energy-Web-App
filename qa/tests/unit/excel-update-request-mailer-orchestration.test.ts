/**
 * Excel-update-request mailer orchestration — covers the wiring
 * from `sendExcelUpdateRequest` through DB recipient lookup,
 * outlook.sendMail, and createNotification. The pure body-shape
 * tests live in `excel-update-request-mailer.test.ts`.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const dbWhereResults: Array<Array<{ id: number; email: string; name: string }>> = [];
const sendMailCalls: Array<{ to: string[]; cc: string[] | undefined; subject: string; body: string; bodyType?: string }> = [];
const createNotificationCalls: Array<Record<string, unknown>> = [];

let sendMailNextThrows: Error | null = null;
let dbThrows: Error | null = null;
let createNotificationThrowsOnIndex: number | null = null;

vi.mock("../../../server/db", () => {
  const select = (_cols?: unknown) => ({
    from: () => ({
      where: () => {
        if (dbThrows) throw dbThrows;
        return Promise.resolve(dbWhereResults.shift() ?? []);
      },
    }),
  });
  return {
    db: { select },
  };
});

vi.mock("../../../server/outlook", () => ({
  sendMail: vi.fn(async (opts: { to: string[]; cc?: string[]; subject: string; body: string; bodyType?: string }) => {
    sendMailCalls.push({ to: opts.to, cc: opts.cc, subject: opts.subject, body: opts.body, bodyType: opts.bodyType });
    if (sendMailNextThrows) {
      const e = sendMailNextThrows;
      sendMailNextThrows = null;
      throw e;
    }
  }),
}));

vi.mock("../../../server/services/notification-service", () => ({
  createNotification: vi.fn(async (params: Record<string, unknown>) => {
    const idx = createNotificationCalls.length;
    createNotificationCalls.push(params);
    if (createNotificationThrowsOnIndex === idx) {
      createNotificationThrowsOnIndex = null;
      throw new Error("notification-service down");
    }
    return { id: idx + 1 };
  }),
}));

vi.mock("@shared/schema", () => ({
  users: {
    id: "users.id",
    email: "users.email",
    name: "users.name",
    role: "users.role",
    deletedAt: "users.deleted_at",
    isActive: "users.is_active",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  inArray: (col: unknown, vals: unknown[]) => ({ inArray: { col, vals } }),
  sql: ((..._args: unknown[]) => ({ sql: true })) as unknown,
}));

import { sendExcelUpdateRequest } from "../../../server/services/excel-update-request-mailer";

const baseInput = {
  projectId: 42,
  projectName: "Acme Solar Phase 2",
  resolveAction: "keep_app" as const,
  section: "EXPENDITURE" as const,
  entries: [{ table: "normalized_cost_lines" as const, rowId: 1, fieldName: "amountExVat" }],
  reason: "Vendor invoice arrived after the import.",
  requesterUserId: 7,
  requesterName: "Janet Operator",
  requesterEmail: "janet@emergentenergy.co.za",
};

beforeEach(() => {
  dbWhereResults.length = 0;
  sendMailCalls.length = 0;
  createNotificationCalls.length = 0;
  sendMailNextThrows = null;
  dbThrows = null;
  createNotificationThrowsOnIndex = null;
});

describe("sendExcelUpdateRequest orchestration", () => {
  it("sends one email to all recipients with the requester in cc", async () => {
    dbWhereResults.push([
      { id: 11, email: "pm@ee.co.za", name: "Pat PM" },
      { id: 12, email: "pfm@ee.co.za", name: "Phil PFM" },
      { id: 13, email: "cm@ee.co.za", name: "Casey CM" },
    ]);

    const out = await sendExcelUpdateRequest(baseInput);

    expect(out).toEqual({ recipients: 3, emailSent: true, notifications: 3 });
    expect(sendMailCalls).toHaveLength(1);
    expect(sendMailCalls[0].to).toEqual(["pm@ee.co.za", "pfm@ee.co.za", "cm@ee.co.za"]);
    expect(sendMailCalls[0].cc).toEqual(["janet@emergentenergy.co.za"]);
    expect(sendMailCalls[0].bodyType).toBe("HTML");
    expect(sendMailCalls[0].subject).toContain("Acme Solar Phase 2");
  });

  it("creates one notification per recipient with NO throttle entity fields", async () => {
    dbWhereResults.push([
      { id: 11, email: "pm@ee.co.za", name: "Pat PM" },
      { id: 12, email: "pfm@ee.co.za", name: "Phil PFM" },
    ]);

    await sendExcelUpdateRequest(baseInput);

    expect(createNotificationCalls).toHaveLength(2);
    for (const call of createNotificationCalls) {
      // Per user decision (no throttle), the orchestration MUST NOT pass
      // relatedEntityType / relatedEntityId because the notification-service
      // throttles those for 10 minutes and would silently drop repeat
      // resolves.
      expect(call).not.toHaveProperty("relatedEntityType");
      expect(call).not.toHaveProperty("relatedEntityId");
      expect(call.eventType).toBe("excel_update_required_keep_app");
      expect(call.projectId).toBe(42);
    }
  });

  it("uses request_approval event type when resolveAction is request_approval", async () => {
    dbWhereResults.push([{ id: 11, email: "pm@ee.co.za", name: "Pat PM" }]);

    await sendExcelUpdateRequest({
      ...baseInput,
      resolveAction: "request_approval",
      requestId: 999,
    });

    expect(createNotificationCalls[0].eventType).toBe("excel_update_required_request_approval");
    expect(sendMailCalls[0].subject).toContain("[Approval requested]");
  });

  it("returns recipients=0 and skips sends when no users match the role filter", async () => {
    dbWhereResults.push([]);

    const out = await sendExcelUpdateRequest(baseInput);

    expect(out).toEqual({ recipients: 0, emailSent: false, notifications: 0 });
    expect(sendMailCalls).toHaveLength(0);
    expect(createNotificationCalls).toHaveLength(0);
  });

  it("filters out recipients without a valid email address", async () => {
    dbWhereResults.push([
      { id: 11, email: "pm@ee.co.za", name: "Pat PM" },
      { id: 14, email: "", name: "Empty Email" },
      { id: 15, email: "no-at-sign", name: "Bad Email" },
      // null is what the typed select returns when email is missing
      { id: 16, email: null as unknown as string, name: "Null Email" },
    ]);

    const out = await sendExcelUpdateRequest(baseInput);

    expect(sendMailCalls[0].to).toEqual(["pm@ee.co.za"]);
    expect(out.recipients).toBe(1);
    expect(out.notifications).toBe(1);
  });

  it("still creates in-app notifications when sendMail throws", async () => {
    dbWhereResults.push([
      { id: 11, email: "pm@ee.co.za", name: "Pat PM" },
      { id: 12, email: "pfm@ee.co.za", name: "Phil PFM" },
    ]);
    sendMailNextThrows = new Error("Graph 503");

    const out = await sendExcelUpdateRequest(baseInput);

    expect(out.emailSent).toBe(false);
    expect(out.recipients).toBe(2);
    expect(out.notifications).toBe(2);
  });

  it("does not throw when notification-service throws on one recipient", async () => {
    dbWhereResults.push([
      { id: 11, email: "pm@ee.co.za", name: "Pat PM" },
      { id: 12, email: "pfm@ee.co.za", name: "Phil PFM" },
      { id: 13, email: "cm@ee.co.za", name: "Casey CM" },
    ]);
    createNotificationThrowsOnIndex = 1;

    const out = await sendExcelUpdateRequest(baseInput);

    // Three calls attempted; the middle one threw so two succeeded.
    expect(createNotificationCalls).toHaveLength(3);
    expect(out.notifications).toBe(2);
    expect(out.emailSent).toBe(true);
  });

  it("returns recipients=0 when the recipient lookup itself throws", async () => {
    dbThrows = new Error("DB connection refused");

    const out = await sendExcelUpdateRequest(baseInput);

    expect(out).toEqual({ recipients: 0, emailSent: false, notifications: 0 });
    expect(sendMailCalls).toHaveLength(0);
  });

  it("omits cc when the requester has no email", async () => {
    dbWhereResults.push([{ id: 11, email: "pm@ee.co.za", name: "Pat PM" }]);

    await sendExcelUpdateRequest({ ...baseInput, requesterEmail: null });

    expect(sendMailCalls[0].cc).toBeUndefined();
  });
});
