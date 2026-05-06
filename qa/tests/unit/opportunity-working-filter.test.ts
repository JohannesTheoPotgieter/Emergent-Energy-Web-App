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

  it("keeps active opportunities visible even after a project has been linked", () => {
    // Linked-to-project is no longer a hide-reason — the row stays in
    // the working list and the UI surfaces a "Linked: <project>" chip.
    expect(
      isActivePdWorkingOpportunity({
        source: "pipedrive",
        status: "active",
        stage: "proposal",
        signedDate: null,
        hasLinkedProject: true,
      }),
    ).toBe(true);
  });

  it("still excludes terminal opportunities even when linked to a project", () => {
    // A linked project does NOT rescue a lost/won/signed deal.
    expect(
      isActivePdWorkingOpportunity({
        source: "pipedrive",
        status: "lost",
        stage: "qualification",
        signedDate: null,
        hasLinkedProject: true,
      }),
    ).toBe(false);
    expect(
      isActivePdWorkingOpportunity({
        source: "pipedrive",
        status: "active",
        stage: "proposal",
        signedDate: "2026-04-01",
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
