import { describe, expect, it } from "vitest";
import { isActivePdWorkingOpportunity, isOpportunityIntakeTerminal } from "../../../server/lib/opportunity-working-filter";

describe("isActivePdWorkingOpportunity", () => {
  it("includes pipedrive active/open opportunities", () => {
    expect(
      isActivePdWorkingOpportunity({
        source: "pipedrive",
        status: "active",
        stage: "qualification",
        signedDate: null,
        hasLinkedProject: false,
      }),
    ).toBe(true);
  });

  it("excludes lost opportunities", () => {
    expect(
      isActivePdWorkingOpportunity({
        source: "pipedrive",
        status: "lost",
        stage: "qualification",
        signedDate: null,
        hasLinkedProject: false,
      }),
    ).toBe(false);
  });

  it("excludes won/signed/closed opportunities", () => {
    expect(
      isActivePdWorkingOpportunity({
        source: "pipedrive",
        status: "won",
        stage: "won",
        signedDate: null,
        hasLinkedProject: false,
      }),
    ).toBe(false);

    expect(
      isActivePdWorkingOpportunity({
        source: "pipedrive",
        status: "active",
        stage: "proposal",
        signedDate: "2026-04-01",
        hasLinkedProject: false,
      }),
    ).toBe(false);
  });

  it("excludes converted opportunities with linked projects", () => {
    expect(
      isActivePdWorkingOpportunity({
        source: "pipedrive",
        status: "active",
        stage: "proposal",
        signedDate: null,
        hasLinkedProject: true,
      }),
    ).toBe(false);
  });
});

describe("isOpportunityIntakeTerminal", () => {
  it("treats lost/won/closed/signed markers as terminal", () => {
    expect(isOpportunityIntakeTerminal({ status: "lost", stage: "qualification", signedDate: null })).toBe(true);
    expect(isOpportunityIntakeTerminal({ status: "active", stage: "won", signedDate: null })).toBe(true);
    expect(isOpportunityIntakeTerminal({ status: "active", stage: "proposal", signedDate: "2026-04-01" })).toBe(true);
  });

  it("allows active non-terminal states", () => {
    expect(isOpportunityIntakeTerminal({ status: "active", stage: "qualification", signedDate: null })).toBe(false);
  });
});
