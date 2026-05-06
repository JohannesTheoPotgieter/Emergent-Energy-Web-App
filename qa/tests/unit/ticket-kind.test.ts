import { describe, it, expect } from "vitest";
import { getTicketKind, ticketKindLabel } from "@shared/lib/ticket-kind";

describe("getTicketKind", () => {
  it("returns 'engineering' for known engineering request types", () => {
    expect(getTicketKind({ requestType: "Feasibility Study" })).toBe("engineering");
    expect(getTicketKind({ requestType: "Design Review" })).toBe("engineering");
    expect(getTicketKind({ requestType: "Cost Proposal" })).toBe("engineering");
    expect(getTicketKind({ requestType: "First Assessment" })).toBe("engineering");
    expect(getTicketKind({ requestType: "Site Visit Report" })).toBe("engineering");
  });

  it("returns 'quality' for non-engineering request types", () => {
    expect(getTicketKind({ requestType: "Quality Inspection" })).toBe("quality");
    expect(getTicketKind({ requestType: "Random Other Type" })).toBe("quality");
  });

  it("defaults to 'quality' for null / undefined / empty inputs", () => {
    expect(getTicketKind(null)).toBe("quality");
    expect(getTicketKind(undefined)).toBe("quality");
    expect(getTicketKind({})).toBe("quality");
    expect(getTicketKind({ requestType: null })).toBe("quality");
    expect(getTicketKind({ requestType: "" })).toBe("quality");
  });

  it("ticketKindLabel returns the right singular/plural label", () => {
    expect(ticketKindLabel("engineering")).toBe("Engineering ticket");
    expect(ticketKindLabel("engineering", "plural")).toBe("Engineering tickets");
    expect(ticketKindLabel("quality")).toBe("Quality ticket");
    expect(ticketKindLabel("quality", "plural")).toBe("Quality tickets");
  });
});
